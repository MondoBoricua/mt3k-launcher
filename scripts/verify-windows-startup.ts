import assert from 'node:assert/strict'
import { startupLoginItemIsActive, startupLoginItemsNeedingMigration, windowsLoginItemLookupPath } from '../src/main/windowsStartupLoginItem.ts'

const packaged = { name: 'MT3K Launcher', path: 'C:\\Program Files\\ORBIT\\MT3KLauncher.exe', args: ['--orbit-background'] }

// Electron quotes nothing in the lookup; ORBIT must quote paths that contain spaces.
assert.equal(windowsLoginItemLookupPath(packaged.path), '"C:\\Program Files\\ORBIT\\MT3KLauncher.exe"')
assert.equal(windowsLoginItemLookupPath('C:\\a"b\\MT3KLauncher.exe'), '"C:\\ab\\MT3KLauncher.exe"')

// Shape Electron 43 reports on Windows 11: the switch is dropped from args.
const reported = { name: 'MT3K Launcher', path: packaged.path, args: [] as string[], enabled: true }
assert.equal(startupLoginItemIsActive([reported], packaged), true, 'switch-only args read back as []')
assert.equal(startupLoginItemIsActive([{ ...reported, args: ['--orbit-background'] }], packaged), true, 'exact args still match')
assert.equal(startupLoginItemIsActive([{ ...reported, name: 'mt3k launcher', path: packaged.path.toUpperCase() }], packaged), true, 'registry names and paths are case-insensitive')

// Anything that would not start this ORBIT stays inactive.
assert.equal(startupLoginItemIsActive([], packaged), false)
assert.equal(startupLoginItemIsActive([{ ...reported, enabled: false }], packaged), false, 'disabled in Startup Apps')
assert.equal(startupLoginItemIsActive([{ ...reported, name: 'ORBIT Background Service' }], packaged), false, 'legacy service entry')
assert.equal(startupLoginItemIsActive([{ ...reported, path: 'D:\\Other\\MT3KLauncher.exe' }], packaged), false, 'other installation')
assert.equal(startupLoginItemIsActive([{ ...reported, args: ['C:\\stale'] }], packaged), false, 'unexpected positional argument')

// Development runs pass the app path as a positional argument before the switch.
const development = { name: 'MT3K Launcher', path: 'C:\\Users\\Pana Gamer\\node_modules\\electron\\dist\\electron.exe', args: ['C:\\Users\\Pana Gamer\\orbit', '--orbit-background'] }
assert.equal(startupLoginItemIsActive([{ name: 'MT3K Launcher', path: development.path, args: ['C:\\Users\\Pana Gamer\\orbit'], enabled: true }], development), true)
assert.equal(startupLoginItemIsActive([{ name: 'MT3K Launcher', path: development.path, args: [], enabled: true }], development), false)

console.log('Windows startup login item checks passed')

assert.equal(startupLoginItemsNeedingMigration([{ ...reported, name: 'ORBIT', path: 'C:\\Old\\ORBIT.exe' }], packaged).length, 1)
assert.equal(startupLoginItemsNeedingMigration([{ ...reported, path: 'C:\\Old\\MT3KLauncher.exe' }], packaged).length, 1)
assert.equal(startupLoginItemsNeedingMigration([reported], packaged).length, 0)
