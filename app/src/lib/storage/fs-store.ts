import type { Entity } from '@spots/shared';
import type { LocalStore } from './types';

const DATA_FILE = 'spots-data.json';
const PHOTOS_DIR = 'photos';

/**
 * Real files in a user-chosen folder (File System Access API, desktop
 * Chrome/Edge): `spots-data.json` + `photos/<hash>.<ext>`.
 *
 * The whole entity set is kept in memory (small) and written as one JSON
 * file: atomically (createWritable swaps on close), debounced for edits,
 * immediately for creates/deletes, and flushed when the tab hides.
 */
export class FsStore implements LocalStore {
  readonly kind = 'fs' as const;
  private entities = new Map<string, Entity>();
  private loaded = false;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();
  /** Surfaced to the UI (toast) — a failed write must never be silent. */
  onWriteError: (err: unknown) => void = () => {};

  constructor(private readonly root: FileSystemDirectoryHandle) {}

  async loadEntities(): Promise<Entity[]> {
    try {
      const handle = await this.root.getFileHandle(DATA_FILE);
      const text = await (await handle.getFile()).text();
      const parsed = JSON.parse(text) as { entities: Entity[] };
      this.entities = new Map(parsed.entities.map((e) => [e.id, e]));
    } catch {
      this.entities = new Map(); // first run in this folder
    }
    this.loaded = true;
    return [...this.entities.values()];
  }

  async saveEntities(entities: Entity[]): Promise<void> {
    if (!this.loaded) await this.loadEntities();
    for (const e of entities) this.entities.set(e.id, JSON.parse(JSON.stringify(e)) as Entity);
    this.scheduleWrite();
  }

  async removeEntities(ids: string[]): Promise<void> {
    for (const id of ids) this.entities.delete(id);
    await this.writeNow();
  }

  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => void this.writeNow().catch(() => {}), 800);
  }

  private async writeNow(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    // Serialize writes; createWritable() keeps the old file until close().
    // The chain must survive a rejected write (disk full, permission lapse):
    // one failure must not silently disable all future persistence.
    const task = this.writing.then(async () => {
      const handle = await this.root.getFileHandle(DATA_FILE, { create: true });
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify({ version: 1, entities: [...this.entities.values()] }));
      await writable.close();
    });
    this.writing = task.catch(() => {});
    try {
      await task;
    } catch (err) {
      this.onWriteError(err);
      throw err;
    }
  }

  async putBlob(hash: string, ext: string, blob: Blob): Promise<void> {
    const dir = await this.root.getDirectoryHandle(PHOTOS_DIR, { create: true });
    const file = await dir.getFileHandle(`${hash}.${ext}`, { create: true });
    const writable = await file.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  async getBlob(hash: string, ext: string): Promise<Blob | undefined> {
    try {
      const dir = await this.root.getDirectoryHandle(PHOTOS_DIR);
      const file = await dir.getFileHandle(`${hash}.${ext}`);
      return await file.getFile();
    } catch {
      return undefined;
    }
  }

  async deleteBlob(hash: string, ext: string): Promise<void> {
    try {
      const dir = await this.root.getDirectoryHandle(PHOTOS_DIR);
      await dir.removeEntry(`${hash}.${ext}`);
    } catch {
      /* already gone */
    }
  }

  async flush(): Promise<void> {
    if (this.writeTimer) await this.writeNow();
  }
}

/** Permission helper for a stored directory handle. */
export async function ensureFsPermission(
  handle: FileSystemDirectoryHandle,
  withPrompt: boolean
): Promise<'granted' | 'prompt' | 'denied'> {
  const opts = { mode: 'readwrite' } as const;
  let state = await handle.queryPermission(opts);
  if (state === 'prompt' && withPrompt) state = await handle.requestPermission(opts);
  return state;
}
