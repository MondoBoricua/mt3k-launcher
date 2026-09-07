interface AudioFormatCandidate {
  bitrate?: number
  mimeType?: string
}

function formatPriority(mimeType: string | undefined): number {
  if (mimeType?.startsWith('audio/webm') && mimeType.includes('opus')) return 2
  if (mimeType?.startsWith('audio/mp4') && mimeType.includes('mp4a')) return 1
  return 0
}

/** Prefer WebM/Opus, but keep AAC/M4A as a real fallback for videos where
 * YouTube does not publish an Opus adaptation. */
export function selectTitleMusicAudioFormat<Format extends AudioFormatCandidate>(
  formats: readonly Format[]
): Format | undefined {
  return [...formats]
    .filter((format) => formatPriority(format.mimeType) > 0)
    .sort((left, right) =>
      formatPriority(right.mimeType) - formatPriority(left.mimeType) ||
      (right.bitrate ?? 0) - (left.bitrate ?? 0)
    )[0]
}

export function titleMusicStreamExtension(mimeType: string): 'webm' | 'm4a' {
  return mimeType.startsWith('audio/webm') ? 'webm' : 'm4a'
}
