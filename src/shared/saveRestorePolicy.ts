import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

/** Comprueba si `child` es igual a `parent` o una ruta dentro de él (sin seguir symlinks). */
export function sameOrInside(parent: string, child: string): boolean {
  const pathFromParent = relative(resolve(parent), resolve(child))
  return pathFromParent === '' || (!pathFromParent.startsWith('..') && !isAbsolute(pathFromParent))
}

export type SaveBackupDirectoryValidationReason =
  | 'empty'
  | 'relative'
  | 'inside-save-path'
  | 'save-path-inside-directory'
  | 'invalid-characters'

export type SaveBackupDirectoryValidationResult =
  | { ok: true; normalizedPath: string }
  | { ok: false; reason: SaveBackupDirectoryValidationReason }

const INVALID_PATH_CHARACTERS = /[\u0000-\u001f\u007f]/u

/** Valida la carpeta custom de backups contra las rutas de save de juegos locales. */
export function validateSaveBackupDirectory(
  candidatePath: string,
  localSavePaths: readonly string[]
): SaveBackupDirectoryValidationResult {
  const trimmed = candidatePath.trim()
  if (!trimmed) return { ok: false, reason: 'empty' }
  if (INVALID_PATH_CHARACTERS.test(trimmed)) return { ok: false, reason: 'invalid-characters' }
  if (!isAbsolute(trimmed)) return { ok: false, reason: 'relative' }

  const normalizedPath = resolve(trimmed)
  for (const savePath of localSavePaths) {
    const normalizedSave = resolve(savePath.trim())
    if (!normalizedSave) continue
    if (sameOrInside(normalizedSave, normalizedPath)) {
      return { ok: false, reason: 'inside-save-path' }
    }
    if (sameOrInside(normalizedPath, normalizedSave)) {
      return { ok: false, reason: 'save-path-inside-directory' }
    }
  }

  return { ok: true, normalizedPath }
}

/** Raíz donde viven las carpetas por juego (`<root>/<gameHash>/<timestamp>/`). */
export function resolveSaveBackupRoot(userDataPath: string, configuredDirectory?: string): string {
  const trimmed = configuredDirectory?.trim()
  if (trimmed) return resolve(trimmed)
  return join(userDataPath, 'save-backups')
}

export interface OrbitBackupManifest {
  gameId: string
  gameName: string
  sourcePath: string
  createdAt: number
  payloadName?: string
  payloadKind?: 'file' | 'directory'
}

export function parseOrbitBackupManifest(raw: unknown): OrbitBackupManifest | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (typeof record.gameId !== 'string' || !record.gameId.trim()) return null
  if (typeof record.gameName !== 'string' || !record.gameName.trim()) return null
  if (typeof record.sourcePath !== 'string' || !record.sourcePath.trim()) return null
  if (typeof record.createdAt !== 'number' || !Number.isFinite(record.createdAt)) return null
  const hasPayload = 'payloadName' in record || 'payloadKind' in record
  if (hasPayload && (!validPayloadName(record.payloadName) ||
    (record.payloadKind !== 'file' && record.payloadKind !== 'directory'))) return null
  return {
    ...(hasPayload ? { payloadName: record.payloadName as string, payloadKind: record.payloadKind as 'file' | 'directory' } : {}),
    gameId: record.gameId.trim(),
    gameName: record.gameName.trim(),
    sourcePath: record.sourcePath.trim(),
    createdAt: record.createdAt
  }
}

export interface LocalGameBackupEntry {
  id: string
  createdAt: number
  fileCount: number
  totalBytes: number
}

export interface BackupCatalogInput {
  directoryName: string
  manifest: OrbitBackupManifest | null
  fileCount: number
  totalBytes: number
}

/** Arma la lista ordenada (más reciente primero) ignorando carpetas parciales o inválidas. */
export function buildBackupCatalog(inputs: readonly BackupCatalogInput[]): LocalGameBackupEntry[] {
  const entries = inputs
    .filter(
      (input) =>
        input.manifest &&
        !input.directoryName.includes('.partial-') &&
        input.manifest.gameId.length > 0
    )
    .map((input) => ({
      id: input.directoryName,
      createdAt: input.manifest!.createdAt,
      fileCount: input.fileCount,
      totalBytes: input.totalBytes
    }))

  return [...entries].sort((left, right) => {
    if (right.createdAt !== left.createdAt) return right.createdAt - left.createdAt
    return right.id.localeCompare(left.id)
  })
}

