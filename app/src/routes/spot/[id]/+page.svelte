<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import MapView from '$lib/components/MapView.svelte';
  import PhotoImg from '$lib/components/PhotoImg.svelte';
  import VisitSheet from '$lib/components/VisitSheet.svelte';
  import { boot } from '$lib/state/boot.svelte';
  import { data } from '$lib/state/data.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { mapPrefs } from '$lib/state/ui.svelte';
  import RatingPicker from '$lib/components/RatingPicker.svelte';
  import { newId } from '$lib/util/ids';
  import { fmtDate, fmtDateTime } from '$lib/util/format';
  import { fade } from 'svelte/transition';
  import type { Rating, VisitEntity, VisitOutcome } from '@spots/shared';

  const spot = $derived(data.getSpot(page.params.id!));
  const visits = $derived(spot ? data.visitsOf(spot.id) : []);

  let confirmDelete = $state(false);
  let visitSheetOpen = $state(false);
  let editingVisit = $state<VisitEntity | null>(null);
  let viewerPhotoId = $state<string | null>(null);

  const OUTCOMES: { value: VisitOutcome; label: string; emoji: string }[] = [
    { value: 'found', label: 'Found', emoji: '🍄' },
    { value: 'harvested', label: 'Harvested', emoji: '🧺' },
    { value: 'nothing', label: 'Nothing', emoji: '∅' }
  ];
  const outcomeMeta = (o: VisitOutcome) => OUTCOMES.find((x) => x.value === o)!;

  /**
   * One-tap visit logging: tapping an outcome saves IMMEDIATELY (now) with
   * an Undo + "Add details" toast — the 90% case needs zero extra input.
   */
  async function quickLogVisit(outcome: VisitOutcome): Promise<void> {
    if (!spot) return;
    const id = newId();
    await data.upsert('visit', id, { spotId: spot.id, at: Date.now(), outcome, note: '', photoIds: [] });
    toasts.show(`Visit logged: ${outcomeMeta(outcome).emoji} ${outcomeMeta(outcome).label}`, {
      actions: [
        { label: 'Undo', fn: () => void data.deleteVisit(id) },
        {
          label: 'Add details',
          fn: () => {
            editingVisit = data.entities.get(id) as VisitEntity;
            visitSheetOpen = true;
          }
        }
      ],
      timeout: 6000
    });
  }

  /** One-tap rating straight from the detail view (tap again to clear). */
  async function setRating(r: Rating | null): Promise<void> {
    if (!spot || boot.readOnly) return;
    const { rating: _drop, ...rest } = spot.data;
    await data.upsert('spot', spot.id, r ? { ...rest, rating: r } : rest);
  }

  async function deleteSpot(): Promise<void> {
    if (!spot) return;
    await data.deleteSpot(spot.id);
    toasts.show('Spot deleted.');
    await goto('/', { replaceState: true });
  }

  function navigateTo(): void {
    if (!spot) return;
    // geo: opens the native maps app on Android; web fallback for desktop.
    const { lat, lng } = spot.data;
    const geo = `geo:${lat},${lng}?q=${lat},${lng}(Spot)`;
    const web = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    window.location.href = /android/i.test(navigator.userAgent) ? geo : web;
  }
</script>

<svelte:head><title>Spots — {spot ? data.itemName(spot.data.speciesId) : 'Spot'}</title></svelte:head>

