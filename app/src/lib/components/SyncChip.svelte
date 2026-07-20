<script lang="ts">
  import { session } from '$lib/state/session.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { engine, type SyncStatus } from '$lib/sync/engine.svelte';
  import Icon from './Icon.svelte';

  /** Tap = sync now. Shows state + pending count at a glance. */
  let conflictOpen = $state(false);
  let newName = $state('');
  let renameError = $state<string | null>(null);

  const label = $derived.by(() => {
    switch (engine.status) {
      case 'syncing':
        return engine.progress ?? 'Syncing…';
      case 'offline':
        return engine.pendingCount > 0 ? `Offline · ${engine.pendingCount} pending` : 'Offline';
      case 'error':
        return 'Sync error';
      case 'conflict':
        return 'Action needed';
      case 'readonly':
        return 'Read-only';
      default:
        return engine.pendingCount > 0 ? `${engine.pendingCount} pending` : 'Synced';
    }
  });

  async function tap(): Promise<void> {
    if (engine.status === 'conflict') {
      newName = session.current?.username ?? '';
      conflictOpen = true;
      return;
    }
    await engine.sync();
    // (sync() mutates status — widen so TS doesn't narrow it away)
    if ((engine.status as SyncStatus) === 'conflict') {
      newName = session.current?.username ?? '';
      conflictOpen = true;
    } else if ((engine.status as SyncStatus) === 'idle' && engine.pendingCount === 0) {
      // Manual sync deserves visible confirmation, even when there was nothing to do.
      toasts.show('Up to date.');
    }
  }

  async function loginInstead(): Promise<void> {
    renameError = null;
    const ok = await engine.resolveConflictLogin();
    if (ok) conflictOpen = false;
    else renameError = 'Password does not match that account. Pick a new name instead.';
  }

  async function rename(): Promise<void> {
    const name = newName.trim();
    if (!name) return;
    renameError = null;
    await engine.resolveConflictRename(name);
    conflictOpen = false;
  }
</script>

<button class="chip syncchip {engine.status}" onclick={() => void tap()} aria-label="Sync status — tap to sync">
  <span class="icon" class:spin={engine.status === 'syncing'}><Icon name="sync" size={17} /></span>
  <span>{label}</span>
</button>

{#if conflictOpen}
  <div class="backdrop" role="presentation"></div>
  <div class="dialog card" role="alertdialog" aria-modal="true" aria-label="Username taken">
    <h2>Username “{session.current?.username}” is taken</h2>
    <p class="note">
      Someone already registered this name on the server. Your finds are safe on this device either
      way.
    </p>
    <button class="btn" onclick={() => void loginInstead()}>This is my account — log in</button>
    <div class="or">or pick a new name</div>
    <input class="input" maxlength="64" bind:value={newName} placeholder="New username" autocapitalize="off" />
    {#if renameError}<p class="err">{renameError}</p>{/if}
    <div class="row">
      <button class="btn secondary" onclick={() => (conflictOpen = false)}>Later</button>
      <button class="btn" onclick={() => void rename()} disabled={!newName.trim()}>Rename</button>
    </div>
  </div>
{/if}

<style>
  .syncchip {
    box-shadow: var(--shadow);
    border: none;
    font-weight: 700;
  }
  .syncchip.error,
  .syncchip.conflict {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .syncchip.offline,
  .syncchip.readonly {
    background: var(--amber-soft);
    color: var(--amber);
  }
  .icon {
    display: inline-flex;
  }
  .spin {
    animation: spin 1.2s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
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
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .or {
    text-align: center;
    color: var(--ink-soft);
    font-size: 14px;
  }
  .err {
    color: var(--danger);
    font-size: 14px;
    margin: 0;
  }
  .row {
    display: flex;
    gap: 10px;
  }
  .row .btn {
    flex: 1;
  }
</style>
