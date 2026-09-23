import { app, screen } from 'electron'
import Store from 'electron-store'
import { join } from 'node:path'
import { settingsStore } from './settingsStore'
import { captureDisplay, listDisplayModes, applyDisplay } from './displayModeService'
import { clearRestoreJournal, readRestoreJournal, writeRestoreJournal } from './launchProfileJournal'
import { LaunchProfileTransaction } from './launchProfileTransaction'
import {
  detectDisplayMode, isProfile, selectProfile, validateProfile,
  type LaunchProfileEntry, type DisplayMode, type DisplayModeList, type LaunchProfileEvent
} from '@shared/launchProfilePolicy'

let profiles: Store<Record<string, LaunchProfileEntry>> | undefined
let transaction: LaunchProfileTransaction | undefined
let notify: (event: LaunchProfileEvent) => void = () => undefined
let recovered = false
let lastError: LaunchProfileEvent | null = null
const enabled = (): boolean => settingsStore.get('launchProfilesEnabled') === true
function emit(event: LaunchProfileEvent): void {
  if (event.kind === 'error') lastError = event
  notify(event)
}
function store(): Store<Record<string, LaunchProfileEntry>> {
  return profiles ??= new Store<Record<string, LaunchProfileEntry>>({ name: 'launch-profiles', accessPropertiesByDotNotation: false })
}
function controller(): LaunchProfileTransaction {
  const file = join(app.getPath('userData'), 'launch-profile-restore.json')
  return transaction ??= new LaunchProfileTransaction({
    read: () => readRestoreJournal(file), write: (journal) => writeRestoreJournal(file, journal),
    clear: () => clearRestoreJournal(file), apply: applyDisplay, emit, now: Date.now,
    schedule: (callback) => { const timer = setTimeout(callback, 15_000); return () => clearTimeout(timer) }
  })
}
function assertEnabled(): void { if (!enabled()) throw new Error('Launch profiles disabled') }

export const launchProfileService = {
  initialize(send: typeof notify): void {
    notify = send
    this.preferencesChanged()
  },
  preferencesChanged(): void {
    if (!enabled()) { this.restore(); return }
    if (process.platform === 'win32' && !recovered) recovered = controller().recover()
  },
  takeError(): LaunchProfileEvent | null { const error = lastError; lastError = null; return error },
  listModes(): DisplayModeList {
    assertEnabled()
    return {
      mode: detectDisplayMode(screen.getAllDisplays()),
      modes: process.platform === 'win32' ? listDisplayModes() : [],
      hdrAvailable: false, supported: process.platform === 'win32'
    }
  },
  get(gameId: string): LaunchProfileEntry {
    assertEnabled()
    const value: unknown = store().get(gameId, {})
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stored launch profiles')
    const entry = value as LaunchProfileEntry
    if (Object.keys(entry).some((key) => key !== 'handheld' && key !== 'docked') ||
      (entry.handheld !== undefined && !isProfile(entry.handheld)) ||
      (entry.docked !== undefined && !isProfile(entry.docked))) throw new Error('Invalid stored launch profile')
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
    if (mode !== available.mode || !validateProfile(profile, available.modes)) throw new Error('Unsupported display profile')
    const next = { ...entry, [mode]: { ...profile } }
    store().set(gameId, next)
    return next
  },
  async beforeLaunch(gameId: string): Promise<boolean> {
    if (!enabled() || process.platform !== 'win32') return true
    try {
      if (!recovered) { recovered = controller().recover(); if (!recovered) return false }
      const mode: DisplayMode = detectDisplayMode(screen.getAllDisplays())
      const profile = selectProfile(this.get(gameId), mode)
      if (!profile) return true
      const previous = captureDisplay()
      if (!validateProfile(profile, listDisplayModes(previous))) throw new Error('Stored profile no longer supported')
      return await controller().begin(previous, { ...previous, profile })
    } catch (error) {
      console.warn('[launch-profiles] Launch profile failed:', error)
      emit({ kind: 'error' })
      return false
    }
  },
  confirm(token: unknown): boolean { return enabled() && (transaction?.confirm(token) ?? false) },
  restore(): void { if (transaction && !transaction.restore()) recovered = false }
}
