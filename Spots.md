# Spots

## Abstract

Spots is an application used to record and view findings of mushrooms (and possibly plants in the future). It records date & time of find, exact GPS location, any number of pictures the user wants to attach, and a habitat description. The user can add comments and log return visits (harvests) to each spot.

## Problem Statement

> How to know the location of each mushroom I've ever found so that I can return to harvest again?
> How to know the habitat I've found each species in so that I can find them again at different locations?

## Key Decisions

| Topic | Decision |
|---|---|
| Platform | Progressive Web App (PWA) — installable on Android, usable in any desktop browser, single codebase |
| Maps | MapLibre GL + OpenStreetMap tiles; satellite layer from a free provider (e.g. ESRI World Imagery). Offline tile caching is permitted by these providers |
| Offline | Full offline capture — saving spots (GPS, photos, all fields) works with no connectivity; syncs when back online |
| Backend | Self-hosted server |
| Tech stack | TypeScript everywhere: Svelte (SvelteKit) PWA + Node.js API + PostgreSQL + filesystem/S3-compatible blob storage |
| Local storage | Desktop: real files in a user-chosen folder (File System Access API). Android: persistent browser storage (OPFS/IndexedDB with `persist()` — no eviction, multi-GB quota) + export/backup, since Chrome on Android lacks the folder picker |
| Photos | Full-resolution originals stored and synced (no compression) |
| Seed data | All selector lists start empty; users build their own vocabulary |
| Sync conflicts | Last write wins, per spot (newest edit timestamp) |
| Auth | Login required to use the app. Username + password only; no email, no verification, no password recovery (lost password = lost account; local data survives on device) |
| Offline maps | Auto-cache browsed tiles + explicit "download region" prefetch (area + zoom levels) for planned trips. Prefetch is built regardless of provider policy; the tile source URL is configurable so it can be pointed at any provider |
| Deployment | Docker Compose: API + PostgreSQL + photo volume; runs on any VPS/home server/NAS behind a reverse proxy (HTTPS) |
| Units / language | Metric units; English UI |
| Registration | Open sign-up — anyone who reaches the server can create an account |
| Vocabularies | Selector lists (species, trees, plants, indicator mushrooms, …) are per-account and synced like all other entities |
| List view | v1 includes a list view alongside the map: date-sorted, species filter, opens the same spot detail view |
| Repo layout | Monorepo (pnpm workspaces): `app/` (SvelteKit PWA), `server/` (Node API), shared types package |
| App hosting | The Node API server also serves the built PWA — same origin, no CORS, no server-URL setting, one deployment |
| Sync trigger | Automatic on app start and when connectivity returns, plus a manual "sync now" button showing status/pending count |
| HTTPS | Docker Compose includes Caddy with automatic Let's Encrypt certs; works out of the box on a VPS with a domain |
| Photo storage (server) | Filesystem volume only in v1, behind a storage interface so S3-compatible backends can be added later |
| Offline signup conflict | Accounts can be created offline; if the username is taken at first sync, sync pauses and the user is prompted to rename — local data is kept |
| Shared vocabularies | One species list (species field + indicator mushrooms) and one tree/plant list (host trees + surrounding plants) |
| Account management | None in v1 — one account per device, no logout, no password change |
| Sync default | Always on (same origin, no toggle): auto-sync on start and on connectivity return; manual "sync now" button remains |

## UI Concepts

> `selector`: an intuitive UI element that allows the user to select an item from a list of a certain type (mushroom species, tree species, habitat types, …). It displays the most recently selected items first (up to 5), allows searching, and allows the user to create a new list item on the spot. Used wherever "(selector)" is mentioned.

## Functional Requirements

### 1. Save a spot

The user can save a "spot", entering:

- **Exact location** — device puts a pin at the current GPS location; user can drag the map to move the pin. Works offline: browsed map tiles are auto-cached, regions can be pre-downloaded (see Offline maps), and raw coordinates are shown as fallback.
- **Date & time of find** — defaults to now, editable.
- **Species** (selector)
- **Pictures** (of the mushroom) — camera or gallery, any number.
- **Notes**
- **Habitat:**
  - **Host trees / plants** (selector, multi-select)
    - Each host tree can have an age range (in years)
  - **Soil description**
  - **Vegetation**
  - **Surrounding plant species** — list of plant species (selector, multi-select)
  - **Indicator mushrooms** — other mushrooms found in the area together with this one (selector, multi-select)
  - **Habitat notes**
  - **Pictures** (of the habitat)

