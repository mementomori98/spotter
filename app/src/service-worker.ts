/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const APP_CACHE = `app-${version}`;
const BROWSE_TILES = 'tiles-browse';
const REGION_PREFIX = 'tiles-region-'; // page-side downloads write these caches
const BROWSE_TILE_CAP = 2000;
const BROWSE_TRIM_BATCH = 200;

// Full precache: every code-split chunk + static file + the SPA shell.
// Navigating to any route weeks later, fully offline, must never 404.
const PRECACHE = [...new Set([...build, ...files, '/'])];

const DEFAULT_TILE_PREFIXES = [
  'https://tile.openstreetmap.org/',
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/'
];

sw.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.addAll(PRECACHE)));
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Delete ONLY old app-shell caches — never tile caches.
      for (const name of await caches.keys()) {
        if (name.startsWith('app-') && name !== APP_CACHE) await caches.delete(name);
      }
      await sw.clients.claim();
    })()
  );
});

// Update lifecycle: the page shows an "Update available" toast and posts
// SKIP_WAITING on user tap. Never auto-skipWaiting (breaks lazy chunks).
sw.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') void sw.skipWaiting();
});

sw.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // API is always network-only (sync correctness).
  if (url.origin === sw.location.origin && url.pathname.startsWith('/api/')) return;

  // Map tiles: cache-first across ALL tile caches (browse + downloaded regions).
  if (isTileUrl(req.url)) {
    event.respondWith(tileStrategy(req));
    return;
  }

  if (url.origin === sw.location.origin) {
    // SPA navigations get the cached shell instantly (offline-first).
    if (req.mode === 'navigate') {
      event.respondWith(cacheFirst('/', req));
      return;
    }
    event.respondWith(cacheFirst(req.url, req));
  }
});

async function cacheFirst(cacheKey: string, req: Request): Promise<Response> {
  const cached = await caches.match(cacheKey);
  if (cached) return cached;
  return fetch(req);
}

/* ------------------------------- tiles ---------------------------------- */

let tilePrefixes: string[] = DEFAULT_TILE_PREFIXES;
void loadTilePrefixes();

function isTileUrl(url: string): boolean {
  return tilePrefixes.some((p) => p && url.startsWith(p));
}

async function tileStrategy(req: Request): Promise<Response> {
  const cached = await caches.match(req.url, { ignoreVary: true });
  if (cached) {
    touchTile(req.url);
    return cached;
  }
  try {
    const res = await fetch(req);
    // Never cache opaque responses: Chrome pads them ~7 MB each in Cache
    // Storage (quota bomb). CORS tiles only.
    if (res.ok && res.type !== 'opaque') {
      const cache = await caches.open(BROWSE_TILES);
      await cache.put(req.url, res.clone());
      touchTile(req.url);
      void trimBrowseTiles();
    }
    return res;
  } catch {
    return new Response('', { status: 504, statusText: 'offline, tile not cached' });
  }
}

/* LRU bookkeeping for the auto-browse tile cache (Cache API has no LRU).
   Access times live in a small IDB store inside the SW. */

function tileDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('spots-sw', 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore('tileAccess');
      open.result.createObjectStore('kv');
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

function touchTile(url: string): void {
  void tileDb().then((db) => {
    db.transaction('tileAccess', 'readwrite').objectStore('tileAccess').put(Date.now(), url);
  });
}

let trimming = false;
async function trimBrowseTiles(): Promise<void> {
  if (trimming) return;
  trimming = true;
  try {
    const cache = await caches.open(BROWSE_TILES);
    const keys = await cache.keys();
    if (keys.length <= BROWSE_TILE_CAP) return;
    const db = await tileDb();
    const access = await new Promise<Map<string, number>>((resolve) => {
      const map = new Map<string, number>();
      const store = db.transaction('tileAccess').objectStore('tileAccess');
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          map.set(String(cursor.key), cursor.value as number);
          cursor.continue();
        } else {
          resolve(map);
        }
      };
      cursorReq.onerror = () => resolve(map);
    });
    const sorted = keys
      .map((k) => ({ url: k.url, at: access.get(k.url) ?? 0 }))
      .sort((a, b) => a.at - b.at)
      .slice(0, BROWSE_TRIM_BATCH);
    const tx = db.transaction('tileAccess', 'readwrite').objectStore('tileAccess');
    for (const { url } of sorted) {
      await cache.delete(url);
      tx.delete(url);
    }
  } finally {
    trimming = false;
  }
}

/** Tile URL prefixes are user-configurable; the page writes them to spots-meta. */
async function loadTilePrefixes(): Promise<void> {
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('spots-meta', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('kv');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const prefixes = await new Promise<string[] | undefined>((resolve) => {
      const get = db.transaction('kv').objectStore('kv').get('tilePrefixes');
      get.onsuccess = () => resolve(get.result as string[] | undefined);
      get.onerror = () => resolve(undefined);
    });
    if (prefixes?.length) tilePrefixes = [...new Set([...prefixes, ...DEFAULT_TILE_PREFIXES])];
  } catch {
    /* defaults stay */
  }
}

// Re-read configurable prefixes when the page says they changed.
sw.addEventListener('message', (event) => {
  if (event.data === 'TILE_PREFIXES_CHANGED') void loadTilePrefixes();
});
