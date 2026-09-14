import { t } from './i18n'
import { app, dialog, type BrowserWindow } from 'electron'
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { CustomLauncherMusic } from '@shared/launcherMusic'
import { orbitPlusService } from './orbitPlus/orbitPlusService'
import {
  LOCAL_AUDIO_EXTENSIONS,
  safeLocalAudioName,
  validateLocalAudioFile
} from './localAudioFile'

const MUSIC_DIRECTORY = join(app.getPath('userData'), 'launcher-music')
const MANIFEST_PATH = join(MUSIC_DIRECTORY, 'manifest.json')
const MAX_SOURCE_BYTES = 256 * 1024 * 1024

interface LauncherMusicManifest {
  fileName: string
  displayName: string
}

function isStoredFileName(value: unknown): value is string {
  return typeof value === 'string' && /^background\.(mp3|wav|ogg|m4a|aac|flac|webm)$/u.test(value)
}

async function readManifest(): Promise<LauncherMusicManifest | null> {
  try {
    const parsed = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as Partial<LauncherMusicManifest>
    if (!isStoredFileName(parsed.fileName)) return null
    return {
      fileName: parsed.fileName,
      displayName: safeLocalAudioName(parsed.displayName, 'Custom music')
    }
  } catch {
    return null
  }
}

async function removeStoredAudio(except?: string): Promise<void> {
  const entries = await readdir(MUSIC_DIRECTORY).catch(() => [])
  await Promise.all(
    entries
      .filter((fileName) => isStoredFileName(fileName) && fileName !== except)
      .map((fileName) => unlink(join(MUSIC_DIRECTORY, fileName)).catch(() => undefined))
  )
}

class LauncherMusicService {
  async resolve(): Promise<CustomLauncherMusic | null> {
    const manifest = await readManifest()
    if (!manifest) return null
    try {
      const filePath = join(MUSIC_DIRECTORY, manifest.fileName)
      const fileStats = await stat(filePath)
      if (!fileStats.isFile() || fileStats.size <= 0 || fileStats.size > MAX_SOURCE_BYTES) return null
      return {
        name: manifest.displayName,
        url: `orbit-media://launcher-music/${manifest.fileName}?version=${Math.floor(fileStats.mtimeMs)}`
      }
    } catch {
      return null
    }
  }

  async resolveRequestPath(requestUrl: string): Promise<string | null> {
    try {
      if (!orbitPlusService.hasFeature('manual-audio')) return null
      const request = new URL(requestUrl)
      if (request.protocol !== 'orbit-media:' || request.hostname !== 'launcher-music') return null
      const requestedFile = decodeURIComponent(request.pathname.replace(/^\//u, ''))
      const manifest = await readManifest()
      if (!manifest || requestedFile !== manifest.fileName) return null
      const filePath = join(MUSIC_DIRECTORY, manifest.fileName)
      const fileStats = await stat(filePath)
      return fileStats.isFile() && fileStats.size > 0 && fileStats.size <= MAX_SOURCE_BYTES
        ? filePath
        : null
    } catch {
      return null
    }
  }

  async select(mainWindow: BrowserWindow): Promise<CustomLauncherMusic | null> {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: t("MT3K Launcher · Select launcher music"),
      buttonLabel: t("Use music"),
      properties: ['openFile'],
      filters: [
        {
          name: t("Audio files"),
          extensions: [...LOCAL_AUDIO_EXTENSIONS]
        }
      ]
    })
    if (result.canceled || !result.filePaths[0]) return null

    const sourcePath = await realpath(result.filePaths[0])
    const { extension, size } = await validateLocalAudioFile(sourcePath, MAX_SOURCE_BYTES)
    await mkdir(MUSIC_DIRECTORY, { recursive: true })
    const fileName = `background${extension}`
    const targetPath = join(MUSIC_DIRECTORY, fileName)
    const temporaryPath = `${targetPath}.${process.pid}-${Date.now()}.tmp`
    const temporaryManifest = `${MANIFEST_PATH}.${process.pid}-${Date.now()}.tmp`
    try {
      await copyFile(sourcePath, temporaryPath)
      const copiedStats = await stat(temporaryPath)
      if (!copiedStats.isFile() || copiedStats.size !== size) {
        throw new Error('Launcher music could not be copied safely')
      }
      await unlink(targetPath).catch(() => undefined)
      await rename(temporaryPath, targetPath)
      await removeStoredAudio(fileName)
      const displayName = safeLocalAudioName(basename(sourcePath, extension), 'Custom music')
      await writeFile(
        temporaryManifest,
        JSON.stringify({ fileName, displayName } satisfies LauncherMusicManifest),
        'utf8'
      )
      await unlink(MANIFEST_PATH).catch(() => undefined)
      await rename(temporaryManifest, MANIFEST_PATH)
    } finally {
      await unlink(temporaryPath).catch(() => undefined)
      await unlink(temporaryManifest).catch(() => undefined)
    }
    return this.resolve()
  }

  async clear(): Promise<void> {
    await unlink(MANIFEST_PATH).catch(() => undefined)
    await removeStoredAudio()
  }
}

export const launcherMusicService = new LauncherMusicService()
