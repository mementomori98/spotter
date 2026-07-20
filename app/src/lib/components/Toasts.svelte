<script lang="ts">
  import { toasts } from '$lib/state/toasts.svelte';
  import { flip } from 'svelte/animate';
  import { fly } from 'svelte/transition';

  const reduced =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
</script>

<div class="toasts" aria-live="polite">
  {#each toasts.list as toast (toast.id)}
    <div
      class="toast {toast.kind}"
      transition:fly={{ y: 16, duration: reduced ? 0 : 180 }}
      animate:flip={{ duration: reduced ? 0 : 150 }}
    >
      <span>{toast.message}</span>
      {#each toast.actions ?? [] as action (action.label)}
        <button
          onclick={() => {
            action.fn();
            toasts.dismiss(toast.id);
          }}>{action.label}</button
        >
      {/each}
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 12px;
    right: 12px;
    bottom: calc(var(--nav-h) + 12px);
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    background: var(--ink);
    color: #fff;
    padding: 14px 16px;
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    font-size: 16px;
  }
  .toast.warn {
    background: var(--amber);
  }
  .toast.error {
    background: var(--danger);
  }
  .toast button {
    border: none;
    background: rgba(255, 255, 255, 0.2);
    color: #fff;
    font-weight: 800;
    padding: 8px 14px;
    border-radius: 10px;
    min-height: 44px;
    cursor: pointer;
  }
</style>
