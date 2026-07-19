<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Icon from '$lib/components/Icon.svelte';
  import MapView, { type ViewState } from '$lib/components/MapView.svelte';
  import RegionDownloadSheet from '$lib/components/RegionDownloadSheet.svelte';
  import Selector from '$lib/components/Selector.svelte';
  import SyncChip from '$lib/components/SyncChip.svelte';
  import { boot } from '$lib/state/boot.svelte';
  import { data } from '$lib/state/data.svelte';
  import { filter } from '$lib/state/filter.svelte';
  import { RATINGS, RATING_COLORS, RATING_SIZE, UNRATED_COLOR } from '$lib/util/rating';

  let satellite = $state(false);
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
      .map((s) => ({ id: s.id, lat: s.data.lat, lng: s.data.lng, rating: s.data.rating ?? null }))
  );
  const anyRated = $derived(pins.some((p) => p.rating));

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
    {satellite}
    bind:follow
    center={focusSpot ? { lat: focusSpot.data.lat, lng: focusSpot.data.lng, zoom: 16 } : null}
    onTapSpot={(id) => void goto(`/spot/${id}`)}
    onMove={(v) => (view = v)}
  />

  <div class="top">
    <SyncChip />
    <button class="chip filter" class:active={filter.active} onclick={() => (filterOpen = true)}>
      🍄 {filterLabel}
    </button>
  </div>

  <div class="stack">
    <button class="mapbtn" aria-label={satellite ? 'Map view' : 'Satellite view'} onclick={() => (satellite = !satellite)}>
      <Icon name={satellite ? 'map' : 'globe'} />
    </button>
    <button class="mapbtn" aria-label="Download this area for offline" onclick={() => (regionOpen = true)}>
      <Icon name="download" />
    </button>
    <button class="mapbtn" class:on={follow} aria-label="My location" onclick={() => mapRef?.locate()}>
      <Icon name="crosshair" />
    </button>
  </div>

  {#if anyRated}
    <!-- Rating legend: same colors/sizes as the pins (incl. unrated red). -->
    <div class="legend" aria-label="Rating legend">
      <span class="l-item" title="Not rated yet">
        <span class="l-dot" style:background={UNRATED_COLOR} style:width="14px" style:height="14px"></span>
        ?
      </span>
      {#each RATINGS as r (r)}
        <span class="l-item">
          <span
            class="l-dot"
            style:background={RATING_COLORS[r]}
            style:width={`${8 + RATING_SIZE[r] * 6}px`}
            style:height={`${8 + RATING_SIZE[r] * 6}px`}
          ></span>
          {r}
        </span>
      {/each}
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
<RegionDownloadSheet bind:open={regionOpen} {view} {satellite} />

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
  /* Solid opaque backgrounds — readable in direct sunlight. */
  .mapbtn {
    width: var(--tap);
    height: var(--tap);
    border-radius: 16px;
    border: none;
    background: var(--card);
    color: var(--ink);
    box-shadow: var(--shadow);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .mapbtn.on {
    color: #1a73e8;
  }
  .legend {
    position: absolute;
    left: 10px;
    bottom: 112px; /* above the FAB band, clear of attribution & side stack */
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--card);
    border-radius: 999px;
    padding: 5px 10px;
    box-shadow: var(--shadow);
    font-size: 11px;
    font-weight: 800;
    color: var(--ink-soft);
  }
  .l-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .l-dot {
    border-radius: 50%;
    border: 1.5px solid #fff;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.15);
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
    background: var(--green);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 16px rgba(27, 94, 32, 0.45);
    text-decoration: none;
  }
  .fab:active {
    transform: translateX(-50%) scale(0.95);
  }
</style>
