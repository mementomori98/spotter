import type { Entity, Rating } from '@spots/shared';

/**
 * Local persistence backend. Two implementations (spots.md §3):
 * - IdbStore: persistent browser storage (Android installed PWA, default)
 * - FsStore:  real files in a user-chosen folder (desktop Chrome/Edge)
 *
 * Small metadata (session, sync cursors, drafts, settings, the folder
 * handle itself) always lives in IndexedDB — see meta.ts.
 */
export interface LocalStore {
  readonly kind: 'idb' | 'fs';
  loadEntities(): Promise<Entity[]>;
  saveEntities(entities: Entity[]): Promise<void>;
  /** Hard local removal (used by full resync after HTTP 410). */
  removeEntities(ids: string[]): Promise<void>;
  putBlob(hash: string, ext: string, blob: Blob): Promise<void>;
  getBlob(hash: string, ext: string): Promise<Blob | undefined>;
  deleteBlob(hash: string, ext: string): Promise<void>;
  /** Flush any debounced writes (called on visibilitychange: hidden). */
  flush(): Promise<void>;
}

export interface DraftPhoto {
  hash: string;
  ext: string;
  size: number;
  takenAt?: number;
  width?: number;
  height?: number;
}

/** In-progress capture form, persisted on every change (camera app can kill the PWA). */
export interface SpotDraft {
  /** 'new' or the spot id being edited. */
  key: string;
  lat: number | null;
  lng: number | null;
  accuracy?: number;
  /** True once the user manually adjusted the pin (stops GPS live-lock). */
  pinAdjusted: boolean;
  foundAt: number;
  speciesId: string | null;
  rating: Rating | null;
  notes: string;
  soil: string;
  /** Soil pH 3.0–9.0, null = not measured. */
  ph: number | null;
  vegetation: string;
  habitatNotes: string;
  hostTrees: { plantId: string; ageMin?: number; ageMax?: number }[];
  surroundingPlantIds: string[];
  indicatorSpeciesIds: string[];
  photos: DraftPhoto[];
  habitatPhotos: DraftPhoto[];
  habitatOpen: boolean;
}

export interface Session {
  username: string;
  /** Kept locally by design: silent re-login after long offline periods;
   *  there is no password recovery. Documented tradeoff. */
  password: string;
  deviceId: string;
  userId: string | null;
  token: string | null;
  registered: boolean;
}

export interface Settings {
  storageMode: 'idb' | 'fs';
  baseTileUrl: string;
  satTileUrl: string;
}

export const DEFAULT_SETTINGS: Settings = {
  storageMode: 'idb',
  baseTileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  satTileUrl:
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
};
