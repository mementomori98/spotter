<script lang="ts" module>
  import type { Rating } from '$lib/util/rating';

  export interface SpotPin {
    id: string;
    lat: number;
    lng: number;
    /** Spot quality — colors the dot and is shown as a tiny badge under the pin. */
    rating?: Rating | null;
    /** Species icon (photo entity id) — replaces the colored dot when set. */
    iconPhotoId?: string | null;
  }

  export interface ViewState {
    lat: number;
    lng: number;
    zoom: number;
    bbox: [number, number, number, number];
  }
</script>

<script lang="ts">
  import { location } from '$lib/geo/location.svelte';
  import {
    dotKey,
    makeDotMarker,
    makeIconMarker,
    markerKey,
    MARKER_PIXEL_RATIO
  } from '$lib/map/markers';
  import { spotMarkerLayer, SPOT_TAP_LAYERS, SPOTS_SOURCE_ID } from '$lib/map/pins';
  import { buildStyle } from '$lib/map/style';
  import { getPhotoBlobById } from '$lib/photos/photos';
  import { boot } from '$lib/state/boot.svelte';
  import { RATINGS } from '$lib/util/rating';
  import { untrack } from 'svelte';
  import { GeoJSONSource, Map as MlMap, Marker } from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';

  interface Props {
    spots?: SpotPin[];
    satellite?: boolean;
    follow?: boolean;
    interactive?: boolean;
    showUser?: boolean;
    center?: { lat: number; lng: number; zoom?: number } | null;
    marker?: { lat: number; lng: number } | null;
    onTapSpot?: (id: string) => void;
    onMove?: (v: ViewState) => void;
    onUserPan?: () => void;
  }

  let {
    spots = [],
    satellite = false,
    follow = $bindable(false),
    interactive = true,
    showUser = true,
    center = null,
    marker = null,
    onTapSpot = () => {},
    onMove = () => {},
    onUserPan = () => {}
  }: Props = $props();

  let container = $state<HTMLDivElement | null>(null);
  let map: MlMap | null = null;
  let userMarker: Marker | null = null;
  let pinMarker: Marker | null = null;
  let loaded = $state(false);

  const FALLBACK_CENTER = { lat: 47.4979, lng: 19.0402 }; // until first fix

  $effect(() => {
    if (!container) return;
    // untrack: creation-time reads must not recreate the map on change
    // (the satellite toggle & pins have their own fine-grained effects).
    map = untrack(() => {
      const start =
        center ?? (location.hasFix ? { lat: location.lat!, lng: location.lng! } : FALLBACK_CENTER);
      return new MlMap({
        container: container!,
        style: buildStyle(boot.settings, satellite),
        center: [start.lng, start.lat],
        zoom: center?.zoom ?? 14,
        attributionControl: { compact: true },
        interactive,
        dragRotate: false,
        pitchWithRotate: false
      });
    });
    map.touchZoomRotate.disableRotation();

    map.on('load', () => {
      loaded = true;
      registered = new Set();
      map!.addSource(SPOTS_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      // Pre-register every dot marker (5 ratings + unrated) so features can
      // always fall back to a dot even before icons finish loading.
      for (const rating of [null, ...RATINGS]) {
        const key = dotKey(rating);
        map!.addImage(key, makeDotMarker(rating), { pixelRatio: MARKER_PIXEL_RATIO });
        registered.add(key);
      }
      // Single symbol layer; marker bitmaps carry icon + rating badge.
      // Spec validated by pins.test.ts (an invalid layer throws in addLayer
      // and silently kills ALL pins — happened once, never again).
      map!.addLayer(spotMarkerLayer);
      map!.on('click', (e) => {
        const feature = map!.queryRenderedFeatures(e.point, { layers: SPOT_TAP_LAYERS })[0];
        const id = feature?.properties?.id as string | undefined;
        if (id) onTapSpot(id);
      });
      map!.on('mouseenter', spotMarkerLayer.id, () => (map!.getCanvas().style.cursor = 'pointer'));
      map!.on('mouseleave', spotMarkerLayer.id, () => (map!.getCanvas().style.cursor = ''));
      reportView();
    });

    map.on('dragstart', () => {
      follow = false;
      onUserPan();
    });
    map.on('moveend', reportView);

    return () => {
      loaded = false;
      map?.remove();
      map = null;
      userMarker = null;
      pinMarker = null;
    };
  });

  function reportView(): void {
    if (!map) return;
    const c = map.getCenter();
    const b = map.getBounds();
    onMove({
      lat: c.lat,
      lng: c.lng,
      zoom: map.getZoom(),
      bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
    });
  }

  // Satellite toggle without style reload.
  $effect(() => {
    if (!map || !loaded) return;
    map.setLayoutProperty('base', 'visibility', satellite ? 'none' : 'visible');
    map.setLayoutProperty('sat', 'visibility', satellite ? 'visible' : 'none');
  });

  // Spot pins: resolve marker bitmaps (species icons lazily, dots eagerly),
  // then push features. A token guards against out-of-order async updates.
  let registered = new Set<string>();
  let syncToken = 0;

  $effect(() => {
    const list = spots.map((s) => ({ ...s })); // tracks the prop
    if (!map || !loaded) return;
    const token = ++syncToken;
    void syncMarkers(list, token);
  });

  async function syncMarkers(list: SpotPin[], token: number): Promise<void> {
    const features = [];
    for (const s of list) {
      if (token !== syncToken) return; // superseded — stop loading blobs
      let key = dotKey(s.rating ?? null);
      if (s.iconPhotoId) {
        const iconMarker = markerKey(s.iconPhotoId, s.rating ?? null);
        if (!registered.has(iconMarker)) {
          try {
            const blob = await getPhotoBlobById(s.iconPhotoId);
            if (blob && map) {
              const img = await makeIconMarker(blob, s.rating ?? null);
              if (!map.hasImage(iconMarker)) {
                map.addImage(iconMarker, img, { pixelRatio: MARKER_PIXEL_RATIO });
              }
              registered.add(iconMarker);
            }
          } catch {
            /* icon blob unavailable — dot fallback below */
          }
        }
        if (registered.has(iconMarker)) key = iconMarker;
      }
      features.push({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] },
        properties: { id: s.id, marker: key }
      });
    }
    if (token !== syncToken || !map || !loaded) return; // superseded / torn down
    map.getSource<GeoJSONSource>(SPOTS_SOURCE_ID)?.setData({ type: 'FeatureCollection', features });
  }

  // User position + heading cone (like Google Maps).
  $effect(() => {
    if (!map || !showUser || !location.hasFix) return;
    if (!userMarker) {
      const el = document.createElement('div');
      el.className = 'user-marker';
      el.innerHTML = '<div class="cone"></div><div class="dot"></div>';
      userMarker = new Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' })
        .setLngLat([location.lng!, location.lat!])
        .addTo(map);
    }
    userMarker.setLngLat([location.lng!, location.lat!]);
    const cone = userMarker.getElement().querySelector('.cone') as HTMLElement | null;
    if (cone) {
      cone.style.display = location.heading === null ? 'none' : 'block';
      if (location.heading !== null) cone.style.transform = `rotate(${location.heading}deg)`;
    }
    if (follow) {
      map.easeTo({ center: [location.lng!, location.lat!], duration: 400 });
    }
  });

  // Static marker (spot detail mini-map / form pin preview).
  $effect(() => {
    if (!map || !marker) return;
    if (!pinMarker) {
      pinMarker = new Marker({ color: '#c62828' }).setLngLat([marker.lng, marker.lat]).addTo(map);
    } else {
      pinMarker.setLngLat([marker.lng, marker.lat]);
    }
  });

  /** Re-center on the user (locate button). */
  export function locate(): void {
    if (!map || !location.hasFix) return;
    follow = true;
    map.easeTo({ center: [location.lng!, location.lat!], zoom: Math.max(map.getZoom(), 15) });
  }

  export function jumpTo(lat: number, lng: number, zoom?: number): void {
    map?.jumpTo({ center: [lng, lat], zoom: zoom ?? map.getZoom() });
  }
</script>

<div class="map" bind:this={container}></div>

<style>
  .map {
    position: absolute;
    inset: 0;
  }
  :global(.user-marker) {
    position: relative;
    width: 22px;
    height: 22px;
  }
  :global(.user-marker .dot) {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: #1a73e8;
    border: 3px solid #fff;
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.4);
  }
  :global(.user-marker .cone) {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 0;
    height: 0;
    margin: -34px 0 0 -17px;
    border-left: 17px solid transparent;
    border-right: 17px solid transparent;
    border-bottom: 30px solid rgba(26, 115, 232, 0.35);
    transform-origin: 50% 34px;
  }
</style>
