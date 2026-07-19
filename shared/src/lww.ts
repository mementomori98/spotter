/**
 * Last-write-wins version ordering.
 *
 * Version = (updatedAt, updatedBy) compared lexicographically.
 * updatedBy (per-install device id) breaks exact-millisecond ties
 * deterministically, so two devices can never flip-flop an entity.
 */
export function compareVersions(
  aUpdatedAt: number,
  aUpdatedBy: string,
  bUpdatedAt: number,
  bUpdatedBy: string
): number {
  if (aUpdatedAt !== bUpdatedAt) return aUpdatedAt < bUpdatedAt ? -1 : 1;
  if (aUpdatedBy !== bUpdatedBy) return aUpdatedBy < bUpdatedBy ? -1 : 1;
  return 0;
}

/**
 * Should `incoming` replace `stored`?
 * `>=` (not `>`) keeps retried pushes of the identical version idempotent.
 */
export function incomingWins(
  incoming: { updatedAt: number; updatedBy: string },
  stored: { updatedAt: number; updatedBy: string }
): boolean {
  return compareVersions(incoming.updatedAt, incoming.updatedBy, stored.updatedAt, stored.updatedBy) >= 0;
}

/**
 * Next local timestamp for an entity write.
 * Monotonic per entity and clamped by the last known server time, so a
 * device with a badly skewed clock cannot silently lose every edit
 * (past skew) or freeze out other devices (future skew is surfaced as a
 * UI warning when > 5 min).
 */
export function nextUpdatedAt(now: number, prevUpdatedAt: number, lastKnownServerTime: number): number {
  return Math.max(now, lastKnownServerTime, prevUpdatedAt + 1);
}

/** Clock skew (ms) beyond which the UI should warn the user. */
export const CLOCK_SKEW_WARN_MS = 5 * 60 * 1000;
