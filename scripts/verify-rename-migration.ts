import { launchXboxManifestRefresh } from '../src/main/xboxManifestRefreshPolicy.ts'
import { getOrbitBackgroundServiceLoginItemInstallation } from '../src/main/orbitBackgroundServiceLoginItem.ts'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as fs from 'node:fs/promises'
import * as syncFs from 'node:fs'
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
assert.equal(rewritePathPrefixes('file://C:/Users/Pana%20Gamer/OneDrive/Documents/ORBIT/a', old, next, true), 'file://C:/Users/Pana%20Gamer/OneDrive/Documents/MT3K%20Launcher/a')
assert.equal(rewritePathPrefixes('C:/Users/Pana%20Gamer/OneDrive/Documents/ORBIT/a', old, next, true), 'C:/Users/Pana%20Gamer/OneDrive/Documents/MT3K%20Launcher/a')
assert.equal(rewritePathPrefixes('file:///C:/Users/A/Documents/ORBIT/a', String.raw`C:\Users\A\Documents\ORBIT`, String.raw`C:\Users\A\Documents\MT3K Launcher`, true), 'file:///C:/Users/A/Documents/MT3K%20Launcher/a')
for (const suffix of [',', ')']) assert.equal(rewritePathPrefixes(old + suffix, old, next, true), next + suffix)
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
  const result = migrateUserData('old', 'new', { existsSync: p => p === 'old' ? oldExists : newExists, rmdirSync: () => undefined, renameSync: () => { calls++ } })
  assert.equal(result.status, status); assert.equal(result.path, path)
  assert.equal(calls, oldExists && !newExists ? 1 : 0)
}
for (const code of ['EPERM', 'EXDEV', 'EACCES', 'EBUSY']) {
  const result = migrateUserData('old', 'new', { existsSync: p => p === 'old', rmdirSync: () => undefined, renameSync: () => { throw new Error(code) } })
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
  // Reappearance of ORBIT must not abandon the unfinished new tree.
  await fs.mkdir(source, { recursive: true })
  await fs.writeFile(join(source, 'untouched.cfg'), source)
  await migrateDocuments(documents, userData, fs, log)
  assert.equal(JSON.parse(await fs.readFile(journalPath, 'utf8')).complete, false, 'undecodable and oversized configs must block completion')
  await fs.unlink(join(target, 'bad.cfg'))
  await fs.unlink(join(target, 'large.txt'))
  await migrateDocuments(documents, userData, fs, log)
  assert.equal(await fs.readFile(join(source, 'untouched.cfg'), 'utf8'), source)
  const journal = JSON.parse(await fs.readFile(journalPath, 'utf8'))
  assert.equal(journal.complete, true)
  assert.equal(journal.rewrittenCount, 2)
  assert.equal(journal.skipped.length, 0)
  assert.equal(JSON.parse(await fs.readFile(join(userData, 'orbit-settings.json'), 'utf8')).corePath, target + '/Emulators/core')
  assert.equal(await fs.readFile(join(target, 'Emulators', 'retroarch.cfg'), 'utf8'), `core_directory = "${target}/Emulators"`)
  const snapshot = await fs.readFile(journalPath, 'utf8')
  await migrateDocuments(documents, userData, fs, log)
  assert.equal(await fs.readFile(journalPath, 'utf8'), snapshot, 'completed migration is a no-op')
  // Both directories: never merge or rewrite the old tree.
  const bothUserData = join(root, 'both-user'); await fs.mkdir(bothUserData)
  await fs.mkdir(source, { recursive: true })
  await fs.writeFile(join(source, 'keep.cfg'), source)
  await migrateDocuments(documents, bothUserData, fs, log)
  assert.equal(await fs.readFile(join(source, 'keep.cfg'), 'utf8'), source)
  assert.equal(documentsRoot(documents, existsSync), target)
  assert.ok(logs.some(line => line.includes('Both Documents')))

  // Both marker selection and double-start behavior run against the real fs.
  for (const kind of ['empty', 'stale', 'real'] as const) {
    const parent = join(root, `profile-${kind}`)
    const legacy = join(parent, 'ORBIT'); const modern = join(parent, 'MT3K Launcher')
    await fs.mkdir(legacy, { recursive: true }); await fs.mkdir(modern)
    await fs.writeFile(join(legacy, 'orbit-library-v2.json'), '{}')
    if (kind !== 'empty') await fs.writeFile(join(modern, kind === 'real' ? 'orbit-settings.json' : 'cache'), 'preserve')
    const result = migrateUserData(legacy, modern, syncFs)
    assert.equal(result.path, kind === 'stale' ? legacy : modern)
    assert.equal(result.status, kind === 'empty' ? 'moved' : kind === 'stale' ? 'stale-target-old-library-retained' : 'both-exist-old-left-in-place')
  }
  let raced = false
  const race = migrateUserData('legacy', 'modern', {
    existsSync: p => p === 'legacy' ? !raced : raced,
    rmdirSync: () => undefined,
    renameSync: () => { raced = true; throw Object.assign(new Error('another process won'), { code: 'ENOENT' }) }
  })
  assert.equal(race.path, 'modern')
  assert.equal(race.status, 'concurrent-move')
  for (const kind of ['empty', 'stale', 'real'] as const) {
    const docs = join(root, `docs-${kind}`); const data = join(root, `data-${kind}`)
    const legacy = join(docs, 'ORBIT'); const modern = join(docs, 'MT3K Launcher')
    await fs.mkdir(join(legacy, 'ROMs'), { recursive: true }); await fs.mkdir(modern); await fs.mkdir(data)
    if (kind === 'real') await fs.mkdir(join(modern, 'Emulators'))
    if (kind === 'stale') await fs.writeFile(join(modern, 'cache'), 'preserve')
    assert.equal(documentsRoot(docs, existsSync), kind === 'real' ? modern : legacy)
    for (let i = 0; i < 2; i++) await migrateDocuments(docs, data, fs, log)
    assert.equal(documentsRoot(docs, existsSync), kind === 'stale' ? legacy : modern)
    assert.equal(existsSync(legacy), kind !== 'empty')
  }
  // Round 2: durable intent must never override the library markers on disk.
  for (const intent of ['movePending', 'moved', 'rewriteDocuments'] as const) {
    for (const blocked of [false, true]) {
      const docs = join(root, `planted-${intent}-${blocked}`)
      const data = join(root, `planted-data-${intent}-${blocked}`)
      const legacy = join(docs, 'ORBIT'); const modern = join(docs, 'MT3K Launcher')
      await fs.mkdir(join(legacy, 'ROMs'), { recursive: true })
      await fs.mkdir(modern)
      await fs.mkdir(join(data, 'migrations'), { recursive: true })
      await fs.writeFile(join(legacy, 'ROMs', 'game.cfg'), legacy + '/ROMs')
      if (blocked) await fs.writeFile(join(modern, 'cache'), 'preserve')
      const settings = join(data, 'orbit-settings.json')
      await fs.writeFile(settings, JSON.stringify({ corePath: legacy + '/ROMs' }))
      const journalFile = join(data, 'migrations', 'documents-folder.json')
      await fs.writeFile(journalFile, JSON.stringify({
        version: 2, oldPath: legacy, newPath: modern, moved: false, complete: false,
        rewritten: [], skipped: [], errors: [], rewrittenCount: 0, [intent]: true
      }))
      await migrateDocuments(docs, data, fs, log)
      assert.equal(JSON.parse(await fs.readFile(settings, 'utf8')).corePath,
        (blocked ? legacy : modern) + '/ROMs', `planted ${intent}: settings follow the library`)
      assert.equal(JSON.parse(await fs.readFile(journalFile, 'utf8')).complete, !blocked)
      assert.equal(documentsRoot(docs, existsSync), blocked ? legacy : modern)
      assert.equal(existsSync(join(blocked ? legacy : modern, 'ROMs', 'game.cfg')), true)
      if (blocked) {
        await fs.unlink(join(modern, 'cache'))
        await migrateDocuments(docs, data, fs, log)
        assert.equal(JSON.parse(await fs.readFile(journalFile, 'utf8')).complete, true)
        assert.equal(existsSync(legacy), false, 'retry removes empty target and moves the library')
      }
    }
  }
  // A real successful move can be followed by loss of destination markers.
  const lostDocs = join(root, 'lost-markers'); const lostData = join(root, 'lost-data')
  const lostOld = join(lostDocs, 'ORBIT'); const lostNew = join(lostDocs, 'MT3K Launcher')
  await fs.mkdir(join(lostOld, 'ROMs'), { recursive: true }); await fs.mkdir(lostData)
  const lostSettings = join(lostData, 'orbit-settings.json')
  await fs.writeFile(lostSettings, JSON.stringify({ corePath: lostOld + '/ROMs' }))
  await migrateDocuments(lostDocs, lostData, { ...fs, rename: async (a, b) => {
    if (b === lostSettings) throw new Error('store locked after successful move')
    return fs.rename(a, b)
  } }, log)
  const lostJournal = join(lostData, 'migrations', 'documents-folder.json')
  assert.equal(JSON.parse(await fs.readFile(lostJournal, 'utf8')).moved, true)
  assert.equal(JSON.parse(await fs.readFile(lostJournal, 'utf8')).complete, false)
  await fs.rmdir(join(lostNew, 'ROMs'))
  await fs.writeFile(join(lostNew, 'cache'), 'preserve')
  await fs.mkdir(join(lostOld, 'ROMs'), { recursive: true })
  await migrateDocuments(lostDocs, lostData, fs, log)
  assert.equal(JSON.parse(await fs.readFile(lostSettings, 'utf8')).corePath, lostOld + '/ROMs')
  assert.equal(JSON.parse(await fs.readFile(lostJournal, 'utf8')).complete, false)
  assert.equal(documentsRoot(lostDocs, existsSync), lostOld)
  // Remove only the known failed atomic-write fixture; the next retry can move.
  await fs.unlink(join(lostData, 'orbit-settings.json.mt3k-migration.tmp'))
  await fs.unlink(join(lostNew, 'cache'))
  await migrateDocuments(lostDocs, lostData, fs, log)
  assert.equal(JSON.parse(await fs.readFile(lostJournal, 'utf8')).complete, true)
  assert.equal(existsSync(lostOld), false)
  console.log('Round 2: planted movePending/moved/rewriteDocuments journals preserve the library and retry stale targets')
  // Record the requested symlink type: POSIX itself ignores it, Windows does not.
  for (const windows of [false, true]) {
    const docs = join(root, `missing-link-${windows}`); const data = join(root, `missing-link-data-${windows}`)
    const legacy = join(docs, 'ORBIT'); const modern = join(docs, 'MT3K Launcher')
    await fs.mkdir(join(legacy, 'ROMs'), { recursive: true }); await fs.mkdir(data)
    await fs.symlink(join(legacy, 'ROMs', 'unavailable'), join(legacy, 'cores'), 'junction')
    const kinds: unknown[] = []
    let deny = true
    const linkFs = { ...fs, symlink: async (...args: Parameters<typeof fs.symlink>) => {
      kinds.push(args[2])
      if (deny) throw new Error('denied directory link recreation')
      return fs.symlink(...args)
    } }
    await migrateDocuments(docs, data, linkFs, log, windows)
    const journalFile = join(data, 'migrations', 'documents-folder.json')
    assert.equal(JSON.parse(await fs.readFile(journalFile, 'utf8')).complete, false)
    assert.equal(await fs.readlink(join(modern, 'cores')), join(legacy, 'ROMs', 'unavailable'))
    deny = false
    await migrateDocuments(docs, data, linkFs, log, windows)
    assert.ok(kinds.length >= 2)
    assert.ok(kinds.every(kind => kind === (windows ? 'junction' : 'dir')), 'unavailable directory target must not become a file symlink')
    assert.equal(await fs.readlink(join(modern, 'cores')), join(modern, 'ROMs', 'unavailable'))
    assert.equal(JSON.parse(await fs.readFile(journalFile, 'utf8')).complete, true)
  }
  console.log('Round 2: unavailable directory links keep their type; failed recreation remains retryable')
  const dualDocs = join(root, 'dual-docs'); const dualData = join(root, 'dual-profile', 'MT3K Launcher')
  const oldData = join(root, 'dual-profile', 'ORBIT')
  const oldDocs = join(dualDocs, 'ORBIT'); const newDocs = join(dualDocs, 'MT3K Launcher')
  await fs.mkdir(join(oldDocs, 'ROMs'), { recursive: true }); await fs.mkdir(dualData, { recursive: true })
  const dualStore = join(dualData, 'orbit-settings.json')
  await fs.writeFile(dualStore, JSON.stringify({ roaming: oldData + '/artwork', documents: oldDocs + '/ROMs' }).replaceAll('/', '\\/'))
  await fs.writeFile(join(oldDocs, 'paths.cfg'), oldData + '/artwork\n' + oldDocs + '/ROMs')
  await fs.symlink(join(oldDocs, 'paths.cfg'), join(oldDocs, 'absolute.cfg'), 'file')
  await fs.symlink(join(oldDocs, 'ROMs'), join(oldDocs, 'absolute-directory'), 'junction')
  await fs.symlink('paths.cfg', join(oldDocs, 'relative.cfg'), 'file')
  const outside = join(root, 'outside'); await fs.mkdir(outside)
  await fs.writeFile(join(outside, 'untouched.cfg'), oldDocs)
  await fs.symlink(outside, join(oldDocs, 'outside'), 'junction')
  let interruptLink = true
  const linkInterruptedFs = { ...fs, rename: async (from: Parameters<typeof fs.rename>[0], to: Parameters<typeof fs.rename>[1]) => {
    if (String(to).endsWith('absolute-directory') && interruptLink) { interruptLink = false; throw new Error('interrupted link replacement') }
    return fs.rename(from, to)
  } }
  await migrateDocuments(dualDocs, dualData, linkInterruptedFs, log)
  const linkJournal = JSON.parse(await fs.readFile(join(dualData, 'migrations', 'documents-folder.json'), 'utf8'))
  assert.equal(linkJournal.complete, false)
  assert.equal(linkJournal.links.length, 1)
  await migrateDocuments(dualDocs, dualData, fs, log)
  assert.equal(JSON.parse(await fs.readFile(join(dualData, 'migrations', 'documents-folder.json'), 'utf8')).complete, true)
  assert.deepEqual(JSON.parse(await fs.readFile(dualStore, 'utf8')), { roaming: dualData + '/artwork', documents: newDocs + '/ROMs' })
  assert.equal(await fs.readlink(join(newDocs, 'absolute.cfg')), join(newDocs, 'paths.cfg'))
  assert.equal((await fs.stat(join(newDocs, 'absolute-directory'))).isDirectory(), true)
  assert.equal(await fs.readlink(join(newDocs, 'relative.cfg')), 'paths.cfg')
  assert.equal(await fs.readFile(join(outside, 'untouched.cfg'), 'utf8'), oldDocs)
  // Unhandled mixed separators must be reported, never silently completed.
  const residual = oldDocs.replaceAll('\\', '/').replace('/ORBIT', '\\ORBIT') + '/ROMs'
  await fs.writeFile(join(newDocs, 'mixed.cfg'), residual)
  const dualJournal = join(dualData, 'migrations', 'documents-folder.json')
  const pending = JSON.parse(await fs.readFile(dualJournal, 'utf8')); pending.complete = false
  await fs.writeFile(dualJournal, JSON.stringify(pending))
  await migrateDocuments(dualDocs, dualData, fs, log)
  assert.equal(JSON.parse(await fs.readFile(dualJournal, 'utf8')).complete, false)
  assert.match(JSON.parse(await fs.readFile(dualJournal, 'utf8')).errors.join(), /Unresolved old prefix/)
  // A resumed new-only tree may have no recorded move (crash or manual rename).
  const resumeDocs = join(root, 'resume-docs'); const resumeData = join(root, 'resume-data')
  const resumeOld = join(resumeDocs, 'ORBIT'); const resumeNew = join(resumeDocs, 'MT3K Launcher')
  await fs.mkdir(join(resumeNew, 'ROMs'), { recursive: true }); await fs.mkdir(resumeData)
  await fs.writeFile(join(resumeNew, 'locked.cfg'), resumeOld + '/ROMs')
  const lockedFs = { ...fs, rename: async (from: Parameters<typeof fs.rename>[0], to: Parameters<typeof fs.rename>[1]) => {
    if (String(to).endsWith('locked.cfg')) throw new Error('locked config')
    return fs.rename(from, to)
  } }
  await migrateDocuments(resumeDocs, resumeData, lockedFs, log)
  await fs.mkdir(join(resumeOld, 'ROMs'), { recursive: true })
  await migrateDocuments(resumeDocs, resumeData, fs, log)
  assert.equal(await fs.readFile(join(resumeNew, 'locked.cfg'), 'utf8'), resumeNew + '/ROMs')
  assert.equal(JSON.parse(await fs.readFile(join(resumeData, 'migrations', 'documents-folder.json'), 'utf8')).complete, true)
  const linkDocs = join(root, 'link-docs'); const linkData = join(root, 'link-data')
  await fs.mkdir(linkDocs); await fs.mkdir(linkData)
  await fs.symlink(outside, join(linkDocs, 'ORBIT'), 'junction')
  await migrateDocuments(linkDocs, linkData, fs, log)
  assert.equal(existsSync(join(linkDocs, 'ORBIT')), false)
  assert.equal((await fs.lstat(join(linkDocs, 'MT3K Launcher'))).isSymbolicLink(), true)
  assert.equal(await fs.readFile(join(outside, 'untouched.cfg'), 'utf8'), oldDocs)
} finally { await fs.rm(root, { recursive: true, force: true }) }

