<script lang="ts">
  import BottomSheet from './BottomSheet.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import PhotoPicker from './PhotoPicker.svelte';
  import { commitDraftPhotos } from '$lib/photos/photos';
  import { data } from '$lib/state/data.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import type { DraftPhoto } from '$lib/storage/types';
  import { fromDatetimeLocal, toDatetimeLocal } from '$lib/util/format';
  import type { VisitEntity, VisitOutcome } from '@spots/shared';

  const OUTCOMES: { value: VisitOutcome; label: string; emoji: string }[] = [
    { value: 'found', label: 'Found', emoji: '🍄' },
    { value: 'harvested', label: 'Harvested', emoji: '🧺' },
    { value: 'nothing', label: 'Nothing', emoji: '∅' }
  ];

  let {
    open = $bindable(false),
    visit
  }: { open: boolean; visit: VisitEntity | null } = $props();

  let outcome = $state<VisitOutcome>('found');
  let at = $state(Date.now());
  let note = $state('');
  let photos = $state<DraftPhoto[]>([]);
  let confirmDelete = $state(false);

  $effect(() => {
    if (open && visit) {
      outcome = visit.data.outcome;
      at = visit.data.at;
      note = visit.data.note;
      photos = visit.data.photoIds.flatMap((id) => {
        const p = data.getPhoto(id);
        return p ? [{ hash: p.data.hash, ext: p.data.ext, size: p.data.size }] : [];
      });
    }
  });

  async function save(): Promise<void> {
    if (!visit) return;
    const photoIds = await commitDraftPhotos(photos);
    const removed = visit.data.photoIds.filter((id) => !photoIds.includes(id));
    if (removed.length > 0) await data.removePhotos(removed);
    await data.upsert('visit', visit.id, { ...visit.data, outcome, at, note, photoIds });
    open = false;
    toasts.show('Visit updated.');
  }

  async function remove(): Promise<void> {
    if (!visit) return;
    await data.deleteVisit(visit.id);
    open = false;
    toasts.show('Visit deleted.');
  }
</script>

<BottomSheet bind:open title="Visit details">
  {#if visit}
    <div class="outcomes">
      {#each OUTCOMES as o (o.value)}
        <button class="outcome" class:on={outcome === o.value} onclick={() => (outcome = o.value)}>
          <span class="emoji">{o.emoji}</span>{o.label}
        </button>
      {/each}
    </div>

    <label class="field">
      <span class="label">When</span>
      <input
        class="input"
        type="datetime-local"
        value={toDatetimeLocal(at)}
        onchange={(e) => (at = fromDatetimeLocal(e.currentTarget.value))}
      />
    </label>

    <label class="field">
      <span class="label">Note</span>
      <textarea class="input" rows="2" maxlength="10000" bind:value={note} placeholder="e.g. 400 g, young ones coming…"></textarea>
    </label>

    <div class="field">
      <span class="label">Photos</span>
      <PhotoPicker bind:photos label="Visit photo" />
    </div>

    <div class="actions">
      <button class="btn danger" onclick={() => (confirmDelete = true)}>Delete</button>
      <button class="btn" onclick={() => void save()}>Save</button>
    </div>
  {/if}
</BottomSheet>

<ConfirmDialog
  bind:open={confirmDelete}
  title="Delete this visit?"
  message="The visit entry and its photos will be removed."
  onConfirm={() => void remove()}
/>

<style>
  .outcomes {
    display: flex;
    gap: 10px;
    margin-bottom: 16px;
  }
  .outcome {
    flex: 1;
    min-height: 72px;
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
  .outcome.on {
    border-color: var(--green);
    background: var(--green-soft);
    color: var(--green-dark);
  }
  .emoji {
    font-size: 24px;
  }
  .actions {
    display: flex;
    gap: 10px;
    margin-top: 8px;
  }
  .actions .btn {
    flex: 1;
  }
</style>
