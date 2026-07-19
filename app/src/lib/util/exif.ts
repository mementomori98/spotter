/**
 * Minimal EXIF reader: extracts DateTimeOriginal and pixel dimensions from a
 * JPEG without any library. Fails soft — photos work fine without metadata.
 */

export interface PhotoMeta {
  takenAt?: number;
  width?: number;
  height?: number;
}

export async function readPhotoMeta(file: Blob): Promise<PhotoMeta> {
  try {
    const head = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (head.byteLength < 4 || head.getUint16(0) !== 0xffd8) return {}; // not a JPEG
    const meta: PhotoMeta = {};
    let offset = 2;
    while (offset + 4 <= head.byteLength) {
      if (head.getUint8(offset) !== 0xff) break;
      const marker = head.getUint8(offset + 1);
      const size = head.getUint16(offset + 2);
      if (marker === 0xe1 && meta.takenAt === undefined) {
        const takenAt = parseExifDate(head, offset + 4, size - 2);
        if (takenAt !== undefined) meta.takenAt = takenAt;
      }
      // SOF0..SOF15 (except DHT/JPG/DAC) carry dimensions.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        meta.height = head.getUint16(offset + 5);
        meta.width = head.getUint16(offset + 7);
        break;
      }
      offset += 2 + size;
    }
    return meta;
  } catch {
    return {};
  }
}

function parseExifDate(view: DataView, start: number, length: number): number | undefined {
  // "Exif\0\0" + TIFF header
  if (length < 14) return undefined;
  const str = (o: number, n: number) => {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(view.getUint8(o + i));
    return s;
  };
  if (str(start, 6) !== 'Exif\0\0') return undefined;
  const tiff = start + 6;
  const le = str(tiff, 2) === 'II'; // little endian?
  const u16 = (o: number) => view.getUint16(o, le);
  const u32 = (o: number) => view.getUint32(o, le);
  const end = start + length;

  const readIfdDate = (ifdOffset: number, wantTag: number): number | string | undefined => {
    const base = tiff + ifdOffset;
    if (base + 2 > end) return undefined;
    const count = u16(base);
    for (let i = 0; i < count; i++) {
      const entry = base + 2 + i * 12;
      if (entry + 12 > end) return undefined;
      const tag = u16(entry);
      if (tag === wantTag) {
        if (tag === 0x8769) return u32(entry + 8); // ExifIFD pointer
        const valOffset = tiff + u32(entry + 8);
        if (valOffset + 19 > end) return undefined;
        return str(valOffset, 19); // "YYYY:MM:DD HH:MM:SS"
      }
    }
    return undefined;
  };

  const exifIfd = readIfdDate(u32(tiff + 4), 0x8769);
  if (typeof exifIfd !== 'number') return undefined;
  const raw = readIfdDate(exifIfd, 0x9003); // DateTimeOriginal
  if (typeof raw !== 'string') return undefined;
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(raw);
  if (!m) return undefined;
  const ms = new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}
