import { ERR } from '@spots/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Readable } from 'node:stream';
import { HashMismatchError, type BlobStorage } from './blob-storage.js';
import type { Sql } from './db.js';

type RequireAuth = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

const HASH_RE = /^[0-9a-f]{64}$/;

export function registerBlobRoutes(
  app: FastifyInstance,
  sql: Sql,
  storage: BlobStorage,
  requireAuth: RequireAuth,
  blobGraceHours: number
): void {
  // Raw octet-stream bodies are handed to routes as streams (photos can be
  // tens of MB; never buffered in memory).
  app.addContentTypeParser('application/octet-stream', (_req, payload, done) => {
    done(null, payload);
  });

  /** Does `userId` own any entity row (live or tombstone) referencing this photo hash? */
  async function ownsHash(userId: string, hash: string): Promise<boolean> {
    const rows = await sql`
      select 1 from entities
      where user_id = ${userId} and type = 'photo' and data->>'hash' = ${hash}
      limit 1`;
    return rows.length > 0;
  }

  app.put('/api/blobs/:hash', { preHandler: requireAuth, bodyLimit: 2 * 1024 * 1024 * 1024 }, async (req, reply) => {
    const { hash } = req.params as { hash: string };
    if (!HASH_RE.test(hash)) return reply.code(400).send({ error: ERR.BAD_REQUEST });
    const stream = req.body as Readable;

    // Fast path: blob already stored. Only short-circuit when the caller owns
    // a reference to it or it was uploaded recently (unreferenced-but-fresh);
    // otherwise re-verify the upload rather than leak blob existence.
    const [row] = await sql<{ fresh: boolean }[]>`
      select created_at > now() - make_interval(hours => ${blobGraceHours}) as fresh
      from blobs where hash = ${hash}`;
    if (row && (await storage.exists(hash)) && (row.fresh || (await ownsHash(req.userId, hash)))) {
      await drain(stream);
      return reply.code(200).send({ ok: true });
    }

    try {
      const { size } = await storage.put(hash, stream);
      await sql`
        insert into blobs (hash, size) values (${hash}, ${size})
        on conflict (hash) do update set size = excluded.size, created_at = now()`;
      return reply.code(201).send({ ok: true });
    } catch (err) {
      if (err instanceof HashMismatchError) {
        return reply.code(400).send({ error: ERR.HASH_MISMATCH });
      }
      throw err;
    }
  });

  const getOrHead = async (req: FastifyRequest, reply: FastifyReply) => {
    const { hash } = req.params as { hash: string };
    if (!HASH_RE.test(hash)) return reply.code(400).send({ error: ERR.BAD_REQUEST });
    // Privacy: 404 both when missing and when owned by someone else.
    if (!(await ownsHash(req.userId, hash)) || !(await storage.exists(hash))) {
      return reply.code(404).send({ error: ERR.NOT_FOUND });
    }
    const size = await storage.size(hash);
    reply
      .header('content-length', size)
      .header('content-type', 'application/octet-stream')
      // Content-addressed => immutable. `private`: authenticated, per-user.
      .header('cache-control', 'private, max-age=31536000, immutable');
    if (req.method === 'HEAD') return reply.send();
    return reply.send(storage.createReadStream(hash));
  };

  // Fastify auto-exposes HEAD for GET routes (exposeHeadRoutes).
  app.get('/api/blobs/:hash', { preHandler: requireAuth }, getOrHead);
}

async function drain(stream: Readable): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _chunk of stream) {
    /* discard */
  }
}
