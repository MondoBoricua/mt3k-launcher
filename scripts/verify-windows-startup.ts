import assert from 'node:assert/strict'
import { startupLoginItemIsActive, windowsLoginItemLookupPath } from '../src/main/windowsStartupLoginItem.ts'

const packaged = { name: 'ORBIT', path: 'C:\\Program Files\\ORBIT\\ORBIT.exe', args: ['--orbit-background'] }

// Electron quotes nothing in the lookup; ORBIT must quote paths that contain spaces.
assert.equal(windowsLoginItemLookupPath(packaged.path), '"C:\\Program Files\\ORBIT\\ORBIT.exe"')
assert.equal(windowsLoginItemLookupPath('C:\\a"b\\ORBIT.exe'), '"C:\\ab\\ORBIT.exe"')

// Shape Electron 43 reports on Windows 11: the switch is dropped from args.
const reported = { name: 'ORBIT', path: packaged.path, args: [] as string[], enabled: true }
assert.equal(startupLoginItemIsActive([reported], packaged), true, 'switch-only args read back as []')
assert.equal(startupLoginItemIsActive([{ ...reported, args: ['--orbit-background'] }], packaged), true, 'exact args still match')
assert.equal(startupLoginItemIsActive([{ ...reported, name: 'orbit', path: packaged.path.toUpperCase() }], packaged), true, 'registry names and paths are case-insensitive')

// Anything that would not start this ORBIT stays inactive.
assert.equal(startupLoginItemIsActive([], packaged), false)
assert.equal(startupLoginItemIsActive([{ ...reported, enabled: false }], packaged), false, 'disabled in Startup Apps')
assert.equal(startupLoginItemIsActive([{ ...reported, name: 'ORBIT Background Service' }], packaged), false, 'legacy service entry')
assert.equal(startupLoginItemIsActive([{ ...reported, path: 'D:\\Other\\ORBIT.exe' }], packaged), false, 'other installation')
assert.equal(startupLoginItemIsActive([{ ...reported, args: ['C:\\stale'] }], packaged), false, 'unexpected positional argument')

// Development runs pass the app path as a positional argument before the switch.
const development = { name: 'ORBIT', path: 'C:\\Users\\Pana Gamer\\node_modules\\electron\\dist\\electron.exe', args: ['C:\\Users\\Pana Gamer\\orbit', '--orbit-background'] }
assert.equal(startupLoginItemIsActive([{ name: 'ORBIT', path: development.path, args: ['C:\\Users\\Pana Gamer\\orbit'], enabled: true }], development), true)
assert.equal(startupLoginItemIsActive([{ name: 'ORBIT', path: development.path, args: [], enabled: true }], development), false)

console.log('Windows startup login item checks passed')
