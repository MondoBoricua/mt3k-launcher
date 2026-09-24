import { mkdir } from 'node:fs/promises'
import { diagnosticLog, diagnosticLogDirectory } from './diagnosticLogStartup'
import { listCaptures, openCapture, openCapturesFolder } from './captures/captureLibrary'
import { ATTRACT_IDLE_MINUTES } from '@shared/attractModePolicy'
import { launchProfileService } from './launchProfileService'
import { restoreRetroArchNetworkCommandsOnDisable } from './retro/retroArchNetworkConfig'
import { isLanguage } from '@shared/language'
import { app, clipboard, ipcMain, shell, type BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { isTextScale } from '@shared/textScale'
import { safeExternalHttpsUrl } from '@shared/externalUrl'
import {
  isGameMediaLinkKind,
  normalizeMediaSearchQuery,
  normalizePastedMediaLink
} from '@shared/mediaLinkSearch'
import {
  achievementGuideSearchQuery,
  achievementGuideTrailer,
  type AchievementGuideResult
} from '@shared/achievementGuide'
import {
  isGameTitleMusicDelay,
  isGameTitleMusicFade,
  isGameTitleMusicVolume
} from '@shared/gameTitleMusic'
import {
  isLauncherMusicSource,
  isLauncherMusicVolume
} from '@shared/launcherMusic'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  AUDIO_CUE_IDS,
  AUDIO_CUE_PRESETS,
  AUDIO_PRESETS,
  isAudioCueId,
  DOCK_MOTIONS,
  DOCK_SIZES,
  DOCK_THEME_IDS,
  GAME_CARD_PRIMARY_ACTIONS,
  HARDWARE_CONTROL_BUTTONS,
  HARDWARE_CONTROL_HOLD_SECONDS,
  HOME_BACKDROP_MODES,
  HOME_BACKDROP_MOTIONS,
  isHomeLayoutId,
  FRIENDS_PROVIDERS,
  IPC,
  isCornerStyleId,
  isOrbitPlusHomeLayoutId,
  isOrbitPlusThemeId,
  isThemeId,
  LIBRARY_GRID_COLUMN_OPTIONS,
  NOTIFICATION_MOTIONS,
  NOTIFICATION_POSITIONS,
  PLAYSTATION_REMOTE_PLAY_PREFERENCES,
  PROFILE_AVATAR_IDS,
  STARTUP_ANIMATION_MODES,
  UNINSTALLED_GAME_COLORS,
  type AppControlAction,
  type CustomApplicationCommitInput,
  type CustomApplicationUpdateInput,
  type CustomGameCommitInput,
  type CustomGameImportSource,
  type CustomGameLaunchArgumentsInput,
  type CustomGameSaveSource,
  type DiscordChatEvent,
  type EpicLoginStatus,
  type FriendsProvider,
  type ImageOrientation,
  type ImageUpdate,
  type LauncherDownloadActivity,
  type LauncherDownloadControlAction,
  type LibraryGame,
  type LibrarySnapshot,
  type OrbitBackgroundServiceAction,
  type OrbitPlusConnectionStatus,
  type OrbitSettings,
  type PlayStationLoginStatus,
  type ResolvedImage,
  type RetroEmulatorDownloadInput,
  type RetroEmulatorInstallInput,
  type RetroGameLaunchArgumentsInput,
  type RetroSystemId,
  type StoreRegionId,
  type SteamAccount,
  type SteamGridDbTokenStatus,
  type SteamLoginStatus,
  type SystemPowerAction,
  type SystemSettingsTarget,
  type SystemStatusSnapshot,
  type XboxLoginStatus
} from '@shared/ipc'
import { isSteamAppId, normalizeMetadataSearchQuery } from '@shared/gameMetadataSearch'
import { lookupSteamStoreMetadata, searchSteamStoreMetadata } from './metadataSearchService'
import { publicSettingsSnapshot, settingsStore } from './settingsStore'
import {
  isRetroArchCommand,
  parseStatus,
  type RetroArchCommandResult,
  type RetroArchStatusSnapshot
} from '@shared/retroArchCommands'
import { sendRetroArchUdp } from './retro/retroArchCommandClient'
import { guestModeService } from './guestModeService'
import { steamAuthManager } from './steam/steamAuth'
import { steamWebApiCredentials } from './steam/steamWebApiCredentials'
import { epicAuthManager } from './epic/epicAuth'
import { playStationAuthManager } from './playstation/playstationAuth'
import { playStationRemotePlayService } from './playstation/remotePlay'
import { libraryService } from './library/libraryService'
import {
  chooseSaveBackupDirectory,
  clearSaveBackupDirectory,
  readSaveBackupDirectoryStatus
} from './saveRestoreService'
import { GameSessionManager } from './gameSessionManager'
import {
  launchGame,
  requestGameInstall,
  requestGameUninstall
} from './gameLauncher'
import { artworkService, resolveImage, resolveCachedImage } from './imageCache'
import { t } from './i18n'
import { syncCoordinator } from './sync/syncCoordinator'
import { storeService } from './store/storeService'
import { getDisplayVersion } from './releaseManifest'
import { OrbitBackgroundMode } from './orbitBackgroundMode'
import { customArtworkService } from './customArtwork'
import { artworkPickerService } from './artworkPickerService'
import { clearSteamGridDbCache, getSteamGridDbTokenStatus } from './steamGridDb'
import { steamGridDbCredentials } from './steamGridDbCredentials'
import { profileAvatarService } from './profileAvatarService'
import { homeWallpaperService } from './homeWallpaperService'
import { startupVideoService } from './startupVideoService'
import { launcherMusicService } from './launcherMusicService'
import { customUiAudioService } from './customUiAudioService'
import { systemUpdateService } from './systemUpdateService'
import { SystemStatusService } from './systemStatusService'
import { launcherDownloadMonitor } from './downloads/launcherDownloadMonitor'
import { controlLauncherDownload } from './downloads/launcherDownloadControl'
import { AppUpdateService, launcherHasActiveDownload } from './appUpdateService'
import { friendsService } from './friendsService'
import {
  normalizeCustomLaunchArguments,
  parseCustomLaunchArguments
} from './customLaunchArguments'
import { RETRO_SYSTEMS } from '@shared/retroSystems'
import { isGeForceNowLaunchMode } from '@shared/geforceNow'
import { applicationService } from './applicationService'
import { netflixMediaService } from './netflixMediaService'
import { retroAchievementsCredentials } from './retro/retroAchievementsCredentials'
import { applyOrbitWallpaper } from './orbitWallpaperService'
import { xboxAuthManager } from './xbox/xboxAuth'
import { achievementService } from './achievements/achievementService'
import { clearXboxAchievementCaches } from './achievements/xboxAchievements'
import { geForceNowCatalogService } from './geforceNow/geforceNowCatalogService'
import { geForceNowWebService } from './geforceNow/geforceNowWebService'
import { LibraryRefreshScheduler } from './library/libraryRefreshScheduler'
import { orbitPlusService } from './orbitPlus/orbitPlusService'
import { validateGameMetadataUpdate } from './library/gameMetadataInput'
import { runSystemPowerAction } from './systemPower'
import { canRequestGameInstall } from '@shared/gameInstallation'

const SYSTEM_POWER_ACTIONS: readonly SystemPowerAction[] = ['sleep', 'restart', 'shutdown']
const SYSTEM_SETTINGS_TARGETS: Record<SystemSettingsTarget, string> = {
  power: 'ms-settings:batterysaver',
  wifi: 'ms-settings:network-wifi',
  ethernet: 'ms-settings:network-ethernet',
  bluetooth: 'ms-settings:bluetooth'
}
const APP_CONTROL_ACTIONS: readonly AppControlAction[] = ['relaunch', 'quit']
const LAUNCHER_DOWNLOAD_CONTROL_ACTIONS: readonly LauncherDownloadControlAction[] = [
  'pause',
  'resume',
  'cancel',
  'open-provider'
]
const BACKGROUND_SERVICE_ACTIONS: readonly OrbitBackgroundServiceAction[] = [
  'install',
  'repair',
  'restart',
  'remove'
]
const CUSTOM_GAME_IMPORT_SOURCES: readonly CustomGameImportSource[] = ['executable', 'folder']
const CUSTOM_GAME_SAVE_SOURCES: readonly CustomGameSaveSource[] = ['file', 'folder']
const IMAGE_ORIENTATIONS: readonly ImageOrientation[] = ['vertical', 'horizontal', 'logo', 'icon']
const RETRO_SYSTEM_IDS = new Set(RETRO_SYSTEMS.map((system) => system.id))

function validatedShortString(value: unknown, label: string, maxLength = 512): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`Invalid ${label}`)
  }
  return value.trim()
}

function validateCustomGameCommit(value: unknown): CustomGameCommitInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid custom game payload')
  }
  const input = value as Record<string, unknown>
  return {
    draftId: validatedShortString(input.draftId, 'custom game draft', 80),
    name: validatedShortString(input.name, 'custom game name', 120),
    launchArguments: normalizeCustomLaunchArguments(input.launchArguments)
  }
}

function validateCustomGameLaunchArguments(value: unknown): CustomGameLaunchArgumentsInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid custom game launch arguments payload')
  }
  const input = value as Record<string, unknown>
  return {
    gameId: validatedShortString(input.gameId, 'custom game ID'),
    launchArguments: normalizeCustomLaunchArguments(input.launchArguments)
  }
}

async function showWindowsSystemKeyboard(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  const commonProgramDirectories = [
    process.env.CommonProgramW6432,
    process.env.CommonProgramFiles,
    'C:\\Program Files\\Common Files'
  ].filter((value): value is string => Boolean(value))
  const keyboardPath = commonProgramDirectories
    .map((directory) => join(directory, 'microsoft shared', 'ink', 'TabTip.exe'))
    .find((candidate) => existsSync(candidate))
  if (!keyboardPath) return false

  return new Promise<boolean>((resolve) => {
    let settled = false
    const settle = (result: boolean): void => {
      if (settled) return
      settled = true
      resolve(result)
    }
    try {
      const child = spawn(keyboardPath, [], { detached: true, stdio: 'ignore' })
      child.once('error', () => settle(false))
      child.once('spawn', () => {
        child.unref()
        settle(true)
      })
    } catch {
      settle(false)
    }
  })
}

function validateCustomApplicationCommit(value: unknown): CustomApplicationCommitInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid custom application payload')
  }
  const input = value as Record<string, unknown>
  return {
    draftId: validatedShortString(input.draftId, 'custom application draft', 160),
    name: validatedShortString(input.name, 'custom application name', 120),
    launchArguments: normalizeCustomLaunchArguments(input.launchArguments)
  }
}

function validateCustomApplicationUpdate(value: unknown): CustomApplicationUpdateInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid custom application update payload')
  }
  const input = value as Record<string, unknown>
  return {
    applicationId: validatedShortString(input.applicationId, 'custom application ID', 160),
    name: validatedShortString(input.name, 'custom application name', 120),
    launchArguments: normalizeCustomLaunchArguments(input.launchArguments)
  }
}

function validateRetroGameLaunchArguments(value: unknown): RetroGameLaunchArgumentsInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid retro game launch arguments payload')
  }
  const input = value as Record<string, unknown>
  return {
    gameId: validatedShortString(input.gameId, 'retro game ID'),
    launchArguments: normalizeCustomLaunchArguments(input.launchArguments)
  }
}

