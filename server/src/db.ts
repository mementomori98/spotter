import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

export type Sql = postgres.Sql;

export function createDb(databaseUrl: string): Sql {
  return postgres(databaseUrl, {
    onnotice: () => {},
    // bigint columns (server_seq) fit in JS numbers for any realistic
    // dataset (< 2^53); parse as number so JSON serialization is natural.
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (v: number | bigint) => String(v),
        parse: (v: string) => Number(v)
      }
    }
  });
}

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

/** Apply pending SQL migrations (idempotent, safe under concurrent boots). */
export async function migrate(sql: Sql): Promise<void> {
  await sql`create table if not exists schema_migrations (version int primary key, applied_at timestamptz not null default now())`;
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(727270)`;
    const applied = new Set((await tx`select version from schema_migrations`).map((r) => Number(r.version)));
    for (const file of files) {
      const version = Number(file.split('_')[0]);
      if (applied.has(version)) continue;
      await tx.unsafe(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
      await tx`insert into schema_migrations (version) values (${version})`;
    }
  });
}
