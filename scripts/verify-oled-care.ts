import assert from 'node:assert/strict'
import { shouldStartAttractMode, type AttractState } from '../src/shared/attractModePolicy.ts'
import {
  OLED_CARE_DEFAULT_MINUTES,
  OLED_CARE_DEFAULT_MODE,
  OLED_CARE_DIM_OPACITY,
  OLED_CARE_IDLE_MINUTES,
  OLED_CARE_MODES,
  OLED_CARE_WAKE_SUPPRESS_MS,
  normalizeOledCareIdleMinutes,
  normalizeOledCareMode,
  oledCareControllerPlan,
  oledCareCoverStyle,
  oledCareLayerOpacity,
  oledCareSuppressUntil,
  oledCareVisibleSurface,
  shouldCoverWithOledCare,
  shouldSwallowOledCareWake,
  type OledCareState
} from '../src/shared/oledCarePolicy.ts'

const ready: OledCareState = {
  enabled: true,
  launchPhase: 'idle',
  visible: true,
  focused: true,
  minimized: false,
  idleMs: 180_000,
  idleMinutes: 3
}

assert.equal(OLED_CARE_DEFAULT_MINUTES, 3)
assert.equal(OLED_CARE_DEFAULT_MODE, 'black')
assert.deepEqual([...OLED_CARE_IDLE_MINUTES], [1, 2, 3, 5, 10])
assert.deepEqual([...OLED_CARE_MODES], ['black', 'dim'])
assert.equal(shouldCoverWithOledCare(ready), true)
assert.equal(shouldCoverWithOledCare({ ...ready, enabled: false }), false, 'apagado por defecto no cubre')

for (const blocker of [
  { visible: false },
  { focused: false },
  { minimized: true },
  { launchPhase: 'launching' },
  { launchPhase: 'running' },
  { launchPhase: 'returning' },
  { idleMs: 179_999 },
  { idleMs: NaN },
  { idleMs: Number.POSITIVE_INFINITY }
]) {
  assert.equal(shouldCoverWithOledCare({ ...ready, ...blocker }), false, JSON.stringify(blocker))
}

for (const minutes of OLED_CARE_IDLE_MINUTES) {
  assert.equal(normalizeOledCareIdleMinutes(minutes), minutes)
  assert.equal(shouldCoverWithOledCare({ ...ready, idleMinutes: minutes, idleMs: minutes * 60_000 }), true)
  assert.equal(
    shouldCoverWithOledCare({ ...ready, idleMinutes: minutes, idleMs: minutes * 60_000 - 1 }),
    false
  )
}
for (const invalid of [0, -1, 4, 15, '3', Infinity, undefined, null]) {
  assert.equal(normalizeOledCareIdleMinutes(invalid), 3)
}
assert.equal(shouldCoverWithOledCare({ ...ready, idleMinutes: 4, idleMs: 180_000 }), true, 'minutos inválidos caen a 3')
assert.equal(shouldCoverWithOledCare({ ...ready, idleMinutes: 4, idleMs: 179_999 }), false)

assert.equal(normalizeOledCareMode('black'), 'black')
assert.equal(normalizeOledCareMode('dim'), 'dim')
for (const invalid of ['DIM', 'off', 1, undefined, null]) assert.equal(normalizeOledCareMode(invalid), 'black')
assert.equal(oledCareLayerOpacity('black'), 1)
assert.equal(oledCareLayerOpacity('dim'), OLED_CARE_DIM_OPACITY)
assert.equal(oledCareLayerOpacity('nope'), 1)
for (const reduced of [false, true]) {
  const black = oledCareCoverStyle('black', reduced)
  const dim = oledCareCoverStyle('dim', reduced)
  assert.equal(black.background, '#000')
  assert.equal(dim.background, '#000')
  assert.equal(black.opacity, 1)
  assert.equal(dim.opacity, 0.85)
  assert.equal(black.transition, 'none')
  assert.equal(dim.transition, 'none')
}

