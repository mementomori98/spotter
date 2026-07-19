import { data } from '$lib/state/data.svelte';
import { session } from '$lib/state/session.svelte';
import { toasts } from '$lib/state/toasts.svelte';
import {
  CLOCK_SKEW_WARN_MS,
  ERR,
  PUSH_BATCH_LIMIT,
  RENEWED_TOKEN_HEADER,
  entityToChange,
  type AuthResponse,
  type PullResponse,
  type PushResponse
} from '@spots/shared';

class ConflictPause extends Error {}
class AuthFailure extends Error {}

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'conflict' | 'readonly';

/**
 * Sync cycle (order matters — reviewed & agreed):
 *   1. ensure the account is registered (offline-created accounts)
 *   2. upload pending photo blobs           <- blobs BEFORE entities
 *   3. push dirty entities (batched)
 *   4. pull since cursor (paged; 410 -> full resync)
 *   5. download missing blobs
 * Triggers: app start, connectivity restored, local change (debounced),
 * manual "sync now". Single-flight with a queued re-run.
 */
class SyncEngine {
  status = $state<SyncStatus>('idle');
  lastSyncAt = $state<number | null>(null);
  errorMsg = $state<string | null>(null);
  progress = $state<string | null>(null);

  private running = false;
  private queued = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private warnedSkew = false;

  get pendingCount(): number {
    return data.dirty.size + data.pendingUploads.size;
  }

  start(): void {
    data.onLocalChange = () => this.schedule();
    window.addEventListener('online', () => void this.sync());
    void this.sync();
  }

