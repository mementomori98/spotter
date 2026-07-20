<script lang="ts">
  import { goto } from '$app/navigation';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import MapView from '$lib/components/MapView.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import PhotoPicker from '$lib/components/PhotoPicker.svelte';
  import RatingPicker from '$lib/components/RatingPicker.svelte';
  import Selector from '$lib/components/Selector.svelte';
  import { location } from '$lib/geo/location.svelte';
  import { commitDraftPhotos, discardDraftPhotos } from '$lib/photos/photos';
  import { boot } from '$lib/state/boot.svelte';
  import { data } from '$lib/state/data.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { mapPrefs } from '$lib/state/ui.svelte';
  import { delMeta, getMeta, setMeta } from '$lib/storage/meta';
  import type { SpotDraft } from '$lib/storage/types';
  import { fromDatetimeLocal, toDatetimeLocal } from '$lib/util/format';
  import { newId } from '$lib/util/ids';
  import type { SpotEntity } from '@spots/shared';
  import { untrack } from 'svelte';

  let { spot = null }: { spot?: SpotEntity | null } = $props();

  const editing = spot !== null;
  const draftKey = `draft:${spot?.id ?? 'new'}`;

  function blankDraft(): SpotDraft {
    return {
      key: spot?.id ?? 'new',
      lat: spot?.data.lat ?? location.lat,
      lng: spot?.data.lng ?? location.lng,
      accuracy: spot?.data.accuracy ?? location.accuracy ?? undefined,
      pinAdjusted: editing, // editing an existing spot never follows GPS
      foundAt: spot?.data.foundAt ?? Date.now(),
      speciesId: spot?.data.speciesId ?? null,
      rating: spot?.data.rating ?? null,
      notes: spot?.data.notes ?? '',
      soil: spot?.data.habitat.soil ?? '',
      ph: spot?.data.habitat.ph ?? null,
      vegetation: spot?.data.habitat.vegetation ?? '',
      habitatNotes: spot?.data.habitat.habitatNotes ?? '',
      hostTrees: spot ? spot.data.habitat.hostTrees.map((t) => ({ ...t })) : [],
      surroundingPlantIds: spot ? [...spot.data.habitat.surroundingPlantIds] : [],
      indicatorSpeciesIds: spot ? [...spot.data.habitat.indicatorSpeciesIds] : [],
      photos: spot
        ? spot.data.photoIds.flatMap((id) => {
            const p = data.getPhoto(id);
            return p ? [{ hash: p.data.hash, ext: p.data.ext, size: p.data.size }] : [];
          })
        : [],
      habitatPhotos: spot
        ? spot.data.habitatPhotoIds.flatMap((id) => {
            const p = data.getPhoto(id);
            return p ? [{ hash: p.data.hash, ext: p.data.ext, size: p.data.size }] : [];
          })
        : [],
      habitatOpen: editing
        ? spot!.data.habitat.hostTrees.length > 0 ||
          spot!.data.habitat.ph !== undefined ||
          spot!.data.habitat.soil !== '' ||
          spot!.data.habitat.vegetation !== '' ||
          spot!.data.habitat.habitatNotes !== '' ||
          spot!.data.habitat.surroundingPlantIds.length > 0 ||
          spot!.data.habitat.indicatorSpeciesIds.length > 0 ||
          spot!.data.habitatPhotoIds.length > 0
        : false
    };
  }

  /** A draft is only worth keeping when the user actually entered something. */
  function isMeaningful(d: SpotDraft): boolean {
    return Boolean(
      d.speciesId ||
        d.rating ||
        d.notes ||
        d.ph !== null ||
        d.soil ||
        d.vegetation ||
        d.habitatNotes ||
        d.photos.length ||
        d.habitatPhotos.length ||
        d.hostTrees.length ||
        d.surroundingPlantIds.length ||
        d.indicatorSpeciesIds.length
    );
  }

  let draft = $state<SpotDraft>(blankDraft());
  let restored = $state(false);
  /**
   * New spots start on a FULL-SCREEN map: confirm the exact location first
   * (nearby existing spots are shown to help micro-position when GPS is
   * vague under canopy), then fill in the rest of the form.
   */
  let locating = $state(!editing);
  let speciesOpen = $state(false);
  let hostTreeOpen = $state(false);
  let plantsOpen = $state(false);
  let indicatorsOpen = $state(false);
  let saving = $state(false);
  let confirmDiscard = $state(false);
  let mapRef = $state<MapView | null>(null);

  // Existing spots as context pins on the location map (all of them —
  // seeing your own cluster helps place the new find precisely).
  const contextPins = $derived(
    data
      .liveSpots()
      .filter((s) => s.id !== spot?.id)
      .map((s) => ({
        id: s.id,
        lat: s.data.lat,
        lng: s.data.lng,
        rating: s.data.rating ?? null,
        iconPhotoId: data.itemIconPhotoId(s.data.speciesId)
      }))
  );

  // Restore a persisted draft (the camera app may have killed the PWA).
  // Only MEANINGFUL drafts are persisted, so a restored draft always gets a
  // toast; it skips straight to the form (its location was already set).
  $effect(() => {
    void (async () => {
      const saved = await getMeta<SpotDraft>(draftKey);
      if (saved && isMeaningful(saved)) {
        draft = { ...blankDraft(), ...saved };
        locating = false;
        toasts.show('Restored your unsaved entry.');
        if (!editing && !draft.speciesId) speciesOpen = true;
      } else if (saved) {
        await delMeta(draftKey);
      }
      restored = true;
    })();
  });

  // Persist meaningful drafts on every change (debounced); an emptied-out
  // draft is deleted so the next capture starts truly fresh.
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const snapshot = JSON.stringify(draft);
    if (!restored) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      const value = JSON.parse(snapshot) as SpotDraft;
      if (isMeaningful(value)) void setMeta(draftKey, value);
      else void delMeta(draftKey);
    }, 300);
  });

  // GPS live-lock: pin follows fixes until the user adjusts the map OR
  // confirms the location (confirm freezes the pin — walking away while
  // filling the form must not drag the pin along).
  $effect(() => {
    if (!restored || draft.pinAdjusted || !location.hasFix) return;
    const firstFix = draft.lat === null;
    draft.lat = location.lat;
    draft.lng = location.lng;
    draft.accuracy = location.accuracy ?? undefined;
    // First fix zooms in close (map may sit at the low-zoom fallback).
    untrack(() => mapRef?.jumpTo(location.lat!, location.lng!, firstFix ? 17 : undefined));
  });

  const accuracyText = $derived(
    draft.pinAdjusted
      ? 'Pin fixed'
      : draft.accuracy !== undefined
        ? `GPS ±${Math.round(draft.accuracy)} m`
        : location.error ?? 'Waiting for GPS…'
  );
  const accuracyWarn = $derived(!draft.pinAdjusted && (draft.accuracy === undefined || draft.accuracy > 25));

  const hasLocation = $derived(draft.lat !== null && draft.lng !== null);
  const canSave = $derived(draft.speciesId !== null && hasLocation);
  const saveHint = $derived(
    draft.speciesId === null
      ? 'Choose a species to save'
      : !hasLocation
        ? 'Set the location first'
        : null
  );

  function confirmLocation(): void {
    draft.pinAdjusted = true; // freeze — GPS must not move a confirmed pin
    locating = false;
    // The only remaining required choice — open it immediately.
    if (!editing && !draft.speciesId) speciesOpen = true;
  }

  function onMapPan(): void {
    draft.pinAdjusted = true;
  }

  function onMapMove(view: { lat: number; lng: number }): void {
    if (draft.pinAdjusted) {
      draft.lat = view.lat;
      draft.lng = view.lng;
    }
  }

  async function save(): Promise<void> {
    if (!canSave || saving) return;
    saving = true;
    try {
      const photoIds = await commitDraftPhotos(draft.photos);
      const habitatPhotoIds = await commitDraftPhotos(draft.habitatPhotos);

      if (editing && spot) {
        const kept = new Set([...photoIds, ...habitatPhotoIds]);
        const removed = [...spot.data.photoIds, ...spot.data.habitatPhotoIds].filter((id) => !kept.has(id));
        if (removed.length > 0) await data.removePhotos(removed);
      }

      const id = spot?.id ?? newId();
      await data.upsert('spot', id, {
        lat: draft.lat!,
        lng: draft.lng!,
        ...(draft.accuracy !== undefined ? { accuracy: draft.accuracy } : {}),
        foundAt: draft.foundAt,
        speciesId: draft.speciesId!,
        ...(draft.rating ? { rating: draft.rating } : {}),
        notes: draft.notes,
        habitat: {
          hostTrees: draft.hostTrees,
          soil: draft.soil,
          ...(draft.ph !== null ? { ph: Math.round(draft.ph * 10) / 10 } : {}),
          vegetation: draft.vegetation,
          surroundingPlantIds: draft.surroundingPlantIds,
          indicatorSpeciesIds: draft.indicatorSpeciesIds,
          habitatNotes: draft.habitatNotes
        },
        photoIds,
        habitatPhotoIds
      });
      if (persistTimer) clearTimeout(persistTimer);
      await delMeta(draftKey);
      toasts.show(editing ? 'Spot updated.' : 'Spot saved.');
      await goto(`/spot/${id}`, { replaceState: true });
    } finally {
      saving = false;
    }
  }

  /** Back = leave without saving (drafts survive process kills, not explicit exits). */
  async function cancel(): Promise<void> {
    if (persistTimer) clearTimeout(persistTimer);
    await discardDraftPhotos([...draft.photos, ...draft.habitatPhotos]);
    await delMeta(draftKey);
    // Deep-linked PWA start has no history to go back to.
    if (history.length > 1) history.back();
    else await goto('/', { replaceState: true });
  }

  function onBack(): void {
    if (!editing && isMeaningful(draft)) confirmDiscard = true;
    else void cancel();
  }

  /** Back from the location screen: to the form if it has content, else exit. */
  function locateBack(): void {
    if (isMeaningful(draft)) locating = false;
    else onBack();
  }
