import { getMeta, setMeta } from '$lib/storage/meta';

/**
 * Map display preferences. Satellite is the DEFAULT view (product decision:
 * finding the exact tree beats reading street names), the user's choice is
 * persisted and shared by every map in the app — the main map AND the
 * pin-placement step both honor it.
 */
class MapPrefs {
  satellite = $state(true);

  async load(): Promise<void> {
    this.satellite = (await getMeta<boolean>('ui:satellite')) ?? true;
  }

  toggle(): void {
    this.satellite = !this.satellite;
    void setMeta('ui:satellite', this.satellite);
  }
}

export const mapPrefs = new MapPrefs();
