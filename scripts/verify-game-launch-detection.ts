import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GAME_LAUNCH_CANCEL_WINDOW_MS } from '../src/shared/ipc.ts'
import type { LibraryGame } from '../src/shared/ipc.ts'
import {
  LaunchStartupTracker,
  GAME_PROCESS_CANDIDATE_STABILITY_MS,
  ancestryIncludesTrackedPid,
  providerSessionTimestamps,
  hasEligibleGameProcessIdentity,
  launchNoEvidenceTimeoutMs,
  provisionalHandoffGraceMs,
  selectGameTrackingMethod,
  windowsExecutableInsideDirectory,
  windowsPackageIdentityMatches
} from '../src/main/gameLaunchDetectionPolicy.ts'
import {
  isWindowsElevationRequiredError,
  quoteWindowsCommandLineArgument,
  windowsCommandLineArguments
} from '../src/main/gameLaunchElevationPolicy.ts'
import { gameTrackingMethodsForProvider } from '../src/shared/gameTracking.ts'
import {
  parseSteamActiveGames,
  SteamGameActivityReader
} from '../src/main/steam/steamGameActivity.ts'
import {
  detectLibraryGamePresences,
  windowsCommandLineContainsPath
} from '../src/main/gamePresence.ts'
import {
  livingProcessRecords,
  processIdStillExists
} from '../src/main/processLiveness.ts'

const startedAt = 10_000
const noIdentity = {
  providerReportedGame: false,
  directlySpawnedGame: false,
  exactExecutable: false,
  insideInstallDir: false,
  packageFamilyMatches: false,
  idMatches: false,
  executableHintMatches: false,
  fromTrackedGame: false,
  fromLauncher: false,
  visible: false,
  nameMatches: false,
  windowsAppsProcess: false
}

assert.equal(hasEligibleGameProcessIdentity({ ...noIdentity, visible: true }), false)
assert.equal(
  hasEligibleGameProcessIdentity({
    ...noIdentity,
    visible: true,
    windowsAppsProcess: true
  }),
  false
)
assert.equal(
  hasEligibleGameProcessIdentity({ ...noIdentity, visible: true, nameMatches: true }),
  true
)
assert.equal(
  hasEligibleGameProcessIdentity({ ...noIdentity, visible: true, fromLauncher: true }),
  true
)
assert.equal(hasEligibleGameProcessIdentity({ ...noIdentity, insideInstallDir: true }), true)
assert.equal(hasEligibleGameProcessIdentity({ ...noIdentity, exactExecutable: true }), true)
assert.equal(hasEligibleGameProcessIdentity({ ...noIdentity, packageFamilyMatches: true }), true)
assert.equal(hasEligibleGameProcessIdentity({ ...noIdentity, executableHintMatches: true }), true)
assert.equal(hasEligibleGameProcessIdentity({ ...noIdentity, directlySpawnedGame: true }), true)
assert.equal(
  windowsPackageIdentityMatches(
    'shell:AppsFolder\\Microsoft.198377053870B_8wekyb3d8bbwe!AppHaloCampaignEvolvedShipping',
    'C:\\Program Files\\WindowsApps\\Microsoft.198377053870B_2.0.0.0_x64__8wekyb3d8bbwe\\Meteorite\\Binaries\\WinGDK\\HaloCampaignEvolved.exe'
  ),
  true
)
assert.equal(
  windowsPackageIdentityMatches(
    'shell:AppsFolder\\Microsoft.198377053870B_8wekyb3d8bbwe!AppHaloCampaignEvolvedShipping',
    'C:\\Program Files\\WindowsApps\\Microsoft.OtherGame_2.0.0.0_x64__8wekyb3d8bbwe\\OtherGame.exe'
  ),
  false
)
assert.equal(GAME_LAUNCH_CANCEL_WINDOW_MS, 3_000)
assert.equal(GAME_PROCESS_CANDIDATE_STABILITY_MS, 650)
assert.equal(processIdStillExists(process.pid), true)
assert.equal(processIdStillExists(2_147_483_647), false)
assert.deepEqual(
  livingProcessRecords([
    { ProcessId: process.pid, Name: 'current.exe' },
    { ProcessId: 2_147_483_647, Name: 'stale.exe' }
  ]),
  [{ ProcessId: process.pid, Name: 'current.exe' }]
)

