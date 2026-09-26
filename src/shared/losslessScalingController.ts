import {
  LosslessScalingLaunchTracker,
  decideLosslessScalingStart,
  decideLosslessScalingStop,
  isLosslessScalingEligibleGame,
  resolveLosslessScalingForGame,
  withinBudget,
  type LosslessScalingEvent,
  type LosslessScalingGameMode,
  type LosslessScalingPreferences,
  type OwnedCompanionProcess
} from './losslessScalingPolicy'

/** Everything platform-specific is injected so the lifecycle can be tested without Windows. */
export interface LosslessScalingControllerDeps {
  platform: string
  preferences: () => LosslessScalingPreferences
  gameMode: (gameId: string) => LosslessScalingGameMode
  isRunning: () => Promise<boolean>
  /** Cached discovery of LosslessScaling.exe. */
  executablePath: () => Promise<string | undefined>
  invalidateDiscovery: () => void
  spawn: (executablePath: string, session: number) => Promise<OwnedCompanionProcess>
  /** Called once a copy is owned (e.g. to record its start time). */
  onOwned?: (process: OwnedCompanionProcess) => void
  close: (process: OwnedCompanionProcess) => Promise<void>
  notify: (event: LosslessScalingEvent) => void
  log: (level: 'info' | 'warn', message: string, error?: unknown) => void
  startupBudgetMs: number
  killGraceMs: number
}

export interface LaunchCompanionGame {
  id: string
  provider: string
  installed?: boolean
}

export function createLosslessScalingController(deps: LosslessScalingControllerDeps): {
  beforeLaunch: (game: LaunchCompanionGame) => Promise<number | undefined>
  sessionEnded: (session?: number) => Promise<void>
  hasPendingWork: () => boolean
  shutdown: (budgetMs: number) => Promise<void>
} {
  const tracker = new LosslessScalingLaunchTracker()
  const owned = new Map<number, OwnedCompanionProcess>()
  const pendingStartups = new Map<number, Promise<void>>()
  const closes = new Set<Promise<void>>()

  const notify = (event: LosslessScalingEvent): void => {
    try {
      deps.notify(event)
    } catch (error) {
      deps.log('warn', 'Could not show the notice', error)
    }
  }

  const trackClose = (work: Promise<void>): Promise<void> => {
    closes.add(work)
    void work.finally(() => closes.delete(work))
    return work
  }

  async function stopSession(session: number): Promise<void> {
    const process = owned.get(session)
    owned.delete(session)
    if (!process) return
    let closeOnExit = true
    try {
      closeOnExit = deps.preferences().closeOnExit
    } catch {
      // Keep the default: closing what we started.
    }
    if (decideLosslessScalingStop({ owned: true, exited: process.exited, closeOnExit }) !== 'close') return
    try {
      await deps.close(process)
      deps.log('info', `Closed the instance started for launch session ${session}.`)
    } catch (error) {
      deps.log('warn', 'Could not close Lossless Scaling', error)
    }
  }

  async function startCompanion(session: number, gameId: string): Promise<void> {
    await Promise.all([...closes])
    if (!tracker.isCurrent(session)) return
    const running = await deps.isRunning()
    if (!tracker.isCurrent(session)) return
    const executablePath = running ? undefined : await deps.executablePath()
    if (!tracker.isCurrent(session)) return
    const decision = decideLosslessScalingStart({ platform: deps.platform, wanted: true, executablePath, running })
    if (decision === 'already-running') {
      deps.log('info', "Already running; leaving the user's instance alone.")
      return
    }
    if (decision === 'missing') {
      deps.log('warn', 'LosslessScaling.exe was not found; continuing the launch without it.')
      deps.invalidateDiscovery()
      notify({ kind: 'missing' })
      return
    }
    if (decision !== 'start' || !executablePath) return
    let started: OwnedCompanionProcess
    try {
      started = await deps.spawn(executablePath, session)
    } catch (error) {
      deps.invalidateDiscovery()
      throw error
    }
    if (!tracker.isCurrent(session)) {
      // The launch ended or the budget expired while spawning: this copy is ours, close it now.
      deps.log('info', `Launch session ${session} is stale; closing the copy it started.`)
      if (started.kill()) await started.whenExited(deps.killGraceMs)
      return
    }
    owned.set(session, started)
    deps.log('info', `Started ${executablePath} (pid ${started.pid ?? 'unknown'}) for ${gameId}.`)
    deps.onOwned?.(started)
  }

  const controller = {
    /** Returns the launch session id, never rejects, never waits longer than the budget. */
    async beforeLaunch(game: LaunchCompanionGame): Promise<number | undefined> {
      try {
        // Eligibility first: opted-out games never wait for anything.
        if (deps.platform !== 'win32') return undefined
        const prefs = deps.preferences()
        if (!prefs.enabled || !isLosslessScalingEligibleGame(game)) return undefined
        if (!resolveLosslessScalingForGame(prefs, deps.gameMode(game.id), game)) return undefined
        const session = tracker.begin()
        const work = startCompanion(session, game.id).catch((error) => {
          deps.log('warn', 'Could not start Lossless Scaling; continuing the launch without it', error)
          notify({ kind: 'start-failed' })
        })
        pendingStartups.set(session, work)
        void work.finally(() => pendingStartups.delete(session))
        if (!(await withinBudget(work, deps.startupBudgetMs))) {
          deps.log('warn', `Startup took longer than ${deps.startupBudgetMs} ms; continuing the launch without waiting.`)
          // Invalidate the pending work: it can no longer spawn, and anything it spawned is closed.
          tracker.end(session)
          return undefined
        }
        return tracker.isCurrent(session) ? session : undefined
      } catch (error) {
        deps.log('warn', 'Companion startup failed; continuing the launch', error)
        return undefined
      }
    },

    /** With an id, ends only that launch; without one, ends the active launch and closes every owned copy. */
    sessionEnded(session?: number): Promise<void> {
      const ended = tracker.end(session)
      const targets = session === undefined ? [...owned.keys()] : ended === undefined ? [] : [ended]
      return trackClose(Promise.all(targets.map((id) => stopSession(id))).then(() => undefined))
    },

    hasPendingWork(): boolean {
      return owned.size > 0 || closes.size > 0 || pendingStartups.size > 0
    },

    /** Normal quit: invalidate pending startups and close owned copies, bounded by `budgetMs`. */
    async shutdown(budgetMs: number): Promise<void> {
      tracker.end()
      const work = Promise.all([...pendingStartups.values()])
        .then(() => controller.sessionEnded())
        .then(() => Promise.all([...closes]))
      if (!(await withinBudget(work, budgetMs))) {
        deps.log('warn', `Cleanup did not finish within ${budgetMs} ms at quit.`)
      }
    }
  }
  return controller
}
