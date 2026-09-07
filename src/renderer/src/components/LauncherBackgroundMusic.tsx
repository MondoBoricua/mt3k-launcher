import { useEffect, useRef, useState } from 'react'
import type { LauncherMusicSource } from '@shared/launcherMusic'
import { normalizeLauncherMusicVolume } from '@shared/launcherMusic'
import orbitAmbientUrl from '../assets/audio/orbit-ambient.wav?url'

interface Props {
  active: boolean
  suspended: boolean
  immediateStop?: boolean
  source: LauncherMusicSource
  customUrl?: string
  volume: number
}

const FADE_DURATION_MS = 900
const activeFades = new WeakMap<HTMLAudioElement, number>()

function cancelFade(audio: HTMLAudioElement): void {
  const frame = activeFades.get(audio)
  if (frame !== undefined) cancelAnimationFrame(frame)
  activeFades.delete(audio)
}

function fadeVolume(
  audio: HTMLAudioElement,
  target: number,
  onComplete?: () => void
): void {
  cancelFade(audio)
  const start = performance.now()
  const initial = audio.volume
  const step = (now: number): void => {
    const progress = Math.max(0, Math.min(1, (now - start) / FADE_DURATION_MS))
    const eased = 1 - (1 - progress) ** 3
    audio.volume = initial + (target - initial) * eased
    if (progress >= 1) {
      activeFades.delete(audio)
      onComplete?.()
      return
    }
    activeFades.set(audio, requestAnimationFrame(step))
  }
  activeFades.set(audio, requestAnimationFrame(step))
}

function disposeAudio(audio: HTMLAudioElement): void {
  cancelFade(audio)
  audio.pause()
  audio.removeAttribute('src')
  audio.load()
}

function fadeOutAndDispose(audio: HTMLAudioElement, onComplete?: () => void): void {
  if (audio.paused || audio.volume <= 0.005) {
    disposeAudio(audio)
    onComplete?.()
    return
  }
  fadeVolume(audio, 0, () => {
    disposeAudio(audio)
    onComplete?.()
  })
}

export function LauncherBackgroundMusic({
  active,
  suspended,
  immediateStop = false,
  source,
  customUrl,
  volume
}: Props): null {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const retiringAudiosRef = useRef(new Set<HTMLAudioElement>())
  const [failedCustomUrl, setFailedCustomUrl] = useState<string | null>(null)
  const useCustom = source === 'custom' && Boolean(customUrl) && failedCustomUrl !== customUrl
  const sourceUrl = useCustom ? customUrl! : orbitAmbientUrl
  const targetVolume = normalizeLauncherMusicVolume(volume) / 100

  useEffect(() => {
    if (failedCustomUrl && failedCustomUrl !== customUrl) setFailedCustomUrl(null)
  }, [customUrl, failedCustomUrl])

  useEffect(() => {
    if (!active) {
      const current = audioRef.current
      audioRef.current = null
      if (current) {
        if (immediateStop) disposeAudio(current)
        else {
          retiringAudiosRef.current.add(current)
          fadeOutAndDispose(current, () => retiringAudiosRef.current.delete(current))
        }
      }
      if (immediateStop) {
        for (const retiringAudio of retiringAudiosRef.current) disposeAudio(retiringAudio)
        retiringAudiosRef.current.clear()
      }
      return
    }

    let audio = audioRef.current
    if (!audio || audio.dataset.orbitSource !== sourceUrl) {
      if (audio) {
        const retiringAudio = audio
        retiringAudiosRef.current.add(retiringAudio)
        fadeOutAndDispose(retiringAudio, () => retiringAudiosRef.current.delete(retiringAudio))
      }
      const createdAudio = new Audio()
      createdAudio.dataset.orbitSource = sourceUrl
      createdAudio.preload = 'auto'
      createdAudio.loop = true
      createdAudio.volume = 0
      createdAudio.src = sourceUrl
      createdAudio.addEventListener('error', () => {
        if (audioRef.current !== createdAudio) return
        audioRef.current = null
        disposeAudio(createdAudio)
        if (useCustom && customUrl) setFailedCustomUrl(customUrl)
      }, { once: true })
      audioRef.current = createdAudio
      audio = createdAudio
    }

    if (suspended) {
      if (!audio.paused && audio.volume > 0.005) {
        fadeVolume(audio, 0, () => {
          if (audioRef.current === audio) audio.pause()
        })
      } else {
        audio.pause()
      }
      return
    }

    cancelFade(audio)
    void audio.play().then(() => {
      if (audioRef.current === audio) fadeVolume(audio, targetVolume)
    }).catch(() => {
      if (audioRef.current !== audio) return
      audioRef.current = null
      disposeAudio(audio)
      if (useCustom && customUrl) setFailedCustomUrl(customUrl)
    })
  }, [active, customUrl, immediateStop, sourceUrl, suspended, targetVolume, useCustom])

  useEffect(() => () => {
    const audio = audioRef.current
    audioRef.current = null
    if (audio) disposeAudio(audio)
    for (const retiringAudio of retiringAudiosRef.current) disposeAudio(retiringAudio)
    retiringAudiosRef.current.clear()
  }, [])

  return null
}
