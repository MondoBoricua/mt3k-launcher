export const FULL_LIBRARY_SYNC_MAX_AGE_MS = 12 * 60 * 60 * 1_000
export const STARTUP_FULL_LIBRARY_SYNC_DELAY_MS = 5 * 60 * 1_000

/** Normal launches only need a full provider sync when the durable result has
 * become stale. Local installation discovery is handled independently. */
export function shouldScheduleFullLibrarySync(
  lastFullSyncAt: number | undefined,
  now = Date.now()
): boolean {
  if (
    typeof lastFullSyncAt !== 'number' ||
    !Number.isFinite(lastFullSyncAt) ||
    lastFullSyncAt <= 0
  ) {
    return true
  }
  if (!Number.isFinite(now) || now <= 0) return false
  if (lastFullSyncAt > now) return true
  return now - lastFullSyncAt >= FULL_LIBRARY_SYNC_MAX_AGE_MS
}
