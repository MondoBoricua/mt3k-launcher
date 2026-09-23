import { readdir, realpath, lstat } from 'node:fs/promises'
import { join } from 'node:path'
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
