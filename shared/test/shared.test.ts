import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  incomingWins,
  nextUpdatedAt,
  SpotDataSchema,
  validateChangeData,
  type Change
} from '../src/index.js';

describe('LWW version ordering', () => {
  it('orders by updatedAt first', () => {
    expect(compareVersions(1, 'z', 2, 'a')).toBe(-1);
    expect(compareVersions(3, 'a', 2, 'z')).toBe(1);
  });
  it('breaks ties deterministically by device id', () => {
    expect(compareVersions(5, 'a', 5, 'b')).toBe(-1);
    expect(compareVersions(5, 'b', 5, 'a')).toBe(1);
    expect(compareVersions(5, 'a', 5, 'a')).toBe(0);
  });
  it('identical version is idempotent (incoming wins on equality)', () => {
    expect(incomingWins({ updatedAt: 5, updatedBy: 'a' }, { updatedAt: 5, updatedBy: 'a' })).toBe(true);
    expect(incomingWins({ updatedAt: 4, updatedBy: 'z' }, { updatedAt: 5, updatedBy: 'a' })).toBe(false);
  });
});

describe('nextUpdatedAt', () => {
  it('is monotonic per entity even with a rewound clock', () => {
    expect(nextUpdatedAt(100, 500, 0)).toBe(501);
  });
  it('clamps to last known server time', () => {
    expect(nextUpdatedAt(100, 0, 900)).toBe(900);
  });
  it('uses wall clock when sane', () => {
    expect(nextUpdatedAt(1000, 500, 800)).toBe(1000);
  });
});

describe('schemas', () => {
  it('accepts a minimal spot (GPS + time + species only)', () => {
    const parsed = SpotDataSchema.parse({ lat: 47.5, lng: 19.04, foundAt: 1700000000000, speciesId: 'abcd1234' });
    expect(parsed.notes).toBe('');
    expect(parsed.habitat.hostTrees).toEqual([]);
    expect(parsed.photoIds).toEqual([]);
    expect(parsed.rating).toBeUndefined();
  });

  it('accepts only the fixed rating scale', () => {
    const base = { lat: 1, lng: 2, foundAt: 3, speciesId: 'abcd1234' };
    for (const rating of ['--', '-', '+', '++', '+++']) {
      expect(SpotDataSchema.safeParse({ ...base, rating }).success).toBe(true);
    }
    expect(SpotDataSchema.safeParse({ ...base, rating: '++++' }).success).toBe(false);
    expect(SpotDataSchema.safeParse({ ...base, rating: 5 }).success).toBe(false);
  });
  it('rejects live changes without data, accepts tombstones without data', () => {
    const base: Change = {
      id: 'abcd1234',
      type: 'spot',
      createdAt: 1,
      updatedAt: 2,
      updatedBy: 'dev1',
      deleted: false,
      data: null
    };
    expect(validateChangeData(base).ok).toBe(false);
    expect(validateChangeData({ ...base, deleted: true }).ok).toBe(true);
  });
  it('validates photo payloads', () => {
    const change: Change = {
      id: 'abcd1234',
      type: 'photo',
      createdAt: 1,
      updatedAt: 2,
      updatedBy: 'dev1',
      deleted: false,
      data: { hash: 'a'.repeat(64), ext: 'jpg', size: 123 }
    };
    expect(validateChangeData(change).ok).toBe(true);
    expect(validateChangeData({ ...change, data: { hash: 'nope', ext: 'jpg', size: 1 } }).ok).toBe(false);
  });
});
