<script lang="ts">
  import BottomSheet from '$lib/components/BottomSheet.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import Icon from '$lib/components/Icon.svelte';
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
    if (!editing) return;
    await data.deleteListItem(editing.id);
    sheetOpen = false;
    toasts.show(`Deleted “${editing.data.name}”.`);
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
    <button class="row card" onclick={() => openItem(item)}>
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
</style>
