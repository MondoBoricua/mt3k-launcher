import { t } from './i18n'
import { app, dialog, type BrowserWindow } from 'electron'
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  unlink,
  writeFile
} from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import {
  AUDIO_CUE_IDS,
  isAudioCueId,
  type AudioCueId,
  type CustomUiAudioCue,
  type CustomUiAudioCues
} from '@shared/ipc'
import { orbitPlusService } from './orbitPlus/orbitPlusService'
import {
  LOCAL_AUDIO_EXTENSIONS,
  safeLocalAudioName,
  validateLocalAudioFile
} from './localAudioFile'

const AUDIO_DIRECTORY = join(app.getPath('userData'), 'ui-audio')
const MANIFEST_PATH = join(AUDIO_DIRECTORY, 'manifest.json')
const MAX_SOURCE_BYTES = 16 * 1024 * 1024
const EXTENSION_PATTERN = '(mp3|wav|ogg|m4a|aac|flac|webm)'

interface StoredUiAudioCue {
  fileName: string
  displayName: string
}

type UiAudioManifest = Partial<Record<AudioCueId, StoredUiAudioCue>>

function isStoredFileName(cueId: AudioCueId, value: unknown): value is string {
  return (
    typeof value === 'string' &&
    new RegExp(`^${cueId}(?:-[a-f0-9]{16})?\\.${EXTENSION_PATTERN}$`, 'u').test(value)
  )
}

function isAnyStoredFileName(value: string): boolean {
  return AUDIO_CUE_IDS.some((cueId) => isStoredFileName(cueId, value))
}

async function readManifest(): Promise<UiAudioManifest> {
  try {
    const parsed = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as Record<string, unknown>
    return AUDIO_CUE_IDS.reduce<UiAudioManifest>((manifest, cueId) => {
      const entry = parsed[cueId]
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return manifest
      const record = entry as Record<string, unknown>
      if (!isStoredFileName(cueId, record.fileName)) return manifest
      manifest[cueId] = {
        fileName: record.fileName,
        displayName: safeLocalAudioName(record.displayName, 'Custom sound')
      }
      return manifest
    }, {})
  } catch {
    return {}
  }
}

async function writeManifest(manifest: UiAudioManifest): Promise<void> {
  await mkdir(AUDIO_DIRECTORY, { recursive: true })
  const temporaryPath = `${MANIFEST_PATH}.${process.pid}-${Date.now()}.tmp`
  try {
    await writeFile(temporaryPath, JSON.stringify(manifest), 'utf8')
    // rename replaces the old manifest atomically on supported platforms. Keeping
    // the previous file in place until this point avoids an empty crash window.
    await rename(temporaryPath, MANIFEST_PATH)
  } finally {
    await unlink(temporaryPath).catch(() => undefined)
  }
}

async function resolveStoredCueFile(
  cueId: AudioCueId,
  entry: StoredUiAudioCue
): Promise<{ filePath: string; mtimeMs: number } | null> {
  if (!isStoredFileName(cueId, entry.fileName)) return null
  try {
    const filePath = join(AUDIO_DIRECTORY, entry.fileName)
    const [directoryStats, fileStats, resolvedDirectory, resolvedFile] = await Promise.all([
      lstat(AUDIO_DIRECTORY),
      lstat(filePath),
      realpath(AUDIO_DIRECTORY),
      realpath(filePath)
    ])
    if (!directoryStats.isDirectory() || !fileStats.isFile()) return null
    if (dirname(resolvedFile) !== resolvedDirectory) return null
    const validated = await validateLocalAudioFile(filePath, MAX_SOURCE_BYTES)
    if (validated.size !== fileStats.size) return null
    return { filePath, mtimeMs: fileStats.mtimeMs }
  } catch {
    return null
  }
}

