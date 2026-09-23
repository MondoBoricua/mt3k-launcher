import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useT } from '@renderer/i18n/useT'
import { focusElement } from '@renderer/lib/spatialNavigation'
import { useLaunchProfileStore, reportLaunchProfileError } from '@renderer/state/launchProfileStore'
import { FocusableButton } from './FocusableButton'

/** Mounted only while enabled; no renderer subscriptions exist with the toggle off. */
export function LaunchProfileListener(): JSX.Element | null {
  const pending = useLaunchProfileStore((s) => s.pending)
  useEffect(() => {
    const receive = useLaunchProfileStore.getState().receive
    const dispose = window.api.launchProfiles.onEvent(receive)
    let active = true
    void window.api.launchProfiles.takeError().then((event) => { if (event && active) receive(event) }).catch(reportLaunchProfileError)
    return () => { active = false; dispose(); useLaunchProfileStore.setState({ pending: null }) }
  }, [])
  return pending ? <Confirmation key={pending.token} /> : null
}

function Confirmation(): JSX.Element {
  const t = useT()
  const revert = useLaunchProfileStore((s) => s.revert)
  const confirm = useLaunchProfileStore((s) => s.confirm)
  const button = useRef<HTMLButtonElement>(null)
  useBackHandler(() => void revert())
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const frame = requestAnimationFrame(() => focusElement(button.current))
    return () => { cancelAnimationFrame(frame); if (previous?.isConnected) focusElement(previous) }
  }, [])
  return createPortal(
    <div data-focus-scope="active" role="dialog" aria-modal="true" aria-labelledby="launch-profile-confirm-title" className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 p-6 backdrop-blur-md">
      <section className="w-full max-w-xl space-y-5 rounded-3xl border border-white/15 bg-base p-6 text-text">
        <h2 id="launch-profile-confirm-title" className="text-xl font-bold">{t('launchProfiles.confirmTitle')}</h2>
        <p className="text-sm leading-relaxed text-muted">{t('launchProfiles.confirmBody')}</p>
        <div className="flex flex-wrap gap-3">
          <FocusableButton ref={button} onClick={() => void revert()} variant="ghost">{t('launchProfiles.revert')}</FocusableButton>
          <FocusableButton onClick={() => void confirm()}>{t('launchProfiles.confirm')}</FocusableButton>
        </div>
      </section>
    </div>, document.body
  )
}
