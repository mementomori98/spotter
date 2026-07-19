# 🍄 Spots

Record and revisit mushroom finding spots. Offline-first PWA (Android + desktop browser) with a
self-hosted sync server. Built from [spots.md](./Spots.md) — see
[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the agreed design.

## What it does

Mark a find in three taps: **+** on the map → tap the species → **Save**. GPS, time, photos
(full-resolution), notes, and a rich habitat description (host trees with age ranges, soil,
vegetation, surrounding plants, indicator mushrooms) are captured per spot. Later, log return
visits (Found / Harvested / Nothing — one tap each) to see how productive a spot is across
seasons. Everything works with zero connectivity — map tiles included — and syncs to your own
server when you're back online.

## Deploy (VPS or home server with a domain)

```sh
cp .env.example .env        # set DOMAIN and POSTGRES_PASSWORD
docker compose up -d --build
```

That's it: Caddy terminates HTTPS with automatic Let's Encrypt certificates, the API serves the
app on the same origin, PostgreSQL and the photo volume persist in named Docker volumes. Open
`https://your-domain`, create an account, install to home screen on Android.

**LAN-only (no domain, plain HTTP)**: `docker compose -f docker-compose.local.yml up -d --build`
→ `http://localhost:8080`. Note the secure-context caveat inside that file (geolocation/camera on
phones require HTTPS or localhost).

**Free hosting at home** (old laptop / Raspberry Pi + free DuckDNS domain): see
[docs/HOME-SERVER.md](./docs/HOME-SERVER.md).

**Azure free tier** (free VM for 12 months): see [docs/AZURE.md](./docs/AZURE.md).

## Development

```sh
pnpm install
pnpm build                       # shared -> app -> server
pnpm test                        # all tests (server tests boot a real embedded Postgres)
pnpm dev:server                  # API on :8080 (needs a Postgres, see DATABASE_URL)
pnpm dev:app                     # Vite dev server for the PWA
```

Repo layout (pnpm workspaces): `shared/` types + zod schemas + sync/LWW logic used by both sides;
`app/` SvelteKit 2 / Svelte 5 PWA; `server/` Fastify 5 API + PostgreSQL + filesystem photo
storage (behind an interface, S3-ready).

## Things worth knowing

- **Accounts are minimal by design**: username + password, no email, **no password recovery** — a
  lost password means a lost account. Local data survives on the device either way. Accounts can
  be created fully offline and register with the server at first sync; if the name is taken you
  can log in instead or rename — nothing is lost.
- **Credentials are stored on the device** so the app can silently re-authenticate after months
  offline (tokens live ~90 days with sliding renewal). Don't reuse a valuable password.
- **Sync**: last-write-wins per record on an (updatedAt, deviceId) version; deletions propagate
  as tombstones kept for a year; photos are content-addressed (SHA-256), uploaded before the
  records that reference them, and garbage-collected server-side once nothing references them.
- **Storage**: on desktop Chrome/Edge you can point Spots at a real folder (Settings → Storage) —
  data and photos become plain files you can see and back up. On Android it uses persistent
  browser storage; use Settings → Backup → Export (zip) for portability.
- **Offline maps**: browsed tiles are cached automatically (capped, LRU); "download this area"
  saves a chosen region and zoom range for a trip. OSM and Esri imagery are the defaults — mind
  their usage policies; tile URLs are configurable in Settings.
- **Privacy**: spot locations are sensitive (that's the point). Each user only ever sees their own
  data; photo downloads are authorized per user even though blobs are content-addressed.
- There is no rate limiting on the open sign-up endpoint in v1 — keep the server URL private or
  add a Caddy rate-limit if you expose it publicly.

## Verification status

CI-grade checks run on every build: TypeScript strict mode everywhere, `svelte-check`, unit tests
for the LWW/sync logic, server integration tests against a real PostgreSQL (auth, LWW ties,
tombstone cascade + purge-horizon resync, blob roundtrip + privacy, pagination), and an end-to-end
two-device sync exercise.
