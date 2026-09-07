import { useEffect, useRef } from 'react'
import {
  normalizeGameTitleMusicDelay,
  normalizeGameTitleMusicFade,
  normalizeGameTitleMusicVolume,
  type GameTitleMusic as ResolvedTitleMusic
} from '@shared/gameTitleMusic'
import { useTitleMusicStore } from '@renderer/state/titleMusicStore'

interface Props {
  gameId: string | null
  selectionKey?: string
  active: boolean
  suspended?: boolean
  immediateStop?: boolean
  volume: number
  delaySeconds: number
  fadeSeconds: number
}

const RENDERER_CACHE_TTL_MS = 20 * 60 * 1_000
let currentAudio: HTMLAudioElement | null = null
let currentGameId: string | null = null
let currentVideoId: string | null = null
let currentSelectionKey: string | undefined
const retiringAudios = new Set<HTMLAudioElement>()
const activeFades = new WeakMap<HTMLAudioElement, number>()
const audioErrorHandlers = new WeakMap<HTMLAudioElement, () => void>()
const resolvedTracks = new Map<
  string,
  { music: ResolvedTitleMusic; expiresAt: number; selectionKey?: string }
>()

interface PlaybackProfile {
  targetVolume: number
  fadeDurationMs: number
}

function publishPlayingGame(gameId: string | null): void {
  useTitleMusicStore.getState().setPlayingGameId(gameId)
}

function cancelFade(audio: HTMLAudioElement): void {
  const frame = activeFades.get(audio)
  if (frame !== undefined) cancelAnimationFrame(frame)
  activeFades.delete(audio)
}

function disposeAudio(audio: HTMLAudioElement): void {
  cancelFade(audio)
  retiringAudios.delete(audio)
  const errorHandler = audioErrorHandlers.get(audio)
  if (errorHandler) audio.removeEventListener('error', errorHandler)
  audioErrorHandlers.delete(audio)
  audio.pause()
  audio.removeAttribute('src')
  audio.load()
  if (currentAudio === audio) {
    publishPlayingGame(null)
    currentAudio = null
    currentGameId = null
    currentVideoId = null
    currentSelectionKey = undefined
  }
}

function fadeVolume(
  audio: HTMLAudioElement,
  target: number,
  duration: number,
  onComplete?: () => void
): void {
  cancelFade(audio)
  if (duration <= 0) {
    audio.volume = target
    onComplete?.()
    return
  }
  const start = performance.now()
  const initial = audio.volume
  const step = (now: number): void => {
    const progress = Math.max(0, Math.min(1, (now - start) / duration))
    audio.volume = initial + (target - initial) * progress
    if (progress >= 1) {
      activeFades.delete(audio)
      onComplete?.()
      return
    }
    activeFades.set(audio, requestAnimationFrame(step))
  }
  activeFades.set(audio, requestAnimationFrame(step))
}

function stopAudio(audio: HTMLAudioElement, fadeDurationMs: number): void {
  if (audio.paused || audio.volume <= 0.01) {
    disposeAudio(audio)
    return
  }
  retiringAudios.add(audio)
  fadeVolume(audio, 0, fadeDurationMs, () => disposeAudio(audio))
  if (currentAudio === audio) {
    publishPlayingGame(null)
    currentAudio = null
    currentGameId = null
    currentVideoId = null
    currentSelectionKey = undefined
  }
}

function stopCurrentAudio(fadeDurationMs: number): void {
  if (currentAudio) stopAudio(currentAudio, fadeDurationMs)
  if (fadeDurationMs <= 0) {
    for (const retiringAudio of retiringAudios) disposeAudio(retiringAudio)
    retiringAudios.clear()
  }
}

function suspendCurrentAudio(fadeDurationMs: number): void {
  const audio = currentAudio
  if (!audio || audio.paused) return
  if (audio.volume <= 0.01) {
    audio.pause()
    publishPlayingGame(null)
    return
  }
  fadeVolume(audio, 0, fadeDurationMs, () => {
    if (currentAudio === audio) {
      audio.pause()
      publishPlayingGame(null)
    }
  })
}

function resumeCurrentAudio(
  gameId: string,
  selectionKey: string | undefined,
  profile: PlaybackProfile
): boolean {
  const audio = currentAudio
  if (!audio || currentGameId !== gameId || currentSelectionKey !== selectionKey) return false
  cancelFade(audio)
  void audio.play().then(() => {
    if (currentAudio === audio) {
      publishPlayingGame(profile.targetVolume > 0 ? gameId : null)
      fadeVolume(audio, profile.targetVolume, profile.fadeDurationMs)
    }
  }).catch((error: unknown) => {
    if (currentAudio !== audio) return
    resolvedTracks.delete(gameId)
    disposeAudio(audio)
    const reason = error instanceof Error ? error.name : 'unknown error'
    console.warn(`[title-music] Playback failed: ${reason}`)
  })
  return true
}

