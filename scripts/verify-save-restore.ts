import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import {
  buildBackupCatalog,
  parseOrbitBackupManifest,
  planRestoreFromBackup,
  planRestoreRollback,
  refuseBackupDirectoryPath,
  resolveSaveBackupRoot,
  restoreBlockedBySession,
  sameOrInside,
  shouldRollbackAfterRestore,
  validateSaveBackupDirectory
} from '../src/shared/saveRestorePolicy.ts'

for (const phase of ['launching', 'running', 'returning']) {
  assert.equal(restoreBlockedBySession('game', { gameId: 'game', phase }), true)
  assert.equal(restoreBlockedBySession('game', { gameId: 'other', phase }), false)
}
for (const phase of ['idle', 'error']) {
  assert.equal(restoreBlockedBySession('game', { gameId: 'game', phase }), false)
}

const saveA = resolve('/games/demo/saves')
const saveB = resolve('/users/mondo/Documents/OtherGame')
const customRoot = resolve('/cloud/mt3k-backups')

assert.equal(sameOrInside('/games/demo', '/games/demo/saves'), true)
assert.equal(sameOrInside('/games/demo/saves', '/games/demo'), false)

const insideSave = validateSaveBackupDirectory(join(saveA, 'nested'), [saveA])
assert.equal(insideSave.ok, false)
if (!insideSave.ok) assert.equal(insideSave.reason, 'inside-save-path')

const saveInsideBackup = validateSaveBackupDirectory(customRoot, [join(customRoot, 'slot')])
assert.equal(saveInsideBackup.ok, false)
if (!saveInsideBackup.ok) assert.equal(saveInsideBackup.reason, 'save-path-inside-directory')

const relativePath = validateSaveBackupDirectory('backups/mt3k', [saveA])
assert.equal(relativePath.ok, false)
if (!relativePath.ok) assert.equal(relativePath.reason, 'relative')

const validPath = validateSaveBackupDirectory(customRoot, [saveA, saveB])
assert.equal(validPath.ok, true)
if (validPath.ok) assert.equal(validPath.normalizedPath, customRoot)

const userData = resolve('/appdata/mt3k')
assert.equal(resolveSaveBackupRoot(userData), join(userData, 'save-backups'))
assert.equal(resolveSaveBackupRoot(userData, customRoot), customRoot)

const manifestRaw = {
  gameId: 'local:abc',
  gameName: 'Demo',
  sourcePath: saveA,
  createdAt: 1_700_000_000_000
}
const manifest = parseOrbitBackupManifest(manifestRaw)
assert.ok(manifest)
assert.equal(parseOrbitBackupManifest({ ...manifestRaw, createdAt: 'nope' }), null)
assert.equal(parseOrbitBackupManifest(null), null)
assert.equal(parseOrbitBackupManifest([]), null)
assert.equal(parseOrbitBackupManifest({ ...manifestRaw, gameId: '' }), null)
assert.equal(parseOrbitBackupManifest({ ...manifestRaw, gameName: '' }), null)
assert.equal(parseOrbitBackupManifest({ ...manifestRaw, sourcePath: '' }), null)
assert.equal(validateSaveBackupDirectory('', []).ok, false)
assert.equal(validateSaveBackupDirectory('/bad\u0000path', []).ok, false)

const catalog = buildBackupCatalog([
  {
    directoryName: '2024-01-02T10-00-00-000Z',
    manifest: { ...manifest!, createdAt: 2 },
    fileCount: 3,
    totalBytes: 900
  },
  {
    directoryName: '2024-01-03T10-00-00-000Z',
    manifest,
    fileCount: 1,
    totalBytes: 120
  },
  {
    directoryName: '2024-01-03T10-00-00-000Z.partial-abc',
    manifest,
    fileCount: 1,
    totalBytes: 50
  }
])
assert.equal(catalog.length, 2)
assert.equal(catalog[0]?.id, '2024-01-03T10-00-00-000Z')
assert.equal(catalog[1]?.createdAt, 2)

const gameRoot = join(customRoot, 'deadbeef')
const backupDir = join(gameRoot, '2024-01-03T10-00-00-000Z')
assert.equal(refuseBackupDirectoryPath(backupDir, gameRoot), null)
assert.equal(refuseBackupDirectoryPath(gameRoot, gameRoot), 'outside-game-root')
assert.equal(refuseBackupDirectoryPath(join(gameRoot, 'a', 'b'), gameRoot), 'outside-game-root')
assert.equal(refuseBackupDirectoryPath('/tmp/evil', gameRoot), 'outside-game-root')
assert.equal(
  refuseBackupDirectoryPath(join(gameRoot, '2024.partial-1'), gameRoot),
  'partial-directory'
)

