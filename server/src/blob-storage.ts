import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

export class HashMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(`blob hash mismatch: expected ${expected}, got ${actual}`);
  }
}

/**
 * Content-addressed blob storage. v1 ships the filesystem implementation;
 * an S3-compatible one can be added behind the same interface later.
 */
export interface BlobStorage {
  exists(hash: string): Promise<boolean>;
  /** Streams to storage while hashing; rejects with HashMismatchError and stores nothing on mismatch. */
  put(hash: string, stream: Readable): Promise<{ size: number }>;
  createReadStream(hash: string): Readable;
  size(hash: string): Promise<number>;
  delete(hash: string): Promise<void>;
}

export class FsBlobStorage implements BlobStorage {
  constructor(private readonly root: string) {}

  private pathFor(hash: string): string {
    return path.join(this.root, hash.slice(0, 2), hash);
  }

  async exists(hash: string): Promise<boolean> {
    return existsSync(this.pathFor(hash));
  }

  async put(hash: string, stream: Readable): Promise<{ size: number }> {
    const tmpDir = path.join(this.root, 'tmp');
    await mkdir(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, randomUUID());
    const hasher = createHash('sha256');
    let size = 0;
    stream.on('data', (chunk: Buffer) => {
      hasher.update(chunk);
      size += chunk.length;
    });
    try {
      await pipeline(stream, createWriteStream(tmpFile));
      const actual = hasher.digest('hex');
      if (actual !== hash) throw new HashMismatchError(hash, actual);
      const dest = this.pathFor(hash);
      await mkdir(path.dirname(dest), { recursive: true });
      await rename(tmpFile, dest);
      return { size };
    } catch (err) {
      await rm(tmpFile, { force: true });
      throw err;
    }
  }

  createReadStream(hash: string) {
    return createReadStream(this.pathFor(hash));
  }

  async size(hash: string): Promise<number> {
    return (await stat(this.pathFor(hash))).size;
  }

  async delete(hash: string): Promise<void> {
    await rm(this.pathFor(hash), { force: true });
  }
}