const elevationRequired = new Error('The requested operation requires elevation') as Error & {
  code?: string
  errno?: number
}
assert.equal(isWindowsElevationRequiredError(elevationRequired), true)
const accessDenied = new Error('spawn failed') as Error & { code?: string }
accessDenied.code = 'EACCES'
assert.equal(isWindowsElevationRequiredError(accessDenied), true)
const unknownWindowsSpawn = new Error('spawn UNKNOWN') as Error & {
  code?: string
  errno?: number
  syscall?: string
}
unknownWindowsSpawn.code = 'UNKNOWN'
unknownWindowsSpawn.errno = -4094
unknownWindowsSpawn.syscall = 'spawn C:\\Games\\AdminGame.exe'
assert.equal(isWindowsElevationRequiredError(unknownWindowsSpawn), true)
const missingExecutable = new Error('spawn ENOENT') as Error & { code?: string }
missingExecutable.code = 'ENOENT'
assert.equal(isWindowsElevationRequiredError(missingExecutable), false)
assert.equal(quoteWindowsCommandLineArgument(''), '""')
assert.equal(quoteWindowsCommandLineArgument('--fullscreen'), '--fullscreen')
assert.equal(quoteWindowsCommandLineArgument('C:\\Games\\My Save'), '"C:\\Games\\My Save"')
assert.equal(quoteWindowsCommandLineArgument('say"hello'), '"say\\"hello"')
assert.equal(
  windowsCommandLineArguments(['--profile', 'My Mods', 'C:\\Saves\\']),
  '--profile "My Mods" C:\\Saves\\'
)

const sessionManagerSource = readFileSync(
  new URL('../src/main/gameSessionManager.ts', import.meta.url),
  'utf8'
)
const fastBaselineIndex = sessionManagerSource.indexOf("Kind = 'snapshot'")
const targetedWmiIndex = sessionManagerSource.indexOf(
  'Get-CimInstance Win32_Process -Filter $filter'
)
assert.ok(fastBaselineIndex >= 0 && targetedWmiIndex > fastBaselineIndex)
assert.equal(sessionManagerSource.includes('[Console]::In.ReadLineAsync()'), false)
assert.equal(sessionManagerSource.includes('setSampleInterval('), false)
const gameDispatchIndex = sessionManagerSource.indexOf('const receipt = await launchGame(game)')
const unmonitoredLaunchIndex = sessionManagerSource.indexOf(
  "void this.fail(token, monitorFailureMessage, 'monitor-unavailable')",
  gameDispatchIndex
)
assert.ok(gameDispatchIndex >= 0 && unmonitoredLaunchIndex > gameDispatchIndex)

assert.equal(ancestryIncludesTrackedPid(42, new Set([42]), () => undefined), true)
assert.equal(
  ancestryIncludesTrackedPid(52, new Set([42]), (pid) => (pid === 52 ? 42 : undefined)),
  true
)
assert.equal(ancestryIncludesTrackedPid(52, new Set([99]), () => undefined), false)

assert.equal(launchNoEvidenceTimeoutMs('local'), 20_000)
assert.equal(launchNoEvidenceTimeoutMs('steam'), 60_000)
assert.equal(launchNoEvidenceTimeoutMs('epic'), 75_000)
assert.equal(launchNoEvidenceTimeoutMs('xbox'), 75_000)
assert.equal(launchNoEvidenceTimeoutMs('ea'), 90_000)
assert.equal(launchNoEvidenceTimeoutMs('ubisoft'), 90_000)
assert.equal(provisionalHandoffGraceMs('local'), 8_000)
assert.equal(provisionalHandoffGraceMs('xbox'), 15_000)

assert.deepEqual(gameTrackingMethodsForProvider('steam'), [
  'provider-process',
  'install-directory',
  'executable',
  'provider-handoff'
])
assert.deepEqual(
  parseSteamActiveGames(`
[2026-09-06 01:52:19] AppID 367520 adding PID 18748 as a tracked process ""c:\\steamapps\\common\\Hollow Knight\\hollow_knight.exe""
[2026-09-06 01:52:20] AppID 367520 adding PID 10352 as a tracked process ""c:\\steamapps\\common\\Hollow Knight\\UnityCrashHandler64.exe" --attach 18748"
[2026-09-06 01:54:44] AppID 367520 no longer tracking PID 10352, exit code 0
`),
  [
    {
      appId: 367520,
      processIds: [18748],
      startedAt: new Date('2026-09-06T01:52:19').getTime()
    }
  ]
)

