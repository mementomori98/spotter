<script lang="ts">
  import { page } from '$app/state';
  import SpotForm from '$lib/components/SpotForm.svelte';
  import { data } from '$lib/state/data.svelte';

  const spot = $derived(data.getSpot(page.params.id!));
</script>

<svelte:head><title>Spots — Edit spot</title></svelte:head>

<div class="sheet-page">
  {#if spot}
    {#key spot.id}
      <SpotForm {spot} />
    {/key}
  {:else}
    <div class="empty">
      <div class="big">🤷</div>
      <p>This spot doesn't exist.</p>
      <a class="btn" href="/">Back to map</a>
    </div>
  {/if}
</div>
