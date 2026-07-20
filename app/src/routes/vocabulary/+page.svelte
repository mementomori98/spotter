<script lang="ts">
  import BottomSheet from '$lib/components/BottomSheet.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import CropSheet from '$lib/components/CropSheet.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import PhotoImg from '$lib/components/PhotoImg.svelte';
  import { createIconPhoto } from '$lib/photos/photos';
  import { boot } from '$lib/state/boot.svelte';
  import { data } from '$lib/state/data.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import type { ListItemEntity } from '@spots/shared';

  /**
   * Vocabulary manager: fix typos (rename) and remove accidentally added
   * species/plants. Items referenced by spots can be renamed but not
   * deleted — deleting them would orphan those spots.
   */
  let kind = $state<'species' | 'plant'>('species');
  let query = $state('');
  let editing = $state<ListItemEntity | null>(null);
  let editName = $state('');
  let sheetOpen = $state(false);
  let confirmDelete = $state(false);
  let cropOpen = $state(false);
  let cropFile = $state<Blob | null>(null);
  let iconInput = $state<HTMLInputElement | null>(null);

  /** Live view of the item being edited (upserts replace the entity). */
  const editingLive = $derived(
    editing ? ((data.entities.get(editing.id) as ListItemEntity | undefined) ?? editing) : null
  );
  const iconPhotoId = $derived(editingLive ? data.itemIconPhotoId(editingLive.id) : null);

  const q = $derived(query.trim().toLowerCase());
  const items = $derived(
    data.listItems(kind).filter((i) => !q || i.data.name.toLowerCase().includes(q))
  );
  const usage = $derived(editing ? data.itemUsageCount(editing.id) : 0);
  const duplicate = $derived(
    editing !== null &&
      data
        .listItems(kind)
        .some((i) => i.id !== editing!.id && i.data.name.toLowerCase() === editName.trim().toLowerCase())
  );

  function openItem(item: ListItemEntity): void {
    editing = item;
    editName = item.data.name;
    sheetOpen = true;
  }

  async function rename(): Promise<void> {
    if (!editing || !editName.trim() || duplicate) return;
    await data.upsert('listItem', editing.id, { ...editing.data, name: editName.trim() });
    sheetOpen = false;
    toasts.show('Renamed.');
  }

  async function remove(): Promise<void> {
    if (!editingLive) return;
    const oldIcon = editingLive.data.iconPhotoId;
    await data.deleteListItem(editingLive.id);
    if (oldIcon) await data.removePhotos([oldIcon]);
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
  </div>

  <div class="searchbox">
    <Icon name="search" size={20} />
    <input class="input" placeholder="Search…" bind:value={query} maxlength="200" />
  </div>

  {#if items.length === 0}
    <div class="empty">
      <div class="big">{kind === 'species' ? '🍄' : '🌳'}</div>
      <p>
        {#if data.listItems(kind).length === 0}
          Nothing here yet — names are added on the fly while saving spots.
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
        {count === 0 ? 'not used' : `${count} spot${count === 1 ? '' : 's'}`}
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

    <div class="del">
      {#if usage > 0}
        <p class="note">
          Used by {usage} spot{usage === 1 ? '' : 's'} — it can't be deleted. Rename it here, or
          change those spots first.
        </p>
      {/if}
      <button
        class="btn danger"
        disabled={usage > 0 || boot.readOnly}
        onclick={() => (confirmDelete = true)}
      >
        <Icon name="trash" size={20} /> Delete
      </button>
    </div>
  {/if}
</BottomSheet>

<ConfirmDialog
  bind:open={confirmDelete}
  title={`Delete “${editing?.data.name}”?`}
  message="It will disappear from the selector on all your devices."
  onConfirm={() => void remove()}
/>
<CropSheet bind:open={cropOpen} file={cropFile} onDone={(blob) => void onCropped(blob)} />

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
</style>
