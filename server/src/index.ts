import { buildApp } from './app.js';
import { FsBlobStorage } from './blob-storage.js';
import { loadConfig } from './config.js';
import { createDb, migrate } from './db.js';
import { startGcTimer } from './gc.js';

const config = loadConfig();
const sql = createDb(config.databaseUrl);

await migrate(sql);

const storage = new FsBlobStorage(config.photosDir);
const app = await buildApp({ sql, storage, config });

startGcTimer(
  sql,
  storage,
  { tombstoneRetentionDays: config.tombstoneRetentionDays, blobGraceHours: config.blobGraceHours },
  (msg) => app.log.info(msg)
);

await app.listen({ port: config.port, host: config.host });
app.log.info(
  `Spots server up on :${config.port} — app: ${config.appDir ?? 'not built (API only)'}, photos: ${config.photosDir}`
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => sql.end({ timeout: 5 })).then(() => process.exit(0));
  });
}
