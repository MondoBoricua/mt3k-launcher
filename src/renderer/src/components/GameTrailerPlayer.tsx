import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Pause, Play, X } from 'lucide-react'
import type Hls from 'hls.js'
import type { GameTrailer } from '@shared/gameTrailer'
import { trailerMediaUrl } from '@shared/gameTrailer'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useT } from '@renderer/i18n/useT'
import { focusElement } from '@renderer/lib/spatialNavigation'
import { isOrbitPerformanceModeActive, ORBIT_PERFORMANCE_MODE_EVENT } from '@renderer/lib/performanceMode'

export function useTrailerPlaybackAllowed(): boolean {
  const [allowed, setAllowed] = useState(() => !document.hidden && !isOrbitPerformanceModeActive())
  useEffect(() => {
    const sync = (): void => setAllowed(!document.hidden && !isOrbitPerformanceModeActive())
    document.addEventListener('visibilitychange', sync)
    window.addEventListener(ORBIT_PERFORMANCE_MODE_EVENT, sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener(ORBIT_PERFORMANCE_MODE_EVENT, sync)
    }
  }, [])
  return allowed
}

function time(seconds: number): string {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}

function TrailerMedia({ trailer, fullScreen = false }: { trailer: GameTrailer; fullScreen?: boolean }): JSX.Element {
  const t = useT()
  const videoRef = useRef<HTMLVideoElement>(null)
  const retryRef = useRef<HTMLButtonElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const allowed = useTrailerPlaybackAllowed()
  const [paused, setPaused] = useState(false)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.6)
  const playing = allowed && !paused && !failed
  const playingRef = useRef(playing)
  playingRef.current = playing

  useEffect(() => {
    const video = videoRef.current!
    let disposed = false
    let player: Hls | undefined
    setFailed(false)
    setReady(false)
    const fail = (): void => { if (!disposed) { setFailed(true); video.pause(); player?.stopLoad() } }
    const play = (): void => {
      if (!disposed && playingRef.current) void video.play().catch(() => { if (fullScreen && !disposed) setPaused(true) })
    }
    video.addEventListener('canplay', play)
    const customSource = trailer.source === 'custom'
    const url = trailerMediaUrl(trailer.url, customSource)
    if (!url) fail()
    else if (trailer.format === 'hls') {
      void import('hls.js').then(({ default: HlsPlayer }) => {
        if (disposed) return
        if (!HlsPlayer.isSupported()) {
          if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = url; play() }
          else fail()
          return
        }
        player = new HlsPlayer({
          autoStartLoad: false, capLevelToPlayerSize: true, maxBufferLength: 15,
          maxMaxBufferLength: 30, backBufferLength: 10, startLevel: 0,
          xhrSetup: (_xhr, resourceUrl) => {
            if (!trailerMediaUrl(resourceUrl, customSource)) throw new Error('Unsupported trailer media host')
          }
        })
        hlsRef.current = player
        player.on(HlsPlayer.Events.ERROR, (_event, data) => { if (data.fatal) fail() })
        player.on(HlsPlayer.Events.MANIFEST_PARSED, () => {
          if (!fullScreen && player) {
            const level = player.levels.findLastIndex((item) => item.height <= 720)
            if (level >= 0) player.autoLevelCapping = level
          }
          if (playingRef.current) { player?.startLoad(); play() }
        })
        player.loadSource(url)
        player.attachMedia(video)
      }).catch(fail)
    } else { video.src = url; play() }
    return () => {
      disposed = true
      video.removeEventListener('canplay', play)
      video.pause()
      player?.destroy()
      hlsRef.current = null
      video.removeAttribute('src')
      video.load()
    }
  }, [trailer.url, trailer.format, fullScreen, attempt])

  useEffect(() => {
    const video = videoRef.current!
    if (playing) {
      hlsRef.current?.startLoad()
      if (video.readyState >= 2) void video.play().catch(() => setPaused(true))
    } else { video.pause(); hlsRef.current?.stopLoad() }
  }, [playing])

  useEffect(() => {
    if (!playing || ready) return
    const timer = window.setTimeout(() => setFailed(true), 25_000)
    return () => window.clearTimeout(timer)
  }, [playing, ready, attempt])

  useEffect(() => { if (videoRef.current) videoRef.current.volume = volume }, [volume])

  useEffect(() => {
    if (!failed || !fullScreen || document.activeElement !== document.body) return
    const frame = requestAnimationFrame(() => focusElement(retryRef.current))
    return () => cancelAnimationFrame(frame)
  }, [failed, fullScreen])

  const seek = (delta: number): void => {
    const video = videoRef.current!
    if (Number.isFinite(video.duration)) video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + delta))
  }
  const buttonClass = 'rounded-xl border border-white/20 bg-white/10 px-[clamp(1rem,1.3vw,2rem)] py-[clamp(0.75rem,1vw,1.3rem)] text-[clamp(0.9rem,1.05vw,1.3rem)] font-semibold text-white hover:bg-white/20'
  return <>
    <video ref={videoRef} muted={!fullScreen} loop={!fullScreen} playsInline disablePictureInPicture
      preload="none" aria-hidden={!fullScreen || undefined} aria-label={fullScreen ? trailer.title : undefined}
      onPlaying={() => setReady(true)} onWaiting={() => setReady(false)} onCanPlay={() => setReady(true)}
      onError={() => setFailed(true)} onEnded={() => setPaused(true)}
      onTimeUpdate={fullScreen ? () => setPosition(videoRef.current?.currentTime ?? 0) : undefined}
      onDurationChange={fullScreen ? () => setDuration(videoRef.current?.duration ?? 0) : undefined}
      className={fullScreen ? 'absolute inset-0 h-full w-full object-contain' : `pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${ready && !failed ? 'opacity-100' : 'opacity-0'}`} />
    {fullScreen && <>
      {((!ready && !paused) || failed) && <div role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center gap-3 text-lg text-white">
        {!failed && <Loader2 className="animate-spin" />} {t(failed ? 'trailer.error' : 'trailer.loading')}
      </div>}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/90 to-transparent px-8 pb-6 pt-16 text-white">
        <div className="mb-3 flex items-center gap-4 text-sm tabular-nums">
          <span>{time(position)}</span>
          <progress aria-label={trailer.title} max={Number.isFinite(duration) && duration > 0 ? duration : 1} value={position} className="h-1.5 min-w-0 flex-1 accent-accent" />
          <span>{time(duration)}</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {failed ? <button ref={retryRef} data-focusable className={buttonClass} onClick={() => { setPaused(false); setAttempt((value) => value + 1) }}>{t('trailer.retry')}</button> : <>
            <button data-focusable className={buttonClass} onClick={() => seek(-10)}>{t('trailer.back')}</button>
            <button data-focusable className={`${buttonClass} flex items-center gap-2`} onClick={() => {
              if (videoRef.current?.ended) videoRef.current.currentTime = 0
              setPaused((value) => !value)
            }}>{paused ? <Play size={18} /> : <Pause size={18} />}{t(paused ? 'trailer.play' : 'trailer.pause')}</button>
            <button data-focusable className={buttonClass} onClick={() => seek(10)}>{t('trailer.forward')}</button>
            <button data-focusable className={buttonClass} onClick={() => setVolume((value) => Math.max(0, value - 0.1))}>{t('trailer.quieter')}</button>
            <span aria-live="polite" className="w-12 text-center text-sm tabular-nums">{Math.round(volume * 100)}%</span>
            <button data-focusable className={buttonClass} onClick={() => setVolume((value) => Math.min(1, value + 0.1))}>{t('trailer.louder')}</button>
          </>}
        </div>
      </div>
    </>}
  </>
}