async function removeCueFiles(cueId: AudioCueId, except?: string): Promise<void> {
  const entries = await readdir(AUDIO_DIRECTORY).catch(() => [])
  await Promise.all(
    entries
      .filter(
        (fileName) =>
          isAnyStoredFileName(fileName) &&
          isStoredFileName(cueId, fileName) &&
          fileName !== except
      )
      .map((fileName) => unlink(join(AUDIO_DIRECTORY, fileName)).catch(() => undefined))
  )
}

async function resolveEntry(
  cueId: AudioCueId,
  entry: StoredUiAudioCue | undefined
): Promise<CustomUiAudioCue | null> {
  if (!entry) return null
  const stored = await resolveStoredCueFile(cueId, entry)
  if (!stored) return null
  return {
    name: entry.displayName,
    url: `orbit-media://ui-audio/${cueId}/${entry.fileName}?version=${Math.floor(stored.mtimeMs)}`
  }
}

class CustomUiAudioService {
  private mutationQueue: Promise<void> = Promise.resolve()

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  async resolveAll(): Promise<CustomUiAudioCues> {
    const manifest = await readManifest()
    const resolved = await Promise.all(
      AUDIO_CUE_IDS.map(async (cueId) => [cueId, await resolveEntry(cueId, manifest[cueId])] as const)
    )
    return resolved.reduce<CustomUiAudioCues>((cues, [cueId, cue]) => {
      if (cue) cues[cueId] = cue
      return cues
    }, {})
  }

  async resolveRequestPath(requestUrl: string): Promise<string | null> {
    try {
      if (!orbitPlusService.hasFeature('manual-audio')) return null
      const request = new URL(requestUrl)
      if (request.protocol !== 'orbit-media:' || request.hostname !== 'ui-audio') return null
      const segments = request.pathname
        .split('/')
        .filter(Boolean)
        .map((segment) => decodeURIComponent(segment))
      if (segments.length !== 2 || !isAudioCueId(segments[0])) return null
      const [cueId, requestedFile] = segments
      const manifest = await readManifest()
      const entry = manifest[cueId]
      if (!entry || requestedFile !== entry.fileName) return null
      return (await resolveStoredCueFile(cueId, entry))?.filePath ?? null
    } catch {
      return null
    }
  }

  async select(mainWindow: BrowserWindow, cueId: AudioCueId): Promise<CustomUiAudioCue | null> {
    if (!orbitPlusService.hasFeature('manual-audio')) {
      throw new Error('ORBIT Plus is required for custom interface sounds')
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: t("ORBIT · Select custom sound"),
      buttonLabel: t("Use sound"),
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
    return this.mutate(async () => {
      await mkdir(AUDIO_DIRECTORY, { recursive: true })
      const fileName = `${cueId}-${randomBytes(8).toString('hex')}${extension}`
      const targetPath = join(AUDIO_DIRECTORY, fileName)
      let committed = false
      try {
        await copyFile(sourcePath, targetPath)
        const copied = await validateLocalAudioFile(targetPath, MAX_SOURCE_BYTES)
        if (copied.size !== size) {
          throw new Error('Custom interface sound could not be copied safely')
        }
        const manifest = await readManifest()
        manifest[cueId] = {
          fileName,
          displayName: safeLocalAudioName(basename(sourcePath), 'Custom sound')
        }
        await writeManifest(manifest)
        committed = true
        await removeCueFiles(cueId, fileName)
        return resolveEntry(cueId, manifest[cueId])
      } finally {
        if (!committed) await unlink(targetPath).catch(() => undefined)
      }
    })
  }

  async clear(cueId: AudioCueId): Promise<void> {
    await this.mutate(async () => {
      const manifest = await readManifest()
      delete manifest[cueId]
      if (Object.keys(manifest).length > 0) await writeManifest(manifest)
      else await unlink(MANIFEST_PATH).catch(() => undefined)
      await removeCueFiles(cueId)
    })
  }
}

export const customUiAudioService = new CustomUiAudioService()
