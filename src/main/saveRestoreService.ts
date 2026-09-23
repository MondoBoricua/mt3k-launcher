import { createHash, randomUUID } from 'node:crypto'
import { access, lstat, readFile, readdir, realpath, rm } from 'node:fs/promises'
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
  refuseBackupDirectoryPath,
  resolveSaveBackupRoot,
  restoreBlockedBySession,
  validateSaveBackupDirectory,
  type OrbitBackupManifest
} from '@shared/saveRestorePolicy'
import { t } from './i18n'
import { gameRepository } from './library/gameRepository'
import { settingsStore } from './settingsStore'
import type { CustomLibraryService } from './customLibrary'
import {
  copyRestorePayload,
  readRestorePayload,
  resolveRestoreDestination,
  promoteRestore,
  recoverRestorePath,
  RestorePromotionError
} from './saveRestoreFiles'

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
}> {
  let manifest: OrbitBackupManifest | null = null
  let fileCount = 0
  let totalBytes = 0

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
    } else if (info.isDirectory()) {
      totalBytes += await directoryByteSize(entryPath)
    }
  }

  return { manifest, fileCount, totalBytes }
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

// Acquisition is synchronous, before the first await. A second restore never queues.
const restoringGames = new Set<string>()
let restoreInProgress = false

export function isRestoreInProgress(gameId: string): boolean {
  return restoringGames.has(gameId)
}

export async function recoverInterruptedRestores(): Promise<void> {
  if (restoreInProgress) return
  const games = gameRepository.getGamesByProvider('local').filter(game => game.local?.savePath)
  restoreInProgress = true
  for (const game of games) restoringGames.add(game.id)
  try {
    for (const game of games) {
      try { await recoverRestorePath(game.local!.savePath!) }
      catch (error) { console.warn('[save-restore] Recovery failed', game.id, error) }
    }
  } finally {
    for (const game of games) restoringGames.delete(game.id)
    restoreInProgress = false
  }
}

export async function restoreLocalGameBackup(
  game: LibraryGame,
  backupId: string,
  getLaunchStatus: () => GameLaunchStatus,
  customLibraryService: CustomLibraryService
): Promise<LocalGameRestoreResult> {
  const failed = (reason: NonNullable<LocalGameRestoreResult['reason']>): LocalGameRestoreResult => {
    console.warn('[save-restore] Restore failed', game.id, reason)
    return { state: 'failed', completedAt: Date.now(), reason }
  }
  if (restoreInProgress || restoringGames.has(game.id)) return failed('restore-in-progress')
  restoreInProgress = true
  restoringGames.add(game.id)
  let stagingPath: string | undefined
  let failureReason: NonNullable<LocalGameRestoreResult['reason']> = 'invalid-backup'
  const checkSession = (): void => {
    const status = getLaunchStatus()
    if (restoreBlockedBySession(game.id, status)) {
      failureReason = 'game-running'
      throw new Error('Game session active during restore')
    }
  }
  try {
    checkSession()
    if (game.provider !== 'local' || !game.local?.savePath) return failed('invalid-game')
    const backupRoot = await gameBackupRoot(game)
    const backupDirectoryPath = join(backupRoot, backupId.trim())
    if (refuseBackupDirectoryPath(backupDirectoryPath, backupRoot)) return failed('invalid-backup')
    const destination = await resolveRestoreDestination(game.local.savePath, backupRoot)
    const saveInfo = await lstat(destination)
    const payload = await readRestorePayload(backupRoot, backupDirectoryPath, saveInfo.isDirectory())
    const plan = planRestoreFromBackup({
      manifest: payload.manifest, expectedGameId: game.id,
      backupDirectoryPath: payload.directory, currentSavePath: destination,
      payloadName: payload.payloadName, saveIsDirectory: saveInfo.isDirectory()
    })
    if (typeof plan === 'string') return failed('invalid-backup')

    // Stage before creating the safety backup: rotation may remove the selected old backup.
    stagingPath = `${destination}.orbit-restore-staging-${randomUUID()}`
    await copyRestorePayload(payload.source, stagingPath)
    failureReason = 'safety-backup-failed'
    const safety = await customLibraryService.backup(game)
    if (safety.state !== 'success' || !safety.backupPath) return failed('safety-backup-failed')
    const safetyPayload = await readRestorePayload(backupRoot, safety.backupPath, saveInfo.isDirectory())
    if (safetyPayload.manifest.gameId !== game.id) return failed('safety-backup-failed')

    failureReason = 'restore-failed'
    // Revalidate after the potentially slow safety backup, then check live status at rename.
    if (await resolveRestoreDestination(game.local.savePath, backupRoot) !== destination) {
      throw new Error('Save destination changed during restore')
    }
    const state = await promoteRestore(stagingPath, destination, checkSession)
    return { state, completedAt: Date.now(), safetyBackupId: basename(safety.backupPath) }
  } catch (error) {
    console.warn('[save-restore] Restore refused or failed', error)
    // Promotion restores the exact previous tree; never overwrite it with a safety copy.
    // On rollback failure it remains under its recovery name for the next startup.
    return failed(error instanceof RestorePromotionError && error.rollbackFailed ? 'rollback-failed' : failureReason)
  } finally {
    if (stagingPath) {
      try { await rm(stagingPath, { recursive: true, force: true }) }
      catch (error) { console.warn('[save-restore] Could not remove staging', stagingPath, error) }
    }
    restoringGames.delete(game.id)
    restoreInProgress = false
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
