import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { makeRequireAuth, registerAuthRoutes } from './auth.js';
import type { BlobStorage } from './blob-storage.js';
import { registerBlobRoutes } from './blobs.js';
import type { Config } from './config.js';
import type { Sql } from './db.js';
import { registerSyncRoutes } from './sync.js';

export interface AppDeps {
  sql: Sql;
  storage: BlobStorage;
  config: Config;
  logger?: boolean;
}

export async function buildApp({ sql, storage, config, logger = true }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger, bodyLimit: 10 * 1024 * 1024 });
  const requireAuth = makeRequireAuth(config);

  app.get('/api/health', async () => ({ ok: true, time: Date.now() }));
  registerAuthRoutes(app, sql, config);
  registerSyncRoutes(app, sql, requireAuth);
  registerBlobRoutes(app, sql, storage, requireAuth, config.blobGraceHours);

  if (config.appDir) {
    await app.register(fastifyStatic, {
      root: config.appDir,
      wildcard: true,
      // Immutable hashed assets get long cache; index.html is revalidated so
      // the service worker sees new versions promptly.
      setHeaders(res, filePath) {
        if (/\/_app\/immutable\//.test(filePath)) {
          res.header('cache-control', 'public, max-age=31536000, immutable');
        } else {
          res.header('cache-control', 'no-cache');
        }
      }
    });
  }

  // SPA fallback: any non-API GET that missed a real file serves the shell.
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || !config.appDir || (req.method !== 'GET' && req.method !== 'HEAD')) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.header('cache-control', 'no-cache').sendFile('index.html');
  });

  return app;
}
