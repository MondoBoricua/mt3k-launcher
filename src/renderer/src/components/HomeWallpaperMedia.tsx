import { useEffect, useRef } from 'react'
import { useReducedMotion } from 'framer-motion'
import { useGameDetailStore } from '@renderer/state/gameDetailStore'
import type { HomeWallpaperAsset } from '@shared/ipc'
import {
  isOrbitPerformanceModeActive,
  ORBIT_PERFORMANCE_MODE_EVENT
} from '@renderer/lib/performanceMode'

interface HomeWallpaperMediaProps {
  asset: HomeWallpaperAsset
  className?: string
  alt?: string
  decorative?: boolean
  onError?: () => void
  onReady?: () => void
}

export function HomeWallpaperMedia({
  asset,
  className,
  alt = '',
  decorative = false,
  onError,
  onReady
}: HomeWallpaperMediaProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const reduceMotion = Boolean(useReducedMotion())
  const detailOpen = useGameDetailStore((state) => state.gameId !== null)

  useEffect(() => {
    if (asset.kind !== 'video') return undefined
    const video = videoRef.current
    if (!video) return undefined

    const syncPlayback = (): void => {
      if (document.hidden || reduceMotion || detailOpen || isOrbitPerformanceModeActive()) {
        video.pause()
        return
      }
      void video.play().catch(() => undefined)
    }

    syncPlayback()
    document.addEventListener('visibilitychange', syncPlayback)
    window.addEventListener(ORBIT_PERFORMANCE_MODE_EVENT, syncPlayback)
    return () => {
      document.removeEventListener('visibilitychange', syncPlayback)
      window.removeEventListener(ORBIT_PERFORMANCE_MODE_EVENT, syncPlayback)
      video.pause()
    }
  }, [asset.kind, asset.url, reduceMotion, detailOpen])

  if (asset.kind === 'image') {
    return (
      <img
        src={asset.url}
        alt={decorative ? '' : alt}
        aria-hidden={decorative || undefined}
        draggable={false}
        onError={onError}
        onLoad={onReady}
        className={className}
      />
    )
  }

  return (
    <video
      ref={videoRef}
      src={asset.url}
      autoPlay={!reduceMotion && !detailOpen}
      loop
      muted
      playsInline
      disablePictureInPicture
      preload="auto"
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : alt}
      aria-hidden={decorative || undefined}
      onError={onError}
      onLoadedData={onReady}
      className={className}
    />
  )
}
