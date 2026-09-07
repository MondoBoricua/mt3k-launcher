import { DEFAULT_LANGUAGE, normalizeLanguage } from '@shared/language'
import Store from 'electron-store'
import { normalizeTextScale, TEXT_SCALE_DEFAULT } from '@shared/textScale'
import {
  DEFAULT_AUDIO_CUE_PRESETS,
  isCornerStyleId,
  isThemeId,
  type OrbitSettings
} from '@shared/ipc'
import {
  GAME_TITLE_MUSIC_ENABLED_DEFAULT,
  GAME_TITLE_MUSIC_DELAY_DEFAULT,
  GAME_TITLE_MUSIC_FADE_DEFAULT,
  GAME_TITLE_MUSIC_VOLUME_DEFAULT,
  normalizeGameTitleMusicDelay,
  normalizeGameTitleMusicFade,
  normalizeGameTitleMusicVolume
} from '@shared/gameTitleMusic'
import {
  LAUNCHER_MUSIC_ENABLED_DEFAULT,
  LAUNCHER_MUSIC_SOURCE_DEFAULT,
  LAUNCHER_MUSIC_VOLUME_DEFAULT,
  isLauncherMusicSource,
  normalizeLauncherMusicVolume
} from '@shared/launcherMusic'

const defaults: OrbitSettings = {
  backgroundModeEnabled: true,
  startWithWindows: false,
  theme: 'midnight',
  cornerStyle: 'theme',
  profileAvatar: 'orbit',
  homeLayout: 'orbit',
  gameCardSize: 'standard',
  libraryGridColumns: 6,
  uninstalledGameColor: 'gray',
  showSteamSharedGames: true,
  favoriteGameIds: [],
  customLibraries: [],
  excludedGameIds: [],
  backdropIntensity: 'balanced',
  homeBackdropMode: 'focus',
  homeBackdropMotion: 'drift',
  homeCardBubbleEffect: true,
  startupAnimationMode: 'orbit',
  dockTheme: 'standard',
  dockSize: 'standard',
  dockMotion: 'standard',
  uiDensity: 'standard',
  textScale: TEXT_SCALE_DEFAULT,
  language: DEFAULT_LANGUAGE,
  audioPreset: 'orbit',
  audioCuePresets: { ...DEFAULT_AUDIO_CUE_PRESETS },
  hasCompletedOnboarding: false,
  storeRegion: 'eu',
  showStoreTab: true,
  showFriendsHub: true,
  showHomeBanners: true,
  showAchievements: true,
  backgroundTrailers: true,
  launcherMusic: LAUNCHER_MUSIC_ENABLED_DEFAULT,
  launcherMusicVolume: LAUNCHER_MUSIC_VOLUME_DEFAULT,
  launcherMusicSource: LAUNCHER_MUSIC_SOURCE_DEFAULT,
  gameTitleMusic: GAME_TITLE_MUSIC_ENABLED_DEFAULT,
  gameTitleMusicVolume: GAME_TITLE_MUSIC_VOLUME_DEFAULT,
  gameTitleMusicDelaySeconds: GAME_TITLE_MUSIC_DELAY_DEFAULT,
  gameTitleMusicFadeSeconds: GAME_TITLE_MUSIC_FADE_DEFAULT,
  gameCardPrimaryAction: 'launch',
  closeLaunchersAfterGame: false,
  notificationsEnabled: true,
  notificationPosition: 'top-right',
  notificationMotion: 'slide',
  appUpdateAutoDownload: true,
  retroRomDirectories: [],
  retroSystemEmulators: {},
  playstationRemotePlayPreference: 'auto',
  hardwareControlEnabled: false,
  hardwareControlButton: 'menu',
  hardwareControlHoldSeconds: 2
}

export const settingsStore = new Store<OrbitSettings>({
  name: 'orbit-settings',
  defaults,
  watch: true
})

const LEGACY_RETRO_ACHIEVEMENTS_API_KEY = 'retroAchievementsWebApiKey'
const LEGACY_STEAM_GRID_DB_TOKEN = 'steamGridDbApiKey'
const LEGACY_STEAM_WEB_API_KEY = 'steamWebApiKey'
const legacySettingsStore = settingsStore as unknown as Store<Record<string, unknown>>

/**
 * Renderer-facing settings must never inherit credentials left by an older
 * ORBIT build. The vault migrates this legacy value once OS encryption is
 * available; until then it remains main-process-only.
 */
export function publicSettingsSnapshot(): OrbitSettings {
  const snapshot = { ...legacySettingsStore.store }
  snapshot.theme = isThemeId(snapshot.theme) ? snapshot.theme : 'midnight'
  snapshot.cornerStyle = isCornerStyleId(snapshot.cornerStyle) ? snapshot.cornerStyle : 'theme'
  snapshot.language = normalizeLanguage(snapshot.language)
  snapshot.textScale = normalizeTextScale(snapshot.textScale)
  snapshot.launcherMusic = snapshot.launcherMusic ?? LAUNCHER_MUSIC_ENABLED_DEFAULT
  snapshot.launcherMusicVolume = normalizeLauncherMusicVolume(snapshot.launcherMusicVolume)
  snapshot.launcherMusicSource = isLauncherMusicSource(snapshot.launcherMusicSource)
    ? snapshot.launcherMusicSource
    : LAUNCHER_MUSIC_SOURCE_DEFAULT
  snapshot.gameTitleMusicVolume = normalizeGameTitleMusicVolume(
    snapshot.gameTitleMusicVolume
  )
  snapshot.gameTitleMusicDelaySeconds = normalizeGameTitleMusicDelay(
    snapshot.gameTitleMusicDelaySeconds
  )
  snapshot.gameTitleMusicFadeSeconds = normalizeGameTitleMusicFade(
    snapshot.gameTitleMusicFadeSeconds
  )
  delete snapshot[LEGACY_RETRO_ACHIEVEMENTS_API_KEY]
  delete snapshot[LEGACY_STEAM_GRID_DB_TOKEN]
  delete snapshot[LEGACY_STEAM_WEB_API_KEY]
  return snapshot as unknown as OrbitSettings
}

export function readLegacyRetroAchievementsApiKey(): unknown {
  return legacySettingsStore.get(LEGACY_RETRO_ACHIEVEMENTS_API_KEY)
}

export function clearLegacyRetroAchievementsApiKey(): void {
  legacySettingsStore.delete(LEGACY_RETRO_ACHIEVEMENTS_API_KEY)
}

export function readLegacySteamGridDbToken(): unknown {
  return legacySettingsStore.get(LEGACY_STEAM_GRID_DB_TOKEN)
}

export function clearLegacySteamGridDbToken(): void {
  legacySettingsStore.delete(LEGACY_STEAM_GRID_DB_TOKEN)
}

export function readLegacySteamWebApiKey(): unknown {
  return legacySettingsStore.get(LEGACY_STEAM_WEB_API_KEY)
}

export function clearLegacySteamWebApiKey(): void {
  legacySettingsStore.delete(LEGACY_STEAM_WEB_API_KEY)
}
