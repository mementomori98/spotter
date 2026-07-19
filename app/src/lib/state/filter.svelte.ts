/** Species filter shared by the map and the list view (not synced). */
class FilterState {
  speciesIds = $state<string[]>([]);

  get active(): boolean {
    return this.speciesIds.length > 0;
  }

  matches(speciesId: string): boolean {
    return this.speciesIds.length === 0 || this.speciesIds.includes(speciesId);
  }
}

export const filter = new FilterState();
