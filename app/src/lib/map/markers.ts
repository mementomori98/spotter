import { RATING_COLORS, UNRATED_COLOR, type Rating } from '$lib/util/rating';

/**
 * Canvas-generated map markers. Everything — the species icon (or colored
 * dot) AND the tiny rating text below it — is baked into one bitmap, so the
 * map needs NO glyph server and stays fully offline.
 *
 * All markers share a fixed layout so the symbol layer can use one constant
 * anchor offset: the dot/icon center always sits exactly on the spot's
 * coordinates, the badge hangs below.
 */

/** Logical (CSS px) marker geometry; rendered at 2x for crisp screens. */
export const MARKER_W = 56;
export const MARKER_H = 60;
export const CIRCLE_D = 38; // dot / icon diameter (+~20% radius per field feedback)
export const CIRCLE_CENTER_Y = 21; // -> icon-offset [0, -CIRCLE_CENTER_Y] with anchor 'top'
const BADGE_TOP = 43;
const BADGE_H = 15;
const SCALE = 2; // pixelRatio

export function markerKey(iconPhotoId: string | null, rating: Rating | null): string {
  return iconPhotoId ? `icon:${iconPhotoId}:${rating ?? 'x'}` : `dot:${rating ?? 'x'}`;
}

export function dotKey(rating: Rating | null): string {
  return `dot:${rating ?? 'x'}`;
}

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = MARKER_W * SCALE;
  canvas.height = MARKER_H * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  return [canvas, ctx];
}

function drawBadge(ctx: CanvasRenderingContext2D, rating: Rating): void {
  const text = rating;
  ctx.font = '800 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = Math.max(22, ctx.measureText(text).width + 10);
  const x = MARKER_W / 2 - w / 2;
  const r = BADGE_H / 2;
  // white pill
  ctx.beginPath();
  ctx.roundRect(x, BADGE_TOP, w, BADGE_H, r);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // rating text in the rating's color (dark enough on white for legibility)
  ctx.fillStyle = rating === '+++' ? '#b8860b' : RATING_COLORS[rating];
  ctx.fillText(text, MARKER_W / 2, BADGE_TOP + BADGE_H / 2 + 0.5);
}

function toImageData(canvas: HTMLCanvasElement): ImageData {
  return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
}

/** Colored dot (rating color; red when unrated) + optional rating badge. */
export function makeDotMarker(rating: Rating | null): ImageData {
  const [canvas, ctx] = makeCanvas();
  const cx = MARKER_W / 2;
  const r = CIRCLE_D / 2;
  ctx.beginPath();
  ctx.arc(cx, CIRCLE_CENTER_Y, r, 0, Math.PI * 2);
  ctx.fillStyle = rating ? RATING_COLORS[rating] : UNRATED_COLOR;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  if (rating) drawBadge(ctx, rating);
  return toImageData(canvas);
}

/** Circular species icon with white ring + optional rating badge. */
export async function makeIconMarker(iconBlob: Blob, rating: Rating | null): Promise<ImageData> {
  const bitmap = await createImageBitmap(iconBlob);
  const [canvas, ctx] = makeCanvas();
  const cx = MARKER_W / 2;
  const r = CIRCLE_D / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, CIRCLE_CENTER_Y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(bitmap, cx - r, CIRCLE_CENTER_Y - r, CIRCLE_D, CIRCLE_D);
  ctx.restore();
  bitmap.close();
  ctx.beginPath();
  ctx.arc(cx, CIRCLE_CENTER_Y, r, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  if (rating) drawBadge(ctx, rating);
  return toImageData(canvas);
}

export const MARKER_PIXEL_RATIO = SCALE;
