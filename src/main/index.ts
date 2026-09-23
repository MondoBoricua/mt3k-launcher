import './legacyUserDataPath'
import { app, shell, protocol, net, BrowserWindow } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import {
  ORBIT_AGENT_ARGUMENT,
  ORBIT_AGENT_SHUTDOWN_ARGUMENT,
  hasOrbitProcessArgument,
  isOrbitAgentSnapshot,
  orbitServicePipeNames,
  requestOrbitPipe,
  type OrbitAgentCommand
} from './orbitServiceProtocol'
import {
  isProcessAlive,
  terminateWindowsProcessIfIdentityMatches
} from './windowsProcess'
import {
  backgroundAgentSuspensionPath,
  clearBackgroundAgentSuspension,
  readBackgroundAgentSuspension,
  suspendBackgroundAgent
} from './orbitBackgroundServiceSuspension'
import { scheduleBackgroundAgentRecovery } from './orbitBackgroundServiceRecovery'
import { safeExternalHttpsUrl } from '@shared/externalUrl'
import { YOUTUBE_TRAILER_APP_REFERRER } from '@shared/gameTrailer'
import {
  getOrbitBackgroundServiceLoginItemInstallation
} from './orbitBackgroundServiceLoginItem'

const isBackgroundAgent = hasOrbitProcessArgument(process.argv, ORBIT_AGENT_ARGUMENT)
const isBackgroundAgentShutdown = hasOrbitProcessArgument(
  process.argv,
  ORBIT_AGENT_SHUTDOWN_ARGUMENT
)
const isHeadlessProcess = isBackgroundAgentShutdown
// Old login entries now open the integrated app instead of spawning another agent.
const startInBackground = isBackgroundAgent || process.argv.includes('--orbit-background')
const MAINTENANCE_SHUTDOWN_TIMEOUT_MS = 8_000
const MAINTENANCE_STOP_CONFIRMATIONS = 3

// ORBIT has a bounded set of singleton services with independent shutdown hooks.
// Keep EventEmitter leak detection enabled above that known baseline.
app.setMaxListeners(20)

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function normalizedWindowsPath(value: string): string {
  return value.trim().replace(/^"|"$/g, '').toLowerCase()
}

