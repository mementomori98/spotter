<script lang="ts">
  import { goto } from '$app/navigation';
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
  import { mapPrefs, mapSession } from '$lib/state/ui.svelte';

  let filterOpen = $state(false);
  let tagFilterOpen = $state(false);
  let regionOpen = $state(false);
  // Full ViewState (incl. bbox) stays local for RegionDownloadSheet; the
  // camera part is mirrored into mapSession so it survives route remounts.
  let view = $state<ViewState | null>(null);
  let mapRef = $state<MapView | null>(null);

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
    filter.speciesIds.length > 0
      ? filter.speciesIds.length === 1
        ? data.itemName(filter.speciesIds[0])
        : `${filter.speciesIds.length} species`
      : 'All species'
  );
  // Tag chip only exists once the user has created tags — zero UI cost before.
  const hasTags = $derived(data.listItems('tag').length > 0);
  const tagLabel = $derived(
    filter.tagIds.length > 0
      ? filter.tagIds.length === 1
        ? data.itemName(filter.tagIds[0])
        : `${filter.tagIds.length} tags`
      : 'All tags'
  );
</script>

<svelte:head><title>Spots — Map</title></svelte:head>

<div class="mapwrap">
  <MapView
    bind:this={mapRef}
    spots={pins}
    satellite={mapPrefs.satellite}
    bind:follow={mapSession.follow}
    center={mapSession.view}
    onTapSpot={(id) => void goto(`/spot/${id}`)}
    onMove={(v) => {
      view = v;
      mapSession.view = { lat: v.lat, lng: v.lng, zoom: v.zoom };
    }}
  />

  <div class="top">
    <SyncChip />
    <div class="filterwrap" class:two={hasTags}>
      <button class="chip filter" class:active={filter.speciesIds.length > 0} onclick={() => (filterOpen = true)}>
        🍄 {filterLabel}
      </button>
      {#if hasTags}
        <button class="chip filter" class:active={filter.tagIds.length > 0} onclick={() => (tagFilterOpen = true)}>
          🏷 {tagLabel}
        </button>
      {/if}
      {#if filter.active}
        <button class="chip clear" aria-label="Clear filters" onclick={() => filter.clear()}>
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
      class:on={mapSession.follow}
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
<Selector
  bind:open={tagFilterOpen}
  kind="tag"
  title="Show tags"
  multi
  selected={filter.tagIds}
  onDone={(ids) => (filter.tagIds = ids)}
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
  /* Two chips + clear must still fit next to the sync chip on a phone. */
  .filterwrap.two .chip.filter {
    max-width: 38vw;
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
    background: var(--accent-soft);
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
    box-shadow: 0 4px 16px rgba(20, 30, 20, 0.5);
    text-decoration: none;
  }
  .fab:active {
    transform: translateX(-50%) scale(0.95);
  }
</style>
