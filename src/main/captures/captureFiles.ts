import { constants } from 'node:fs'
import { open, readdir, realpath, lstat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { captureKind, captureTitleGuess, isCapturePathContained, newestCaptures, type CaptureItem } from '../../shared/capturePolicy'

class UnsafeCaptureError extends Error {}

/** Resolve again at each use, including after a thumbnail token has been issued. */
export async function validateCaptureFile(root: string, candidate: unknown): Promise<string> {
  if (!isCapturePathContained(root, candidate)) throw new UnsafeCaptureError('Invalid capture path')
  const [resolvedRoot, resolvedFile, info] = await Promise.all([
    realpath(root), realpath(candidate), lstat(candidate)
  ])
  if (!info.isFile() || info.isSymbolicLink() || !isCapturePathContained(resolvedRoot, resolvedFile)) {
    throw new UnsafeCaptureError('Capture path escapes folder')
  }
  return resolvedFile
}

const CAPTURE_IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg'
}

/**
 * Reads a capture image through a descriptor so the bytes served are the ones
 * that were validated: the path is opened with O_NOFOLLOW where the platform
 * has it and the open handle is fstat-checked before any read.
 */
export async function readCaptureImage(
  root: string,
  candidate: unknown
): Promise<{ bytes: Buffer; contentType: string }> {
  const file = await validateCaptureFile(root, candidate)
  const contentType = CAPTURE_IMAGE_TYPES[extname(file).toLowerCase()]
  if (!contentType) throw new UnsafeCaptureError('Not a capture image')
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
  const handle = await open(file, flags)
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new UnsafeCaptureError('Capture is not a regular file')
    return { bytes: await handle.readFile(), contentType }
  } finally {
    await handle.close()
  }
}

export async function scanCaptureDirectory(root: string, shouldContinue = (): boolean => true): Promise<CaptureItem[]> {
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  let items: CaptureItem[] = []
  for (const name of entries) {
    if (!shouldContinue()) return []
    const kind = captureKind(name)
    if (!kind) continue
    const candidate = join(root, name)
    try {
      const resolved = await validateCaptureFile(root, candidate)
      const info = await lstat(resolved)
      items = newestCaptures([...items, {
        path: candidate, kind, capturedAt: info.mtimeMs, sizeBytes: info.size,
        gameTitleGuess: captureTitleGuess(name)
      }])
    } catch (error) {
      // Unsafe entries and files removed by another app cannot become capabilities.
      console.warn('[captures] Skipping unavailable capture', name, error)
      if (!(error instanceof UnsafeCaptureError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return shouldContinue() ? items : []
}
