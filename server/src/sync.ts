import {
  ERR,
  PULL_PAGE_LIMIT,
  PushRequestSchema,
  incomingWins,
  validateChangeData,
  type Change,
  type PullResponse,
  type PushResponse,
  type PushResult
} from '@spots/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Sql } from './db.js';

type RequireAuth = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

interface EntityRow {
  id: string;
  type: string;
  created_at: number;
  updated_at: number;
  updated_by: string;
  deleted: boolean;
  data: unknown;
  server_seq: number;
  user_id?: string;
}

export function registerSyncRoutes(app: FastifyInstance, sql: Sql, requireAuth: RequireAuth): void {
  app.post('/api/sync/push', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = PushRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: ERR.BAD_REQUEST, message: parsed.error.issues[0]?.message });
    }
    const changes = parsed.data.changes;
    for (const change of changes) {
      const valid = validateChangeData(change);
      if (!valid.ok) {
        return reply.code(400).send({ error: ERR.BAD_REQUEST, message: `${change.type} ${change.id}: ${valid.error}` });
      }
    }
    const userId = req.userId;

    const results = await sql.begin(async (tx) => {
      // Serialize pushes per user: makes the per-user server_seq stream
      // strictly increasing with no gaps observable by a concurrent pull.
      await tx`select pg_advisory_xact_lock(hashtextextended(${userId}, 727271))`;
      const out: PushResult[] = [];
      for (const change of changes) {
        out.push(await applyChange(tx as unknown as Sql, userId, change));
      }
      return out;
    });

    // Which referenced photo blobs is the server still missing? Checked for
    // ALL pushed live photo entities (not just applied ones) — this re-seeds
    // a client whose earlier blob upload was lost (e.g. crash between blob
    // PUT and entity push, or GC of an orphan while the client was offline).
    const photoHashes = [
      ...new Set(
        changes
          .filter((c) => c.type === 'photo' && !c.deleted && c.data !== null)
          .map((c) => (c.data as { hash: string }).hash)
      )
    ];
    let missingBlobs: string[] = [];
    if (photoHashes.length > 0) {
      const present = await sql<{ hash: string }[]>`select hash from blobs where hash = any(${photoHashes})`;
      const presentSet = new Set(present.map((r) => r.hash));
      missingBlobs = photoHashes.filter((h) => !presentSet.has(h));
    }

    const res: PushResponse = { results, missingBlobs, serverTime: Date.now() };
    return reply.send(res);
  });

  app.get('/api/sync/pull', { preHandler: requireAuth }, async (req, reply) => {
    const sinceRaw = (req.query as { since?: string }).since ?? '0';
    const since = Number(sinceRaw);
    if (!Number.isFinite(since) || since < 0) {
      return reply.code(400).send({ error: ERR.BAD_REQUEST, message: 'invalid since cursor' });
    }
    const userId = req.userId;

    const [user] = await sql<{ purge_horizon_seq: number }[]>`
      select purge_horizon_seq from users where id = ${userId}`;
    if (!user) return reply.code(401).send({ error: ERR.UNAUTHORIZED });
    if (since > 0 && since < user.purge_horizon_seq) {
      // Tombstones the client never saw were purged — it must resync fully.
      return reply.code(410).send({ error: ERR.CURSOR_PURGED });
    }

    const rows = await sql<EntityRow[]>`
      select id, type, created_at, updated_at, updated_by, deleted, data, server_seq
      from entities
      where user_id = ${userId} and server_seq > ${since}
      order by server_seq
      limit ${PULL_PAGE_LIMIT + 1}`;

    const hasMore = rows.length > PULL_PAGE_LIMIT;
    const page = hasMore ? rows.slice(0, PULL_PAGE_LIMIT) : rows;
    const changes: Change[] = page.map((r) => ({
      id: r.id,
      type: r.type as Change['type'],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      updatedBy: r.updated_by,
      deleted: r.deleted,
      // Tombstone payloads are a server-side retention detail; never sent.
      data: r.deleted ? null : r.data
    }));
    const res: PullResponse = {
      changes,
      cursor: page.length > 0 ? page[page.length - 1]!.server_seq : since,
      hasMore,
      serverTime: Date.now()
    };
    return reply.send(res);
  });
}

async function applyChange(tx: Sql, userId: string, change: Change): Promise<PushResult> {
  const [existing] = await tx<{ updated_at: number; updated_by: string; user_id: string }[]>`
    select updated_at, updated_by, user_id from entities where id = ${change.id}`;

  if (existing && existing.user_id !== userId) {
    // Entity id belongs to another account — never touch it, never leak it.
    return { id: change.id, applied: false };
  }
  if (existing && !incomingWins(
    { updatedAt: change.updatedAt, updatedBy: change.updatedBy },
    { updatedAt: existing.updated_at, updatedBy: existing.updated_by }
  )) {
    return { id: change.id, applied: false };
  }

  const data = change.data === null ? null : tx.json(change.data as never);
  if (existing) {
    await tx`
      update entities set
        updated_at = ${change.updatedAt},
        updated_by = ${change.updatedBy},
        deleted = ${change.deleted},
        data = ${data},
        server_seq = nextval('entities_server_seq')
      where id = ${change.id}`;
  } else {
    await tx`
      insert into entities (id, user_id, type, created_at, updated_at, updated_by, deleted, data)
      values (${change.id}, ${userId}, ${change.type}, ${change.createdAt}, ${change.updatedAt},
              ${change.updatedBy}, ${change.deleted}, ${data})`;
  }
  return { id: change.id, applied: true };
}
