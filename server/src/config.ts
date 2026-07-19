import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  photosDir: string;
  /** Directory with the built PWA; static serving is skipped when absent. */
  appDir: string | null;
  jwtSecret: Uint8Array;
  tokenTtlDays: number;
  tombstoneRetentionDays: number;
  blobGraceHours: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const photosDir = path.resolve(env.PHOTOS_DIR ?? './photos-dev');
  mkdirSync(photosDir, { recursive: true });

  const appDirEnv = env.APP_DIR ?? '../app/build';
  const appDirResolved = path.resolve(appDirEnv);
  const appDir = existsSync(path.join(appDirResolved, 'index.html')) ? appDirResolved : null;

  return {
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl: env.DATABASE_URL ?? 'postgres://spots:spots@localhost:5432/spots',
    photosDir,
    appDir,
    jwtSecret: loadJwtSecret(env, photosDir),
    tokenTtlDays: Number(env.TOKEN_TTL_DAYS ?? 90),
    tombstoneRetentionDays: Number(env.TOMBSTONE_RETENTION_DAYS ?? 365),
    blobGraceHours: Number(env.BLOB_GRACE_HOURS ?? 24)
  };
}

/**
 * JWT secret from env, or auto-generated once and persisted next to the
 * photo volume so a bare `docker compose up` works with zero configuration.
 */
function loadJwtSecret(env: NodeJS.ProcessEnv, photosDir: string): Uint8Array {
  if (env.JWT_SECRET && env.JWT_SECRET.length >= 16) {
    return new TextEncoder().encode(env.JWT_SECRET);
  }
  const secretFile = path.join(photosDir, '.jwt-secret');
  if (existsSync(secretFile)) {
    return Uint8Array.from(Buffer.from(readFileSync(secretFile, 'utf8').trim(), 'hex'));
  }
  const secret = randomBytes(32);
  writeFileSync(secretFile, secret.toString('hex'), { mode: 0o600 });
  return Uint8Array.from(secret);
}
