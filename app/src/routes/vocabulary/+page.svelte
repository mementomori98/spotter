<script lang="ts">
  import BottomSheet from '$lib/components/BottomSheet.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import CropSheet from '$lib/components/CropSheet.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import PhotoImg from '$lib/components/PhotoImg.svelte';
  import Selector from '$lib/components/Selector.svelte';
  import { createIconPhoto } from '$lib/photos/photos';
  import { boot } from '$lib/state/boot.svelte';
  import { data } from '$lib/state/data.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import type { ListItemEntity } from '@spots/shared';

  /**
   * Vocabulary manager: fix typos (rename), add items directly, assign tags
   * to species, and delete items. Items in use CAN be deleted — the store
   * cascades (plant: stripped from habitats; species: its spots are deleted
   * and indicator refs stripped; tag: stripped from species); the confirm
   * dialog states the impact first.
   */
  let kind = $state<'species' | 'plant' | 'tag'>('species');
  let query = $state('');
  let editing = $state<ListItemEntity | null>(null);
  let editName = $state('');
  let sheetOpen = $state(false);
  let confirmDelete = $state(false);
  let cropOpen = $state(false);
  let cropFile = $state<Blob | null>(null);
  let iconInput = $state<HTMLInputElement | null>(null);
  let tagsOpen = $state(false);

  /** Live view of the item being edited (upserts replace the entity). */
  const editingLive = $derived(
    editing ? ((data.entities.get(editing.id) as ListItemEntity | undefined) ?? editing) : null
  );
  const iconPhotoId = $derived(editingLive ? data.itemIconPhotoId(editingLive.id) : null);

  const q = $derived(query.trim().toLowerCase());
  const items = $derived(
    data.listItems(kind).filter((i) => !q || i.data.name.toLowerCase().includes(q))
  );
  const duplicate = $derived.by(() => {
    if (!editing) return false;
    const clash = data.findItemByName(kind, editName);
    return clash !== undefined && clash.id !== editing.id;
  });
  /** Informational — the store recomputes against live data on delete. */
  const impact = $derived(editing ? data.deleteImpact(editing.id) : null);
  const deleteTitle = $derived(
    kind === 'species' && (impact?.spotsDeleted ?? 0) > 0
      ? `Delete “${editing?.data.name}” and its spots?`
      : `Delete “${editing?.data.name}”?`
  );
  const deleteMessage = $derived.by(() => {
    const simple = 'It will disappear from the selector on all your devices.';
    if (!impact) return simple;
    if (kind === 'plant') {
      const n = impact.habitatEdits;
      if (n === 0) return simple;
      return `Removes it from ${n === 1 ? "1 spot's habitat" : `${n} spots' habitats`}. The spots themselves are kept.`;
    }
    if (kind === 'species') {
      const n = impact.spotsDeleted;
      if (n === 0) {
        // Used only as an indicator mushroom — no spots die, but references go.
        if (impact.habitatEdits > 0) {
          return `Removes it as an indicator from ${impact.habitatEdits} spot${impact.habitatEdits === 1 ? '' : 's'}. The spots themselves are kept.`;
        }
        return simple;
      }
      const also =
        impact.habitatEdits > 0
          ? `, and removes it as an indicator from ${impact.habitatEdits} other spot${impact.habitatEdits === 1 ? '' : 's'}`
          : '';
      return `Permanently deletes ${n} spot${n === 1 ? '' : 's'} with all their visits and photos${also}. This cannot be undone.`;
    }
    return `Removes this tag from ${impact.speciesEdited} species. Spots are not affected.`;
  });

  function openItem(item: ListItemEntity): void {
    editing = item;
    editName = item.data.name;
    sheetOpen = true;
  }

  async function rename(): Promise<void> {
    if (!editing) return;
    // The store is the authoritative duplicate/empty gate.
    if ((await data.renameListItem(editing.id, editName)) === 'ok') {
      sheetOpen = false;
      toasts.show('Renamed.');
    }
  }

  async function createFromSearch(): Promise<void> {
    const item = await data.createListItem(kind, query);
    if (!item) return;
    query = '';
    toasts.show(`Added “${item.data.name}”.`);
  }

  async function remove(): Promise<void> {
    if (!editingLive) return;
    // Store cascades per kind and cleans up the icon photo too.
    await data.deleteListItem(editingLive.id);
    sheetOpen = false;
    toasts.show(`Deleted “${editingLive.data.name}”.`);
  }

  async function onCropped(blob: Blob): Promise<void> {
    if (!editingLive) return;
    const old = editingLive.data.iconPhotoId;
    const photoId = await createIconPhoto(blob);
    await data.upsert('listItem', editingLive.id, { ...editingLive.data, iconPhotoId: photoId });
    if (old && old !== photoId) await data.removePhotos([old]);
    toasts.show('Icon set — it now marks this species on the map.');
  }

  async function removeIcon(): Promise<void> {
    if (!editingLive?.data.iconPhotoId) return;
    const { iconPhotoId: old, ...rest } = editingLive.data;
    await data.upsert('listItem', editingLive.id, rest);
    if (old) await data.removePhotos([old]);
    toasts.show('Icon removed.');
  }
