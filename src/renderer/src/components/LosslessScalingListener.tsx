import { useEffect } from 'react'
import type { LosslessScalingEvent } from '@shared/losslessScalingPolicy'
import { notify } from '@renderer/state/notificationStore'

const MESSAGES = {
  missing: 'losslessScaling.missingToast',
  'start-failed': 'losslessScaling.startFailedToast'
} as const

/** Mounted only while Lossless Scaling is enabled: one toast when it could not be started. */
export function LosslessScalingListener(): null {
  useEffect(() => window.api.losslessScaling.onEvent((event: LosslessScalingEvent) => {
    notify({ tone: 'error', titleKey: 'losslessScaling.title', messageKey: MESSAGES[event.kind] })
  }), [])
  return null
}
