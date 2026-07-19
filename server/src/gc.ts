import type { BlobStorage } from './blob-storage.js';
import type { Sql } from './db.js';

/**
 * Purge tombstones older than the retention window and advance each affected
 * user's purge horizon (max purged server_seq), so clients holding an older
 * cursor get 410 on pull and perform a full resync.
 */
export async function purgeTombstones(sql: Sql, retentionDays: number): Promise<number> {
  const cutoff = Date.now() - retentionDays * 86400_000;
  // Single statement: the delete and the horizon advance commit atomically.
  // A pull can never observe purged tombstones with a stale horizon (which
  // would let it keep deleted entities forever without a 410).
  const updated = await sql<{ id: string }[]>`
    with purged as (
      delete from entities
      where deleted and updated_at < ${cutoff}
      returning user_id, server_seq
    ),
    agg as (
      select user_id, max(server_seq) as max_seq from purged group by user_id
    )
    update users u
    set purge_horizon_seq = greatest(u.purge_horizon_seq, agg.max_seq)
    from agg
    where u.id = agg.user_id
    returning u.id`;
  return updated.length;
}

/**
 * Delete blob files/rows referenced by no entity row at all (live OR
 * tombstone — tombstones keep their payload precisely so this stays
 * conservative), with a grace window so a blob uploaded moments before its
 * photo entity is pushed is never collected.
 */
export async function gcBlobs(sql: Sql, storage: BlobStorage, graceHours: number): Promise<number> {
  const orphans = await sql<{ hash: string }[]>`
    select hash from blobs
    where created_at < now() - make_interval(hours => ${graceHours})
      and not exists (
        select 1 from entities e where e.type = 'photo' and e.data->>'hash' = blobs.hash
      )`;
  let removed = 0;
  for (const { hash } of orphans) {
    // Delete the row first, re-checking references at delete time (a photo
    // push may have landed since the SELECT); only then remove the file.
    const gone = await sql<{ hash: string }[]>`
      delete from blobs
      where hash = ${hash}
        and created_at < now() - make_interval(hours => ${graceHours})
        and not exists (
          select 1 from entities e where e.type = 'photo' and e.data->>'hash' = ${hash}
        )
      returning hash`;
    if (gone.length > 0) {
      await storage.delete(hash);
      removed++;
    }
  }
  return removed;
}

export function startGcTimer(
  sql: Sql,
  storage: BlobStorage,
  opts: { tombstoneRetentionDays: number; blobGraceHours: number },
  log: (msg: string) => void
): NodeJS.Timeout {
  const run = async () => {
    try {
      const tombstones = await purgeTombstones(sql, opts.tombstoneRetentionDays);
      const blobs = await gcBlobs(sql, storage, opts.blobGraceHours);
      if (tombstones > 0 || blobs > 0) log(`gc: purged ${tombstones} tombstone group(s), ${blobs} blob(s)`);
    } catch (err) {
      log(`gc failed: ${String(err)}`);
    }
  };
  void run(); // once at boot
  const timer = setInterval(run, 24 * 3600_000);
  timer.unref();
  return timer;
}
