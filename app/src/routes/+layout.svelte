<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import '../app.css';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import Toasts from '$lib/components/Toasts.svelte';
  import { sweepExportTemp } from '$lib/backup/backup';
  import { location } from '$lib/geo/location.svelte';
  import { boot } from '$lib/state/boot.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { onMount, type Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

  onMount(() => {
    void boot.boot();
    void sweepExportTemp();
    registerServiceWorker();
  });

  // Route guard: no session -> /login; session -> keep out of /login.
  $effect(() => {
    if (boot.phase === 'login' && page.url.pathname !== '/login') void goto('/login', { replaceState: true });
    if (boot.phase === 'ready' && page.url.pathname === '/login') void goto('/', { replaceState: true });
  });

  $effect(() => {
    if (boot.phase === 'ready') location.start();
  });

  const showNav = $derived(
    boot.phase === 'ready' && ['/', '/list', '/settings'].includes(page.url.pathname)
  );

  function registerServiceWorker(): void {
    if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
    void navigator.serviceWorker.register('/service-worker.js').then((reg) => {
      // Update lifecycle: toast -> user tap -> SKIP_WAITING -> reload.
      reg.addEventListener('updatefound', () => {
        const fresh = reg.installing;
        fresh?.addEventListener('statechange', () => {
          if (fresh.state === 'installed' && navigator.serviceWorker.controller) {
            toasts.show('Update available.', {
              action: { label: 'Reload', fn: () => fresh.postMessage('SKIP_WAITING') },
              timeout: 30_000
            });
          }
        });
      });
    });
    let refreshed = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshed) {
        refreshed = true;
        window.location.reload();
      }
    });
  }
</script>

{#if boot.phase === 'loading'}
  <div class="center"><div class="spinner" aria-label="Loading"></div></div>
{:else if boot.phase === 'fs-permission'}
  <div class="center col">
    <h1>📂 Folder access</h1>
    <p>Spots stores your data in the folder you chose. Grant access to continue.</p>
    <button class="btn" onclick={() => void boot.grantFsPermission()}>Grant folder access</button>
    <button class="btn ghost" onclick={() => void boot.useBrowserStorageInstead()}>
      Use browser storage instead
    </button>
  </div>
{:else}
  {#if boot.readOnly}
    <div class="ro warn-banner" role="alert">
      Spots is open in another tab — this tab is read-only.
    </div>
  {/if}
  {@render children()}
  {#if showNav}
    <BottomNav />
  {/if}
{/if}

<Toasts />

<style>
  .center {
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    text-align: center;
  }
  .center.col {
    flex-direction: column;
    gap: 16px;
    max-width: 420px;
    margin: 0 auto;
  }
  .spinner {
    width: 44px;
    height: 44px;
    border: 4px solid var(--green-soft);
    border-top-color: var(--green);
    border-radius: 50%;
    animation: rot 0.9s linear infinite;
  }
  @keyframes rot {
    to {
      transform: rotate(360deg);
    }
  }
  .ro {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 90;
    margin: 0;
    border-radius: 0;
    text-align: center;
  }
</style>
