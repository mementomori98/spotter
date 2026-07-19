<script lang="ts">
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
</script>

{#if open}
  <div class="backdrop" role="presentation"></div>
  <div class="dialog card" role="alertdialog" aria-modal="true" aria-label={title}>
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
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 70;
    background: rgba(10, 20, 12, 0.45);
  }
  .dialog {
    position: fixed;
    z-index: 71;
    left: 24px;
    right: 24px;
    top: 50%;
    transform: translateY(-50%);
    max-width: 420px;
    margin: 0 auto;
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
