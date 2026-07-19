<script lang="ts">
  import { page } from '$app/state';
  import Icon from './Icon.svelte';

  const tabs = [
    { href: '/', icon: 'map', label: 'Map' },
    { href: '/list', icon: 'list', label: 'List' },
    { href: '/settings', icon: 'sliders', label: 'Settings' }
  ];
</script>

<nav>
  {#each tabs as tab (tab.href)}
    <a href={tab.href} class:active={page.url.pathname === tab.href} aria-label={tab.label}>
      <Icon name={tab.icon} size={26} />
      <span>{tab.label}</span>
    </a>
  {/each}
</nav>

<style>
  nav {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 40;
    display: flex;
    height: var(--nav-h);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    background: var(--card);
    border-top: 1px solid var(--line);
  }
  a {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    text-decoration: none;
    color: var(--ink-soft);
    font-size: 12px;
    font-weight: 700;
  }
  a.active {
    color: var(--green-dark);
  }
</style>
