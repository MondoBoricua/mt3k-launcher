import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { getSteamInstallPath } from './steamInstall'
import { processIdStillExists } from '../processLiveness'

export interface SteamActiveGame {
  appId: number
  processIds: number[]
  startedAt?: number
}

interface MutableSteamActivity {
  processIds: Set<number>
  startedAt?: number
}

const ADD_PROCESS_PATTERN =
  /^\[([^\]]+)]\s+AppID\s+(\d+)\s+adding PID\s+(\d+)\s+as a tracked process/i
const REMOVE_PROCESS_PATTERN =
  /^\[[^\]]+]\s+AppID\s+(\d+)\s+no longer tracking PID\s+(\d+)/i
const REMOVE_APP_PATTERN = /^\[[^\]]+]\s+Remove\s+(\d+)\s+from running list/i
const CLIENT_RESTART_PATTERN = /^\[[^\]]+]\s+Client version:/i

function steamLogTimestamp(value: string): number | undefined {
  const parsed = Date.parse(value.replace(' ', 'T'))
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Reconstructs Steam's current app-to-process state from its native log. */
export function parseSteamActiveGames(content: string): SteamActiveGame[] {
  const activeByAppId = new Map<string, MutableSteamActivity>()
  for (const line of content.split(/\r?\n/)) {
    // Steam can terminate without writing one removal per tracked PID. Its next
    // client session is therefore an authoritative boundary for stale entries.
    if (CLIENT_RESTART_PATTERN.test(line)) {
      activeByAppId.clear()
      continue
    }

    const added = ADD_PROCESS_PATTERN.exec(line)
    if (added) {
      const [, timestamp, appId, pidValue] = added
      const pid = Number.parseInt(pidValue, 10)
      if (!Number.isInteger(pid) || pid <= 0) continue
      const activity = activeByAppId.get(appId) ?? { processIds: new Set<number>() }
      activity.processIds.add(pid)
      activity.startedAt ??= steamLogTimestamp(timestamp)
      activeByAppId.set(appId, activity)
      continue
    }

    const removed = REMOVE_PROCESS_PATTERN.exec(line)
    if (removed) {
      const [, appId, pidValue] = removed
      const activity = activeByAppId.get(appId)
      if (!activity) continue
      activity.processIds.delete(Number.parseInt(pidValue, 10))
      if (activity.processIds.size === 0) activeByAppId.delete(appId)
      continue
    }

    // This provider-owned line closes the app even if an individual PID removal
    // was lost during shutdown or log flushing.
    const removedApp = REMOVE_APP_PATTERN.exec(line)
    if (removedApp) activeByAppId.delete(removedApp[1])
  }

  return [...activeByAppId.entries()]
    .map(([appId, activity]) => ({
      appId: Number.parseInt(appId, 10),
      processIds: [...activity.processIds],
      startedAt: activity.startedAt
    }))
    .filter((activity) => Number.isSafeInteger(activity.appId) && activity.appId > 0)
}

/** Cached reader for Steam's provider-owned game-process registry. */
export class SteamGameActivityReader {
  private readonly logPath: string | undefined
  private lastIdentity = ''
  private cached: SteamActiveGame[] = []

  constructor(steamPath = getSteamInstallPath()) {
    this.logPath = steamPath ? join(steamPath, 'logs', 'gameprocess_log.txt') : undefined
  }

  private livingCachedActivities(): SteamActiveGame[] {
    return this.cached
      .map((activity) => ({
        ...activity,
        processIds: activity.processIds.filter(processIdStillExists)
      }))
      .filter((activity) => activity.processIds.length > 0)
  }

  async getActiveGames(): Promise<SteamActiveGame[]> {
    if (!this.logPath) return []
    try {
      const details = await stat(this.logPath)
      const identity = `${details.size}:${details.mtimeMs}`
      if (identity !== this.lastIdentity) {
        this.cached = parseSteamActiveGames(await readFile(this.logPath, 'utf8'))
        this.lastIdentity = identity
      }
      return this.livingCachedActivities()
    } catch {
      // A transient provider-file lock must not manufacture a game exit. The
      // already observed PIDs remain safe because the OS validates each one.
      return this.livingCachedActivities()
    }
  }

  async getActiveProcessIds(appId: number): Promise<Set<number>> {
    const activity = (await this.getActiveGames()).find((entry) => entry.appId === appId)
    return new Set(activity?.processIds ?? [])
  }
}