  /** Debounced sync after local mutations. */
  schedule(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.sync(), 4000);
  }

  async sync(): Promise<void> {
    if (!session.current || !data.ready) return;
    if (data.readOnly) {
      this.status = 'readonly';
      return;
    }
    if (this.running) {
      this.queued = true;
      return;
    }
    this.running = true;
    this.status = 'syncing';
    try {
      await this.ensureRegistered();
      await this.uploadBlobs();
      await this.pushDirty();
      await this.pullAll();
      await this.downloadBlobs();
      this.status = 'idle';
      this.errorMsg = null;
      this.lastSyncAt = Date.now();
    } catch (err) {
      if (err instanceof ConflictPause) {
        this.status = 'conflict';
      } else if (err instanceof AuthFailure) {
        this.status = 'error';
        this.errorMsg = 'Sign-in failed — the account may have changed on the server.';
      } else if (!navigator.onLine || err instanceof TypeError) {
        this.status = 'offline'; // fetch network failures are TypeErrors
      } else {
        this.status = 'error';
        this.errorMsg = err instanceof Error ? err.message : String(err);
      }
    } finally {
      this.progress = null;
      this.running = false;
      if (this.queued) {
        this.queued = false;
        void this.sync();
      }
    }
  }

  /* -------------------------------- account -------------------------------- */

  private async ensureRegistered(): Promise<void> {
    const s = session.current!;
    if (s.registered && s.token) return;
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: s.username, password: s.password })
    });
    if (res.status === 201) {
      const body = (await res.json()) as AuthResponse;
      await session.update({ token: body.token, userId: body.userId, registered: true });
      return;
    }
    if (res.status === 409) {
      // Username taken on the server. Sync pauses; the UI offers
      // "log in instead" (it's my account) or "rename". Local data is kept.
      throw new ConflictPause();
    }
    throw new Error(`registration failed (${res.status})`);
  }

  /** Conflict resolution path A: same person, existing server account. */
  async resolveConflictLogin(): Promise<boolean> {
    const ok = await this.login();
    if (ok) {
      this.status = 'idle';
      void this.sync();
    }
    return ok;
  }

  /** Conflict resolution path B: pick a different username (keeps all local data). */
  async resolveConflictRename(newUsername: string): Promise<void> {
    await session.update({ username: newUsername.trim().toLowerCase(), registered: false, token: null });
    this.status = 'idle';
    void this.sync();
  }

  private async login(): Promise<boolean> {
    const s = session.current!;
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: s.username, password: s.password })
    });
    if (!res.ok) return false;
    const body = (await res.json()) as AuthResponse;
    await session.update({ token: body.token, userId: body.userId, registered: true });
    return true;
  }

  /** Authenticated fetch: token, sliding renewal, one silent re-login on 401. */
  private async api(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
    const res = await fetch(path, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${session.current!.token}` }
    });
    const renewed = res.headers.get(RENEWED_TOKEN_HEADER);
    if (renewed) await session.update({ token: renewed });
    if (res.status === 401 && !retried) {
      if (!(await this.login())) throw new AuthFailure();
      return this.api(path, init, true);
    }
    return res;
  }

  /* --------------------------------- blobs --------------------------------- */

  private async uploadBlobs(): Promise<void> {
    const keys = [...data.pendingUploads];
    let done = 0;
    for (const key of keys) {
      const dot = key.lastIndexOf('.');
      const hash = key.slice(0, dot);
      const ext = key.slice(dot + 1);
      const blob = await data.store.getBlob(hash, ext);
      if (!blob) {
        await data.clearUpload(key); // blob vanished locally (orphan cleanup)
        continue;
      }
      this.progress = `Uploading photos ${++done}/${keys.length}`;
      const res = await this.api(`/api/blobs/${hash}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: blob
      });
      if (res.ok) {
        await data.clearUpload(key);
      } else {
        throw new Error(`photo upload failed (${res.status})`);
      }
    }
  }

  private async downloadBlobs(): Promise<void> {
    const keys = [...data.pendingDownloads];
    let done = 0;
    for (const key of keys) {
      const dot = key.lastIndexOf('.');
      const hash = key.slice(0, dot);
      const ext = key.slice(dot + 1);
      this.progress = `Downloading photos ${++done}/${keys.length}`;
      const res = await this.api(`/api/blobs/${hash}`);
      if (res.ok) {
        await data.store.putBlob(hash, ext, await res.blob());
        await data.clearDownload(key);
      } else if (res.status === 404) {
        // Non-fatal: blob may still be pending upload from another device.
        await data.clearDownload(key);
      } else {
        throw new Error(`photo download failed (${res.status})`);
      }
    }
  }

  /* ------------------------------- push / pull ------------------------------ */

  private async pushDirty(): Promise<void> {
    while (data.dirty.size > 0) {
      const ids = [...data.dirty].slice(0, PUSH_BATCH_LIMIT);
      const snapshot = new Map<string, number>();
      const changes = [];
      for (const id of ids) {
        const e = data.entities.get(id);
        if (!e) {
          data.dirty.delete(id);
          continue;
        }
        snapshot.set(id, e.updatedAt);
        changes.push(entityToChange(JSON.parse(JSON.stringify(e))));
      }
      if (changes.length === 0) return;
      this.progress = `Saving ${data.dirty.size} change(s)`;
      const res = await this.api('/api/sync/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ changes })
      });
      if (!res.ok) throw new Error(`push failed (${res.status})`);
      const body = (await res.json()) as PushResponse;
      await data.setServerTime(body.serverTime);
      this.checkSkew(body.serverTime);
      for (const result of body.results) {
        // Clear dirty only if unchanged since the pushed snapshot (an edit
        // during the in-flight push must stay dirty). LWW-rejected pushes
        // (applied=false) are also settled: the server has a newer version
        // that the next pull will deliver.
        if (data.entities.get(result.id)?.updatedAt === snapshot.get(result.id)) {
          data.dirty.delete(result.id);
        }
      }
      await data.persistSets(); // dirty-set changes must survive a reload
      // Safety net: the server re-reports blobs it lacks for pushed photos.
      // MUST be persisted (queueUpload) — if the retry upload fails and the
      // app restarts, an unpersisted set would orphan the photo forever.
      for (const hash of body.missingBlobs) {
        const photo = data.livePhotos().find((p) => p.data.hash === hash);
        if (photo) await data.queueUpload(hash, photo.data.ext);
      }
      if (body.missingBlobs.length > 0) await this.uploadBlobs();
    }
  }

  private async pullAll(): Promise<void> {
    for (;;) {
      this.progress = 'Checking for updates';
      const res = await this.api(`/api/sync/pull?since=${data.cursor}`);
      if (res.status === 410) {
        await this.fullResync();
        return;
      }
      if (!res.ok) throw new Error(`pull failed (${res.status})`);
      const body = (await res.json()) as PullResponse;
      await data.setServerTime(body.serverTime);
      this.checkSkew(body.serverTime);
      await data.applyRemote(body.changes);
      await data.setCursor(body.cursor);
      if (!body.hasMore) return;
    }
  }

  /** Cursor fell behind the server's tombstone purge horizon (HTTP 410). */
  private async fullResync(): Promise<void> {
    this.progress = 'Resynchronizing everything';
    const seen = new Set<string>();
    let cursor = 0;
    for (;;) {
      const res = await this.api(`/api/sync/pull?since=${cursor}`);
      if (!res.ok) throw new Error(`full resync failed (${res.status})`);
      const body = (await res.json()) as PullResponse;
      for (const c of body.changes) seen.add(c.id);
      await data.applyRemote(body.changes);
      cursor = body.cursor;
      if (!body.hasMore) break;
    }
    // Entities absent from the server and not locally dirty were deleted
    // (tombstone purged while this device was offline).
    await data.removeMissing(seen);
    await data.setCursor(cursor);
  }

  private checkSkew(serverTime: number): void {
    if (this.warnedSkew) return;
    if (Math.abs(Date.now() - serverTime) > CLOCK_SKEW_WARN_MS) {
      this.warnedSkew = true;
      toasts.show('Your device clock differs from the server by several minutes — check date & time settings.', {
        kind: 'warn',
        timeout: 8000
      });
    }
  }
}

export const engine = new SyncEngine();
export { ERR };
