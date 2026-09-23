import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { Camera, FastForward, Loader2, Play, Power, Save, Upload } from 'lucide-react'
import type { TranslationKey } from '@renderer/i18n/translations'
import type { RetroArchCommandError, RetroArchStatusSnapshot } from '@shared/retroArchCommands'
import {
  openShouldPause,
  parseStatus,
  pauseMenuActions,
  resumeShouldUnpause,
  type RetroArchStatus,
  type RetroPauseMenuActionId
} from '@shared/retroArchCommands'
import { FocusableButton } from './FocusableButton'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useT } from '@renderer/i18n/useT'
import { focusElement } from '@renderer/lib/spatialNavigation'
import { playUiSound } from '@renderer/lib/uiAudio'

const ACTION_LABEL: Record<RetroPauseMenuActionId, 'retroPauseMenu.resume' | 'retroPauseMenu.saveState' | 'retroPauseMenu.loadState' | 'retroPauseMenu.screenshot' | 'retroPauseMenu.fastForward' | 'retroPauseMenu.quit'> = {
  resume: 'retroPauseMenu.resume',
  saveState: 'retroPauseMenu.saveState',
  loadState: 'retroPauseMenu.loadState',
  screenshot: 'retroPauseMenu.screenshot',
  fastForward: 'retroPauseMenu.fastForward',
  quit: 'retroPauseMenu.quit'
}

function statusFromSnapshot(snapshot: RetroArchStatusSnapshot | null): RetroArchStatus {
  if (!snapshot?.reply) return { playback: snapshot?.playback ?? 'UNKNOWN', raw: '' }
  return parseStatus(snapshot.reply)
}

function errorKey(error: RetroArchCommandError | 'return-failed'): TranslationKey {
  switch (error) {
    case 'timeout':
      return 'retroPauseMenu.error.timeout'
    case 'rejected':
      return 'retroPauseMenu.error.rejected'
    case 'disabled':
      return 'retroPauseMenu.error.disabled'
    case 'not-retroarch':
      return 'retroPauseMenu.error.notRetroarch'
    case 'unrecognized':
      return 'retroPauseMenu.error.unrecognized'
    case 'return-failed':
      return 'retroPauseMenu.error.returnFailed'
    default:
      return 'retroPauseMenu.error.unreachable'
  }
}

/**
 * Menú a pantalla completa para guardar, cargar o salir de RetroArch
 * con el control. Solo se monta cuando el ajuste está prendido, y
 * solo se abre cuando el atajo trae el launcher al frente.
 */