export function GameTrailerBackground({ trailer }: { trailer: GameTrailer }): JSX.Element | null {
  const [settled, setSettled] = useState(false)
  const allowed = useTrailerPlaybackAllowed()
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(true), 1000)
    return () => window.clearTimeout(timer)
  }, [])
  return settled && allowed ? <TrailerMedia trailer={trailer} /> : null
}

export function GameTrailerDialog({ trailer, gameName, onClose }: {
  trailer: GameTrailer; gameName: string; onClose: () => void
}): JSX.Element {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  useBackHandler(onClose)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const root = rootRef.current!
    const frame = requestAnimationFrame(() => focusElement(closeRef.current))
    let entered = false
    const change = (): void => {
      if (document.fullscreenElement === root) entered = true
      else if (entered) onClose()
    }
    document.addEventListener('fullscreenchange', change)
    void root.requestFullscreen?.().catch(() => undefined)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('fullscreenchange', change)
      if (document.fullscreenElement === root) void document.exitFullscreen().catch(() => undefined)
      if (previous?.isConnected) requestAnimationFrame(() => focusElement(previous))
    }
  }, [])
  return createPortal(<div ref={rootRef} role="dialog" aria-modal="true" aria-label={`${gameName} — ${t('trailer.watch')}`}
    data-focus-scope="active" className="fixed inset-0 z-[200] bg-black">
    <TrailerMedia trailer={trailer} fullScreen />
    <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-6 bg-gradient-to-b from-black/95 to-transparent px-8 pb-12 pt-6 text-white">
      <div className="min-w-0"><h2 className="truncate text-[clamp(1.25rem,1.5vw,2rem)] font-bold">{gameName}</h2>
        <p className="mt-1 truncate text-[clamp(0.875rem,1vw,1.3rem)] text-white/65">{trailer.title}</p>
        <p className="mt-1 text-xs text-white/50">{t('trailer.source', { source: trailer.source === 'xbox' ? 'Xbox' : trailer.source === 'custom' ? t('metadata.manual') : 'Steam' })}{trailer.matchedByTitle ? ` · ${t('trailer.match')}` : ''}</p>
      </div>
      <button ref={closeRef} data-focusable onClick={onClose} className="flex shrink-0 items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-[clamp(0.9rem,1.05vw,1.3rem)] font-semibold text-white hover:bg-white/20"><X size={20} />{t('trailer.close')}</button>
    </div>
  </div>, document.body)
}
