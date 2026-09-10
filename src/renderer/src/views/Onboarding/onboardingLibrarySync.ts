interface OnboardingLibrarySyncOptions {
  baselineStartedAt?: number
  initLibrary: () => Promise<void>
  refreshLibrary: () => Promise<void>
  getSyncStartedAt: () => number | undefined
}

export const ONBOARDING_SYNC_GATE_TIMEOUT_MS = 30_000

/**
 * Starts the setup scan even when there has never been a sync session before.
 * If the first refresh only joined a session that was already running when the
 * user entered setup, a second pass gives newly connected providers their own
 * complete onboarding session.
 */
export async function runOnboardingLibrarySync({
  baselineStartedAt,
  initLibrary,
  refreshLibrary,
  getSyncStartedAt
}: OnboardingLibrarySyncOptions): Promise<void> {
  await initLibrary()
  await refreshLibrary()
  if (getSyncStartedAt() === baselineStartedAt) await refreshLibrary()
}
