import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateUserData, migrateDocuments, documentsRoot, rewritePathPrefixes, rewriteJsonPaths, preferredLauncherExecutable } from '../src/main/renameMigrationPolicy.ts'
import { startupLoginItemsNeedingMigration } from '../src/main/windowsStartupLoginItem.ts'

const old = String.raw`C:\Users\Pana Gamer\OneDrive\Documents\ORBIT`
const next = old.replace('ORBIT', 'MT3K Launcher')
assert.equal(rewritePathPrefixes(old + '\\cores\\a', old, next, true), next + '\\cores\\a')
assert.equal(rewritePathPrefixes(old.toLowerCase(), old, next, true), next)
assert.equal(rewritePathPrefixes(old.toLowerCase(), old, next, false), old.toLowerCase())
assert.equal(rewritePathPrefixes(old.replaceAll('\\', '/') + '/a', old, next, true), next.replaceAll('\\', '/') + '/a')
assert.equal(rewritePathPrefixes('file:///C:/Users/Pana%20Gamer/OneDrive/Documents/ORBIT/a', old, next, true), 'file:///C:/Users/Pana%20Gamer/OneDrive/Documents/MT3K%20Launcher/a')
assert.equal(rewritePathPrefixes(old + '-other', old, next, true), old + '-other')
const store = JSON.stringify({ emulatorPath: old + '\\Emulators\\a.exe', nested: [old, old.replaceAll('\\', '/')], untouched: 'ORBIT' })
const rewritten = JSON.parse(rewriteJsonPaths(store, old, next, true))
assert.equal(rewritten.emulatorPath, next + '\\Emulators\\a.exe')
assert.deepEqual(rewritten.nested, [next, next.replaceAll('\\', '/')])
assert.equal(rewritten.untouched, 'ORBIT')
assert.throws(() => rewriteJsonPaths('{broken', old, next, true))
for (const [oldExists, newExists, status, path] of [
  [true, false, 'moved', 'new'], [false, true, 'new', 'new'],
  [true, true, 'both-exist-old-left-in-place', 'new'], [false, false, 'fresh', 'new']
] as const) {
  let calls = 0
  const result = migrateUserData('old', 'new', { existsSync: p => p === 'old' ? oldExists : newExists, renameSync: () => { calls++ } })
  assert.equal(result.status, status); assert.equal(result.path, path)
  assert.equal(calls, oldExists && !newExists ? 1 : 0)
}
for (const code of ['EPERM', 'EXDEV', 'EACCES', 'EBUSY']) {
  const result = migrateUserData('old', 'new', { existsSync: p => p === 'old', renameSync: () => { throw new Error(code) } })
  assert.equal(result.path, 'old'); assert.equal(result.status, 'retry-next-start')
  assert.match(result.error!, new RegExp(code))
}
assert.equal(preferredLauncherExecutable(['ORBIT.exe']), 'ORBIT.exe')
assert.equal(preferredLauncherExecutable(['MT3KLauncher.exe']), 'MT3KLauncher.exe')
assert.equal(preferredLauncherExecutable(['ORBIT.exe', 'mt3klauncher.EXE']), 'MT3KLauncher.exe')
assert.equal(preferredLauncherExecutable(['other.exe']), undefined)
const expected = { name: 'MT3K Launcher', path: 'C:\\App\\MT3KLauncher.exe', args: ['--orbit-background'] }
assert.equal(startupLoginItemsNeedingMigration([{ ...expected, name: 'ORBIT', enabled: false }], expected).length, 1)
assert.equal(startupLoginItemsNeedingMigration([{ ...expected, path: 'C:\\Old\\ORBIT.exe', enabled: true }], expected).length, 1)
assert.equal(startupLoginItemsNeedingMigration([{ ...expected, enabled: true }], expected).length, 0)

