/** Great-circle distance in meters. */
export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* Slippy-map tile math (for offline region downloads). */

export function lngToTileX(lng: number, z: number): number {
  return Math.floor(((lng + 180) / 360) * 2 ** z);
}

export function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
}

export interface TileRange {
  z: number;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  count: number;
}

/** Tiles covering a bbox for each zoom in [zMin, zMax]. */
export function tilesForBbox(
  west: number,
  south: number,
  east: number,
  north: number,
  zMin: number,
  zMax: number
): TileRange[] {
  const ranges: TileRange[] = [];
  for (let z = zMin; z <= zMax; z++) {
    const max = 2 ** z - 1;
    const clamp = (v: number) => Math.max(0, Math.min(max, v));
    const x1 = clamp(lngToTileX(west, z));
    const x2 = clamp(lngToTileX(east, z));
    const y1 = clamp(latToTileY(north, z));
    const y2 = clamp(latToTileY(south, z));
    ranges.push({ z, x1, x2, y1, y2, count: (x2 - x1 + 1) * (y2 - y1 + 1) });
  }
  return ranges;
}

export function tileUrl(template: string, z: number, x: number, y: number): string {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}
