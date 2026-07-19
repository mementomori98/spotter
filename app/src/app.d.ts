// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
  }

  /* File System Access API (Chromium desktop) — not yet in the TS DOM lib. */
  interface FileSystemDirectoryHandle {
    queryPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
    requestPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
    values(): AsyncIterableIterator<FileSystemHandle>;
  }

  interface Window {
    showDirectoryPicker(options?: {
      mode?: 'read' | 'readwrite';
      id?: string;
    }): Promise<FileSystemDirectoryHandle>;
    showSaveFilePicker(options?: {
      suggestedName?: string;
      types?: { description?: string; accept: Record<string, string[]> }[];
    }): Promise<FileSystemFileHandle>;
  }

  interface WindowEventMap {
    deviceorientationabsolute: DeviceOrientationEvent;
  }
}

export {};
