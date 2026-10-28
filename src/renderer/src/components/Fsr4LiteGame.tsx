/**
 * Estado por juego de FSR 4.1 Lite en la ficha.
 * Si el interruptor global está apagado, no se pide nada al proceso principal.
 */
import { useEffect, useState } from 'react'
import type { Fsr4GraphicsApi, Fsr4LiteEvent, Fsr4LiteGameView, Fsr4RenderScale } from '@shared/fsr4LitePolicy'
import { FSR4_GRAPHICS_APIS, FSR4_RENDER_SCALES } from '@shared/fsr4LitePolicy'
import type { TranslationKey } from '@renderer/i18n/translations'
import { useT } from '@renderer/i18n/useT'
import { FocusableButton } from './FocusableButton'

const ERROR_KEYS: Record<string, TranslationKey> = {
  'anti-cheat': 'fsr4Lite.error.antiCheat',
  'windows-apps': 'fsr4Lite.error.windowsApps',
  remote: 'fsr4Lite.error.remote',
  'no-exe': 'fsr4Lite.error.noExe',
  digest: 'fsr4Lite.error.digest',
  tar: 'fsr4Lite.error.tar',
  dll: 'fsr4Lite.error.dll',
  'unsupported-device': 'fsr4Lite.error.unsupported',
  'no-proxy': 'fsr4Lite.error.proxy',
  download: 'fsr4Lite.error.download',
  busy: 'fsr4Lite.busy',
  'backup-missing': 'fsr4Lite.error.backupMissing',
  'scan-incomplete': 'fsr4Lite.error.scanIncomplete',
  running: 'fsr4Lite.error.running',
  'bad-package': 'fsr4Lite.error.badPackage',
  'bad-path': 'fsr4Lite.error.badPath',
  symlink: 'fsr4Lite.error.symlink',
  changed: 'fsr4Lite.error.changed',
  broken: 'fsr4Lite.error.broken',
  layout: 'fsr4Lite.error.layout',
  manifest: 'fsr4Lite.error.manifest',
  disabled: 'fsr4Lite.error.disabled',
  'not-installed': 'fsr4Lite.error.notInstalled',
  reframework: 'fsr4Lite.error.reframework',
  options: 'fsr4Lite.error.options',
  guest: 'fsr4Lite.error.guest'
}

const SCALE_KEYS: Record<Fsr4RenderScale, TranslationKey> = {
  game: 'fsr4Lite.scale.game',
  native: 'fsr4Lite.scale.native',
  quality: 'fsr4Lite.scale.quality',
  balanced: 'fsr4Lite.scale.balanced',
  performance: 'fsr4Lite.scale.performance'
}

const API_KEYS: Record<Fsr4GraphicsApi, TranslationKey> = {
  DX12: 'fsr4Lite.api.dx12',
  DX11: 'fsr4Lite.api.dx11',
  Vulkan: 'fsr4Lite.api.vulkan'
}

const UPSCALER_KEYS: Record<Fsr4LiteGameView['upscalers'][number], TranslationKey> = {
  fsr: 'fsr4Lite.upscaler.fsr',
  dlss: 'fsr4Lite.upscaler.dlss',
  xess: 'fsr4Lite.upscaler.xess'
}

/** El mensaje de Electron trae el código al final. Si no es uno conocido, queda genérico. */
export function fsr4LiteErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const known = Object.keys(ERROR_KEYS)
  for (const code of known) {
    if (message === code || message.endsWith(`: ${code}`)) return code
  }
  return 'generic'
}

export function fsr4LiteErrorKey(code: string): TranslationKey {
  return ERROR_KEYS[code] ?? 'fsr4Lite.error.generic'
}

/**
 * Lee la ficha del juego y se entera si la sesión cambió el estado.
 * Con id null no llama al proceso principal: así la ficha no habla de FSR apagado.
 */
export function useFsr4LiteGame(gameId: string | null): {
  view: Fsr4LiteGameView | null
  replace: (next: Fsr4LiteGameView) => void
} {
  const [view, setView] = useState<Fsr4LiteGameView | null>(null)
  useEffect(() => {
    if (!gameId) {
      setView(null)
      return
    }
    let active = true
    void window.api.fsr4Lite.gameGet(gameId)
      .then((next) => { if (active) setView(next) })
      .catch(() => { if (active) setView(null) })
    const stop = window.api.fsr4Lite.onEvent((event: Fsr4LiteEvent) => {
      if (!active || event.gameId !== gameId) return
      if (event.kind === 'repair') {
        setView((current) => current ? { ...current, phase: 'broken' } : current)
        return
      }
      if (event.kind !== 'session') return
      setView((current) => current ? { ...current, sessionStatus: event.status, resolution: event.resolution } : current)
    })
    return () => {
      active = false
      stop()
    }
  }, [gameId])
  return { view, replace: setView }
}

