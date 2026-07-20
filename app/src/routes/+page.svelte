<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Icon from '$lib/components/Icon.svelte';
  import MapView, { type ViewState } from '$lib/components/MapView.svelte';
  import RegionDownloadSheet from '$lib/components/RegionDownloadSheet.svelte';
  import Selector from '$lib/components/Selector.svelte';
  import SyncChip from '$lib/components/SyncChip.svelte';
  import { location } from '$lib/geo/location.svelte';
  import { boot } from '$lib/state/boot.svelte';
  import { data } from '$lib/state/data.svelte';
  import { filter } from '$lib/state/filter.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { mapPrefs } from '$lib/state/ui.svelte';

  let follow = $state(true);
  let filterOpen = $state(false);
  let regionOpen = $state(false);
  let view = $state<ViewState | null>(null);
  let mapRef = $state<MapView | null>(null);

  // "View on map" from a spot detail: /?focus=<spotId>
  const focusSpot = $derived.by(() => {
    const id = page.url.searchParams.get('focus');
    return id ? data.getSpot(id) : undefined;
  });
  $effect(() => {
    if (focusSpot && mapRef) {
      follow = false;
      mapRef.jumpTo(focusSpot.data.lat, focusSpot.data.lng, 16);
    }
  });

  const pins = $derived(
    data
      .liveSpots()
      .filter((s) => filter.matches(s.data.speciesId))
      .map((s) => ({
        id: s.id,
        lat: s.data.lat,
        lng: s.data.lng,
        rating: s.data.rating ?? null,
        iconPhotoId: data.itemIconPhotoId(s.data.speciesId)
      }))
  );
  const filterLabel = $derived(
    filter.active
      ? filter.speciesIds.length === 1
        ? data.itemName(filter.speciesIds[0])
        : `${filter.speciesIds.length} species`
      : 'All species'
  );
</script>

<svelte:head><title>Spots — Map</title></svelte:head>

<div class="mapwrap">
  <MapView
    bind:this={mapRef}
    spots={pins}
    satellite={mapPrefs.satellite}
    bind:follow
    center={focusSpot ? { lat: focusSpot.data.lat, lng: focusSpot.data.lng, zoom: 16 } : null}
    onTapSpot={(id) => void goto(`/spot/${id}`)}
    onMove={(v) => (view = v)}
  />

  <div class="top">
    <SyncChip />
    <div class="filterwrap">
      <button class="chip filter" class:active={filter.active} onclick={() => (filterOpen = true)}>
        🍄 {filterLabel}
      </button>
      {#if filter.active}
        <button class="chip clear" aria-label="Show all species" onclick={() => (filter.speciesIds = [])}>
          <Icon name="x" size={16} />
        </button>
      {/if}
    </div>
  </div>

  <div class="stack">
    <button
      class="mapbtn"
      aria-label={mapPrefs.satellite ? 'Map view' : 'Satellite view'}
      onclick={() => mapPrefs.toggle()}
    >
      <Icon name={mapPrefs.satellite ? 'map' : 'globe'} />
      <span class="cap">{mapPrefs.satellite ? 'Map' : 'Sat'}</span>
    </button>
    <button class="mapbtn" aria-label="Download this area for offline" onclick={() => (regionOpen = true)}>
      <Icon name="download" />
      <span class="cap">Offline</span>
    </button>
    <button
      class="mapbtn"
      class:on={follow}
      class:dim={location.error !== null}
      aria-label="My location"
      onclick={() => {
        if (!location.hasFix) {
          toasts.show(location.error ?? 'Waiting for GPS…', { kind: 'warn' });
        } else {
          mapRef?.locate();
        }
      }}
    >
      <Icon name="crosshair" />
      <span class="cap">Me</span>
    </button>
  </div>

  {#if data.ready && data.liveSpots().length === 0}
    <!-- First-run guidance: an empty satellite map explains nothing by itself. -->
    <div class="coach card" role="note">
      🍄 Found a mushroom? Tap <strong>+</strong> to save the spot.<br />
      <span class="note">Works fully offline — everything syncs later.</span>
    </div>
  {/if}

  {#if !boot.readOnly}
    <a class="fab" href="/spot/new" aria-label="Save a new spot">
      <Icon name="plus" size={34} />
    </a>
  {/if}
</div>

<Selector
  bind:open={filterOpen}
  kind="species"
  title="Show species"
  multi
  selected={filter.speciesIds}
  onDone={(ids) => (filter.speciesIds = ids)}
/>
<RegionDownloadSheet bind:open={regionOpen} {view} satellite={mapPrefs.satellite} />

<style>
  .mapwrap {
    position: fixed;
    inset: 0;
    bottom: var(--nav-h);
  }
  .top {
    position: absolute;
    top: calc(8px + env(safe-area-inset-top, 0px));
    left: 8px;
    right: 8px;
    z-index: 10;
    display: flex;
    justify-content: space-between;
    gap: 8px;
    pointer-events: none;
  }
  .top > :global(*) {
    pointer-events: auto;
  }
  .chip.filter {
    box-shadow: var(--shadow);
    border: none;
    font-weight: 700;
    max-width: 55vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stack {
    position: absolute;
    right: 10px;
    bottom: 110px;
    z-index: 10;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .filterwrap {
    display: flex;
    gap: 6px;
    align-items: center;
    min-width: 0;
  }
  .chip.clear {
    box-shadow: var(--shadow);
    border: none;
    background: var(--card);
    min-width: 40px;
    justify-content: center;
    flex-shrink: 0;
  }
  /* Solid opaque backgrounds — readable in direct sunlight. */
  .mapbtn {
    width: var(--tap);
    height: 62px;
    border-radius: 16px;
    border: none;
    background: var(--card);
    color: var(--ink);
    box-shadow: var(--shadow);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    cursor: pointer;
    transition: transform 0.06s ease;
  }
  .mapbtn:active {
    transform: scale(0.95);
  }
  .mapbtn .cap {
    font-size: 10px;
    font-weight: 800;
    color: var(--ink-soft);
    letter-spacing: 0.02em;
  }
  .mapbtn.on {
    color: var(--accent);
  }
  .mapbtn.dim {
    opacity: 0.55;
  }
  .coach {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    bottom: 112px;
    z-index: 10;
    width: max-content;
    max-width: 84vw;
    padding: 12px 18px;
    text-align: center;
    font-size: 16px;
    font-weight: 600;
    pointer-events: none;
  }
  .coach .note {
    font-weight: 400;
  }
  .fab {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    bottom: 24px;
    z-index: 10;
    width: 72px;
    height: 72px;
    border-radius: 50%;
    background: var(--accent);
    border: 3px solid #fff; /* white ring pops on any terrain */
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 16px rgba(120, 40, 10, 0.5);
    text-decoration: none;
  }
  .fab:active {
    transform: translateX(-50%) scale(0.95);
  }
</style>
