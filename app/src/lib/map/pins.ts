import type { LayerSpecification } from 'maplibre-gl';
import { CIRCLE_CENTER_Y } from './markers';

/**
 * Spot pins are a single symbol layer whose images are canvas-generated
 * markers (species icon or colored dot + baked-in rating badge — see
 * markers.ts). No glyph server, no remote sprites: fully offline.
 *
 * Validated against the MapLibre style spec by pins.test.ts (a regression
 * once shipped an invalid paint expression that threw in addLayer and
 * silently killed every pin — never again).
 */

export const SPOTS_SOURCE_ID = 'spots';
export const SPOT_MARKER_LAYER_ID = 'spots-markers';

export const spotMarkerLayer: LayerSpecification = {
  id: SPOT_MARKER_LAYER_ID,
  type: 'symbol',
  source: SPOTS_SOURCE_ID,
  layout: {
    'icon-image': ['get', 'marker'],
    // Uniform scale keeps the anchor math consistent at every zoom.
    'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.62, 16, 1],
    // Markers must never disappear due to collision — they ARE the data.
    'icon-allow-overlap': true,
    'icon-ignore-placement': true,
    // Anchor at the bitmap top, shifted so the dot/icon CENTER sits exactly
    // on the coordinate; the rating badge hangs below the point.
    'icon-anchor': 'top',
    'icon-offset': [0, -CIRCLE_CENTER_Y]
  }
} as LayerSpecification;

/** Layers that respond to taps. */
export const SPOT_TAP_LAYERS = [SPOT_MARKER_LAYER_ID];
