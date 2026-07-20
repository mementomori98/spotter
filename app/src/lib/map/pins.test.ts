import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { SPOTS_SOURCE_ID, SPOT_TAP_LAYERS, spotMarkerLayer } from './pins';

/**
 * Regression guard: an invalid layer spec makes addLayer THROW at runtime,
 * which silently kills all spot pins (happened once with a paint
 * expression). Validate the real layer spec against the MapLibre style
 * spec at test time instead of discovering it in the forest.
 */
describe('spot marker layer', () => {
  it('is valid per the MapLibre style specification', () => {
    const style = {
      version: 8 as const,
      sources: {
        [SPOTS_SOURCE_ID]: {
          type: 'geojson' as const,
          data: { type: 'FeatureCollection' as const, features: [] }
        }
      },
      layers: [spotMarkerLayer]
    };
    const errors = validateStyleMin(style as never);
    expect(errors.map((e) => e.message)).toEqual([]);
  });

  it('uses data-driven marker images, never collides away, and is tappable', () => {
    const layout = (spotMarkerLayer as { layout: Record<string, unknown> }).layout;
    expect(layout['icon-image']).toEqual(['get', 'marker']);
    expect(layout['icon-allow-overlap']).toBe(true);
    expect(SPOT_TAP_LAYERS).toContain(spotMarkerLayer.id);
    // No text-field: rating text is baked into the bitmap (no glyph server
    // needed => offline-safe). If someone adds text-field, they must ship
    // glyphs with the app or offline mode breaks.
    expect(layout['text-field']).toBeUndefined();
  });
});
