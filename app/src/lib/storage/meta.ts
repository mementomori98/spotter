import { openDB, type IDBPDatabase } from 'idb';

/**
 * Small key-value metadata, always in IndexedDB regardless of the entity
 * storage backend: session, sync cursor, dirty/pending sets, drafts,
 * settings, and the FS directory handle (handles are only storable in IDB).
 */

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB('spots-meta', 1, {
    upgrade(d) {
      d.createObjectStore('kv');
    }
  });
  return dbPromise;
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db()).get('kv', key) as Promise<T | undefined>;
}

export async function setMeta<T>(key: string, value: T): Promise<void> {
  await (await db()).put('kv', value, key);
}

export async function delMeta(key: string): Promise<void> {
  await (await db()).delete('kv', key);
}
