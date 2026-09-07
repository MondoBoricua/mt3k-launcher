import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, shell, type BrowserWindow } from 'electron'
import type { ApplicationLaunchResult } from '@shared/ipc'
import { GEFORCE_NOW_WEB_URL } from '@shared/geforceNow'
import { orbitPlusService } from '../orbitPlus/orbitPlusService'
import { activateExternalProcessWindow } from '../externalWindowActivation'
import { MediaControllerBridge } from '../mediaControllerBridge'
import { revealOrbitWindow } from '../orbitWindow'

interface GeForceNowBrowser {
  executable: string
  name: 'Microsoft Edge' | 'Google Chrome'
}

function parsedHttpsUrl(value: string): URL | null {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' ? parsed : null
  } catch {
    return null
  }
}

export function isAllowedGeForceNowLaunchTarget(value: string): boolean {
  const parsed = parsedHttpsUrl(value)
  return parsed?.hostname.toLowerCase() === 'play.geforcenow.com'
}

function browserCandidates(): GeForceNowBrowser[] {
  const programFilesX86 = process.env['PROGRAMFILES(X86)']
  const programFiles = process.env.PROGRAMFILES
  const localAppData = process.env.LOCALAPPDATA
  return [
    programFilesX86
      ? {
          executable: join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          name: 'Microsoft Edge' as const
        }
      : null,
    programFiles
      ? {
          executable: join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          name: 'Microsoft Edge' as const
        }
      : null,
    localAppData
      ? {
          executable: join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          name: 'Microsoft Edge' as const
        }
      : null,
    programFiles
      ? {
          executable: join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          name: 'Google Chrome' as const
        }
      : null,
    programFilesX86
      ? {
          executable: join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          name: 'Google Chrome' as const
        }
      : null,
    localAppData
      ? {
          executable: join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          name: 'Google Chrome' as const
        }
      : null
  ].filter((candidate): candidate is GeForceNowBrowser => Boolean(candidate))
}

export function findGeForceNowBrowser(): GeForceNowBrowser | null {
  return browserCandidates().find((candidate) => existsSync(candidate.executable)) ?? null
}

function launchArguments(targetUrl: string): string[] {
  const profilePath = join(app.getPath('userData'), 'geforce-now-browser-profile')
  return [
    `--app=${targetUrl}`,
    `--user-data-dir=${profilePath}`,
    '--start-fullscreen',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-mode',
    '--disable-session-crashed-bubble'
  ]
}

class GeForceNowWebService {
  private browserProcess: ChildProcess | null = null
  private mainWindow: BrowserWindow | null = null
  private controller = new MediaControllerBridge()
  private controllerActive = false
  private disposing = false

  isAvailable(): boolean {
    return process.platform === 'win32' && findGeForceNowBrowser() !== null
  }

  async launch(
    mainWindow: BrowserWindow,
    targetUrl = GEFORCE_NOW_WEB_URL
  ): Promise<ApplicationLaunchResult['controllerBridge']> {
    orbitPlusService.requireFeature('cloud-gaming')
    if (!isAllowedGeForceNowLaunchTarget(targetUrl)) {
      throw new Error('Invalid GeForce NOW launch target')
    }
    const browser = findGeForceNowBrowser()
    if (!browser) {
      throw new Error('GeForce NOW requires Microsoft Edge or Google Chrome')
    }

    if (this.browserProcess && this.browserProcess.exitCode === null) {
      this.close()
    }

    this.mainWindow = mainWindow
    this.disposing = false
    const browserProcess = spawn(browser.executable, launchArguments(targetUrl), {
      stdio: 'ignore',
      windowsHide: false
    })
    this.browserProcess = browserProcess
    browserProcess.on('error', (error) => {
      console.warn(`[geforce-now] ${browser.name} launch failed:`, error.message)
    })
    browserProcess.once('exit', () => {
      if (this.browserProcess === browserProcess) this.finishSession()
    })

    try {
      await new Promise<void>((resolve, reject) => {
        browserProcess.once('spawn', resolve)
        browserProcess.once('error', reject)
      })
    } catch (error) {
      if (this.browserProcess === browserProcess) this.browserProcess = null
      this.mainWindow = null
      throw new Error(
        error instanceof Error
          ? `GeForce NOW konnte nicht mit ${browser.name} geöffnet werden: ${error.message}`
          : `GeForce NOW konnte nicht mit ${browser.name} geöffnet werden`
      )
    }

    const controllerPromise = this.controller.start({
      direction: () => undefined,
      confirm: () => undefined,
      back: () => undefined,
      backHold: () => undefined,
      exitChord: () => this.close(),
      playPause: () => undefined,
      search: () => undefined,
      history: () => undefined
    })
    if (!mainWindow.isDestroyed()) mainWindow.hide()
    const [controllerActive, browserFocused] = await Promise.all([
      controllerPromise,
      activateExternalProcessWindow(browserProcess.pid ?? 0)
    ])
    if (this.browserProcess !== browserProcess || browserProcess.exitCode !== null) {
      this.controller.dispose()
      this.controllerActive = false
      return 'unavailable'
    }
    this.controllerActive = controllerActive
    if (!browserFocused && browserProcess.exitCode === null) {
      console.warn(`[geforce-now] ${browser.name} window could not receive foreground focus`)
    } else {
      console.info(`[geforce-now] ${browser.name} window received foreground focus`)
    }
    return this.controllerActive ? 'active' : 'unavailable'
  }

  async launchInBrowser(targetUrl = GEFORCE_NOW_WEB_URL): Promise<void> {
    orbitPlusService.requireFeature('cloud-gaming')
    if (!isAllowedGeForceNowLaunchTarget(targetUrl)) {
      throw new Error('Invalid GeForce NOW browser target')
    }
    await shell.openExternal(targetUrl)
  }

  close(): void {
    const browserProcess = this.browserProcess
    if (!browserProcess || browserProcess.exitCode !== null) {
      this.finishSession()
      return
    }
    if (!browserProcess.kill()) this.finishSession()
  }

  dispose(): void {
    this.disposing = true
    this.controller.dispose()
    const browserProcess = this.browserProcess
    this.browserProcess = null
    if (browserProcess && browserProcess.exitCode === null) browserProcess.kill()
    this.mainWindow = null
    this.controllerActive = false
  }

  private finishSession(): void {
    this.controller.dispose()
    this.controllerActive = false
    this.browserProcess = null
    const mainWindow = this.mainWindow
    this.mainWindow = null
    if (!this.disposing && mainWindow && !mainWindow.isDestroyed()) {
      void revealOrbitWindow(mainWindow)
    }
  }
}

export const geForceNowWebService = new GeForceNowWebService()
