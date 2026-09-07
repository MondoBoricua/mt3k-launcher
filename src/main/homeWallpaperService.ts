import { t } from './i18n'
import { app, dialog, nativeImage, type BrowserWindow, type NativeImage } from 'electron'
import { existsSync, statSync } from 'node:fs'
import {
  copyFile,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { HomeWallpaperAsset, HomeWallpaperKind } from '@shared/ipc'

const HOME_WALLPAPER_DIR = join(app.getPath('userData'), 'home-background')
const MAX_IMAGE_SOURCE_BYTES = 32 * 1024 * 1024
const MAX_VIDEO_SOURCE_BYTES = 256 * 1024 * 1024
const MAX_SOURCE_PIXELS = 80_000_000
const MAX_WIDTH = 3_840
const MAX_HEIGHT = 2_160
const VIDEO_HEADER_BYTES = 4_096
const MP4_SIGNATURE = 'ftyp'
const WEBM_SIGNATURE = Buffer.from([0x1a, 0x45, 0xdf, 0xa3])

interface StoredWallpaper {
  fileName: string
  kind: HomeWallpaperKind
  maxBytes: number
}

const IMAGE_WALLPAPER: StoredWallpaper = {
  fileName: 'custom-wallpaper.jpg',
  kind: 'image',
  maxBytes: MAX_IMAGE_SOURCE_BYTES
}
const MP4_WALLPAPER: StoredWallpaper = {
  fileName: 'custom-wallpaper.mp4',
  kind: 'video',
  maxBytes: MAX_VIDEO_SOURCE_BYTES
}
const WEBM_WALLPAPER: StoredWallpaper = {
  fileName: 'custom-wallpaper.webm',
  kind: 'video',
  maxBytes: MAX_VIDEO_SOURCE_BYTES
}
const STORED_WALLPAPERS = [IMAGE_WALLPAPER, MP4_WALLPAPER, WEBM_WALLPAPER] as const
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

function wallpaperPath(entry: StoredWallpaper): string {
  return join(HOME_WALLPAPER_DIR, entry.fileName)
}

function wallpaperUrl(entry: StoredWallpaper, modifiedAt: number): string {
  return `orbit-media://${entry.fileName}?version=${Math.floor(modifiedAt)}`
}

function resolveStoredWallpaper(
  entry: StoredWallpaper
): { filePath: string; modifiedAt: number } | null {
  try {
    const filePath = wallpaperPath(entry)
    const fileStats = statSync(filePath)
    if (!fileStats.isFile() || fileStats.size === 0 || fileStats.size > entry.maxBytes) return null
    return { filePath, modifiedAt: fileStats.mtimeMs }
  } catch {
    return null
  }
}

function prepareImageWallpaper(source: Buffer): NativeImage {
  if (source.byteLength === 0 || source.byteLength > MAX_IMAGE_SOURCE_BYTES) {
    throw new Error('Selected wallpaper image is empty or too large')
  }

  const image = nativeImage.createFromBuffer(source)
  if (image.isEmpty()) throw new Error('Selected wallpaper is not a readable image')

  const { width, height } = image.getSize()
  if (width <= 0 || height <= 0 || width * height > MAX_SOURCE_PIXELS) {
    throw new Error('Selected wallpaper has unsupported dimensions')
  }

  const scale = Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height)
  if (scale === 1) return image

  const resized = image.resize({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    quality: 'best'
  })
  if (resized.isEmpty()) throw new Error('Selected wallpaper could not be prepared')
  return resized
}

async function validateVideoWallpaper(
  sourcePath: string,
  entry: typeof MP4_WALLPAPER | typeof WEBM_WALLPAPER
): Promise<number> {
  const sourceStats = await stat(sourcePath)
  if (
    !sourceStats.isFile() ||
    sourceStats.size < 12 ||
    sourceStats.size > MAX_VIDEO_SOURCE_BYTES
  ) {
    throw new Error('Selected live wallpaper is empty or too large')
  }

  const handle = await open(sourcePath, 'r')
  try {
    const header = Buffer.alloc(Math.min(VIDEO_HEADER_BYTES, sourceStats.size))
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    const readableHeader = header.subarray(0, bytesRead)
    const isMp4 =
      entry === MP4_WALLPAPER && readableHeader.indexOf(MP4_SIGNATURE, 0, 'ascii') >= 4
    const isWebm =
      entry === WEBM_WALLPAPER &&
      readableHeader.subarray(0, WEBM_SIGNATURE.length).equals(WEBM_SIGNATURE) &&
      readableHeader.toString('latin1').toLowerCase().includes('webm')
    if (!isMp4 && !isWebm) {
      throw new Error('Selected live wallpaper is not a readable MP4 or WebM video')
    }
  } finally {
    await handle.close()
  }

  return sourceStats.size
}

function targetForSource(sourcePath: string): StoredWallpaper {
  const extension = extname(sourcePath).toLowerCase()
  if (IMAGE_EXTENSIONS.has(extension)) return IMAGE_WALLPAPER
  if (extension === '.mp4') return MP4_WALLPAPER
  if (extension === '.webm') return WEBM_WALLPAPER
  throw new Error('Selected wallpaper format is not supported')
}

