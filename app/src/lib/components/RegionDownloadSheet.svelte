<script lang="ts">
  import type { ViewState } from '$lib/components/MapView.svelte';
  import { boot } from '$lib/state/boot.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { MAX_REGION_TILES, downloadRegion, estimateRegion } from '$lib/map/regions';
  import { fmtBytes } from '$lib/util/format';
  import BottomSheet from './BottomSheet.svelte';

  let {
    open = $bindable(false),
    view,
    satellite
  }: { open: boolean; view: ViewState | null; satellite: boolean } = $props();

  let zMax = $state(16);
  let name = $state('');
  let downloading = $state(false);
  let progress = $state({ done: 0, total: 0 });
  let abort: AbortController | null = null;

  const zMin = $derived(view ? Math.max(1, Math.floor(view.zoom)) : 10);
  const layer = $derived(satellite ? ('sat' as const) : ('base' as const));
  const estimate = $derived(
    view ? estimateRegion(view.bbox, zMin, Math.max(zMin, zMax), layer) : null
  );
  const tooBig = $derived((estimate?.count ?? 0) > MAX_REGION_TILES);

  $effect(() => {
    if (open) {
      zMax = view ? Math.min(17, Math.max(Math.floor(view.zoom) + 3, 15)) : 16;
      name = `Trip ${new Date().toLocaleDateString('en-GB')}`;
      downloading = false;
      progress = { done: 0, total: 0 };
    }
  });

  async function start(): Promise<void> {
    if (!view || !estimate || tooBig || downloading) return;
    downloading = true;
    abort = new AbortController();
    const template = satellite ? boot.settings.satTileUrl : boot.settings.baseTileUrl;
    try {
      const region = await downloadRegion(
        { name: name.trim() || 'Offline area', bbox: view.bbox, zMin, zMax: Math.max(zMin, zMax), layer, template },
        (done, total) => (progress = { done, total }),
        abort.signal
      );
      if (region) {
        toasts.show(`Offline area saved (${region.tileCount} tiles).`);
        open = false;
      } else {
        toasts.show('Download cancelled.', { kind: 'warn' });
      }
    } catch (err) {
      toasts.show('Download failed: ' + (err instanceof Error ? err.message : String(err)), { kind: 'error' });
    } finally {
      downloading = false;
    }
  }
</script>

<BottomSheet bind:open title="Download this area for offline">
  <p class="note">
    Saves the map you currently see, down to street level, so it works with no signal. Manage saved
    areas in Settings.
  </p>

  <label class="field">
    <span class="label">Name</span>
    <input class="input" bind:value={name} disabled={downloading} />
  </label>

  <div class="field">
    <span class="label">Detail level (max zoom: {Math.max(zMin, zMax)})</span>
    <input type="range" min={zMin} max="17" bind:value={zMax} disabled={downloading} />
  </div>

  {#if estimate}
    <p class="estimate" class:bad={tooBig}>
      {estimate.count.toLocaleString()} tiles · about {fmtBytes(estimate.bytes)}
      {#if tooBig}— too large, zoom in or lower the detail level{/if}
    </p>
  {/if}

  {#if downloading}
    <progress value={progress.done} max={progress.total || 1}></progress>
    <p class="note">{progress.done} / {progress.total} tiles</p>
    <button class="btn danger wide" onclick={() => abort?.abort()}>Cancel</button>
  {:else}
    <button class="btn wide" onclick={() => void start()} disabled={!view || tooBig}>
      Download ({satellite ? 'satellite' : 'map'} layer)
    </button>
  {/if}
</BottomSheet>

<style>
  input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
    min-height: 44px;
  }
  progress {
    width: 100%;
    height: 12px;
    accent-color: var(--accent);
  }
  .estimate {
    font-weight: 700;
  }
  .estimate.bad {
    color: var(--danger);
  }
  .wide {
    width: 100%;
  }
</style>
