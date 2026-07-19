import { getMeta, setMeta } from '$lib/storage/meta';
import { tileUrl, tilesForBbox, type TileRange } from '$lib/util/geo';
import { newId } from '$lib/util/ids';

/**
 * Offline region downloads: explicit prefetch of a map area for a planned
 * trip. Tiles go into a dedicated, uncapped cache per region
 * (`tiles-region-<id>`); the service worker's cache-first lookup matches
 * across all caches. Browsed-tile auto-caching is separate and LRU-capped.
 */

export interface OfflineRegion {
  id: string;
  name: string;
  createdAt: number;
  bbox: [number, number, number, number]; // west, south, east, north
  zMin: number;
  zMax: number;
  layer: 'base' | 'sat';
  tileCount: number;
  sizeBytes: number;
}

export const MAX_REGION_TILES = 10_000;
/** Rough averages for the size estimate shown before download. */
export const EST_TILE_BYTES = { base: 25_000, sat: 40_000 };

export async function listRegions(): Promise<OfflineRegion[]> {
  return (await getMeta<OfflineRegion[]>('regions')) ?? [];
}

async function saveRegions(regions: OfflineRegion[]): Promise<void> {
  await setMeta('regions', regions);
}

export function estimateRegion(
  bbox: [number, number, number, number],
  zMin: number,
  zMax: number,
  layer: 'base' | 'sat'
): { ranges: TileRange[]; count: number; bytes: number } {
  const ranges = tilesForBbox(bbox[0], bbox[1], bbox[2], bbox[3], zMin, zMax);
  const count = ranges.reduce((sum, r) => sum + r.count, 0);
  return { ranges, count, bytes: count * EST_TILE_BYTES[layer] };
}

export async function downloadRegion(
  opts: {
    name: string;
    bbox: [number, number, number, number];
    zMin: number;
    zMax: number;
    layer: 'base' | 'sat';
    template: string;
  },
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal
): Promise<OfflineRegion | null> {
  const { ranges, count } = estimateRegion(opts.bbox, opts.zMin, opts.zMax, opts.layer);
  const id = newId();
  const cache = await caches.open(`tiles-region-${id}`);
  let done = 0;
  let bytes = 0;

  const urls: string[] = [];
  for (const r of ranges) {
    for (let x = r.x1; x <= r.x2; x++) {
      for (let y = r.y1; y <= r.y2; y++) {
        urls.push(tileUrl(opts.template, r.z, x, y));
      }
    }
  }

  const CONCURRENCY = 4;
  let index = 0;
  let aborted = false;
  let stored = 0;
  const browse = await caches.open('tiles-browse');
  const worker = async () => {
    while (index < urls.length && !aborted) {
      const url = urls[index++]!;
      if (signal.aborted) {
        aborted = true;
        return;
      }
      try {
        // Resumable for free: cache-first re-run skips completed tiles.
        const cached = await cache.match(url);
        if (!cached) {
          const res = await fetch(url, { signal });
          if (res.ok && res.type !== 'opaque') {
            bytes += Number(res.headers.get('content-length') ?? EST_TILE_BYTES[opts.layer]);
            await cache.put(url, res);
            stored++;
            // The SW's browse cache also captured this fetch — drop that
            // duplicate so region downloads don't churn the LRU cap.
            void browse.delete(url);
          }
        } else {
          stored++;
        }
      } catch {
        if (signal.aborted) {
          aborted = true;
          return;
        }
        // individual tile failures are skipped
      }
      onProgress(++done, count);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (aborted) {
    await caches.delete(`tiles-region-${id}`);
    return null;
  }
  if (stored === 0 && count > 0) {
    // Typically a tile provider without CORS headers — nothing is cacheable.
    await caches.delete(`tiles-region-${id}`);
    throw new Error('No tiles could be saved — this tile provider does not allow offline caching (no CORS).');
  }
  const region: OfflineRegion = {
    id,
    name: opts.name,
    createdAt: Date.now(),
    bbox: opts.bbox,
    zMin: opts.zMin,
    zMax: opts.zMax,
    layer: opts.layer,
    tileCount: count,
    sizeBytes: bytes
  };
  await saveRegions([...(await listRegions()), region]);
  return region;
}

export async function deleteRegion(id: string): Promise<void> {
  await caches.delete(`tiles-region-${id}`);
  await saveRegions((await listRegions()).filter((r) => r.id !== id));
}
