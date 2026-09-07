export const XBOX_GAME_PASS_NEW_WINDOW_MS = 45 * 24 * 60 * 60 * 1_000
export const XBOX_GAME_PASS_HISTORY_RETENTION_MS = 365 * 24 * 60 * 60 * 1_000

export interface XboxGamePassHistoryState {
  initialized: boolean
  activeProductIds: string[]
  membershipDetectedAt: Record<string, number>
}

export interface XboxGamePassHistoryUpdate {
  state: XboxGamePassHistoryState
  currentDetectedAt: Map<string, number>
}

export function emptyXboxGamePassHistory(): XboxGamePassHistoryState {
  return { initialized: false, activeProductIds: [], membershipDetectedAt: {} }
}

/** Advances the locally observed Game Pass membership. The first catalog is a
 * baseline, so installing ORBIT never labels the complete catalog as new. */
export function advanceXboxGamePassHistory(
  previous: XboxGamePassHistoryState,
  currentProductIds: Iterable<string>,
  now = Date.now()
): XboxGamePassHistoryUpdate {
  const activeProductIds = [...new Set(currentProductIds)].sort()
  const previouslyActive = new Set(previous.activeProductIds)
  const membershipDetectedAt = { ...previous.membershipDetectedAt }

  if (previous.initialized) {
    for (const productId of activeProductIds) {
      if (!previouslyActive.has(productId)) membershipDetectedAt[productId] = now
    }
  }

  for (const [productId, detectedAt] of Object.entries(membershipDetectedAt)) {
    if (
      !Number.isFinite(detectedAt) ||
      detectedAt <= 0 ||
      detectedAt > now ||
      now - detectedAt > XBOX_GAME_PASS_HISTORY_RETENTION_MS
    ) {
      delete membershipDetectedAt[productId]
    }
  }

  const currentDetectedAt = new Map<string, number>()
  for (const productId of activeProductIds) {
    const detectedAt = membershipDetectedAt[productId]
    if (detectedAt) currentDetectedAt.set(productId, detectedAt)
  }

  return {
    state: { initialized: true, activeProductIds, membershipDetectedAt },
    currentDetectedAt
  }
}

export function isNewXboxGamePassMembership(
  membershipDetectedAt: number | undefined,
  now = Date.now()
): boolean {
  return Boolean(
    membershipDetectedAt &&
      Number.isFinite(membershipDetectedAt) &&
      membershipDetectedAt <= now &&
      now - membershipDetectedAt <= XBOX_GAME_PASS_NEW_WINDOW_MS
  )
}
