import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { AuthRequestSchema, ERR, RENEWED_TOKEN_HEADER, type AuthResponse } from '@spots/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import type { Config } from './config.js';
import type { Sql } from './db.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

export async function signToken(userId: string, config: Config): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${config.tokenTtlDays}d`)
    .sign(config.jwtSecret);
}

/**
 * Auth guard. Also does sliding renewal: past 50% of the token's life a
 * fresh token is attached as a response header, so a device that syncs at
 * least once every ~45 days never sees its token expire.
 */
export function makeRequireAuth(config: Config) {
  return async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: ERR.UNAUTHORIZED });
    }
    try {
      const { payload } = await jwtVerify(auth.slice(7), config.jwtSecret, { algorithms: ['HS256'] });
      if (!payload.sub) throw new Error('no subject');
      req.userId = payload.sub;
      const ttlSec = config.tokenTtlDays * 86400;
      if (payload.exp && payload.exp - Date.now() / 1000 < ttlSec / 2) {
        reply.header(RENEWED_TOKEN_HEADER, await signToken(payload.sub, config));
      }
    } catch {
      return reply.code(401).send({ error: ERR.UNAUTHORIZED });
    }
  };
}

export function registerAuthRoutes(app: FastifyInstance, sql: Sql, config: Config): void {
  app.post('/api/auth/register', async (req, reply) => {
    const parsed = AuthRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: ERR.BAD_REQUEST, message: parsed.error.issues[0]?.message });
    }
    const { username, password } = parsed.data;
    const passwordHash = await argonHash(password);
    try {
      const [user] = await sql<{ id: string }[]>`
        insert into users (username, password_hash) values (${username}, ${passwordHash})
        returning id`;
      const res: AuthResponse = { token: await signToken(user!.id, config), userId: user!.id, username };
      return reply.code(201).send(res);
    } catch (err: unknown) {
      if ((err as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: ERR.USERNAME_TAKEN });
      }
      throw err;
    }
  });

  app.post('/api/auth/login', async (req, reply) => {
    const parsed = AuthRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: ERR.BAD_REQUEST, message: parsed.error.issues[0]?.message });
    }
    const { username, password } = parsed.data;
    const [user] = await sql<{ id: string; password_hash: string }[]>`
      select id, password_hash from users where username = ${username}`;
    if (!user || !(await argonVerify(user.password_hash, password))) {
      return reply.code(401).send({ error: ERR.INVALID_CREDENTIALS });
    }
    const res: AuthResponse = { token: await signToken(user.id, config), userId: user.id, username };
    return reply.send(res);
  });
}
