import type { Entity } from '@spots/shared';
import { openDB, type IDBPDatabase } from 'idb';
import type { LocalStore } from './types';

/** Entity + photo storage in IndexedDB (default; Android installed PWA). */
export class IdbStore implements LocalStore {
  readonly kind = 'idb' as const;
  private db: IDBPDatabase | null = null;

  private async open(): Promise<IDBPDatabase> {
    this.db ??= await openDB('spots-data', 1, {
      upgrade(d) {
        d.createObjectStore('entities', { keyPath: 'id' });
        d.createObjectStore('blobs');
      }
    });
    return this.db;
  }

  async loadEntities(): Promise<Entity[]> {
    return (await this.open()).getAll('entities') as Promise<Entity[]>;
  }

  async saveEntities(entities: Entity[]): Promise<void> {
    const tx = (await this.open()).transaction('entities', 'readwrite');
    for (const e of entities) void tx.store.put(snapshotOf(e));
    await tx.done;
  }

  async removeEntities(ids: string[]): Promise<void> {
    const tx = (await this.open()).transaction('entities', 'readwrite');
    for (const id of ids) void tx.store.delete(id);
    await tx.done;
  }

  async putBlob(hash: string, ext: string, blob: Blob): Promise<void> {
    await (await this.open()).put('blobs', { blob, ext }, hash);
  }

  async getBlob(hash: string): Promise<Blob | undefined> {
    const rec = (await (await this.open()).get('blobs', hash)) as { blob: Blob } | undefined;
    return rec?.blob;
  }

  async deleteBlob(hash: string): Promise<void> {
    await (await this.open()).delete('blobs', hash);
  }

  async flush(): Promise<void> {
    /* writes are immediate */
  }
}

/** Strip Svelte proxies before structured clone. */
function snapshotOf<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
