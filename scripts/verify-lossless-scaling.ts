import assert from 'node:assert/strict'
import {
  LOSSLESS_SCALING_DEFAULTS,
  decideLosslessScalingStart,
  decideLosslessScalingStop,
  isLosslessScalingEligibleGame,
  isLosslessScalingExecutablePath,
  isLosslessScalingGameMode,
  losslessScalingSteamCandidates,
  losslessScalingWorkingDirectory,
  normalizeLosslessScalingPreferences,
  parseLosslessScalingTasklist,
  resolveLosslessScalingExecutable,
  resolveLosslessScalingForGame,
  validateLosslessScalingExecutable,
  type LosslessScalingPreferences
} from '../src/shared/losslessScalingPolicy.ts'

// Defaults: off, new games off, close what we started on.
assert.deepEqual(LOSSLESS_SCALING_DEFAULTS, { enabled: false, defaultForGames: false, closeOnExit: true })
assert.deepEqual(normalizeLosslessScalingPreferences({}), LOSSLESS_SCALING_DEFAULTS)
assert.deepEqual(
  normalizeLosslessScalingPreferences({ losslessScalingEnabled: 'true', losslessScalingDefaultForGames: 1, losslessScalingCloseOnExit: 0 }),
  { enabled: false, defaultForGames: false, closeOnExit: true },
  'Only real booleans change the stored preferences'
)
assert.equal(normalizeLosslessScalingPreferences({ losslessScalingCloseOnExit: false }).closeOnExit, false)

for (const mode of ['default', 'always', 'never']) assert.equal(isLosslessScalingGameMode(mode), true)
for (const mode of ['', 'Always', 'on', null, undefined, 1, {}]) assert.equal(isLosslessScalingGameMode(mode), false)

// Only games that run on this PC.
for (const provider of ['steam', 'epic', 'gog', 'xbox', 'retro', 'ea', 'ubisoft', 'local']) {
  assert.equal(isLosslessScalingEligibleGame({ provider, installed: true }), true, provider)
  assert.equal(isLosslessScalingEligibleGame({ provider, installed: false }), false, `${provider} store entry`)
}
assert.equal(isLosslessScalingEligibleGame({ provider: 'playstation', installed: true }), false, 'Remote Play is a stream')
assert.equal(isLosslessScalingEligibleGame({ provider: 'geforce-now', installed: true }), false)

// Per-game tri-state.
const on: LosslessScalingPreferences = { enabled: true, defaultForGames: false, closeOnExit: true }
const steam = { provider: 'steam', installed: true }
assert.equal(resolveLosslessScalingForGame(on, undefined, steam), false, 'Default off keeps new games off')
assert.equal(resolveLosslessScalingForGame(on, 'default', steam), false)
assert.equal(resolveLosslessScalingForGame(on, 'always', steam), true)
assert.equal(resolveLosslessScalingForGame({ ...on, defaultForGames: true }, 'default', steam), true)
assert.equal(resolveLosslessScalingForGame({ ...on, defaultForGames: true }, undefined, steam), true)
assert.equal(resolveLosslessScalingForGame({ ...on, defaultForGames: true }, 'never', steam), false)
assert.equal(resolveLosslessScalingForGame({ ...on, enabled: false }, 'always', steam), false, 'Global switch wins')
assert.equal(resolveLosslessScalingForGame(on, 'always', { provider: 'playstation', installed: true }), false)
assert.equal(resolveLosslessScalingForGame(on, 'always', { provider: 'steam', installed: false }), false)

// Start decisions.
const exe = 'C:\\Steam\\steamapps\\common\\Lossless Scaling\\LosslessScaling.exe'
assert.equal(decideLosslessScalingStart({ platform: 'win32', wanted: true, executablePath: exe, running: false }), 'start')
assert.equal(decideLosslessScalingStart({ platform: 'win32', wanted: true, executablePath: exe, running: true }), 'already-running')
assert.equal(decideLosslessScalingStart({ platform: 'win32', wanted: true, executablePath: undefined, running: true }), 'already-running', 'A running copy is enough even without a path')
assert.equal(decideLosslessScalingStart({ platform: 'win32', wanted: true, executablePath: undefined, running: false }), 'missing')
assert.equal(decideLosslessScalingStart({ platform: 'win32', wanted: false, executablePath: exe, running: false }), 'skip')
assert.equal(decideLosslessScalingStart({ platform: 'darwin', wanted: true, executablePath: exe, running: false }), 'skip')
assert.equal(decideLosslessScalingStart({ platform: 'linux', wanted: true, executablePath: exe, running: false }), 'skip')

// Stop decisions: never touch an instance we did not start.
assert.equal(decideLosslessScalingStop({ startedPid: undefined, closeOnExit: true, stillOurs: true }), 'nothing')
assert.equal(decideLosslessScalingStop({ startedPid: 0, closeOnExit: true, stillOurs: true }), 'nothing')
assert.equal(decideLosslessScalingStop({ startedPid: 4242, closeOnExit: true, stillOurs: true }), 'close')
assert.equal(decideLosslessScalingStop({ startedPid: 4242, closeOnExit: false, stillOurs: true }), 'forget')
assert.equal(decideLosslessScalingStop({ startedPid: 4242, closeOnExit: true, stillOurs: false }), 'forget', 'A reused PID is not ours')