### 2. View spots

- User sees themselves on the map, including viewing direction (as in Google Maps).
- Map is centered on the user by default.
- Zoom in / out.
- Toggle satellite view / normal view.
- Filter spots shown: all species or selected mushroom species (selector, multi-select).
- Tapping/clicking a spot on the map opens its details.
- **List view** — a searchable list of all spots, sorted by date (newest first), with the same species filter; tapping an entry opens the same spot detail view as a map pin.

### 3. Edit & delete spots

- Any field of a spot can be edited after saving.
- Spots can be deleted (with confirmation).
- Edits and deletions sync like all other changes.

### 4. Visit log

- Each spot accumulates dated visit entries over time.
- A visit entry records: date & time, outcome (found / harvested / nothing there), optional note, optional photos.
- The original find is stored on the spot itself; the visit log starts empty.
- The spot detail view shows the visit history, so the productivity of a spot across seasons/years is visible.

## Non-functional Requirements

1. **Accounts** — login is required to use the app; account creation (username + password) is the first screen. No format requirements, no verification email, no password recovery. All data is still stored locally; the account exists locally and is registered with the server at first sync. If the username is already taken on the server, sync pauses and the user is prompted to pick a new username (local data is kept).
2. **Privacy** — a user only sees and edits their own spots.
3. **Offline-first storage** — all data is always stored on the local device first.
   - **Desktop (Chrome/Edge):** the user picks a real folder (e.g. `Documents/Spots`) via the File System Access API; the app stores data and photos as plain files there. No browser quota concerns, files are user-visible and survive browser data clears. Permission is retained across sessions.
   - **Android (installed PWA):** Chrome on Android does not support the folder picker, so data lives in persistent browser storage (OPFS/IndexedDB with `navigator.storage.persist()` — eviction disabled, quota typically a large share of free disk). Cloud sync plus a one-tap "export backup (zip)" cover durability and portability.
   - The storage layer is abstracted so both backends implement the same interface.
4. **Cloud sync** — always on: the app syncs local data to the self-hosted server it is served from. This lets the user record spots on their phone and see them in a desktop browser, and vice versa.
   - Sync is bidirectional and incremental.
   - Photos sync at full resolution. Storage is not a concern (real files on desktop, multi-GB persistent quota on Android); upload time on slow connections is the only cost.
   - Conflict resolution: last write wins per spot.
   - Deletions propagate via tombstones.
5. **Offline maps** — map tiles browsed while online are cached automatically. A "download region" feature lets the user select an area and zoom range to prefetch before a trip (with size estimate shown).
6. **Server** — self-hosted Node.js API with PostgreSQL for structured data and filesystem/S3-compatible storage for photos. Packaged as Docker Compose (API + Postgres + photo volume), run behind a reverse proxy providing HTTPS.

## Technical Notes (implementation defaults)

These are implementation choices, not requirements; deviate if a better option emerges during build.

- Every entity (spot, visit, photo, list item) has a client-generated UUID and `createdAt`/`updatedAt` timestamps — enables offline creation and last-write-wins sync. Selector list items are entities too, so vocabularies sync per account.
- Sync protocol: REST, incremental pull/push using per-entity `updatedAt` cursors; deletions as tombstones (retained ~1 year server-side).
- Auth: JWT access tokens, long-lived (~90 days) since there is no password recovery and the app must work offline for weeks; passwords hashed with argon2id.
- Photos: stored as-is; content-addressed (hash) filenames to dedupe and simplify sync.
- Export backup: single zip containing JSON data + photo files, importable by the app.
- Species is optional when saving a spot (unknown finds allowed); it can be set later via edit.
- Visit entries can be edited and deleted, syncing like spots.
- List view search covers species name and notes.
- Server-side photo blobs are garbage-collected once no live entity references them (after tombstone retention).

## Out of Scope (v1)

- iOS-specific support (PWA may partially work but is not a target).
- Sharing spots between users.
- Pre-seeded species databases or species identification.
- Password recovery / email.
- Plant findings (mushrooms only for now; data model should not preclude adding plants later).
