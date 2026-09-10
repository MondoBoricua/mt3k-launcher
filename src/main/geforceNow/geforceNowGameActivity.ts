import { open } from 'node:fs/promises'
import { join, win32 } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { GeForceNowLibraryMatch, LibraryGame } from '@shared/ipc'
import type { DetectedGamePresence, GamePresenceProcess } from '../gamePresence'

export interface GeForceNowStreamState {
  startedAt?: number
  endedAt?: number
}

/** Read only lifecycle markers; never retain or publish NVIDIA account/log payloads. */
export class GeForceNowStreamLogParser {
  private headerTime: number | undefined
  private logger = ''
  private remainder = ''
  private state: GeForceNowStreamState = {}

  push(content: string): GeForceNowStreamState {
    const lines = (this.remainder + content).split(/\r?\n/)
    this.remainder = (lines.pop() ?? '').slice(-4096)
    for (const line of lines) {
      const header = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\s+(?:INFO|WARN|ERROR|DEBUG)\s+(\S+)\s/.exec(line)
      if (header) {
        const timestamp = Date.parse(header[1].replace(' ', 'T'))
        this.headerTime = Number.isFinite(timestamp) ? timestamp : undefined
        this.logger = header[2]
      }
      if (!this.headerTime) continue
      if (this.logger === 'gfn/loadingUi' &&
          line.includes('Successfully started streaming, exiting loading state')) {
        if (!this.state.startedAt || this.state.endedAt) {
          this.state = { startedAt: this.headerTime }
        }
      } else if (this.logger === 'streamingService' &&
          /"event"\s*:\s*"(?:STREAMING_TERMINATED|SESSION_STOPPED)"/.test(line)) {
        // Repeated notifications all refer to the same stream boundary.
        this.state.endedAt ??= this.headerTime
      }
    }
    return { ...this.state }
  }
}

const MAX_LOG_READ_BYTES = 512 * 1024

/** Bounded incremental tail. Rotation, truncation and partial writes are supported. */
export class GeForceNowGameActivityReader {
  private parser = new GeForceNowStreamLogParser()
  private decoder = new StringDecoder('utf8')
  private identity: number | undefined
  private offset = 0
  private mtime = 0
  private state: GeForceNowStreamState = {}
  private readonly logPath: string | undefined

  constructor(directory = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'NVIDIA Corporation', 'GeForceNOW') : undefined) {
    this.logPath = directory ? join(directory, 'console.log') : undefined
  }

  async getStreamState(): Promise<GeForceNowStreamState> {
    if (!this.logPath) return {}
    let file: Awaited<ReturnType<typeof open>> | undefined
    try {
      file = await open(this.logPath, 'r')
      const details = await file.stat()
      if (this.identity !== details.birthtimeMs || details.size < this.offset ||
          (details.size === this.offset && details.mtimeMs !== this.mtime) ||
          details.size - this.offset > MAX_LOG_READ_BYTES) {
        this.parser = new GeForceNowStreamLogParser()
        this.decoder = new StringDecoder('utf8')
        this.state = {}
        this.offset = Math.max(0, details.size - MAX_LOG_READ_BYTES)
      }
      this.identity = details.birthtimeMs
      const length = Math.min(MAX_LOG_READ_BYTES, details.size - this.offset)
      if (length > 0) {
        const buffer = Buffer.allocUnsafe(length)
        const { bytesRead } = await file.read(buffer, 0, length, this.offset)
        this.offset += bytesRead
        this.state = this.parser.push(this.decoder.write(buffer.subarray(0, bytesRead)))
      }
      this.mtime = details.mtimeMs
    } catch {
      // A temporary lock is not a stream end. The live NVIDIA window is still required.
    } finally {
      await file?.close().catch(() => undefined)
    }
    return { ...this.state }
  }
}

function normalizedTitle(value: string): string {
  return value.normalize('NFKC').replace(/[™®©]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export function isGeForceNowGameWindow(process: GamePresenceProcess): boolean {
  // GeForceNOWStreamer.exe hands off to CEF/GeForceNOW.exe in current clients.
  // Both may own the game window. A matching title AND an active stream marker
  // are still required below; the launcher/queue alone is never a session.
  const name = process.Name?.toLowerCase()
  return (name === 'geforcenowstreamer.exe' || name === 'geforcenow.exe') &&
    Boolean(process.ProcessId && process.MainWindowHandle && process.MainWindowTitle) &&
    !/(?:^|\s)--type=\S+/i.test(process.CommandLine ?? '') &&
    (!process.ExecutablePath ||
      win32.basename(process.ExecutablePath).toLowerCase() === name)
}

export function detectGeForceNowGamePresences(
  processes: readonly GamePresenceProcess[],
  games: readonly LibraryGame[],
  matches: readonly GeForceNowLibraryMatch[],
  stream: GeForceNowStreamState,
  preferredGameId?: string,
  now = Date.now()
): DetectedGamePresence[] {
  if (!stream.startedAt || stream.endedAt || stream.startedAt > now + 2000) return []
  const gamesById = new Map(games.map((game) => [game.id, game]))
  const result: DetectedGamePresence[] = []
  for (const process of processes) {
    if (!isGeForceNowGameWindow(process) || !process.StartedAt ||
        stream.startedAt < process.StartedAt - 2000) continue
    const title = normalizedTitle((process.MainWindowTitle ?? '')
      .replace(/\s+(?:bei|on|en)\s+GeForce\s*NOW\s*$/i, '')
      .replace(/\s*[-–—|]\s*(?:NVIDIA\s+)?GeForce\s*NOW\s*$/i, '')
      .replace(/^(?:NVIDIA\s+)?GeForce\s*NOW\s*[-–—|]\s*/i, ''))
    if (!title || title === 'geforce now') continue
    const variantId = /[?&#]cmsId=(\d+)(?=[&#"\s]|$)/i.exec(process.CommandLine ?? '')?.[1]
    const candidates = matches.filter((match) => {
      const game = gamesById.get(match.gameId)
      return game && (!variantId || variantId === match.variantId) &&
        [match.geforceNowTitle, game.name].some((name) => normalizedTitle(name) === title)
    })
    const selected = candidates.find((match) => match.gameId === preferredGameId) ??
      (candidates.length === 1 ? candidates[0] : undefined)
    if (!selected) continue // Never guess between the Steam and Epic copies of a game.
    result.push({
      game: gamesById.get(selected.gameId)!,
      processIds: [process.ProcessId!],
      startedAt: stream.startedAt,
      trackingMethod: 'geforce-now-window',
      trackingFallbackIndex: 0
    })
  }
  return result
}
