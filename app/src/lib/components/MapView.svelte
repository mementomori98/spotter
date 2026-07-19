<script lang="ts" module>
  import type { Rating } from '$lib/util/rating';

  export interface SpotPin {
    id: string;
    lat: number;
    lng: number;
    /** Spot quality — drives pin color and size (gold + biggest = best). */
    rating?: Rating | null;
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
  import { spotPinLayers, SPOT_TAP_LAYERS, SPOTS_SOURCE_ID } from '$lib/map/pins';
  import { buildStyle } from '$lib/map/style';
  import { boot } from '$lib/state/boot.svelte';
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
      map!.addSource(SPOTS_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      // Circles instead of symbols: no glyph server needed => fully offline.
      // Layer specs live in lib/map/pins.ts and are validated against the
      // MapLibre style spec by a unit test (an invalid expression here
      // throws and silently kills ALL pins — happened once, never again).
      for (const layer of spotPinLayers) map!.addLayer(layer);
      // Single click handler across both pin layers — per-layer handlers
      // would fire twice when a tap hits the dot AND its halo.
      map!.on('click', (e) => {
        const feature = map!.queryRenderedFeatures(e.point, { layers: SPOT_TAP_LAYERS })[0];
        const id = feature?.properties?.id as string | undefined;
        if (id) onTapSpot(id);
      });
      map!.on('mouseenter', 'spots-dot', () => (map!.getCanvas().style.cursor = 'pointer'));
      map!.on('mouseleave', 'spots-dot', () => (map!.getCanvas().style.cursor = ''));
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

  // Spot pins.
  $effect(() => {
    if (!map || !loaded) return;
    const source = map.getSource<GeoJSONSource>(SPOTS_SOURCE_ID);
    source?.setData({
      type: 'FeatureCollection',
      features: spots.map((s) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
        properties: { id: s.id, rating: s.rating ?? '' }
      }))
    });
  });

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
