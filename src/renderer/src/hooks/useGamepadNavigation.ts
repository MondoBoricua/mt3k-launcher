import { useEffect } from 'react'
import { moveFocus, type NavDirection } from '@renderer/lib/spatialNavigation'
import { dispatchBackInput, triggerBack } from '@renderer/lib/backHandlerStack'
import { getVisibleMainViews, useNavigationStore } from '@renderer/state/navigationStore'
import { useLibraryFilterStore } from '@renderer/state/libraryFilterStore'
import { useLibraryStore } from '@renderer/state/libraryStore'
import { useSettingsNavigationStore } from '@renderer/state/settingsNavigationStore'
import { useStoreNavigationStore } from '@renderer/state/storeNavigationStore'
import { useFriendsStore } from '@renderer/state/friendsStore'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { LIBRARY_SEARCH_EVENT, STORE_SEARCH_EVENT } from '@renderer/lib/librarySearch'
import { DISCORD_CHAT_REGION_EVENT } from '@renderer/lib/discordChatNavigation'
import { playUiSound } from '@renderer/lib/uiAudio'
import {
  detectControllerFamily,
  getGamepadInputSignature
} from '@renderer/lib/controllerProfile'
import { useControllerStore } from '@renderer/state/controllerStore'
import { useGameDetailStore } from '@renderer/state/gameDetailStore'
import { ORBIT_PERFORMANCE_MODE_EVENT } from '@renderer/lib/performanceMode'
import { cycleActiveArtworkPicker } from '@renderer/lib/artworkPickerNavigation'
import { resolveGameCardSecondaryActivation } from '@renderer/lib/gameCardActivation'
import { canRequestGameInstall } from '@shared/gameInstallation'
import {
  installPointerCursorRestoration,
  setControllerCursorMode
} from '@renderer/lib/controllerCursorMode'
import {
  dispatchGamepadKeyboardShortcut,
  isGamepadKeyboardOpen,
  shouldUseOrbitKeyboard,
  shouldUseSystemKeyboard,
  showGamepadKeyboardFor
} from '@renderer/lib/gamepadKeyboard'
import {
  nativeControllerButtonPressed,
  STANDARD_GAMEPAD_BUTTON,
  type NativeControllerInputSnapshot
} from '@shared/steamController'

const STICK_DEADZONE = 0.5
const REPEAT_DELAY_MS = 420
const REPEAT_RATE_MS = 130
const CATEGORY_REPEAT_DELAY_MS = 220
const CATEGORY_REPEAT_RATE_MS = 170
const IDLE_GAMEPAD_POLL_MS = 250
const BACKGROUND_GAMEPAD_POLL_MS = 1_000
const CONTROLLER_EMULATED_KEYBOARD_INPUTS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Enter',
  ' ',
  'Escape',
  'Backspace',
  'ContextMenu',
  'q',
  'Q',
  'e',
  'E',
  'y',
  'Y',
  '[',
  ']'
])

// Standard gamepad mapping shared by Chromium and the native Steam fallback.
const BTN_A = STANDARD_GAMEPAD_BUTTON.south
const BTN_B = STANDARD_GAMEPAD_BUTTON.east
const BTN_X = STANDARD_GAMEPAD_BUTTON.west
const BTN_Y = STANDARD_GAMEPAD_BUTTON.north
const BTN_LB = STANDARD_GAMEPAD_BUTTON.leftBumper
const BTN_RB = STANDARD_GAMEPAD_BUTTON.rightBumper
const BTN_LT = STANDARD_GAMEPAD_BUTTON.leftTrigger
const BTN_RT = STANDARD_GAMEPAD_BUTTON.rightTrigger
const BTN_START = STANDARD_GAMEPAD_BUTTON.menu
const DPAD_UP = STANDARD_GAMEPAD_BUTTON.dpadUp
const DPAD_DOWN = STANDARD_GAMEPAD_BUTTON.dpadDown
const DPAD_LEFT = STANDARD_GAMEPAD_BUTTON.dpadLeft
const DPAD_RIGHT = STANDARD_GAMEPAD_BUTTON.dpadRight

type DirectionRepeatState = Partial<Record<NavDirection, number>>
type ConfirmSource = 'gamepad' | 'keyboard'

