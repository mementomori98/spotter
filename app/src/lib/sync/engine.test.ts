import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import type { Change } from '@spots/shared';
import { incomingWins } from '@spots/shared';

/**
 * Sync engine unit tests against an in-memory fake server that mimics the
 * real API's semantics (register/login, LWW push, seq-cursor pull, blobs).
 */

/* ------------------------------ fake server ------------------------------ */

class FakeServer {
  entities = new Map<string, Change & { serverSeq: number }>();
  blobs = new Map<string, ArrayBuffer>();
  users = new Map<string, string>(); // username -> password
  seq = 0;
  purgeHorizon = 0;
  registerBehavior: 'ok' | 'taken' = 'ok';
  log: string[] = [];

  handle = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url === '/api/auth/register' && method === 'POST') {
      const body = JSON.parse(init!.body as string) as { username: string; password: string };
      if (this.registerBehavior === 'taken' && !this.users.has(body.username)) {
        return json({ error: 'username_taken' }, 409);
      }
      this.users.set(body.username, body.password);
      return json({ token: 'tok-1', userId: 'user-1', username: body.username }, 201);
    }
    if (url === '/api/auth/login' && method === 'POST') {
      const body = JSON.parse(init!.body as string) as { username: string; password: string };
      if (this.users.get(body.username) !== body.password) return json({ error: 'invalid_credentials' }, 401);
      return json({ token: 'tok-2', userId: 'user-1', username: body.username });
    }
    if (url === '/api/sync/push' && method === 'POST') {
      this.log.push('push');
      const body = JSON.parse(init!.body as string) as { changes: Change[] };
      const results = body.changes.map((c) => {
        const existing = this.entities.get(c.id);
        if (existing && !incomingWins(c, existing)) return { id: c.id, applied: false };
        this.entities.set(c.id, { ...c, serverSeq: ++this.seq });
        return { id: c.id, applied: true };
      });
      const missingBlobs = body.changes
        .filter((c) => c.type === 'photo' && !c.deleted && c.data)
        .map((c) => (c.data as { hash: string }).hash)
        .filter((h) => !this.blobs.has(h));
      return json({ results, missingBlobs, serverTime: Date.now() });
    }
    if (url.startsWith('/api/sync/pull') && method === 'GET') {
      this.log.push('pull');
      const since = Number(new URLSearchParams(url.split('?')[1]).get('since') ?? 0);
      if (since > 0 && since < this.purgeHorizon) return json({ error: 'cursor_purged' }, 410);
      const rows = [...this.entities.values()]
        .filter((e) => e.serverSeq > since)
        .sort((a, b) => a.serverSeq - b.serverSeq);
      return json({
        changes: rows.map(({ serverSeq: _s, ...c }) => ({ ...c, data: c.deleted ? null : c.data })),
        cursor: rows.length ? rows[rows.length - 1]!.serverSeq : since,
        hasMore: false,
        serverTime: Date.now()
      });
    }
    const blobMatch = /^\/api\/blobs\/([0-9a-f]{64})$/.exec(url);
    if (blobMatch) {
      const hash = blobMatch[1]!;
      if (method === 'PUT') {
        this.log.push(`blob-put:${hash.slice(0, 6)}`);
        const body = init!.body as Blob;
        this.blobs.set(hash, await body.arrayBuffer());
        return json({ ok: true }, 201);
      }
      const buf = this.blobs.get(hash);
      if (!buf) return json({ error: 'not_found' }, 404);
      return new Response(buf, { status: 200 });
    }
    return json({ error: 'not_found' }, 404);
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/* --------------------------------- setup --------------------------------- */

let server: FakeServer;

async function freshWorld() {
  // Fresh singletons + fresh IndexedDB per test.
  vi.resetModules();
  globalThis.indexedDB = new IDBFactory();
  const { session } = await import('$lib/state/session.svelte');
  const { data } = await import('$lib/state/data.svelte');
  const { engine } = await import('$lib/sync/engine.svelte');
  const { IdbStore } = await import('$lib/storage/idb-store');

  server = new FakeServer();
  globalThis.fetch = server.handle as typeof fetch;

  await session.create('mate', 'pw');
  await data.init(new IdbStore());
  return { session, data, engine };
}