{#if !spot}
  <div class="page">
    <div class="empty">
      <div class="big">🤷</div>
      <p>This spot doesn't exist (it may have been deleted).</p>
      <a class="btn" href="/">Back to map</a>
    </div>
  </div>
{:else}
  <div class="sheet-page">
    <div class="topbar">
      <button class="iconbtn" aria-label="Back" onclick={() => history.back()}><Icon name="back" /></button>
      <h1>{data.itemName(spot.data.speciesId) || 'Unknown species'}</h1>
      <a class="iconbtn" aria-label="Edit spot" href={`/spot/${spot.id}/edit`}><Icon name="edit" /></a>
    </div>

    <p class="when"><Icon name="clock" size={16} /> Found {fmtDateTime(spot.data.foundAt)}</p>

    <div class="ratingrow">
      <RatingPicker
        compact
        disabled={boot.readOnly}
        value={spot.data.rating ?? null}
        onChange={(r) => void setRating(r)}
      />
    </div>

    {#if spot.data.photoIds.length > 0}
      <div class="strip">
        {#each spot.data.photoIds as pid (pid)}
          <button class="photo" onclick={() => (viewerPhotoId = pid)}>
            <PhotoImg photoId={pid} alt="Mushroom photo" />
          </button>
        {/each}
      </div>
    {/if}

    {#if spot.data.notes}
      <p class="notes">{spot.data.notes}</p>
    {/if}

    <!-- Log a return visit: the most common field action, so it's huge and instant. -->
    <div class="card visitlog">
      <p class="label">I'm here again — today I…</p>
      <div class="outcomes">
        {#each OUTCOMES as o (o.value)}
          <button class="outcome" disabled={boot.readOnly} onclick={() => void quickLogVisit(o.value)}>
            <span class="emoji">{o.emoji}</span>{o.label}
          </button>
        {/each}
      </div>
    </div>

    {#if visits.length > 0}
      <h2>Visit history</h2>
      <div class="timeline">
        {#each visits as visit (visit.id)}
          {@const meta = outcomeMeta(visit.data.outcome)}
          <button
            class="visit card"
            onclick={() => {
              editingVisit = visit;
              visitSheetOpen = true;
            }}
          >
            <span class="v-emoji">{meta.emoji}</span>
            <span class="v-meta">
              <strong>{meta.label}</strong>
              <span class="sub">{fmtDate(visit.data.at)}</span>
              {#if visit.data.note}<span class="sub">{visit.data.note}</span>{/if}
            </span>
            {#if visit.data.photoIds.length > 0}
              <span class="v-thumb"><PhotoImg photoId={visit.data.photoIds[0]} alt="Visit photo" /></span>
            {/if}
            <span class="v-edit" aria-hidden="true"><Icon name="edit" size={18} /></span>
          </button>
        {/each}
      </div>
    {/if}

    <h2>Location</h2>
    <button class="minimap" onclick={() => void goto(`/?focus=${spot.id}`)} aria-label="Show on map">
      <MapView
        interactive={false}
        showUser={false}
        satellite={mapPrefs.satellite}
        center={{ lat: spot.data.lat, lng: spot.data.lng, zoom: 15 }}
        marker={{ lat: spot.data.lat, lng: spot.data.lng }}
      />
    </button>
    <p class="note coords">
      {spot.data.lat.toFixed(6)}, {spot.data.lng.toFixed(6)}
      {#if spot.data.accuracy !== undefined}&nbsp;(±{Math.round(spot.data.accuracy)} m){/if}
    </p>

    {#if hasHabitat(spot)}
      <h2>Habitat</h2>
      <div class="card habitat">
        {#if spot.data.habitat.hostTrees.length > 0}
          <p>
            <strong>Host trees:</strong>
            {spot.data.habitat.hostTrees
              .map((t) => data.itemName(t.plantId) + (t.ageMin || t.ageMax ? ` (${t.ageMin ?? '?'}–${t.ageMax ?? '?'} y)` : ''))
              .join(', ')}
          </p>
        {/if}
        {#if spot.data.habitat.soil}<p><strong>Soil:</strong> {spot.data.habitat.soil}</p>{/if}
        {#if spot.data.habitat.ph !== undefined}<p><strong>pH:</strong> {spot.data.habitat.ph.toFixed(1)}</p>{/if}
        {#if spot.data.habitat.vegetation}<p><strong>Vegetation:</strong> {spot.data.habitat.vegetation}</p>{/if}
        {#if spot.data.habitat.surroundingPlantIds.length > 0}
          <p><strong>Plants nearby:</strong> {spot.data.habitat.surroundingPlantIds.map((id) => data.itemName(id)).join(', ')}</p>
        {/if}
        {#if spot.data.habitat.indicatorSpeciesIds.length > 0}
          <p><strong>Indicator mushrooms:</strong> {spot.data.habitat.indicatorSpeciesIds.map((id) => data.itemName(id)).join(', ')}</p>
        {/if}
        {#if spot.data.habitat.habitatNotes}<p>{spot.data.habitat.habitatNotes}</p>{/if}
        {#if spot.data.habitatPhotoIds.length > 0}
          <div class="strip">
            {#each spot.data.habitatPhotoIds as pid (pid)}
              <button class="photo" onclick={() => (viewerPhotoId = pid)}>
                <PhotoImg photoId={pid} alt="Habitat photo" />
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <div class="actions">
      <button class="btn secondary" onclick={navigateTo}><Icon name="navigation" size={20} /> Navigate</button>
      <button class="btn danger" disabled={boot.readOnly} onclick={() => (confirmDelete = true)}><Icon name="trash" size={20} /> Delete</button>
    </div>
  </div>
{/if}

{#if viewerPhotoId}
  <button
    class="viewer"
    transition:fade={{ duration: 150 }}
    onclick={() => (viewerPhotoId = null)}
    aria-label="Close photo"
  >
    <PhotoImg photoId={viewerPhotoId} alt="Photo" />
  </button>
{/if}

<ConfirmDialog
  bind:open={confirmDelete}
  title="Delete this spot?"
  message="The spot, its visits and photos will be deleted everywhere after the next sync."
  onConfirm={() => void deleteSpot()}
/>
<VisitSheet bind:open={visitSheetOpen} visit={editingVisit} />

<script module lang="ts">
  import type { SpotEntity } from '@spots/shared';
  function hasHabitat(spot: SpotEntity): boolean {
    const h = spot.data.habitat;
    return (
      h.hostTrees.length > 0 ||
      h.soil !== '' ||
      h.ph !== undefined ||
      h.vegetation !== '' ||
      h.habitatNotes !== '' ||
      h.surroundingPlantIds.length > 0 ||
      h.indicatorSpeciesIds.length > 0 ||
      spot.data.habitatPhotoIds.length > 0
    );
  }
</script>

<style>
  .when {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--ink-soft);
    margin: 0 0 12px;
  }
  .ratingrow {
    margin: 0 0 14px;
  }
  .strip {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    padding: 4px 0 8px;
  }
  .photo {
    flex: 0 0 132px;
    height: 132px;
    border: none;
    padding: 0;
    background: none;
    cursor: pointer;
  }
  .notes {
    font-size: 17px;
    white-space: pre-wrap;
  }
  .visitlog {
    padding: 14px;
    margin: 16px 0;
  }
  .visitlog .label {
    margin: 0 0 10px;
    font-weight: 700;
    color: var(--ink-soft);
  }
  .outcomes {
    display: flex;
    gap: 10px;
  }
  .outcome {
    flex: 1;
    min-height: 76px;
    border-radius: var(--radius);
    border: 2px solid var(--line);
    background: var(--card);
    font-size: 15px;
    font-weight: 700;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    cursor: pointer;
  }
  .outcome:active {
    border-color: var(--green);
    background: var(--green-soft);
  }
  .emoji {
    font-size: 26px;
  }
  h2 {
    font-size: 17px;
    margin: 20px 0 10px;
    color: var(--green-dark);
  }
  .timeline {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .visit {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    border: none;
    text-align: left;
    cursor: pointer;
    font: inherit;
  }
  .v-emoji {
    font-size: 26px;
  }
  .v-meta {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .v-meta .sub {
    color: var(--ink-soft);
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .v-thumb {
    width: 52px;
    height: 52px;
    flex-shrink: 0;
  }
  .v-edit {
    color: var(--ink-soft);
    flex-shrink: 0;
    display: inline-flex;
  }
  .minimap {
    display: block;
    position: relative;
    width: 100%;
    height: 180px;
    border-radius: var(--radius);
    overflow: hidden;
    border: none;
    padding: 0;
    cursor: pointer;
    box-shadow: var(--shadow);
  }
  .coords {
    margin-top: 6px;
    font-variant-numeric: tabular-nums;
  }
  .habitat {
    padding: 14px;
  }
  .habitat p {
    margin: 0 0 8px;
  }
  .actions {
    display: flex;
    gap: 12px;
    margin: 24px 0;
  }
  .actions .btn {
    flex: 1;
  }
  .viewer {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgba(0, 0, 0, 0.92);
    border: none;
    padding: 0;
    cursor: zoom-out;
  }
  .viewer :global(img) {
    object-fit: contain;
    border-radius: 0;
  }
</style>