const attractReady: AttractState = {
  enabled: true,
  view: 'home',
  launchPhase: 'idle',
  dialogOpen: false,
  visible: true,
  focused: true,
  gameCount: 3,
  idleMs: 300_000,
  idleMinutes: 5
}
assert.equal(shouldStartAttractMode(attractReady), true)
assert.equal(shouldCoverWithOledCare({ ...ready, idleMs: 180_000, idleMinutes: 3 }), true)
assert.equal(
  oledCareVisibleSurface({
    oledCover: shouldCoverWithOledCare({ ...ready, idleMs: 180_000 }),
    attractActive: shouldStartAttractMode({ ...attractReady, idleMs: 180_000 })
  }),
  'oled',
  'a los 3 min el OLED tapa antes de que arranque la vitrina de 5 min'
)
assert.equal(
  oledCareVisibleSurface({
    oledCover: shouldCoverWithOledCare({ ...ready, idleMs: 300_000 }),
    attractActive: shouldStartAttractMode(attractReady)
  }),
  'oled',
  'cuando ambos ya aplicarían, la capa OLED tapa el slideshow'
)
assert.equal(
  oledCareVisibleSurface({
    oledCover: shouldCoverWithOledCare({ ...ready, enabled: false, idleMs: 300_000 }),
    attractActive: shouldStartAttractMode(attractReady)
  }),
  'attract'
)
assert.equal(oledCareVisibleSurface({ oledCover: false, attractActive: false }), 'launcher')
assert.equal(
  shouldCoverWithOledCare({ ...ready, idleMs: 60_000, idleMinutes: 1 }),
  true,
  'el reloj del OLED es el suyo, no el de la vitrina'
)

assert.equal(OLED_CARE_WAKE_SUPPRESS_MS, 500)
assert.equal(
  shouldSwallowOledCareWake({ coverActive: true, heldWakeKey: false, now: 1_000, suppressUntil: 0 }),
  true
)
assert.equal(
  shouldSwallowOledCareWake({ coverActive: false, heldWakeKey: true, now: 2_000, suppressUntil: 0 }),
  true
)
assert.equal(
  shouldSwallowOledCareWake({ coverActive: false, heldWakeKey: false, now: 1_499, suppressUntil: 1_500 }),
  true
)
assert.equal(
  shouldSwallowOledCareWake({ coverActive: false, heldWakeKey: false, now: 1_500, suppressUntil: 1_500 }),
  false,
  'pasada la ventana, la siguiente entrada sí llega a la UI'
)
assert.equal(oledCareSuppressUntil(1_000, true, 0), 1_500)
assert.equal(oledCareSuppressUntil(2_000, false, 1_500), 1_500)

assert.deepEqual(
  oledCareControllerPlan({
    careEnabled: false,
    attractEnabled: false,
    coverActive: false,
    attractActive: false,
    controllerActivity: true,
    consumeWake: false
  }),
  { touch: false, swallow: false, consumeWake: false }
)
assert.deepEqual(
  oledCareControllerPlan({
    careEnabled: true,
    attractEnabled: false,
    coverActive: false,
    attractActive: false,
    controllerActivity: true,
    consumeWake: false
  }),
  { touch: true, swallow: false, consumeWake: false },
  'el mando reinicia el reloj sin tragarse la entrada si no hay capa'
)
const waking = oledCareControllerPlan({
  careEnabled: true,
  attractEnabled: false,
  coverActive: true,
  attractActive: false,
  controllerActivity: true,
  consumeWake: false
})
assert.equal(waking.touch, true)
assert.equal(waking.swallow, true, 'la primera entrada del mando se traga')
const held = oledCareControllerPlan({
  careEnabled: true,
  attractEnabled: false,
  coverActive: false,
  attractActive: false,
  controllerActivity: true,
  consumeWake: waking.consumeWake
})
assert.equal(held.swallow, true, 'el botón que despertó sigue tragado mientras siga presionado')
const released = oledCareControllerPlan({
  careEnabled: true,
  attractEnabled: false,
  coverActive: false,
  attractActive: false,
  controllerActivity: false,
  consumeWake: held.consumeWake
})
assert.equal(released.swallow, true, 'el frame en que se suelta todavía no navega')
assert.equal(released.consumeWake, false)
const after = oledCareControllerPlan({
  careEnabled: true,
  attractEnabled: false,
  coverActive: false,
  attractActive: false,
  controllerActivity: false,
  consumeWake: released.consumeWake
})
assert.equal(after.swallow, false)
assert.deepEqual(
  oledCareControllerPlan({
    careEnabled: false,
    attractEnabled: true,
    coverActive: false,
    attractActive: true,
    controllerActivity: true,
    consumeWake: false
  }),
  { touch: true, swallow: true, consumeWake: true },
  'la vitrina sola sigue tragando su primera entrada'
)
assert.equal(
  oledCareControllerPlan({
    careEnabled: true,
    attractEnabled: true,
    coverActive: true,
    attractActive: false,
    controllerActivity: true,
    consumeWake: false
  }).swallow,
  true,
  'con ambos encendidos, la capa OLED también traga el mando'
)

console.log('OLED care policy checks passed')