function playAudio(
  gameId: string,
  music: ResolvedTitleMusic,
  selectionKey: string | undefined,
  profile: PlaybackProfile
): void {
  if (
    currentAudio &&
    currentGameId === gameId &&
    currentSelectionKey === selectionKey &&
    currentVideoId === music.videoId
  ) {
    resumeCurrentAudio(gameId, selectionKey, profile)
    return
  }
  if (currentAudio) stopAudio(currentAudio, profile.fadeDurationMs)
  const audio = new Audio()
  currentAudio = audio
  currentGameId = gameId
  currentVideoId = music.videoId
  currentSelectionKey = selectionKey
  audio.preload = 'auto'
  audio.loop = true
  audio.volume = 0
  audio.src = music.url
  const handleError = (): void => {
    resolvedTracks.delete(gameId)
    disposeAudio(audio)
  }
  audioErrorHandlers.set(audio, handleError)
  audio.addEventListener('error', handleError, { once: true })
  void audio.play().then(() => {
    if (currentAudio === audio) {
      publishPlayingGame(profile.targetVolume > 0 ? gameId : null)
      fadeVolume(audio, profile.targetVolume, profile.fadeDurationMs)
    }
  }).catch((error: unknown) => {
    if (currentAudio !== audio) return
    resolvedTracks.delete(gameId)
    disposeAudio(audio)
    const reason = error instanceof Error ? error.name : 'unknown error'
    console.warn(`[title-music] Playback failed: ${reason}`)
  })
}

function cachedTrack(gameId: string, selectionKey: string | undefined): ResolvedTitleMusic | undefined {
  const cached = resolvedTracks.get(gameId)
  if (!cached) return undefined
  if (cached.expiresAt <= Date.now() || cached.selectionKey !== selectionKey) {
    resolvedTracks.delete(gameId)
    return undefined
  }
  return cached.music
}

export function GameTitleMusic({
  gameId,
  selectionKey,
  active,
  suspended = false,
  immediateStop = false,
  volume,
  delaySeconds,
  fadeSeconds
}: Props): null {
  const targetVolume = normalizeGameTitleMusicVolume(volume) / 100
  const fadeDurationMs = normalizeGameTitleMusicFade(fadeSeconds) * 1_000
  const profile: PlaybackProfile = {
    targetVolume,
    fadeDurationMs
  }
  const resolveDelayMs = normalizeGameTitleMusicDelay(delaySeconds) * 1_000
  const fadeDurationRef = useRef(fadeDurationMs)
  fadeDurationRef.current = fadeDurationMs

  useEffect(() => {
    if (!active || !gameId) {
      stopCurrentAudio(immediateStop ? 0 : profile.fadeDurationMs)
      return
    }
    if (suspended) {
      suspendCurrentAudio(profile.fadeDurationMs)
      return
    }
    if (resumeCurrentAudio(gameId, selectionKey, profile)) return
    if (
      currentGameId &&
      (currentGameId !== gameId || currentSelectionKey !== selectionKey)
    ) {
      // A manual soundtrack change invalidates the currently audible track
      // immediately. The configured delay only applies to starting its replacement.
      stopCurrentAudio(profile.fadeDurationMs)
    }

    let cancelled = false
    const resolveTimer = window.setTimeout(() => {
      const cached = cachedTrack(gameId, selectionKey)
      if (cached) {
        if (!cancelled) playAudio(gameId, cached, selectionKey, profile)
        return
      }
      void window.api.game.resolveTitleMusic(gameId).then((music) => {
        if (cancelled) return
        if (!music) {
          if (currentGameId !== gameId) stopCurrentAudio(profile.fadeDurationMs)
          return
        }
        resolvedTracks.set(gameId, {
          music,
          expiresAt: Date.now() + RENDERER_CACHE_TTL_MS,
          selectionKey
        })
        playAudio(gameId, music, selectionKey, profile)
      }).catch(() => {
        if (!cancelled && currentGameId !== gameId) {
          stopCurrentAudio(profile.fadeDurationMs)
        }
      })
    }, resolveDelayMs)

    return () => {
      cancelled = true
      window.clearTimeout(resolveTimer)
    }
  }, [active, fadeDurationMs, gameId, immediateStop, resolveDelayMs, selectionKey, suspended, targetVolume])

  useEffect(() => () => stopCurrentAudio(fadeDurationRef.current), [])

  return null
}