export function RetroPauseMenu(): JSX.Element | null {
  const t = useT()
  const resumeRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [snapshot, setSnapshot] = useState<RetroArchStatusSnapshot | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const refreshStatus = useCallback(async (): Promise<RetroArchStatusSnapshot> => {
    const next = await window.api.retroArch.status()
    setSnapshot(next)
    if (next.error) setFailure(t(errorKey(next.error)))
    else setFailure(null)
    return next
  }, [t])

  const closeMenu = useCallback((): void => {
    setOpen(false)
    setNotice(null)
  }, [])

  const resume = useCallback(async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      const current = statusFromSnapshot(snapshot)
      if (resumeShouldUnpause(current)) {
        const unpaused = await window.api.retroArch.command('PAUSE_TOGGLE')
        if (!unpaused.ok) {
          setFailure(t(errorKey(unpaused.error ?? 'unreachable')))
          playUiSound('error')
          return
        }
      }
      const returned = await window.api.retroArch.returnToGame()
      if (!returned) {
        setFailure(t('retroPauseMenu.error.returnFailed'))
        playUiSound('error')
        return
      }
      playUiSound('confirm')
      closeMenu()
    } catch (error) {
      console.warn(
        `[retro-pause-menu] no se pudo reanudar: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      setFailure(t('retroPauseMenu.error.unreachable'))
      playUiSound('error')
    } finally {
      setBusy(false)
    }
  }, [busy, closeMenu, snapshot, t])

  useBackHandler(() => {
    void resume()
  }, open)

  useEffect(() => {
    return window.api.retroArch.onPauseRequested(() => {
      setNotice(null)
      setFailure(null)
      setOpen(true)
    })
  }, [])

  useEffect(() => {
    if (!open) return
    return window.api.game.onLaunchStatus((status) => {
      if (status.phase !== 'running' || status.retroArchSession !== true) closeMenu()
    })
  }, [closeMenu, open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setBusy(true)
    void (async () => {
      try {
        const first = await refreshStatus()
        if (cancelled) return
        if (openShouldPause(statusFromSnapshot(first))) {
          const paused = await window.api.retroArch.command('PAUSE_TOGGLE')
          if (cancelled) return
          if (!paused.ok) {
            setFailure(t(errorKey(paused.error ?? 'unreachable')))
            playUiSound('error')
          } else {
            await refreshStatus()
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.warn(
            `[retro-pause-menu] no se pudo leer el estado: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
          setFailure(t('retroPauseMenu.error.unreachable'))
          playUiSound('error')
        }
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, refreshStatus, t])

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement as HTMLElement | null
    const frame = requestAnimationFrame(() => focusElement(resumeRef.current))
    return () => {
      cancelAnimationFrame(frame)
      if (previousFocus?.isConnected) requestAnimationFrame(() => focusElement(previousFocus))
    }
  }, [open])

  const runAction = async (id: RetroPauseMenuActionId): Promise<void> => {
    if (busy) return
    if (id === 'resume') {
      await resume()
      return
    }
    const action = pauseMenuActions(statusFromSnapshot(snapshot)).find((item) => item.id === id)
    if (!action?.enabled) return
    setBusy(true)
    setNotice(null)
    try {
      const result = await window.api.retroArch.command(action.command)
      if (!result.ok) {
        setFailure(t(errorKey(result.error ?? 'unreachable')))
        playUiSound('error')
        return
      }
      playUiSound('confirm')
      setNotice(t('retroPauseMenu.sent'))
      if (id === 'quit') {
        closeMenu()
        return
      }
      await refreshStatus()
    } catch (error) {
      console.warn(
        `[retro-pause-menu] el comando falló: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      setFailure(t('retroPauseMenu.error.unreachable'))
      playUiSound('error')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const status = statusFromSnapshot(snapshot)
  const actions = pauseMenuActions(status)
  const playbackLabel =
    status.playback === 'PLAYING'
      ? t('retroPauseMenu.statusPlaying')
      : status.playback === 'PAUSED'
        ? t('retroPauseMenu.statusPaused')
        : status.playback === 'CONTENTLESS'
          ? t('retroPauseMenu.statusContentless')
          : t('retroPauseMenu.statusUnknown')
  const gameName = status.game

  return createPortal(
    <motion.div
      data-focus-scope="active"
      data-retro-pause-menu="true"
      role="dialog"
      aria-modal="true"
      aria-labelledby="retro-pause-menu-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-[clamp(0.75rem,3vw,3rem)] backdrop-blur-2xl"
    >
      <motion.section
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-[clamp(1.25rem,2.5vw,2rem)] border border-white/10 bg-surface shadow-[0_38px_130px_rgba(0,0,0,0.82)]"
      >
        <div className="px-[clamp(1.25rem,3vw,2.25rem)] pb-4 pt-[clamp(1.25rem,3vw,2.25rem)]">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">
            {t('retroPauseMenu.title')}
          </p>
          <h2
            id="retro-pause-menu-title"
            className="mt-2 text-[clamp(1.5rem,3vw,2.2rem)] font-black leading-tight tracking-[-0.03em] text-white"
          >
            {gameName || playbackLabel}
          </h2>
          <p className="mt-2 text-sm text-white/60" role="status">
            {busy ? t('retroPauseMenu.working') : playbackLabel}
          </p>
          {snapshot?.reply && (
            <p className="mt-2 break-all text-xs text-white/40">
              {t('retroPauseMenu.reply', { reply: snapshot.reply.trim() })}
            </p>
          )}
          {failure && (
            <p role="alert" className="mt-3 text-sm text-amber-200">
              {failure}
            </p>
          )}
          {notice && !failure && (
            <p role="status" className="mt-3 text-sm text-white/70">
              {notice}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 px-[clamp(1.25rem,3vw,2.25rem)] pb-4">
          {actions.map((action) => {
            const Icon =
              action.id === 'resume'
                ? Play
                : action.id === 'saveState'
                  ? Save
                  : action.id === 'loadState'
                    ? Upload
                    : action.id === 'screenshot'
                      ? Camera
                      : action.id === 'fastForward'
                        ? FastForward
                        : Power
            return (
              <FocusableButton
                key={action.id}
                ref={action.id === 'resume' ? resumeRef : undefined}
                variant={action.id === 'resume' ? 'solid' : 'ghost'}
                disabled={!action.enabled || busy}
                data-disabled={!action.enabled || busy ? 'true' : undefined}
                onClick={() => void runAction(action.id)}
                className="flex w-full items-center justify-start gap-3 rounded-2xl px-5 py-4 text-left"
              >
                {busy && action.id === 'resume' ? <Loader2 size={16} className="animate-spin" /> : <Icon size={16} />}
                <span>{t(ACTION_LABEL[action.id])}</span>
              </FocusableButton>
            )
          })}
        </div>

        <p className="px-[clamp(1.25rem,3vw,2.25rem)] pb-[clamp(1.25rem,3vw,2rem)] text-xs text-white/40">
          {t('retroPauseMenu.hint')}
        </p>
      </motion.section>
    </motion.div>,
    document.body
  )
}