const filePlan = planRestoreFromBackup({
  manifest: manifest!,
  expectedGameId: 'local:abc',
  backupDirectoryPath: backupDir,
  currentSavePath: saveA,
  payloadName: 'save.dat',
  saveIsDirectory: false
})
assert.ok(typeof filePlan === 'object')
if (typeof filePlan === 'object') {
  assert.equal(filePlan.isDirectory, false)
  assert.equal(filePlan.payloadName, 'save.dat')
}

const directoryPlan = planRestoreFromBackup({
  manifest: manifest!,
  expectedGameId: 'local:abc',
  backupDirectoryPath: backupDir,
  currentSavePath: saveA,
  payloadName: 'saves',
  saveIsDirectory: true
})
assert.ok(typeof directoryPlan === 'object')
if (typeof directoryPlan === 'object') {
  assert.equal(directoryPlan.isDirectory, true)
}

const mismatch = planRestoreFromBackup({
  manifest: manifest!,
  expectedGameId: 'local:other',
  backupDirectoryPath: backupDir,
  currentSavePath: saveA,
  payloadName: 'save.dat',
  saveIsDirectory: false
})
assert.equal(mismatch, 'manifest-game-mismatch')

const rollback = planRestoreRollback({
  safetyBackupDirectory: join(gameRoot, 'safety'),
  safetyPayloadName: 'save.dat',
  destinationPath: saveA,
  isDirectory: false
})
assert.equal(rollback.destinationPath, saveA)
assert.equal(shouldRollbackAfterRestore('failure'), true)
assert.equal(shouldRollbackAfterRestore('success'), false)

console.log('MT3K save restore policy checks passed')

