import { HowLongToBeatService, SearchModifier } from 'howlongtobeat-ts'
import type { GameCompletionTimes, LibraryGame } from '@shared/ipc'
import { fetchWithElectronNet } from './networkFetch'
import {
  completionTimesCacheMatches,
  completionTimesFallbackQuery,
  completionTimesQuery
} from '@shared/completionTimesQuery'

const POSITIVE_TTL_MS = 120 * 24 * 60 * 60 * 1000
// HowLongToBeat answers an empty list when it throttles a burst of searches, which
// looks exactly like "no such game". Keep negative answers short-lived.
const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000

const hltb = new HowLongToBeatService({
  minSimilarity: 0.72,
  timeout: 15_000,
  retries: 1,
  fetch: fetchWithElectronNet
})

function isFresh(value: GameCompletionTimes): boolean {
  const ttl = value.state === 'available' ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS
  return Date.now() - value.fetchedAt < ttl
}

function secondsToMinutes(seconds: number | undefined): number | undefined {
  if (!seconds || seconds <= 0) return undefined
  return Math.max(1, Math.round(seconds / 60))
}

function hasEstimate(value: GameCompletionTimes): boolean {
  return Boolean(
    value.mainStoryMinutes ||
      value.mainExtraMinutes ||
      value.completionistMinutes ||
      value.allStylesMinutes
  )
}

/**
 * On-demand completion-time enrichment. Results live inside ORBIT's unified
 * game record; this service only de-duplicates concurrent lookups and never
 * runs as a library-wide scraping job.
 */
export class CompletionTimesService {
  private inFlight = new Map<string, Promise<GameCompletionTimes | null>>()

  resolve(game: LibraryGame, force = false): Promise<GameCompletionTimes | null> {
    const cached = game.metadata.completionTimes
    if (!force && cached && isFresh(cached) && completionTimesCacheMatches(cached, game.name)) {
      return Promise.resolve(cached)
    }

    const current = this.inFlight.get(game.id)
    if (current) return current

    const request = this.fetch(game)
      .catch(() => cached ?? null)
      .finally(() => this.inFlight.delete(game.id))
    this.inFlight.set(game.id, request)
    return request
  }

  private async fetch(game: LibraryGame): Promise<GameCompletionTimes | null> {
    const query = completionTimesQuery(game.name)
    let result = await hltb.searchOne(query, { modifier: SearchModifier.HIDE_DLC })
    if (!result.success) return game.metadata.completionTimes ?? null
    if (!result.data) {
      const fallback = completionTimesFallbackQuery(game.name)
      if (fallback) {
        const retry = await hltb.searchOne(fallback, { modifier: SearchModifier.HIDE_DLC })
        if (retry.success && retry.data) result = retry
      }
    }

    const fetchedAt = Date.now()
    if (!result.data) {
      return { state: 'unavailable', provider: 'howlongtobeat', query, fetchedAt }
    }

    const entry = result.data
    const completionTimes: GameCompletionTimes = {
      state: 'available',
      provider: 'howlongtobeat',
      mainStoryMinutes: secondsToMinutes(entry.mainTime),
      mainExtraMinutes: secondsToMinutes(entry.mainExtraTime),
      completionistMinutes: secondsToMinutes(entry.completionistTime),
      allStylesMinutes: secondsToMinutes(entry.allStylesTime),
      sourceGameId: entry.id,
      sourceTitle: entry.name,
      sourceUrl: `https://howlongtobeat.com/game/${entry.id}`,
      confidence: entry.similarity,
      query,
      fetchedAt
    }

    return hasEstimate(completionTimes)
      ? completionTimes
      : { state: 'unavailable', provider: 'howlongtobeat', query, fetchedAt }
  }
}

export const completionTimesService = new CompletionTimesService()
