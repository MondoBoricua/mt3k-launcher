import { existsSync } from 'node:fs'
import { app, screen } from 'electron'
import Store from 'electron-store'
import { join } from 'node:path'
import { settingsStore } from './settingsStore'
import { captureDisplay, listDisplayModes, applyDisplay } from './displayModeService'
import { clearRestoreJournal, readRestoreJournal, writeRestoreJournal } from './launchProfileJournal'
import { LaunchProfileTransaction } from './launchProfileTransaction'
import {
  decideDiscardPendingRestore,
  decideLaunchWithPendingJournal,
  detectDisplayMode,
  isProfile,
  selectProfile,
  shouldRecoverDisplayJournalOnStartup,
  shouldRetryPendingDisplayRestore,
  validateProfile,
  type DisplayMode,
  type DisplayModeList,
  type LaunchProfileDiscardResult,
  type LaunchProfileEntry,
  type LaunchProfileEvent
} from '@shared/launchProfilePolicy'

let profiles: Store<Record<string, LaunchProfileEntry>> | undefined
let transaction: LaunchProfileTransaction | undefined
let notify: (event: LaunchProfileEvent) => void = () => undefined
let recovered = false
let restoreBlocked = false
let displayListenersBound = false
let lastError: LaunchProfileEvent | null = null
const enabled = (): boolean => settingsStore.get('launchProfilesEnabled') === true

function emit(event: LaunchProfileEvent): void {
  if (event.kind === 'error') lastError = event
  notify(event)
}

function store(): Store<Record<string, LaunchProfileEntry>> {
  return profiles ??= new Store<Record<string, LaunchProfileEntry>>({
    name: 'launch-profiles',
    accessPropertiesByDotNotation: false
  })
}

function journalFile(): string {
  return join(app.getPath('userData'), 'launch-profile-restore.json')
}

function controller(): LaunchProfileTransaction {
  const file = journalFile()
  return transaction ??= new LaunchProfileTransaction({
    read: () => readRestoreJournal(file),
    write: (journal) => writeRestoreJournal(file, journal),
    clear: () => clearRestoreJournal(file),
    apply: applyDisplay,
    emit,
    now: Date.now,
    schedule: (callback) => {
      const timer = setTimeout(callback, 15_000)
      return () => clearTimeout(timer)
    }
  })
}

function journalPendingOnDisk(): boolean {
  return existsSync(journalFile())
}

function assertEnabled(): void {
  if (!enabled()) throw new Error('Launch profiles disabled')
}

/**
 * Lee el journal y trata de devolver el escritorio.
 * Un journal de una sesión que sigue en curso no se toca aquí:
 * eso espera al idle o al error. Si la restauración falla porque
 * el monitor no está, `restoreBlocked` queda prendido pa' reintentar.
 */
function recoverJournal(): boolean {
  if (process.platform !== 'win32') return false
  if (transaction?.confirmationPending()) return false
  const pending = journalPendingOnDisk() || transaction?.hasJournal() === true
  if (!shouldRecoverDisplayJournalOnStartup(pending)) {
    recovered = true
    restoreBlocked = false
    return true
  }
  const ok = controller().recover()
  const stillPending = controller().hasJournal() || journalPendingOnDisk()
  recovered = ok && !stillPending
  restoreBlocked = !ok && stillPending
  return ok
}

function retryPendingRestore(eventName: 'display-added' | 'display-metrics-changed'): void {
  if (!restoreBlocked) return
  if (!shouldRetryPendingDisplayRestore({
    eventName,
    confirmationPending: transaction?.confirmationPending() === true,
    journalPending: transaction?.hasJournal() === true || journalPendingOnDisk()
  })) {
    return
  }
  try {
    recoverJournal()
  } catch (error) {
    console.warn('[launch-profiles] No se pudo reintentar la restauración:', error)
  }
}

function onDisplayAdded(): void {
  retryPendingRestore('display-added')
}

function onDisplayMetricsChanged(): void {
  retryPendingRestore('display-metrics-changed')
}

function bindDisplayRetry(): void {
  if (displayListenersBound || process.platform !== 'win32') return
  displayListenersBound = true
  // Cuando el monitor vuelve, se intenta el journal otra vez. Sin journal, no hace nada.
  screen.on('display-added', onDisplayAdded)
  screen.on('display-metrics-changed', onDisplayMetricsChanged)
}

