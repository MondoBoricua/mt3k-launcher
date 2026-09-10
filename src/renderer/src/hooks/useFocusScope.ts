import { useLayoutEffect, useRef, type RefObject } from 'react'
import {
  focusElement,
  isActiveFocusScope,
  isElementWithinActiveFocusScope
} from '@renderer/lib/spatialNavigation'

interface FocusScopeOptions<TScope extends HTMLElement> {
  scopeRef: RefObject<TScope>
  resolveFocusTarget: () => HTMLElement | null
  returnFocus?: HTMLElement | null
  ensureVisibleOnEntry?: boolean
}

/**
 * Keeps controller/keyboard focus inside a transient surface for its complete
 * lifetime. Layout-time entry avoids one-frame leaks to the opener, while the
 * observer covers animated content swaps whose focused node leaves the DOM.
 */
export function useFocusScope<TScope extends HTMLElement>({
  scopeRef,
  resolveFocusTarget,
  returnFocus = null,
  ensureVisibleOnEntry = true
}: FocusScopeOptions<TScope>): void {
  const resolveFocusTargetRef = useRef(resolveFocusTarget)
  const returnFocusRef = useRef<HTMLElement | null>(returnFocus)
  const restoreFrameRef = useRef(0)

  useLayoutEffect(() => {
    resolveFocusTargetRef.current = resolveFocusTarget
  }, [resolveFocusTarget])

  useLayoutEffect(() => {
    returnFocusRef.current = returnFocus
  }, [returnFocus])

  useLayoutEffect(() => {
    const scope = scopeRef.current
    if (!scope) return

    cancelAnimationFrame(restoreFrameRef.current)
    const previousFocus =
      returnFocusRef.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null)

    const focusTarget = (): void => {
      if (!isActiveFocusScope(scope)) return
      const current = document.activeElement
      if (
        current instanceof HTMLElement &&
        scope.contains(current) &&
        current.dataset.disabled !== 'true' &&
        !current.matches(':disabled')
      ) {
        return
      }

      const target = resolveFocusTargetRef.current()
      if (
        !target ||
        !target.isConnected ||
        !scope.contains(target) ||
        target.dataset.disabled === 'true' ||
        target.matches(':disabled')
      ) {
        return
      }
      focusElement(target, { ensureVisible: ensureVisibleOnEntry })
    }

    const keepFocusInside = (event: FocusEvent): void => {
      if (event.target instanceof Node && scope.contains(event.target)) return
      focusTarget()
    }

    focusTarget()
    document.addEventListener('focusin', keepFocusInside)
    const observer = new MutationObserver(focusTarget)
    observer.observe(scope, { childList: true, subtree: true })

    return () => {
      document.removeEventListener('focusin', keepFocusInside)
      observer.disconnect()
      let restoreAttempts = 0
      const restorePreviousFocus = (): void => {
        if (
          previousFocus?.isConnected &&
          !previousFocus.closest('[inert]') &&
          isElementWithinActiveFocusScope(previousFocus)
        ) {
          focusElement(previousFocus)
          return
        }

        // A parent usually removes `inert` in a passive effect after the dialog's
        // layout cleanup. Retry for a few frames instead of losing controller
        // focus when that effect lands after our first restoration frame.
        restoreAttempts += 1
        if (previousFocus?.isConnected && restoreAttempts < 4) {
          restoreFrameRef.current = requestAnimationFrame(restorePreviousFocus)
        }
      }
      restoreFrameRef.current = requestAnimationFrame(restorePreviousFocus)
    }
  }, [ensureVisibleOnEntry, scopeRef])
}
