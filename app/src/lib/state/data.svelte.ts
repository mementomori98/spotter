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
  type ListItemData,
  type ListItemEntity,
  type PhotoEntity,
  type SpotEntity,
  type VisitEntity
} from '@spots/shared';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { newId } from '$lib/util/ids';
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

  listItems(kind: ListItemData['kind']): ListItemEntity[] {
    const out: ListItemEntity[] = [];
    for (const e of this.entities.values()) {
      if (e.type === 'listItem' && !e.deleted && e.data && (e as ListItemEntity).data.kind === kind) {
        out.push(e as ListItemEntity);
      }
    }
    return out.sort((a, b) => a.data.name.localeCompare(b.data.name));
  }

  /**
   * How many live records reference this vocabulary item: spots for species
   * and plants, species for tags.
   */
  itemUsageCount(itemId: string): number {
    const item = this.entities.get(itemId) as ListItemEntity | undefined;
    if (item?.data?.kind === 'tag') {
      return this.listItems('species').filter((sp) => (sp.data.tagIds ?? []).includes(itemId)).length;
    }
    let count = 0;
    for (const s of this.liveSpots()) {
      const h = s.data.habitat;
      if (
        s.data.speciesId === itemId ||
        h.indicatorSpeciesIds.includes(itemId) ||
        h.surroundingPlantIds.includes(itemId) ||
        h.hostTrees.some((t) => t.plantId === itemId)
      ) {
        count++;
      }
    }
    return count;
  }

  /** Case-insensitive, trimmed name lookup within one vocabulary kind. */
  findItemByName(kind: ListItemData['kind'], name: string): ListItemEntity | undefined {
    const needle = name.trim().toLowerCase();
    if (!needle) return undefined;
    return this.listItems(kind).find((i) => i.data.name.trim().toLowerCase() === needle);
  }

  /**
   * Create a vocabulary item — THE anti-duplicate guard: if a name already
   * exists (case-insensitive, trimmed), snap to the existing item instead of
   * ever creating a duplicate. Empty names yield undefined.
   */
  async createListItem(kind: ListItemData['kind'], rawName: string): Promise<ListItemEntity | undefined> {
    const name = rawName.trim();
    if (!name) return undefined;
    const existing = this.findItemByName(kind, name);
    if (existing) return existing;
    return (await this.upsert('listItem', newId(), { kind, name, lastUsedAt: Date.now() })) as ListItemEntity;
  }

  /**
   * Rename a vocabulary item. Reads the LIVE entity by id (not a caller
   * snapshot) so concurrent field edits — e.g. an icon set moments earlier —
   * are never silently dropped.
   */
  async renameListItem(itemId: string, rawName: string): Promise<'ok' | 'duplicate' | 'empty'> {
    const live = this.entities.get(itemId) as ListItemEntity | undefined;
    if (!live?.data || live.deleted) return 'empty';
    const name = rawName.trim();
    if (!name) return 'empty';
    const clash = this.findItemByName(live.data.kind, name);
    if (clash && clash.id !== itemId) return 'duplicate';
    if (live.data.name === name) return 'ok'; // no-op, don't churn sync
    await this.upsert('listItem', itemId, { ...live.data, name });
    return 'ok';
  }

  /**
   * Delete a vocabulary item with a kind-specific client-side cascade (the
   * server is payload-opaque and cannot cascade):
   * - plant:   stripped from every habitat (host trees + surrounding plants);
   *            the spots themselves survive.
   * - species: every spot of that species is fully deleted (visits/photos/
   *            blobs), then indicator references on surviving spots are
   *            stripped.
   * - tag:     stripped from every species carrying it.
   * Cascades run first, the item tombstone last — an interrupted cascade
   * stays retryable because the item is still visible.
   */
  async deleteListItem(itemId: string): Promise<void> {
    const item = this.entities.get(itemId) as ListItemEntity | undefined;
    if (!item?.data || item.deleted) return;
    const kind = item.data.kind;

    if (kind === 'plant') {
      for (const spot of this.liveSpots()) {
        const h = spot.data.habitat;
        const inTrees = h.hostTrees.some((t) => t.plantId === itemId);
        const inSurrounding = h.surroundingPlantIds.includes(itemId);
        if (!inTrees && !inSurrounding) continue;
        await this.upsert('spot', spot.id, {
          ...spot.data,
          habitat: {
            ...h,
            // Remove the whole host-tree entry (incl. its age data).
            hostTrees: h.hostTrees.filter((t) => t.plantId !== itemId),
            surroundingPlantIds: h.surroundingPlantIds.filter((id) => id !== itemId)
          }
        });
      }
    } else if (kind === 'species') {
      for (const spot of this.liveSpots()) {
        if (spot.data.speciesId === itemId) await this.deleteSpot(spot.id);
      }
      // Fresh liveSpots() call: must not resurrect the spots just tombstoned.
      for (const spot of this.liveSpots()) {
        const h = spot.data.habitat;
        if (!h.indicatorSpeciesIds.includes(itemId)) continue;
        await this.upsert('spot', spot.id, {
          ...spot.data,
          habitat: { ...h, indicatorSpeciesIds: h.indicatorSpeciesIds.filter((id) => id !== itemId) }
        });
      }
    } else {
      // tag
      for (const sp of this.listItems('species')) {
        const tagIds = sp.data.tagIds ?? [];
        if (!tagIds.includes(itemId)) continue;
        await this.upsert('listItem', sp.id, { ...sp.data, tagIds: tagIds.filter((id) => id !== itemId) });
      }
    }

    // Read the icon BEFORE tombstoning (tombstones keep data, but be safe).
    const icon = item.data.iconPhotoId;
    await this.tombstone([itemId]);
    if (icon) await this.removePhotos([icon]);
  }

  /**
   * What deleteListItem would touch right now. Informational only — the
   * delete itself recomputes against live data.
   */
  deleteImpact(itemId: string): { spotsDeleted: number; habitatEdits: number; speciesEdited: number } {
    const impact = { spotsDeleted: 0, habitatEdits: 0, speciesEdited: 0 };
    const item = this.entities.get(itemId) as ListItemEntity | undefined;
    if (!item?.data || item.deleted) return impact;
    if (item.data.kind === 'plant') {
      for (const s of this.liveSpots()) {
        const h = s.data.habitat;
        if (h.hostTrees.some((t) => t.plantId === itemId) || h.surroundingPlantIds.includes(itemId)) {
          impact.habitatEdits++;
        }
      }
    } else if (item.data.kind === 'species') {
      for (const s of this.liveSpots()) {
        if (s.data.speciesId === itemId) impact.spotsDeleted++;
        // Other spots referencing it as an indicator (not double-counted).
        else if (s.data.habitat.indicatorSpeciesIds.includes(itemId)) impact.habitatEdits++;
      }
    } else {
      impact.speciesEdited = this.listItems('species').filter((sp) => (sp.data.tagIds ?? []).includes(itemId)).length;
    }
    return impact;
  }

  itemName(id: string | null | undefined): string {
    if (!id) return '';
    const e = this.entities.get(id) as ListItemEntity | undefined;
    return e?.data?.name ?? '';
  }

  /** Species icon (photo entity id), if one is set and still live. */
  itemIconPhotoId(id: string | null | undefined): string | null {
    if (!id) return null;
    const e = this.entities.get(id) as ListItemEntity | undefined;
    if (!e || e.type !== 'listItem' || e.deleted || !e.data) return null;
    const photoId = e.data.iconPhotoId ?? null;
    return photoId && this.getPhoto(photoId) ? photoId : null;
  }
}

export const data = new DataState();
