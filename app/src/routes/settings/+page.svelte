<script lang="ts">
  import { exportBackup, importBackup } from '$lib/backup/backup';
  import Icon from '$lib/components/Icon.svelte';
  import SyncChip from '$lib/components/SyncChip.svelte';
  import { deleteRegion, listRegions, type OfflineRegion } from '$lib/map/regions';
  import { boot } from '$lib/state/boot.svelte';
  import { data } from '$lib/state/data.svelte';
  import { session } from '$lib/state/session.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { engine } from '$lib/sync/engine.svelte';
  import { fmtBytes, fmtDateTime } from '$lib/util/format';
  import { DEFAULT_SETTINGS } from '$lib/storage/types';
  import { onMount } from 'svelte';

  let regions = $state<OfflineRegion[]>([]);
  let busyMsg = $state<string | null>(null);
  let importInput = $state<HTMLInputElement | null>(null);
  let baseUrl = $state('');
  let satUrl = $state('');

  onMount(async () => {
    regions = await listRegions();
    baseUrl = boot.settings.baseTileUrl;
    satUrl = boot.settings.satTileUrl;
  });

  const canPickFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  async function doExport(): Promise<void> {
    busyMsg = 'Preparing export…';
    try {
      await exportBackup((msg) => (busyMsg = msg));
      toasts.show('Backup exported.');
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        toasts.show('Export failed: ' + (err instanceof Error ? err.message : String(err)), { kind: 'error' });
      }
    } finally {
      busyMsg = null;
    }
  }

  async function doImport(file: File | undefined): Promise<void> {
    if (!file) return;
    busyMsg = 'Importing…';
    try {
      const n = await importBackup(file, (msg) => (busyMsg = msg));
      toasts.show(`Imported ${n} item(s).`);
    } catch (err) {
      toasts.show('Import failed: ' + (err instanceof Error ? err.message : String(err)), { kind: 'error' });
    } finally {
      busyMsg = null;
    }
  }

  async function pickFolder(): Promise<void> {
    try {
      if (await boot.adoptFolder()) {
        toasts.show('Data now lives in your folder — photos and data are real files.');
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        toasts.show('Could not switch: ' + (err instanceof Error ? err.message : String(err)), { kind: 'error' });
      }
    }
  }

  async function removeRegion(id: string): Promise<void> {
    await deleteRegion(id);
    regions = await listRegions();
    toasts.show('Offline area removed.');
  }

  async function saveTileUrls(): Promise<void> {
    await boot.updateSettings({ baseTileUrl: baseUrl.trim(), satTileUrl: satUrl.trim() });
    navigator.serviceWorker?.controller?.postMessage('TILE_PREFIXES_CHANGED');
    toasts.show('Tile sources saved. Note: providers without CORS cannot be cached offline.');
  }

  async function resetTileUrls(): Promise<void> {
    baseUrl = DEFAULT_SETTINGS.baseTileUrl;
    satUrl = DEFAULT_SETTINGS.satTileUrl;
    await saveTileUrls();
  }

  const spotCount = $derived(data.liveSpots().length);
  const photoCount = $derived(data.livePhotos().length);
</script>

<svelte:head><title>Spots — Settings</title></svelte:head>

