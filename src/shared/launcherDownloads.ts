import type {
  LauncherDownloadActivity,
  LauncherDownloadControlAction,
  LauncherDownloadSnapshot
} from './ipc'

const PHASE_PRIORITY: Record<LauncherDownloadActivity['phase'], number> = {
  downloading: 0,
  updating: 1,
  installing: 2,
  verifying: 3,
  paused: 4,
  error: 5,
  completed: 6
}

export function clampLauncherProgress(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value)
    ? undefined
    : Math.min(1, Math.max(0, value))
}

/** Converts provider throughput (bytes/s) to the decimal Mbit/s used by networks. */
export function bytesPerSecondToMegabits(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) || value < 0
    ? undefined
    : (value * 8) / 1_000_000
}

export function withDerivedLauncherTransferMetrics(
  current: LauncherDownloadActivity,
  previous: LauncherDownloadActivity | undefined
): LauncherDownloadActivity {
  if (
    current.phase === 'paused' ||
    current.phase === 'completed' ||
    current.phase === 'error'
  ) {
    return { ...current, bytesPerSecond: undefined, etaSeconds: undefined }
  }

  let bytesPerSecond = current.bytesPerSecond
  if (
    bytesPerSecond === undefined &&
    previous?.bytesDownloaded !== undefined &&
    current.bytesDownloaded !== undefined
  ) {
    const elapsedMs = current.updatedAt - previous.updatedAt
    const downloadedDelta = current.bytesDownloaded - previous.bytesDownloaded
    if (elapsedMs >= 250 && elapsedMs <= 30_000 && downloadedDelta > 0) {
      const instantaneous = downloadedDelta / (elapsedMs / 1_000)
      bytesPerSecond =
        previous.bytesPerSecond !== undefined && previous.bytesPerSecond >= 0
          ? previous.bytesPerSecond * 0.65 + instantaneous * 0.35
          : instantaneous
    }
  }

  const etaSeconds =
    bytesPerSecond !== undefined &&
    bytesPerSecond > 0 &&
    current.bytesDownloaded !== undefined &&
    current.bytesTotal !== undefined &&
    current.bytesTotal >= current.bytesDownloaded
      ? Math.round((current.bytesTotal - current.bytesDownloaded) / bytesPerSecond)
      : current.etaSeconds

  return { ...current, bytesPerSecond, etaSeconds }
}

export function orderedLauncherDownloads(
  activities: readonly LauncherDownloadActivity[]
): LauncherDownloadActivity[] {
  return [...activities].sort(
    (left, right) =>
      PHASE_PRIORITY[left.phase] - PHASE_PRIORITY[right.phase] ||
      right.updatedAt - left.updatedAt ||
      left.id.localeCompare(right.id)
  )
}

export function shouldApplyLauncherDownloadSnapshot(
  current: LauncherDownloadSnapshot,
  incoming: LauncherDownloadSnapshot
): boolean {
  if (!Number.isSafeInteger(incoming.revision)) return false
  if (incoming.revision > current.revision) return true
  return incoming.revision === current.revision && incoming.checkedAt > current.checkedAt
}

export function launcherDownloadControlActions(
  activity: LauncherDownloadActivity
): LauncherDownloadControlAction[] {
  if (activity.phase === 'completed') return []

  const actions: LauncherDownloadControlAction[] = []
  if (activity.provider === 'xbox' && /^[A-Z0-9]{12}$/iu.test(activity.providerGameId)) {
    if (activity.phase === 'paused') actions.push('resume')
    else if (activity.phase !== 'error') actions.push('pause')
    if (activity.phase !== 'error') actions.push('cancel')
  } else if (activity.provider === 'steam' && activity.phase !== 'error') {
    actions.push('cancel')
  }
  actions.push('open-provider')
  return actions
}
