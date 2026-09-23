import { createHash, randomUUID } from 'node:crypto'
import {
  access,
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm
} from 'node:fs/promises'
import { basename, join } from 'node:path'
import { constants as fsConstants } from 'node:fs'
import { app, dialog, type BrowserWindow } from 'electron'
import type {
  GameLaunchStatus,
  LibraryGame,
  LocalGameBackupEntry,
  LocalGameRestoreResult,
  SaveBackupDirectoryStatus
} from '@shared/ipc'
import {
  buildBackupCatalog,
  parseOrbitBackupManifest,
  planRestoreFromBackup,
  planRestoreRollback,
  refuseBackupDirectoryPath,
  resolveSaveBackupRoot,
  sameOrInside,
  validateSaveBackupDirectory,
  type OrbitBackupManifest
} from '@shared/saveRestorePolicy'
import { t } from './i18n'
import { gameRepository } from './library/gameRepository'
import { settingsStore } from './settingsStore'
import type { CustomLibraryService } from './customLibrary'

const MANIFEST_FILE = 'orbit-backup.json'

function safeBackupDirectoryName(game: LibraryGame): string {
  return createHash('sha256').update(game.id).digest('hex').slice(0, 24)
}

function collectLocalSavePaths(): string[] {
  return gameRepository
    .getGamesByProvider('local')
    .map((game) => game.local?.savePath?.trim())
    .filter((path): path is string => Boolean(path))
}

export function readSaveBackupDirectoryStatus(): SaveBackupDirectoryStatus {
  const configured = settingsStore.store.saveBackupDirectory?.trim()
  const userData = app.getPath('userData')
  const effectivePath = resolveSaveBackupRoot(userData, configured)
  return {
    configuredPath: configured || undefined,
    effectivePath,
    isDefault: !configured
  }
}

async function assertDirectoryWritable(directoryPath: string): Promise<void> {
  await access(directoryPath, fsConstants.W_OK)
}

export async function chooseSaveBackupDirectory(
  mainWindow: BrowserWindow
): Promise<SaveBackupDirectoryStatus | null> {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: t('MT3K Launcher · Choose save backup folder'),
    buttonLabel: t('Use this folder'),
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || !result.filePaths[0]) return null

  const resolved = await realpath(result.filePaths[0])
  const validation = validateSaveBackupDirectory(resolved, collectLocalSavePaths())
  if (!validation.ok) {
    throw new Error(t('The selected folder cannot be used for save backups.'))
  }

  try {
    await assertDirectoryWritable(validation.normalizedPath)
  } catch {
    throw new Error(t('The selected folder is not writable.'))
  }

  settingsStore.set('saveBackupDirectory', validation.normalizedPath)
  return readSaveBackupDirectoryStatus()
}

export function clearSaveBackupDirectory(): SaveBackupDirectoryStatus {
  settingsStore.delete('saveBackupDirectory')
  return readSaveBackupDirectoryStatus()
}

async function gameBackupRoot(game: LibraryGame): Promise<string> {
  const userData = app.getPath('userData')
  const root = resolveSaveBackupRoot(userData, settingsStore.store.saveBackupDirectory)
  return join(root, safeBackupDirectoryName(game))
}

async function summarizeBackupDirectory(directoryPath: string): Promise<{
  manifest: OrbitBackupManifest | null
  fileCount: number
  totalBytes: number
  payloadName?: string
}> {
  let manifest: OrbitBackupManifest | null = null
  let fileCount = 0
  let totalBytes = 0
  let payloadName: string | undefined

  const entries = await readdir(directoryPath, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name)
    if (entry.name === MANIFEST_FILE) {
      try {
        const raw = JSON.parse(await readFile(entryPath, 'utf8')) as unknown
        manifest = parseOrbitBackupManifest(raw)
      } catch {
        manifest = null
      }
      continue
    }

    const info = await lstat(entryPath)
    if (info.isSymbolicLink()) continue
    fileCount += 1
    if (info.isFile()) {
      totalBytes += info.size
      if (!payloadName) payloadName = entry.name
    } else if (info.isDirectory()) {
      totalBytes += await directoryByteSize(entryPath)
      if (!payloadName) payloadName = entry.name
    }
  }

  return { manifest, fileCount, totalBytes, payloadName }
}

