<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fade, fly } from 'svelte/transition';

  let {
    open = $bindable(false),
    title = '',
    children
  }: { open: boolean; title?: string; children: Snippet } = $props();

  const reduced =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The page behind an open sheet must not scroll along with touch drags.
  $effect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  });
</script>

{#if open}
  <div
    class="backdrop"
    transition:fade={{ duration: reduced ? 0 : 150 }}
    onclick={() => (open = false)}
    onkeydown={(e) => e.key === 'Escape' && (open = false)}
    role="button"
    tabindex="-1"
    aria-label="Close"
  ></div>
  <div
    class="sheet"
    transition:fly={{ y: 320, duration: reduced ? 0 : 220 }}
    role="dialog"
    aria-modal="true"
    aria-label={title}
  >
    <div class="grab"></div>
    {#if title}<h2>{title}</h2>{/if}
    {@render children()}
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgba(10, 20, 12, 0.45);
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 61;
    max-height: 86dvh;
    overflow-y: auto;
    background: var(--card);
    border-radius: 20px 20px 0 0;
    padding: 8px 16px calc(20px + env(safe-area-inset-bottom, 0px));
    box-shadow: 0 -6px 30px rgba(0, 0, 0, 0.25);
    max-width: 720px;
    margin: 0 auto;
  }
  .grab {
    width: 44px;
    height: 5px;
    border-radius: 3px;
    background: var(--line);
    margin: 6px auto 10px;
  }
  h2 {
    font-size: 19px;
    margin-bottom: 12px;
  }
</style>
