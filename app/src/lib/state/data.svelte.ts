import { getMeta, setMeta } from '$lib/storage/meta';
import type { LocalStore } from '$lib/storage/types';
import {
  nextUpdatedAt,
  incomingWins,
  compareVersions,
  type Change,
  type Entity,
  type EntityType,
  type DataByType,
  type ListItemEntity,
  type PhotoEntity,
  type SpotEntity,
  type VisitEntity
} from '@spots/shared';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { session } from './session.svelte';

/**
 * The whole structured dataset lives in memory (a few MB even at thousands
 * of spots); every mutation is persisted through the LocalStore and marked
 * dirty for sync. Photo blobs are NEVER held here — components create
 * object URLs on demand.
 */
class DataState {
  entities = new SvelteMap<string, Entity>();
  /** Entity ids with local changes not yet pushed. */
  dirty = new SvelteSet<string>();
  /** "hash.ext" blobs not yet uploaded. */
  pendingUploads = new SvelteSet<string>();
  /** "hash.ext" blobs referenced by pulled photo entities, not yet downloaded. */
  pendingDownloads = new SvelteSet<string>();
  lastServerTime = 0;
  cursor = 0;
  readOnly = $state(false);
  ready = $state(false);

  store!: LocalStore;
  /** Wired to the sync engine at boot (avoids a circular import). */
  onLocalChange: () => void = () => {};

  async init(store: LocalStore): Promise<void> {
    this.store = store;
    this.entities.clear();
    for (const e of await store.loadEntities()) this.entities.set(e.id, e);
    for (const id of (await getMeta<string[]>('dirty')) ?? []) this.dirty.add(id);
    for (const key of (await getMeta<string[]>('pendingUploads')) ?? []) this.pendingUploads.add(key);
    for (const key of (await getMeta<string[]>('pendingDownloads')) ?? []) this.pendingDownloads.add(key);
    this.cursor = (await getMeta<number>('cursor')) ?? 0;
    this.lastServerTime = (await getMeta<number>('lastServerTime')) ?? 0;
    this.ready = true;
  }

  async persistSets(): Promise<void> {
    await setMeta('dirty', [...this.dirty]);
    await setMeta('pendingUploads', [...this.pendingUploads]);
    await setMeta('pendingDownloads', [...this.pendingDownloads]);
  }

  async setCursor(cursor: number): Promise<void> {
    this.cursor = cursor;
    await setMeta('cursor', cursor);
  }

  async setServerTime(t: number): Promise<void> {
    if (t > this.lastServerTime) {
      this.lastServerTime = t;
      await setMeta('lastServerTime', t);
    }
  }

  /* ------------------------------ local writes ------------------------------ */

  /** Second tabs are read-only (single-writer Web Lock) — refuse writes hard. */
  private assertWritable(): void {
    if (this.readOnly) throw new Error('Spots is open in another tab — this tab is read-only.');
  }

  async upsert<T extends EntityType>(type: T, id: string, payload: DataByType[T]): Promise<Entity<T>> {
    this.assertWritable();
    const prev = this.entities.get(id);
    const now = Date.now();
    const entity: Entity<T> = {
      id,
      type,
      createdAt: prev?.createdAt ?? now,
      updatedAt: nextUpdatedAt(now, prev?.updatedAt ?? 0, this.lastServerTime),
      updatedBy: session.deviceId,
      deleted: false,
      data: JSON.parse(JSON.stringify(payload)) as DataByType[T]
    };
    this.entities.set(id, entity);
    await this.store.saveEntities([entity]);
    await this.markDirty([id]);
    return entity;
  }

  private async tombstone(ids: string[]): Promise<void> {
    this.assertWritable();
    const now = Date.now();
    const changed: Entity[] = [];
    for (const id of ids) {
      const prev = this.entities.get(id);
      if (!prev || prev.deleted) continue;
      const entity: Entity = {
        ...prev,
        updatedAt: nextUpdatedAt(now, prev.updatedAt, this.lastServerTime),
        updatedBy: session.deviceId,
        deleted: true
        // keep data: pushed with the tombstone so server blob GC stays conservative
      };
      this.entities.set(id, entity);
      changed.push(entity);
    }
    if (changed.length > 0) {
      await this.store.saveEntities(changed);
      await this.markDirty(changed.map((e) => e.id));
    }
  }

  private async markDirty(ids: string[]): Promise<void> {
    for (const id of ids) this.dirty.add(id);
    await this.persistSets();
    this.onLocalChange();
  }

  async queueUpload(hash: string, ext: string): Promise<void> {
    this.pendingUploads.add(`${hash}.${ext}`);
    await this.persistSets();
    this.onLocalChange();
  }

  async clearUpload(key: string): Promise<void> {
    this.pendingUploads.delete(key);
    await this.persistSets();
  }

  async clearDownload(key: string): Promise<void> {
    this.pendingDownloads.delete(key);
    await this.persistSets();
  }

  /**
   * Delete a spot with client-side cascade (the server is payload-opaque and
   * cannot cascade): tombstones its visits and every photo entity referenced
   * by the spot or those visits, then drops local blobs that no live photo
   * still references.
   */
  async deleteSpot(spotId: string): Promise<void> {
    const spot = this.getSpot(spotId);
    if (!spot) return;
    const ids = [spotId];
    const photoIds = new Set([...spot.data.photoIds, ...spot.data.habitatPhotoIds]);
    for (const visit of this.visitsOf(spotId)) {
      ids.push(visit.id);
      for (const pid of visit.data.photoIds) photoIds.add(pid);
    }
    ids.push(...photoIds);
    await this.tombstone(ids);
    await this.dropOrphanBlobs([...photoIds]);
  }