function validateRetroSystemId(value: unknown): RetroSystemId {
  const systemId = validatedShortString(value, 'retro system ID', 64) as RetroSystemId
  if (!RETRO_SYSTEM_IDS.has(systemId)) throw new Error('Unknown retro system')
  return systemId
}

function validateRetroEmulatorDownload(value: unknown): RetroEmulatorDownloadInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid retro system setup payload')
  }
  const input = value as Record<string, unknown>
  return {
    systemId: validateRetroSystemId(input.systemId),
    emulatorId:
      input.emulatorId === undefined
        ? undefined
        : validatedShortString(input.emulatorId, 'retro emulator ID', 64)
  }
}

function validateRetroEmulatorInstall(value: unknown): RetroEmulatorInstallInput {
  return validateRetroEmulatorDownload(value)
}

/** Guest-mode keys never travel through the generic settings channel; the PIN gates them. */
const GUEST_MODE_MANAGED_KEYS = [
  'guestModeEnabled',
  'guestModePinHash',
  'guestModeAllowedCollectionId',
  'guestModeLockout'
] as const

function validatedOptionalPin(value: unknown): unknown {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.length > 16) throw new Error('Invalid guest PIN')
  return value
}

function validateSettingsPartial(value: unknown): asserts value is Partial<OrbitSettings> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid settings payload')
  }
  const partial = value as Record<string, unknown>
  for (const key of GUEST_MODE_MANAGED_KEYS) {
    if (key in partial) throw new Error(`${key} can only be changed through guest mode`)
  }
  if ('language' in partial && !isLanguage(partial.language)) {
    throw new Error('Invalid language')
  }
  if ('textScale' in partial && !isTextScale(partial.textScale)) {
    throw new Error('Invalid text scale')
  }
  if ('geForceNowLaunchMode' in partial && !isGeForceNowLaunchMode(partial.geForceNowLaunchMode)) {
    throw new Error('Invalid GeForce NOW launch mode')
  }
  if ('theme' in partial && !isThemeId(partial.theme)) {
    throw new Error('Invalid theme')
  }
  if ('cornerStyle' in partial && !isCornerStyleId(partial.cornerStyle)) {
    throw new Error('Invalid corner style')
  }
  if ('homeLayout' in partial && !isHomeLayoutId(partial.homeLayout)) {
    throw new Error('Invalid home layout')
  }
  if ('steamGridDbApiKey' in partial) {
    throw new Error('SteamGridDB credentials require the secure credential API')
  }
  if ('steamWebApiKey' in partial) {
    throw new Error('Steam Web API credentials require the secure credential API')
  }
  if (
    'audioPreset' in partial &&
    !AUDIO_PRESETS.includes(partial.audioPreset as (typeof AUDIO_PRESETS)[number])
  ) {
    throw new Error('Invalid audio preset')
  }
  if ('audioCuePresets' in partial) {
    const audioCuePresets = partial.audioCuePresets
    if (
      typeof audioCuePresets !== 'object' ||
      audioCuePresets === null ||
      Array.isArray(audioCuePresets) ||
      Object.keys(audioCuePresets).some(
        (cueId) => !AUDIO_CUE_IDS.includes(cueId as (typeof AUDIO_CUE_IDS)[number])
      ) ||
      AUDIO_CUE_IDS.some(
        (cueId) =>
          !AUDIO_CUE_PRESETS.includes(
            (audioCuePresets as Record<string, unknown>)[cueId] as (typeof AUDIO_CUE_PRESETS)[number]
          )
      )
    ) {
      throw new Error('Invalid manual audio cue presets')
    }
  }
  if (
    'retroAchievementsUsername' in partial &&
    partial.retroAchievementsUsername !== undefined &&
    (typeof partial.retroAchievementsUsername !== 'string' ||
      !partial.retroAchievementsUsername.trim() ||
      partial.retroAchievementsUsername.trim().length > 80 ||
      /[\u0000-\u001f\u007f]/u.test(partial.retroAchievementsUsername))
  ) {
    throw new Error('Invalid RetroAchievements username')
  }
  if ('retroAchievementsWebApiKey' in partial) {
    throw new Error('RetroAchievements credentials require the dedicated credential API')
  }
  if ('saveBackupDirectory' in partial && partial.saveBackupDirectory !== undefined) {
    throw new Error('Use the save backup directory picker')
  }
  if ('retroRomDirectories' in partial) {
    if (
      !Array.isArray(partial.retroRomDirectories) ||
      partial.retroRomDirectories.length > 20 ||
      partial.retroRomDirectories.some(
        (directory) =>
          typeof directory !== 'string' ||
          !directory.trim() ||
          directory.length > 32_768 ||
          /[\u0000-\u001f\u007f]/u.test(directory)
      )
    ) {
      throw new Error('Invalid ROM directories')
    }
  }
  if ('retroSystemEmulators' in partial) {
    if (
      typeof partial.retroSystemEmulators !== 'object' ||
      partial.retroSystemEmulators === null ||
      Array.isArray(partial.retroSystemEmulators) ||
      Object.entries(partial.retroSystemEmulators).some(
        ([systemId, emulatorId]) =>
          !RETRO_SYSTEM_IDS.has(systemId as (typeof RETRO_SYSTEMS)[number]['id']) ||
          typeof emulatorId !== 'string' ||
          !/^[a-z\d][a-z\d-]{0,63}$/i.test(emulatorId)
      )
    ) {
      throw new Error('Invalid retro emulator selections')
    }
  }
  if (
    'libraryGridColumns' in partial &&
    !LIBRARY_GRID_COLUMN_OPTIONS.includes(
      partial.libraryGridColumns as (typeof LIBRARY_GRID_COLUMN_OPTIONS)[number]
    )
  ) {
    throw new Error('Invalid library grid column count')
  }
  if (
    'uninstalledGameColor' in partial &&
    !UNINSTALLED_GAME_COLORS.includes(
      partial.uninstalledGameColor as (typeof UNINSTALLED_GAME_COLORS)[number]
    )
  ) {
    throw new Error('Invalid uninstalled game color')
  }
  if (
    'showSteamSharedGames' in partial &&
    typeof partial.showSteamSharedGames !== 'boolean'
  ) {
    throw new Error('Invalid Steam shared-library visibility state')
  }
  if ('favoriteGameIds' in partial) {
    if (
      !Array.isArray(partial.favoriteGameIds) ||
      partial.favoriteGameIds.length > 10_000 ||
      partial.favoriteGameIds.some(
        (gameId) => typeof gameId !== 'string' || !gameId.trim() || gameId.length > 512
      )
    ) {
      throw new Error('Invalid favorite game IDs')
    }
  }
  if ('excludedGameIds' in partial) {
    if (
      !Array.isArray(partial.excludedGameIds) ||
      partial.excludedGameIds.length > 10_000 ||
      partial.excludedGameIds.some(
        (gameId) => typeof gameId !== 'string' || !gameId.trim() || gameId.length > 512
      )
    ) {
      throw new Error('Invalid excluded game IDs')
    }
  }
  if ('customLibraries' in partial) {
    if (!Array.isArray(partial.customLibraries) || partial.customLibraries.length > 50) {
      throw new Error('Invalid custom libraries')
    }
    for (const candidate of partial.customLibraries) {
      if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
        throw new Error('Invalid custom library')
      }
      const collection = candidate as Record<string, unknown>
      if (
        typeof collection.id !== 'string' ||
        !/^[a-zA-Z0-9-]{1,80}$/.test(collection.id) ||
        typeof collection.name !== 'string' ||
        !collection.name.trim() ||
        collection.name.length > 40 ||
        typeof collection.createdAt !== 'number' ||
        !Number.isFinite(collection.createdAt) ||
        !Array.isArray(collection.gameIds) ||
        collection.gameIds.length > 10_000 ||
        collection.gameIds.some(
          (gameId) => typeof gameId !== 'string' || !gameId.trim() || gameId.length > 512
        )
      ) {
        throw new Error('Invalid custom library')
      }
    }
  }
  if (
    'profileAvatar' in partial &&
    !PROFILE_AVATAR_IDS.includes(partial.profileAvatar as (typeof PROFILE_AVATAR_IDS)[number])
  ) {
    throw new Error('Invalid profile avatar')
  }
  if (
    'startupAnimationMode' in partial &&
    !STARTUP_ANIMATION_MODES.includes(
      partial.startupAnimationMode as (typeof STARTUP_ANIMATION_MODES)[number]
    )
  ) {
    throw new Error('Invalid startup animation mode')
  }
  if (
    'dockTheme' in partial &&
    !DOCK_THEME_IDS.includes(partial.dockTheme as (typeof DOCK_THEME_IDS)[number])
  ) {
    throw new Error('Invalid dock theme')
  }
  if (
    'dockSize' in partial &&
    !DOCK_SIZES.includes(partial.dockSize as (typeof DOCK_SIZES)[number])
  ) {
    throw new Error('Invalid dock size')
  }
  if (
    'dockMotion' in partial &&
    !DOCK_MOTIONS.includes(partial.dockMotion as (typeof DOCK_MOTIONS)[number])
  ) {
    throw new Error('Invalid dock motion')
  }
  if (
    'gameCardPrimaryAction' in partial &&
    !GAME_CARD_PRIMARY_ACTIONS.includes(
      partial.gameCardPrimaryAction as (typeof GAME_CARD_PRIMARY_ACTIONS)[number]
    )
  ) {
    throw new Error('Invalid game card primary action')
  }
  if ('notificationsEnabled' in partial && typeof partial.notificationsEnabled !== 'boolean') {
    throw new Error('Invalid notification state')
  }
  if ('showFriendsHub' in partial && typeof partial.showFriendsHub !== 'boolean') {
    throw new Error('Invalid Friends Hub visibility state')
  }
  if ('backgroundTrailers' in partial && typeof partial.backgroundTrailers !== 'boolean') {
    throw new Error('Invalid background trailers setting')
  }
  if ('launcherMusic' in partial && typeof partial.launcherMusic !== 'boolean') {
    throw new Error('Invalid launcher music setting')
  }
  if (
    'launcherMusicVolume' in partial &&
    !isLauncherMusicVolume(partial.launcherMusicVolume)
  ) {
    throw new Error('Invalid launcher music volume')
  }
  if (
    'launcherMusicSource' in partial &&
    !isLauncherMusicSource(partial.launcherMusicSource)
  ) {
    throw new Error('Invalid launcher music source')
  }
  if ('gameTitleMusic' in partial && typeof partial.gameTitleMusic !== 'boolean') {
    throw new Error('Invalid game title music setting')
  }
  if (
    'gameTitleMusicVolume' in partial &&
    !isGameTitleMusicVolume(partial.gameTitleMusicVolume)
  ) {
    throw new Error('Invalid game title music volume')
  }
  if (
    'gameTitleMusicDelaySeconds' in partial &&
    !isGameTitleMusicDelay(partial.gameTitleMusicDelaySeconds)
  ) {
    throw new Error('Invalid game title music delay')
  }
  if (
    'gameTitleMusicFadeSeconds' in partial &&
    !isGameTitleMusicFade(partial.gameTitleMusicFadeSeconds)
  ) {
    throw new Error('Invalid game title music fade duration')
  }
  if ('appUpdateAutoDownload' in partial && typeof partial.appUpdateAutoDownload !== 'boolean') {
    throw new Error('Invalid app update download preference')
  }
  if (
    'playstationRemotePlayPreference' in partial &&
    !PLAYSTATION_REMOTE_PLAY_PREFERENCES.includes(
      partial.playstationRemotePlayPreference as (typeof PLAYSTATION_REMOTE_PLAY_PREFERENCES)[number]
    )
  ) {
    throw new Error('Invalid PlayStation Remote Play preference')
  }
  if (
    'homeCardBubbleEffect' in partial &&
    typeof partial.homeCardBubbleEffect !== 'boolean'
  ) {
    throw new Error('Invalid Home card bubble effect state')
  }
  if (
    'homeBackdropMode' in partial &&
    !HOME_BACKDROP_MODES.includes(
      partial.homeBackdropMode as (typeof HOME_BACKDROP_MODES)[number]
    )
  ) {
    throw new Error('Invalid Home backdrop mode')
  }
  if (
    'homeBackdropMotion' in partial &&
    !HOME_BACKDROP_MOTIONS.includes(
      partial.homeBackdropMotion as (typeof HOME_BACKDROP_MOTIONS)[number]
    )
  ) {
    throw new Error('Invalid Home backdrop motion')
  }
  if (
    'pinnedBackdropGameId' in partial &&
    partial.pinnedBackdropGameId !== undefined &&
    (typeof partial.pinnedBackdropGameId !== 'string' ||
      !partial.pinnedBackdropGameId.trim() ||
      partial.pinnedBackdropGameId.length > 512)
  ) {
    throw new Error('Invalid pinned Home backdrop game')
  }
  if (
    'notificationPosition' in partial &&
    !NOTIFICATION_POSITIONS.includes(
      partial.notificationPosition as (typeof NOTIFICATION_POSITIONS)[number]
    )
  ) {
    throw new Error('Invalid notification position')
  }
  if (
    'notificationMotion' in partial &&
    !NOTIFICATION_MOTIONS.includes(
      partial.notificationMotion as (typeof NOTIFICATION_MOTIONS)[number]
    )
  ) {
    throw new Error('Invalid notification motion')
  }
  if (
    'hardwareControlEnabled' in partial &&
    typeof partial.hardwareControlEnabled !== 'boolean'
  ) {
    throw new Error('Invalid hardware control state')
  }
  if (
    'hardwareControlButton' in partial &&
    !HARDWARE_CONTROL_BUTTONS.includes(
      partial.hardwareControlButton as (typeof HARDWARE_CONTROL_BUTTONS)[number]
    )
  ) {
    throw new Error('Invalid hardware control button')
  }
  if (
    'hardwareControlHoldSeconds' in partial &&
    !HARDWARE_CONTROL_HOLD_SECONDS.includes(
      partial.hardwareControlHoldSeconds as (typeof HARDWARE_CONTROL_HOLD_SECONDS)[number]
    )
  ) {
    throw new Error('Invalid hardware control hold time')
  }
  if (
    'retroPauseMenuEnabled' in partial &&
    typeof partial.retroPauseMenuEnabled !== 'boolean'
  ) {
    throw new Error('Invalid RetroArch pause menu state')
  }
}

