import { app, shell } from 'electron'
import { stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { settingsStore } from '../settingsStore'
import { captureKind, type CaptureItem } from '../../shared/capturePolicy'
import { readCaptureImage, scanCaptureDirectory, validateCaptureFile } from './captureFiles'

const thumbnails = new Map<string, string>()
function enabled(): boolean {
  return process.platform === 'win32' && settingsStore.get('captureShelfEnabled') === true
}
function folder(): string {
  if (!enabled()) throw new Error('Captures unavailable')
  return join(app.getPath('videos'), 'Captures')
}

async function validatedFile(candidate: unknown): Promise<string> {
  return validateCaptureFile(folder(), candidate)
}

export async function listCaptures(): Promise<CaptureItem[]> {
  if (!enabled()) return []
  const items = await scanCaptureDirectory(folder(), enabled)
  thumbnails.clear()
  if (!enabled()) return []
  return items.map((item) => {
    if (item.kind !== 'image') return item
    const token = createHash('sha256').update(item.path).digest('hex')
    thumbnails.set(token, item.path)
    return { ...item, thumbnailUrl: `orbit-image://captures/${token}` }
  })
}

/**
 * Serves a thumbnail from a descriptor opened after the containment checks, so
 * a swapped path or symlink between validation and read is never followed.
 */
export async function readCaptureThumbnail(
  url: string
): Promise<{ bytes: Buffer; contentType: string } | null> {
  if (!enabled()) return null
  const token = /^orbit-image:\/\/captures\/([a-f0-9]{64})$/.exec(url)?.[1]
  const candidate = token ? thumbnails.get(token) : undefined
  if (!candidate || captureKind(basename(candidate)) !== 'image') return null
  try { return await readCaptureImage(folder(), candidate) }
  catch (error) { console.warn('[captures] Thumbnail unavailable', error); return null }
}

export async function openCapture(candidate: unknown): Promise<void> {
  const file = await validatedFile(candidate)
  if (!enabled()) return
  const error = await shell.openPath(file)
  if (error) throw new Error(error)
}

export async function openCapturesFolder(): Promise<void> {
  const root = folder()
  const info = await stat(root)
  if (!info.isDirectory()) throw new Error('Captures folder missing')
  if (!enabled()) return
  const error = await shell.openPath(root)
  if (error) throw new Error(error)
}
