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
  let speciesOpen = $state(false);
  let hostTreeOpen = $state(false);
  let plantsOpen = $state(false);
  let indicatorsOpen = $state(false);
  let saving = $state(false);
  let mapRef = $state<MapView | null>(null);

  // Restore a persisted draft (the camera app may have killed the PWA), then
  // auto-open the species selector on brand-new captures: it's the only
  // required choice -> FAB, tap species, Save = 3 taps total. Only
  // MEANINGFUL drafts are ever persisted, so a restored draft always gets a
  // toast, and an abandoned pristine form can never suppress the auto-open
  // or resurrect a stale timestamp.
  $effect(() => {
    void (async () => {
      const saved = await getMeta<SpotDraft>(draftKey);
      if (saved && isMeaningful(saved)) {
        draft = { ...blankDraft(), ...saved };
        toasts.show('Restored your unsaved entry.');
        if (!editing && !draft.speciesId) speciesOpen = true;
      } else {
        if (saved) await delMeta(draftKey);
        if (!editing) speciesOpen = true;
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

  // GPS live-lock: pin follows fixes until the user adjusts the map.
  // (zoom is left alone so pinch-zooming the minimap isn't snapped back)
  $effect(() => {
    if (!restored || draft.pinAdjusted || !location.hasFix) return;
    draft.lat = location.lat;
    draft.lng = location.lng;
    draft.accuracy = location.accuracy ?? undefined;
    untrack(() => mapRef?.jumpTo(location.lat!, location.lng!));
  });

  const accuracyText = $derived(
    draft.pinAdjusted
      ? 'Pin set manually'
      : draft.accuracy !== undefined
        ? `GPS ±${Math.round(draft.accuracy)} m`
        : location.error ?? 'Waiting for GPS…'
  );
  const accuracyWarn = $derived(!draft.pinAdjusted && (draft.accuracy === undefined || draft.accuracy > 25));

  const canSave = $derived(draft.speciesId !== null && draft.lat !== null && draft.lng !== null);
  const saveHint = $derived(
    draft.speciesId === null
      ? 'Choose a species to save'
      : draft.lat === null
        ? 'Waiting for GPS — or drag the map to set the pin'
        : null
  );

  async function save(): Promise<void> {
    if (!canSave || saving) return;
    saving = true;
    try {
      const photoIds = await commitDraftPhotos(draft.photos);
      const habitatPhotoIds = await commitDraftPhotos(draft.habitatPhotos);

      if (editing && spot) {
        // Tombstone photos the user removed during this edit.
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

  /**
   * Back = leave without saving. The draft is discarded (a kept draft would
   * resurrect stale data on the next capture); drafts exist to survive
   * process kills (camera app), not explicit navigation away. Meaningful
   * entries get a confirmation first.
   */
  async function cancel(): Promise<void> {
    if (persistTimer) clearTimeout(persistTimer); // a late debounce must not resurrect the draft
    await discardDraftPhotos([...draft.photos, ...draft.habitatPhotos]);
    await delMeta(draftKey);
    history.back();
  }

  let confirmDiscard = $state(false);
  function onBack(): void {
    if (!editing && isMeaningful(draft)) confirmDiscard = true;
    else void cancel(); // safe in edit mode too: discardDraftPhotos never touches committed blobs
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
</script>

<div class="topbar">
  <button class="iconbtn" aria-label="Back" onclick={onBack}><Icon name="back" /></button>
  <h1>{editing ? 'Edit spot' : 'New spot'}</h1>
</div>

<!-- Location: drag the map under the fixed crosshair (easier than dragging a pin) -->
<div class="field">
  <span class="label">Location</span>
  <div class="minimap">
    <MapView
      bind:this={mapRef}
      interactive={true}
      showUser={true}
      center={draft.lat !== null ? { lat: draft.lat, lng: draft.lng!, zoom: 16 } : null}
      onUserPan={onMapPan}
      onMove={onMapMove}
    />
    <div class="crosshair" aria-hidden="true">
      <div class="pin">📍</div>
    </div>
    <div class="acc" class:warn={accuracyWarn}>{accuracyText}</div>
    {#if draft.pinAdjusted}
      <button
        class="chip relock"
        onclick={() => {
          draft.pinAdjusted = false;
        }}>Follow GPS</button
      >
    {/if}
  </div>
  {#if draft.lat !== null}
    <p class="note coords">{draft.lat.toFixed(6)}, {draft.lng?.toFixed(6)}</p>
  {/if}
</div>

<div class="field">
  <span class="label">Species <em>required</em></span>
  <button class="input choose" class:placeholder={!draft.speciesId} onclick={() => (speciesOpen = true)}>
    {draft.speciesId ? data.itemName(draft.speciesId) : 'Choose species…'}
  </button>
</div>

<div class="field">
  <span class="label">Rating — how good is this spot?</span>
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
  <button class="btn" onclick={() => void save()} disabled={!canSave || saving || boot.readOnly}>
    {saving ? 'Saving…' : saveHint ?? (editing ? 'Save changes' : 'Save spot')}
  </button>
</div>

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
  .minimap {
    position: relative;
    height: 260px;
    border-radius: var(--radius);
    overflow: hidden;
    box-shadow: var(--shadow);
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
    font-size: 38px;
    line-height: 1;
    filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.4));
  }
  .acc {
    position: absolute;
    left: 8px;
    top: 8px;
    z-index: 5;
    background: var(--card);
    border-radius: 999px;
    padding: 6px 12px;
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
    right: 8px;
    top: 8px;
    z-index: 5;
    background: var(--card);
    box-shadow: var(--shadow);
    border: none;
    font-weight: 700;
    color: var(--green-dark);
  }
  .coords {
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
</style>
