import { RATINGS, RATING_COLORS, RATING_SIZE, UNRATED_COLOR } from '$lib/util/rating';
import type { LayerSpecification } from 'maplibre-gl';

/**
 * Spot pin layers, styled by rating (color + size).
 *
 * IMPORTANT (regression 2026-07): `['zoom']` may only appear as the input of
 * a TOP-LEVEL `interpolate`/`step` expression. Nesting the zoom interpolate
 * inside `['*', ...]` is invalid — addLayer throws during map load and NO
 * pins render at all. Hence: top-level zoom interpolate whose OUTPUTS are
 * per-feature `match` expressions. Validated by pins.test.ts against the
 * MapLibre style spec so this cannot silently regress again.
 */

const ratingColor = [
  'match',
  ['get', 'rating'],
  ...RATINGS.flatMap((r) => [r, RATING_COLORS[r]]),
  UNRATED_COLOR
] as unknown;

/** Radius at a given base size, scaled per rating (bigger = better spot). */
const scaledRadius = (base: number) =>
  [
    'match',
    ['get', 'rating'],
    ...RATINGS.flatMap((r) => [r, Math.round(base * RATING_SIZE[r] * 100) / 100]),
    base
  ] as unknown;

const zoomRadius = (atZ8: number, atZ16: number) =>
  ['interpolate', ['linear'], ['zoom'], 8, scaledRadius(atZ8), 16, scaledRadius(atZ16)] as unknown;

export const SPOTS_SOURCE_ID = 'spots';

export const spotPinLayers: LayerSpecification[] = [
  {
    id: 'spots-halo',
    type: 'circle',
    source: SPOTS_SOURCE_ID,
    paint: {
      'circle-radius': zoomRadius(10, 16),
      'circle-color': '#ffffff',
      'circle-opacity': 0.9
    }
  },
  {
    id: 'spots-dot',
    type: 'circle',
    source: SPOTS_SOURCE_ID,
    paint: {
      'circle-radius': zoomRadius(7, 12),
      'circle-color': ratingColor,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2
    }
  }
] as LayerSpecification[];

/** Layer ids that should react to taps. */
export const SPOT_TAP_LAYERS = ['spots-dot', 'spots-halo'];