</script>

<svelte:head><title>Spots — Species & plants</title></svelte:head>

<div class="page">
  <div class="topbar">
    <a class="iconbtn" aria-label="Back to settings" href="/settings"><Icon name="back" /></a>
    <h1>Species & plants</h1>
  </div>

  <div class="tabs" role="tablist">
    <button role="tab" aria-selected={kind === 'species'} class:active={kind === 'species'} onclick={() => (kind = 'species')}>
      🍄 Mushrooms
    </button>
    <button role="tab" aria-selected={kind === 'plant'} class:active={kind === 'plant'} onclick={() => (kind = 'plant')}>
      🌳 Trees & plants
    </button>
    <button role="tab" aria-selected={kind === 'tag'} class:active={kind === 'tag'} onclick={() => (kind = 'tag')}>
      🏷 Tags
    </button>
  </div>

  <div class="searchbox">
    <Icon name="search" size={20} />
    <input class="input" placeholder="Search or add new…" bind:value={query} maxlength="200" />
  </div>

  {#if query.trim() && !data.findItemByName(kind, query)}
    <!-- Create-from-search (all tabs) — the only way to create tags (F7). -->
    <button class="row create" disabled={boot.readOnly} onclick={() => void createFromSearch()}>
      <Icon name="plus" size={22} />
      <span>Create “{query.trim()}”</span>
    </button>
  {/if}

  {#if items.length === 0}
    <div class="empty">
      <div class="big">{kind === 'species' ? '🍄' : kind === 'plant' ? '🌳' : '🏷'}</div>
      <p>
        {#if data.listItems(kind).length === 0}
          {#if kind === 'tag'}
            Nothing here yet — type a name above to add your first tag.
          {:else}
            Nothing here yet — names are added on the fly while saving spots.
          {/if}
        {:else}
          Nothing matches your search.
        {/if}
      </p>
    </div>
  {/if}

  {#each items as item (item.id)}
    {@const count = data.itemUsageCount(item.id)}
    {@const icon = data.itemIconPhotoId(item.id)}
    <button class="row card" onclick={() => openItem(item)}>
      {#if icon}
        <span class="rowicon"><PhotoImg photoId={icon} alt={item.data.name} /></span>
      {/if}
      <span class="name">{item.data.name}</span>
      <span class="use" class:unused={count === 0}>
        {count === 0
          ? 'not used'
          : kind === 'tag'
            ? `${count} species`
            : `${count} spot${count === 1 ? '' : 's'}`}
      </span>
      <Icon name="edit" size={18} />
    </button>
  {/each}
</div>

<BottomSheet bind:open={sheetOpen} title={editing?.data.name ?? ''}>
  {#if editing}
    <label class="field">
      <span class="label">Name</span>
      <input class="input" bind:value={editName} maxlength="200" />
    </label>
    {#if duplicate}
      <p class="warn-banner">That name already exists in this list.</p>
    {/if}

    <button
      class="btn"
      onclick={() => void rename()}
      disabled={!editName.trim() || editName.trim() === editing.data.name || duplicate || boot.readOnly}
    >
      Rename
    </button>

    {#if editingLive?.data.kind === 'species'}
      <div class="iconsec">
        <span class="label">Map icon</span>
        <div class="iconrow">
          <span class="preview" class:empty={!iconPhotoId}>
            {#if iconPhotoId}
              <PhotoImg photoId={iconPhotoId} alt="Species icon" />
            {:else}
              🍄
            {/if}
          </span>
          <div class="iconbtns">
            <button class="btn secondary" disabled={boot.readOnly} onclick={() => iconInput?.click()}>
              <Icon name="image" size={20} /> {iconPhotoId ? 'Change' : 'Choose image'}
            </button>
            {#if iconPhotoId}
              <button class="btn ghost" disabled={boot.readOnly} onclick={() => void removeIcon()}>
                Remove icon
              </button>
            {/if}
          </div>
        </div>
        <p class="note">Shown on the map instead of the colored dot.</p>
        <input
          bind:this={iconInput}
          type="file"
          accept="image/*"
          hidden
          onchange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) {
              cropFile = f;
              cropOpen = true;
            }
            e.currentTarget.value = '';
          }}
        />
      </div>
    {/if}

    {#if editingLive?.data.kind === 'species'}
      <div class="tagsec">
        <span class="label">Tags</span>
        {#if (editingLive.data.tagIds ?? []).length > 0}
          <div class="tagchips">
            {#each editingLive.data.tagIds ?? [] as tid (tid)}
              {#if data.itemName(tid)}<span class="tagchip">{data.itemName(tid)}</span>{/if}
            {/each}
          </div>
        {/if}
        <button class="btn secondary" disabled={boot.readOnly} onclick={() => (tagsOpen = true)}>
          🏷 Edit tags
        </button>
      </div>
    {/if}

    <div class="del">
      <button class="btn danger" disabled={boot.readOnly} onclick={() => (confirmDelete = true)}>
        <Icon name="trash" size={20} /> Delete
      </button>
    </div>
  {/if}
</BottomSheet>

<ConfirmDialog
  bind:open={confirmDelete}
  title={deleteTitle}
  message={deleteMessage}
  onConfirm={() => void remove()}
/>
<CropSheet bind:open={cropOpen} file={cropFile} onDone={(blob) => void onCropped(blob)} />
<Selector
  bind:open={tagsOpen}
  kind="tag"
  title="Tags"
  multi
  selected={editingLive?.data.tagIds ?? []}
  onDone={(ids) => {
    if (editingLive) void data.upsert('listItem', editingLive.id, { ...editingLive.data, tagIds: ids });
  }}
/>

<style>
  .tabs {
    display: flex;
    background: var(--green-soft);
    border-radius: var(--radius);
    padding: 4px;
    margin-bottom: 12px;
  }
  .tabs button {
    flex: 1;
    min-height: 48px;
    border: none;
    border-radius: 11px;
    background: transparent;
    font-weight: 700;
    color: var(--green-dark);
    cursor: pointer;
    font-size: 16px;
  }
  .tabs button.active {
    background: var(--card);
    box-shadow: var(--shadow);
  }
  .searchbox {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--ink-soft);
    margin-bottom: 12px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 14px;
    margin-bottom: 8px;
    border: none;
    text-align: left;
    font: inherit;
    cursor: pointer;
    color: var(--ink);
  }
  .row .name {
    flex: 1;
    font-size: 17px;
    font-weight: 600;
  }
  .use {
    font-size: 13px;
    font-weight: 700;
    color: var(--green-dark);
  }
  .use.unused {
    color: var(--ink-soft);
  }
  /* Mirrors the Selector's create row so "add new" looks the same everywhere. */
  .row.create {
    color: var(--accent-dark);
    font-weight: 700;
    justify-content: flex-start;
    background: var(--accent-soft);
    border-radius: var(--radius);
  }
  .field {
    margin-top: 4px;
  }
  .btn {
    width: 100%;
  }
  .del {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .rowicon {
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    border-radius: 50%;
    overflow: hidden;
  }
  .iconsec {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .iconrow {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .preview {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    overflow: hidden;
    flex-shrink: 0;
    box-shadow: var(--shadow);
  }
  .preview.empty {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--green-soft);
    font-size: 28px;
  }
  .iconbtns {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
  }
  .tagsec {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .tagchips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .tagchip {
    padding: 4px 12px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent-dark);
    font-size: 14px;
    font-weight: 700;
  }
</style>
