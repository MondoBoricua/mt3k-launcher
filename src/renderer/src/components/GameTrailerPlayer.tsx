import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Maximize2, Minimize2, Pause, Play, X } from 'lucide-react'
import type Hls from 'hls.js'
import type { GameTrailer } from '@shared/gameTrailer'
import {
  GAME_TRAILER_INTRO_SKIP_SECONDS,
  gameTrailerStartPosition,
  trailerMediaUrl,
  YOUTUBE_TRAILER_EMBED_ORIGIN,
  youtubeTrailerEmbedUrl
} from '@shared/gameTrailer'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useFocusScope } from '@renderer/hooks/useFocusScope'
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

function initialPosition(video: HTMLVideoElement): number {
  if (Number.isFinite(video.duration) && video.duration > 0) {
    return gameTrailerStartPosition(video.duration)
  }
  if (video.seekable.length > 0) {
    const first = video.seekable.start(0)
    const last = video.seekable.end(video.seekable.length - 1)
    return gameTrailerStartPosition(last - first, first)
  }
  return gameTrailerStartPosition(Number.NaN)
}

function seekToTrailerStart(video: HTMLVideoElement): number | undefined {
  if (video.readyState < HTMLMediaElement.HAVE_METADATA) return undefined
  const position = initialPosition(video)
  try {
    video.currentTime = position
    return position
  } catch {
    return undefined
  }
}