const root = await fs.mkdtemp(join(tmpdir(), 'mt3k-rename-'))
try {
  const hook = createRequire(import.meta.url)('../scripts/mt3k/include-legacy-stub.cjs')
  const appOutDir = join(root, 'packaged')
  await fs.mkdir(appOutDir)
  const context = { appOutDir, electronPlatformName: 'win32', packager: { projectDir: root } }
  await hook(context)
  assert.equal(existsSync(join(appOutDir, 'ORBIT.exe')), false, 'local packaging skips absent stub')
  await fs.mkdir(join(root, 'build', 'mt3k-compat'), { recursive: true })
  await fs.writeFile(join(root, 'build', 'mt3k-compat', 'ORBIT.exe'), 'stub fixture')
  await hook(context)
  assert.equal(await fs.readFile(join(appOutDir, 'ORBIT.exe'), 'utf8'), 'stub fixture', 'CI stub goes beside main executable')
  const documents = join(root, 'OneDrive Documents José Игры')
  const userData = join(root, 'MT3K Launcher')
  const source = join(documents, 'ORBIT')
  const target = join(documents, 'MT3K Launcher')
  assert.equal(documentsRoot(documents, existsSync), target)
  await fs.mkdir(userData)
  await migrateDocuments(documents, userData, fs, () => undefined)
  assert.equal(existsSync(target), false, 'neither Documents folder: no move or creation')
  await fs.mkdir(join(source, 'Emulators'), { recursive: true })
  await fs.writeFile(join(userData, 'orbit-settings.json'), JSON.stringify({ corePath: source + '/Emulators/core' }))
  await fs.writeFile(join(source, 'Emulators', 'retroarch.cfg'), `core_directory = "${source}/Emulators"`)
  await fs.writeFile(join(source, 'bad.cfg'), Buffer.from([0xff, 0xfe, 0x00]))
  await fs.writeFile(join(source, 'large.txt'), 'x'.repeat(8 * 1024 * 1024 + 1))
  await fs.symlink(join(userData, 'orbit-settings.json'), join(source, 'linked.json'))
  const logs: string[] = []
  const log = (message: string): void => { logs.push(message) }
  const deniedFs = { ...fs, rename: async (a: Parameters<typeof fs.rename>[0], b: Parameters<typeof fs.rename>[1]) => {
    if (a === source) throw new Error('EPERM')
    return fs.rename(a, b)
  } }
  await migrateDocuments(documents, userData, deniedFs, log)
  assert.equal(documentsRoot(documents, existsSync), source)
  assert.equal(JSON.parse(await fs.readFile(join(userData, 'orbit-settings.json'), 'utf8')).corePath, source + '/Emulators/core')
  // Fail an atomic file replacement once, then recover after the directory moved.
  let failOnce = true
  const interruptedFs = { ...fs, rename: async (a: Parameters<typeof fs.rename>[0], b: Parameters<typeof fs.rename>[1]) => {
    if (String(b).endsWith('orbit-settings.json') && failOnce) { failOnce = false; throw new Error('locked store') }
    return fs.rename(a, b)
  } }
  await migrateDocuments(documents, userData, interruptedFs, log)
  assert.equal(existsSync(source), false)
  assert.equal(documentsRoot(documents, existsSync), target)
  const journalPath = join(userData, 'migrations', 'documents-folder.json')
  assert.equal(JSON.parse(await fs.readFile(journalPath, 'utf8')).complete, false)
  await migrateDocuments(documents, userData, fs, log)
  const journal = JSON.parse(await fs.readFile(journalPath, 'utf8'))
  assert.equal(journal.complete, true)
  assert.equal(journal.rewrittenCount, 2)
  assert.equal(journal.skipped.length, 2)
  assert.equal(JSON.parse(await fs.readFile(join(userData, 'orbit-settings.json'), 'utf8')).corePath, target + '/Emulators/core')
  assert.equal(await fs.readFile(join(target, 'Emulators', 'retroarch.cfg'), 'utf8'), `core_directory = "${target}/Emulators"`)
  const snapshot = await fs.readFile(journalPath, 'utf8')
  await migrateDocuments(documents, userData, fs, log)
  assert.equal(await fs.readFile(journalPath, 'utf8'), snapshot, 'completed migration is a no-op')
  // Both directories: never merge or rewrite the old tree.
  const bothUserData = join(root, 'both-user'); await fs.mkdir(bothUserData)
  await fs.mkdir(source)
  await fs.writeFile(join(source, 'keep.cfg'), source)
  await migrateDocuments(documents, bothUserData, fs, log)
  assert.equal(await fs.readFile(join(source, 'keep.cfg'), 'utf8'), source)
  assert.equal(documentsRoot(documents, existsSync), target)
  assert.ok(logs.some(line => line.includes('Both Documents')))
} finally { await fs.rm(root, { recursive: true, force: true }) }

// Ensure tested preference stays wired into the embedded PowerShell helper.
const updater = await fs.readFile(new URL('../src/main/appUpdateService.ts', import.meta.url), 'utf8')
assert.ok(updater.includes("@('MT3KLauncher.exe', 'ORBIT.exe')"))
assert.ok(updater.includes('Resolve-LauncherExe $newRoot'))
assert.ok(updater.includes('-OnlyIfRegistered -RefreshManifestOnly'))
console.log('Rename migration: prefixes, JSON, decision table, failures, resume, idempotence, text limits, startup and archive preference passed')
