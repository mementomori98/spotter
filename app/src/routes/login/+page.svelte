<script lang="ts">
  import { goto } from '$app/navigation';
  import { boot } from '$lib/state/boot.svelte';
  import { session } from '$lib/state/session.svelte';
  import type { AuthResponse } from '@spots/shared';

  let mode = $state<'create' | 'login'>('create');
  let username = $state('');
  let password = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);

  const valid = $derived(username.trim().length > 0 && password.length > 0);

  async function submit(): Promise<void> {
    if (!valid || busy) return;
    busy = true;
    error = null;
    try {
      if (mode === 'create') {
        // Works fully offline: the account registers with the server at first sync.
        await session.create(username, password);
        await boot.afterLogin();
        await goto('/', { replaceState: true });
        return;
      }
      // Log in to an existing account (needs the server once, to fetch your data).
      let res: Response;
      try {
        res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: username.trim().toLowerCase(), password })
        });
      } catch {
        error = 'Server unreachable. If this is a new account, use “Start fresh” — it works offline.';
        return;
      }
      if (res.status === 401) {
        error = 'Wrong username or password.';
        return;
      }
      if (!res.ok) {
        error = `Login failed (${res.status}).`;
        return;
      }
      const body = (await res.json()) as AuthResponse;
      await session.create(body.username, password);
      await session.update({ token: body.token, userId: body.userId, registered: true });
      await boot.afterLogin();
      await goto('/', { replaceState: true });
    } finally {
      busy = false;
    }
  }
</script>

<div class="wrap">
  <div class="logo">🍄</div>
  <h1>Spots</h1>
  <p class="tagline">Your mushroom finds, mapped. Works offline in the forest.</p>

  <div class="tabs" role="tablist">
    <button role="tab" aria-selected={mode === 'create'} class:active={mode === 'create'} onclick={() => (mode = 'create')}>
      Start fresh
    </button>
    <button role="tab" aria-selected={mode === 'login'} class:active={mode === 'login'} onclick={() => (mode = 'login')}>
      I have an account
    </button>
  </div>

  <form
    onsubmit={(e) => {
      e.preventDefault();
      void submit();
    }}
  >
    <label class="field">
      <span class="label">Username</span>
      <input class="input" maxlength="64" bind:value={username} autocapitalize="off" autocomplete="username" />
    </label>
    <label class="field">
      <span class="label">Password</span>
      <input class="input" type="password" maxlength="256" bind:value={password} autocomplete="current-password" />
    </label>

    {#if mode === 'create'}
      <p class="note">
        No email, no recovery — <strong>write your password down</strong>. A lost password means a
        lost account (your finds stay on this device).
      </p>
    {/if}
    {#if error}<p class="error">{error}</p>{/if}

    <button class="btn wide" type="submit" disabled={!valid || busy}>
      {busy ? 'One moment…' : mode === 'create' ? 'Create account' : 'Log in'}
    </button>
  </form>
</div>

<style>
  .wrap {
    max-width: 420px;
    margin: 0 auto;
    padding: 48px 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    text-align: center;
  }
  .logo {
    font-size: 64px;
  }
  .tagline {
    color: var(--ink-soft);
    margin: 0 0 12px;
  }
  .tabs {
    display: flex;
    background: var(--green-soft);
    border-radius: var(--radius);
    padding: 4px;
    margin-bottom: 8px;
  }
  .tabs button {
    flex: 1;
    min-height: 48px;
    border: none;
    border-radius: 11px;
    background: transparent;
    font-weight: 700;
    color: var(--green-dark);
    cursor: pointer;
  }
  .tabs button.active {
    background: var(--card);
    box-shadow: var(--shadow);
  }
  form {
    text-align: left;
    display: flex;
    flex-direction: column;
  }
  .wide {
    width: 100%;
  }
  .error {
    color: var(--danger);
    font-weight: 600;
  }
</style>
