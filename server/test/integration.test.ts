import { RENEWED_TOKEN_HEADER, type Change, type PullResponse, type PushResponse } from '@spots/shared';
import EmbeddedPostgres from 'embedded-postgres';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { FsBlobStorage } from '../src/blob-storage.js';
import { loadConfig, type Config } from '../src/config.js';
import { createDb, migrate, type Sql } from '../src/db.js';
import { gcBlobs, purgeTombstones } from '../src/gc.js';

const PG_PORT = 54329;

let pg: InstanceType<typeof EmbeddedPostgres>;
let sql: Sql;
let app: FastifyInstance;
let config: Config;
let photosDir: string;
let pgDir: string;

beforeAll(async () => {
  photosDir = mkdtempSync(path.join(os.tmpdir(), 'spots-photos-'));
  pgDir = mkdtempSync(path.join(os.tmpdir(), 'spots-pg-'));
  pg = new EmbeddedPostgres({
    databaseDir: pgDir,
    user: 'spots',
    password: 'spots',
    port: PG_PORT,
    persistent: false
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('spots_test');

  config = loadConfig({
    DATABASE_URL: `postgres://spots:spots@localhost:${PG_PORT}/spots_test`,
    PHOTOS_DIR: photosDir,
    APP_DIR: '/nonexistent',
    JWT_SECRET: 'test-secret-test-secret-123456',
    PORT: '0'
  } as NodeJS.ProcessEnv);
  sql = createDb(config.databaseUrl);
  await migrate(sql);
  app = await buildApp({ sql, storage: new FsBlobStorage(photosDir), config, logger: false });
});

afterAll(async () => {
  await app?.close();
  await sql?.end({ timeout: 5 });
  await pg?.stop();
  rmSync(photosDir, { recursive: true, force: true });
  rmSync(pgDir, { recursive: true, force: true });
});

/* ------------------------------- helpers ------------------------------- */

let uidCounter = 0;
function makeId(prefix: string): string {
  return `${prefix}-${String(++uidCounter).padStart(8, '0')}`;
}

async function register(username: string): Promise<{ token: string; userId: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'pw' }
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

function spotChange(overrides: Partial<Change> = {}): Change {
  return {
    id: makeId('spot'),
    type: 'spot',
    createdAt: 1000,
    updatedAt: 1000,
    updatedBy: 'devA',
    deleted: false,
    data: { lat: 47.5, lng: 19.05, foundAt: 1000, speciesId: 'species-1' },
    ...overrides
  };
}

async function push(token: string, changes: Change[]): Promise<PushResponse> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/sync/push',
    headers: { authorization: `Bearer ${token}` },
    payload: { changes }
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

async function pull(token: string, since = 0): Promise<PullResponse> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/sync/pull?since=${since}`,
    headers: { authorization: `Bearer ${token}` }
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

/* --------------------------------- tests -------------------------------- */

describe('auth', () => {
  it('registers, rejects duplicate usernames (case-insensitive), logs in', async () => {
    const { token } = await register('mate');
    expect(token).toBeTruthy();

    const dup = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'MATE', password: 'other' }
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe('username_taken');

    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'mate', password: 'wrong' }
    });
    expect(bad.statusCode).toBe(401);

    const good = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'Mate ', password: 'pw' }
    });
    expect(good.statusCode).toBe(200);
    expect(good.json().token).toBeTruthy();
  });

  it('rejects unauthenticated sync', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sync/pull?since=0' });
    expect(res.statusCode).toBe(401);
  });

  it('slides token renewal past 50% of life', async () => {
    const { userId } = await register('renewal-user');
    // Token with only 10 of 90 days left.
    const oldToken = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 80 * 86400)
      .setExpirationTime(Math.floor(Date.now() / 1000) + 10 * 86400)
      .sign(config.jwtSecret);
    const res = await app.inject({
      method: 'GET',
      url: '/api/sync/pull?since=0',
      headers: { authorization: `Bearer ${oldToken}` }
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers[RENEWED_TOKEN_HEADER]).toBeTruthy();
  });
});

describe('sync', () => {
  it('push/pull roundtrip with cursor advance', async () => {
    const { token } = await register('sync-a');
    const spot = spotChange();
    const item: Change = {
      id: makeId('li'),
      type: 'listItem',
      createdAt: 1,
      updatedAt: 1,
      updatedBy: 'devA',
      deleted: false,
      data: { kind: 'species', name: 'Chanterelle', lastUsedAt: 5 }
    };
    const pushRes = await push(token, [spot, item]);
    expect(pushRes.results.every((r) => r.applied)).toBe(true);

    const pullRes = await pull(token);
    expect(pullRes.changes.map((c) => c.id).sort()).toEqual([item.id, spot.id].sort());
    expect(pullRes.hasMore).toBe(false);
    expect(pullRes.cursor).toBeGreaterThan(0);

    const again = await pull(token, pullRes.cursor);
    expect(again.changes).toEqual([]);
  });

  it('LWW: older loses, identical is idempotent, tie broken by device id, newer wins', async () => {
    const { token } = await register('sync-lww');
    const spot = spotChange({ updatedAt: 2000, updatedBy: 'devB' });
    await push(token, [spot]);

    const older = await push(token, [{ ...spot, updatedAt: 1500, updatedBy: 'devZ' }]);
    expect(older.results[0]!.applied).toBe(false);

    const identical = await push(token, [spot]);
    expect(identical.results[0]!.applied).toBe(true); // idempotent retry

    const tieLower = await push(token, [{ ...spot, updatedBy: 'devA' }]); // same ts, lower device id
    expect(tieLower.results[0]!.applied).toBe(false);
    const tieHigher = await push(token, [{ ...spot, updatedBy: 'devC' }]);
    expect(tieHigher.results[0]!.applied).toBe(true);

    const newer = await push(token, [
      { ...spot, updatedAt: 3000, data: { ...(spot.data as object), notes: 'edited' } as never }
    ]);
    expect(newer.results[0]!.applied).toBe(true);
    const state = await pull(token);
    const pulled = state.changes.find((c) => c.id === spot.id)!;
    expect((pulled.data as { notes: string }).notes).toBe('edited');
  });

  it('reassigns server_seq on update so edits are pulled again', async () => {
    const { token } = await register('sync-seq');
    const spot = spotChange();
    await push(token, [spot]);
    const first = await pull(token);
    const cursor = first.cursor;

    await push(token, [{ ...spot, updatedAt: spot.updatedAt + 1 }]);
    const second = await pull(token, cursor);
    expect(second.changes.map((c) => c.id)).toEqual([spot.id]);
  });

  it('tombstones: pulled as deleted with null data', async () => {
    const { token } = await register('sync-del');
    const spot = spotChange();
    await push(token, [spot]);
    await push(token, [{ ...spot, updatedAt: spot.updatedAt + 1, deleted: true, data: null }]);
    const res = await pull(token);
    const pulled = res.changes.find((c) => c.id === spot.id)!;
    expect(pulled.deleted).toBe(true);
    expect(pulled.data).toBeNull();
  });

  it('privacy: users cannot read or overwrite each other\'s entities', async () => {
    const a = await register('priv-a');
    const b = await register('priv-b');
    const spot = spotChange();
    await push(a.token, [spot]);

    const bPull = await pull(b.token);
    expect(bPull.changes.find((c) => c.id === spot.id)).toBeUndefined();

    const attack = await push(b.token, [
      { ...spot, updatedAt: 9_999_999, data: { ...(spot.data as object), notes: 'pwned' } as never }
    ]);
    expect(attack.results[0]!.applied).toBe(false);

    const aState = await pull(a.token);
    const aSpot = aState.changes.find((c) => c.id === spot.id)!;
    expect((aSpot.data as { notes?: string }).notes ?? '').not.toBe('pwned');
  });

  it('rejects invalid payloads', async () => {
    const { token } = await register('sync-bad');
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { authorization: `Bearer ${token}` },
      payload: { changes: [{ ...spotChange(), data: { lat: 200, lng: 0, foundAt: 1, speciesId: 'x' } }] }
    });
    expect(res.statusCode).toBe(400);
  });

  it('paginates pulls beyond the page limit', async () => {
    const { token } = await register('sync-pages');
    const changes: Change[] = [];
    for (let i = 0; i < 601; i++) changes.push(spotChange());
    for (let i = 0; i < changes.length; i += 200) {
      await push(token, changes.slice(i, i + 200));
    }
    const p1 = await pull(token);
    expect(p1.changes.length).toBe(500);
    expect(p1.hasMore).toBe(true);
    const p2 = await pull(token, p1.cursor);
    expect(p2.changes.length).toBe(101);
    expect(p2.hasMore).toBe(false);
  });

  it('410 after the purge horizon passes an old cursor', async () => {
    const { token } = await register('sync-purge');
    const spot = spotChange();
    await push(token, [spot]);
    const before = await pull(token);

    await push(token, [{ ...spot, updatedAt: spot.updatedAt + 1, deleted: true, data: null }]);
    const purgedGroups = await purgeTombstones(sql, 0);
    expect(purgedGroups).toBeGreaterThan(0);

    const gone = await app.inject({
      method: 'GET',
      url: `/api/sync/pull?since=${before.cursor}`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(gone.statusCode).toBe(410);

    const full = await pull(token, 0);
    expect(full.changes.find((c) => c.id === spot.id)).toBeUndefined(); // purged entirely
  });
});

describe('blobs', () => {
  const bytes = Buffer.from('fake-jpeg-bytes-1234');
  const hash = createHash('sha256').update(bytes).digest('hex');

  function photoChange(h: string, overrides: Partial<Change> = {}): Change {
    return {
      id: makeId('photo'),
      type: 'photo',
      createdAt: 1,
      updatedAt: 1,
      updatedBy: 'devA',
      deleted: false,
      data: { hash: h, ext: 'jpg', size: bytes.length },
      ...overrides
    };
  }

  async function putBlob(token: string, h: string, body: Buffer) {
    return app.inject({
      method: 'PUT',
      url: `/api/blobs/${h}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
      payload: body
    });
  }

  it('reports missing blobs on push, accepts verified upload, then serves it to the owner only', async () => {
    const a = await register('blob-a');
    const b = await register('blob-b');

    const photo = photoChange(hash);
    const pushRes = await push(a.token, [photo]);
    expect(pushRes.missingBlobs).toEqual([hash]);

    const wrong = await putBlob(a.token, hash, Buffer.from('other-bytes'));
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error).toBe('hash_mismatch');

    const ok = await putBlob(a.token, hash, bytes);
    expect(ok.statusCode).toBe(201);

    // Idempotent re-upload short-circuits.
    const again = await putBlob(a.token, hash, bytes);
    expect(again.statusCode).toBe(200);

    // Re-push of the same photo: no longer missing.
    const rePush = await push(a.token, [photo]);
    expect(rePush.missingBlobs).toEqual([]);

    const got = await app.inject({
      method: 'GET',
      url: `/api/blobs/${hash}`,
      headers: { authorization: `Bearer ${a.token}` }
    });
    expect(got.statusCode).toBe(200);
    expect(got.rawPayload).toEqual(bytes);
    expect(got.headers['cache-control']).toContain('immutable');

    // Privacy: same hash, different user without a referencing photo entity -> 404.
    const denied = await app.inject({
      method: 'GET',
      url: `/api/blobs/${hash}`,
      headers: { authorization: `Bearer ${b.token}` }
    });
    expect(denied.statusCode).toBe(404);
  });

  it('gc removes unreferenced blobs but keeps tombstone-referenced ones', async () => {
    const { token } = await register('blob-gc');

    const keepBytes = Buffer.from('keep-these-bytes');
    const keepHash = createHash('sha256').update(keepBytes).digest('hex');
    const dropBytes = Buffer.from('drop-these-bytes');
    const dropHash = createHash('sha256').update(dropBytes).digest('hex');

    expect((await putBlob(token, keepHash, keepBytes)).statusCode).toBe(201);
    expect((await putBlob(token, dropHash, dropBytes)).statusCode).toBe(201);

    // keepHash is referenced by a tombstoned photo entity; dropHash by nothing.
    const photo = photoChange(keepHash);
    await push(token, [photo]);
    await push(token, [{ ...photo, updatedAt: 2, deleted: true, data: photo.data }]);

    await sql`update blobs set created_at = now() - interval '48 hours'`;
    const removed = await gcBlobs(sql, new FsBlobStorage(photosDir), 24);
    expect(removed).toBe(1);

    const rows = await sql`select hash from blobs where hash in (${keepHash}, ${dropHash})`;
    expect(rows.map((r) => r.hash)).toEqual([keepHash]);
  });
});