/** Pastilla en la ficha: widget, o lo que dijo OptiScaler.log al cerrar la sesión. */
export function Fsr4LiteBadge({ view }: { view: Fsr4LiteGameView | null }): JSX.Element | null {
  const t = useT()
  if (!view || view.phase === 'hidden' || view.phase === 'blocked' || view.phase === 'ready') return null
  // Una copia a medias no se presenta como instalada.
  if (view.phase === 'broken') {
    return (
      <span data-fsr4-lite-badge="broken" className="rounded-full border border-amber-200/20 bg-amber-300/10 px-2 py-1 text-amber-100/80">
        {t('fsr4Lite.badge.broken')}
      </span>
    )
  }
  if (view.phase === 'widget') {
    return (
      <span className="inline-flex max-w-full flex-col items-start gap-1">
        <span data-fsr4-lite-badge="widget" className="rounded-full border border-sky-200/20 bg-sky-300/10 px-2 py-1 text-sky-100/80">
          {t('fsr4Lite.widgetInstalled')}
        </span>
        {view.handoffLater ? (
          <span data-fsr4-lite-note="handoff" className="text-xs leading-relaxed text-white/60">
            {t('fsr4Lite.widgetHandoffLater')}
          </span>
        ) : null}
      </span>
    )
  }
  if (view.sessionStatus === 'none') return null
  const key: TranslationKey = view.sessionStatus === 'active'
    ? 'fsr4Lite.badge.active'
    : view.sessionStatus === 'not-lite'
      ? 'fsr4Lite.badge.notLite'
      : view.sessionStatus === 'not-loaded'
        ? 'fsr4Lite.badge.notLoaded'
        : 'fsr4Lite.badge.unknown'
  return (
    <span data-fsr4-lite-badge={view.sessionStatus} className="rounded-full border border-accent/20 bg-accent/10 px-2 py-1 text-accent">
      {t(key)}
      {view.resolution ? ` · ${t('fsr4Lite.badge.resolution', { resolution: view.resolution })}` : ''}
    </span>
  )
}

/** Escala, contador y API. Se guarda al toque, juego por juego. */
export function Fsr4LiteOptions({
  view,
  busy,
  onChange
}: {
  view: Pick<Fsr4LiteGameView, 'renderScale' | 'overlay' | 'graphicsApi' | 'upscalers' | 'noUpscaler' | 'compatNote'>
  busy: boolean
  onChange: (next: { renderScale: Fsr4RenderScale, overlay: boolean, graphicsApi: Fsr4GraphicsApi }) => void
}): JSX.Element {
  const t = useT()
  const apply = (patch: Partial<{ renderScale: Fsr4RenderScale, overlay: boolean, graphicsApi: Fsr4GraphicsApi }>): void => {
    onChange({
      renderScale: patch.renderScale ?? view.renderScale,
      overlay: patch.overlay ?? view.overlay,
      graphicsApi: patch.graphicsApi ?? view.graphicsApi
    })
  }
  const picked = view.upscalers.map((kind) => t(UPSCALER_KEYS[kind])).join(', ')
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-semibold text-white/85">{t('fsr4Lite.renderScale')}</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('fsr4Lite.renderScale')}>
          {FSR4_RENDER_SCALES.map((scale) => (
            <FocusableButton key={scale} type="button" variant={view.renderScale === scale ? 'solid' : 'ghost'}
              data-fsr4-scale={scale} aria-pressed={view.renderScale === scale} disabled={busy}
              onClick={() => apply({ renderScale: scale })}>
              {t(SCALE_KEYS[scale])}
            </FocusableButton>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold text-white/85">{t('fsr4Lite.overlay')}</p>
        <FocusableButton type="button" variant={view.overlay ? 'solid' : 'ghost'} data-fsr4-overlay
          aria-pressed={view.overlay} disabled={busy} onClick={() => apply({ overlay: !view.overlay })}>
          {t('fsr4Lite.overlay')}
        </FocusableButton>
        <p className="mt-2 text-xs leading-relaxed text-muted">{t('fsr4Lite.overlayBody')}</p>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold text-white/85">{t('fsr4Lite.api')}</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('fsr4Lite.api')}>
          {FSR4_GRAPHICS_APIS.map((api) => (
            <FocusableButton key={api} type="button" variant={view.graphicsApi === api ? 'solid' : 'ghost'}
              data-fsr4-api={api} aria-pressed={view.graphicsApi === api} disabled={busy}
              onClick={() => apply({ graphicsApi: api })}>
              {t(API_KEYS[api])}
            </FocusableButton>
          ))}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted">{t('fsr4Lite.api.hint')}</p>
      </div>
      <p className="text-sm leading-relaxed text-white/70">
        {view.noUpscaler || view.upscalers.length === 0
          ? t('fsr4Lite.upscaler.none')
          : t('fsr4Lite.upscaler.pick', { name: picked })}
      </p>
      {view.compatNote ? <p className="break-words text-xs leading-relaxed text-muted">{t('fsr4Lite.compat', { note: view.compatNote })}</p> : null}
    </div>
  )
}
