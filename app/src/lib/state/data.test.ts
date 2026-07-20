import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import type { ListItemEntity, SpotData } from '@spots/shared';

/**
 * Vocabulary store tests: duplicate-name guards (create/rename) and the
 * kind-specific delete cascades (plant/species/tag).
 */

async function freshWorld() {
  // Fresh singletons + fresh IndexedDB per test (same harness as engine.test.ts).
  vi.resetModules();
  globalThis.indexedDB = new IDBFactory();
  const { session } = await import('$lib/state/session.svelte');
  const { data } = await import('$lib/state/data.svelte');
  const { IdbStore } = await import('$lib/storage/idb-store');

  await session.create('mate', 'pw');
  await data.init(new IdbStore());
  return { data };
}

function spotPayload(speciesId: string, habitat: Partial<SpotData['habitat']> = {}): SpotData {
  return {
    lat: 47.5,
    lng: 19.05,
    foundAt: 5,
    speciesId,
    notes: '',
    habitat: {
      hostTrees: [],
      soil: '',
      vegetation: '',
      surroundingPlantIds: [],
      indicatorSpeciesIds: [],
      habitatNotes: '',
      ...habitat
    },
    photoIds: [],
    habitatPhotoIds: []
  };
}

describe('vocabulary store', () => {
  it('createListItem snaps to an existing item (case-insensitive, trimmed)', async () => {
    const { data } = await freshWorld();
    const first = await data.createListItem('species', 'Chanterelle');
    const again = await data.createListItem('species', '  chanterelle ');
    expect(first).toBeTruthy();
    expect(again!.id).toBe(first!.id);
    expect(data.listItems('species')).toHaveLength(1);
    expect(await data.createListItem('species', '   ')).toBeUndefined();
  });

  it('renameListItem refuses duplicates within the kind', async () => {
    const { data } = await freshWorld();
    const cep = await data.createListItem('species', 'Cep');
    const morel = await data.createListItem('species', 'Morel');
    expect(await data.renameListItem(morel!.id, ' CEP ')).toBe('duplicate');
    expect(data.itemName(morel!.id)).toBe('Morel');
    expect(await data.renameListItem(morel!.id, 'Black Morel')).toBe('ok');
    expect(data.itemName(morel!.id)).toBe('Black Morel');
    expect(data.itemName(cep!.id)).toBe('Cep');
  });

  it('deleting a plant strips it from habitats; the spots survive', async () => {
    const { data } = await freshWorld();
    const species = await data.createListItem('species', 'Cep');
    const oak = await data.createListItem('plant', 'Oak');
    const birch = await data.createListItem('plant', 'Birch');
    await data.upsert(
      'spot',
      'spot-1',
      spotPayload(species!.id, {
        hostTrees: [
          { plantId: oak!.id, ageMin: 10, ageMax: 50 },
          { plantId: birch!.id }
        ],
        surroundingPlantIds: [oak!.id, birch!.id]
      })
    );

    await data.deleteListItem(oak!.id);

    const spot = data.getSpot('spot-1');
    expect(spot).toBeTruthy(); // the spot survives
    expect(spot!.data.habitat.hostTrees).toEqual([{ plantId: birch!.id }]);
    expect(spot!.data.habitat.surroundingPlantIds).toEqual([birch!.id]);
    expect(data.entities.get(oak!.id)!.deleted).toBe(true);
  });

  it('deleting a species cascades to its spots and strips indicator refs', async () => {
    const { data } = await freshWorld();
    const doomed = await data.createListItem('species', 'Doomed');
    const other = await data.createListItem('species', 'Survivor');
    await data.upsert('photo', 'photo-1', { hash: 'a'.repeat(64), ext: 'jpg', size: 3 });
    const spot = spotPayload(doomed!.id);
    await data.upsert('spot', 'spot-1', { ...spot, photoIds: ['photo-1'] });
    await data.upsert('visit', 'visit-1', { spotId: 'spot-1', at: 6, outcome: 'found', note: '', photoIds: [] });
    await data.upsert('spot', 'spot-2', spotPayload(other!.id, { indicatorSpeciesIds: [doomed!.id] }));

    await data.deleteListItem(doomed!.id);

    // Its spot is fully cascaded: spot + visit + photo tombstoned.
    expect(data.entities.get('spot-1')!.deleted).toBe(true);
    expect(data.entities.get('visit-1')!.deleted).toBe(true);
    expect(data.entities.get('photo-1')!.deleted).toBe(true);
    expect(data.entities.get(doomed!.id)!.deleted).toBe(true);
    // The other spot survives, minus the indicator reference.
    const survivor = data.getSpot('spot-2');
    expect(survivor).toBeTruthy();
    expect(survivor!.data.habitat.indicatorSpeciesIds).toEqual([]);
  });

  it('deleting a tag strips it from all species', async () => {
    const { data } = await freshWorld();
    const tag = await data.createListItem('tag', 'edible');
    const keep = await data.createListItem('tag', 'autumn');
    const species = await data.createListItem('species', 'Cep');
    await data.upsert('listItem', species!.id, { ...species!.data, tagIds: [tag!.id, keep!.id] });
    expect(data.itemUsageCount(tag!.id)).toBe(1);

    await data.deleteListItem(tag!.id);

    const sp = data.entities.get(species!.id) as ListItemEntity;
    expect(sp.data.tagIds).toEqual([keep!.id]);
    expect(data.entities.get(tag!.id)!.deleted).toBe(true);
    expect(data.itemUsageCount(keep!.id)).toBe(1);
  });
});
