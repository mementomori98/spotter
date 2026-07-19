# Spots — Architecture (v2.1, agreed by all 3 engineers)

> Review trail: architecture agreed in 2 rounds (both reviewers AGREE); implementation audited by
> both reviewers (6 blocking findings — atomic tombstone purge, FsStore write-chain recovery,
> persisted missingBlobs re-seed, meaningful-draft persistence, visit-log Undo, enforced
> single-writer read-only mode — all fixed and re-verified: APPROVE × 2). Verified by typecheck,
> 28 unit/integration tests (real Postgres), and a live two-device HTTP sync exercise
> (`scripts/e2e-live.mjs`).

Reviewed by 3 engineers over 2 rounds; both reviewers voted AGREE on v2. v2.1 folds in their final non-blocking notes:
- Blob privacy: `GET/HEAD /api/blobs/:hash` authorized by joining a live photo entity owned by the requester; `PUT` fast-200 only if the caller owns a reference or blob is orphaned-fresh.
- `missingBlobs` server-side existence check is a tested contract (covers client offline >24h between blob upload and entity push).
- `purge_horizon_seq` advances exactly when tombstones are purged (set to max purged server_seq).
- Export: `navigator.storage.estimate()` pre-check (temp zip ≈ doubles storage), guaranteed OPFS temp cleanup (post-download, on error, stale sweep at boot), objectURL not revoked immediately.
- Species REQUIRED at save is an explicit product-owner override of spots.md ("species optional").
- Settings warns when a user-configured tile provider returns opaque (non-CORS) responses → no offline caching possible.
- `tiles-browse` LRU uses access-time tracking in IndexedDB (Cache API has none).
- Follow-up (non-v1): replace stored credentials with a server-side revocable per-device opaque token exchanged for JWTs.

Constraints from spots.md (authoritative) + product owner:
- Full form capture; all fields optional EXCEPT GPS + timestamp + species (PO override).
- Light theme only, high contrast for sunlight.
- UI extremely intuitive, minimal taps, field-usable (top priority).

## Monorepo

pnpm workspaces at repo root:
- `shared/` — TS types + zod schemas for entities and sync protocol.
- `server/` — Node 22, Fastify 5 API + porsager `postgres`, plain SQL migrations (versioned, idempotent at boot). Serves built PWA (same origin).
- `app/` — SvelteKit 2 + Svelte 5 (runes), `adapter-static` SPA (fallback index.html), SSR off, custom service worker (`src/service-worker.ts`).

## Data model (client-generated UUIDs, ms-epoch timestamps)

Entity types: `spot`, `visit`, `photo`, `listItem`. All carry `id`, `createdAt`, `updatedAt`, `updatedBy` (per-install device id, for LWW tie-break), tombstone via `deleted`.
- spot: lat, lng, accuracy?, foundAt, speciesId (required), notes, habitat { hostTrees: [{plantId, ageMin?, ageMax?}], soil, vegetation, surroundingPlantIds[], indicatorSpeciesIds[], habitatNotes }, photoIds[], habitatPhotoIds[]
- visit: spotId, at, outcome 'found'|'harvested'|'nothing', note, photoIds[]
- photo: hash (sha-256), ext, size, width?, height?, takenAt? (EXIF, minimal parser). Blob stored separately, content-addressed.
- listItem: kind 'species'|'plant' (two shared vocabularies), name, lastUsedAt (drives "recent 5")

## Sync protocol (LWW + per-user gap-free seq cursor)

- Server table: `entities(id uuid pk, user_id, type, data jsonb, updated_at bigint, updated_by text, deleted bool, server_seq bigint)` — `server_seq` assigned from a sequence **on every insert AND update**; pushes serialized per user via `pg_advisory_xact_lock(hash(user_id))` → per-user seq stream is gap-free (fixes pagination/cursor races).
- LWW: apply incoming iff `(updatedAt, updatedBy) >= (stored.updatedAt, stored.updatedBy)` lexicographic — deterministic tie-break, idempotent retries.
- Client clocks: `updatedAt = max(now, lastKnownServerTime, prev.updatedAt + 1)` (monotonic per entity); compare `Date` header at sync, warn UI if skew > 5 min.
- Dirty tracking: persisted dirty set; after push, clear dirty **only if `updatedAt` unchanged since the pushed snapshot** (edit during in-flight push stays dirty). Pulled changes never marked dirty; own echoes merge idempotently.
- **Sync order: 1) upload pending blobs (persisted pending-upload set), 2) push entities, 3) pull.** Server never sees a photo entity before its blob (blob GET 404 still non-fatal client-side). Push response includes `missingBlobs` as a safety net that re-seeds the pending set.
- Cascade tombstones client-side (server is payload-opaque): deleting a spot tombstones its visits and all photo entities (spot's + visits'); deleting a visit tombstones its photo entities.
- Tombstones retained ~1 year. Per-user purge horizon (`users.purge_horizon_seq`): `pull?since <` horizon → HTTP 410 → client full re-pull (re-push dirty/local-only, drop non-dirty entities absent from server).
- Blob GC (daily + boot): delete blobs not referenced by any live `type='photo'` row (`data->>'hash'`, expression index) AND older than 24h grace AND past tombstone retention of referencing tombstones.
- Pagination/batching: pull pages of 500; push batches of 200; blobs uploaded sequentially (one PUT each, per-file progress — 2G realism).

