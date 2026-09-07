export const ORBIT_CONTROLLER_MODE_ATTRIBUTE = 'data-orbit-controller-mode'

type ControllerModeRoot = Pick<Element, 'getAttribute' | 'removeAttribute' | 'setAttribute'>
type PointerEventSource = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>

/**
 * Keeps controller cursor state on the document root so every launcher surface,
 * including portals and overlays, follows the same input mode.
 */
export function setControllerCursorMode(root: ControllerModeRoot, active: boolean): void {
  if (active) {
    if (root.getAttribute(ORBIT_CONTROLLER_MODE_ATTRIBUTE) !== 'true') {
      root.setAttribute(ORBIT_CONTROLLER_MODE_ATTRIBUTE, 'true')
    }
    return
  }

  if (root.getAttribute(ORBIT_CONTROLLER_MODE_ATTRIBUTE) === 'true') {
    root.removeAttribute(ORBIT_CONTROLLER_MODE_ATTRIBUTE)
  }
}

/** Restores pointer mode even when the first mouse action is a click without movement. */
export function installPointerCursorRestoration(
  root: ControllerModeRoot,
  eventSource: PointerEventSource
): () => void {
  const restorePointer = (): void => setControllerCursorMode(root, false)
  const options = { capture: true, passive: true } as const

  eventSource.addEventListener('mousemove', restorePointer, options)
  eventSource.addEventListener('pointerdown', restorePointer, options)

  return () => {
    eventSource.removeEventListener('mousemove', restorePointer, options)
    eventSource.removeEventListener('pointerdown', restorePointer, options)
  }
}
