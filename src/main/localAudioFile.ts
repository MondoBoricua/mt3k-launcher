import { open } from 'node:fs/promises'
import { extname } from 'node:path'

const HEADER_BYTES = 16

export const LOCAL_AUDIO_EXTENSIONS = [
  'mp3',
  'wav',
  'ogg',
  'm4a',
  'aac',
  'flac',
  'webm'
] as const

const ALLOWED_EXTENSIONS = new Set(LOCAL_AUDIO_EXTENSIONS.map((extension) => `.${extension}`))

function hasSupportedSignature(extension: string, header: Uint8Array): boolean {
  const text = Buffer.from(header).toString('latin1')
  if (extension === '.wav') return text.startsWith('RIFF') && text.slice(8, 12) === 'WAVE'
  if (extension === '.ogg') return text.startsWith('OggS')
  if (extension === '.flac') return text.startsWith('fLaC')
  if (extension === '.webm') {
    return header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3
  }
  if (extension === '.m4a') return text.slice(4, 8) === 'ftyp'
  if (extension === '.aac') return header[0] === 0xff && (header[1] & 0xf6) === 0xf0
  if (extension === '.mp3') {
    return text.startsWith('ID3') || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)
  }
  return false
}

export function safeLocalAudioName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/gu, '').trim()
  return normalized ? normalized.slice(0, 120) : fallback
}

export async function validateLocalAudioFile(
  sourcePath: string,
  maximumBytes: number
): Promise<{ extension: string; size: number }> {
  const extension = extname(sourcePath).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error('Unsupported local audio format')
  const handle = await open(sourcePath, 'r')
  try {
    // Read metadata and the signature from the same open handle so a replaced path
    // cannot make validation describe a different file than the one inspected.
    const sourceStats = await handle.stat()
    if (!sourceStats.isFile() || sourceStats.size <= 0 || sourceStats.size > maximumBytes) {
      throw new Error('Invalid local audio file')
    }
    const header = new Uint8Array(HEADER_BYTES)
    const { bytesRead } = await handle.read(header, 0, header.byteLength, 0)
    if (bytesRead < 4 || !hasSupportedSignature(extension, header.subarray(0, bytesRead))) {
      throw new Error('Local audio file signature does not match its format')
    }
    return { extension, size: sourceStats.size }
  } finally {
    await handle.close()
  }
}