## Server

- `users(id, username unique lowercase, password_hash argon2id via @node-rs/argon2, created_at, purge_horizon_seq)`
- Auth: JWT HS256 (`jose`), 90-day expiry; **sliding renewal** — any authenticated response >50% through token life includes a fresh token header. On 401, client silently re-logins with locally stored credentials (kept by design: no recovery flow exists, offline-first; tradeoff documented in README), never blocks local capture.
- Endpoints: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/sync/push`, `GET /api/sync/pull?since=`, `PUT/GET/HEAD /api/blobs/:hash` (raw octet-stream; stream to temp file hashing on the fly, rename on verify, fast 200 if exists), `GET /api/health`. Static app serving with SPA fallback, never for `/api/*`.
- Blob storage behind `BlobStorage` interface (fs now, S3 later). Photos volume.
- Offline signup conflict (409 at register): sync pauses; UI offers **rename OR "this is my account — log in instead"** (common two-device case). Local data kept either way.

## Client storage (offline-first)

- Whole structured dataset in memory (runes stores; a few MB at 10k spots). Photo blobs NEVER held in stores — object URLs created/revoked on demand.
- `LocalStore` interface, two impls:
  - `IdbStore` (default; Android): `idb`; entities + blobs + dirty/pending sets + drafts. `navigator.storage.persist()` requested; if denied → persistent warning banner.
  - `FsStore` (desktop opt-in): user folder; `spots-data.json` (atomic via `createWritable()` close-swap; create/delete flushed immediately, edits debounced, **flush on `visibilitychange:hidden`**) + `photos/<hash>.<ext>` real files.
- **Single-writer guard: `navigator.locks` at startup; second tab gets read-only "open in another tab" state, takes over when lock frees.**
- **Draft persistence: capture form (and visit editor) writes a draft to IndexedDB on every change; photo blobs written immediately on selection (camera app can kill the PWA on Android); auto-restore on return; `beforeNavigate` guard.**

## Maps / offline tiles

- MapLibre GL raster: OSM + ESRI World Imagery, URLs configurable in Settings. Tiles fetched with CORS; **opaque responses never cached** (7 MB quota padding bomb).
- SW tile caching: cache-first bucket `tiles-browse` (LRU-capped ~2000 tiles, trimmed periodically) + per-region caches `tiles-region-*` (uncapped, listed in Settings with sizes + delete).
- Download region: current view bbox + zoom-range slider → per-zoom tile counts + size estimate (~25 KB/tile OSM, ~40 KB sat), warn/refuse > 10k tiles, concurrency 4, progress, cancellable, resumable free via cache-first re-run.

## Service worker lifecycle

- Precache FULL SvelteKit `build` + `files` manifests at install (code-split chunks included — offline nav must not 404), cache keyed by `version`. On activate delete only old app-shell caches, never tile caches. Update UX: waiting SW → "Update available" toast → user tap → skipWaiting + reload. Never auto-skipWaiting.

## UI (light, opaque controls on map, ≥56px field targets, FAB clear of OSM attribution)

- `/login` — Create account | Log in; works offline (registered at first sync).
- `/` Map home: follows GPS (watchPosition from start; heading cone via `deviceorientationabsolute`, feature-detected, no permission prompt needed on Android, hidden if absent). Controls: locate-me, satellite toggle, species filter chip, layers/download-region, sync status chip (tap = sync now). Big `+` FAB. Bottom nav: Map | List | Settings.
- **3-tap capture commitment: FAB → species selector sheet AUTO-OPEN (only required choice) → tap recent species → Save.** GPS live-locks to fix; crosshair-over-map adjust (drag map under fixed center pin); accuracy meters shown, amber > 25 m; save never blocks on fix (last-known/map-center fallback). foundAt=now editable. Photos: Camera / Gallery. Habitat collapsed behind "Add habitat details". Sticky Save.
- `/spot/[id]` detail: photo strip, header, map thumb, **one-tap visit logging: Found / Harvested / Nothing buttons save instantly (at=now) with Undo + "Add note/photos" toast**; visit timeline; Edit / Delete (confirm) / Navigate (geo: link).
- `/list`: search (species+notes), same species filter, date-desc cards with thumb + distance.
- `/settings`: account, storage mode, sync now/status, offline regions, tile URLs, export/import, version.
- Selector bottom sheet: autofocused search, Recent ≤5, alphabetical rest, `+ Create "<text>"`, case-insensitive duplicate hint; multi-select variant with checkmarks + Done.
- Export backup: **streamed store-only zip (fflate streaming), never in-memory** — Android: incremental write to OPFS temp file → File → objectURL download; desktop: `showSaveFilePicker` stream. Import reverses.

## Testing / deployment

- vitest: shared schema tests; server integration tests on real Postgres (LWW/tie-break, seq-on-update, tombstone cascade+purge/410, auth, blob roundtrip+verify, per-user privacy, pagination); client sync-engine tests with fake stores.
- Multi-stage Dockerfile; docker-compose: caddy (auto-HTTPS, DOMAIN env) + api + postgres:17 + volumes (photos, pgdata, caddy). README: VPS + LAN no-TLS variant, backup notes, password-storage tradeoff.