// Path validation: only an absolute path to a file named LosslessScaling.exe.
for (const valid of [
  exe,
  'D:/Games/Lossless Scaling/losslessscaling.EXE',
  '\\\\nas\\games\\Lossless Scaling\\LosslessScaling.exe'
]) assert.equal(isLosslessScalingExecutablePath(valid), true, valid)
for (const invalid of [
  '', ' ', 'LosslessScaling.exe', '.\\LosslessScaling.exe', 'C:\\Tools\\Lossless.exe',
  'C:\\Tools\\LosslessScaling.exe.bat', 'C:\\Tools\\LosslessScaling.exe ', ' C:\\Tools\\LosslessScaling.exe',
  'C:\\Tools\\..\\LosslessScaling.exe', 'C:\\Tools\\Loss\u0000lessScaling.exe', 'C:\\"x"\\LosslessScaling.exe',
  '/usr/bin/LosslessScaling.exe', 'C:\\x\\' + 'a'.repeat(33_000) + '\\LosslessScaling.exe', 42, null, undefined, {}
]) assert.equal(isLosslessScalingExecutablePath(invalid), false, String(invalid).slice(0, 60))

const files = new Set([exe.toLowerCase()])
const fileSystem = {
  exists: (path: string) => files.has(path.toLowerCase()) || path === 'C:\\Folder\\LosslessScaling.exe',
  isFile: (path: string) => files.has(path.toLowerCase())
}
assert.deepEqual(validateLosslessScalingExecutable(exe, fileSystem), { ok: true, path: exe })
assert.deepEqual(validateLosslessScalingExecutable('C:\\Other\\LosslessScaling.exe', fileSystem), { ok: false, reason: 'not-found' })
assert.deepEqual(validateLosslessScalingExecutable('C:\\Folder\\LosslessScaling.exe', fileSystem), { ok: false, reason: 'not-a-file' })
assert.deepEqual(validateLosslessScalingExecutable('C:\\Tools\\cmd.exe', fileSystem), { ok: false, reason: 'invalid-path' })

// Steam detection candidates.
assert.deepEqual(
  losslessScalingSteamCandidates([
    { path: 'C:\\Program Files (x86)\\Steam\\' },
    { path: 'D:\\SteamLibrary', installDirName: 'LS Custom' },
    { path: 'd:\\steamlibrary', installDirName: 'Lossless Scaling' },
    { path: 'E:\\Lib', installDirName: '..\\..\\Windows' },
    { path: '' }
  ]),
  [
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Lossless Scaling\\LosslessScaling.exe',
    'D:\\SteamLibrary\\steamapps\\common\\LS Custom\\LosslessScaling.exe',
    'D:\\SteamLibrary\\steamapps\\common\\Lossless Scaling\\LosslessScaling.exe',
    'E:\\Lib\\steamapps\\common\\Lossless Scaling\\LosslessScaling.exe'
  ],
  'Manifest folder first, duplicates folded, traversal ignored'
)

const steamCandidates = losslessScalingSteamCandidates([{ path: 'C:\\Steam' }])
const isFile = (path: string): boolean => path === exe || path === 'D:\\Manual\\LosslessScaling.exe'
assert.deepEqual(
  resolveLosslessScalingExecutable({ platform: 'win32', manualPath: undefined, steamCandidates, isFile }),
  { supported: true, state: 'found', source: 'steam', path: exe, manualPath: undefined }
)
assert.deepEqual(
  resolveLosslessScalingExecutable({ platform: 'win32', manualPath: 'D:\\Manual\\LosslessScaling.exe', steamCandidates, isFile }),
  { supported: true, state: 'found', source: 'manual', path: 'D:\\Manual\\LosslessScaling.exe', manualPath: 'D:\\Manual\\LosslessScaling.exe' },
  'A valid manual override wins'
)
assert.deepEqual(
  resolveLosslessScalingExecutable({ platform: 'win32', manualPath: 'D:\\Gone\\LosslessScaling.exe', steamCandidates, isFile }),
  { supported: true, state: 'found', source: 'steam', path: exe, manualPath: 'D:\\Gone\\LosslessScaling.exe' },
  'A stale override falls back to Steam and stays visible'
)
assert.deepEqual(
  resolveLosslessScalingExecutable({ platform: 'win32', manualPath: undefined, steamCandidates: [], isFile }),
  { supported: true, state: 'missing', source: 'none', manualPath: undefined }
)
assert.deepEqual(
  resolveLosslessScalingExecutable({ platform: 'darwin', manualPath: undefined, steamCandidates, isFile }),
  { supported: false, state: 'missing', source: 'none', manualPath: undefined },
  'Other platforms never report a path'
)

assert.equal(losslessScalingWorkingDirectory(exe), 'C:\\Steam\\steamapps\\common\\Lossless Scaling')

// tasklist parsing.
assert.deepEqual(parseLosslessScalingTasklist('INFO: No tasks are running which match the specified criteria.\r\n'), [])
assert.deepEqual(parseLosslessScalingTasklist(''), [])
assert.deepEqual(
  parseLosslessScalingTasklist(
    '"LosslessScaling.exe","12345","Console","1","180,512 K"\r\n' +
      '"losslessscaling.exe","678","Console","1","1 K"\r\n' +
      '"LosslessScaling.exe.bak","9","Console","1","1 K"\r\n' +
      '"explorer.exe","4","Console","1","1 K"\r\n' +
      '"LosslessScaling.exe","0","Console","1","1 K"\r\n'
  ),
  [12345, 678]
)

console.log('Lossless Scaling: defaults, per-game tri-state, eligibility, start/stop ownership, path validation, Steam detection and process parsing passed.')