async function shutdownBackgroundAgentForMaintenance(): Promise<boolean> {
  const userDataPath = app.getPath('userData')
  const developmentAppPath = app.isPackaged ? undefined : app.getAppPath()
  const installation = getOrbitBackgroundServiceLoginItemInstallation(
    app,
    process.execPath,
    developmentAppPath
  )
  const existingSuspension = await readBackgroundAgentSuspension(userDataPath)
  const suspension = await suspendBackgroundAgent(userDataPath, {
    transactionId: existingSuspension?.transactionId,
    recoverAgent: installation.installation === 'installed'
  })
  if (
    suspension.recoverAgent &&
    !(await scheduleBackgroundAgentRecovery({
      markerPath: backgroundAgentSuspensionPath(userDataPath),
      executablePath: process.execPath,
      developmentAppPath,
      transactionId: suspension.transactionId
    }))
  ) {
    await clearBackgroundAgentSuspension(userDataPath).catch(() => undefined)
    return false
  }
  const pipeName = orbitServicePipeNames(userDataPath).agent
  let observedProcessId: number | undefined
  let observedProcessStartedAt: number | undefined

  const recordAgentIdentity = (candidate: unknown): void => {
    if (
      isOrbitAgentSnapshot(candidate) &&
      normalizedWindowsPath(candidate.executablePath) === normalizedWindowsPath(process.execPath)
    ) {
      observedProcessId = candidate.processId
      observedProcessStartedAt = candidate.startedAt
    }
  }

  const observe = async (): Promise<boolean> => {
    try {
      const candidate = await requestOrbitPipe<unknown>(
        pipeName,
        { command: 'status' satisfies OrbitAgentCommand },
        750
      )
      recordAgentIdentity(candidate)
      return true
    } catch {
      return false
    }
  }

  await observe()
  try {
    const shutdownSnapshot = await requestOrbitPipe<unknown>(
      pipeName,
      { command: 'shutdown' satisfies OrbitAgentCommand },
      4_000
    )
    recordAgentIdentity(shutdownSnapshot)
  } catch {
    // A stopped agent is the normal idempotent case during update/uninstall.
  }

  const observationStartedAt = Date.now()
  const unknownProcessGraceMs =
    installation.installation === 'installed' ? MAINTENANCE_SHUTDOWN_TIMEOUT_MS : 500
  const deadline = observationStartedAt + MAINTENANCE_SHUTDOWN_TIMEOUT_MS
  let unreachableConfirmations = 0
  while (Date.now() < deadline) {
    if (await observe()) {
      unreachableConfirmations = 0
    } else {
      unreachableConfirmations += 1
      if (
        unreachableConfirmations >= MAINTENANCE_STOP_CONFIRMATIONS &&
        ((observedProcessId !== undefined && !isProcessAlive(observedProcessId)) ||
          (observedProcessId === undefined &&
            Date.now() - observationStartedAt >= unknownProcessGraceMs))
      ) {
        return true
      }
    }
    await delay(100)
  }

  if (
    observedProcessId !== undefined &&
    observedProcessStartedAt !== undefined &&
    isProcessAlive(observedProcessId)
  ) {
    await terminateWindowsProcessIfIdentityMatches(observedProcessId, {
      executablePath: process.execPath,
      requiredArgument: ORBIT_AGENT_ARGUMENT,
      startedAt: observedProcessStartedAt
    })
  }

  unreachableConfirmations = 0
  const forceDeadline = Date.now() + 1_500
  while (Date.now() < forceDeadline) {
    if (await observe()) {
      unreachableConfirmations = 0
    } else {
      unreachableConfirmations += 1
      if (
        unreachableConfirmations >= MAINTENANCE_STOP_CONFIRMATIONS &&
        (observedProcessId === undefined || !isProcessAlive(observedProcessId))
      ) {
        return true
      }
    }
    await delay(100)
  }
  // The uninstall/update transaction did not start safely. Releasing the marker
  // wakes the detached recovery host so the service is restored immediately.
  await clearBackgroundAgentSuspension(userDataPath)
  return false
}

if (isHeadlessProcess) {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-software-rasterizer')
} else {
  // ORBIT is a controller-first media launcher. Title music begins from spatial
  // navigation, which does not count as a Chromium pointer activation.
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
  protocol.registerSchemesAsPrivileged([
    { scheme: 'orbit-image', privileges: { supportFetchAPI: true, bypassCSP: true, corsEnabled: true } },
    {
      scheme: 'orbit-media',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
    }
  ])
}

function createWindow(registerIpcHandlers: (window: BrowserWindow) => void): BrowserWindow {
  const mainWindow = new BrowserWindow({
    show: false,
    frame: false,
    fullscreen: true,
    autoHideMenuBar: true,
    backgroundColor: '#05070c',
    title: 'MT3K Launcher',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (!startInBackground) mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const safeUrl = safeExternalHttpsUrl(url)
    if (safeUrl) void shell.openExternal(safeUrl)
    return { action: 'deny' }
  })

  // Local desktop documents do not emit an HTTPS Referer by themselves. YouTube
  // requires an app identity for embedded playback; scope it to the one trusted
  // iframe route and use ORBIT's registered Windows/application identifier.
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ['https://www.youtube-nocookie.com/embed/*'] },
    ({ requestHeaders }, callback) => {
      callback({
        requestHeaders: {
          ...requestHeaders,
          Referer: YOUTUBE_TRAILER_APP_REFERRER
        }
      })
    }
  )

  // F11 toggles fullscreen for dev convenience — Escape stays reserved for in-app "back" navigation.
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen())
    }
  })

  registerIpcHandlers(mainWindow)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

