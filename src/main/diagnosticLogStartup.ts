import { app } from 'electron'
import { join } from 'node:path'
import { release } from 'node:os'
import { formatWithOptions } from 'node:util'
import { createDiagnosticWriter } from './diagnosticLog'
import { getDisplayVersion } from './releaseManifest'

export const diagnosticLogDirectory = join(app.getPath('userData'), 'logs')
export const diagnosticLog = createDiagnosticWriter(diagnosticLogDirectory)

function describe(...values: unknown[]): string {
  try {
    return formatWithOptions({ customInspect: false, getters: false }, ...values)
  } catch {
    return '[unformattable diagnostic]'
  }
}

for (const level of ['warn', 'error'] as const) {
  const original = console[level].bind(console)
  console[level] = (...values: unknown[]): void => {
    void diagnosticLog.write(level, describe(...values))
    original(...values)
  }
}

// Electron 43 skips its default dialog when an additional uncaughtException
// listener exists. Wrap its sole existing listener instead of increasing the
// count, preserving its behavior and also catching Electron's explicit emits
// for ESM startup failures. If another host changed that setup, observe only.
const recordException = (error: Error, origin: string): void => {
  void diagnosticLog.write('error', `[uncaughtException] ${origin ?? 'uncaughtException'} ${describe(error)}`)
}
const exceptionHandlers = process.rawListeners('uncaughtException')
if (exceptionHandlers.length === 1) {
  const original = exceptionHandlers[0] as NodeJS.UncaughtExceptionListener
  process.removeListener('uncaughtException', original)
  process.on('uncaughtException', function (error, origin) {
    recordException(error, origin)
    original.call(process, error, origin)
  })
} else {
  process.on('uncaughtExceptionMonitor', recordException)
}
process.on('unhandledRejection', (reason) => {
  void diagnosticLog.write('error', `[unhandledRejection] ${describe(reason)}`)
})
app.on('render-process-gone', (_event, contents, details) => {
  void diagnosticLog.write('error', `[render-process-gone] webContents=${contents.id} ${describe(details)}`)
})
// Includes GPU processes; gpu-process-crashed was removed from Electron's API.
app.on('child-process-gone', (_event, details) => {
  void diagnosticLog.write('error', `[child-process-gone] ${describe(details)}`)
})
void diagnosticLog.write('info', `[startup] MT3K Launcher ${getDisplayVersion()} Electron=${process.versions.electron} Chrome=${process.versions.chrome} windowsStore=${process.windowsStore === true} platform=${process.platform} osBuild=${release()}`)

void app.whenReady().then(async () => {
  // Load settings only after the early handlers are installed.
  try {
    const { settingsStore } = await import('./settingsStore')
    const toggles = ['launchProfilesEnabled', 'retroPauseMenuEnabled', 'attractModeEnabled',
      'captureShelfEnabled', 'guestModeEnabled'] as const
    await diagnosticLog.write('info', `[startup] features ${toggles.map(key => `${key}=${settingsStore.get(key) === true}`).join(' ')}`)
  } catch (error) {
    await diagnosticLog.write('warn', `[startup] settings unavailable ${describe(error)}`)
  }
  try {
    await diagnosticLog.write('info', `[startup] GPU ${describe(await app.getGPUInfo('basic'))}`)
  } catch (error) {
    await diagnosticLog.write('warn', `[startup] GPU unavailable ${describe(error)}`)
  }
}).catch(() => undefined)
