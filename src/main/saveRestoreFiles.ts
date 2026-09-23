import { randomUUID } from 'node:crypto'
import { cp, lstat, readFile, readdir, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import {
  parseOrbitBackupManifest, refuseBackupDirectoryPath, sameOrInside, selectBackupPayload
} from '../shared/saveRestorePolicy'

const MANIFEST = 'orbit-backup.json'

export async function pathExists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function assertNoLinks(path: string): Promise<void> {
  const info = await lstat(path)
  if (info.isSymbolicLink()) throw new Error('Save restore link rejected')
  if (!info.isDirectory() && !info.isFile()) throw new Error('Unsupported save restore entry')
  if (info.isDirectory()) {
    for (const name of await readdir(path)) await assertNoLinks(join(path, name))
  }
}

export async function readRestorePayload(root: string, directory: string, saveIsDirectory: boolean) {
  if (refuseBackupDirectoryPath(directory, root)) throw new Error('Invalid backup directory')
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Backup directory link rejected')
  const realRoot = await realpath(root)
  const realDirectory = await realpath(directory)
  if (refuseBackupDirectoryPath(realDirectory, realRoot)) throw new Error('Backup escapes real root')
  // Include the manifest and every entry, not just the selected payload.
  await assertNoLinks(realDirectory)
  const manifest = parseOrbitBackupManifest(JSON.parse(await readFile(join(realDirectory, MANIFEST), 'utf8')))
  if (!manifest) throw new Error('Invalid backup manifest')
  const payloadName = selectBackupPayload(manifest, (await readdir(realDirectory)).filter(name => name !== MANIFEST))
  if (!payloadName) throw new Error('Ambiguous or missing backup payload')
  const source = join(realDirectory, payloadName)
  const info = await lstat(source)
  const kind = info.isDirectory() ? 'directory' : 'file'
  if (info.isDirectory() !== saveIsDirectory || (manifest.payloadKind && manifest.payloadKind !== kind)) {
    throw new Error('Backup payload kind mismatch')
  }
  return { manifest, payloadName, source, directory: realDirectory }
}

export async function resolveRestoreDestination(savePath: string, backupRoot: string): Promise<string> {
  if (!isAbsolute(savePath)) throw new Error('Save path must be absolute')
  const parent = await realpath(dirname(savePath))
  const destination = join(parent, basename(savePath))
  const root = await realpath(backupRoot)
  if (sameOrInside(root, destination) || sameOrInside(destination, root)) {
    throw new Error('Save and backup paths overlap')
  }
  await assertNoLinks(destination)
  return destination
}

export async function copyRestorePayload(source: string, staging: string): Promise<void> {
  await assertNoLinks(source)
  await cp(source, staging, {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter: async (entry) => {
      const info = await lstat(entry)
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) {
        throw new Error('Save restore copy link rejected')
      }
      return true
    }
  })
  await assertNoLinks(staging)
}

export class RestorePromotionError extends Error {
  readonly rollbackFailed: boolean

  constructor(rollbackFailed: boolean, cause: unknown) {
    super('Save restore promotion failed', { cause })
    this.rollbackFailed = rollbackFailed
  }
}

/** The rename is the commit point. Cleanup must never undo a committed restore. */
export async function promoteRestore(
  staging: string,
  destination: string,
  beforeRename: () => void,
  operations = { rename, rm }
): Promise<'success' | 'cleanup-failed'> {
  const previous = `${destination}.orbit-restore-prev-${randomUUID()}`
  const stagedInfo = await lstat(staging)
  // No asynchronous work between the live session check and the first rename.
  beforeRename()
  await operations.rename(destination, previous)
  try {
    await operations.rename(staging, destination)
  } catch (error) {
    try {
      // Try restoring the original first. Do not delete a destination we do not own.
      await operations.rename(previous, destination)
    } catch (rollbackError) {
      try {
        const occupied = await lstat(destination)
        if (occupied.dev !== stagedInfo.dev || occupied.ino !== stagedInfo.ino) throw rollbackError
        await operations.rm(destination, { recursive: true, force: true })
        await operations.rename(previous, destination)
      } catch (retryError) {
        console.warn('[save-restore] Previous save retained for recovery', previous, retryError)
        throw new RestorePromotionError(true, error)
      }
    }
    throw new RestorePromotionError(false, error)
  }
  try {
    await operations.rm(previous, { recursive: true, force: true })
    return 'success'
  } catch (error) {
    console.warn('[save-restore] Restore committed; previous save cleanup failed', previous, error)
    return 'cleanup-failed'
  }
}

/** Only UUID artifacts created by this transaction are eligible for recovery. */
export async function recoverRestorePath(savePath: string): Promise<void> {
  if (!isAbsolute(savePath)) throw new Error('Save path must be absolute')
  const parent = await realpath(dirname(savePath))
  const destination = join(parent, basename(savePath))
  const names = await readdir(parent)
  const artifact = (name: string, kind: string): boolean => {
    const prefix = `${basename(destination)}.orbit-restore-${kind}-`
    return name.startsWith(prefix) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name.slice(prefix.length))
  }
  const previous = names.filter(name => artifact(name, 'prev'))
  if (!(await pathExists(destination)) && previous.length) {
    // Multiple originals are ambiguous: preserve all candidates for manual recovery.
    if (previous.length !== 1) throw new Error('Multiple previous saves require manual recovery')
    const source = join(parent, previous[0])
    await assertNoLinks(source)
    await rename(source, destination)
    console.warn('[save-restore] Recovered interrupted restore', destination)
  }
  for (const name of names.filter(name => artifact(name, 'staging'))) {
    const staging = join(parent, name)
    await assertNoLinks(staging)
    await rm(staging, { recursive: true, force: true })
    console.warn('[save-restore] Removed interrupted restore staging', staging)
  }
}
