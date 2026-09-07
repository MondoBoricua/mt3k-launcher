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

export const BACKGROUND_ARGUMENT = '--orbit-background'
const LOGIN_NAME = 'ORBIT'

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

  constructor(private readonly window: BrowserWindow) {
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
        this.refreshLoginItem()
        const icon = await app.getFileIcon(process.execPath, { size: 'small' })
        if (this.disposed) return
        this.tray = new Tray(icon)
        this.tray.setToolTip('ORBIT')
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
    if (enabled !== this.startsWithWindows) throw new Error('Windows could not change ORBIT startup. Check ORBIT in Windows Startup Apps.')
  }
  private refreshLoginItem(): void {
    const args = app.isPackaged ? [BACKGROUND_ARGUMENT] : [app.getAppPath(), BACKGROUND_ARGUMENT]
    const actual = app.getLoginItemSettings({ path: process.execPath, args })
    this.startsWithWindows = actual.launchItems.some((item) => item.name === LOGIN_NAME && item.enabled &&
      item.path.toLowerCase() === process.execPath.toLowerCase() && JSON.stringify(item.args) === JSON.stringify(args))
  }
  async prepareForAppUpdate(_transactionId?: string): Promise<void> {
    await this.startup
    if (this.legacyCleanupFailed) throw new Error(this.error ?? 'The old background service could not be stopped')
    this.suspended = true
    this.controller.updateSettings({ ...settingsStore.store, hardwareControlEnabled: false })
  }
  async recoverFromFailedAppUpdate(_transactionId?: string): Promise<void> {
    this.suspended = false
    if (this.ready) this.controller.updateSettings(settingsStore.store)
  }
  private async activate(): Promise<void> {
    if (this.disposed || this.suspended || this.activationInFlight) return
    this.activationInFlight = true
    try { this.activationResult = await revealOrbitWindow(this.window) ? 'focused' : 'failed' }
    catch { this.activationResult = 'failed' }
    finally { this.activationInFlight = false; this.activationAt = Date.now(); this.send() }
  }
  private updateTray(): void {
    this.tray?.setContextMenu(Menu.buildFromTemplate([
      { label: t("Open ORBIT"), click: () => void this.activate() },
      { type: 'separator' },
      { label: t("Quit ORBIT completely"), click: () => app.quit() }
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
