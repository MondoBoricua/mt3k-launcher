import { app, utilityProcess } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type { SystemPowerAction } from '@shared/ipc'

const SLEEP_WORKER_ENTRY = 'systemPowerWorker.js'

function requestNativeWindowsSleep(): Promise<void> {
  const workerPath = join(app.getAppPath(), 'out', 'main', SLEEP_WORKER_ENTRY)
  if (!existsSync(workerPath)) {
    throw new Error('Native Windows sleep runtime is missing')
  }

  const worker = utilityProcess.fork(workerPath, [], {
    serviceName: 'ORBIT System Sleep',
    stdio: 'ignore'
  })

  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (error?: Error): void => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve()
    }

    worker.on('message', (message: unknown) => {
      if (!message || typeof message !== 'object') return
      const result = message as { type?: unknown; detail?: unknown }
      if (result.type === 'resumed') {
        worker.kill()
        settle()
      } else if (result.type === 'error') {
        const detail = typeof result.detail === 'string' ? result.detail.slice(0, 512) : ''
        worker.kill()
        settle(new Error(detail || 'Windows rejected the sleep request'))
      }
    })
    worker.once('error', () => settle(new Error('Native Windows sleep runtime failed')))
    worker.once('exit', () => {
      settle(new Error('Native Windows sleep runtime stopped before completing the request'))
    })
  })
}

function runShutdownCommand(action: Exclude<SystemPowerAction, 'sleep'>): Promise<void> {
  const args = action === 'restart' ? ['/r', '/t', '0'] : ['/s', '/t', '0']
  return new Promise((resolve, reject) => {
    const child = spawn('shutdown.exe', args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

export function runSystemPowerAction(action: SystemPowerAction): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('System power controls are currently available on Windows only')
  }
  return action === 'sleep' ? requestNativeWindowsSleep() : runShutdownCommand(action)
}
