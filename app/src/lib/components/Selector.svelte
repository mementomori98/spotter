<script lang="ts">
  import { data } from '$lib/state/data.svelte';
  import { newId } from '$lib/util/ids';
  import BottomSheet from './BottomSheet.svelte';
  import Icon from './Icon.svelte';

  /**
   * The "selector" from spots.md: bottom sheet, search-first, recent 5 on
   * top, create-on-the-spot. Vocabularies are per-account synced entities.
   */
  let {
    open = $bindable(false),
    kind,
    title,
    multi = false,
    selected = [],
    exclude = [],
    onDone
  }: {
    open: boolean;
    kind: 'species' | 'plant';
    title: string;
    multi?: boolean;
    selected?: string[];
    exclude?: string[];
    onDone: (ids: string[]) => void;
  } = $props();

  let query = $state('');
  let picked = $state<string[]>([]);
  let inputEl = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (open) {
      query = '';
      picked = [...selected];
      // Keyboard up immediately — zero wasted taps.
      setTimeout(() => inputEl?.focus(), 60);
    }
  });

  const all = $derived(data.listItems(kind).filter((i) => !exclude.includes(i.id)));
  const q = $derived(query.trim().toLowerCase());
  const filtered = $derived(q ? all.filter((i) => i.data.name.toLowerCase().includes(q)) : all);
  const recents = $derived(
    [...all]
      .filter((i) => i.data.lastUsedAt > 0)
      .sort((a, b) => b.data.lastUsedAt - a.data.lastUsedAt)
      .slice(0, 5)
  );
  const exactMatch = $derived(all.find((i) => i.data.name.toLowerCase() === q));

  async function createItem(): Promise<void> {
    const name = query.trim();
    if (!name) return;
    if (exactMatch) {
      choose(exactMatch.id);
      return;
    }
    const id = newId();
    await data.upsert('listItem', id, { kind, name, lastUsedAt: Date.now() });
    choose(id);
  }

  function choose(id: string): void {
    if (multi) {
      picked = picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id];
    } else {
      finish([id]);
    }
  }

  function finish(ids: string[]): void {
    // Bump recency for chosen items (drives the "Recent" section).
    for (const id of ids) {
      const item = data.entities.get(id);
      if (item?.data && item.type === 'listItem') {
        void data.upsert('listItem', id, { ...(item.data as { kind: 'species'; name: string; lastUsedAt: number }), lastUsedAt: Date.now() });
      }
    }
    open = false;
    onDone(ids);
  }
</script>

<BottomSheet bind:open {title}>
  <div class="search">
    <Icon name="search" size={20} />
    <input
      bind:this={inputEl}
      bind:value={query}
      class="input"
      type="text"
      maxlength="200"
      placeholder="Search or add new…"
      autocomplete="off"
      enterkeyhint={q && !exactMatch ? 'done' : 'search'}
      onkeydown={(e) => {
        if (e.key === 'Enter' && q) void createItem();
      }}
    />
  </div>

  {#if q && !exactMatch}
    <button class="row create" onclick={() => void createItem()}>
      <Icon name="plus" size={22} />
      <span>Create “{query.trim()}”</span>
    </button>
  {/if}
  {#if q && exactMatch}
    <p class="note dup">“{exactMatch.data.name}” is already in your list — tap it below.</p>
  {/if}

  {#if !q && recents.length > 0}
    <p class="section">Recent</p>
    {#each recents as item (item.id)}
      <button class="row" class:checked={picked.includes(item.id)} onclick={() => choose(item.id)}>
        <span class="name">{item.data.name}</span>
        {#if picked.includes(item.id)}<Icon name="check" size={22} />{/if}
      </button>
    {/each}
    <p class="section">All</p>
  {/if}

  {#if filtered.length === 0 && !q}
    <p class="note" style="padding: 12px 4px">
      Nothing here yet — type a name above to add your first {kind === 'species' ? 'species' : 'tree or plant'}.
    </p>
  {/if}

  {#each filtered as item (item.id)}
    <button class="row" class:checked={picked.includes(item.id)} onclick={() => choose(item.id)}>
      <span class="name">{item.data.name}</span>
      {#if picked.includes(item.id)}<Icon name="check" size={22} />{/if}
    </button>
  {/each}

  {#if multi}
    <div class="donebar">
      <button class="btn" onclick={() => finish(picked)}>
        Done{picked.length ? ` (${picked.length})` : ''}
      </button>
    </div>
  {/if}
</BottomSheet>

<style>
  .search {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
    color: var(--ink-soft);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    min-height: var(--tap);
    padding: 8px 10px;
    border: none;
    background: transparent;
    border-bottom: 1px solid var(--line);
    font-size: 18px;
    text-align: left;
    cursor: pointer;
    color: var(--ink);
  }
  .row .name {
    flex: 1;
  }
  .row {
    transition: background-color 0.12s ease;
  }
  .row:active {
    background: var(--accent-soft);
  }
  .row.checked {
    color: var(--accent-dark);
    font-weight: 700;
  }
  .row.create {
    color: var(--accent-dark);
    font-weight: 700;
    justify-content: flex-start;
    gap: 10px;
    border-bottom: none;
    background: var(--accent-soft);
    border-radius: var(--radius);
    margin-bottom: 8px;
  }
  .dup {
    margin: 0 4px 8px;
  }
  .section {
    font-size: 13px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ink-soft);
    margin: 14px 4px 4px;
  }
  .donebar {
    position: sticky;
    bottom: 0;
    padding-top: 12px;
    background: var(--card);
  }
  .donebar .btn {
    width: 100%;
  }
</style>
