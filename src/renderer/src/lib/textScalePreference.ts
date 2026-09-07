import { normalizeTextScale, TEXT_SCALE_DEFAULT } from '@shared/textScale'
import { focusElement } from './spatialNavigation'

const CACHE_KEY = 'orbit:text-scale'
let timer: ReturnType<typeof setTimeout> | undefined
let pending: { value: number; waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> } | undefined
let saveTail = Promise.resolve()
let focusFrame: number | undefined

export function readCachedTextScale(): number {
  try {
    const cached = window.localStorage.getItem(CACHE_KEY)
    return cached === null ? TEXT_SCALE_DEFAULT : normalizeTextScale(Number(cached))
  } catch {
    return TEXT_SCALE_DEFAULT
  }
}

export function applyTextScale(value: number): void {
  const scale = normalizeTextScale(value)
  document.documentElement.style.setProperty('--orbit-text-scale', String(scale / 100))
  document.documentElement.dataset.textEnlarged = String(scale > TEXT_SCALE_DEFAULT)
  if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
  const focused = document.activeElement as HTMLElement | null
  if (focused?.hasAttribute('data-focusable')) {
    focusFrame = requestAnimationFrame(() => {
      focusFrame = undefined
      if (focused.isConnected && document.activeElement === focused) focusElement(focused)
    })
  }
  try {
    window.localStorage.setItem(CACHE_KEY, String(scale))
  } catch {
    // The main-process setting remains authoritative if the startup cache is unavailable.
  }
}

/** Coalesce continuous slider input and serialize writes so an older save cannot win. */
export function scheduleTextScaleSave(value: number): Promise<void> {
  clearTimeout(timer)
  pending ??= { value, waiters: [] }
  pending.value = value
  const result = new Promise<void>((resolve, reject) => pending!.waiters.push({ resolve, reject }))
  timer = setTimeout(() => { void flushTextScaleSave() }, 180)
  return result
}

export function flushTextScaleSave(): Promise<void> {
  clearTimeout(timer)
  timer = undefined
  const batch = pending
  pending = undefined
  if (!batch) return saveTail
  saveTail = saveTail.then(async () => {
    try {
      await window.api.settings.set({ textScale: batch.value })
      batch.waiters.forEach(({ resolve }) => resolve())
    } catch (error) {
      batch.waiters.forEach(({ reject }) => reject(error))
    }
  })
  return saveTail
}