const SPECIES = { kind: 'species' as const, name: 'Chanterelle', lastUsedAt: 1 };

describe('sync engine', () => {
  it('registers, uploads blobs BEFORE pushing entities, clears dirty', async () => {
    const { data, engine } = await freshWorld();

    const speciesId = 'species-0001';
    await data.upsert('listItem', speciesId, SPECIES);

    const hash = 'a'.repeat(64);
    await data.store.putBlob(hash, 'jpg', new Blob([new Uint8Array([1, 2, 3])]));
    await data.queueUpload(hash, 'jpg');
    await data.upsert('photo', 'photo-0001', { hash, ext: 'jpg', size: 3 });
    await data.upsert('spot', 'spot-0001', {
      lat: 47.5,
      lng: 19.05,
      foundAt: Date.now(),
      speciesId,
      notes: '',
      habitat: {
        hostTrees: [],
        soil: '',
        vegetation: '',
        surroundingPlantIds: [],
        indicatorSpeciesIds: [],
        habitatNotes: ''
      },
      photoIds: ['photo-0001'],
      habitatPhotoIds: []
    });

    await engine.sync();

    expect(engine.status).toBe('idle');
    expect(data.dirty.size).toBe(0);
    expect(data.pendingUploads.size).toBe(0);
    expect(server.entities.size).toBe(3);
    expect(server.blobs.has(hash)).toBe(true);
    // Blob upload strictly precedes the entity push.
    const blobIdx = server.log.findIndex((l) => l.startsWith('blob-put'));
    const pushIdx = server.log.findIndex((l) => l === 'push');
    expect(blobIdx).toBeGreaterThanOrEqual(0);
    expect(blobIdx).toBeLessThan(pushIdx);
  });

  it('pauses on username conflict (different owner) and renames cleanly', async () => {
    const { engine, data, session } = await freshWorld();
    server.registerBehavior = 'taken'; // nobody can register; login fails too (no user)

    await data.upsert('listItem', 'species-0003', SPECIES);
    await engine.sync();
    expect(engine.status).toBe('conflict');
    expect(data.dirty.size).toBe(1); // nothing lost

    server.registerBehavior = 'ok';
    await engine.resolveConflictRename('mate2');
    // resolveConflictRename fires sync asynchronously (single-flight queues
    // our explicit call) — wait for it to settle.
    await engine.sync();
    for (let i = 0; i < 100 && engine.status === 'syncing'; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(engine.status).toBe('idle');
    expect(session.current?.username).toBe('mate2');
    expect(data.dirty.size).toBe(0);
  });

  it('merges pulled changes with LWW and never marks them dirty', async () => {
    const { data, engine } = await freshWorld();

    // Server already has a species item, newer than anything local.
    server.entities.set('li-0001', {
      id: 'li-0001',
      type: 'listItem',
      createdAt: 1,
      updatedAt: Date.now() + 60_000,
      updatedBy: 'other-device',
      deleted: false,
      data: { kind: 'species', name: 'Porcini', lastUsedAt: 5 },
      serverSeq: ++server.seq
    });

    await engine.sync();
    expect(data.entities.get('li-0001')).toBeTruthy();
    expect(data.dirty.has('li-0001')).toBe(false);
    expect(data.cursor).toBe(server.seq);

    // A stale remote change must NOT overwrite a newer local one.
    await data.upsert('listItem', 'li-0001', { kind: 'species', name: 'Porcini (mine)', lastUsedAt: 9 });
    const localUpdatedAt = data.entities.get('li-0001')!.updatedAt;
    await data.applyRemote([
      {
        id: 'li-0001',
        type: 'listItem',
        createdAt: 1,
        updatedAt: localUpdatedAt - 1000,
        updatedBy: 'other-device',
        deleted: false,
        data: { kind: 'species', name: 'Stale', lastUsedAt: 1 }
      }
    ]);
    expect((data.entities.get('li-0001')!.data as { name: string }).name).toBe('Porcini (mine)');
    expect(data.dirty.has('li-0001')).toBe(true); // still pending push
  });

  it('cascades spot deletion to visits and photos (tombstones sync)', async () => {
    const { data, engine } = await freshWorld();

    const hash = 'b'.repeat(64);
    await data.store.putBlob(hash, 'jpg', new Blob([new Uint8Array([9])]));
    await data.queueUpload(hash, 'jpg');
    await data.upsert('listItem', 'species-0004', SPECIES);
    await data.upsert('photo', 'photo-0002', { hash, ext: 'jpg', size: 1 });
    await data.upsert('spot', 'spot-0002', {
      lat: 1,
      lng: 2,
      foundAt: 5,
      speciesId: 'species-0004',
      notes: '',
      habitat: {
        hostTrees: [],
        soil: '',
        vegetation: '',
        surroundingPlantIds: [],
        indicatorSpeciesIds: [],
        habitatNotes: ''
      },
      photoIds: ['photo-0002'],
      habitatPhotoIds: []
    });
    await data.upsert('visit', 'visit-0001', {
      spotId: 'spot-0002',
      at: 6,
      outcome: 'harvested',
      note: '',
      photoIds: []
    });
    await engine.sync();

    await data.deleteSpot('spot-0002');
    expect(data.entities.get('spot-0002')!.deleted).toBe(true);
    expect(data.entities.get('visit-0001')!.deleted).toBe(true);
    expect(data.entities.get('photo-0002')!.deleted).toBe(true);
    // Local blob dropped (no live photo references it).
    expect(await data.store.getBlob(hash, 'jpg')).toBeUndefined();

    await engine.sync();
    expect(server.entities.get('spot-0002')!.deleted).toBe(true);
    expect(server.entities.get('visit-0001')!.deleted).toBe(true);
    expect(server.entities.get('photo-0002')!.deleted).toBe(true);
  });

  it('410: full resync drops purged entities but keeps dirty local ones', async () => {
    const { data, engine } = await freshWorld();

    await data.upsert('listItem', 'li-keep-01', SPECIES);
    await data.upsert('listItem', 'li-gone-01', { kind: 'species', name: 'Doomed', lastUsedAt: 1 });
    await engine.sync();
    expect(data.dirty.size).toBe(0);

    // Another device tombstoned 'li-gone-01' long ago; the server purged the
    // tombstone and advanced the horizon past our cursor.
    server.entities.delete('li-gone-01');
    server.purgeHorizon = server.seq + 1;

    // Meanwhile we made a new local (dirty, never-pushed... simulate by not syncing) item.
    await data.upsert('listItem', 'li-local-01', { kind: 'species', name: 'Fresh local', lastUsedAt: 2 });
    const dirtyBefore = data.dirty.has('li-local-01');

    await engine.sync();
    expect(engine.status).toBe('idle');
    expect(data.entities.has('li-gone-01')).toBe(false); // purged remotely -> removed locally
    expect(data.entities.has('li-keep-01')).toBe(true);
    expect(data.entities.has('li-local-01')).toBe(true); // local work survives
    expect(dirtyBefore).toBe(true);
  });

  it('downloads blobs for pulled photos', async () => {
    const { data, engine } = await freshWorld();
    const hash = 'c'.repeat(64);
    server.blobs.set(hash, new Uint8Array([7, 7]).buffer);
    server.entities.set('photo-0003', {
      id: 'photo-0003',
      type: 'photo',
      createdAt: 1,
      updatedAt: Date.now() + 1000,
      updatedBy: 'other-device',
      deleted: false,
      data: { hash, ext: 'jpg', size: 2 },
      serverSeq: ++server.seq
    });

    await engine.sync();
    const blob = await data.store.getBlob(hash, 'jpg');
    expect(blob).toBeTruthy();
    expect(data.pendingDownloads.size).toBe(0);
  });
});
