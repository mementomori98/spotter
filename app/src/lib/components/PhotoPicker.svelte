<script lang="ts">
  import { ingestFile } from '$lib/photos/photos';
  import type { DraftPhoto } from '$lib/storage/types';
  import { toasts } from '$lib/state/toasts.svelte';
  import Icon from './Icon.svelte';
  import PhotoImg from './PhotoImg.svelte';

  /**
   * Camera + gallery capture. Files are hashed and persisted the moment
   * they're picked (Android can kill the PWA while the camera is open),
   * then live in the form draft until save.
   */
  let {
    photos = $bindable([] as DraftPhoto[]),
    label = 'Photos'
  }: { photos: DraftPhoto[]; label?: string } = $props();

  let cameraInput = $state<HTMLInputElement | null>(null);
  let galleryInput = $state<HTMLInputElement | null>(null);
  let busy = $state(false);

  async function onFiles(list: FileList | null): Promise<void> {
    if (!list || list.length === 0) return;
    busy = true;
    try {
      for (const file of Array.from(list)) {
        const draft = await ingestFile(file);
        if (!photos.some((p) => p.hash === draft.hash)) photos = [...photos, draft];
      }
    } catch (err) {
      toasts.show('Could not add photo: ' + (err instanceof Error ? err.message : String(err)), {
        kind: 'error'
      });
    } finally {
      busy = false;
    }
  }

  function remove(hash: string): void {
    photos = photos.filter((p) => p.hash !== hash);
  }
</script>

<div class="picker">
  <div class="buttons">
    <button type="button" class="btn secondary" onclick={() => cameraInput?.click()} disabled={busy}>
      <Icon name="camera" size={22} /> Camera
    </button>
    <button type="button" class="btn secondary" onclick={() => galleryInput?.click()} disabled={busy}>
      <Icon name="image" size={22} /> Gallery
    </button>
  </div>

  {#if photos.length > 0}
    <div class="thumbs">
      {#each photos as photo (photo.hash)}
        <div class="thumb">
          <PhotoImg hash={photo.hash} ext={photo.ext} alt={label} />
          <button type="button" class="remove" aria-label="Remove photo" onclick={() => remove(photo.hash)}>
            <Icon name="x" size={18} />
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <input
    bind:this={cameraInput}
    type="file"
    accept="image/*"
    capture="environment"
    hidden
    onchange={(e) => {
      void onFiles(e.currentTarget.files);
      e.currentTarget.value = '';
    }}
  />
  <input
    bind:this={galleryInput}
    type="file"
    accept="image/*"
    multiple
    hidden
    onchange={(e) => {
      void onFiles(e.currentTarget.files);
      e.currentTarget.value = '';
    }}
  />
</div>

<style>
  .buttons {
    display: flex;
    gap: 12px;
  }
  .buttons .btn {
    flex: 1;
  }
  .thumbs {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 10px;
    margin-top: 12px;
  }
  .thumb {
    position: relative;
    aspect-ratio: 1;
  }
  .remove {
    position: absolute;
    top: -8px;
    right: -8px;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: none;
    background: var(--ink);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: var(--shadow);
  }
</style>