<div class="page">
  <div class="topbar">
    <h1>Settings</h1>
    <SyncChip />
  </div>

  {#if boot.persistDenied}
    <div class="warn-banner">
      ⚠️ The browser did not grant persistent storage — your data could be evicted if disk runs
      low. Install the app (Add to Home Screen) and export backups regularly.
    </div>
  {/if}

  <section class="card">
    <h2>Account</h2>
    <p><strong>{session.current?.username}</strong></p>
    <p class="note">
      Synced to the server this app is installed from.
      {#if engine.lastSyncAt}Last sync: {fmtDateTime(engine.lastSyncAt)}.{/if}
      {spotCount} spot{spotCount === 1 ? '' : 's'}, {photoCount} photo{photoCount === 1 ? '' : 's'}.
    </p>
    <p class="note">No password recovery exists — keep your password written down somewhere safe.</p>
    <button class="btn secondary" onclick={() => void engine.sync()}>
      <Icon name="sync" size={20} /> Sync now
    </button>
    {#if engine.errorMsg}<p class="err">{engine.errorMsg}</p>{/if}
  </section>

  <section class="card">
    <h2>Storage</h2>
    {#if boot.settings.storageMode === 'fs'}
      <p class="note">✅ Your data and photos are real files in the folder you picked.</p>
    {:else}
      <p class="note">Data is stored in the browser's persistent storage on this device.</p>
      {#if canPickFolder}
        <button class="btn secondary" onclick={() => void pickFolder()}>
          <Icon name="folder" size={20} /> Store data in a folder…
        </button>
        <p class="note small">Recommended on desktop: files stay visible and survive browser resets.</p>
      {/if}
    {/if}
  </section>

  <section class="card">
    <h2>Backup</h2>
    <div class="row">
      <button class="btn secondary" onclick={() => void doExport()} disabled={busyMsg !== null}>
        <Icon name="download" size={20} /> Export (zip)
      </button>
      <button class="btn secondary" onclick={() => importInput?.click()} disabled={busyMsg !== null}>
        <Icon name="upload" size={20} /> Import
      </button>
    </div>
    {#if busyMsg}<p class="note">{busyMsg}</p>{/if}
    <input
      bind:this={importInput}
      type="file"
      accept=".zip,application/zip"
      hidden
      onchange={(e) => {
        void doImport(e.currentTarget.files?.[0]);
        e.currentTarget.value = '';
      }}
    />
  </section>

  <section class="card">
    <h2>Offline map areas</h2>
    {#if regions.length === 0}
      <p class="note">
        None yet. On the map, tap <Icon name="download" size={15} /> to save the visible area for
        offline use before a trip.
      </p>
    {/if}
    {#each regions as region (region.id)}
      <div class="region">
        <div>
          <strong>{region.name}</strong>
          <span class="note small">
            {region.layer === 'sat' ? 'satellite' : 'map'} · z{region.zMin}–{region.zMax} ·
            {region.tileCount.toLocaleString()} tiles · {fmtBytes(region.sizeBytes)}
          </span>
        </div>
        <button class="iconbtn" aria-label="Delete offline area" onclick={() => void removeRegion(region.id)}>
          <Icon name="trash" size={20} />
        </button>
      </div>
    {/each}
  </section>

  <section class="card">
    <h2>Map tile sources</h2>
    <label class="field">
      <span class="label">Base map URL template</span>
      <input class="input mono" bind:value={baseUrl} />
    </label>
    <label class="field">
      <span class="label">Satellite URL template</span>
      <input class="input mono" bind:value={satUrl} />
    </label>
    <div class="row">
      <button class="btn secondary" onclick={() => void resetTileUrls()}>Reset</button>
      <button class="btn" onclick={() => void saveTileUrls()}>Save</button>
    </div>
    <p class="note small">
      Use {'{z}/{x}/{y}'} placeholders. Providers must send CORS headers for offline caching to
      work; respect their usage policies.
    </p>
  </section>

  <p class="note center">Spots v1.0 · offline-first · your data stays on your server</p>
</div>

<style>
  section {
    padding: 16px;
    margin-bottom: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  h2 {
    font-size: 16px;
    color: var(--green-dark);
  }
  section p {
    margin: 0;
  }
  .row {
    display: flex;
    gap: 10px;
  }
  .row .btn {
    flex: 1;
  }
  .region {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    border-top: 1px solid var(--line);
    padding-top: 10px;
  }
  .region strong {
    display: block;
  }
  .small {
    font-size: 13px;
  }
  .mono {
    font-family: ui-monospace, monospace;
    font-size: 13px;
  }
  .err {
    color: var(--danger);
    font-size: 14px;
  }
  .center {
    text-align: center;
    margin: 24px 0;
  }
</style>