async function directoryByteSize(directoryPath: string): Promise<number> {
  let total = 0
  const entries = await readdir(directoryPath, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name)
    const info = await lstat(entryPath)
    if (info.isSymbolicLink()) continue
    if (info.isFile()) total += info.size
    else if (info.isDirectory()) total += await directoryByteSize(entryPath)
  }
  return total
}

export async function listLocalGameBackups(game: LibraryGame): Promise<LocalGameBackupEntry[]> {
  const backupRoot = await gameBackupRoot(game)
  let entries
  try {
    entries = await readdir(backupRoot, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return []
  }

  const catalogs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const directoryPath = join(backupRoot, entry.name)
        const summary = await summarizeBackupDirectory(directoryPath)
        return {
          directoryName: entry.name,
          manifest: summary.manifest,
          fileCount: summary.fileCount,
          totalBytes: summary.totalBytes
        }
      })
  )

  return buildBackupCatalog(catalogs)
}

async function assertPayloadInsideBackup(
  backupDirectoryPath: string,
  payloadName: string
): Promise<void> {
  const payloadPath = join(backupDirectoryPath, payloadName)
  const resolvedPayload = await lstat(payloadPath)
  if (resolvedPayload.isSymbolicLink()) {
    throw new Error('Backup payload symlink rejected')
  }
  if (!sameOrInside(backupDirectoryPath, payloadPath)) {
    throw new Error('Backup payload escapes backup folder')
  }
}

async function copyPayloadToStaging(
  sourcePath: string,
  stagingPath: string,
  isDirectory: boolean
): Promise<void> {
  await rm(stagingPath, { recursive: true, force: true })
  if (isDirectory) {
    await cp(sourcePath, stagingPath, {
      recursive: true,
      force: true,
      errorOnExist: false,
      verbatimSymlinks: true
    })
  } else {
    await mkdir(join(stagingPath, '..'), { recursive: true })
    await copyFile(sourcePath, stagingPath)
  }
}