async function replaceWallpaper(
  target: StoredWallpaper,
  writeTemporaryFile: (temporaryPath: string) => Promise<void>
): Promise<void> {
  await mkdir(HOME_WALLPAPER_DIR, { recursive: true })
  const targetPath = wallpaperPath(target)
  const temporaryPath = `${targetPath}.${process.pid}-${Date.now()}.tmp`
  const backupPath = `${targetPath}.previous`

  try {
    await writeTemporaryFile(temporaryPath)
    await unlink(backupPath).catch(() => undefined)
    if (existsSync(targetPath)) await rename(targetPath, backupPath)
    try {
      await rename(temporaryPath, targetPath)
      await Promise.all(
        STORED_WALLPAPERS.filter((entry) => entry !== target).flatMap((entry) => [
          unlink(wallpaperPath(entry)).catch(() => undefined),
          unlink(`${wallpaperPath(entry)}.previous`).catch(() => undefined)
        ])
      )
      await unlink(backupPath).catch(() => undefined)
    } catch (error) {
      if (existsSync(backupPath) && !existsSync(targetPath)) {
        await rename(backupPath, targetPath).catch(() => undefined)
      }
      throw error
    }
  } finally {
    await unlink(temporaryPath).catch(() => undefined)
  }
}

class HomeWallpaperService {
  resolve(): HomeWallpaperAsset | null {
    const resolved = STORED_WALLPAPERS.map((entry) => ({
      entry,
      stored: resolveStoredWallpaper(entry)
    }))
      .filter(
        (
          candidate
        ): candidate is {
          entry: StoredWallpaper
          stored: { filePath: string; modifiedAt: number }
        } => candidate.stored !== null
      )
      .sort((left, right) => right.stored.modifiedAt - left.stored.modifiedAt)[0]

    return resolved
      ? {
          kind: resolved.entry.kind,
          url: wallpaperUrl(resolved.entry, resolved.stored.modifiedAt)
        }
      : null
  }

  resolveRequestPath(requestUrl: string): string | null {
    try {
      const parsed = new URL(requestUrl)
      const entry = STORED_WALLPAPERS.find((candidate) => candidate.fileName === parsed.hostname)
      if (
        parsed.protocol !== 'orbit-media:' ||
        !entry ||
        (parsed.pathname !== '' && parsed.pathname !== '/')
      ) {
        return null
      }
      return resolveStoredWallpaper(entry)?.filePath ?? null
    } catch {
      return null
    }
  }

  async select(mainWindow: BrowserWindow): Promise<HomeWallpaperAsset | null> {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: t("ORBIT · Select Home wallpaper"),
      buttonLabel: t("Use wallpaper"),
      properties: ['openFile'],
      filters: [
        {
          name: t("Wallpaper (image or video)"),
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm']
        },
        { name: t("Images"), extensions: ['png', 'jpg', 'jpeg', 'webp'] },
        { name: t("Live wallpapers"), extensions: ['mp4', 'webm'] }
      ]
    })
    if (result.canceled || !result.filePaths[0]) return null

    const sourcePath = result.filePaths[0]
    const target = targetForSource(sourcePath)
    if (target.kind === 'image') {
      const sourceStats = await stat(sourcePath)
      if (
        !sourceStats.isFile() ||
        sourceStats.size === 0 ||
        sourceStats.size > MAX_IMAGE_SOURCE_BYTES
      ) {
        throw new Error('Selected wallpaper image is empty or too large')
      }

      const source = await readFile(sourcePath)
      if (source.byteLength !== sourceStats.size) {
        throw new Error('Selected wallpaper changed while it was being read')
      }
      const prepared = prepareImageWallpaper(source).toJPEG(92)
      if (prepared.byteLength === 0) throw new Error('Selected wallpaper could not be encoded')
      await replaceWallpaper(target, (temporaryPath) =>
        writeFile(temporaryPath, prepared, { flag: 'wx' })
      )
    } else {
      const videoTarget = target === MP4_WALLPAPER ? MP4_WALLPAPER : WEBM_WALLPAPER
      const sourceBytes = await validateVideoWallpaper(sourcePath, videoTarget)
      await replaceWallpaper(videoTarget, async (temporaryPath) => {
        await copyFile(sourcePath, temporaryPath)
        const copiedStats = await stat(temporaryPath)
        if (!copiedStats.isFile() || copiedStats.size !== sourceBytes) {
          throw new Error('Live wallpaper could not be copied safely')
        }
      })
    }

    const stored = resolveStoredWallpaper(target)
    if (!stored) throw new Error('Prepared wallpaper is not available')
    return { kind: target.kind, url: wallpaperUrl(target, stored.modifiedAt) }
  }

  async clear(): Promise<void> {
    await Promise.all(
      STORED_WALLPAPERS.flatMap((entry) => [
        unlink(wallpaperPath(entry)).catch(() => undefined),
        unlink(`${wallpaperPath(entry)}.previous`).catch(() => undefined)
      ])
    )
  }
}

export const homeWallpaperService = new HomeWallpaperService()
