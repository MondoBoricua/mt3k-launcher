import type {
  EditableGameMetadataKey,
  GameMetadata,
  GameMetadataOverrides,
  GameMetadataUpdateInput
} from './ipc'

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function applyGameMetadataOverrides(
  metadata: GameMetadata,
  overrides: GameMetadataOverrides | undefined
): GameMetadata {
  if (!overrides) return metadata
  const effective = { ...metadata }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) delete (effective as Record<string, unknown>)[key]
    else if (value !== undefined) (effective as Record<string, unknown>)[key] = value
  }
  return effective
}

/** Applies an editor patch while retaining the distinction between an absent
 * override and a deliberate null override that hides provider data. */
export function patchGameMetadataOverrides(
  metadata: GameMetadata,
  current: GameMetadataOverrides | undefined,
  patch: GameMetadataOverrides | undefined,
  resetAll = false
): GameMetadataOverrides | undefined {
  const next: GameMetadataOverrides = resetAll ? {} : { ...(current ?? {}) }
  for (const [key, value] of Object.entries(patch ?? {})) {
    const providerValue = (metadata as Record<string, unknown>)[key]
    if (value !== null && sameValue(value, providerValue)) {
      delete (next as Record<string, unknown>)[key]
    } else {
      (next as Record<string, unknown>)[key] = value
    }
  }
  return Object.keys(next).length > 0 ? next : undefined
}

export function sameGameMetadataOverrides(
  left: GameMetadataOverrides | undefined,
  right: GameMetadataOverrides | undefined
): boolean {
  const leftKeys = Object.keys(left ?? {})
  const rightKeys = Object.keys(right ?? {})
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) =>
      Object.hasOwn(right ?? {}, key) &&
      sameValue(
        (left as Record<string, unknown> | undefined)?.[key],
        (right as Record<string, unknown> | undefined)?.[key]
      )
    )
  )
}

/** Provider values may use trusted native deep links or legacy formats that are
 * intentionally not valid manual overrides. Editor validation must therefore
 * inspect only fields that the pending patch will actually persist. */
export function patchesGameMetadataField(
  update: Pick<GameMetadataUpdateInput, 'metadata'>,
  key: EditableGameMetadataKey
): boolean {
  return Boolean(update.metadata && Object.hasOwn(update.metadata, key))
}