async function promoteStagingToDestination(
  stagingPath: string,
  destinationPath: string,
  isDirectory: boolean
): Promise<void> {
  const backupLabel = `.orbit-restore-prev-${randomUUID()}`
  const previousPath = isDirectory
    ? `${destinationPath}${backupLabel}`
    : `${destinationPath}.orbit-restore-prev-${randomUUID()}`

  try {
    await rename(destinationPath, previousPath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw error
  }

  try {
    await rename(stagingPath, destinationPath)
    await rm(previousPath, { recursive: true, force: true })
  } catch (error) {
    try {
      await rm(destinationPath, { recursive: true, force: true })
      await rename(previousPath, destinationPath)
    } catch (rollbackError) {
      console.warn('[save-restore] Failed to roll back botched restore promotion', rollbackError)
    }
    throw error
  }
}

async function applySafetyBackupRollback(plan: ReturnType<typeof planRestoreRollback>): Promise<void> {
  const payloadSource = join(plan.safetyBackupDirectory, plan.safetyPayloadName)
  const stagingPath = plan.isDirectory
    ? `${plan.destinationPath}.orbit-restore-safety-${randomUUID()}`
    : `${plan.destinationPath}.orbit-restore-safety-${randomUUID()}`
  await copyPayloadToStaging(payloadSource, stagingPath, plan.isDirectory)
  await promoteStagingToDestination(stagingPath, plan.destinationPath, plan.isDirectory)
}

export async function restoreLocalGameBackup(
  game: LibraryGame,
  backupId: string,
  launchStatus: GameLaunchStatus,
  customLibraryService: CustomLibraryService
): Promise<LocalGameRestoreResult> {
  const completedAt = Date.now()
  if (launchStatus.gameId === game.id && launchStatus.phase !== 'idle') {
    console.warn('[save-restore] Restore refused while game session is active')
    return { state: 'failed', completedAt, reason: 'game-running' }
  }

  const local = game.local
  if (game.provider !== 'local' || !local?.savePath) {
    return { state: 'failed', completedAt, reason: 'invalid-game' }
  }

  const backupRoot = await gameBackupRoot(game)
  const backupDirectoryPath = join(backupRoot, backupId.trim())
  const refusal = refuseBackupDirectoryPath(backupDirectoryPath, backupRoot)
  if (refusal) {
    console.warn('[save-restore] Backup path refused', refusal)
    return { state: 'failed', completedAt, reason: 'invalid-backup' }
  }

  const summary = await summarizeBackupDirectory(backupDirectoryPath)
  if (!summary.manifest || !summary.payloadName) {
    return { state: 'failed', completedAt, reason: 'invalid-backup' }
  }

  let saveInfo
  try {
    saveInfo = await lstat(local.savePath)
  } catch {
    return { state: 'failed', completedAt, reason: 'invalid-game' }
  }

  const plan = planRestoreFromBackup({
    manifest: summary.manifest,
    expectedGameId: game.id,
    backupDirectoryPath,
    currentSavePath: local.savePath,
    payloadName: summary.payloadName,
    saveIsDirectory: saveInfo.isDirectory()
  })
  if (typeof plan === 'string') {
    console.warn('[save-restore] Restore plan failed', plan)
    return { state: 'failed', completedAt, reason: 'invalid-backup' }
  }

  const safetyResult = await customLibraryService.backup(game)
  if (safetyResult.state !== 'success' || !safetyResult.backupPath) {
    console.warn('[save-restore] Safety backup failed before restore')
    return { state: 'failed', completedAt, reason: 'safety-backup-failed' }
  }

  const safetySummary = await summarizeBackupDirectory(safetyResult.backupPath)
  if (!safetySummary.payloadName) {
    return { state: 'failed', completedAt, reason: 'safety-backup-failed' }
  }

  const payloadSource = join(plan.backupDirectoryPath, plan.payloadName)
  const stagingPath = plan.isDirectory
    ? `${plan.destinationPath}.orbit-restore-staging-${randomUUID()}`
    : `${plan.destinationPath}.orbit-restore-staging-${randomUUID()}`

  try {
    await assertPayloadInsideBackup(plan.backupDirectoryPath, plan.payloadName)
    await copyPayloadToStaging(payloadSource, stagingPath, plan.isDirectory)
    await promoteStagingToDestination(stagingPath, plan.destinationPath, plan.isDirectory)
  } catch (error) {
    console.warn('[save-restore] Restore failed; rolling back to safety backup', error)
    try {
      await applySafetyBackupRollback(
        planRestoreRollback({
          safetyBackupDirectory: safetyResult.backupPath,
          safetyPayloadName: safetySummary.payloadName,
          destinationPath: plan.destinationPath,
          isDirectory: plan.isDirectory
        })
      )
    } catch (rollbackError) {
      console.warn('[save-restore] Safety rollback failed', rollbackError)
      return { state: 'failed', completedAt, reason: 'rollback-failed' }
    }
    return { state: 'failed', completedAt, reason: 'restore-failed' }
  }

  return {
    state: 'success',
    completedAt,
    safetyBackupId: basename(safetyResult.backupPath)
  }
}

export function resolveGameBackupRootForTests(
  userDataPath: string,
  game: LibraryGame,
  configuredDirectory?: string
): string {
  const root = resolveSaveBackupRoot(userDataPath, configuredDirectory)
  return join(root, safeBackupDirectoryName(game))
}
