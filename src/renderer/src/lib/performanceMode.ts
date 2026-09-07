export const ORBIT_PERFORMANCE_MODE_EVENT = 'orbit:performance-mode'

export function isOrbitPerformanceModeActive(): boolean {
  return document.documentElement.dataset.orbitPerformance === 'game'
}

export function setOrbitPerformanceMode(active: boolean): void {
  const root = document.documentElement
  const next = active ? 'game' : undefined
  if (root.dataset.orbitPerformance === next) return

  if (next) root.dataset.orbitPerformance = next
  else delete root.dataset.orbitPerformance
  window.dispatchEvent(new CustomEvent(ORBIT_PERFORMANCE_MODE_EVENT, { detail: { active } }))
}
