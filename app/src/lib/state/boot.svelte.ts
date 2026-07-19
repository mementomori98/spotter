import { FsStore, ensureFsPermission } from '$lib/storage/fs-store';
import { IdbStore } from '$lib/storage/idb-store';
import { getMeta, setMeta } from '$lib/storage/meta';
import { DEFAULT_SETTINGS, type Settings } from '$lib/storage/types';
import { engine } from '$lib/sync/engine.svelte';
import { data } from './data.svelte';
import { session } from './session.svelte';
import { toasts } from './toasts.svelte';

export type BootPhase = 'loading' | 'login' | 'fs-permission' | 'ready';

/**
 * App boot: single-writer lock -> settings -> session -> storage backend ->
 * dataset -> sync engine.
 */
class BootState {
  phase = $state<BootPhase>('loading');
  readOnly = $state(false);
  persistDenied = $state(false);
  settings = $state<Settings>(DEFAULT_SETTINGS);

  async boot(): Promise<void> {
    // Single-writer guard: a second tab is read-only until the first closes.
    if (navigator.locks) {
      const granted = await new Promise<boolean>((resolve) => {
        void navigator.locks.request('spots-writer', { ifAvailable: true }, async (lock) => {
          resolve(lock !== null);
          if (lock !== null) await new Promise(() => {}); // hold forever (tab lifetime)
        });
      });
      if (!granted) {
        this.readOnly = true;
        data.readOnly = true;
        // Take over when the writing tab closes: reload as the writer.
        void navigator.locks.request('spots-writer', async () => {
          window.location.reload();
          await new Promise(() => {});
        });
      }
    }

    this.settings = { ...DEFAULT_SETTINGS, ...((await getMeta<Partial<Settings>>('settings')) ?? {}) };
    await this.pushSettingsToSw();

    await session.load();
    if (!session.current) {
      this.phase = 'login';
      return;
    }
    await this.openStorage();
  }

  /** Called from the login screen after account creation/login. */
  async afterLogin(): Promise<void> {
    await this.openStorage();
  }

  private makeFsStore(handle: FileSystemDirectoryHandle): FsStore {
    const store = new FsStore(handle);
    store.onWriteError = (err) => {
      toasts.show(
        'Saving to your folder FAILED — recent changes may be lost: ' +
          (err instanceof Error ? err.message : String(err)),
        { kind: 'error', timeout: 12_000 }
      );
    };
    return store;
  }

  private async openStorage(): Promise<void> {
    if (this.settings.storageMode === 'fs') {
      const handle = await getMeta<FileSystemDirectoryHandle>('fsDirHandle');
      if (handle) {
        const perm = await ensureFsPermission(handle, false);
        if (perm !== 'granted') {
          this.phase = 'fs-permission'; // needs a user gesture
          return;
        }
        await this.finish(this.makeFsStore(handle));
        return;
      }
      // Handle lost — fall back.
      await this.updateSettings({ storageMode: 'idb' });
    }
    await this.finish(new IdbStore());
    if (navigator.storage?.persist) {
      this.persistDenied = !(await navigator.storage.persist());
    }
  }

  /** User gesture on the fs-permission screen. */
  async grantFsPermission(): Promise<void> {
    const handle = await getMeta<FileSystemDirectoryHandle>('fsDirHandle');
    if (!handle) {
      await this.updateSettings({ storageMode: 'idb' });
      await this.finish(new IdbStore());
      return;
    }
    if ((await ensureFsPermission(handle, true)) === 'granted') {
      await this.finish(this.makeFsStore(handle));
    }
  }

  async useBrowserStorageInstead(): Promise<void> {
    await this.updateSettings({ storageMode: 'idb' });
    await this.finish(new IdbStore());
  }

  private async finish(store: import('$lib/storage/types').LocalStore): Promise<void> {
    await data.init(store);
    this.phase = 'ready';
    engine.start();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void data.store.flush();
    });
  }

  /** Switch to folder storage (desktop): copies everything over. */
  async adoptFolder(): Promise<boolean> {
    if (!('showDirectoryPicker' in window)) return false;
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    const fsStore = this.makeFsStore(handle);
    await fsStore.loadEntities();
    // Copy entities + blobs from the current store.
    await fsStore.saveEntities([...data.entities.values()]);
    for (const photo of data.livePhotos()) {
      const blob = await data.store.getBlob(photo.data.hash, photo.data.ext);
      if (blob) await fsStore.putBlob(photo.data.hash, photo.data.ext, blob);
    }
    await fsStore.flush();
    await setMeta('fsDirHandle', handle);
    await this.updateSettings({ storageMode: 'fs' });
    await data.init(fsStore);
    return true;
  }

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    this.settings = { ...this.settings, ...patch };
    await setMeta('settings', JSON.parse(JSON.stringify(this.settings)));
    await this.pushSettingsToSw();
  }

  /** The service worker reads tile URL prefixes from spots-meta to know what to cache. */
  private async pushSettingsToSw(): Promise<void> {
    const prefix = (url: string) => url.slice(0, url.indexOf('{'));
    await setMeta('tilePrefixes', [prefix(this.settings.baseTileUrl), prefix(this.settings.satTileUrl)]);
  }
}

export const boot = new BootState();
