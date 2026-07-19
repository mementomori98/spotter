import { data } from '$lib/state/data.svelte';
import type { DraftPhoto } from '$lib/storage/types';
import { readPhotoMeta } from '$lib/util/exif';
import { newId } from '$lib/util/ids';
import type { PhotoData } from '@spots/shared';

/**
 * Photos are stored as-is (full-resolution originals, no compression) and
 * content-addressed by SHA-256 — dedupes identical files and makes sync
 * uploads idempotent.
 */

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function extOf(file: File): string {
  const fromName = file.name.split('.').pop()?.toLowerCase();
  if (fromName && fromName.length <= 5 && /^[a-z0-9]+$/.test(fromName)) return fromName;
  const fromType = file.type.split('/').pop();
  return fromType === 'jpeg' ? 'jpg' : (fromType ?? 'jpg');
}

/**
 * Ingest a picked/captured file: hash, extract minimal EXIF, persist the
 * blob IMMEDIATELY (the camera app can kill the PWA on Android — drafts
 * must survive), and return a draft descriptor. The photo *entity* is only
 * created when the form is saved.
 */
export async function ingestFile(file: File): Promise<DraftPhoto> {
  const [hash, meta] = await Promise.all([sha256Hex(file), readPhotoMeta(file)]);
  const ext = extOf(file);
  await data.store.putBlob(hash, ext, file);
  return { hash, ext, size: file.size, ...meta };
}

/** Turn draft photos into photo entities (on form save). Returns entity ids. */
export async function commitDraftPhotos(drafts: DraftPhoto[]): Promise<string[]> {
  const ids: string[] = [];
  for (const d of drafts) {
    // Reuse an existing live photo entity with the same content (dedupe).
    const existing = data.livePhotos().find((p) => p.data.hash === d.hash);
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const payload: PhotoData = {
      hash: d.hash,
      ext: d.ext,
      size: d.size,
      ...(d.width ? { width: d.width } : {}),
      ...(d.height ? { height: d.height } : {}),
      ...(d.takenAt ? { takenAt: d.takenAt } : {})
    };
    const id = newId();
    await data.upsert('photo', id, payload);
    await data.queueUpload(d.hash, d.ext);
    ids.push(id);
  }
  return ids;
}

/** Discard draft photos whose blobs no committed photo entity references. */
export async function discardDraftPhotos(drafts: DraftPhoto[]): Promise<void> {
  for (const d of drafts) {
    const used = data.livePhotos().some((p) => p.data.hash === d.hash);
    if (!used) await data.store.deleteBlob(d.hash, d.ext);
  }
}

export async function getPhotoBlobById(photoId: string): Promise<Blob | undefined> {
  const photo = data.getPhoto(photoId);
  if (!photo) return undefined;
  return data.store.getBlob(photo.data.hash, photo.data.ext);
}