function confirmFocused(source: ConfirmSource): void {
  const active = document.activeElement as HTMLElement | null
  if (!active?.hasAttribute('data-focusable')) return
  if (!active.hasAttribute('data-ui-sound-skip')) playUiSound('confirm')
  if (source === 'gamepad') {
    const controllerFamily = useControllerStore.getState().family
    if (shouldUseOrbitKeyboard(controllerFamily) && showGamepadKeyboardFor(active)) return
    if (
      shouldUseSystemKeyboard(
        controllerFamily,
        active.dataset.systemGamepadKeyboard === 'true'
      )
    ) {
      active.focus({ preventScroll: true })
      void window.api.system.keyboard
        .show()
        .then((shown) => {
          if (!shown && active.isConnected) showGamepadKeyboardFor(active)
        })
        .catch(() => {
          if (active.isConnected) showGamepadKeyboardFor(active)
        })
      return
    }
  }
  active.click()
}

function activateGameCardSecondary(card: HTMLElement | null): boolean {
  const gameId = card?.dataset.gameId
  if (!gameId) return false
  const target = card?.dataset.gameActivationTarget === 'geforce-now' ? 'geforce-now' : 'default'
  const activation = resolveGameCardSecondaryActivation(
    usePreferencesStore.getState().gameCardPrimaryAction,
    target
  )
  const library = useLibraryStore.getState().snapshot
  const game =
    library.games.find((candidate) => candidate.id === gameId) ??
    library.providerGames.find((candidate) => candidate.id === gameId)
  if (target === 'default' && game && canRequestGameInstall(game)) {
    playUiSound('open')
    useGameDetailStore.getState().openGame(gameId)
    return true
  }
  if (activation.kind === 'details') {
    playUiSound('open')
    useGameDetailStore.getState().openGame(gameId, activation.preferredAction)
    return true
  }
  playUiSound('confirm')
  const launch =
    activation.target === 'geforce-now'
      ? window.api.geforceNow.launchGame(gameId)
      : window.api.game.launch(gameId)
  void launch.catch(() => playUiSound('error'))
  return true
}

function openViewSearch(): void {
  const launchSplash = document.querySelector<HTMLElement>('[data-game-launch-splash="true"]')
  if (launchSplash) {
    if (launchSplash.dataset.launchRevealable !== 'true') return
    playUiSound('open')
    void window.api.game.revealLauncher()
    return
  }
  if (document.querySelector('[data-focus-scope="active"]')) return
  const mainView = useNavigationStore.getState().mainView
  if (mainView === 'applications') {
    const active = document.activeElement as HTMLElement | null
    const editAction = active
      ?.closest<HTMLElement>('[data-application-card]')
      ?.querySelector<HTMLButtonElement>('[data-application-edit-action]')
    if (editAction) {
      playUiSound('open')
      editAction.click()
    }
    return
  }
  if (mainView !== 'library' && mainView !== 'store') return
  playUiSound('open')
  window.dispatchEvent(
    new CustomEvent(mainView === 'library' ? LIBRARY_SEARCH_EVENT : STORE_SEARCH_EVENT)
  )
}

function openNotificationAction(): boolean {
  const action = document.querySelector<HTMLButtonElement>(
    '[data-notification-action="true"]'
  )
  if (!action) return false
  playUiSound('open')
  action.click()
  return true
}

/** Cycles the top-level category tabs — bound to LB/RB (or Q/E on keyboard). */
function cycleMainView(step: 1 | -1): void {
  if (document.querySelector('[data-discord-chat-panel="true"]')) {
    window.dispatchEvent(new CustomEvent(DISCORD_CHAT_REGION_EVENT, { detail: step }))
    playUiSound('switch')
    return
  }
  if (document.querySelector('[data-focus-scope="active"]')) return
  const { mainView, setMainView } = useNavigationStore.getState()
  const { showFriendsHub, showStoreTab } = usePreferencesStore.getState()
  const visibleViews = getVisibleMainViews({ showFriendsHub, showStoreTab })
  const idx = visibleViews.indexOf(mainView)
  const next = visibleViews[(idx + step + visibleViews.length) % visibleViews.length]
  setMainView(next, step)
  playUiSound('switch')
}