</script>

{#if locating}
  <!-- STEP 1 — full-screen location confirmation -->
  <div class="locate">
    <MapView
      bind:this={mapRef}
      interactive={true}
      showUser={true}
      spots={contextPins}
      satellite={mapPrefs.satellite}
      center={draft.lat !== null ? { lat: draft.lat, lng: draft.lng!, zoom: 17 } : null}
      onUserPan={onMapPan}
      onMove={onMapMove}
    />
    <div class="crosshair" aria-hidden="true"><div class="pin">📍</div></div>

    <div class="l-top">
      <button class="mapbtn" aria-label="Back" onclick={locateBack}><Icon name="back" /></button>
      <div class="acc" class:warn={accuracyWarn}>{accuracyText}</div>
      <button
        class="mapbtn"
        aria-label={mapPrefs.satellite ? 'Map view' : 'Satellite view'}
        onclick={() => mapPrefs.toggle()}
      >
        <Icon name={mapPrefs.satellite ? 'map' : 'globe'} />
      </button>
    </div>

    {#if draft.pinAdjusted}
      <button class="relock chip" onclick={() => (draft.pinAdjusted = false)}>Follow GPS</button>
    {/if}

    <div class="l-bottom">
      {#if hasLocation}
        <p class="coords">{draft.lat!.toFixed(6)}, {draft.lng!.toFixed(6)}</p>
      {/if}
      <button class="btn confirm" onclick={confirmLocation} disabled={!hasLocation}>
        {hasLocation ? '✓ This is the place' : 'Waiting for GPS — or drag the map'}
      </button>
      <p class="note center">Drag the map to fine-tune the pin. Your other spots are shown too.</p>
    </div>
  </div>
{:else}
  <!-- STEP 2 — the rest of the form -->
  <div class="topbar">
    <button class="iconbtn" aria-label="Back" onclick={onBack}><Icon name="back" /></button>
    <h1>{editing ? 'Edit spot' : 'New spot'}</h1>
  </div>

  <div class="field">
    <span class="label">Location</span>
    <button class="preview" onclick={() => (locating = true)} aria-label="Adjust location">
      {#if hasLocation}
        <MapView
          interactive={false}
          showUser={false}
          satellite={mapPrefs.satellite}
          center={{ lat: draft.lat!, lng: draft.lng!, zoom: 16 }}
          marker={{ lat: draft.lat!, lng: draft.lng! }}
        />
      {/if}
      <span class="adjust chip"><Icon name="crosshair" size={16} /> Adjust</span>
    </button>
    {#if hasLocation}
      <p class="note coords-line">{draft.lat!.toFixed(6)}, {draft.lng!.toFixed(6)} · {accuracyText}</p>
    {/if}
  </div>

  <div class="field">
    <span class="label">Species <em>required</em></span>
    <button class="input choose" class:placeholder={!draft.speciesId} onclick={() => (speciesOpen = true)}>
      {draft.speciesId ? data.itemName(draft.speciesId) : 'Choose species…'}
    </button>
  </div>

  <div class="field">
    <span class="label">Rating</span>
    <RatingPicker value={draft.rating} onChange={(r) => (draft.rating = r)} />
  </div>

  <div class="field">
    <span class="label">Found</span>
    <input
      class="input"
      type="datetime-local"
      value={toDatetimeLocal(draft.foundAt)}
      onchange={(e) => (draft.foundAt = fromDatetimeLocal(e.currentTarget.value))}
    />
  </div>

  <div class="field">
    <span class="label">Photos of the mushroom</span>
    <PhotoPicker bind:photos={draft.photos} label="Mushroom photo" />
  </div>

  <div class="field">
    <span class="label">Notes</span>
    <textarea class="input" rows="3" maxlength="10000" bind:value={draft.notes} placeholder="Anything worth remembering…"></textarea>
  </div>

  {#if !draft.habitatOpen}
    <button class="btn secondary wide" onclick={() => (draft.habitatOpen = true)}>
      <Icon name="plus" size={20} /> Add habitat details
    </button>
  {:else}
    <h2 class="habitat-h">Habitat</h2>

    <div class="field">
      <span class="label">Host trees / plants</span>
      {#each draft.hostTrees as tree, i (tree.plantId)}
        <div class="treerow card">
          <span class="name">{data.itemName(tree.plantId)}</span>
          <label class="age">
            age
            <input
              type="number"
              class="input small"
              min="0"
              placeholder="min"
              value={tree.ageMin ?? ''}
              oninput={(e) => (draft.hostTrees[i]!.ageMin = e.currentTarget.value ? +e.currentTarget.value : undefined)}
            />
            –
            <input
              type="number"
              class="input small"
              min="0"
              placeholder="max"
              value={tree.ageMax ?? ''}
              oninput={(e) => (draft.hostTrees[i]!.ageMax = e.currentTarget.value ? +e.currentTarget.value : undefined)}
            />
            y
          </label>
          <button
            class="iconbtn"
            aria-label="Remove tree"
            onclick={() => (draft.hostTrees = draft.hostTrees.filter((t) => t.plantId !== tree.plantId))}
          >
            <Icon name="x" size={20} />
          </button>
        </div>
      {/each}
      <button class="btn secondary wide" onclick={() => (hostTreeOpen = true)}>
        <Icon name="plus" size={20} /> Add host tree
      </button>
    </div>

    <div class="field">
      <span class="label">Soil</span>
      <input class="input" maxlength="1000" bind:value={draft.soil} placeholder="e.g. sandy, calcareous, moist…" />
    </div>

    <div class="field">
      <span class="label">Soil pH</span>
      {#if draft.ph === null}
        <button class="btn secondary wide" onclick={() => (draft.ph = 6)}>
          <Icon name="plus" size={20} /> Add pH
        </button>
      {:else}
        <div class="phrow">
          <span class="phval">{draft.ph.toFixed(1)}</span>
          <input
            type="range"
            min="3"
            max="9"
            step="0.1"
            value={draft.ph}
            oninput={(e) => (draft.ph = Math.round(+e.currentTarget.value * 10) / 10)}
            aria-label="Soil pH"
          />
          <button class="iconbtn" aria-label="Clear pH" onclick={() => (draft.ph = null)}>
            <Icon name="x" size={20} />
          </button>
        </div>
        <div class="phscale note"><span>3 acidic</span><span>7</span><span>9 alkaline</span></div>
      {/if}
    </div>

    <div class="field">
      <span class="label">Vegetation</span>
      <input class="input" maxlength="1000" bind:value={draft.vegetation} placeholder="e.g. old beech forest, mossy…" />
    </div>

    <div class="field">
      <span class="label">Surrounding plants</span>
      <div class="chips">
        {#each draft.surroundingPlantIds as pid (pid)}
          <button
            class="chip active"
            onclick={() => (draft.surroundingPlantIds = draft.surroundingPlantIds.filter((x) => x !== pid))}
          >
            {data.itemName(pid)} <Icon name="x" size={16} />
          </button>
        {/each}
        <button class="chip" onclick={() => (plantsOpen = true)}><Icon name="plus" size={16} /> Add</button>
      </div>
    </div>

    <div class="field">
      <span class="label">Indicator mushrooms nearby</span>
      <div class="chips">
        {#each draft.indicatorSpeciesIds as sid (sid)}
          <button
            class="chip active"
            onclick={() => (draft.indicatorSpeciesIds = draft.indicatorSpeciesIds.filter((x) => x !== sid))}
          >
            {data.itemName(sid)} <Icon name="x" size={16} />
          </button>
        {/each}
        <button class="chip" onclick={() => (indicatorsOpen = true)}><Icon name="plus" size={16} /> Add</button>
      </div>
    </div>

    <div class="field">
      <span class="label">Habitat notes</span>
      <textarea class="input" rows="3" maxlength="5000" bind:value={draft.habitatNotes}></textarea>
    </div>

    <div class="field">
      <span class="label">Photos of the habitat</span>
      <PhotoPicker bind:photos={draft.habitatPhotos} label="Habitat photo" />
    </div>
  {/if}

  <div class="savebar">
    <!-- Never a dead button: tapping while incomplete jumps to the missing field. -->
    <button
      class="btn"
      class:muted={!canSave}
      disabled={saving || boot.readOnly}
      onclick={() => {
        if (!draft.speciesId) speciesOpen = true;
        else if (!hasLocation) locating = true;
        else void save();
      }}
    >
      {saving ? 'Saving…' : saveHint ?? (editing ? 'Save changes' : 'Save spot')}
    </button>
  </div>
{/if}

<ConfirmDialog
  bind:open={confirmDiscard}
  title="Discard this entry?"
  message="Your photos and details for this spot will be thrown away."
  confirmLabel="Discard"
  onConfirm={() => void cancel()}
/>

<Selector
  bind:open={speciesOpen}
  kind="species"
  title="Species"
  selected={draft.speciesId ? [draft.speciesId] : []}
  onDone={(ids) => (draft.speciesId = ids[0] ?? draft.speciesId)}
/>
<Selector
  bind:open={hostTreeOpen}
  kind="plant"
  title="Host tree / plant"
  exclude={draft.hostTrees.map((t) => t.plantId)}
  onDone={(ids) => {
    for (const id of ids) draft.hostTrees = [...draft.hostTrees, { plantId: id }];
  }}
/>
<Selector
  bind:open={plantsOpen}
  kind="plant"
  title="Surrounding plants"
  multi
  selected={draft.surroundingPlantIds}
  onDone={(ids) => (draft.surroundingPlantIds = ids)}
/>
<Selector
  bind:open={indicatorsOpen}
  kind="species"
  title="Indicator mushrooms"
  multi
  selected={draft.indicatorSpeciesIds}
  exclude={draft.speciesId ? [draft.speciesId] : []}
  onDone={(ids) => (draft.indicatorSpeciesIds = ids)}
/>

<style>
  /* ---- step 1: full-screen locator ---- */
  .locate {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: var(--paper);
  }
  .crosshair {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -100%);
    pointer-events: none;
    z-index: 5;
  }
  .pin {
    font-size: 44px;
    line-height: 1;
    filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.4));
  }
  .l-top {
    position: absolute;
    top: calc(8px + env(safe-area-inset-top, 0px));
    left: 8px;
    right: 8px;
    z-index: 6;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
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
    flex-shrink: 0;
  }
  .acc {
    background: var(--card);
    border-radius: 999px;
    padding: 8px 14px;
    font-size: 14px;
    font-weight: 700;
    box-shadow: var(--shadow);
  }
  .acc.warn {
    background: var(--amber-soft);
    color: var(--amber);
  }
  .relock {
    position: absolute;
    right: 10px;
    top: calc(76px + env(safe-area-inset-top, 0px));
    z-index: 6;
    background: var(--card);
    box-shadow: var(--shadow);
    border: none;
    font-weight: 700;
    color: var(--green-dark);
  }
  .l-bottom {
    position: absolute;
    left: 16px;
    right: 16px;
    bottom: calc(16px + env(safe-area-inset-bottom, 0px));
    z-index: 6;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .coords {
    align-self: center;
    margin: 0;
    background: var(--card);
    border-radius: 999px;
    padding: 4px 12px;
    font-size: 13px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    box-shadow: var(--shadow);
  }
  .confirm {
    width: 100%;
    font-size: 19px;
  }
  .center {
    text-align: center;
    margin: 0;
    text-shadow: 0 1px 2px rgba(255, 255, 255, 0.8);
  }

  /* ---- step 2: form ---- */
  .preview {
    display: block;
    position: relative;
    width: 100%;
    height: 160px;
    border-radius: var(--radius);
    overflow: hidden;
    border: none;
    padding: 0;
    cursor: pointer;
    box-shadow: var(--shadow);
    background: var(--green-soft);
  }
  .adjust {
    position: absolute;
    right: 8px;
    bottom: 8px;
    z-index: 5;
    background: var(--card);
    border: none;
    box-shadow: var(--shadow);
    font-weight: 700;
    color: var(--green-dark);
  }
  .coords-line {
    margin: 6px 2px 0;
    font-variant-numeric: tabular-nums;
  }
  .choose {
    text-align: left;
    cursor: pointer;
  }
  .choose.placeholder {
    color: var(--ink-soft);
  }
  .label em {
    color: var(--danger);
    font-style: normal;
    text-transform: none;
    font-weight: 700;
  }
  .wide {
    width: 100%;
  }
  .habitat-h {
    font-size: 18px;
    margin: 20px 0 12px;
    color: var(--green-dark);
  }
  .treerow {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 8px 8px 14px;
    margin-bottom: 8px;
  }
  .treerow .name {
    flex: 1;
    font-weight: 700;
  }
  .age {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 14px;
    color: var(--ink-soft);
  }
  .input.small {
    width: 64px;
    min-height: 44px;
    padding: 6px 8px;
    text-align: center;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .phrow {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .phval {
    font-size: 22px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    min-width: 52px;
    color: var(--green-dark);
  }
  .phrow input[type='range'] {
    flex: 1;
    accent-color: var(--accent);
    min-height: 48px;
  }
  .phscale {
    display: flex;
    justify-content: space-between;
    margin-top: -4px;
  }
</style>
