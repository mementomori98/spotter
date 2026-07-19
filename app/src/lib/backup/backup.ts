import { data } from '$lib/state/data.svelte';
import { session } from '$lib/state/session.svelte';
import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import type { Entity } from '@spots/shared';
import { entityToChange, incomingWins, validateChangeData } from '@spots/shared';

/**
 * Backup export/import: a single zip with `entities.json` + `photos/<hash>.<ext>`.
 *
 * The zip is STREAMED — never assembled in memory (photo libraries are
 * multi-GB). Desktop: straight into a save-picker stream. Android (no save
 * picker): incrementally into an OPFS temp file, then downloaded via a
 * disk-backed object URL.
 */

const EXPORT_TMP = 'spots-export.zip';

export async function exportBackup(onProgress: (msg: string) => void): Promise<void> {
  // Quota pre-check: the temp zip roughly doubles photo storage on Android.
  const estimate = await navigator.storage?.estimate?.();
  if (estimate?.quota && estimate.usage && estimate.quota - estimate.usage < estimate.usage) {
    throw new Error('Not enough free storage for an export — free up space or export on desktop.');
  }

  const useSavePicker = 'showSaveFilePicker' in window;
  let writable: FileSystemWritableFileStream;
  let opfsDir: FileSystemDirectoryHandle | null = null;

  if (useSavePicker) {
    const handle = await window.showSaveFilePicker({
      suggestedName: `spots-backup-${new Date().toISOString().slice(0, 10)}.zip`,
      types: [{ description: 'Zip archive', accept: { 'application/zip': ['.zip'] } }]
    });
    writable = await handle.createWritable();
  } else {
    opfsDir = await navigator.storage.getDirectory();
    const file = await opfsDir.getFileHandle(EXPORT_TMP, { create: true });
    writable = await file.createWritable();
  }

  try {
    // Serialize zip chunks into the writable in order.
    let writeChain = Promise.resolve();
    let zipDone: (v?: unknown) => void;
    let zipFail: (e: Error) => void;
    const finished = new Promise((resolve, reject) => {
      zipDone = resolve;
      zipFail = reject;
    });
    const zip = new Zip((err, chunk, final) => {
      if (err) {
        zipFail(err);
        return;
      }
      writeChain = writeChain.then(async () => {
        await writable.write(chunk);
        if (final) zipDone();
      });
    });

    const entities = [...data.entities.values()];
    const json = new ZipDeflate('entities.json');
    zip.add(json);
    json.push(
      new TextEncoder().encode(
        JSON.stringify({ version: 1, exportedAt: Date.now(), username: session.current?.username, entities })
      ),
      true
    );

    const photos = data.livePhotos();
    let done = 0;
    const seen = new Set<string>();
    for (const photo of photos) {
      const { hash, ext } = photo.data;
      if (seen.has(hash)) continue;
      seen.add(hash);
      onProgress(`Packing photo ${++done}/${photos.length}`);
      const blob = await data.store.getBlob(hash, ext);
      if (!blob) continue;
      const entry = new ZipPassThrough(`photos/${hash}.${ext}`); // photos are already compressed
      zip.add(entry);
      entry.push(new Uint8Array(await blob.arrayBuffer()), true);
      await writeChain; // keep memory flat: one photo in flight
    }
    zip.end();
    await finished;
    await writeChain;
    await writable.close();

    if (!useSavePicker && opfsDir) {
      onProgress('Preparing download');
      const file = await (await opfsDir.getFileHandle(EXPORT_TMP)).getFile();
      // Disk-backed File: the download streams from disk, no OOM.
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = `spots-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      // Give the download manager time to open the stream before cleanup.
      setTimeout(() => {
        URL.revokeObjectURL(url);
        void opfsDir!.removeEntry(EXPORT_TMP).catch(() => {});
      }, 60_000);
    }
  } catch (err) {
    try {
      await writable.abort();
    } catch {
      /* already closed */
    }
    if (opfsDir) await opfsDir.removeEntry(EXPORT_TMP).catch(() => {});
    throw err;
  }
}

/** Remove stale export temp files (crashed exports). Called at boot. */
export async function sweepExportTemp(): Promise<void> {
  try {
    const dir = await navigator.storage.getDirectory();
    await dir.removeEntry(EXPORT_TMP);
  } catch {
    /* none */
  }
}

/**
 * Import a backup zip: entities merge by LWW and are marked dirty (an import
 * is a local write — it syncs up like any other change); photos are restored
 * and queued for upload.
 */
export async function importBackup(file: File, onProgress: (msg: string) => void): Promise<number> {
  if (data.readOnly) throw new Error('This tab is read-only (Spots is open in another tab).');
  let imported = 0;
  let entitiesJson: Uint8Array[] = [];
  const photoWrites: Promise<void>[] = [];
  let streamError: Error | null = null; // fflate callbacks must not throw

  const unzip = new Unzip((entry) => {
    if (entry.name === 'entities.json') {
      entry.ondata = (err, chunk, final) => {
        if (err) streamError ??= err;
        else entitiesJson.push(chunk);
        void final;
      };
      entry.start();
    } else if (entry.name.startsWith('photos/')) {
      const m = /^photos\/([0-9a-f]{64})\.(\w+)$/.exec(entry.name);
      if (!m) return;
      const [, hash, ext] = m;
      const chunks: Uint8Array[] = [];
      entry.ondata = (err, chunk, final) => {
        if (err) {
          streamError ??= err;
          return;
        }
        chunks.push(chunk);
        if (final) {
          photoWrites.push(
            data.store.putBlob(hash!, ext!, new Blob(chunks as BlobPart[])).then(() => {
              onProgress(`Restored photo ${photoWrites.length}`);
            })
          );
        }
      };
      entry.start();
    }
  });
  unzip.register(UnzipInflate);

  const reader = file.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      unzip.push(new Uint8Array(0), true);
      break;
    }
    unzip.push(value, false);
  }
  await Promise.all(photoWrites);
  if (streamError) throw streamError;

  const text = new TextDecoder().decode(concat(entitiesJson));
  entitiesJson = [];
  const parsed = JSON.parse(text) as { entities: Entity[] };
  if (!Array.isArray(parsed.entities)) throw new Error('Not a Spots backup (entities.json missing).');

  const toSave: Entity[] = [];
  for (const entity of parsed.entities) {
    // Validate against the shared schemas — a tampered or incompatible
    // backup must not poison the local store / next push batch.
    let valid = false;
    try {
      valid =
        typeof entity.id === 'string' &&
        typeof entity.updatedAt === 'number' &&
        typeof entity.updatedBy === 'string' &&
        validateChangeData(entityToChange(entity)).ok;
    } catch {
      valid = false;
    }
    if (!valid) continue;
    const local = data.entities.get(entity.id);
    if (local && !incomingWins(entity, local)) continue;
    data.entities.set(entity.id, entity);
    toSave.push(entity);
    data.dirty.add(entity.id);
    if (entity.type === 'photo' && !entity.deleted && entity.data) {
      const { hash, ext } = entity.data as { hash: string; ext: string };
      data.pendingUploads.add(`${hash}.${ext}`);
    }
    imported++;
  }
  if (toSave.length > 0) await data.store.saveEntities(toSave);
  await data.setCursor(data.cursor); // persists sets via the calls below
  await Promise.all([
    import('$lib/storage/meta').then(({ setMeta }) => setMeta('dirty', [...data.dirty])),
    import('$lib/storage/meta').then(({ setMeta }) => setMeta('pendingUploads', [...data.pendingUploads]))
  ]);
  data.onLocalChange();
  return imported;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