/** Cycles the current view's secondary tabs — bound to LT/RT. */
function cycleSecondaryView(step: 1 | -1): void {
  if (cycleActiveArtworkPicker(step)) {
    playUiSound('switch')
    return
  }
  if (document.querySelector('[data-focus-scope="active"]')) return
  const { mainView } = useNavigationStore.getState()
  if (mainView === 'library') useLibraryFilterStore.getState().cycleSource(step)
  else if (mainView === 'friends') useFriendsStore.getState().cycleFilter(step)
  else if (mainView === 'settings') useSettingsNavigationStore.getState().cyclePage(step)
  else if (mainView === 'store') useStoreNavigationStore.getState().cyclePage(step)
  else return
  playUiSound('switch')
}

function isPressed(button: GamepadButton | undefined): boolean {
  return Boolean(button?.pressed || (button?.value ?? 0) > 0.5)
}

/**
 * Global controller + keyboard navigation. Mount once at the app root — it walks
 * whatever `[data-focusable]` elements the currently rendered view exposes, so
 * individual views don't need to know about gamepads at all.
 */
export function useGamepadNavigation(): void {
  useEffect(() => {
    const nextDirectionRepeatAt: DirectionRepeatState = {}
    const previousInputSignatures = new Map<string, string>()
    let activeGamepadKey: string | null = null
    let nativeController: NativeControllerInputSnapshot | null = null
    let rafId = 0
    let pollTimer = 0

    const nativeControllerKey = 'native:steam-controller-2'

    function cancelScheduledPoll(): void {
      cancelAnimationFrame(rafId)
      window.clearTimeout(pollTimer)
      rafId = 0
      pollTimer = 0
    }

    function scheduleNextPoll(hasGamepads: boolean): void {
      cancelScheduledPoll()
      if (document.hidden || !document.hasFocus()) {
        pollTimer = window.setTimeout(
          () => pollGamepads(performance.now()),
          BACKGROUND_GAMEPAD_POLL_MS
        )
        return
      }
      if (!hasGamepads) {
        pollTimer = window.setTimeout(
          () => pollGamepads(performance.now()),
          IDLE_GAMEPAD_POLL_MS
        )
        return
      }
      rafId = requestAnimationFrame(pollGamepads)
    }

    function wakePolling(): void {
      cancelScheduledPoll()
      rafId = requestAnimationFrame(pollGamepads)
    }

    function gamepadKey(gamepad: Gamepad): string {
      return `${gamepad.index}:${gamepad.id}`
    }

    function updateActiveController(pads: Gamepad[]): boolean {
      const connectedKeys = new Set<string>()
      let padWithNewActivity: Gamepad | undefined
      let hasControllerActivity = false

      for (const pad of pads) {
        const key = gamepadKey(pad)
        const signature = getGamepadInputSignature(pad)
        connectedKeys.add(key)
        if (signature) hasControllerActivity = true
        if (signature && signature !== previousInputSignatures.get(key)) padWithNewActivity = pad
        previousInputSignatures.set(key, signature)
      }

      for (const key of previousInputSignatures.keys()) {
        if (!connectedKeys.has(key)) previousInputSignatures.delete(key)
      }

      const activeNativeController =
        activeGamepadKey === nativeControllerKey && nativeController?.connected
      const activePadStillConnected = pads.find((pad) => gamepadKey(pad) === activeGamepadKey)
      const nextActivePad =
        padWithNewActivity ??
        (activeNativeController ? undefined : activePadStillConnected ?? pads[0])
      if (!nextActivePad) {
        if (!activeNativeController) activeGamepadKey = null
        return hasControllerActivity
      }

      const nextKey = gamepadKey(nextActivePad)
      const family = detectControllerFamily(nextActivePad.id)
      const controllerState = useControllerStore.getState()
      if (
        nextKey !== activeGamepadKey ||
        controllerState.family !== family ||
        controllerState.activeGamepadId !== nextActivePad.id
      ) {
        activeGamepadKey = nextKey
        controllerState.setActiveController(family, nextActivePad.id)
      }
      return hasControllerActivity
    }

    function handleDirection(direction: NavDirection, now: number): void {
      const repeatAt = nextDirectionRepeatAt[direction]
      if (repeatAt === undefined) {
        nextDirectionRepeatAt[direction] = now + REPEAT_DELAY_MS
        if (moveFocus(direction)) playUiSound('navigate')
        return
      }
      if (now < repeatAt) return

      // Schedule from the current frame so a high-refresh display or a stalled
      // renderer can never emit several navigation steps for one repeat slot.
      nextDirectionRepeatAt[direction] = now + REPEAT_RATE_MS
      if (moveFocus(direction, { allowNavigationLayerTransition: false })) {
        playUiSound('navigate')
      }
    }

    function releaseDirection(direction: NavDirection): void {
      delete nextDirectionRepeatAt[direction]
    }

    const prevButtons: Record<number, boolean> = {}
    const nextButtonRepeatAt: Record<number, number> = {}

    function handleCyclingButton(
      buttonIndex: number,
      pressed: boolean,
      now: number,
      action: () => void
    ): void {
      if (!pressed) {
        prevButtons[buttonIndex] = false
        delete nextButtonRepeatAt[buttonIndex]
        return
      }

      if (!prevButtons[buttonIndex]) {
        action()
        nextButtonRepeatAt[buttonIndex] = now + CATEGORY_REPEAT_DELAY_MS
      } else if (now >= (nextButtonRepeatAt[buttonIndex] ?? Infinity)) {
        action()
        nextButtonRepeatAt[buttonIndex] = now + CATEGORY_REPEAT_RATE_MS
      }
      prevButtons[buttonIndex] = true
    }

    function pollGamepads(now: number): void {
      const pads = Array.from(navigator.getGamepads?.() ?? []).filter(
        (pad): pad is Gamepad => pad !== null
      )
      const currentNativeController = nativeController
      const hasNativeController = currentNativeController?.connected === true
      const hasNativeControllerActivity =
        currentNativeController !== null &&
        hasNativeController &&
        (currentNativeController.buttons !== 0 ||
          currentNativeController.axisX !== 0 ||
          currentNativeController.axisY !== 0)
      const hasGamepadActivity = updateActiveController(pads)
      if (hasNativeControllerActivity && currentNativeController) {
        // Prefer the exact Valve identity when Steam Input exposes the same
        // physical controller a second time as a generic Xbox-compatible pad.
        activeGamepadKey = nativeControllerKey
        useControllerStore
          .getState()
          .setActiveController('steam', currentNativeController.id)
      }
      const hasControllerActivity = hasGamepadActivity || hasNativeControllerActivity
      const anyButtonPressed = (buttonIndex: number): boolean =>
        pads.some((pad) => isPressed(pad.buttons[buttonIndex])) ||
        nativeControllerButtonPressed(currentNativeController, buttonIndex)

      const directionPressed: Record<NavDirection, boolean> = {
        up: pads.some(
          (pad) => isPressed(pad.buttons[DPAD_UP]) || (pad.axes[1] ?? 0) < -STICK_DEADZONE
        ) || anyButtonPressed(DPAD_UP) || currentNativeController?.axisY === -1,
        down: pads.some(
          (pad) => isPressed(pad.buttons[DPAD_DOWN]) || (pad.axes[1] ?? 0) > STICK_DEADZONE
        ) || anyButtonPressed(DPAD_DOWN) || currentNativeController?.axisY === 1,
        left: pads.some(
          (pad) => isPressed(pad.buttons[DPAD_LEFT]) || (pad.axes[0] ?? 0) < -STICK_DEADZONE
        ) || anyButtonPressed(DPAD_LEFT) || currentNativeController?.axisX === -1,
        right: pads.some(
          (pad) => isPressed(pad.buttons[DPAD_RIGHT]) || (pad.axes[0] ?? 0) > STICK_DEADZONE
        ) || anyButtonPressed(DPAD_RIGHT) || currentNativeController?.axisX === 1
      }

      // Hardware Control owns global/background controller input in the main
      // process. Keeping navigation foreground-only prevents a held shortcut
      // from launching a focused game card while another app is visible.
      if (!document.hasFocus()) {
        for (const buttonIndex of [
          BTN_A,
          BTN_B,
          BTN_X,
          BTN_Y,
          BTN_LB,
          BTN_RB,
          BTN_LT,
          BTN_RT,
          BTN_START
        ]) {
          prevButtons[buttonIndex] = anyButtonPressed(buttonIndex)
          delete nextButtonRepeatAt[buttonIndex]
        }
        releaseDirection('up')
        releaseDirection('down')
        releaseDirection('left')
        releaseDirection('right')
        scheduleNextPoll(pads.length > 0 || hasNativeController)
        return
      }

      if (hasControllerActivity) {
        setControllerCursorMode(document.documentElement, true)
      }

      // Browsers can expose one physical controller more than once (for example
      // through Steam Input). Aggregate all pads before updating shared state so
      // an idle duplicate cannot release a direction pressed on another pad.
      for (const direction of ['up', 'down', 'left', 'right'] as const) {
        directionPressed[direction]
          ? handleDirection(direction, now)
          : releaseDirection(direction)
      }

      const aPressed = anyButtonPressed(BTN_A)
      if (aPressed && !prevButtons[BTN_A]) confirmFocused('gamepad')
      prevButtons[BTN_A] = aPressed

      const bPressed = anyButtonPressed(BTN_B)
      if (bPressed !== prevButtons[BTN_B]) {
        const claimed = dispatchBackInput(bPressed)
        if (bPressed && !claimed && triggerBack()) playUiSound('back')
      }
      prevButtons[BTN_B] = bPressed

      if (isGamepadKeyboardOpen()) {
        handleCyclingButton(BTN_X, anyButtonPressed(BTN_X), now, () => {
          dispatchGamepadKeyboardShortcut('backspace')
        })

        const yPressed = anyButtonPressed(BTN_Y)
        if (yPressed && !prevButtons[BTN_Y]) dispatchGamepadKeyboardShortcut('space')
        prevButtons[BTN_Y] = yPressed

        handleCyclingButton(BTN_LB, anyButtonPressed(BTN_LB), now, () => {
          dispatchGamepadKeyboardShortcut('cursor-left')
        })
        handleCyclingButton(BTN_RB, anyButtonPressed(BTN_RB), now, () => {
          dispatchGamepadKeyboardShortcut('cursor-right')
        })

        const ltPressed = anyButtonPressed(BTN_LT)
        if (ltPressed && !prevButtons[BTN_LT]) dispatchGamepadKeyboardShortcut('shift')
        prevButtons[BTN_LT] = ltPressed

        const rtPressed = anyButtonPressed(BTN_RT)
        if (rtPressed && !prevButtons[BTN_RT]) dispatchGamepadKeyboardShortcut('layout')
        prevButtons[BTN_RT] = rtPressed

        const startPressed = anyButtonPressed(BTN_START)
        if (startPressed && !prevButtons[BTN_START]) dispatchGamepadKeyboardShortcut('done')
        prevButtons[BTN_START] = startPressed

        scheduleNextPoll(pads.length > 0 || hasNativeController)
        return
      }

      const xPressed = anyButtonPressed(BTN_X)
      if (xPressed && !prevButtons[BTN_X]) openNotificationAction()
      prevButtons[BTN_X] = xPressed

      const yPressed = anyButtonPressed(BTN_Y)
      if (yPressed && !prevButtons[BTN_Y]) openViewSearch()
      prevButtons[BTN_Y] = yPressed

      handleCyclingButton(BTN_LB, anyButtonPressed(BTN_LB), now, () => cycleMainView(-1))
      handleCyclingButton(BTN_RB, anyButtonPressed(BTN_RB), now, () => cycleMainView(1))
      handleCyclingButton(BTN_LT, anyButtonPressed(BTN_LT), now, () => cycleSecondaryView(-1))
      handleCyclingButton(BTN_RT, anyButtonPressed(BTN_RT), now, () => cycleSecondaryView(1))

      const startPressed = anyButtonPressed(BTN_START)
      if (startPressed && !prevButtons[BTN_START]) {
        const active = document.activeElement as HTMLElement | null
        activateGameCardSecondary(
          active?.closest<HTMLElement>('[data-game-card="true"]') ?? null
        )
      }
      prevButtons[BTN_START] = startPressed

      scheduleNextPoll(pads.length > 0 || hasNativeController)
    }

    const removePointerCursorRestoration = installPointerCursorRestoration(
      document.documentElement,
      window
    )
    const removeNativeControllerListener = window.api.controllerInput.onState((snapshot) => {
      nativeController = snapshot
      if (
        snapshot.connected &&
        (snapshot.buttons !== 0 || snapshot.axisX !== 0 || snapshot.axisY !== 0)
      ) {
        activeGamepadKey = nativeControllerKey
        useControllerStore.getState().setActiveController('steam', snapshot.id)
      }
      wakePolling()
    })
    wakePolling()

    function isEditingText(): boolean {
      const active = document.activeElement
      if (!(active instanceof HTMLElement)) return false
      return active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable
    }

    function handleKeyDown(e: KeyboardEvent): void {
      if (
        e.target instanceof HTMLElement &&
        e.target.dataset.gamepadKeyboardActive === 'true'
      ) return
      // The Steam desktop profile can emit keyboard events alongside the raw
      // Triton report. While a native control is held, the raw state is the
      // single owner so one press never advances or activates twice.
      if (
        nativeController?.connected &&
        (nativeController.buttons !== 0 ||
          nativeController.axisX !== 0 ||
          nativeController.axisY !== 0) &&
        CONTROLLER_EMULATED_KEYBOARD_INPUTS.has(e.key)
      ) {
        e.preventDefault()
        return
      }
      const editing = isEditingText()

      if (editing) {
        if (
          document.activeElement?.matches('input[type="range"]') &&
          (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
        ) {
          e.preventDefault()
          if (moveFocus(e.key === 'ArrowRight' ? 'right' : 'left')) playUiSound('navigate')
          return
        }
        // Let text inputs keep native caret/selection behaviour; only Escape and
        // vertical moves (leave the field) are still handled by ORBIT's navigation.
        if (e.key === 'Escape') {
          e.preventDefault()
          if (e.repeat) return
          const claimed = dispatchBackInput(true)
          if (!claimed && triggerBack()) playUiSound('back')
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          if (
            moveFocus(e.key === 'ArrowUp' ? 'up' : 'down', {
              allowNavigationLayerTransition: !e.repeat
            })
          ) {
            playUiSound('navigate')
          }
        }
        return
      }

      if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
        const active = document.activeElement as HTMLElement | null
        const card = active?.closest<HTMLElement>('[data-game-card="true"]') ?? null
        if (activateGameCardSecondary(card)) e.preventDefault()
        return
      }

      const map: Record<string, NavDirection> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right'
      }
      if (map[e.key]) {
        e.preventDefault()
        if (moveFocus(map[e.key], { allowNavigationLayerTransition: !e.repeat })) {
          playUiSound('navigate')
        }
        return
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        confirmFocused('keyboard')
        return
      }
      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault()
        if (e.repeat) return
        const claimed = dispatchBackInput(true)
        if (!claimed && triggerBack()) playUiSound('back')
        return
      }
      if (e.key === 'q' || e.key === 'Q') {
        e.preventDefault()
        cycleMainView(-1)
        return
      }
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault()
        cycleMainView(1)
        return
      }
      if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault()
        openViewSearch()
        return
      }
      if (e.key === '[') {
        e.preventDefault()
        cycleSecondaryView(-1)
        return
      }
      if (e.key === ']') {
        e.preventDefault()
        cycleSecondaryView(1)
      }
    }

    function handleKeyUp(e: KeyboardEvent): void {
      if (e.key === 'Escape' || e.key === 'Backspace') dispatchBackInput(false)
    }

    function handleBlur(): void {
      dispatchBackInput(false)
    }

    function handleContextMenu(e: MouseEvent): void {
      const target = e.target
      const card =
        target instanceof Element
          ? target.closest<HTMLElement>('[data-game-card="true"]')
          : null
      if (!card) return
      e.preventDefault()
      card.focus({ preventScroll: true })
      activateGameCardSecondary(card)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('focus', wakePolling)
    window.addEventListener('gamepadconnected', wakePolling)
    window.addEventListener(ORBIT_PERFORMANCE_MODE_EVENT, wakePolling)
    document.addEventListener('visibilitychange', wakePolling)
    window.addEventListener('contextmenu', handleContextMenu)
    return () => {
      cancelScheduledPoll()
      removePointerCursorRestoration()
      removeNativeControllerListener()
      setControllerCursorMode(document.documentElement, false)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('focus', wakePolling)
      window.removeEventListener('gamepadconnected', wakePolling)
      window.removeEventListener(ORBIT_PERFORMANCE_MODE_EVENT, wakePolling)
      document.removeEventListener('visibilitychange', wakePolling)
      window.removeEventListener('contextmenu', handleContextMenu)
    }
  }, [])
}
