<script lang="ts">
  import { data } from '$lib/state/data.svelte';

  /**
   * Renders a stored photo via a blob object URL, created on mount and
   * revoked on destroy — blobs never sit in app state.
   */
  let {
    photoId = null,
    hash = null,
    ext = null,
    alt = 'Photo'
  }: { photoId?: string | null; hash?: string | null; ext?: string | null; alt?: string } = $props();

  let url = $state<string | null>(null);
  let loaded = $state(false);

  $effect(() => {
    let cancelled = false;
    let created: string | null = null;
    const resolve = async () => {
      let h = hash;
      let x = ext;
      if (photoId) {
        const photo = data.getPhoto(photoId);
        if (photo) {
          h = photo.data.hash;
          x = photo.data.ext;
        }
      }
      if (!h || !x) return;
      const blob = await data.store.getBlob(h, x);
      if (!blob) return;
      if (cancelled) return; // effect re-ran before we resolved — don't leak
      created = URL.createObjectURL(blob);
      url = created;
    };
    void resolve();
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  });
</script>

{#if url}
  <img src={url} {alt} loading="lazy" class:ready={loaded} onload={() => (loaded = true)} />
{:else}
  <div class="placeholder" aria-label="Photo not downloaded yet">🍄</div>
{/if}

<style>
  img,
  .placeholder {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 10px;
    display: block;
  }
  img {
    background: var(--green-soft); /* colored while decoding */
    opacity: 0;
    transition: opacity 0.18s ease;
  }
  img.ready {
    opacity: 1;
  }
  .placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--green-soft);
    font-size: 28px;
    opacity: 0.6;
  }
</style>
