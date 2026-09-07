import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  GEFORCE_NOW_APPLICATION_ID,
  GEFORCE_NOW_CATALOG_URL,
  GEFORCE_NOW_WEB_URL,
  createGeForceNowDeepLink,
  geForceNowStoreIdForGame,
  geForceNowStoreKey
} from '../src/shared/geforceNow.ts'
import type { LibraryGame } from '../src/shared/ipc.ts'

assert.equal(GEFORCE_NOW_APPLICATION_ID, 'launcher:geforce-now')
assert.equal(GEFORCE_NOW_WEB_URL, 'https://play.geforcenow.com/')
assert.equal(
  GEFORCE_NOW_CATALOG_URL,
  'https://api-prod.nvidia.com/services/gfngames/v1/gameList'
)
assert.equal(geForceNowStoreKey('steam', '424370'), 'STEAM:424370')
assert.equal(
  createGeForceNowDeepLink('59013b48-11cb-4307-8ac1-a3480a89ecb7'),
  'https://play.geforcenow.com/games?game-id=59013b48-11cb-4307-8ac1-a3480a89ecb7&utm_source=orbit&utm_campaign=launcher'
)

const steamGame = {
  provider: 'steam',
  providerGameId: '424370',
  appId: 424370,
  metadata: {}
} as LibraryGame
assert.equal(geForceNowStoreIdForGame(steamGame), '424370')
assert.equal(
  geForceNowStoreIdForGame({
    ...steamGame,
    provider: 'epic',
    providerGameId: 'Wolcen',
    appId: undefined,
    metadata: { providerStoreId: '2bc4445cab514d02a6cd0cc1ebfa5a4c' }
  }),
  '2bc4445cab514d02a6cd0cc1ebfa5a4c'
)

const [
  applicationService,
  webService,
  externalWindowActivation,
  catalogService,
  controllerBridge,
  panel,
  gameCard,
  gameDetails,
  libraryView,
  preload,
  ipc,
  ipcHandlers
] =
  await Promise.all(
    [
      '../src/main/applicationService.ts',
      '../src/main/geforceNow/geforceNowWebService.ts',
      '../src/main/externalWindowActivation.ts',
      '../src/main/geforceNow/geforceNowCatalogService.ts',
      '../src/main/mediaControllerBridge.ts',
      '../src/renderer/src/components/GeForceNowPanel.tsx',
      '../src/renderer/src/components/GameCard.tsx',
      '../src/renderer/src/components/GameDetailPanel.tsx',
      '../src/renderer/src/views/Library/LibraryView.tsx',
      '../src/preload/index.ts',
      '../src/shared/ipc.ts',
      '../src/main/ipcHandlers.ts'
    ].map((path) => readFile(new URL(path, import.meta.url), 'utf8'))
  )

assert.match(applicationService, /GEFORCE_NOW_APPLICATION_ID,\s*'GeForce NOW'/u)
assert.match(applicationService, /'GeForceNOW', 'CEF', 'GeForceNOW\.exe'/u)
assert.match(applicationService, /nativeApplication\([\s\S]*GEFORCE_NOW_APPLICATION_ID[\s\S]*geForceNow[\s\S]*true/u)
assert.match(applicationService, /applicationId === GEFORCE_NOW_APPLICATION_ID[\s\S]*requireFeature\('cloud-gaming'\)/u)

assert.match(webService, /isAllowedGeForceNowLaunchTarget/u)
assert.match(webService, /findGeForceNowBrowser/u)
assert.match(webService, /Microsoft Edge/u)
assert.match(webService, /Google Chrome/u)
assert.match(webService, /spawn\(browser\.executable/u)
assert.match(webService, /activateExternalProcessWindow\(browserProcess\.pid \?\? 0\)/u)
assert.match(webService, /this\.browserProcess !== browserProcess/u)
assert.match(webService, /--app=\$\{targetUrl\}/u)
assert.match(webService, /--user-data-dir=\$\{profilePath\}/u)
assert.match(webService, /geforce-now-browser-profile/u)
assert.match(webService, /--start-fullscreen/u)
assert.match(webService, /--disable-background-mode/u)
assert.match(webService, /shell\.openExternal\(targetUrl\)/u)
assert.match(webService, /backHold: \(\) => undefined/u)
assert.match(webService, /exitChord: \(\) => this\.close\(\)/u)
assert.match(webService, /mainWindow\.hide\(\)/u)
assert.match(webService, /revealOrbitWindow\(mainWindow\)/u)
assert.doesNotMatch(webService, /cookies\.get|executeJavaScript|localStorage|BrowserWindow\s*\(/u)
assert.match(externalWindowActivation, /Get-CimInstance Win32_Process/u)
assert.match(externalWindowActivation, /AttachThreadInput/u)
assert.match(externalWindowActivation, /SetForegroundWindow/u)
assert.match(externalWindowActivation, /candidate\.MainWindowHandle/u)
assert.match(controllerBridge, /exitChord\?: \(\) => void/u)
assert.match(
  controllerBridge,
  /MEDIA_BUTTONS\.lb \| MEDIA_BUTTONS\.rb \| MEDIA_BUTTONS\.start/u
)
assert.match(controllerBridge, /exitChordHoldStartedAt >= 1_250/u)

assert.match(catalogService, /GEFORCE_NOW_CATALOG_URL/u)
assert.match(catalogService, /variants \{ id appStore storeId shortName \}/u)
assert.match(catalogService, /orbit-geforce-now-catalog-v1/u)
assert.match(catalogService, /CATALOG_TTL_MS/u)
assert.match(catalogService, /geForceNowStoreKey\(appStore, storeId\)/u)
assert.doesNotMatch(catalogService, /executeJavaScript|cookies\.get|searchQuery/u)

assert.match(panel, /window\.api\.applications[\s\S]*\.get\(\)/u)
assert.match(panel, /application\.target === 'native'/u)
assert.match(panel, /window\.api\.applications\.launch\(nativeApplication\.id\)/u)
assert.doesNotMatch(panel, /if \(!nativeApplication\) return null/u)
assert.match(panel, /data-geforce-now-refresh/u)
assert.match(panel, /data-geforce-now-native-launcher/u)
assert.doesNotMatch(panel, /openInBrowser/u)
assert.match(panel, /refreshCatalog/u)
assert.match(panel, /data-focusable/u)
assert.match(panel, /library\.geforceNow\.native\.open/u)
assert.match(gameCard, /data-geforce-now-badge/u)
assert.match(gameCard, /data-game-card-badges/u)
assert.match(
  gameCard,
  /isHomeCard[\s\S]*opacity-0[\s\S]*group-data-\[focused=true\]:opacity-100/u
)
assert.match(gameDetails, /details\.geforceNowPlay/u)
assert.match(libraryView, /source === 'geforce-now'/u)
assert.match(libraryView, /<GeForceNowPanel/u)
assert.match(libraryView, /activationTarget="geforce-now"/u)
assert.match(preload, /geforceNow:[\s\S]*getCatalog:[\s\S]*launchGame:[\s\S]*openInBrowser:/u)
assert.match(ipc, /geforceNowCatalogGet/u)
assert.match(ipc, /geforceNowGameLaunch/u)
assert.match(ipc, /geforceNowOpenBrowser/u)
assert.match(ipcHandlers, /createGeForceNowDeepLink\(match\.geforceNowGameId\)/u)

console.log('GeForce NOW catalog, matching and cloud-launch checks passed.')