export type BackupPathRefusalReason = 'outside-game-root' | 'outside-backup-root' | 'partial-directory'

/** Rechaza rutas de restore que escapen del árbol de backups del juego. */
export function refuseBackupDirectoryPath(
  backupDirectoryPath: string,
  gameBackupRoot: string
): BackupPathRefusalReason | null {
  const normalizedBackup = resolve(backupDirectoryPath)
  const normalizedRoot = resolve(gameBackupRoot)
  if (basename(normalizedBackup).includes('.partial-')) return 'partial-directory'
  if (normalizedBackup === normalizedRoot || dirname(normalizedBackup) !== normalizedRoot) return 'outside-game-root'
  return null
}

export interface RestorePlan {
  backupDirectoryPath: string
  payloadName: string
  destinationPath: string
  isDirectory: boolean
}

export type RestorePlanFailureReason =
  | 'manifest-game-mismatch'
  | 'missing-payload'
  | 'destination-not-absolute'
  | 'payload-kind-mismatch'

/** Plan puro para copiar el payload del backup hacia el save actual. */
export function planRestoreFromBackup(input: {
  manifest: OrbitBackupManifest
  expectedGameId: string
  backupDirectoryPath: string
  currentSavePath: string
  payloadName: string
  saveIsDirectory: boolean
}): RestorePlan | RestorePlanFailureReason {
  if (input.manifest.gameId !== input.expectedGameId) return 'manifest-game-mismatch'
  if (!validPayloadName(input.payloadName)) return 'missing-payload'
  if (input.manifest.payloadName && input.manifest.payloadName !== input.payloadName) return 'missing-payload'
  if (input.manifest.payloadKind && (input.manifest.payloadKind === 'directory') !== input.saveIsDirectory) return 'payload-kind-mismatch'
  if (!isAbsolute(input.currentSavePath.trim())) return 'destination-not-absolute'
  const destinationPath = resolve(input.currentSavePath.trim())
  if (!isAbsolute(destinationPath)) return 'destination-not-absolute'

  return {
    backupDirectoryPath: resolve(input.backupDirectoryPath),
    payloadName: input.payloadName,
    destinationPath,
    isDirectory: input.saveIsDirectory
  }
}

export interface RestoreRollbackPlan {
  safetyBackupDirectory: string
  safetyPayloadName: string
  destinationPath: string
  isDirectory: boolean
}

/** Si el restore falla, este plan indica cómo volver al safety backup previo. */
export function planRestoreRollback(input: {
  safetyBackupDirectory: string
  safetyPayloadName: string
  destinationPath: string
  isDirectory: boolean
}): RestoreRollbackPlan {
  return {
    safetyBackupDirectory: resolve(input.safetyBackupDirectory),
    safetyPayloadName: input.safetyPayloadName,
    destinationPath: resolve(input.destinationPath),
    isDirectory: input.isDirectory
  }
}

export type SimulatedRestoreOutcome = 'success' | 'failure'

/** Decide si hay que ejecutar rollback después de un restore (para tests sin disco). */
export function shouldRollbackAfterRestore(outcome: SimulatedRestoreOutcome): boolean {
  return outcome === 'failure'
}

/** Portable single path component: also reject Windows separators, streams and aliases. */
export function validPayloadName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name !== '.' && name !== '..' &&
    name.toLowerCase() !== 'orbit-backup.json' && !/[<>:"/\\|?*\u0000-\u001f]/u.test(name) &&
    !/[. ]$/u.test(name)
}

export function selectBackupPayload(manifest: OrbitBackupManifest, entries: readonly string[]): string | null {
  if (manifest.payloadName) return entries.includes(manifest.payloadName) ? manifest.payloadName : null
  return entries.length === 1 && validPayloadName(entries[0]) ? entries[0] : null
}

export function restoreBlockedBySession(
  gameId: string,
  status: { gameId?: string; phase: string }
): boolean {
  return status.gameId === gameId &&
    (status.phase === 'launching' || status.phase === 'running' || status.phase === 'returning')
}
