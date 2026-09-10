import type { ImageOrientation } from './ipc'

export type ArtworkResolutionQuality = 'optimal' | 'good' | 'usable' | 'low' | 'unknown'

export interface ArtworkResolutionTarget {
  width: number
  height: number
}

export interface ArtworkResolutionAssessment {
  quality: ArtworkResolutionQuality
  megapixels?: number
  target: ArtworkResolutionTarget
}

export const ARTWORK_RESOLUTION_TARGETS: Readonly<Record<ImageOrientation, ArtworkResolutionTarget>> = {
  vertical: { width: 600, height: 900 },
  horizontal: { width: 1600, height: 900 },
  logo: { width: 1200, height: 400 },
  icon: { width: 512, height: 512 }
}

const MIN_ASPECT_SUITABILITY: Readonly<Record<ImageOrientation, number>> = {
  vertical: 0.72,
  horizontal: 0.5,
  logo: 0.3,
  icon: 0.72
}

export function assessArtworkResolution(
  width: number | undefined,
  height: number | undefined,
  orientation: ImageOrientation
): ArtworkResolutionAssessment {
  const target = ARTWORK_RESOLUTION_TARGETS[orientation]
  if (
    width === undefined ||
    height === undefined ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return { quality: 'unknown', target }
  }

  const sourceRatio = width / height
  const targetRatio = target.width / target.height
  const aspectSuitability = Math.min(sourceRatio / targetRatio, targetRatio / sourceRatio)
  const visibleWidth = sourceRatio >= targetRatio ? height * targetRatio : width
  const visibleHeight = sourceRatio >= targetRatio ? height : width / targetRatio
  const coverage = Math.min(visibleWidth / target.width, visibleHeight / target.height)
  const megapixels = (width * height) / 1_000_000

  if (aspectSuitability < MIN_ASPECT_SUITABILITY[orientation]) {
    return { quality: 'low', megapixels, target }
  }
  if (coverage >= 1) return { quality: 'optimal', megapixels, target }
  if (coverage >= 0.65) return { quality: 'good', megapixels, target }
  if (coverage >= 0.4) return { quality: 'usable', megapixels, target }
  return { quality: 'low', megapixels, target }
}
