export const ARTWORK_PICKER_CYCLE_EVENT = 'orbit:artwork-picker:cycle'

export function cycleActiveArtworkPicker(step: -1 | 1): boolean {
  if (!document.querySelector('[data-artwork-picker="true"]')) return false
  window.dispatchEvent(new CustomEvent<-1 | 1>(ARTWORK_PICKER_CYCLE_EVENT, { detail: step }))
  return true
}
