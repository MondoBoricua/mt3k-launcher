import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { t } from './i18n'
import { app, Menu, powerMonitor, Tray, type BrowserWindow } from 'electron'
import { IPC, type OrbitBackgroundServiceAction, type OrbitBackgroundServiceStatus } from '../shared/ipc'
import { settingsStore } from './settingsStore'
import { NativeHardwareControl } from './nativeHardwareControl'
import { revealOrbitWindow } from './orbitWindow'
import { OrbitBackgroundServiceManager } from './orbitBackgroundServiceManager'
import { getOrbitBackgroundServiceLoginItemInstallation } from './orbitBackgroundServiceLoginItem'
import { orbitServicePipeNames, requestOrbitPipe } from './orbitServiceProtocol'
import { orbitStartsThroughXboxMode } from './xboxModeStartup'
import { startupLoginItemIsActive, startupLoginItemsNeedingMigration, windowsLoginItemLookupPath } from './windowsStartupLoginItem'
import {
  clearBackgroundAgentSuspension,
  readBackgroundAgentSuspension,
  suspendBackgroundAgent
} from './orbitBackgroundServiceSuspension'

export const BACKGROUND_ARGUMENT = '--orbit-background'
const LOGIN_NAME = 'MT3K Launcher'

export interface OrbitBackgroundModeOptions {
  /** True solo con el toggle prendido y una sesión de RetroArch ya corriendo. */
  retroArchPauseEligible?: () => boolean
}

/** The existing IPC names remain compatible; there is no independent service. */
export class OrbitBackgroundMode {
  private readonly controller: NativeHardwareControl
  private tray?: Tray
  private quitting = false
  private disposed = false
  private ready = false
  private suspended = false
  private error?: string
  private legacyCleanupFailed = false
  private activationResult?: 'focused' | 'failed'
  private activationAt?: number
  private activationInFlight = false
  private startup: Promise<void> = Promise.resolve()
  private startsWithWindows = false
  private readonly recover = (): void => { if (!this.suspended && this.ready) this.controller.recover() }
  private readonly beforeQuit = (): void => { this.quitting = true; this.dispose() }
  private readonly onClose = (event: Electron.Event): void => {
    if (!this.quitting && this.tray && settingsStore.store.backgroundModeEnabled !== false) {
      event.preventDefault(); this.window.hide()
    }
  }

