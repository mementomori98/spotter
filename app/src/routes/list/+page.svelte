<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import PhotoImg from '$lib/components/PhotoImg.svelte';
  import Selector from '$lib/components/Selector.svelte';
  import SyncChip from '$lib/components/SyncChip.svelte';
  import { location } from '$lib/geo/location.svelte';
  import { data } from '$lib/state/data.svelte';
  import { filter } from '$lib/state/filter.svelte';
  import { fmtDate, fmtDistance } from '$lib/util/format';
  import { haversine } from '$lib/util/geo';
  import { RATING_COLORS } from '$lib/util/rating';

  let query = $state('');
  let filterOpen = $state(false);
  let tagFilterOpen = $state(false);

  const q = $derived(query.trim().toLowerCase());
  const entries = $derived(
    data
      .liveSpots()
      .filter((s) => filter.matches(s.data.speciesId))
      .filter((s) => {
        if (!q) return true;
        // Search covers species name and notes (spots.md).
        return (
          data.itemName(s.data.speciesId).toLowerCase().includes(q) ||
          s.data.notes.toLowerCase().includes(q) ||
          s.data.habitat.habitatNotes.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.data.foundAt - a.data.foundAt)
  );

  const filterLabel = $derived(filter.speciesIds.length > 0 ? `${filter.speciesIds.length} ✓` : 'All');
  // Tag chip only exists once the user has created tags (mirrors the map).
  const hasTags = $derived(data.listItems('tag').length > 0);
  const tagLabel = $derived(filter.tagIds.length > 0 ? `${filter.tagIds.length} ✓` : 'All');

  function distanceTo(lat: number, lng: number): string | null {
    if (!location.hasFix) return null;
    return fmtDistance(haversine(location.lat!, location.lng!, lat, lng));
  }
</script>

<svelte:head><title>Spots — List</title></svelte:head>

<div class="page">
  <div class="topbar">
    <h1>My spots</h1>
    <SyncChip />
  </div>

  <div class="controls">
    <div class="searchbox">
      <Icon name="search" size={20} />
      <input class="input" placeholder="Search species or notes…" bind:value={query} />
    </div>
    <button class="chip" class:active={filter.speciesIds.length > 0} onclick={() => (filterOpen = true)}>
      🍄 {filterLabel}
    </button>
    {#if hasTags}
      <button class="chip" class:active={filter.tagIds.length > 0} onclick={() => (tagFilterOpen = true)}>
        🏷 {tagLabel}
      </button>
    {/if}
    {#if filter.active}
      <button class="chip" aria-label="Clear filters" onclick={() => filter.clear()}>
        <Icon name="x" size={16} />
      </button>
    {/if}
  </div>

  {#if entries.length === 0}
    <div class="empty">
      <div class="big">🍄</div>
      {#if data.liveSpots().length === 0}
        <p>No spots yet. Find a mushroom, tap <strong>+</strong> on the map, done.</p>
        <a class="btn" href="/spot/new">Save your first spot</a>
      {:else}
        <p>Nothing matches your search.</p>
      {/if}
    </div>
  {/if}

  {#each entries as spot (spot.id)}
    {@const dist = distanceTo(spot.data.lat, spot.data.lng)}
    {@const visits = data.visitsOf(spot.id)}
    <a class="entry card" href={`/spot/${spot.id}`}>
      <div class="thumb">
        {#if spot.data.photoIds.length > 0}
          <PhotoImg photoId={spot.data.photoIds[0]} alt={data.itemName(spot.data.speciesId)} />
        {:else}
          <div class="nothumb">🍄</div>
        {/if}
      </div>
      <div class="meta">
        <strong>
          {data.itemName(spot.data.speciesId) || 'Unknown species'}
          {#if spot.data.rating}
            <span class="rating" style:background={RATING_COLORS[spot.data.rating]}>{spot.data.rating}</span>
          {/if}
        </strong>
        <span class="sub">{fmtDate(spot.data.foundAt)}{visits.length ? ` · ${visits.length} visit${visits.length > 1 ? 's' : ''}` : ''}</span>
        {#if spot.data.notes}<span class="sub notes">{spot.data.notes}</span>{/if}
      </div>
      {#if dist}<span class="dist">{dist}</span>{/if}
    </a>
  {/each}
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

<style>
  .controls {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-bottom: 16px;
  }
  .searchbox {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--ink-soft);
  }
  .entry {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px;
    margin-bottom: 12px;
    text-decoration: none;
    color: inherit;
    transition: transform 0.06s ease;
  }
  .entry:active {
    transform: scale(0.99);
  }
  .thumb {
    width: 72px;
    height: 72px;
    flex-shrink: 0;
  }
  .nothumb {
    width: 100%;
    height: 100%;
    border-radius: 10px;
    background: var(--green-soft);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 30px;
  }
  .meta {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .meta strong {
    font-size: 18px;
  }
  .rating {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 8px;
    border-radius: 999px;
    color: #fff;
    font-size: 13px;
    font-weight: 800;
    vertical-align: 2px;
  }
  .sub {
    color: var(--ink-soft);
    font-size: 14px;
  }
  .sub.notes {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dist {
    font-weight: 800;
    color: var(--green-dark);
    font-size: 15px;
    flex-shrink: 0;
  }
</style>
