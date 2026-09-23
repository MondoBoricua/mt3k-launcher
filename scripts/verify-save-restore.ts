import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import {
  buildBackupCatalog,
  parseOrbitBackupManifest,
  planRestoreFromBackup,
  planRestoreRollback,
  refuseBackupDirectoryPath,
  resolveSaveBackupRoot,
  sameOrInside,
  shouldRollbackAfterRestore,
  validateSaveBackupDirectory
} from '../src/shared/saveRestorePolicy.ts'

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
