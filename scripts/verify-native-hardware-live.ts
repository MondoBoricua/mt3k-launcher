import assert from 'node:assert/strict'
import { app, BrowserWindow } from 'electron'
import { NativeHardwareControl } from '../src/main/nativeHardwareControl'
import type { OrbitSettings } from '../src/shared/ipc'

app.disableHardwareAcceleration()
const timeout = setTimeout(() => { console.error('Native smoke test timed out'); app.exit(2) }, 15000)
void app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  const settings = { hardwareControlEnabled: true, hardwareControlButton: 'menu', hardwareControlHoldSeconds: 2 } as OrbitSettings
  const monitor = new NativeHardwareControl(window, settings)
  try {
    monitor.updateSettings(settings)
    await new Promise((resolve) => setTimeout(resolve, 250))
    assert.equal(monitor.getStatus().state, 'ready', JSON.stringify(monitor.getStatus()))
    assert.equal(window.isWindowMessageHooked(0xff), true)
    console.log('Native status:', JSON.stringify(monitor.getStatus()))
    monitor.updateSettings({ ...settings, hardwareControlButton: 'playstation' })
    assert.equal(monitor.getStatus().state, 'ready')
    monitor.recover()
    assert.equal(monitor.getStatus().state, 'ready')
    monitor.updateSettings({ ...settings, hardwareControlEnabled: false })
    assert.equal(monitor.getStatus().state, 'disabled')
    assert.equal(window.isWindowMessageHooked(0xff), false)
    monitor.updateSettings(settings)
    monitor.dispose()
    assert.equal(window.isWindowMessageHooked(0xff), false)
    console.log('PASS: actual Windows native initialization, Raw Input hooks, settings, resume recovery, disable and disposal')
    window.destroy(); clearTimeout(timeout); app.exit(0)
  } catch (error) { console.error(error); monitor.dispose(); window.destroy(); clearTimeout(timeout); app.exit(1) }
}).catch((error) => { console.error(error); app.exit(1) })