  /** Tombstone photo entities removed during an edit (with blob cleanup). */
  async removePhotos(photoIds: string[]): Promise<void> {
    await this.tombstone(photoIds);
    await this.dropOrphanBlobs(photoIds);
  }

  async deleteVisit(visitId: string): Promise<void> {
    const visit = this.entities.get(visitId) as VisitEntity | undefined;
    if (!visit) return;
    const photoIds = visit.data?.photoIds ?? [];
    await this.tombstone([visitId, ...photoIds]);
    await this.dropOrphanBlobs(photoIds);
  }

  /** Remove local blob files whose hash is no longer referenced by any live photo. */
  private async dropOrphanBlobs(tombstonedPhotoIds: string[]): Promise<void> {
    for (const pid of tombstonedPhotoIds) {
      const photo = this.entities.get(pid) as PhotoEntity | undefined;
      const data = photo?.data;
      if (!data) continue;
      const stillUsed = this.livePhotos().some((p) => p.data.hash === data.hash && p.id !== pid);
      if (!stillUsed) {
        await this.store.deleteBlob(data.hash, data.ext);
        await this.clearUpload(`${data.hash}.${data.ext}`);
      }
    }
  }

  /* ------------------------------ remote merge ------------------------------ */

  /** Apply pulled changes (never marks dirty). Returns blob keys to download. */
  async applyRemote(changes: Change[]): Promise<string[]> {
    const toPersist: Entity[] = [];
    const needDownload: string[] = [];
    for (const c of changes) {
      const local = this.entities.get(c.id);
      if (local && !incomingWins(c, local)) continue; // local is newer; will push
      const entity: Entity = {
        id: c.id,
        type: c.type,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        updatedBy: c.updatedBy,
        deleted: c.deleted,
        data: (c.data as Entity['data']) ?? null
      };
      this.entities.set(c.id, entity);
      toPersist.push(entity);
      // Remote version won (or is our own echo): local dirty flag is obsolete.
      if (this.dirty.has(c.id) && compareVersions(c.updatedAt, c.updatedBy, local?.updatedAt ?? 0, local?.updatedBy ?? '') >= 0) {
        this.dirty.delete(c.id);
      }
      // A remotely deleted photo frees its local blob (if nothing else uses it).
      if (c.type === 'photo' && c.deleted && local?.data && local.type === 'photo') {
        const { hash, ext } = local.data as { hash: string; ext: string };
        if (!this.livePhotos().some((p) => p.data.hash === hash)) {
          await this.store.deleteBlob(hash, ext);
          this.pendingUploads.delete(`${hash}.${ext}`);
          this.pendingDownloads.delete(`${hash}.${ext}`);
        }
      }
      if (c.type === 'photo' && !c.deleted && c.data) {
        const { hash, ext } = c.data as { hash: string; ext: string };
        if (!(await this.store.getBlob(hash, ext))) {
          this.pendingDownloads.add(`${hash}.${ext}`);
          needDownload.push(`${hash}.${ext}`);
        }
      }
    }
    if (toPersist.length > 0) await this.store.saveEntities(toPersist);
    await this.persistSets();
    return needDownload;
  }

  /** Hard-remove local entities the server no longer has (full resync after 410). */
  async removeMissing(seenIds: Set<string>): Promise<void> {
    const gone: string[] = [];
    for (const [id] of this.entities) {
      if (!seenIds.has(id) && !this.dirty.has(id)) gone.push(id);
    }
    for (const id of gone) this.entities.delete(id);
    if (gone.length > 0) await this.store.removeEntities(gone);
  }

  /* -------------------------------- queries -------------------------------- */

  getSpot(id: string): SpotEntity | undefined {
    const e = this.entities.get(id);
    return e && e.type === 'spot' && !e.deleted && e.data ? (e as SpotEntity) : undefined;
  }

  liveSpots(): SpotEntity[] {
    const out: SpotEntity[] = [];
    for (const e of this.entities.values()) {
      if (e.type === 'spot' && !e.deleted && e.data) out.push(e as SpotEntity);
    }
    return out;
  }

  livePhotos(): PhotoEntity[] {
    const out: PhotoEntity[] = [];
    for (const e of this.entities.values()) {
      if (e.type === 'photo' && !e.deleted && e.data) out.push(e as PhotoEntity);
    }
    return out;
  }

  getPhoto(id: string): PhotoEntity | undefined {
    const e = this.entities.get(id);
    return e && e.type === 'photo' && !e.deleted && e.data ? (e as PhotoEntity) : undefined;
  }

  visitsOf(spotId: string): VisitEntity[] {
    const out: VisitEntity[] = [];
    for (const e of this.entities.values()) {
      if (e.type === 'visit' && !e.deleted && e.data && (e as VisitEntity).data.spotId === spotId) {
        out.push(e as VisitEntity);
      }
    }
    return out.sort((a, b) => b.data.at - a.data.at);
  }

  listItems(kind: 'species' | 'plant'): ListItemEntity[] {
    const out: ListItemEntity[] = [];
    for (const e of this.entities.values()) {
      if (e.type === 'listItem' && !e.deleted && e.data && (e as ListItemEntity).data.kind === kind) {
        out.push(e as ListItemEntity);
      }
    }
    return out.sort((a, b) => a.data.name.localeCompare(b.data.name));
  }

  itemName(id: string | null | undefined): string {
    if (!id) return '';
    const e = this.entities.get(id) as ListItemEntity | undefined;
    return e?.data?.name ?? '';
  }
}

export const data = new DataState();
