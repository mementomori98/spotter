import type { Settings } from '$lib/storage/types';
import type { StyleSpecification } from 'maplibre-gl';

/**
 * Raster style with both layers present; the satellite toggle flips layer
 * visibility (no style reload, instant). Tile URLs are user-configurable.
 */
export function buildStyle(settings: Settings, satellite: boolean): StyleSpecification {
  return {
    version: 8,
    sources: {
      base: {
        type: 'raster',
        tiles: [settings.baseTileUrl],
        tileSize: 256,
        maxzoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      },
      sat: {
        type: 'raster',
        tiles: [settings.satTileUrl],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Imagery &copy; Esri'
      }
    },
    layers: [
      {
        id: 'base',
        type: 'raster',
        source: 'base',
        layout: { visibility: satellite ? 'none' : 'visible' }
      },
      {
        id: 'sat',
        type: 'raster',
        source: 'sat',
        layout: { visibility: satellite ? 'visible' : 'none' }
      }
    ]
  };
}