export const launchProfileService = {
  initialize(send: typeof notify): void {
    notify = send
    bindDisplayRetry()
    this.preferencesChanged()
  },
  dispose(): void {
    if (!displayListenersBound) return
    screen.removeListener('display-added', onDisplayAdded)
    screen.removeListener('display-metrics-changed', onDisplayMetricsChanged)
    displayListenersBound = false
  },
  preferencesChanged(): void {
    // Apagar el toggle cancela una confirmación en curso y devuelve la pantalla.
    if (!enabled() && transaction) this.restore()
    // Al arrancar, o si el intento anterior quedó bloqueado, se lee el journal
    // aunque el toggle esté apagado.
    if (!recovered || restoreBlocked) recoverJournal()
  },
  takeError(): LaunchProfileEvent | null {
    const error = lastError
    lastError = null
    return error
  },
  hasPendingRestore(): boolean {
    if (transaction?.confirmationPending()) return false
    return transaction?.hasJournal() === true || journalPendingOnDisk()
  },
  discardPendingRestore(): LaunchProfileDiscardResult {
    const tx = controller()
    const decision = decideDiscardPendingRestore({
      confirmed: true,
      confirmationPending: tx.confirmationPending(),
      journalPending: tx.hasJournal() || journalPendingOnDisk()
    })
    if (decision === 'busy') return 'busy'
    if (decision === 'keep') return 'absent'
    if (!tx.forget()) return 'busy'
    recovered = true
    restoreBlocked = false
    return 'forgotten'
  },
  listModes(): DisplayModeList {
    assertEnabled()
    return {
      mode: detectDisplayMode(screen.getAllDisplays()),
      modes: process.platform === 'win32' ? listDisplayModes() : [],
      hdrAvailable: false,
      supported: process.platform === 'win32'
    }
  },
  get(gameId: string): LaunchProfileEntry {
    assertEnabled()
    const value: unknown = store().get(gameId, {})
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stored launch profiles')
    const entry = value as LaunchProfileEntry
    if (
      Object.keys(entry).some((key) => key !== 'handheld' && key !== 'docked') ||
      (entry.handheld !== undefined && !isProfile(entry.handheld)) ||
      (entry.docked !== undefined && !isProfile(entry.docked))
    ) {
      throw new Error('Invalid stored launch profile')
    }
    return { ...entry }
  },
  save(gameId: string, mode: unknown, profile: unknown): LaunchProfileEntry {
    assertEnabled()
    if (mode !== 'handheld' && mode !== 'docked') throw new Error('Invalid display mode')
    const entry = this.get(gameId)
    if (profile === null) {
      const next = Object.fromEntries(Object.entries(entry).filter(([key]) => key !== mode))
      store().set(gameId, next)
      return next
    }
    const available = this.listModes()
    if (mode !== available.mode || !validateProfile(profile, available.modes)) {
      throw new Error('Unsupported display profile')
    }
    const next = { ...entry, [mode]: { ...profile } }
    store().set(gameId, next)
    return next
  },
  async beforeLaunch(gameId: string): Promise<boolean> {
    if (!enabled() || process.platform !== 'win32') return true
    try {
      const tx = controller()
      if (tx.confirmationPending()) return false
      // Si el monitor faltaba, se reintenta. Un journal de la sesión viva no se revierte aquí.
      if (!recovered || restoreBlocked) recoverJournal()
      const mode: DisplayMode = detectDisplayMode(screen.getAllDisplays())
      const profile = selectProfile(this.get(gameId), mode)
      const stuckJournal = tx.hasJournal() && restoreBlocked
      const decision = decideLaunchWithPendingJournal({
        journalPending: stuckJournal,
        hasProfileForMode: profile !== undefined
      })
      // Sin perfil para este modo se lanza igual, aunque el journal siga ahí.
      if (decision === 'launch') return true
      if (decision === 'refuse-pending-journal') {
        emit({ kind: 'error', reason: 'pending-journal' })
        return false
      }
      if (!profile) return true
      const previous = captureDisplay()
      if (!validateProfile(profile, listDisplayModes(previous))) {
        throw new Error('Stored profile no longer supported')
      }
      const started = await tx.begin(previous, { ...previous, profile: { ...profile } })
      if (!started && tx.hasJournal()) {
        emit({ kind: 'error', reason: 'pending-journal' })
      }
      return started
    } catch (error) {
      console.warn('[launch-profiles] Launch profile failed:', error)
      emit({ kind: 'error' })
      return false
    }
  },
  confirm(token: unknown): boolean {
    return enabled() && (transaction?.confirm(token) ?? false)
  },
  restore(): void {
    if (!transaction) return
    const ok = transaction.restore()
    const stillPending = transaction.hasJournal()
    recovered = ok && !stillPending
    restoreBlocked = !ok && stillPending
  }
}