  constructor(
    private readonly window: BrowserWindow,
    private readonly options: OrbitBackgroundModeOptions = {}
  ) {
    this.controller = new NativeHardwareControl(window, settingsStore.store)
    this.controller.on('status', () => this.send())
    this.controller.on('trigger', () => void this.activate())
    window.on('close', this.onClose)
    app.on('before-quit', this.beforeQuit)
  }
  start(reconciliation: Promise<void>): void {
    this.startup = this.initialize(reconciliation).catch((error) => {
      this.error = error instanceof Error ? error.message : String(error)
      this.ready = true
      if (!this.disposed) {
        if (!this.tray && !this.window.isDestroyed()) this.window.show()
        this.controller.updateSettings(settingsStore.store); this.send()
      }
    })
  }
  private async initialize(reconciliation: Promise<void>): Promise<void> {
    if (process.platform === 'win32' && !process.windowsStore) {
      try {
        await this.migrateLoginItem().catch(error => console.warn('[migration] Startup entry repair will retry', error))
        this.refreshLoginItem()
        const icon = await app.getFileIcon(process.execPath, { size: 'small' })
        if (this.disposed) return
        this.tray = new Tray(icon)
        this.tray.setToolTip('MT3K Launcher')
        this.tray.on('double-click', () => void this.activate())
        this.updateTray()
      } catch (error) {
        this.error = `Tray: ${error instanceof Error ? error.message : String(error)}`
        this.window.show()
      }
    } else if (process.argv.includes(BACKGROUND_ARGUMENT)) this.window.show()
    await reconciliation
    if (this.disposed) return
    // Reuse the bounded shutdown/identity checks only for migration. Never start
    // the legacy manager or its recovery/polling lifecycle in the new runtime.
    if (process.platform === 'win32' && !process.windowsStore) {
      const legacy = new OrbitBackgroundServiceManager(this.window, () => false)
      try {
        const installation = getOrbitBackgroundServiceLoginItemInstallation(app, process.execPath, app.isPackaged ? undefined : app.getAppPath())
        const running = await requestOrbitPipe(orbitServicePipeNames(app.getPath('userData')).agent, { command: 'status' }, 300).then(() => true, () => false)
        if (installation.installation !== 'not-installed' || running) await legacy.control('remove')
      }
      catch (error) {
        this.legacyCleanupFailed = true
        this.error = `Legacy cleanup: ${error instanceof Error ? error.message : String(error)}`
      }
      finally { legacy.dispose() }
    }
    if (this.disposed) return
    this.ready = true
    powerMonitor.on('resume', this.recover)
    powerMonitor.on('unlock-screen', this.recover)
    this.controller.updateSettings(settingsStore.store)
    this.send()
  }
  getStatus(): OrbitBackgroundServiceStatus {
    return { installation: 'installed', runtime: this.ready ? 'running' : 'starting',
      backgroundModeAvailable: process.platform === 'win32' && !process.windowsStore,
      startWithWindows: this.startsWithWindows,
      startsThroughXboxMode: orbitStartsThroughXboxMode(),
      hardwareControl: this.controller.getStatus(), detail: this.error,
      lastActivationAt: this.activationAt, lastActivationResult: this.activationResult }
  }
  async control(action: OrbitBackgroundServiceAction): Promise<OrbitBackgroundServiceStatus> {
    await this.startup
    if (action === 'restart' || action === 'repair') this.recover()
    return this.getStatus()
  }
  reloadSettings(): void {
    if (this.ready && !this.suspended) this.controller.updateSettings(settingsStore.store)
    this.updateTray()
    // Turning off tray persistence while hidden must not strand the application.
    if (settingsStore.store.backgroundModeEnabled === false && !this.window.isVisible()) this.window.show()
    this.send()
  }
  setStartWithWindows(enabled: boolean): void {
    if (process.platform !== 'win32' || process.windowsStore) throw new Error('Windows startup is unavailable in this package')
    const args = app.isPackaged ? [BACKGROUND_ARGUMENT] : [app.getAppPath(), BACKGROUND_ARGUMENT]
    app.setLoginItemSettings({ name: LOGIN_NAME, path: process.execPath, args, openAtLogin: enabled })
    this.refreshLoginItem()
    if (enabled !== this.startsWithWindows) throw new Error('Windows could not change MT3K Launcher startup. Check MT3K Launcher in Windows Startup Apps.')
  }
  private async migrateLoginItem(): Promise<void> {
    // Electron only returns items whose executable matches the lookup path.
    // Read our exact HKCU names first, then use Electron for argument/disabled-state readback.
    const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const script = String.raw`[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$key = Get-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue
$result = @()
if ($key) {
  foreach ($name in @('ORBIT', 'MT3K Launcher')) {
    $command = [string]$key.GetValue($name)
    if ($command -match '^"([^"\r\n]+)"') { $result += $Matches[1] }
    elseif ($command -match '^([^\s]+\.exe)(?:\s|$)') { $result += $Matches[1] }
  }
}
ConvertTo-Json -InputObject $result -Compress`
    const { stdout } = await promisify(execFile)(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 10_000 })
    const paths: unknown = JSON.parse(stdout)
    if (!Array.isArray(paths) || paths.some(p => typeof p !== 'string')) throw new Error('Invalid startup registry readback')
    const args = app.isPackaged ? [BACKGROUND_ARGUMENT] : [app.getAppPath(), BACKGROUND_ARGUMENT]
    const actual = { launchItems: [...new Set([process.execPath, ...paths as string[]])].flatMap(path =>
      app.getLoginItemSettings({ path: windowsLoginItemLookupPath(path), args }).launchItems.filter(item => item.scope === 'user')) }
    const stale = startupLoginItemsNeedingMigration(actual.launchItems, { name: LOGIN_NAME, path: process.execPath, args })
    if (stale.length > 0) {
      const current = actual.launchItems.find(item => item.name.toLowerCase() === LOGIN_NAME.toLowerCase() && item.path.toLowerCase() === process.execPath.toLowerCase())
      const enabled = current?.enabled ?? stale.some(item => item.enabled)
      app.setLoginItemSettings({ name: LOGIN_NAME, path: process.execPath, args, openAtLogin: enabled })
      // Remove only per-user values; Electron's write API never edits HKLM.
      for (const item of stale) {
        if (item.name.toLowerCase() === LOGIN_NAME.toLowerCase()) continue
        app.setLoginItemSettings({ name: item.name, path: item.path, args: [...item.args], openAtLogin: false })
      }
    }
  }
  private refreshLoginItem(): void {
    const args = app.isPackaged ? [BACKGROUND_ARGUMENT] : [app.getAppPath(), BACKGROUND_ARGUMENT]
    const actual = app.getLoginItemSettings({ path: windowsLoginItemLookupPath(process.execPath), args })
    this.startsWithWindows = startupLoginItemIsActive(actual.launchItems, { name: LOGIN_NAME, path: process.execPath, args })
  }
  async prepareForAppUpdate(transactionId?: string): Promise<void> {
    await this.startup
    if (this.legacyCleanupFailed) throw new Error(this.error ?? 'The old background service could not be stopped')
    // AppUpdateService renews this exact transaction right before it launches the
    // installer or package helper; without the marker the renewal fails and the
    // update aborts as "install-failed".
    if (transactionId) {
      await suspendBackgroundAgent(app.getPath('userData'), { transactionId, recoverAgent: false })
    }
    this.suspended = true
    this.controller.updateSettings({ ...settingsStore.store, hardwareControlEnabled: false })
  }
  async recoverFromFailedAppUpdate(transactionId?: string): Promise<void> {
    if (transactionId) {
      const suspension = await readBackgroundAgentSuspension(app.getPath('userData'))
      if (suspension?.transactionId === transactionId) {
        await clearBackgroundAgentSuspension(app.getPath('userData'))
      }
    }
    this.suspended = false
    if (this.ready) this.controller.updateSettings(settingsStore.store)
  }
  private async activate(): Promise<void> {
    if (this.disposed || this.suspended || this.activationInFlight) return
    this.activationInFlight = true
    try { this.activationResult = await revealOrbitWindow(this.window) ? 'focused' : 'failed' }
    catch { this.activationResult = 'failed' }
    finally {
      this.activationInFlight = false
      this.activationAt = Date.now()
      this.send()
      // El menú se abre aquí, no en cada focus. Si el toggle está apagado
      // o el juego no es RetroArch, retroArchPauseEligible responde false.
      if (
        this.activationResult === 'focused' &&
        !this.window.isDestroyed() &&
        !this.window.webContents.isDestroyed() &&
        this.options.retroArchPauseEligible?.()
      ) {
        this.window.webContents.send(IPC.retroArchPauseRequested)
      }
    }
  }
  private updateTray(): void {
    this.tray?.setContextMenu(Menu.buildFromTemplate([
      { label: t("Open MT3K Launcher"), click: () => void this.activate() },
      { type: 'separator' },
      { label: t("Quit MT3K Launcher completely"), click: () => app.quit() }
    ]))
  }
  private send(): void {
    if (this.disposed || this.window.isDestroyed() || this.window.webContents.isDestroyed()) return
    this.window.webContents.send(IPC.hardwareControlStatus, this.controller.getStatus())
    this.window.webContents.send(IPC.backgroundServiceStatus, this.getStatus())
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true; this.controller.dispose(); this.tray?.destroy(); this.tray = undefined
    powerMonitor.removeListener('resume', this.recover)
    powerMonitor.removeListener('unlock-screen', this.recover)
    app.removeListener('before-quit', this.beforeQuit)
    this.window.removeListener('close', this.onClose)
  }
}
