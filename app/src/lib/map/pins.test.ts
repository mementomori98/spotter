import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { SPOTS_SOURCE_ID, spotPinLayers } from './pins';

/**
 * Regression guard: an invalid paint expression (e.g. `['zoom']` nested
 * outside a top-level interpolate) makes addLayer THROW at runtime, which
 * silently kills all spot pins. Validate the real layer specs against the
 * MapLibre style spec at test time instead of discovering it in the forest.
 */
describe('spot pin layers', () => {
  it('are valid per the MapLibre style specification', () => {
    const style = {
      version: 8 as const,
      sources: {
        [SPOTS_SOURCE_ID]: {
          type: 'geojson' as const,
          data: { type: 'FeatureCollection' as const, features: [] }
        }
      },
      layers: spotPinLayers
    };
    const errors = validateStyleMin(style as never);
    expect(errors.map((e) => e.message)).toEqual([]);
  });

  it('cover halo and dot with rating-driven styling', () => {
    expect(spotPinLayers.map((l) => l.id)).toEqual(['spots-halo', 'spots-dot']);
    const dot = spotPinLayers[1] as { paint: Record<string, unknown> };
    expect(JSON.stringify(dot.paint['circle-color'])).toContain('+++');
    expect(JSON.stringify(dot.paint['circle-radius'])).toContain('zoom');
  });
});
