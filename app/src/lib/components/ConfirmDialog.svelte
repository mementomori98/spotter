<script lang="ts">
  import { fade, fly } from 'svelte/transition';

  let {
    open = $bindable(false),
    title,
    message = '',
    confirmLabel = 'Delete',
    danger = true,
    onConfirm
  }: {
    open: boolean;
    title: string;
    message?: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  } = $props();

  const reduced =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  <div class="backdrop" transition:fade={{ duration: reduced ? 0 : 120 }} role="presentation"></div>
  <div class="center-layer">
    <div
      class="dialog card"
      transition:fly={{ y: 14, duration: reduced ? 0 : 160 }}
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
    >
      <h2>{title}</h2>
      {#if message}<p>{message}</p>{/if}
      <div class="actions">
        <button class="btn secondary" onclick={() => (open = false)}>Cancel</button>
        <button
          class="btn"
          class:danger
          onclick={() => {
            open = false;
            onConfirm();
          }}>{confirmLabel}</button
        >
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 70;
    background: rgba(10, 20, 12, 0.45);
  }
  /* Centering wrapper: the card itself carries no transform, so Svelte's
     fly transition can animate it without fighting a translateY(-50%). */
  .center-layer {
    position: fixed;
    inset: 0;
    z-index: 71;
    display: grid;
    place-items: center;
    padding: 24px;
    pointer-events: none;
  }
  .dialog {
    pointer-events: auto;
    width: 100%;
    max-width: 420px;
    padding: 20px;
  }
  .dialog p {
    color: var(--ink-soft);
  }
  .actions {
    display: flex;
    gap: 12px;
    margin-top: 16px;
  }
  .actions .btn {
    flex: 1;
  }
  .btn.danger {
    background: var(--danger);
    color: #fff;
  }
</style>