// Ensure tested preference stays wired into the embedded PowerShell helper.
const updater = await fs.readFile(new URL('../src/main/appUpdateService.ts', import.meta.url), 'utf8')
assert.ok(updater.includes("@('MT3KLauncher.exe', 'ORBIT.exe')"))
assert.ok(updater.includes('Resolve-LauncherExe $newRoot'))
assert.ok(updater.includes('-OnlyIfRegistered -RefreshManifestOnly'))
console.log('Rename migration: prefixes, JSON, decision table, failures, resume, idempotence, text limits, startup and archive preference passed')

const unrelatedService = { ...expected, name: 'ORBIT Background Service', path: 'C:\\Old\\ORBIT.exe', enabled: true, args: ['orbit-background-agent'] }
const launcherRows = startupLoginItemsNeedingMigration([{ ...expected, name: 'ORBIT', enabled: false }, unrelatedService], expected)
assert.equal(launcherRows.length, 1)
assert.equal(launcherRows.some(item => item.enabled), false)
assert.equal(startupLoginItemsNeedingMigration([unrelatedService], expected).length, 0)
const refreshSource = await fs.readFile(new URL('../src/main/xboxManifestRefresh.ts', import.meta.url), 'utf8')
assert.ok(refreshSource.includes("await access(join(root, 'app', 'manifest-refresh.failed'))"))
assert.ok(!refreshSource.includes('unlink('))
let quits = 0
for (const stdout of ['', '0', 'invalid']) {
  await assert.rejects(launchXboxManifestRefresh(async () => ({ stdout }), () => { quits++ }))
}
await assert.rejects(launchXboxManifestRefresh(async () => { throw new Error('WMI failed') }, () => { quits++ }))
assert.equal(quits, 0)
await launchXboxManifestRefresh(async () => ({ stdout: '12345\n' }), () => { quits++ })
assert.equal(quits, 1)
const servicePath = String.raw`C:\Program Files\MT3K Launcher\MT3KLauncher.exe`
const lookups: string[] = []
const serviceStatus = getOrbitBackgroundServiceLoginItemInstallation({
  getLoginItemSettings: (options) => {
    lookups.push(options!.path!)
    return { openAtLogin: false, executableWillLaunchAtLogin: false, launchItems:
      options!.path!.endsWith('ORBIT.exe"') ? [{ ...unrelatedService, scope: 'user' }] : [] } as never
  }
}, servicePath)
assert.deepEqual(serviceStatus, { installation: 'repair-needed', reason: 'configuration-mismatch' })
assert.ok(lookups.every(path => path.startsWith('"') && path.endsWith('"')))
const managerSource = await fs.readFile(new URL('../src/main/orbitBackgroundServiceManager.ts', import.meta.url), 'utf8')
assert.ok(managerSource.includes("status.reason === 'configuration-mismatch'"))
assert.ok(managerSource.includes("await this.control('repair')"))
assert.ok(managerSource.includes('path: process.execPath'))
const installer = await fs.readFile(new URL('../build/installer.nsh', import.meta.url), 'utf8')
assert.ok(installer.indexOf('StrCpy $R6 "$INSTDIR\\MT3KLauncher.exe"') < installer.indexOf('StrCpy $R6 "$INSTDIR\\ORBIT.exe"'))
assert.ok(installer.includes('GetAssemblyName($$env:MT3K_SHUTDOWN_EXE)'))
assert.ok(installer.includes('StrCmp $0 10 orbit_background_shutdown_done'))
assert.ok(installer.includes('StrCmp $0 0 orbit_background_shutdown_start orbit_background_shutdown_failed'))
const workflow = await fs.readFile(new URL('../.github/workflows/build-windows.yml', import.meta.url), 'utf8')
assert.ok(workflow.includes(String.raw`/out:build\mt3k-compat\ORBIT.exe scripts\mt3k\LegacyLauncher.cs`))
for (const gate of ['run verify:rename-migration', 'pwsh -NoProfile -File scripts/windows/Verify-Mt3kRenameScripts.ps1']) {
  assert.ok(workflow.indexOf(gate) > 0 && workflow.indexOf(gate) < workflow.indexOf('Package unsigned NSIS installer'))
}
console.log('Review regressions passed: incomplete journal, library markers, race, dual prefixes, residuals, symlinks, service isolation, Xbox marker, NSIS and CI')