async function startOrbitUi(): Promise<void> {
  const [
    { registerIpcHandlers },
    { getCacheDir },
    { startOrbitAppCommandServer },
    { revealOrbitWindow },
    { startupVideoService },
    { homeWallpaperService },
    { launcherMusicService },
    { customUiAudioService },
    { handleTitleMusicMediaRequest },
    { SteamControllerInputService }
  ] =
    await Promise.all([
      import('./ipcHandlers'),
      import('./imageCache'),
      import('./orbitAppCommands'),
      import('./orbitWindow'),
      import('./startupVideoService'),
      import('./homeWallpaperService'),
      import('./launcherMusicService'),
      import('./customUiAudioService'),
      import('./titleMusic/titleMusicProtocol'),
      import('./steamControllerInput')
    ])

  // The AppX package already supplies the shell identity used by Xbox Mode.
  // Overriding it would detach ORBIT from its registered Gaming Home entry.
  if (!process.windowsStore) {
    electronApp.setAppUserModelId('com.orbit.launcher')
  }

  protocol.handle('orbit-image', async (request) => {
    if (request.url.startsWith('orbit-image://captures/')) {
      const { resolveCaptureImage } = await import('./captures/captureLibrary')
      const capture = await resolveCaptureImage(request.url)
      return capture ? net.fetch(pathToFileURL(capture).toString()) : new Response(null, { status: 404 })
    }
    const fileName = decodeURIComponent(request.url.replace('orbit-image://', ''))
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      return new Response(null, { status: 400 })
    }
    return net.fetch(pathToFileURL(join(getCacheDir(), fileName)).toString())
  })

  protocol.handle('orbit-media', async (request) => {
    const titleMusicResponse = handleTitleMusicMediaRequest(request)
    if (titleMusicResponse) return titleMusicResponse
    const filePath =
      startupVideoService.resolveRequestPath(request.url) ??
      homeWallpaperService.resolveRequestPath(request.url) ??
      await launcherMusicService.resolveRequestPath(request.url) ??
      await customUiAudioService.resolveRequestPath(request.url)
    if (!filePath) return new Response(null, { status: 404 })
    return net.fetch(pathToFileURL(filePath).toString(), { headers: request.headers })
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Load the persisted local library and finish recovery before launch IPC is available.
  const { libraryService } = await import('./library/libraryService')
  libraryService.hydrateFromDisk()
  const { recoverInterruptedRestores } = await import('./saveRestoreService')
  await recoverInterruptedRestores()

  const mainWindow = createWindow(registerIpcHandlers)
  const steamControllerInput = new SteamControllerInputService(mainWindow)
  steamControllerInput.start()
  mainWindow.once('closed', () => steamControllerInput.dispose())
  const closeCommandServer = await startOrbitAppCommandServer(mainWindow)
  app.once('before-quit', () => void closeCommandServer())

  app.on('second-instance', (_event, argv) => {
    if (argv.includes('--orbit-background') || hasOrbitProcessArgument(argv, ORBIT_AGENT_ARGUMENT)) return
    const window = BrowserWindow.getAllWindows()[0]
    if (window) void revealOrbitWindow(window)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(registerIpcHandlers)
  })
}

if (isBackgroundAgentShutdown) {
  void app
    .whenReady()
    .then(async () => {
      if (await shutdownBackgroundAgentForMaintenance()) app.quit()
      else app.exit(2)
    })
    .catch(() => app.exit(2))
} else {
  const hasSingleInstanceLock = app.requestSingleInstanceLock()
  if (!hasSingleInstanceLock) {
    app.quit()
  } else {
    void app
      .whenReady()
      .then(startOrbitUi)
      .catch((error) => {
        console.error('[orbit] Failed to start:', error)
        app.quit()
      })
  }

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
