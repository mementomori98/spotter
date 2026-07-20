import { data } from './data.svelte';

/**
 * Species + tag filter shared by the map and the list view (not synced).
 * The two dimensions AND together; tags match through the spot's species
 * (tags live on species entities, not on spots).
 */
class FilterState {
  speciesIds = $state<string[]>([]);
  tagIds = $state<string[]>([]);

  get active(): boolean {
    return this.speciesIds.length > 0 || this.tagIds.length > 0;
  }

  clear(): void {
    this.speciesIds = [];
    this.tagIds = [];
  }

  matches(speciesId: string): boolean {
    if (this.speciesIds.length > 0 && !this.speciesIds.includes(speciesId)) return false;
    if (this.tagIds.length === 0) return true;
    // Stale/deleted species ids must silently match nothing, never throw.
    const species = data.entities.get(speciesId);
    if (!species || species.deleted || !species.data || species.type !== 'listItem') return false;
    const tagIds = (species.data as { tagIds?: string[] }).tagIds ?? [];
    return tagIds.some((t) => this.tagIds.includes(t));
  }
}

export const filter = new FilterState();