function YouTubeTrailerMedia({ trailer, fullScreen, compact = false, active = true }: {
  trailer: GameTrailer
  fullScreen: boolean
  compact?: boolean
  active?: boolean
}): JSX.Element {
  const t = useT()
  const allowed = useTrailerPlaybackAllowed()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const retryRef = useRef<HTMLButtonElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [paused, setPaused] = useState(false)
  const [position, setPosition] = useState(GAME_TRAILER_INTRO_SKIP_SECONDS)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(60)
  const src = youtubeTrailerEmbedUrl(
    trailer.youtubeVideoId,
    fullScreen ? 'player' : 'background'
  )

  useEffect(() => {
    setLoaded(false)
    setReady(false)
    setFailed(!src)
    setPaused(false)
    setPosition(GAME_TRAILER_INTRO_SKIP_SECONDS)
    setDuration(0)
  }, [src, attempt])

  useEffect(() => {
    if (!src || loaded || failed) return
    const timer = window.setTimeout(() => setFailed(true), 20_000)
    return () => window.clearTimeout(timer)
  }, [src, loaded, failed, attempt])

  // YouTube briefly paints its own center controls while starting. Keep that
  // frame hidden so the background and dialog reveal only the clean video.
  useEffect(() => {
    if (!loaded || failed) return
    const timer = window.setTimeout(() => setReady(true), 2_200)
    return () => window.clearTimeout(timer)
  }, [loaded, failed, attempt])

  const sendCommand = (func: string, args: unknown[] = []): void => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func, args }),
      YOUTUBE_TRAILER_EMBED_ORIGIN
    )
  }

  useEffect(() => {
    if (!loaded) return
    sendCommand(allowed && active ? 'playVideo' : 'pauseVideo')
    setPaused(!allowed || !active)
  }, [active, allowed, loaded])

  useEffect(() => {
    const receive = (event: MessageEvent): void => {
      if (
        event.origin !== YOUTUBE_TRAILER_EMBED_ORIGIN ||
        event.source !== iframeRef.current?.contentWindow
      ) return
      try {
        const payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        if (!payload || typeof payload !== 'object') return
        if (payload.event === 'onStateChange' && typeof payload.info === 'number') {
          if (payload.info === 0) {
            if (fullScreen) setPaused(true)
            else {
              sendCommand('seekTo', [GAME_TRAILER_INTRO_SKIP_SECONDS, true])
              sendCommand('playVideo')
            }
          } else if (payload.info === 1) setPaused(false)
          else if (payload.info === 2) setPaused(true)
        }
        if (payload.event !== 'infoDelivery' || !payload.info || typeof payload.info !== 'object') return
        const info = payload.info as Record<string, unknown>
        if (typeof info.currentTime === 'number' && Number.isFinite(info.currentTime)) {
          setPosition(Math.max(0, info.currentTime))
        }
        if (typeof info.duration === 'number' && Number.isFinite(info.duration)) {
          setDuration(Math.max(0, info.duration))
        }
      } catch {
        // Ignore malformed or unrelated provider messages.
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [fullScreen])

  useEffect(() => {
    if (!failed || !fullScreen || document.activeElement !== document.body) return
    const frame = requestAnimationFrame(() => focusElement(retryRef.current))
    return () => cancelAnimationFrame(frame)
  }, [failed, fullScreen])

  const seek = (delta: number): void => {
    const target = Math.max(0, duration > 0 ? Math.min(duration, position + delta) : position + delta)
    setPosition(target)
    sendCommand('seekTo', [target, true])
  }
  const changeVolume = (delta: number): void => {
    const next = Math.max(0, Math.min(100, volume + delta))
    setVolume(next)
    sendCommand('setVolume', [next])
  }
  const buttonClass = compact
    ? 'rounded-lg border border-white/15 bg-black/55 px-3 py-2 text-xs font-semibold text-white hover:bg-white/15'
    : 'rounded-xl border border-white/20 bg-white/10 px-[clamp(1rem,1.3vw,2rem)] py-[clamp(0.75rem,1vw,1.3rem)] text-[clamp(0.9rem,1.05vw,1.3rem)] font-semibold text-white hover:bg-white/20'
  return <>
    {src && !failed && (
      <iframe
        ref={iframeRef}
        key={attempt}
        src={src}
        title={fullScreen ? trailer.title : ''}
        aria-hidden={!fullScreen || undefined}
        tabIndex={-1}
        allow="autoplay; encrypted-media; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-presentation"
        onLoad={() => {
          setLoaded(true)
          iframeRef.current?.contentWindow?.postMessage(
            JSON.stringify({ event: 'listening', id: `orbit-trailer-${trailer.youtubeVideoId}` }),
            YOUTUBE_TRAILER_EMBED_ORIGIN
          )
          sendCommand('addEventListener', ['onStateChange'])
          sendCommand('setVolume', [volume])
          sendCommand('playVideo')
        }}
        onError={() => setFailed(true)}
        className={fullScreen
          ? `pointer-events-none absolute -top-16 left-0 h-[calc(100%+8rem)] w-full border-0 bg-black transition-opacity duration-500 ${ready ? 'opacity-100' : 'opacity-0'}`
          : `pointer-events-none absolute -top-12 left-0 h-[calc(100%+6rem)] w-full border-0 transition-opacity duration-700 ${ready ? 'opacity-100' : 'opacity-0'}`}
      />
    )}
    {fullScreen && (!ready || failed) && (
      <div role="status" className={`absolute inset-0 flex items-center justify-center gap-3 bg-black text-white ${compact ? 'text-sm' : 'text-lg'}`}>
        {failed ? (
          <button ref={retryRef} data-focusable className={buttonClass} onClick={() => {
            setFailed(false)
            setAttempt((value) => value + 1)
          }}>{t('trailer.retry')}</button>
        ) : <><Loader2 className="animate-spin" />{t('trailer.loading')}</>}
      </div>
    )}
    {fullScreen && ready && !failed && (
      <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/90 to-transparent text-white ${compact ? 'px-3 pb-3 pt-12' : 'px-8 pb-6 pt-16'}`}>
        <div className={`flex items-center tabular-nums ${compact ? 'mb-2 gap-2 text-[10px]' : 'mb-3 gap-4 text-sm'}`}>
          <span>{time(position)}</span>
          <progress aria-label={trailer.title} max={duration > 0 ? duration : 1} value={position} className="h-1.5 min-w-0 flex-1 accent-accent" />
          <span>{time(duration)}</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button data-focusable className={buttonClass} onClick={() => seek(-10)}>{t('trailer.back')}</button>
          <button data-focusable className={`${buttonClass} flex items-center gap-2`} onClick={() => {
            sendCommand(paused ? 'playVideo' : 'pauseVideo')
            setPaused((value) => !value)
          }}>{paused ? <Play size={18} /> : <Pause size={18} />}{t(paused ? 'trailer.play' : 'trailer.pause')}</button>
          <button data-focusable className={buttonClass} onClick={() => seek(10)}>{t('trailer.forward')}</button>
          {!compact && <>
            <button data-focusable className={buttonClass} onClick={() => changeVolume(-10)}>{t('trailer.quieter')}</button>
            <span aria-live="polite" className="w-12 text-center text-sm tabular-nums">{volume}%</span>
            <button data-focusable className={buttonClass} onClick={() => changeVolume(10)}>{t('trailer.louder')}</button>
          </>}
        </div>
      </div>
    )}
  </>
}

function NativeTrailerMedia({ trailer, fullScreen = false }: { trailer: GameTrailer; fullScreen?: boolean }): JSX.Element {
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
    let startApplied = false
    setFailed(false)
    setReady(false)
    const fail = (): void => { if (!disposed) { setFailed(true); video.pause(); player?.stopLoad() } }
    const applyInitialPosition = (): boolean => {
      if (startApplied) return true
      const nextPosition = seekToTrailerStart(video)
      if (nextPosition === undefined) return false
      startApplied = true
      if (fullScreen) setPosition(nextPosition)
      return true
    }
    const play = (): void => {
      if (!disposed && applyInitialPosition() && playingRef.current) {
        void video.play().catch(() => { if (fullScreen && !disposed) setPaused(true) })
      }
    }
    const metadataReady = (): void => { if (applyInitialPosition()) play() }
    video.addEventListener('loadedmetadata', metadataReady)
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
          autoStartLoad: false,
          capLevelToPlayerSize: true,
          maxBufferLength: 15,
          maxMaxBufferLength: 30,
          backBufferLength: 10,
          startLevel: 0,
          xhrSetup: (_xhr, resourceUrl) => {
            if (!trailerMediaUrl(resourceUrl, customSource)) throw new Error('Unsupported trailer media host')
          }
        })
        hlsRef.current = player
        player.on(HlsPlayer.Events.ERROR, (_event, data) => { if (data.fatal) fail() })
        player.on(HlsPlayer.Events.MANIFEST_PARSED, () => {
          if (!fullScreen && player) {
            const level = player.levels.findLastIndex((item) => item.height <= 720)
            player.autoLevelCapping = level >= 0 ? level : 0
          }
          if (playingRef.current) { player?.startLoad(); play() }
        })
        player.loadSource(url)
        player.attachMedia(video)
      }).catch(fail)
    } else { video.src = url; play() }
    return () => {
      disposed = true
      video.removeEventListener('loadedmetadata', metadataReady)
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
  const handleEnded = (): void => {
    const video = videoRef.current
    if (!video) return
    if (fullScreen) {
      setPaused(true)
      return
    }
    const nextPosition = seekToTrailerStart(video)
    if (nextPosition !== undefined && playingRef.current) void video.play().catch(() => undefined)
  }
  const buttonClass = 'rounded-xl border border-white/20 bg-white/10 px-[clamp(1rem,1.3vw,2rem)] py-[clamp(0.75rem,1vw,1.3rem)] text-[clamp(0.9rem,1.05vw,1.3rem)] font-semibold text-white hover:bg-white/20'
  return <>
    <video ref={videoRef} muted={!fullScreen} playsInline disablePictureInPicture
      preload="none" aria-hidden={!fullScreen || undefined} aria-label={fullScreen ? trailer.title : undefined}
      onPlaying={() => setReady(true)} onWaiting={() => setReady(false)} onCanPlay={() => setReady(true)}
      onError={() => setFailed(true)} onEnded={handleEnded}
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
              if (videoRef.current?.ended) seekToTrailerStart(videoRef.current)
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

function TrailerMedia({ trailer, fullScreen = false }: { trailer: GameTrailer; fullScreen?: boolean }): JSX.Element {
  return trailer.format === 'youtube'
    ? <YouTubeTrailerMedia trailer={trailer} fullScreen={fullScreen} />
    : <NativeTrailerMedia trailer={trailer} fullScreen={fullScreen} />
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

export function GameTrailerInlinePlayer({
  trailer,
  onExpand,
  suspended = false
}: {
  trailer: GameTrailer
  onExpand?: (trigger: HTMLButtonElement) => void
  suspended?: boolean
}): JSX.Element | null {
  const t = useT()
  if (trailer.format !== 'youtube' || !trailer.youtubeVideoId) return null
  return (
    <div
      data-achievement-guide-player="true"
      role="group"
      aria-label={trailer.title}
      aria-hidden={suspended || undefined}
      className="relative aspect-video min-h-0 w-full overflow-hidden rounded-xl border border-white/10 bg-black shadow-[0_18px_55px_rgba(0,0,0,0.55)]"
    >
      <YouTubeTrailerMedia trailer={trailer} fullScreen compact active={!suspended} />
      {onExpand && (
        <button
          type="button"
          data-focusable
          data-achievement-video-expand="true"
          aria-label={t('achievements.videoExpand')}
          onClick={(event) => onExpand(event.currentTarget)}
          className="absolute right-3 top-3 z-10 flex min-h-10 items-center gap-2 rounded-xl border border-white/20 bg-black/75 px-3 text-xs font-black text-white shadow-lg backdrop-blur-md transition-colors hover:bg-white/20"
        >
          <Maximize2 size={16} />
          <span>{t('achievements.videoExpand')}</span>
        </button>
      )}
    </div>
  )
}

export function GameTrailerPanelPlayer({
  trailer,
  returnFocus,
  onClose
}: {
  trailer: GameTrailer
  returnFocus: HTMLElement | null
  onClose: () => void
}): JSX.Element {
  const t = useT()
  const scopeRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useBackHandler(onClose)
  useFocusScope({
    scopeRef,
    returnFocus,
    resolveFocusTarget: () => closeRef.current,
    ensureVisibleOnEntry: false
  })

  return (
    <div
      ref={scopeRef}
      data-achievement-guide-expanded="true"
      data-focus-scope="active"
      role="dialog"
      aria-modal="true"
      aria-label={`${t('achievements.videoSolution')}: ${trailer.title}`}
      className="absolute inset-0 z-[60] overflow-hidden bg-black"
    >
      <TrailerMedia trailer={trailer} fullScreen />
      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-6 bg-gradient-to-b from-black/95 via-black/70 to-transparent px-[clamp(1rem,2.5vw,2.5rem)] pb-16 pt-[clamp(1rem,2.5vh,1.75rem)] text-white">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-amber-200/80">
            {t('achievements.videoSolution')} · Plus
          </p>
          <h3 className="mt-1 truncate text-[clamp(1rem,1.7vw,1.6rem)] font-bold text-white/90">
            {trailer.title}
          </h3>
        </div>
        <button
          ref={closeRef}
          type="button"
          data-focusable
          data-achievement-video-collapse="true"
          onClick={onClose}
          className="flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-white/20 bg-black/65 px-4 text-sm font-bold text-white shadow-lg backdrop-blur-md transition-colors hover:bg-white/20"
        >
          <Minimize2 size={18} />
          {t('achievements.videoCollapse')}
        </button>
      </div>
    </div>
  )
}

export function GameTrailerDialog({ trailer, gameName, sourceLabel, onClose }: {
  trailer: GameTrailer; gameName: string; sourceLabel?: string; onClose: () => void
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
    data-focus-scope="active" className="fixed inset-0 z-[200] overflow-hidden bg-black">
    <TrailerMedia trailer={trailer} fullScreen />
    <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-6 bg-gradient-to-b from-black/95 to-transparent px-8 pb-12 pt-6 text-white">
      <div className="min-w-0"><h2 className="truncate text-[clamp(1.25rem,1.5vw,2rem)] font-bold">{gameName}</h2>
        <p className="mt-1 truncate text-[clamp(0.875rem,1vw,1.3rem)] text-white/65">{trailer.title}</p>
        <p className="mt-1 text-xs text-white/50">{sourceLabel ?? t('trailer.source', { source: trailer.source === 'xbox' ? 'Xbox' : trailer.source === 'custom' ? t('metadata.manual') : 'Steam' })}{trailer.matchedByTitle ? ` · ${t('trailer.match')}` : ''}</p>
      </div>
      <button ref={closeRef} data-focusable onClick={onClose} className="flex shrink-0 items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-[clamp(0.9rem,1.05vw,1.3rem)] font-semibold text-white hover:bg-white/20"><X size={20} />{t('trailer.close')}</button>
    </div>
  </div>, document.body)
}