function validatedImageOrientation(value: unknown): ImageOrientation {
  if (!IMAGE_ORIENTATIONS.includes(value as ImageOrientation)) {
    throw new Error('Invalid image orientation')
  }
  return value as ImageOrientation
}

function validatedArtworkSearchOrientation(value: unknown): Exclude<ImageOrientation, 'icon'> {
  const orientation = validatedImageOrientation(value)
  if (orientation === 'icon') throw new Error('Invalid artwork search orientation')
  return orientation
}

function validatedArtworkQuery(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error('Invalid artwork search query')
  const query = value.normalize('NFKC').trim()
  if (!query || query.length > 120 || /[\u0000-\u001f\u007f]/.test(query)) {
    throw new Error('Invalid artwork search query')
  }
  return query
}

function findArtworkGame(gameId: string): LibraryGame | null {
  const game = libraryService.getGame(gameId)
  if (game) return game

  const storeSnapshot = storeService.getSnapshot()
  const product = storeSnapshot.products.find((item) => item.id === gameId)
  const release = storeSnapshot.monthlyReleases.find((item) => item.id === gameId)
  if (!product && !release) return null
  const provider =
    product?.canonicalSource === 'epic' ||
    product?.canonicalSource === 'gog' ||
    product?.canonicalSource === 'xbox'
      ? product.canonicalSource
      : (product?.steamAppId ?? release?.steamAppId)
        ? 'steam'
        : 'local'
  return {
    id: product?.id ?? release!.id,
    provider,
    providerGameId:
      product?.sourceProductId ?? release?.sourceProductId ?? String(product?.id ?? release!.id),
    appId: product?.steamAppId ?? release?.steamAppId,
    name: product?.name ?? release!.name,
    metadata: {
      backgroundUrl: product?.heroUrl ?? release?.heroUrl,
      storeHeaderUrl: product?.headerUrl ?? release?.capsuleUrl,
      artwork: {
        vertical: [product?.portraitUrl].filter((url): url is string => Boolean(url)),
        horizontal: [
          product?.heroUrl,
          product?.headerUrl,
          release?.heroUrl,
          release?.capsuleUrl
        ].filter((url): url is string => Boolean(url)),
        icon: [],
        logo: []
      }
    },
    metadataRevision: 1,
    metadataSource: release ? 'orbit-release-calendar' : 'orbit-store',
    installed: false,
    addedAt: product?.updatedAt ?? release!.releaseDate,
    updatedAt: product?.updatedAt ?? release!.releaseDate
  }
}

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  const captureAction = async <T>(action: () => Promise<T>): Promise<T> => {
    try { return await action() }
    catch (error) { console.warn('[captures] Request failed', error); throw error }
  }
  ipcMain.handle(IPC.attractArtwork, (): Record<string, string> => {
    if (settingsStore.get('attractModeEnabled') !== true) return {}
    const snapshot = libraryService.getSnapshot()
    const excluded = new Set(snapshot.excludedGames.map((game) => game.id))
    return Object.fromEntries(snapshot.games.filter((game) => !excluded.has(game.id)).flatMap((game) => {
      const image = resolveCachedImage(game, 'horizontal')
      return image ? [[game.id, image.url]] : []
    }))
  })
  ipcMain.handle(IPC.capturesList, () => captureAction(listCaptures))
  ipcMain.handle(IPC.capturesOpen, (_event, value: unknown) => {
    guestModeService.assertActionAllowed('open-captures')
    return captureAction(() => openCapture(value))
  })
  ipcMain.handle(IPC.capturesOpenFolder, () => {
    guestModeService.assertActionAllowed('open-captures')
    return captureAction(openCapturesFolder)
  })
  launchProfileService.initialize((event) => {
    if (!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send(IPC.launchProfilesEvent, event)
  })
  // Si el toggle quedó apagado, devolvemos el cfg solo cuando todavía es el nuestro.
  void restoreRetroArchNetworkCommandsOnDisable()
  app.once('before-quit', () => launchProfileService.dispose())
  const profileGameId = (value: unknown): string => {
    if (typeof value !== 'string' || value.length > 512 || ['__proto__', 'constructor', 'prototype'].includes(value) || !libraryService.getGame(value)) throw new Error('Invalid library game')
    return value
  }
  const profileRequest = <T>(event: Electron.IpcMainInvokeEvent, action: () => T): T => {
    try {
      if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('Invalid display request sender')
      if (settingsStore.get('launchProfilesEnabled') !== true) throw new Error('Launch profiles disabled')
      return action()
    } catch (error) { console.warn('[launch-profiles] IPC request failed:', error); throw error }
  }
  ipcMain.handle(IPC.displayListModes, (event) => profileRequest(event, () => launchProfileService.listModes()))
  ipcMain.handle(IPC.launchProfilesGet, (event, id: unknown) => profileRequest(event, () => launchProfileService.get(profileGameId(id))))
  ipcMain.handle(IPC.launchProfilesSave, (event, id: unknown, mode: unknown, profile: unknown) => profileRequest(event, () => launchProfileService.save(profileGameId(id), mode, profile)))
  ipcMain.handle(IPC.launchProfilesConfirm, (event, token: unknown) => profileRequest(event, () => launchProfileService.confirm(token)))
  ipcMain.handle(IPC.launchProfilesRevert, (event) => profileRequest(event, () => launchProfileService.restore()))
  ipcMain.handle(IPC.launchProfilesError, (event) => profileRequest(event, () => launchProfileService.takeError()))
  // Olvidar el journal funciona aunque el toggle esté apagado: es el escape si el monitor no vuelve.
  const assertProfileSender = (event: Electron.IpcMainInvokeEvent): void => {
    if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
      throw new Error('Invalid display request sender')
    }
  }
  ipcMain.handle(IPC.launchProfilesPending, (event) => {
    assertProfileSender(event)
    return launchProfileService.hasPendingRestore()
  })
  ipcMain.handle(IPC.launchProfilesDiscard, (event) => {
    assertProfileSender(event)
    return launchProfileService.discardPendingRestore()
  })
  const mainWindowDisposers = new Set<() => void>()
  const disposeWithMainWindow = (dispose: () => void): void => {
    mainWindowDisposers.add(dispose)
  }
  mainWindow.once('closed', () => {
    for (const dispose of mainWindowDisposers) {
      try {
        dispose()
      } catch (error) {
        console.warn('[ipc] Main-window cleanup failed:', error)
      }
    }
    mainWindowDisposers.clear()
  })
  app.once('before-quit', () => applicationService.dispose())
  app.once('before-quit', () => geForceNowCatalogService.dispose())
  app.once('before-quit', () => libraryService.dispose())
  disposeWithMainWindow(() => orbitPlusService.dispose())
  const sendSteamAccountUpdate = (account: SteamAccount): void => {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send(IPC.steamAccountUpdated, account)
  }
  steamAuthManager.on('account', sendSteamAccountUpdate)
  disposeWithMainWindow(() => steamAuthManager.off('account', sendSteamAccountUpdate))
  const sendFriendsUpdate = (): void => {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send(IPC.friendsUpdated, friendsService.getSnapshot())
  }
  friendsService.on('updated', sendFriendsUpdate)
  disposeWithMainWindow(() => friendsService.off('updated', sendFriendsUpdate))
  const sendDiscordChatMessage = (event: DiscordChatEvent): void => {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send(IPC.discordChatMessage, event)
  }
  friendsService.on('discord-chat-message', sendDiscordChatMessage)
  disposeWithMainWindow(() =>
    friendsService.off('discord-chat-message', sendDiscordChatMessage)
  )
  app.once('before-quit', () => friendsService.dispose())
  // Warm the provider-neutral cache while the renderer is loading so opening
  // the Friends Hub never becomes the trigger for its first network request.
  void friendsService.refresh()
  const libraryRefreshScheduler = new LibraryRefreshScheduler((targets) =>
    libraryService.refreshInstalledProviders(targets)
  )
  disposeWithMainWindow(() => libraryRefreshScheduler.dispose())
  const gameSessionManager = new GameSessionManager(mainWindow, {
    beforeLocalLaunch: (game) => launchProfileService.beforeLaunch(game.id),
    restoreLaunchProfile: () => launchProfileService.restore(),
    getLibraryGames: () => libraryService.getSnapshot().games,
    getGeForceNowMatches: () => currentGeForceNowSnapshot().matches,
    onGameConfirmed: (game, detectedAt, source) => libraryService.markGameStarted(game.id, detectedAt, source),
    onSessionCompleted: (game, session) => {
      const result = libraryService.recordGameSession(
        game.id,
        session.durationSeconds,
        session.endedAt
      )
      // recordGameSession already schedules a game-scoped Steam/Epic playtime
      // reconciliation. Avoid a redundant provider or whole-library scan here.
      return result
    },
    onGameEnded: (game) => libraryService.backupCustomGame(game.id)
  })
  let gameSessionDisposed = false
  const disposeGameSession = (): void => {
    if (gameSessionDisposed) return
    gameSessionDisposed = true
    const completed = gameSessionManager.finalizeForShutdown()
    if (completed) {
      libraryService.recordGameSession(
        completed.gameId,
        completed.durationSeconds,
        completed.endedAt
      )
    }
  }
  app.once('before-quit', disposeGameSession)
  disposeWithMainWindow(disposeGameSession)
  const backgroundServiceManager = new OrbitBackgroundMode(mainWindow, {
    // El atajo de hardware solo abre el menú si el toggle está prendido
    // y la sesión que corre es RetroArch, no un emulador suelto.
    retroArchPauseEligible: () =>
      settingsStore.store.retroPauseMenuEnabled === true &&
      gameSessionManager.isRetroArchSession()
  })
  const disposeBackgroundService = (): void => backgroundServiceManager.dispose()
  app.once('before-quit', disposeBackgroundService)
  disposeWithMainWindow(disposeBackgroundService)
  const appUpdateService = new AppUpdateService(mainWindow, {
    getGameLaunchPhase: () => gameSessionManager.getStatus().phase,
    hasActiveLauncherDownload: () =>
      launcherHasActiveDownload(
        launcherDownloadMonitor.getSnapshot().activities.map((activity) => activity.phase)
      ),
    prepareForInstall: (transactionId) =>
      backgroundServiceManager.prepareForAppUpdate(transactionId),
    recoverFromFailedInstall: (transactionId) =>
      backgroundServiceManager.recoverFromFailedAppUpdate(transactionId),
    getAutoDownloadEnabled: () => settingsStore.store.appUpdateAutoDownload
  })
  const appUpdateStartup = appUpdateService.start()
  backgroundServiceManager.start(appUpdateStartup)
  let appUpdateDisposed = false
  const disposeAppUpdate = (): void => {
    if (appUpdateDisposed) return
    appUpdateDisposed = true
    appUpdateService.dispose()
  }
  disposeWithMainWindow(disposeAppUpdate)
  const systemStatusService = new SystemStatusService()
  const sendSystemStatus = (snapshot: SystemStatusSnapshot): void => {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send(IPC.systemStatusUpdated, snapshot)
  }
  systemStatusService.on('updated', sendSystemStatus)
  systemStatusService.start()
  let systemStatusDisposed = false
  const disposeSystemStatus = (): void => {
    if (systemStatusDisposed) return
    systemStatusDisposed = true
    systemStatusService.off('updated', sendSystemStatus)
    systemStatusService.dispose()
  }
  app.once('before-quit', disposeSystemStatus)
  disposeWithMainWindow(disposeSystemStatus)
  const sendLauncherDownloads = (): void => {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send(
      IPC.launcherDownloadsUpdated,
      launcherDownloadMonitor.getSnapshot()
    )
    appUpdateService.refreshBlockers()
  }
  const refreshLibraryAfterDownload = (activity: LauncherDownloadActivity): void => {
    libraryRefreshScheduler.request({
      provider: activity.provider,
      providerGameId: activity.providerGameId
    })
  }
  launcherDownloadMonitor.on('updated', sendLauncherDownloads)
  launcherDownloadMonitor.on('completed', refreshLibraryAfterDownload)
  launcherDownloadMonitor.start()
  let launcherDownloadsDisposed = false
  const disposeLauncherDownloads = (): void => {
    if (launcherDownloadsDisposed) return
    launcherDownloadsDisposed = true
    launcherDownloadMonitor.off('updated', sendLauncherDownloads)
    launcherDownloadMonitor.off('completed', refreshLibraryAfterDownload)
    launcherDownloadMonitor.stop()
  }
  disposeWithMainWindow(disposeLauncherDownloads)
  const sendLibrarySnapshot = (snapshot: LibrarySnapshot): void => {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send(IPC.libraryUpdated, snapshot)
  }
  libraryService.on('updated', sendLibrarySnapshot)
  disposeWithMainWindow(() => libraryService.off('updated', sendLibrarySnapshot))
  const currentGeForceNowSnapshot = () =>
    geForceNowCatalogService.getSnapshot(libraryService.getSnapshot().games)
  const sendGeForceNowSnapshot = (): void => {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send(IPC.geforceNowCatalogUpdated, currentGeForceNowSnapshot())
  }
  geForceNowCatalogService.on('updated', sendGeForceNowSnapshot)
  libraryService.on('updated', sendGeForceNowSnapshot)
  disposeWithMainWindow(() => {
    geForceNowCatalogService.off('updated', sendGeForceNowSnapshot)
    libraryService.off('updated', sendGeForceNowSnapshot)
  })
  const sendArtworkUpdate = (update: ImageUpdate): void => {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    const customArtwork = customArtworkService.resolve(update.gameId, update.orientation)
    mainWindow.webContents.send(IPC.imageUpdated, {
      ...update,
      image: customArtwork ?? update.image
    })
  }
  const sendArtworkInvalidated = (): void => {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send(IPC.imageCacheInvalidated)
  }
  const sendSyncUpdate = (status: ReturnType<typeof syncCoordinator.getStatus>): void => {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send(IPC.syncUpdated, status)
  }
  const sendStoreUpdate = (snapshot: ReturnType<typeof storeService.getSnapshot>): void => {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send(IPC.storeUpdated, snapshot)
  }
  artworkService.on('updated', sendArtworkUpdate)
  artworkService.on('invalidated', sendArtworkInvalidated)
  syncCoordinator.on('updated', sendSyncUpdate)
  storeService.on('updated', sendStoreUpdate)
  disposeWithMainWindow(() => {
    artworkService.off('updated', sendArtworkUpdate)
    artworkService.off('invalidated', sendArtworkInvalidated)
    syncCoordinator.off('updated', sendSyncUpdate)
    storeService.off('updated', sendStoreUpdate)
  })
  let gameSessionPerformanceEligible = false
  let returningFromGame = false
  let backgroundWorkPausedForGame = false
  const syncGamePerformanceMode = (): void => {
    if (mainWindow.isFocused()) {
      libraryRefreshScheduler.handleWindowFocused(Date.now(), !returningFromGame)
      returningFromGame = false
    } else libraryRefreshScheduler.handleWindowBlurred()
    const shouldPause = gameSessionPerformanceEligible && !mainWindow.isFocused()
    if (backgroundWorkPausedForGame === shouldPause) return
    backgroundWorkPausedForGame = shouldPause
    // These services only feed hidden launcher surfaces. Pause them while the
    // game owns foreground focus, then restore their live behavior as soon as
    // the user returns to ORBIT.
    launcherDownloadMonitor.setPollingPaused(shouldPause)
    systemStatusService.setPaused(shouldPause)
    storeService.setBackgroundRefreshPaused(shouldPause)
    libraryService.setBackgroundEnrichmentPaused(shouldPause)
    // PackageCatalog events are intentionally not kept resident during play.
    // On return, scan only installed Xbox packages; account and catalog data
    // are unrelated to a download that completed while ORBIT was hidden.
    if (!shouldPause) libraryRefreshScheduler.request({ provider: 'xbox' })
  }
  mainWindow.on('focus', syncGamePerformanceMode)
  mainWindow.on('blur', syncGamePerformanceMode)
  const sendGameSessionUpdate = (status: ReturnType<typeof gameSessionManager.getStatus>): void => {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    if (status.phase === 'returning') returningFromGame = true
    const performanceEligible = status.phase === 'launching' || status.phase === 'running'
    if (gameSessionPerformanceEligible !== performanceEligible) {
      gameSessionPerformanceEligible = performanceEligible
      syncGamePerformanceMode()
    }
    mainWindow.webContents.send(IPC.gameLaunchStatus, status)
    appUpdateService.refreshBlockers()
  }
  gameSessionManager.on('updated', sendGameSessionUpdate)
  disposeWithMainWindow(() => {
    mainWindow.off('focus', syncGamePerformanceMode)
    mainWindow.off('blur', syncGamePerformanceMode)
    gameSessionManager.off('updated', sendGameSessionUpdate)
  })

  ipcMain.handle(IPC.launcherDownloadsGet, () => launcherDownloadMonitor.getSnapshot())
  ipcMain.handle(
    IPC.launcherDownloadsControl,
    async (_event, activityIdValue: unknown, actionValue: unknown) => {
      const activityId = validatedShortString(
        activityIdValue,
        'launcher download activity ID',
        768
      )
      if (
        !LAUNCHER_DOWNLOAD_CONTROL_ACTIONS.includes(
          actionValue as LauncherDownloadControlAction
        )
      ) {
        throw new Error('Invalid launcher download action')
      }
      const action = actionValue as LauncherDownloadControlAction
      const activity = launcherDownloadMonitor.getActivity(activityId)
      if (!activity) throw new Error('Launcher download is no longer active')
      const result = await controlLauncherDownload(activity, action)
      if (result.state === 'provider-opened') {
        libraryRefreshScheduler.expectLauncherReturn(`launcher:${activity.provider}`)
      }
      if (action === 'cancel') {
        libraryRefreshScheduler.request({
          provider: activity.provider,
          providerGameId: activity.providerGameId
        })
      }
      return result
    }
  )
  ipcMain.handle(IPC.settingsGet, (): OrbitSettings => publicSettingsSnapshot())

  ipcMain.handle(IPC.profileAvatarGetCustom, () => profileAvatarService.resolve())
  ipcMain.handle(IPC.profileAvatarSelectCustom, () => profileAvatarService.select(mainWindow))
  ipcMain.handle(IPC.homeWallpaperGet, () => homeWallpaperService.resolve())
  ipcMain.handle(IPC.homeWallpaperSelect, () => homeWallpaperService.select(mainWindow))
  ipcMain.handle(IPC.homeWallpaperClear, () => homeWallpaperService.clear())
  ipcMain.handle(IPC.launcherMusicGetCustom, () => launcherMusicService.resolve())
  ipcMain.handle(IPC.launcherMusicSelectCustom, () => {
    if (!orbitPlusService.hasFeature('manual-audio')) {
      throw new Error('ORBIT Plus is required for custom launcher music')
    }
    return launcherMusicService.select(mainWindow)
  })
  ipcMain.handle(IPC.launcherMusicClearCustom, () => launcherMusicService.clear())
  ipcMain.handle(IPC.uiAudioGetCustom, () => customUiAudioService.resolveAll())
  ipcMain.handle(IPC.uiAudioSelectCustom, (_event, cueIdValue: unknown) => {
    if (!orbitPlusService.hasFeature('manual-audio')) {
      throw new Error('ORBIT Plus is required for custom interface sounds')
    }
    if (!isAudioCueId(cueIdValue)) throw new Error('Invalid interface sound ID')
    return customUiAudioService.select(mainWindow, cueIdValue)
  })
  ipcMain.handle(IPC.uiAudioClearCustom, (_event, cueIdValue: unknown) => {
    if (!isAudioCueId(cueIdValue)) throw new Error('Invalid interface sound ID')
    return customUiAudioService.clear(cueIdValue)
  })
  ipcMain.handle(IPC.startupVideoGet, () => startupVideoService.resolveUrl())
  ipcMain.handle(IPC.startupVideoSelect, () => startupVideoService.select(mainWindow))

  ipcMain.handle(IPC.settingsSet, (_e, partial: unknown) => {
    guestModeService.assertActionAllowed('change-settings')
    validateSettingsPartial(partial)
    for (const key of ['backgroundModeEnabled', 'startWithWindows', 'attractModeEnabled', 'captureShelfEnabled', 'launchProfilesEnabled'] as const) {
      if (key in partial && typeof partial[key] !== 'boolean') throw new Error(`Invalid ${key}`)
    }
    if ('attractModeIdleMinutes' in partial && !ATTRACT_IDLE_MINUTES.includes(partial.attractModeIdleMinutes as 2 | 5 | 10 | 15)) throw new Error('Invalid attract idle minutes')
    if ('startWithWindows' in partial) backgroundServiceManager.setStartWithWindows(partial.startWithWindows!)
    if (
      (partial.audioPreset === 'manual' || 'audioCuePresets' in partial) &&
      !orbitPlusService.hasFeature('manual-audio')
    ) {
      throw new Error('ORBIT Plus is required for manual audio')
    }
    if (
      partial.launcherMusicSource === 'custom' &&
      !orbitPlusService.hasFeature('manual-audio')
    ) {
      throw new Error('ORBIT Plus is required for custom launcher music')
    }
    if (
      ((partial.theme !== undefined && isOrbitPlusThemeId(partial.theme)) ||
        (partial.homeLayout !== undefined && isOrbitPlusHomeLayoutId(partial.homeLayout)) ||
        (partial.cornerStyle !== undefined && partial.cornerStyle !== 'theme')) &&
      !orbitPlusService.hasFeature('premium-appearance')
    ) {
      throw new Error('ORBIT Plus is required for premium appearance')
    }
    const languageChanged = partial.language !== undefined && partial.language !== settingsStore.get('language')
    const retroPauseTurningOff =
      partial.retroPauseMenuEnabled === false && settingsStore.get('retroPauseMenuEnabled') === true
    const next = { ...publicSettingsSnapshot(), ...partial }
    settingsStore.set(next)
    if ('launchProfilesEnabled' in partial) launchProfileService.preferencesChanged()
    if (retroPauseTurningOff) void restoreRetroArchNetworkCommandsOnDisable()
    if (languageChanged) {
      geForceNowCatalogService.refreshIfStale()
      void libraryService.refresh().catch(() => undefined)
      void storeService.refreshLanguage().catch(() => undefined)
    }
    if (
      'hardwareControlEnabled' in partial ||
      'hardwareControlButton' in partial ||
      'hardwareControlHoldSeconds' in partial ||
      'backgroundModeEnabled' in partial ||
      'language' in partial
    ) {
      void backgroundServiceManager.reloadSettings()
    }
    if ('showAchievements' in partial && partial.showAchievements === true) {
      void libraryService.syncAchievements(true)
    }
    if ('appUpdateAutoDownload' in partial) {
      appUpdateService.refreshPreferences()
    }
    if ('playstationRemotePlayPreference' in partial) {
      void playStationRemotePlayService.refresh(true).then(() => libraryService.refresh())
    }
    return publicSettingsSnapshot()
  })

  ipcMain.handle(IPC.orbitPlusGet, () => orbitPlusService.restore())
  ipcMain.handle(IPC.orbitPlusRefresh, (_event, force: unknown) =>
    orbitPlusService.refresh(force)
  )
  ipcMain.handle(IPC.orbitPlusPatreonConnect, () => {
    const sendStatus = (status: OrbitPlusConnectionStatus): void => {
      if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
      mainWindow.webContents.send(IPC.orbitPlusStatus, status)
    }
    return orbitPlusService.startPatreonConnection(sendStatus)
  })
  ipcMain.handle(IPC.orbitPlusPatreonCancel, () =>
    orbitPlusService.cancelPatreonConnection()
  )
  ipcMain.handle(IPC.orbitPlusCheckoutOpen, (_event, plan: unknown) =>
    orbitPlusService.openCheckout(plan)
  )
  ipcMain.handle(IPC.orbitPlusLicenseActivate, (_event, key: unknown) =>
    orbitPlusService.activateLicense(key)
  )
  ipcMain.handle(IPC.orbitPlusLicenseDeactivate, () =>
    orbitPlusService.deactivateLicense()
  )
  ipcMain.handle(IPC.orbitPlusOwnerTestSet, (_event, enabled: unknown) =>
    orbitPlusService.setOwnerTestAccess(enabled)
  )
  ipcMain.handle(IPC.orbitPlusDisconnect, () => orbitPlusService.disconnect())

  ipcMain.handle(IPC.retroAchievementsCredentialGet, () =>
    retroAchievementsCredentials.getStatus()
  )
  ipcMain.handle(IPC.retroAchievementsCredentialSet, (_e, apiKey: unknown) => {
    const status = retroAchievementsCredentials.setApiKey(apiKey)
    if (settingsStore.store.showAchievements) void libraryService.syncAchievements(true)
    return status
  })
  ipcMain.handle(IPC.retroAchievementsCredentialClear, () =>
    retroAchievementsCredentials.clear()
  )

  ipcMain.handle(IPC.steamWebApiCredentialGet, () => steamWebApiCredentials.getStatus())
  ipcMain.handle(IPC.steamWebApiCredentialSet, (_e, apiKey: unknown) => {
    const status = steamWebApiCredentials.setApiKey(apiKey)
    if (settingsStore.store.showAchievements) void libraryService.syncAchievements(true)
    return status
  })
  ipcMain.handle(IPC.steamWebApiCredentialClear, () => {
    const status = steamWebApiCredentials.clear()
    if (settingsStore.store.showAchievements) void libraryService.syncAchievements(true)
    return status
  })

  ipcMain.handle(IPC.appVersion, () => getDisplayVersion())
  ipcMain.handle(IPC.appLogPath, () => diagnosticLog.path)
  ipcMain.handle(IPC.appOpenLogFolder, async () => {
    guestModeService.assertActionAllowed('change-settings')
    try {
      await mkdir(diagnosticLogDirectory, { recursive: true })
      const error = await shell.openPath(diagnosticLogDirectory)
      if (error) throw new Error(error)
      return true
    } catch (error) {
      console.warn('[diagnostic-log] Could not open log folder', error)
      return false
    }
  })
  ipcMain.handle(IPC.appUpdateGet, () => appUpdateService.getSnapshot())
  ipcMain.handle(IPC.appUpdateCheck, () => appUpdateService.check(true))
  ipcMain.handle(IPC.appUpdateDownload, () => appUpdateService.download())
  ipcMain.handle(IPC.appUpdateInstall, () => appUpdateService.install())
  ipcMain.handle(IPC.appUpdateDefer, () => appUpdateService.defer())
  ipcMain.handle(IPC.backgroundServiceGetStatus, () => backgroundServiceManager.getStatus())
  ipcMain.handle(IPC.backgroundServiceControl, (_e, action: unknown) => {
    if (!BACKGROUND_SERVICE_ACTIONS.includes(action as OrbitBackgroundServiceAction)) {
      throw new Error('Invalid background service action')
    }
    return backgroundServiceManager.control(action as OrbitBackgroundServiceAction)
  })
  ipcMain.handle(IPC.hardwareControlGetStatus, async () => {
    const status = await backgroundServiceManager.getStatus()
    return status.hardwareControl
  })
  guestModeService.attach(mainWindow)
  ipcMain.handle(IPC.guestModeStatus, () => guestModeService.status())
  ipcMain.handle(IPC.guestModeLockSettings, () => guestModeService.lockSettings())
  ipcMain.handle(IPC.guestModeSetup, (_e, pin: unknown, currentPin: unknown) =>
    guestModeService.setPin(validatedOptionalPin(pin), validatedOptionalPin(currentPin))
  )
  ipcMain.handle(IPC.guestModeVerify, (_e, pin: unknown) =>
    guestModeService.verifyPin(validatedOptionalPin(pin))
  )
  ipcMain.handle(IPC.guestModeEnable, (_e, pin: unknown) =>
    guestModeService.enable(validatedOptionalPin(pin))
  )
  ipcMain.handle(IPC.guestModeDisable, (_e, pin: unknown) =>
    guestModeService.disable(validatedOptionalPin(pin))
  )
  ipcMain.handle(
    IPC.guestModeSetAllowedCollection,
    (_e, collectionId: unknown, pin: unknown) => {
      if (
        collectionId !== null &&
        collectionId !== undefined &&
        (typeof collectionId !== 'string' || collectionId.length > 128)
      ) {
        throw new Error('Invalid collection ID')
      }
      return guestModeService.setAllowedCollection(collectionId, validatedOptionalPin(pin))
    }
  )
  ipcMain.handle(IPC.applicationsGet, () => applicationService.getSnapshot())
  ipcMain.handle(IPC.applicationsRefresh, () => applicationService.getSnapshot(true))
  ipcMain.handle(IPC.applicationsLaunch, async (_e, applicationIdValue: unknown) => {
    guestModeService.assertActionAllowed('launch-application')
    const applicationId = validatedShortString(applicationIdValue, 'application ID', 160)
    const result = await applicationService.launch(applicationId, mainWindow)
    libraryRefreshScheduler.expectLauncherReturn(applicationId)
    return result
  })
  ipcMain.handle(IPC.geforceNowCatalogGet, () => {
    geForceNowCatalogService.refreshIfStale()
    return currentGeForceNowSnapshot()
  })
  ipcMain.handle(IPC.geforceNowCatalogRefresh, async () => {
    await geForceNowCatalogService.refresh(true)
    return currentGeForceNowSnapshot()
  })
  ipcMain.handle(IPC.geforceNowGameLaunch, async (_e, gameIdValue: unknown) => {
    orbitPlusService.requireFeature('cloud-gaming')
    const gameId = validatedShortString(gameIdValue, 'GeForce NOW game ID')
    const game = libraryService.getGame(gameId)
    if (!game) throw new Error('Game is not available')
    await geForceNowCatalogService.refresh()
    const match = geForceNowCatalogService.matchGame(game)
    if (!match) throw new Error('Game is not available on GeForce NOW')
    await gameSessionManager.startGeForceNow(game, async () => {
      let cancelTracking: (() => void) | undefined
      try {
        await applicationService.launchGeForceNowGame(match, mainWindow, () => {
          cancelTracking = gameSessionManager.expectGeForceNowGame(game, match)
        })
      } catch (error) {
        cancelTracking?.()
        throw error
      }
    })
  })
  ipcMain.handle(IPC.geforceNowNativeAvailable, () => applicationService.isGeForceNowNativeAvailable())
  ipcMain.handle(IPC.geforceNowOpenBrowser, () => geForceNowWebService.launchInBrowser())
  ipcMain.on(IPC.mediaKeyboardUpdate, (event, value: unknown) =>
    netflixMediaService.handleKeyboardUpdate(event.sender, value)
  )
  ipcMain.on(IPC.mediaKeyboardComplete, (event, value: unknown) =>
    netflixMediaService.handleKeyboardComplete(event.sender, value)
  )
  ipcMain.on(IPC.mediaKeyboardClose, (event, requestId: unknown) =>
    netflixMediaService.handleKeyboardClose(event.sender, requestId)
  )
  ipcMain.handle(IPC.customApplicationSelect, () =>
    applicationService.selectCustomApplication(mainWindow)
  )
  ipcMain.handle(IPC.customApplicationCommit, (_e, value: unknown) =>
    applicationService.commitCustomApplication(validateCustomApplicationCommit(value))
  )
  ipcMain.handle(IPC.customApplicationUpdate, (_e, value: unknown) =>
    applicationService.updateCustomApplication(validateCustomApplicationUpdate(value))
  )
  ipcMain.handle(IPC.customApplicationRemove, (_e, applicationId: unknown) =>
    applicationService.removeCustomApplication(
      validatedShortString(applicationId, 'custom application ID', 160)
    )
  )
  ipcMain.handle(IPC.customApplicationCancel, (_e, draftId: unknown) =>
    applicationService.cancelCustomApplication(
      validatedShortString(draftId, 'custom application draft', 160)
    )
  )
  ipcMain.handle(IPC.appControl, (_e, action: unknown) => {
    if (!APP_CONTROL_ACTIONS.includes(action as AppControlAction)) {
      throw new Error('Invalid app control action')
    }
    setTimeout(() => {
      if (action === 'relaunch') app.relaunch()
      app.quit()
    }, 60)
  })
  ipcMain.handle(IPC.systemPower, (_e, action: unknown) => {
    if (!SYSTEM_POWER_ACTIONS.includes(action as SystemPowerAction)) {
      throw new Error('Invalid system power action')
    }
    return runSystemPowerAction(action as SystemPowerAction)
  })
  ipcMain.handle(IPC.syncGet, () => syncCoordinator.getStatus())
  ipcMain.handle(IPC.systemUpdatesCheck, () => systemUpdateService.check())
  ipcMain.handle(IPC.systemOpenUpdateSettings, () => shell.openExternal('ms-settings:windowsupdate'))
  ipcMain.handle(IPC.systemStatusGet, () => systemStatusService.getSnapshot())
  ipcMain.handle(IPC.systemStatusRefresh, () => systemStatusService.refresh())
  ipcMain.handle(IPC.systemKeyboardShow, () => showWindowsSystemKeyboard())
  ipcMain.handle(IPC.systemWallpaperApply, () => applyOrbitWallpaper())
  ipcMain.handle(IPC.systemOpenSettings, (_e, target: unknown) => {
    if (typeof target !== 'string' || !Object.hasOwn(SYSTEM_SETTINGS_TARGETS, target)) {
      throw new Error('Invalid system settings target')
    }
    if (process.platform !== 'win32') {
      throw new Error('System settings are currently available on Windows only')
    }
    return shell.openExternal(SYSTEM_SETTINGS_TARGETS[target as SystemSettingsTarget])
  })
  ipcMain.handle(IPC.storeGet, () => storeService.getSnapshot())
  ipcMain.handle(IPC.storeRefresh, () => storeService.refresh())
  ipcMain.handle(IPC.storeCompareProduct, (_e, productId: string) =>
    storeService.compareProduct(productId)
  )
  ipcMain.handle(IPC.storeSearch, (_e, query: string) => storeService.search(query))
  ipcMain.handle(IPC.storeToggleWishlist, (_e, productId: string) =>
    storeService.toggleOrbitWishlist(productId)
  )
  ipcMain.handle(IPC.storeSetPriceAlert, (_e, productId: string, targetPriceMinor: number) =>
    storeService.setPriceAlert(productId, targetPriceMinor)
  )
  ipcMain.handle(IPC.storeRemovePriceAlert, (_e, productId: string) =>
    storeService.removePriceAlert(productId)
  )
  ipcMain.handle(IPC.storeSetRegion, (_e, region: StoreRegionId) =>
    storeService.setRegion(region)
  )

  ipcMain.handle(IPC.steamGetAccount, async () => {
    const restored = await steamAuthManager.restoreSession()
    return restored
  })

  ipcMain.handle(IPC.steamLoginStart, async () => {
    const sendStatus = (status: SteamLoginStatus): void => {
      mainWindow.webContents.send(IPC.steamLoginStatus, status)
    }
    try {
      await steamAuthManager.startLogin(sendStatus, mainWindow)
      void friendsService.refresh()
    } catch (err) {
      sendStatus({
        state: 'error',
        message: err instanceof Error ? err.message : t('loginFailed')
      })
    }
  })

  ipcMain.handle(IPC.steamLoginCancel, () => {
    steamAuthManager.cancelLogin()
  })

  ipcMain.handle(IPC.steamLogout, async () => {
    await steamAuthManager.logout()
    await friendsService.refresh()
  })

  ipcMain.handle(IPC.epicGetAccount, async () => {
    return epicAuthManager.restoreSession()
  })

  ipcMain.handle(IPC.epicLoginStart, async () => {
    const sendStatus = (status: EpicLoginStatus): void => {
      mainWindow.webContents.send(IPC.epicLoginStatus, status)
    }
    try {
      await epicAuthManager.startLogin(sendStatus, mainWindow)
      void friendsService.refresh()
    } catch (err) {
      sendStatus({
        state: 'error',
        message: err instanceof Error ? err.message : t('epicLoginFailed')
      })
    }
  })

  ipcMain.handle(IPC.epicLoginCancel, () => {
    epicAuthManager.cancelLogin()
  })

  ipcMain.handle(IPC.epicLogout, async () => {
    await epicAuthManager.logout()
    await friendsService.refresh()
  })

  ipcMain.handle(IPC.friendsGet, () => friendsService.getSnapshot())
  ipcMain.handle(IPC.friendsRefresh, () => friendsService.refresh())
  ipcMain.handle(IPC.friendsConnect, (_e, provider: unknown) => {
    if (provider !== 'discord') throw new Error('Unsupported friends provider connection')
    return friendsService.connectProvider(provider)
  })
  ipcMain.handle(IPC.friendsDisconnect, (_e, provider: unknown) => {
    if (provider !== 'discord') throw new Error('Unsupported friends provider disconnection')
    return friendsService.disconnectProvider(provider)
  })
  ipcMain.handle(IPC.friendsOpenProvider, (_e, provider: unknown) => {
    if (!FRIENDS_PROVIDERS.includes(provider as FriendsProvider)) {
      throw new Error('Invalid friends provider')
    }
    return friendsService.openProvider(provider as FriendsProvider)
  })
  ipcMain.handle(IPC.discordChatInbox, () => friendsService.getDiscordChatInbox())
  ipcMain.handle(IPC.discordChatHistory, (_e, userId: unknown, limit: unknown) =>
    friendsService.getDiscordChatHistory(userId, limit)
  )
  ipcMain.handle(IPC.discordChatSend, (_e, userId: unknown, content: unknown) =>
    friendsService.sendDiscordChatMessage(userId, content)
  )
  ipcMain.handle(IPC.discordChatSetVisible, (_e, showing: unknown) =>
    friendsService.setDiscordChatVisible(showing)
  )
  ipcMain.handle(IPC.discordServersList, () => friendsService.getDiscordServers())
  ipcMain.handle(IPC.discordServerOpen, (_e, serverId: unknown) =>
    friendsService.openDiscordServer(serverId)
  )

  ipcMain.handle(IPC.libraryGet, () => {
    const account = steamAuthManager.getAccount()
    libraryService.hydrateFromDisk(account?.steamId)
    return libraryService.getSnapshot()
  })

  ipcMain.handle(IPC.libraryStatsGet, () => libraryService.getStats())

  ipcMain.handle(IPC.libraryStartupRefresh, () => libraryService.refreshStartup())

  ipcMain.handle(IPC.libraryRefresh, async () => {
    return libraryService.refresh()
  })

  ipcMain.handle(IPC.playstationGetAccount, () => playStationAuthManager.restoreSession())

  ipcMain.handle(IPC.playstationLoginStart, async () => {
    const sendStatus = (status: PlayStationLoginStatus): void => {
      mainWindow.webContents.send(IPC.playstationLoginStatus, status)
      if (status.state === 'success') void libraryService.refresh()
    }
    await playStationAuthManager.startLogin(sendStatus, mainWindow)
  })

  ipcMain.handle(IPC.playstationLoginCancel, () => playStationAuthManager.cancelLogin())

  ipcMain.handle(IPC.playstationLogout, async () => {
    await playStationAuthManager.logout()
    void libraryService.refresh()
  })

  ipcMain.handle(IPC.playstationRemotePlayGet, () => playStationRemotePlayService.refresh())
  ipcMain.handle(IPC.playstationRemotePlayRefresh, () =>
    playStationRemotePlayService.refresh(true)
  )

  ipcMain.handle(IPC.libraryGameExclude, (_e, gameIdValue: unknown) => {
    guestModeService.assertActionAllowed('hide')
    return libraryService.setGameExcluded(
      validatedShortString(gameIdValue, 'library game ID'),
      true
    )
  })

  ipcMain.handle(IPC.libraryGameRestore, (_e, gameIdValue: unknown) => {
    guestModeService.assertActionAllowed('hide')
    return libraryService.setGameExcluded(
      validatedShortString(gameIdValue, 'library game ID'),
      false
    )
  })

  ipcMain.handle(IPC.libraryGameMetadataUpdate, (_e, value: unknown) => {
    guestModeService.assertActionAllowed('edit-metadata')
    return libraryService.updateGameMetadata(validateGameMetadataUpdate(value))
  })

  ipcMain.handle(IPC.libraryGameMetadataSync, (_e, gameIdValue: unknown) =>
    libraryService.syncGameMetadata(
      validatedShortString(gameIdValue, 'metadata sync game ID')
    )
  )

  ipcMain.handle(IPC.libraryGameMetadataMediaSearch, async (
    _e,
    gameIdValue: unknown,
    kindValue: unknown,
    queryValue: unknown
  ) => {
    const gameId = validatedShortString(gameIdValue, 'metadata media search game ID')
    if (!libraryService.getGame(gameId)) throw new Error('Game is not available')
    if (!isGameMediaLinkKind(kindValue)) throw new Error('Invalid metadata media kind')
    const query = normalizeMediaSearchQuery(queryValue)
    if (!query) throw new Error('Invalid metadata media search query')
    try {
      const { searchYouTubeMedia } = await import('./titleMusic/gameTitleMusicService')
      return await searchYouTubeMedia(query, settingsStore.get('language'))
    } catch {
      return { state: 'unavailable', query, options: [] }
    }
  })

  ipcMain.handle(IPC.libraryGameMetadataMediaPaste, (_e, kindValue: unknown) => {
    if (!isGameMediaLinkKind(kindValue)) throw new Error('Invalid metadata media kind')
    return normalizePastedMediaLink(clipboard.readText(), kindValue)
  })

  ipcMain.handle(IPC.libraryGameMetadataStoreSearch, (
    _e,
    gameIdValue: unknown,
    queryValue: unknown
  ) => {
    const gameId = validatedShortString(gameIdValue, 'metadata store search game ID')
    if (!libraryService.getGame(gameId)) throw new Error('Game is not available')
    const query = normalizeMetadataSearchQuery(queryValue)
    if (!query) throw new Error('Invalid metadata store search query')
    return searchSteamStoreMetadata(query)
  })

  ipcMain.handle(IPC.libraryGameMetadataStoreLookup, (
    _e,
    gameIdValue: unknown,
    appIdValue: unknown
  ) => {
    const gameId = validatedShortString(gameIdValue, 'metadata store lookup game ID')
    if (!libraryService.getGame(gameId)) throw new Error('Game is not available')
    if (!isSteamAppId(appIdValue)) throw new Error('Invalid Steam app ID')
    return lookupSteamStoreMetadata(appIdValue)
  })

  ipcMain.handle(IPC.xboxGetConnection, () => xboxAuthManager.restoreSession())

  ipcMain.handle(IPC.xboxLoginStart, async () => {
    const sendStatus = (status: XboxLoginStatus): void => {
      mainWindow.webContents.send(IPC.xboxLoginStatus, status)
      if (status.state === 'success') {
        void libraryService.refresh()
        void friendsService.refresh()
      }
    }
    try {
      await xboxAuthManager.startLogin(sendStatus, mainWindow)
    } catch (error) {
      sendStatus({
        state: 'error',
        message: error instanceof Error ? error.message : 'Xbox sign-in failed'
      })
    }
  })

  ipcMain.handle(IPC.xboxLoginCancel, () => xboxAuthManager.cancelLogin())

  ipcMain.handle(IPC.xboxLogout, async () => {
    await xboxAuthManager.logout()
    clearXboxAchievementCaches()
    achievementService.clearProvider('xbox')
    void libraryService.refresh()
    void friendsService.refresh()
  })

  ipcMain.handle(IPC.customGameBeginImport, (_e, source: unknown) => {
    guestModeService.assertActionAllowed('add-custom-game')
    if (!CUSTOM_GAME_IMPORT_SOURCES.includes(source as CustomGameImportSource)) {
      throw new Error('Invalid custom game import source')
    }
    return libraryService.beginCustomGameImport(mainWindow, source as CustomGameImportSource)
  })

  ipcMain.handle(IPC.customGameSelectArtwork, (_e, draftId: unknown) =>
    libraryService.selectCustomGameArtwork(
      mainWindow,
      validatedShortString(draftId, 'custom game draft', 80)
    )
  )

  ipcMain.handle(IPC.customGameSelectSave, (_e, draftId: unknown, source: unknown) => {
    if (!CUSTOM_GAME_SAVE_SOURCES.includes(source as CustomGameSaveSource)) {
      throw new Error('Invalid custom game save source')
    }
    return libraryService.selectCustomGameSave(
      mainWindow,
      validatedShortString(draftId, 'custom game draft', 80),
      source as CustomGameSaveSource
    )
  })

  ipcMain.handle(IPC.customGameClearSave, (_e, draftId: unknown) =>
    libraryService.clearCustomGameSave(validatedShortString(draftId, 'custom game draft', 80))
  )

  ipcMain.handle(IPC.customGameCommit, (_e, input: unknown) => {
    guestModeService.assertActionAllowed('add-custom-game')
    return libraryService.commitCustomGame(validateCustomGameCommit(input))
  })

  ipcMain.handle(IPC.customGameSetLaunchArguments, (_e, value: unknown) => {
    guestModeService.assertActionAllowed('edit-metadata')
    const input = validateCustomGameLaunchArguments(value)
    return libraryService.updateCustomGameLaunchArguments(
      input.gameId,
      parseCustomLaunchArguments(input.launchArguments)
    )
  })

  ipcMain.handle(IPC.customGameCancel, (_e, draftId: unknown) => {
    libraryService.cancelCustomGameImport(validatedShortString(draftId, 'custom game draft', 80))
  })

  ipcMain.handle(IPC.customGameRemove, async (_e, gameIdValue: unknown) => {
    guestModeService.assertActionAllowed('uninstall')
    const gameId = validatedShortString(gameIdValue, 'custom game ID')
    const snapshot = await libraryService.removeCustomGame(gameId)
    for (const orientation of ['vertical', 'horizontal'] as const) {
      mainWindow.webContents.send(IPC.imageUpdated, {
        gameId,
        orientation,
        image: null
      } satisfies ImageUpdate)
    }
    return snapshot
  })

  ipcMain.handle(IPC.customGameBackup, (_e, gameId: unknown) =>
    libraryService.backupCustomGame(validatedShortString(gameId, 'custom game ID'))
  )

  ipcMain.handle(IPC.customGameOpenBackups, (_e, gameId: unknown) => {
    guestModeService.assertActionAllowed('open-backups')
    return libraryService.openCustomGameBackups(validatedShortString(gameId, 'custom game ID'))
  })

  ipcMain.handle(IPC.customGameListBackups, (_e, gameId: unknown) =>
    libraryService.listCustomGameBackups(validatedShortString(gameId, 'custom game ID'))
  )

  ipcMain.handle(IPC.customGameRestoreBackup, (_e, gameId: unknown, backupId: unknown) => {
    guestModeService.assertActionAllowed('restore-backup')
    const gameIdValue = validatedShortString(gameId, 'custom game ID')
    const backupIdValue = validatedShortString(backupId, 'backup ID', 256)
    if (backupIdValue.includes('..') || backupIdValue.includes('/') || backupIdValue.includes('\\')) {
      throw new Error('Invalid backup ID')
    }
    return libraryService.restoreCustomGameBackup(
      gameIdValue,
      backupIdValue,
      () => gameSessionManager.getStatus()
    )
  })

  ipcMain.handle(IPC.settingsSaveBackupDirectoryGet, () => readSaveBackupDirectoryStatus())
  ipcMain.handle(IPC.settingsSaveBackupDirectoryChoose, () => {
    guestModeService.assertActionAllowed('change-settings')
    return chooseSaveBackupDirectory(mainWindow)
  })
  ipcMain.handle(IPC.settingsSaveBackupDirectoryUseDefault, () => {
    guestModeService.assertActionAllowed('change-settings')
    return clearSaveBackupDirectory()
  })

  ipcMain.handle(IPC.retroLibraryStatusGet, () => libraryService.getRetroLibraryStatus())
  ipcMain.handle(IPC.retroLibraryRefresh, () => libraryService.refreshRetroLibrary())
  ipcMain.handle(IPC.retroLibraryDirectoryAdd, () => {
    guestModeService.assertActionAllowed('manage-retro')
    return libraryService.addRetroLibraryDirectory(mainWindow)
  })
  ipcMain.handle(IPC.retroLibraryDirectoryRemove, (_e, directory: unknown) => {
    guestModeService.assertActionAllowed('manage-retro')
    return libraryService.removeRetroLibraryDirectory(
      validatedShortString(directory, 'ROM directory', 32_768)
    )
  })
  ipcMain.handle(IPC.retroSystemDirectoryEnsure, (_e, systemId: unknown) => {
    guestModeService.assertActionAllowed('manage-retro')
    return libraryService.ensureRetroSystemDirectory(validateRetroSystemId(systemId))
  })
  ipcMain.handle(IPC.retroSystemDirectoryOpen, (_e, systemId: unknown) => {
    guestModeService.assertActionAllowed('manage-retro')
    return libraryService.openRetroSystemDirectory(mainWindow, validateRetroSystemId(systemId))
  })
  ipcMain.handle(IPC.retroEmulatorDownloadOpen, (_e, value: unknown) => {
    guestModeService.assertActionAllowed('manage-retro')
    return libraryService.openRetroEmulatorDownload(validateRetroEmulatorDownload(value))
  })
  ipcMain.handle(IPC.retroEmulatorInstall, (_e, value: unknown) => {
    guestModeService.assertActionAllowed('manage-retro')
    return libraryService.installRetroEmulator(mainWindow, validateRetroEmulatorInstall(value))
  })
  ipcMain.handle(IPC.retroEmulatorInstallCancel, () => {
    guestModeService.assertActionAllowed('manage-retro')
    return libraryService.cancelRetroEmulatorInstall()
  })
  ipcMain.handle(IPC.retroGameSetLaunchArguments, (_e, value: unknown) => {
    guestModeService.assertActionAllowed('manage-retro')
    const input = validateRetroGameLaunchArguments(value)
    return libraryService.updateRetroGameLaunchArguments(
      input.gameId,
      parseCustomLaunchArguments(input.launchArguments)
    )
  })

  ipcMain.handle(IPC.gameInstall, async (_event, gameIdValue: unknown) => {
    const gameId = validatedShortString(gameIdValue, 'game install ID')
    const game = libraryService.getGame(gameId)
    if (!game) throw new Error('Game is not available')
    const state = await requestGameInstall(game)
    if (state === 'provider-opened') {
      libraryRefreshScheduler.expectLauncherReturn(`launcher:${game.provider}`)
    }
  })

  ipcMain.handle(IPC.gameUninstall, async (_event, gameIdValue: unknown) => {
    guestModeService.assertActionAllowed('uninstall')
    const gameId = validatedShortString(gameIdValue, 'game uninstall ID')
    const game = libraryService.getGame(gameId)
    if (!game) throw new Error('Game is not available')
    const launchStatus = gameSessionManager.getStatus()
    if (launchStatus.gameId === gameId && launchStatus.phase !== 'idle') {
      throw new Error('A running game cannot be uninstalled')
    }
    const state = await requestGameUninstall(game)
    if (state === 'provider-opened') {
      libraryRefreshScheduler.expectLauncherReturn(`launcher:${game.provider}`)
      return libraryService.getSnapshot()
    }
    if (game.provider !== 'xbox') throw new Error('Invalid completed uninstall provider')
    return libraryService.refreshInstalledProviders([
      { provider: game.provider, providerGameId: game.providerGameId }
    ])
  })

  ipcMain.handle(IPC.gameLaunch, async (_e, gameIdValue: unknown) => {
    const gameId = validatedShortString(gameIdValue, 'game launch ID')
    guestModeService.assertLaunchAllowed(gameId)
    const game = libraryService.getGame(gameId)
    if (!game) throw new Error('Game is not available')
    if (!game.installed) {
      if (canRequestGameInstall(game)) {
        throw new Error('Game installation requires confirmation')
      }
      await launchGame(game)
      return
    }
    await gameSessionManager.start(game)
  })

  ipcMain.handle(IPC.gameLaunchCancel, () => gameSessionManager.cancelPendingLaunch())
  ipcMain.handle(IPC.gameTrackingStop, () => gameSessionManager.stopTracking())
  ipcMain.handle(IPC.gameLaunchGet, () => gameSessionManager.getStatus())
  ipcMain.handle(IPC.gameLaunchRevealLauncher, () => gameSessionManager.revealLauncher())

  // Con el toggle apagado no se abre el socket. El renderer traduce `error`.
  const retroArchUnavailable = (): RetroArchStatusSnapshot => {
    if (settingsStore.store.retroPauseMenuEnabled !== true) {
      return {
        enabled: false,
        retroArchSession: false,
        playback: 'UNKNOWN',
        reply: null,
        error: 'disabled'
      }
    }
    if (!gameSessionManager.isRetroArchSession()) {
      return {
        enabled: true,
        retroArchSession: false,
        playback: 'UNKNOWN',
        reply: null,
        error: 'not-retroarch'
      }
    }
    return {
      enabled: true,
      retroArchSession: true,
      playback: 'UNKNOWN',
      reply: null
    }
  }

  ipcMain.handle(IPC.retroArchStatus, async (): Promise<RetroArchStatusSnapshot> => {
    const gate = retroArchUnavailable()
    if (gate.error) return gate
    const result = await sendRetroArchUdp('GET_STATUS')
    if (!result.ok || !result.reply) {
      console.warn('[retro-pause-menu] RetroArch no contestó el estado')
      return { ...gate, error: result.error ?? 'unreachable' }
    }
    const parsed = parseStatus(result.reply)
    return {
      ...gate,
      playback: parsed.playback,
      reply: result.reply,
      error: parsed.playback === 'UNKNOWN' ? 'unrecognized' : undefined
    }
  })

  ipcMain.handle(IPC.retroArchCommand, async (_event, name: unknown): Promise<RetroArchCommandResult> => {
    const gate = retroArchUnavailable()
    if (gate.error) return { ok: false, reply: null, error: gate.error }
    if (!isRetroArchCommand(name) || name === 'GET_STATUS') {
      console.warn('[retro-pause-menu] comando rechazado desde el renderer')
      return { ok: false, reply: null, error: 'rejected' }
    }
    const result = await sendRetroArchUdp(name)
    if (!result.ok) {
      console.warn(`[retro-pause-menu] el comando ${name} no llegó a RetroArch`)
    }
    return result
  })

  ipcMain.handle(IPC.retroArchReturn, async (): Promise<boolean> => {
    if (settingsStore.store.retroPauseMenuEnabled !== true) return false
    if (!gameSessionManager.isRetroArchSession()) return false
    return gameSessionManager.returnToRunningGame()
  })
  ipcMain.handle(IPC.gameTrailerResolve, async (_e, value: unknown) => {
    const gameId = validatedShortString(value, 'trailer game ID')
    const game = libraryService.getGame(gameId)
    if (!game) return null
    const { resolveGameTrailer } = await import('./trailers/gameTrailerService')
    return resolveGameTrailer(game, settingsStore.get('language'))
  })
  ipcMain.handle(IPC.gameTitleMusicResolve, async (_e, value: unknown) => {
    const gameId = validatedShortString(value, 'title music game ID')
    if (settingsStore.get('gameTitleMusic') === false) return null
    const game = libraryService.getGame(gameId)
    if (!game) return null
    const { resolveGameTitleMusic } = await import('./titleMusic/gameTitleMusicService')
    return resolveGameTitleMusic(game, settingsStore.get('language'))
  })
  ipcMain.handle(IPC.gameCompletionTimesResolve, async (_e, gameId: string) => {
    return libraryService.resolveCompletionTimes(gameId)
  })

  ipcMain.handle(IPC.gameAchievementsResolve, async (_e, gameId: string, force?: unknown) => {
    return libraryService.resolveAchievements(gameId, force === true)
  })
  ipcMain.handle(
    IPC.gameAchievementGuideResolve,
    async (_e, gameIdValue: unknown, achievementIdValue: unknown): Promise<AchievementGuideResult> => {
      const gameId = validatedShortString(gameIdValue, 'achievement guide game ID')
      const achievementId = validatedShortString(
        achievementIdValue,
        'achievement guide achievement ID'
      )
      if (!orbitPlusService.hasFeature('achievement-guides')) {
        return { state: 'locked', achievementId }
      }

      const game = libraryService.getGame(gameId)
      if (!game) throw new Error('Game is not available')
      const snapshot = achievementService.get(gameId)
      const achievement = snapshot?.state === 'available'
        ? snapshot.achievements.find((candidate) => candidate.id === achievementId)
        : undefined
      if (!achievement) throw new Error('Achievement is not available')

      const query = achievementGuideSearchQuery(game.name, achievement.name)
      if (!query) return { state: 'unavailable', achievementId }
      try {
        const { searchYouTubeMedia } = await import('./titleMusic/gameTitleMusicService')
        const result = await searchYouTubeMedia(query, settingsStore.get('language'))
        if (!orbitPlusService.hasFeature('achievement-guides')) {
          return { state: 'locked', achievementId }
        }
        const trailer = result.options[0] ? achievementGuideTrailer(result.options[0]) : undefined
        return trailer
          ? { state: 'ready', achievementId, trailer }
          : { state: 'missing', achievementId }
      } catch {
        return { state: 'unavailable', achievementId }
      }
    }
  )
  ipcMain.handle(IPC.gameAchievementsSync, () => libraryService.syncAchievements(true))

  ipcMain.handle(
    IPC.imageResolve,
    (_e, gameIdValue: unknown, orientationValue: unknown): ResolvedImage | null => {
      const gameId = validatedShortString(gameIdValue, 'image game ID')
      const orientation = validatedImageOrientation(orientationValue)
      const game = findArtworkGame(gameId)
      return game ? resolveImage(game, orientation) : null
    }
  )

  ipcMain.handle(IPC.imageTokenStatusGet, () =>
    getSteamGridDbTokenStatus(steamGridDbCredentials.getToken() ?? '')
  )

  ipcMain.handle(IPC.imageTokenSet, async (_event, token: unknown) => {
    steamGridDbCredentials.setToken(token)
    artworkPickerService.clearCache()
    clearSteamGridDbCache()
    return getSteamGridDbTokenStatus(steamGridDbCredentials.getToken() ?? '')
  })

  ipcMain.handle(IPC.imageTokenClear, () => {
    steamGridDbCredentials.clear()
    artworkPickerService.clearCache()
    clearSteamGridDbCache()
    return { state: 'not-configured' } satisfies SteamGridDbTokenStatus
  })

  ipcMain.handle(IPC.imageCacheClear, async () => {
    artworkPickerService.clearCache()
    return artworkService.clearAutomaticCache()
  })

  ipcMain.handle(IPC.imageArtworkReload, async () => {
    artworkPickerService.clearCache()
    return artworkService.reloadAll(libraryService.getSnapshot().games)
  })

  ipcMain.handle(IPC.imageArtworkSearchList, (
    _e,
    gameIdValue: unknown,
    orientationValue: unknown,
    queryValue: unknown
  ) => {
    const gameId = validatedShortString(gameIdValue, 'artwork search game ID')
    const orientation = validatedArtworkSearchOrientation(orientationValue)
    const query = validatedArtworkQuery(queryValue)
    const game = libraryService.getGame(gameId)
    if (!game) throw new Error('Game is not available')
    return artworkPickerService.list(game, orientation, query)
  })

  ipcMain.handle(
    IPC.imageArtworkSearchApply,
    async (
      _e,
      gameIdValue: unknown,
      artworkIdValue: unknown,
      orientationValue: unknown,
      queryValue: unknown
    ): Promise<boolean> => {
      const gameId = validatedShortString(gameIdValue, 'artwork search game ID')
      const artworkId = validatedShortString(artworkIdValue, 'artwork search candidate ID', 160)
      const orientation = validatedArtworkSearchOrientation(orientationValue)
      const query = validatedArtworkQuery(queryValue)
      const game = libraryService.getGame(gameId)
      if (!game) throw new Error('Game is not available')
      const image = await artworkPickerService.apply(game, artworkId, orientation, query)
      mainWindow.webContents.send(IPC.imageUpdated, {
        gameId,
        orientation,
        image
      } satisfies ImageUpdate)
      return true
    }
  )

  ipcMain.handle(IPC.imageSelectCustom, async (
    _e,
    gameIdValue: unknown,
    orientationValue: unknown
  ): Promise<boolean> => {
    const gameId = validatedShortString(gameIdValue, 'custom artwork game ID')
    const orientation = validatedImageOrientation(orientationValue)
    const game = libraryService.getGame(gameId)
    if (!game) throw new Error('Game is not available')
    const image = await customArtworkService.select(mainWindow, gameId, orientation)
    if (!image) return false
    mainWindow.webContents.send(IPC.imageUpdated, {
      gameId,
      orientation,
      image
    } satisfies ImageUpdate)
    return true
  })

  ipcMain.handle(IPC.imagePasteCustom, async (
    _e,
    gameIdValue: unknown,
    orientationValue: unknown
  ): Promise<boolean> => {
    const gameId = validatedShortString(gameIdValue, 'clipboard artwork game ID')
    const orientation = validatedImageOrientation(orientationValue)
    const game = libraryService.getGame(gameId)
    if (!game) throw new Error('Game is not available')
    const image = await customArtworkService.paste(gameId, orientation)
    if (!image) return false
    mainWindow.webContents.send(IPC.imageUpdated, {
      gameId,
      orientation,
      image
    } satisfies ImageUpdate)
    return true
  })

  ipcMain.handle(IPC.imageResetCustom, async (
    _e,
    gameIdValue: unknown,
    orientationValue: unknown
  ): Promise<boolean> => {
    const gameId = validatedShortString(gameIdValue, 'custom artwork game ID')
    const orientation = validatedImageOrientation(orientationValue)
    const game = libraryService.getGame(gameId)
    if (!game) throw new Error('Game is not available')
    const removed = await customArtworkService.reset(gameId, orientation)
    if (!removed) return false
    mainWindow.webContents.send(IPC.imageUpdated, {
      gameId,
      orientation,
      image: artworkService.resolve(game, orientation)
    } satisfies ImageUpdate)
    return true
  })

  ipcMain.handle(IPC.imageHasCustom, (
    _e,
    gameIdValue: unknown,
    orientationValue: unknown
  ): boolean => {
    const gameId = validatedShortString(gameIdValue, 'custom artwork game ID')
    const orientation = validatedImageOrientation(orientationValue)
    return Boolean(libraryService.getGame(gameId) && customArtworkService.has(gameId, orientation))
  })

  ipcMain.handle(
    IPC.imageReportFailure,
    async (_e, gameIdValue: unknown, orientationValue: unknown, revisionValue: unknown): Promise<void> => {
      const gameId = validatedShortString(gameIdValue, 'image game ID')
      const orientation = validatedImageOrientation(orientationValue)
      if (
        typeof revisionValue !== 'number' ||
        !Number.isSafeInteger(revisionValue) ||
        revisionValue <= 0
      ) {
        throw new Error('Invalid image revision')
      }
      const game = findArtworkGame(gameId)
      if (!game) return
      if (await customArtworkService.reset(gameId, orientation, revisionValue)) {
        mainWindow.webContents.send(IPC.imageUpdated, {
          gameId,
          orientation,
          image: artworkService.resolve(game, orientation)
        } satisfies ImageUpdate)
        return
      }
      artworkService.reportFailure(game, orientation, revisionValue)
    }
  )

  ipcMain.handle(IPC.openExternal, async (_e, value: unknown) => {
    const url = safeExternalHttpsUrl(value)
    if (!url) throw new Error('Invalid external URL')
    await shell.openExternal(url)
  })
}