function libraryGame(
  provider: LibraryGame['provider'],
  providerGameId: string,
  overrides: Partial<LibraryGame> = {}
): LibraryGame {
  return {
    id: `${provider}:${providerGameId}`,
    provider,
    providerGameId,
    name: providerGameId,
    metadata: {},
    metadataRevision: 1,
    installed: true,
    addedAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

const steamPresenceGame = libraryGame('steam', '367520', {
  appId: 367520,
  installed: false,
  name: 'Hollow Knight'
})
assert.deepEqual(
  detectLibraryGamePresences(
    [{ ProcessId: 401, Name: 'provider-game.exe', StartedAt: 12_000 }],
    [steamPresenceGame],
    new Map([
      [steamPresenceGame.id, { processIds: new Set([401]), startedAt: 11_500 }]
    ])
  ).map((presence) => ({
    id: presence.game.id,
    method: presence.trackingMethod,
    fallback: presence.trackingFallbackIndex,
    startedAt: presence.startedAt
  })),
  [
    {
      id: 'steam:367520',
      method: 'provider-process',
      fallback: 0,
      startedAt: 11_500
    }
  ]
)

const epicPresenceGame = libraryGame('epic', 'Fortnite', {
  installDir: 'D:\\Epic\\Fortnite',
  metadata: { launchExecutable: 'FortniteGame\\Binaries\\Win64\\FortniteClient-Win64.exe' }
})
assert.equal(
  detectLibraryGamePresences(
    [
      {
        ProcessId: 402,
        Name: 'FortniteClient-Win64.exe',
        ExecutablePath: 'D:\\Epic\\Fortnite\\FortniteGame\\Binaries\\Win64\\FortniteClient-Win64.exe'
      }
    ],
    [epicPresenceGame]
  )[0]?.trackingMethod,
  'install-directory'
)

const xboxPresenceGame = libraryGame('xbox', '9NBLGGH4R315', {
  installDir: 'C:\\Program Files\\WindowsApps\\Microsoft.Halo_2.0.0.0_x64__8wekyb3d8bbwe',
  metadata: {
    launchUri: 'shell:AppsFolder\\Microsoft.Halo_8wekyb3d8bbwe!Game'
  }
})
assert.equal(
  detectLibraryGamePresences(
    [
      {
        ProcessId: 403,
        Name: 'Halo.exe',
        ExecutablePath:
          'C:\\Program Files\\WindowsApps\\Microsoft.Halo_2.0.0.0_x64__8wekyb3d8bbwe\\Halo.exe'
      }
    ],
    [xboxPresenceGame]
  )[0]?.trackingMethod,
  'package-identity'
)

for (const provider of ['gog', 'ea', 'ubisoft'] as const) {
  const game = libraryGame(provider, `${provider}-game`, {
    installDir: `E:\\Games\\${provider}\\Known Game`
  })
  assert.equal(
    detectLibraryGamePresences(
      [
        {
          ProcessId: 410 + provider.length,
          Name: 'KnownGame.exe',
          ExecutablePath: `E:\\Games\\${provider}\\Known Game\\bin\\KnownGame.exe`
        }
      ],
      [game]
    )[0]?.trackingMethod,
    'install-directory'
  )
}

const localPresenceGame = libraryGame('local', 'custom-game', {
  installDir: 'F:\\Games\\Custom',
  local: {
    executablePath: 'F:\\Games\\Custom\\Custom.exe',
    backupEnabled: false
  }
})
assert.equal(
  detectLibraryGamePresences(
    [
      {
        ProcessId: 420,
        Name: 'Custom.exe',
        ExecutablePath: 'F:\\Games\\Custom\\Custom.exe'
      }
    ],
    [localPresenceGame]
  )[0]?.trackingMethod,
  'executable'
)

const retroOne = libraryGame('retro', 'rom-one', {
  installDir: 'G:\\Roms',
  retro: {
    romPath: 'G:\\Roms\\One.nes',
    sourceDirectory: 'G:\\Roms',
    systemId: 'nes',
    systemName: 'NES',
    emulatorPath: 'G:\\Emulators\\RetroArch.exe',
    retroAchievementsMatch: 'unmatched'
  }
})
const retroTwo = libraryGame('retro', 'rom-two', {
  installDir: 'G:\\Roms',
  retro: {
    ...retroOne.retro!,
    romPath: 'G:\\Roms\\Two.nes'
  }
})
assert.deepEqual(
  detectLibraryGamePresences(
    [
      {
        ProcessId: 421,
        Name: 'RetroArch.exe',
        ExecutablePath: 'G:\\Emulators\\RetroArch.exe',
        CommandLine: '"G:\\Emulators\\RetroArch.exe" -f "G:\\Roms\\Two.nes"'
      }
    ],
    [retroOne, retroTwo]
  ).map((presence) => presence.game.id),
  ['retro:rom-two']
)

const ambiguousOne = libraryGame('epic', 'one', { installDir: 'H:\\Shared' })
const ambiguousTwo = libraryGame('epic', 'two', { installDir: 'H:\\Shared' })
assert.deepEqual(
  detectLibraryGamePresences(
    [
      {
        ProcessId: 422,
        Name: 'Shared.exe',
        ExecutablePath: 'H:\\Shared\\Shared.exe',
        MainWindowHandle: 1,
        MainWindowTitle: 'One'
      }
    ],
    [ambiguousOne, ambiguousTwo]
  ),
  []
)
assert.deepEqual(
  detectLibraryGamePresences(
    [{ ProcessId: 423, Name: 'HollowKnight.exe', MainWindowTitle: 'Hollow Knight' }],
    [steamPresenceGame]
  ),
  []
)
assert.deepEqual(
  parseSteamActiveGames(`
[2026-09-06 01:52:19] AppID 367520 adding PID 18748 as a tracked process ""hollow_knight.exe""
[2026-09-06 01:54:44] AppID 367520 no longer tracking PID 18748, exit code 0
`),
  []
)
assert.deepEqual(
  parseSteamActiveGames(`
[2026-09-06 01:52:19] AppID 367520 adding PID 18748 as a tracked process ""hollow_knight.exe""
[2026-09-06 02:35:32] Client version: 1788400362
`),
  []
)
assert.deepEqual(
  parseSteamActiveGames(`
[2026-09-06 01:52:19] AppID 367520 adding PID 18748 as a tracked process ""hollow_knight.exe""
[2026-09-06 01:54:44] Remove 367520 from running list
`),
  []
)

const steamActivityRoot = mkdtempSync(join(tmpdir(), 'orbit-steam-activity-'))
try {
  const logDirectory = join(steamActivityRoot, 'logs')
  mkdirSync(logDirectory)
  const activityLogPath = join(logDirectory, 'gameprocess_log.txt')
  writeFileSync(
    activityLogPath,
    `[2026-09-06 01:52:19] AppID 367520 adding PID ${process.pid} as a tracked process ""hollow_knight.exe""\n`,
    'utf8'
  )
  const activityReader = new SteamGameActivityReader(steamActivityRoot)
  assert.deepEqual(await activityReader.getActiveProcessIds(367520), new Set([process.pid]))
  rmSync(activityLogPath)
  assert.deepEqual(await activityReader.getActiveProcessIds(367520), new Set([process.pid]))
  writeFileSync(
    activityLogPath,
    '[2026-09-06 02:35:32] Client version: 1788400362\n',
    'utf8'
  )
  assert.deepEqual(await activityReader.getActiveProcessIds(367520), new Set())
} finally {
  rmSync(steamActivityRoot, { recursive: true, force: true })
}
assert.deepEqual(gameTrackingMethodsForProvider('xbox'), [
  'package-identity',
  'install-directory',
  'executable',
  'provider-handoff'
])
assert.deepEqual(
  selectGameTrackingMethod('steam', { ...noIdentity, providerReportedGame: true }),
  { method: 'provider-process', fallbackIndex: 0 }
)
assert.deepEqual(
  selectGameTrackingMethod('steam', { ...noIdentity, insideInstallDir: true }),
  { method: 'install-directory', fallbackIndex: 1 }
)
assert.equal(
  windowsExecutableInsideDirectory(
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Alien Isolation\\AI.exe',
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Alien Isolation'
  ),
  true
)
assert.equal(
  windowsExecutableInsideDirectory(
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Alien Isolation Bonus\\AI.exe',
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Alien Isolation'
  ),
  false
)
assert.equal(windowsExecutableInsideDirectory('C:\\Windows\\System32\\not-a-game.exe', 'C:\\'), false)
assert.equal(
  windowsExecutableInsideDirectory('\\\\server\\games\\other\\not-a-game.exe', '\\\\server\\games'),
  false
)
assert.equal(
  windowsCommandLineContainsPath(
    '"G:\\Emulators\\RetroArch.exe" -f "G:\\Roms\\One.nes"',
    'G:\\Roms\\One.nes'
  ),
  true
)
assert.equal(
  windowsCommandLineContainsPath(
    '"G:\\Emulators\\RetroArch.exe" -f "G:\\Roms\\One.nes.backup"',
    'G:\\Roms\\One.nes'
  ),
  false
)
assert.deepEqual(providerSessionTimestamps(100_000, undefined), {
  startedAt: 100_000,
  detectedAt: 100_000
})
assert.deepEqual(providerSessionTimestamps(100_000, 90_000), {
  startedAt: 90_000,
  detectedAt: 100_000
})
assert.deepEqual(providerSessionTimestamps(100_000, 110_000), {
  startedAt: 100_000,
  detectedAt: 100_000
})
assert.deepEqual(
  providerSessionTimestamps(40 * 24 * 60 * 60 * 1_000, 1),
  {
    startedAt: 10 * 24 * 60 * 60 * 1_000,
    detectedAt: 40 * 24 * 60 * 60 * 1_000
  }
)
assert.equal(
  windowsPackageIdentityMatches(
    undefined,
    'C:\\Program Files\\WindowsApps\\Microsoft.Halo_2.0.0.0_x64__8wekyb3d8bbwe\\Halo.exe',
    '',
    'Microsoft.Halo_8wekyb3d8bbwe'
  ),
  true
)
assert.deepEqual(
  selectGameTrackingMethod('steam', { ...noIdentity, executableHintMatches: true }),
  { method: 'executable', fallbackIndex: 2 }
)
assert.deepEqual(
  selectGameTrackingMethod('steam', { ...noIdentity, idMatches: true }),
  { method: 'provider-handoff', fallbackIndex: 3 }
)
assert.deepEqual(
  selectGameTrackingMethod('xbox', { ...noIdentity, packageFamilyMatches: true }),
  { method: 'package-identity', fallbackIndex: 0 }
)
assert.deepEqual(
  selectGameTrackingMethod('local', { ...noIdentity, directlySpawnedGame: true }),
  { method: 'process-tree', fallbackIndex: 0 }
)
assert.equal(
  selectGameTrackingMethod('steam', {
    ...noIdentity,
    fromLauncher: true,
    visible: true
  }),
  undefined
)
assert.deepEqual(
  selectGameTrackingMethod('steam', {
    ...noIdentity,
    fromLauncher: true,
    visible: true,
    nameMatches: true
  }),
  { method: 'provider-handoff', fallbackIndex: 3 }
)

const noEvidence = new LaunchStartupTracker(startedAt, 'local')
assert.equal(noEvidence.failureReason(startedAt + 19_999), undefined)
assert.equal(noEvidence.failureReason(startedAt + 20_000), 'not-started')

const shortLivedLocalProcess = new LaunchStartupTracker(startedAt, 'local')
shortLivedLocalProcess.noteCandidateSeen()
shortLivedLocalProcess.noteCandidateMissing(startedAt + 1_000)
assert.equal(shortLivedLocalProcess.failureReason(startedAt + 19_999), undefined)
assert.equal(shortLivedLocalProcess.failureReason(startedAt + 20_000), 'startup-ended')

const validHandoff = new LaunchStartupTracker(startedAt, 'steam')
validHandoff.noteCandidateSeen()
validHandoff.noteCandidateMissing(startedAt + 2_000)
validHandoff.noteCandidateSeen()
assert.equal(
  validHandoff.failureReason(startedAt + 10_000, startedAt + 9_800),
  undefined
)
validHandoff.noteCandidateStabilized()
assert.equal(validHandoff.failureReason(startedAt + 10_500), undefined)

const flappingReplacement = new LaunchStartupTracker(startedAt, 'local')
flappingReplacement.noteCandidateSeen()
flappingReplacement.noteCandidateMissing(startedAt + 1_000)
assert.equal(
  flappingReplacement.failureReason(startedAt + 20_400, startedAt + 19_900),
  undefined
)
assert.equal(
  flappingReplacement.failureReason(startedAt + 20_551, startedAt + 19_900),
  'startup-ended'
)

const slowStoreHandoff = new LaunchStartupTracker(startedAt, 'xbox')
slowStoreHandoff.noteCandidateSeen()
slowStoreHandoff.noteCandidateMissing(startedAt + 2_000)
assert.equal(slowStoreHandoff.failureReason(startedAt + 16_999), undefined)
assert.equal(slowStoreHandoff.failureReason(startedAt + 74_999), undefined)
assert.equal(slowStoreHandoff.failureReason(startedAt + 75_000), 'startup-ended')

const restartLoop = new LaunchStartupTracker(startedAt, 'local')
restartLoop.noteCandidateSeen()
assert.equal(restartLoop.absoluteFailureReason(startedAt + 32_999), undefined)
assert.equal(restartLoop.absoluteFailureReason(startedAt + 33_000), 'startup-ended')

console.log('Game launch detection policy verified.')
