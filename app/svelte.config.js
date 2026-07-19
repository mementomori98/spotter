import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      // Pure SPA: the Node API server serves this build with an
      // index.html fallback for all non-API routes.
      fallback: 'index.html'
    }),
    serviceWorker: {
      // Registered manually (src/routes/+layout.svelte) so we control the
      // update lifecycle (toast -> skipWaiting -> reload).
      register: false
    }
  }
};

export default config;