// Exercise the production filesystem transaction without importing Electron.
const { mkdtemp, mkdir, writeFile, readFile, readdir, rename, rm, symlink } = await import('node:fs/promises')
const { tmpdir } = await import('node:os')
const {
  readRestorePayload, copyRestorePayload, resolveRestoreDestination,
  promoteRestore, recoverRestorePath, pathExists, RestorePromotionError
} = await import('../src/main/saveRestoreFiles.ts')
const temp = await mkdtemp(join(tmpdir(), 'mt3k-restore-'))
try {
  const root = join(temp, 'backups')
  const backup = join(root, 'selected')
  const save = join(temp, 'save')
  await mkdir(backup, { recursive: true })
  await mkdir(save)
  await writeFile(join(save, 'slot'), 'original')
  await mkdir(join(backup, 'payload', 'nested'), { recursive: true })
  await writeFile(join(backup, 'payload', 'nested', 'slot'), 'restored')
  const writeManifest = async (extra = {}) => writeFile(join(backup, 'orbit-backup.json'), JSON.stringify({ ...manifestRaw, ...extra }))
  await writeManifest({ payloadName: 'payload', payloadKind: 'directory' })
  await writeFile(join(backup, 'unrelated'), 'not the payload')
  const selected = await readRestorePayload(root, backup, true)
  assert.equal(selected.payloadName, 'payload', 'manifest selects payload despite extra entries')
  await assert.rejects(readRestorePayload(root, backup, false), /kind mismatch/)
  await writeManifest({ payloadName: 'payload', payloadKind: 'file' })
  await assert.rejects(readRestorePayload(root, backup, true), /kind mismatch/)
  await writeManifest()
  await assert.rejects(readRestorePayload(root, backup, true), /Ambiguous/)
  await rm(join(backup, 'unrelated'))
  assert.equal((await readRestorePayload(root, backup, true)).payloadName, 'payload', 'legacy single payload')
  await symlink(save, join(backup, 'payload', 'nested', 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(readRestorePayload(root, backup, true), /link rejected/)
  await assert.rejects(copyRestorePayload(join(backup, 'payload'), join(temp, 'rejected-staging')), /link rejected/)
  await rm(join(backup, 'payload', 'nested', 'escape'))
  await symlink(backup, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(readRestorePayload(root, join(root, 'linked'), true), /link rejected/)
  await assert.rejects(readRestorePayload(root, root, true), /Invalid backup directory/)
  await assert.rejects(readRestorePayload(root, join(root, 'selected', '..'), true), /Invalid backup directory/)
  await symlink(save, join(temp, 'save-link'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(resolveRestoreDestination(join(temp, 'save-link'), root), /link rejected/)
  const destination = await resolveRestoreDestination(save, root)
  const staging = `${destination}.orbit-restore-staging-11111111-1111-4111-8111-111111111111`
  await copyRestorePayload(selected.source, staging)
  let checkCount = 0
  await assert.rejects(promoteRestore(staging, destination, () => { checkCount++; throw new Error('running') }), /running/)
  assert.equal(checkCount, 1)
  assert.equal(await readFile(join(save, 'slot'), 'utf8'), 'original')
  await assert.rejects(promoteRestore(staging, destination, () => {}, {
    rename: async (from, to) => {
      if (from === staging) throw new Error('injected promotion failure')
      await rename(from, to)
    }, rm
  }), (error: unknown) => error instanceof RestorePromotionError && !error.rollbackFailed)
  assert.equal(await readFile(join(save, 'slot'), 'utf8'), 'original', 'failed promotion returns previous tree')
  assert.equal((await readdir(temp)).some(name => name.includes('.orbit-restore-prev-')), false)

  // Simulate a rename that took effect before reporting failure: only that staging may be removed.
  await assert.rejects(promoteRestore(staging, destination, () => {}, {
    rename: async (from, to) => {
      await rename(from, to)
      if (from === staging) throw new Error('promotion reported failure after moving')
    }, rm
  }), (error: unknown) => error instanceof RestorePromotionError && !error.rollbackFailed)
  assert.equal(await readFile(join(save, 'slot'), 'utf8'), 'original')

  await copyRestorePayload(selected.source, staging)
  assert.equal(await promoteRestore(staging, destination, () => {}, {
    rename, rm: async () => { throw new Error('injected cleanup failure') }
  }), 'cleanup-failed')
  assert.equal(await readFile(join(save, 'nested', 'slot'), 'utf8'), 'restored')
  const previous = (await readdir(temp)).find(name => name.includes('.orbit-restore-prev-'))!
  assert.equal(await readFile(join(temp, previous, 'slot'), 'utf8'), 'original')
  // An interrupted transaction left the original aside and an unfinished staging tree.
  await rm(save, { recursive: true })
  await mkdir(staging)
  await writeFile(join(staging, 'partial'), 'unfinished')
  await recoverRestorePath(save)
  assert.equal(await readFile(join(save, 'slot'), 'utf8'), 'original')
  assert.equal(await pathExists(staging), false)
  assert.equal(await pathExists(join(temp, previous)), false)
  await recoverRestorePath(save) // Idempotent startup recovery.

  // Ordinary file saves and successful promotion/cleanup.
  const fileBackup = join(root, 'file')
  const fileSave = join(temp, 'save.dat')
  await mkdir(fileBackup)
  await writeFile(fileSave, 'old-file')
  await writeFile(join(fileBackup, 'renamed.dat'), 'new-file')
  await writeFile(join(fileBackup, 'orbit-backup.json'), JSON.stringify({ ...manifestRaw, payloadName: 'renamed.dat', payloadKind: 'file' }))
  const filePayload = await readRestorePayload(root, fileBackup, false)
  const fileStaging = `${fileSave}.orbit-restore-staging-22222222-2222-4222-8222-222222222222`
  await copyRestorePayload(filePayload.source, fileStaging)
  assert.equal(await promoteRestore(fileStaging, fileSave, () => {}), 'success')
  assert.equal(await readFile(fileSave, 'utf8'), 'new-file')
  await assert.rejects(readRestorePayload(root, fileBackup, true), /kind mismatch/)

  // A failed rollback preserves the previous save and an unrelated destination.
  const blockedSave = join(temp, 'blocked')
  const blockedStaging = `${blockedSave}.orbit-restore-staging-33333333-3333-4333-8333-333333333333`
  await mkdir(blockedSave)
  await writeFile(join(blockedSave, 'slot'), 'must-survive')
  await copyRestorePayload(selected.source, blockedStaging)
  await assert.rejects(promoteRestore(blockedStaging, blockedSave, () => {}, {
    rename: async (from, to) => {
      if (from === blockedStaging) {
        await mkdir(blockedSave)
        await writeFile(join(blockedSave, 'foreign'), 'do-not-delete')
        throw new Error('destination appeared')
      }
      await rename(from, to)
    }, rm
  }), (error: unknown) => error instanceof RestorePromotionError && error.rollbackFailed)
  assert.equal(await readFile(join(blockedSave, 'foreign'), 'utf8'), 'do-not-delete')
  const blockedPrevious = (await readdir(temp)).find(name => name.startsWith('blocked.orbit-restore-prev-'))!
  assert.equal(await readFile(join(temp, blockedPrevious, 'slot'), 'utf8'), 'must-survive')
  await rm(blockedSave, { recursive: true })
  await recoverRestorePath(blockedSave)
  assert.equal(await readFile(join(blockedSave, 'slot'), 'utf8'), 'must-survive')

  // Safety backups use the identical strict reader before any possible rollback use.
  await symlink(save, join(fileBackup, 'unsafe'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(readRestorePayload(root, fileBackup, false), /link rejected/)
  assert.equal(parseOrbitBackupManifest({ ...manifestRaw, payloadName: '../escape', payloadKind: 'file' }), null)
  assert.equal(parseOrbitBackupManifest({ ...manifestRaw, payloadName: 'slot' }), null)
  console.log('MT3K save restore filesystem checks passed')
} finally {
  await rm(temp, { recursive: true, force: true })
}
