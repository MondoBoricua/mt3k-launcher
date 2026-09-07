import Store from 'electron-store'
import {
  advanceXboxGamePassHistory,
  emptyXboxGamePassHistory,
  type XboxGamePassHistoryState
} from '@shared/xboxGamePassHistory'

const PRODUCT_ID_PATTERN = /^[A-Z0-9]{12}$/u
const MAX_HISTORY_PRODUCTS = 10_000

const historyStore = new Store<{ history?: XboxGamePassHistoryState }>({
  name: 'orbit-xbox-game-pass-history-v1',
  defaults: {}
})

function sanitizedHistory(value: unknown): XboxGamePassHistoryState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return emptyXboxGamePassHistory()
  }
  const candidate = value as Partial<XboxGamePassHistoryState>
  const activeProductIds = Array.isArray(candidate.activeProductIds)
    ? [
        ...new Set(
          candidate.activeProductIds
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim().toUpperCase())
            .filter((item) => PRODUCT_ID_PATTERN.test(item))
        )
      ].slice(0, MAX_HISTORY_PRODUCTS)
    : []
  const membershipDetectedAt: Record<string, number> = {}
  if (
    candidate.membershipDetectedAt &&
    typeof candidate.membershipDetectedAt === 'object' &&
    !Array.isArray(candidate.membershipDetectedAt)
  ) {
    for (const [rawProductId, rawDetectedAt] of Object.entries(
      candidate.membershipDetectedAt
    ).slice(0, MAX_HISTORY_PRODUCTS)) {
      const productId = rawProductId.trim().toUpperCase()
      if (
        PRODUCT_ID_PATTERN.test(productId) &&
        typeof rawDetectedAt === 'number' &&
        Number.isFinite(rawDetectedAt)
      ) {
        membershipDetectedAt[productId] = rawDetectedAt
      }
    }
  }
  return {
    initialized: candidate.initialized === true,
    activeProductIds,
    membershipDetectedAt
  }
}

class XboxGamePassHistory {
  observe(productIds: Iterable<string>, now = Date.now()): Map<string, number> {
    const sanitizedProductIds = [
      ...new Set(
        [...productIds]
          .map((productId) => productId.trim().toUpperCase())
          .filter((productId) => PRODUCT_ID_PATTERN.test(productId))
      )
    ].slice(0, MAX_HISTORY_PRODUCTS)
    if (sanitizedProductIds.length === 0) return new Map()

    const update = advanceXboxGamePassHistory(
      sanitizedHistory(historyStore.get('history')),
      sanitizedProductIds,
      now
    )
    try {
      historyStore.set('history', update.state)
    } catch {
      // A read-only profile must not block the live Xbox catalog.
    }
    return update.currentDetectedAt
  }
}

export const xboxGamePassHistory = new XboxGamePassHistory()
