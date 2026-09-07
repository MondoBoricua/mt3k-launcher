import type { GameCardPrimaryAction } from '@shared/ipc'

export type GameCardActivationTarget = 'default' | 'geforce-now'

export type GameCardActivation =
  | { kind: 'launch'; target: GameCardActivationTarget }
  | { kind: 'details'; preferredAction: GameCardActivationTarget }

export function resolveGameCardActivation(
  primaryAction: GameCardPrimaryAction,
  target: GameCardActivationTarget = 'default'
): GameCardActivation {
  return primaryAction === 'details'
    ? { kind: 'details', preferredAction: target }
    : { kind: 'launch', target }
}

export function resolveGameCardSecondaryActivation(
  primaryAction: GameCardPrimaryAction,
  target: GameCardActivationTarget = 'default'
): GameCardActivation {
  return primaryAction === 'details'
    ? { kind: 'launch', target }
    : { kind: 'details', preferredAction: target }
}
