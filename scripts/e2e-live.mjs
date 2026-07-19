/**
 * Live end-to-end exercise: boots a real Postgres (embedded) + the built
 * server (serving the built PWA), then walks a two-device sync scenario
 * over actual HTTP. Run from repo root after `pnpm build`:
 *
 *   node scripts/e2e-live.mjs
 */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PG_PORT = 54331;
const API_PORT = 8123;
const BASE = `http://localhost:${API_PORT}`;

const { default: EmbeddedPostgres } = await import(
  path.join(ROOT, 'server/node_modules/embedded-postgres/dist/index.js')
);

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? '  ✅' : '  ❌'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}

const pgDir = mkdtempSync(path.join(os.tmpdir(), 'spots-e2e-pg-'));
const photosDir = mkdtempSync(path.join(os.tmpdir(), 'spots-e2e-photos-'));

const pg = new EmbeddedPostgres({ databaseDir: pgDir, user: 'spots', password: 'spots', port: PG_PORT, persistent: false });
await pg.initialise();
await pg.start();
await pg.createDatabase('spots');

const server = spawn('node', ['dist/index.js'], {
  cwd: path.join(ROOT, 'server'),
  env: {
    ...process.env,
    DATABASE_URL: `postgres://spots:spots@localhost:${PG_PORT}/spots`,
    PHOTOS_DIR: photosDir,
    APP_DIR: path.join(ROOT, 'app/build'),
    PORT: String(API_PORT),
    JWT_SECRET: 'e2e-secret-e2e-secret-123'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

try {
  // Wait for health.
  let healthy = false;
  for (let i = 0; i < 60 && !healthy; i++) {
    try {
      healthy = (await fetch(`${BASE}/api/health`)).ok;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  check('server healthy', healthy);

  console.log('\nStatic PWA serving:');
  const index = await fetch(`${BASE}/`);
  check('GET / serves the app shell', index.ok && (await index.text()).includes('<html'));
  const spa = await fetch(`${BASE}/list`);
  check('SPA fallback for /list', spa.ok && (await spa.text()).includes('<html'));
  const manifest = await fetch(`${BASE}/manifest.webmanifest`);
  check('manifest served', manifest.ok);
  const apiMiss = await fetch(`${BASE}/api/nope`);
  check('/api/* never falls back to HTML', apiMiss.status === 404);

  console.log('\nTwo-device sync scenario:');
  // Device A registers and pushes a spot with a photo.
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'forager', password: 'chanterelle' })
  });
  check('register (device A)', reg.status === 201);
  const tokenA = (await reg.json()).token;
  const authA = { authorization: `Bearer ${tokenA}` };

  const photoBytes = Buffer.from(`fake-full-res-jpeg-${randomUUID()}`);
  const hash = createHash('sha256').update(photoBytes).digest('hex');
  const speciesId = randomUUID();
  const photoId = randomUUID();
  const spotId = randomUUID();
  const mkChange = (id, type, data, updatedAt = Date.now()) => ({
    id, type, createdAt: updatedAt, updatedAt, updatedBy: 'device-a', deleted: false, data
  });

  const blobUp = await fetch(`${BASE}/api/blobs/${hash}`, {
    method: 'PUT',
    headers: { ...authA, 'content-type': 'application/octet-stream' },
    body: photoBytes
  });
  check('blob upload (verified hash)', blobUp.status === 201);

  const push = await fetch(`${BASE}/api/sync/push`, {
    method: 'POST',
    headers: { ...authA, 'content-type': 'application/json' },
    body: JSON.stringify({
      changes: [
        mkChange(speciesId, 'listItem', { kind: 'species', name: 'Chanterelle', lastUsedAt: Date.now() }),
        mkChange(photoId, 'photo', { hash, ext: 'jpg', size: photoBytes.length }),
        mkChange(spotId, 'spot', {
          lat: 47.53, lng: 19.03, accuracy: 8, foundAt: Date.now(), speciesId,
          notes: 'under the old beech', habitat: { hostTrees: [{ plantId: randomUUID(), ageMin: 40 }], soil: 'clay', vegetation: '', surroundingPlantIds: [], indicatorSpeciesIds: [], habitatNotes: '' },
          photoIds: [photoId], habitatPhotoIds: []
        })
      ]
    })
  });
  const pushBody = await push.json();
  check('push 3 entities', push.ok && pushBody.results.every((r) => r.applied));
  check('no missing blobs (uploaded first)', pushBody.missingBlobs.length === 0);

  // Device B logs in and pulls everything.
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'FORAGER', password: 'chanterelle' })
  });
  check('login (device B, case-insensitive)', login.ok);
  const tokenB = (await login.json()).token;
  const authB = { authorization: `Bearer ${tokenB}` };

  const pull = await fetch(`${BASE}/api/sync/pull?since=0`, { headers: authB });
  const pullBody = await pull.json();
  check('pull returns all 3 entities', pull.ok && pullBody.changes.length === 3);
  const pulledSpot = pullBody.changes.find((c) => c.id === spotId);
  check('spot payload intact', pulledSpot?.data?.notes === 'under the old beech');

  const blobDown = await fetch(`${BASE}/api/blobs/${hash}`, { headers: authB });
  const downloaded = Buffer.from(await blobDown.arrayBuffer());
  check('photo blob roundtrip (full resolution, byte-identical)', blobDown.ok && downloaded.equals(photoBytes));

  // Device B logs a visit; device A pulls it incrementally.
  const visitId = randomUUID();
  const push2 = await fetch(`${BASE}/api/sync/push`, {
    method: 'POST',
    headers: { ...authB, 'content-type': 'application/json' },
    body: JSON.stringify({ changes: [{ ...mkChange(visitId, 'visit', { spotId, at: Date.now(), outcome: 'harvested', note: '400 g', photoIds: [] }), updatedBy: 'device-b' }] })
  });
  check('device B pushes a visit', push2.ok);

  const pullA = await fetch(`${BASE}/api/sync/pull?since=${pullBody.cursor}`, { headers: authA });
  const pullABody = await pullA.json();
  check('device A pulls ONLY the new visit (incremental)', pullA.ok && pullABody.changes.length === 1 && pullABody.changes[0].id === visitId);

  // Privacy: a second account sees nothing.
  const reg2 = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'stranger', password: 'x' })
  });
  const tokenC = (await reg2.json()).token;
  const pullC = await fetch(`${BASE}/api/sync/pull?since=0`, { headers: { authorization: `Bearer ${tokenC}` } });
  check('another account pulls nothing', (await pullC.json()).changes.length === 0);
  const blobC = await fetch(`${BASE}/api/blobs/${hash}`, { headers: { authorization: `Bearer ${tokenC}` } });
  check('another account cannot fetch the photo', blobC.status === 404);

  console.log(failures === 0 ? '\nE2E: ALL CHECKS PASSED' : `\nE2E: ${failures} CHECK(S) FAILED`);
} finally {
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));
  await pg.stop();
  rmSync(pgDir, { recursive: true, force: true });
  rmSync(photosDir, { recursive: true, force: true });
}
process.exit(failures === 0 ? 0 : 1);
