import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  resolveGameCardActivation,
  resolveGameCardSecondaryActivation
} from '../src/renderer/src/lib/gameCardActivation.ts'
import {
  canRequestGameInstall,
  canRequestGameUninstall,
  PROVIDER_INSTALLATION_CAPABILITIES,
  providerAutomationLevel
} from '../src/shared/gameInstallation.ts'
import type { LibraryGame } from '../src/shared/ipc.ts'

const fixtureGame = (partial: Partial<LibraryGame>): LibraryGame => ({
  id: 'steam:10',
  provider: 'steam',
  providerGameId: '10',
  appId: 10,
  name: 'Fixture',
  metadata: {},
  metadataRevision: 1,
  installed: false,
  addedAt: 1,
  updatedAt: 1,
  ...partial
})

assert.equal(canRequestGameInstall(fixtureGame({})), true)
assert.equal(canRequestGameUninstall(fixtureGame({ installed: true })), true)
assert.equal(
  canRequestGameInstall(
    fixtureGame({
      id: 'xbox:9NBLGGH4R315',
      provider: 'xbox',
      providerGameId: '9NBLGGH4R315',
      appId: undefined
    })
  ),
  true
)
assert.equal(
  canRequestGameUninstall(
    fixtureGame({
      provider: 'xbox',
      installed: true,
      appId: undefined,
      metadata: { providerPackageFamilyName: 'Fixture.Game_8wekyb3d8bbwe' }
    })
  ),
  true
)
assert.deepEqual(
  PROVIDER_INSTALLATION_CAPABILITIES.map((capability) => [
    capability.provider,
    providerAutomationLevel(capability)
  ]),
  [
    ['xbox', 'automatic'],
    ['steam', 'assisted'],
    ['epic', 'assisted'],
    ['ubisoft', 'manual']
  ]
)

assert.deepEqual(resolveGameCardActivation('launch'), {
  kind: 'launch',
  target: 'default'
})
assert.deepEqual(resolveGameCardActivation('details'), {
  kind: 'details',
  preferredAction: 'default'
})
assert.deepEqual(resolveGameCardSecondaryActivation('launch'), {
  kind: 'details',
  preferredAction: 'default'
})
assert.deepEqual(resolveGameCardSecondaryActivation('details'), {
  kind: 'launch',
  target: 'default'
})

const [
  settingsStore,
  ipcHandlers,
  preferencesStore,
  settingsView,
  homeView,
  gameCard,
  gameDetailStore,
  gameDetailPanel,
  gamepadNavigation
] =
  await Promise.all(
    [
      '../src/main/settingsStore.ts',
      '../src/main/ipcHandlers.ts',
      '../src/renderer/src/state/preferencesStore.ts',
      '../src/renderer/src/views/Settings/SettingsView.tsx',
      '../src/renderer/src/views/Home/HomeView.tsx',
      '../src/renderer/src/components/GameCard.tsx',
      '../src/renderer/src/state/gameDetailStore.ts',
      '../src/renderer/src/components/GameDetailPanel.tsx',
      '../src/renderer/src/hooks/useGamepadNavigation.ts'
    ].map((path) => readFile(new URL(path, import.meta.url), 'utf8'))
  )

assert.match(settingsStore, /gameCardPrimaryAction:\s*'launch'/u)
assert.match(ipcHandlers, /GAME_CARD_PRIMARY_ACTIONS\.includes/u)
assert.match(preferencesStore, /setGameCardPrimaryAction/u)
assert.match(settingsView, /settings\.launchBehavior\.detailsFirst/u)
assert.match(settingsView, /button="south"/u)
assert.match(settingsView, /button="menu"/u)
assert.match(homeView, /useActivateGameCard/u)
assert.match(gameCard, /useActivateGameCard/u)
assert.match(gameDetailStore, /preferredAction:\s*'default'/u)
assert.match(gameDetailStore, /closeGame:.*preferredAction:\s*'default'/u)
assert.match(gamepadNavigation, /resolveGameCardSecondaryActivation/u)
assert.match(gamepadNavigation, /BTN_START/u)

console.log('Game card action verification passed.')
