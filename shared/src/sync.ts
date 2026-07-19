import { z } from 'zod';
import { EntityTypeSchema, DataSchemaByType, type Entity } from './entities.js';

/**
 * Sync protocol (REST, incremental pull/push).
 *
 * - Cursor: per-user gap-free `serverSeq` (bigint, JSON-safe below 2^53).
 *   The server reassigns serverSeq on EVERY write and serializes pushes per
 *   user with an advisory lock, so a puller can never skip a change.
 * - Conflict resolution: last-write-wins per entity on the version tuple
 *   (updatedAt, updatedBy) — deterministic tie-break, idempotent retries.
 * - Deletions: tombstones (deleted=true). Payload is retained server-side so
 *   blob GC stays conservative; tombstones are purged after ~1 year, which
 *   advances the user's purge horizon (pull below horizon => HTTP 410 =>
 *   client full resync).
 */

export const ChangeSchema = z.object({
  id: z.string().min(8).max(64),
  type: EntityTypeSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  updatedBy: z.string().min(1).max(64),
  deleted: z.boolean(),
  data: z.unknown().nullable()
});
export type Change = z.infer<typeof ChangeSchema>;

export const PUSH_BATCH_LIMIT = 200;
export const PULL_PAGE_LIMIT = 500;

export const PushRequestSchema = z.object({
  changes: z.array(ChangeSchema).min(1).max(PUSH_BATCH_LIMIT)
});
export type PushRequest = z.infer<typeof PushRequestSchema>;

export interface PushResult {
  id: string;
  /** false when a newer version was already on the server (LWW) or the id belongs to another account. */
  applied: boolean;
}

export interface PushResponse {
  results: PushResult[];
  /** Photo blob hashes referenced by pushed photo entities that the server does not have yet. */
  missingBlobs: string[];
  /** Server clock (ms epoch) — used by clients to clamp their own timestamps and warn about skew. */
  serverTime: number;
}

export interface PullResponse {
  changes: Change[];
  /** Pass as ?since= on the next pull. */
  cursor: number;
  hasMore: boolean;
  serverTime: number;
}

/** Validate a change's payload against its type schema. Tombstones may carry data or null. */
export function validateChangeData(change: Change): { ok: true } | { ok: false; error: string } {
  if (change.data === null) {
    return change.deleted ? { ok: true } : { ok: false, error: 'live entity requires data' };
  }
  const schema = DataSchemaByType[change.type];
  const res = schema.safeParse(change.data);
  return res.success ? { ok: true } : { ok: false, error: res.error.issues[0]?.message ?? 'invalid data' };
}

export function entityToChange(e: Entity): Change {
  return {
    id: e.id,
    type: e.type,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    updatedBy: e.updatedBy,
    deleted: e.deleted,
    data: e.data
  };
}

/* ---------------------------------- auth ---------------------------------- */

export const UsernameSchema = z
  .string()
  .trim()
  .min(1, 'Username is required')
  .max(64, 'Username too long')
  .transform((s) => s.toLowerCase());

export const PasswordSchema = z.string().min(1, 'Password is required').max(256);

export const AuthRequestSchema = z.object({
  username: UsernameSchema,
  password: PasswordSchema
});
export type AuthRequest = z.infer<typeof AuthRequestSchema>;

export interface AuthResponse {
  token: string;
  userId: string;
  username: string;
}

export interface ApiError {
  error: string;
  message?: string;
}

/** Error codes used by the API. */
export const ERR = {
  USERNAME_TAKEN: 'username_taken',
  INVALID_CREDENTIALS: 'invalid_credentials',
  UNAUTHORIZED: 'unauthorized',
  CURSOR_PURGED: 'cursor_purged', // HTTP 410 — full resync required
  HASH_MISMATCH: 'hash_mismatch',
  NOT_FOUND: 'not_found',
  BAD_REQUEST: 'bad_request'
} as const;

/** Header carrying a transparently renewed JWT (sliding renewal). */
export const RENEWED_TOKEN_HEADER = 'x-spots-renewed-token';
