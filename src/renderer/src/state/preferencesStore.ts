import { useNotificationStore } from './notificationStore'
import { DEFAULT_LANGUAGE, normalizeLanguage, isLanguage } from '@shared/language'
export { LANGUAGE_OPTIONS } from '@shared/language'
import { create } from 'zustand'
import { normalizeTextScale } from '@shared/textScale'
import { applyTextScale, readCachedTextScale, scheduleTextScaleSave } from '@renderer/lib/textScalePreference'
import {
  AUDIO_CUE_IDS,
  AUDIO_CUE_PRESETS,
  AUDIO_PRESETS,
  DEFAULT_AUDIO_CUE_PRESETS,
  GAME_CARD_PRIMARY_ACTIONS,
  HOME_BACKDROP_MODES,
  HOME_BACKDROP_MOTIONS,
  LIBRARY_GRID_COLUMN_OPTIONS,
  UNINSTALLED_GAME_COLORS,
  type AudioCueId,
  type AudioCuePreset,
  type AudioCuePresets,
  type AudioPreset,
  type BackdropIntensity,
  type CornerStyleId,
  type DockMotion,
  type DockSize,
  type DockThemeId,
  type GameCardSize,
  type GameCardPrimaryAction,
  type HomeLayoutId,
  type HardwareControlButton,
  type HardwareControlHoldSeconds,
  type HomeBackdropMode,
  type HomeBackdropMotion,
  type HomeWallpaperAsset,
  type CustomLauncherMusic,
  type CustomUiAudioCues,
  type LauncherMusicSource,
  type LibraryGridColumns,
  type NotificationMotion,
  type NotificationPosition,
  type OrbitSettings,
  type ProfileAvatarId,
  type StartupAnimationMode,
  type ThemeId,
  type UiDensity,
  type UninstalledGameColor,
  type Language,
  isOrbitPlusThemeId
} from '@shared/ipc'
import { setUiAudioCustomCues, setUiAudioPreset } from '@renderer/lib/uiAudio'
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
  LAUNCHER_MUSIC_SOURCES,
  LAUNCHER_MUSIC_VOLUME_DEFAULT,
  normalizeLauncherMusicVolume
} from '@shared/launcherMusic'
import {
  cacheStartupAnimationMode,
  cacheStartupVideoUrl,
  hasCustomStartupVideoFailed,
  readCachedStartupAnimationMode
} from '@renderer/lib/startupAnimationPreference'
import { useOrbitPlusStore } from '@renderer/state/orbitPlusStore'

interface PreferencesState {
  theme: ThemeId
  cornerStyle: CornerStyleId
  profileAvatar: ProfileAvatarId
  customAvatarUrl?: string
  homeLayout: HomeLayoutId
  gameCardSize: GameCardSize
  libraryGridColumns: LibraryGridColumns
  uninstalledGameColor: UninstalledGameColor
  showSteamSharedGames: boolean
  backdropIntensity: BackdropIntensity
  homeBackdropMode: HomeBackdropMode
  homeBackdropMotion: HomeBackdropMotion
  pinnedBackdropGameId?: string
  customHomeWallpaper?: HomeWallpaperAsset
  homeCardBubbleEffect: boolean
  startupAnimationMode: StartupAnimationMode
  customStartupVideoUrl?: string
  dockTheme: DockThemeId
  dockSize: DockSize
  dockMotion: DockMotion
  uiDensity: UiDensity
  textScale: number
  textScaleSaveState: 'idle' | 'saving' | 'error'
  language: Language
  audioPreset: AudioPreset
  audioCuePresets: AudioCuePresets
  customUiAudioCues: CustomUiAudioCues
  showStoreTab: boolean
  showFriendsHub: boolean
  showHomeBanners: boolean
  showAchievements: boolean
  backgroundTrailers: boolean
  launcherMusic: boolean
  launcherMusicVolume: number
  launcherMusicSource: LauncherMusicSource
  customLauncherMusic?: CustomLauncherMusic
  gameTitleMusic: boolean
  gameTitleMusicVolume: number
  gameTitleMusicDelaySeconds: number
  gameTitleMusicFadeSeconds: number
  gameCardPrimaryAction: GameCardPrimaryAction
  closeLaunchersAfterGame: boolean
  notificationsEnabled: boolean
  notificationPosition: NotificationPosition
  notificationMotion: NotificationMotion
  hardwareControlEnabled: boolean
  hardwareControlButton: HardwareControlButton
  hardwareControlHoldSeconds: HardwareControlHoldSeconds
  hydrated: boolean
  hydrate: () => Promise<OrbitSettings>
  setTheme: (theme: ThemeId) => Promise<void>
  setCornerStyle: (cornerStyle: CornerStyleId) => Promise<void>
  syncOrbitPlusAppearance: () => void
  setProfileAvatar: (profileAvatar: ProfileAvatarId) => Promise<void>
  selectCustomAvatar: () => Promise<boolean>
  setHomeLayout: (homeLayout: HomeLayoutId) => Promise<void>
  setGameCardSize: (gameCardSize: GameCardSize) => Promise<void>
  setLibraryGridColumns: (libraryGridColumns: LibraryGridColumns) => Promise<void>
  setUninstalledGameColor: (color: UninstalledGameColor) => Promise<void>
  setShowSteamSharedGames: (visible: boolean) => Promise<void>
  setBackdropIntensity: (backdropIntensity: BackdropIntensity) => Promise<void>
  setHomeBackdropMode: (homeBackdropMode: HomeBackdropMode) => Promise<void>
  setHomeBackdropMotion: (homeBackdropMotion: HomeBackdropMotion) => Promise<void>
  setPinnedBackdropGameId: (pinnedBackdropGameId: string) => Promise<void>
  selectCustomHomeWallpaper: () => Promise<boolean>
  clearCustomHomeWallpaper: () => Promise<void>
  fallbackFromCustomHomeWallpaper: (url: string) => Promise<void>
  setHomeCardBubbleEffect: (enabled: boolean) => Promise<void>
  setStartupAnimationMode: (mode: StartupAnimationMode) => Promise<boolean>
  selectCustomStartupVideo: () => Promise<boolean>
  setDockTheme: (dockTheme: DockThemeId) => Promise<void>
  setDockSize: (dockSize: DockSize) => Promise<void>
  setDockMotion: (dockMotion: DockMotion) => Promise<void>
  setDensity: (density: UiDensity) => Promise<void>
  setTextScale: (scale: number) => Promise<void>
  setLanguage: (language: Language) => Promise<void>
  setAudioPreset: (audioPreset: AudioPreset) => Promise<void>
  selectCustomUiAudioCue: (cueId: AudioCueId) => Promise<boolean>
  clearCustomUiAudioCue: (cueId: AudioCueId) => Promise<void>
  setShowStoreTab: (visible: boolean) => Promise<void>
  setShowFriendsHub: (visible: boolean) => Promise<void>
  setShowHomeBanners: (visible: boolean) => Promise<void>
  setShowAchievements: (visible: boolean) => Promise<void>
  setBackgroundTrailers: (visible: boolean) => Promise<void>
  setLauncherMusic: (enabled: boolean) => Promise<void>
  setLauncherMusicVolume: (volume: number) => Promise<void>
  setLauncherMusicSource: (source: LauncherMusicSource) => Promise<boolean>
  selectCustomLauncherMusic: () => Promise<boolean>
  clearCustomLauncherMusic: () => Promise<void>
  setGameTitleMusic: (enabled: boolean) => Promise<void>
  setGameTitleMusicVolume: (volume: number) => Promise<void>
  setGameTitleMusicDelaySeconds: (seconds: number) => Promise<void>
  setGameTitleMusicFadeSeconds: (seconds: number) => Promise<void>
  resetGameTitleMusicSettings: () => Promise<void>
  setGameCardPrimaryAction: (action: GameCardPrimaryAction) => Promise<void>
  setCloseLaunchersAfterGame: (enabled: boolean) => Promise<void>
  setNotificationsEnabled: (enabled: boolean) => Promise<void>
  setNotificationPosition: (position: NotificationPosition) => Promise<void>
  setNotificationMotion: (motion: NotificationMotion) => Promise<void>
  setHardwareControlEnabled: (enabled: boolean) => Promise<void>
  setHardwareControlButton: (button: HardwareControlButton) => Promise<void>
  setHardwareControlHoldSeconds: (seconds: HardwareControlHoldSeconds) => Promise<void>
}

export const THEME_OPTIONS: { id: ThemeId; label: string; premium?: true }[] = [
  { id: 'midnight', label: 'Midnight' },
  { id: 'coresense', label: 'CoreSense' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'violet', label: 'Violet' },
  { id: 'sakura', label: 'Sakura' },
  { id: 'emerald', label: 'Emerald' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'amber', label: 'Amber' },
  { id: 'sunset', label: 'Sunset' },
  { id: 'crimson', label: 'Crimson' },
  { id: 'ice', label: 'Ice' },
  { id: 'lime', label: 'Lime' },
  { id: 'monochrome', label: 'Mono' },
  { id: 'cobalt', label: 'Cobalt', premium: true },
  { id: 'ultraviolet', label: 'Ultraviolet', premium: true },
  { id: 'magenta', label: 'Magenta', premium: true },
  { id: 'tangerine', label: 'Tangerine', premium: true },
  { id: 'mint', label: 'Mint', premium: true },
  { id: 'copper', label: 'Copper', premium: true }
]

export const CORNER_STYLE_OPTIONS: CornerStyleId[] = ['theme', 'square', 'soft', 'round']

export const HOME_LAYOUT_OPTIONS: { id: HomeLayoutId; label: string }[] = [
  { id: 'orbit', label: 'ORBIT' },
  { id: 'rolling', label: 'Rolling' },
  { id: 'float', label: 'FLOAT' },
  { id: 'coresense', label: 'CoreSense' },
  { id: 'xmode', label: 'XMODE' }
]

export const GAME_CARD_SIZE_OPTIONS: GameCardSize[] = ['compact', 'standard', 'large']
export { LIBRARY_GRID_COLUMN_OPTIONS }
export const UNINSTALLED_GAME_COLOR_OPTIONS: UninstalledGameColor[] = [
  ...UNINSTALLED_GAME_COLORS
]

export const UNINSTALLED_GAME_COLOR_RGB: Record<UninstalledGameColor, string> = {
  gray: '124 132 148',
  blue: '82 124 166',
  violet: '124 92 154',
  green: '73 130 103',
  amber: '151 112 55',
  rose: '148 76 91'
}

export const BACKDROP_INTENSITY_OPTIONS: BackdropIntensity[] = [
  'subtle',
  'balanced',
  'vivid'
]
export const HOME_BACKDROP_MODE_OPTIONS: HomeBackdropMode[] = [...HOME_BACKDROP_MODES]
export const HOME_BACKDROP_MOTION_OPTIONS: HomeBackdropMotion[] = [...HOME_BACKDROP_MOTIONS]



function normalizeAudioCuePresets(value: unknown): AudioCuePresets {
  const candidate =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Partial<Record<AudioCueId, unknown>>)
      : {}
  return AUDIO_CUE_IDS.reduce<AudioCuePresets>(
    (presets, cueId) => {
      const preset = candidate[cueId]
      presets[cueId] = AUDIO_CUE_PRESETS.includes(
        preset as (typeof AUDIO_CUE_PRESETS)[number]
      )
        ? (preset as AudioCuePreset)
        : DEFAULT_AUDIO_CUE_PRESETS[cueId]
      return presets
    },
    { ...DEFAULT_AUDIO_CUE_PRESETS }
  )
}

function applyDomAttributes(
  theme: ThemeId,
  density: UiDensity,
  homeLayout: HomeLayoutId,
  gameCardSize: GameCardSize,
  backdropIntensity: BackdropIntensity,
  cornerStyle: CornerStyleId
): void {
  const appearanceUnlocked = useOrbitPlusStore
    .getState()
    .hasFeature('premium-appearance')
  const effectiveTheme = isOrbitPlusThemeId(theme) && !appearanceUnlocked ? 'midnight' : theme
  const effectiveCornerStyle =
    cornerStyle !== 'theme' && !appearanceUnlocked ? 'theme' : cornerStyle
  document.documentElement.setAttribute('data-theme', effectiveTheme)
  document.documentElement.setAttribute('data-corner-style', effectiveCornerStyle)
  document.documentElement.setAttribute('data-density', density)
  document.documentElement.setAttribute('data-home-layout', homeLayout)
  document.documentElement.setAttribute('data-card-size', gameCardSize)
  document.documentElement.setAttribute('data-backdrop-intensity', backdropIntensity)
}

function applyHomeCardBubbleEffect(enabled: boolean): void {
  document.documentElement.setAttribute('data-home-card-bubbles', enabled ? 'on' : 'off')
}

function applyUninstalledGameColor(color: UninstalledGameColor): void {
  document.documentElement.style.setProperty(
    '--color-uninstalled-game',
    UNINSTALLED_GAME_COLOR_RGB[color]
  )
}

let textScaleRevision = 0

let musicSettingsSaveTimer: number | undefined
let pendingMusicSettings: Partial<OrbitSettings> = {}
let musicSettingsSaveWaiters: Array<{
  resolve: () => void
  reject: (error: unknown) => void
}> = []

function scheduleMusicSettingsSave(partial: Partial<OrbitSettings>): Promise<void> {
  pendingMusicSettings = { ...pendingMusicSettings, ...partial }
  if (musicSettingsSaveTimer !== undefined) {
    window.clearTimeout(musicSettingsSaveTimer)
  }

  const result = new Promise<void>((resolve, reject) => {
    musicSettingsSaveWaiters.push({ resolve, reject })
  })
  musicSettingsSaveTimer = window.setTimeout(() => {
    void flushMusicSettingsSave()
  }, 180)
  return result
}

export function flushMusicSettingsSave(): Promise<void> {
  if (musicSettingsSaveTimer !== undefined) {
    window.clearTimeout(musicSettingsSaveTimer)
    musicSettingsSaveTimer = undefined
  }
  if (Object.keys(pendingMusicSettings).length === 0) return Promise.resolve()

  const update = pendingMusicSettings
  const waiters = musicSettingsSaveWaiters
  pendingMusicSettings = {}
  musicSettingsSaveWaiters = []
  return window.api.settings.set(update).then(
    () => waiters.forEach(({ resolve }) => resolve()),
    (error: unknown) => {
      waiters.forEach(({ reject }) => reject(error))
    }
  )
}

let languageSaveQueue: Promise<unknown> = Promise.resolve()
let languageRevision = 0
let confirmedLanguage: Language = DEFAULT_LANGUAGE

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  theme: 'midnight',
  cornerStyle: 'theme',
  profileAvatar: 'orbit',
  customAvatarUrl: undefined,
  homeLayout: 'orbit',
  gameCardSize: 'standard',
  libraryGridColumns: 6,
  uninstalledGameColor: 'gray',
  showSteamSharedGames: true,
  backdropIntensity: 'balanced',
  homeBackdropMode: 'focus',
  homeBackdropMotion: 'drift',
  pinnedBackdropGameId: undefined,
  customHomeWallpaper: undefined,
  homeCardBubbleEffect: true,
  startupAnimationMode: readCachedStartupAnimationMode(),
  customStartupVideoUrl: undefined,
  dockTheme: 'standard',
  dockSize: 'standard',
  dockMotion: 'standard',
  uiDensity: 'standard',
  textScale: readCachedTextScale(),
  textScaleSaveState: 'idle',
  language: DEFAULT_LANGUAGE,
  audioPreset: 'orbit',
  audioCuePresets: { ...DEFAULT_AUDIO_CUE_PRESETS },
  customUiAudioCues: {},
  showStoreTab: true,
  showFriendsHub: true,
  showHomeBanners: true,
  showAchievements: true,
  backgroundTrailers: true,
  launcherMusic: LAUNCHER_MUSIC_ENABLED_DEFAULT,
  launcherMusicVolume: LAUNCHER_MUSIC_VOLUME_DEFAULT,
  launcherMusicSource: LAUNCHER_MUSIC_SOURCE_DEFAULT,
  customLauncherMusic: undefined,
  gameTitleMusic: GAME_TITLE_MUSIC_ENABLED_DEFAULT,
  gameTitleMusicVolume: GAME_TITLE_MUSIC_VOLUME_DEFAULT,
  gameTitleMusicDelaySeconds: GAME_TITLE_MUSIC_DELAY_DEFAULT,
  gameTitleMusicFadeSeconds: GAME_TITLE_MUSIC_FADE_DEFAULT,
  gameCardPrimaryAction: 'launch',
  closeLaunchersAfterGame: false,
  notificationsEnabled: true,
  notificationPosition: 'top-right',
  notificationMotion: 'slide',
  hardwareControlEnabled: false,
  hardwareControlButton: 'menu',
  hardwareControlHoldSeconds: 2,
  hydrated: false,

  hydrate: async () => {
    const [
      settings,
      customAvatarUrl,
      customStartupVideoUrl,
      customHomeWallpaper,
      customLauncherMusic,
      customUiAudioCues
    ] =
      await Promise.all([
        window.api.settings.get(),
        window.api.profileAvatar.getCustom(),
        window.api.startupVideo.get(),
        window.api.homeWallpaper.get(),
        window.api.launcherMusic.getCustom(),
        window.api.uiAudio.getCustom()
      ])
    const homeLayout = settings.homeLayout ?? 'orbit'
    const cornerStyle = settings.cornerStyle ?? 'theme'
    const gameCardSize = settings.gameCardSize ?? 'standard'
    const libraryGridColumns = LIBRARY_GRID_COLUMN_OPTIONS.includes(settings.libraryGridColumns)
      ? settings.libraryGridColumns
      : 6
    const uninstalledGameColor = UNINSTALLED_GAME_COLORS.includes(settings.uninstalledGameColor)
      ? settings.uninstalledGameColor
      : 'gray'
    const backdropIntensity = settings.backdropIntensity ?? 'balanced'
    const requestedHomeBackdropMode = HOME_BACKDROP_MODES.includes(settings.homeBackdropMode)
      ? settings.homeBackdropMode
      : 'focus'
    const homeBackdropMode =
      requestedHomeBackdropMode === 'custom' && !customHomeWallpaper
        ? 'focus'
        : requestedHomeBackdropMode
    const homeBackdropMotion = HOME_BACKDROP_MOTIONS.includes(settings.homeBackdropMotion)
      ? settings.homeBackdropMotion
      : 'drift'
    const homeCardBubbleEffect = settings.homeCardBubbleEffect ?? true
    const requestedLauncherMusicSource = LAUNCHER_MUSIC_SOURCES.includes(
      settings.launcherMusicSource as LauncherMusicSource
    )
      ? (settings.launcherMusicSource as LauncherMusicSource)
      : LAUNCHER_MUSIC_SOURCE_DEFAULT
    const launcherMusicSource =
      requestedLauncherMusicSource === 'custom' && !customLauncherMusic
        ? LAUNCHER_MUSIC_SOURCE_DEFAULT
        : requestedLauncherMusicSource
    const requestedAudioPreset = AUDIO_PRESETS.includes(settings.audioPreset)
      ? settings.audioPreset
      : 'orbit'
    const audioPreset = requestedAudioPreset
    const audioCuePresets = normalizeAudioCuePresets(settings.audioCuePresets)
    const resolvedCustomUiAudioCues = customUiAudioCues ?? {}
    const requestedStartupAnimationMode = settings.startupAnimationMode ?? 'orbit'
    const startupAnimationMode =
      requestedStartupAnimationMode === 'custom' &&
      (!customStartupVideoUrl || hasCustomStartupVideoFailed())
        ? 'orbit'
        : requestedStartupAnimationMode
    cacheStartupAnimationMode(startupAnimationMode)
    cacheStartupVideoUrl(customStartupVideoUrl ?? undefined)
    if (startupAnimationMode !== requestedStartupAnimationMode) {
      void window.api.settings.set({ startupAnimationMode })
    }
    if (homeBackdropMode !== requestedHomeBackdropMode) {
      void window.api.settings.set({ homeBackdropMode })
    }
    if (launcherMusicSource !== requestedLauncherMusicSource) {
      void window.api.settings.set({ launcherMusicSource })
    }
    confirmedLanguage = normalizeLanguage(settings.language)
    document.documentElement.lang = confirmedLanguage
    const textScale = normalizeTextScale(settings.textScale)
    applyTextScale(textScale)
    applyDomAttributes(
      settings.theme,
      settings.uiDensity,
      homeLayout,
      gameCardSize,
      backdropIntensity,
      cornerStyle
    )
    applyHomeCardBubbleEffect(homeCardBubbleEffect)
    applyUninstalledGameColor(uninstalledGameColor)
    void setUiAudioCustomCues(resolvedCustomUiAudioCues)
    setUiAudioPreset(audioPreset)
    set({
      theme: settings.theme,
      cornerStyle,
      profileAvatar:
        settings.profileAvatar === 'custom' && !customAvatarUrl
          ? 'orbit'
          : (settings.profileAvatar ?? 'orbit'),
      customAvatarUrl: customAvatarUrl ?? undefined,
      homeLayout,
      gameCardSize,
      libraryGridColumns,
      uninstalledGameColor,
      showSteamSharedGames: settings.showSteamSharedGames ?? true,
      backdropIntensity,
      homeBackdropMode,
      homeBackdropMotion,
      pinnedBackdropGameId: settings.pinnedBackdropGameId,
      customHomeWallpaper: customHomeWallpaper ?? undefined,
      homeCardBubbleEffect,
      startupAnimationMode,
      customStartupVideoUrl: customStartupVideoUrl ?? undefined,
      dockTheme: settings.dockTheme ?? 'standard',
      dockSize: settings.dockSize ?? 'standard',
      dockMotion: settings.dockMotion ?? 'standard',
      uiDensity: settings.uiDensity,
      textScale,
      language: normalizeLanguage(settings.language),
      audioPreset,
      audioCuePresets,
      customUiAudioCues: resolvedCustomUiAudioCues,
      showStoreTab: settings.showStoreTab,
      showFriendsHub: settings.showFriendsHub ?? true,
      showHomeBanners: homeLayout === 'orbit' ? settings.showHomeBanners : false,
      showAchievements: settings.showAchievements,
      backgroundTrailers: settings.backgroundTrailers ?? true,
      launcherMusic: settings.launcherMusic ?? LAUNCHER_MUSIC_ENABLED_DEFAULT,
      launcherMusicVolume: normalizeLauncherMusicVolume(settings.launcherMusicVolume),
      launcherMusicSource,
      customLauncherMusic: customLauncherMusic ?? undefined,
      gameTitleMusic: settings.gameTitleMusic ?? GAME_TITLE_MUSIC_ENABLED_DEFAULT,
      gameTitleMusicVolume: normalizeGameTitleMusicVolume(settings.gameTitleMusicVolume),
      gameTitleMusicDelaySeconds: normalizeGameTitleMusicDelay(
        settings.gameTitleMusicDelaySeconds
      ),
      gameTitleMusicFadeSeconds: normalizeGameTitleMusicFade(
        settings.gameTitleMusicFadeSeconds
      ),
      gameCardPrimaryAction: GAME_CARD_PRIMARY_ACTIONS.includes(settings.gameCardPrimaryAction)
        ? settings.gameCardPrimaryAction
        : 'launch',
      closeLaunchersAfterGame: settings.closeLaunchersAfterGame ?? false,
      notificationsEnabled: settings.notificationsEnabled ?? true,
      notificationPosition: settings.notificationPosition ?? 'top-right',
      notificationMotion: settings.notificationMotion ?? 'slide',
      hardwareControlEnabled: settings.hardwareControlEnabled ?? false,
      hardwareControlButton: settings.hardwareControlButton ?? 'menu',
      hardwareControlHoldSeconds: settings.hardwareControlHoldSeconds ?? 2,
      hydrated: true
    })
    return settings
  },

  setTheme: async (theme) => {
    if (
      isOrbitPlusThemeId(theme) &&
      !useOrbitPlusStore.getState().hasFeature('premium-appearance')
    ) {
      return
    }
    applyDomAttributes(
      theme,
      get().uiDensity,
      get().homeLayout,
      get().gameCardSize,
      get().backdropIntensity,
      get().cornerStyle
    )
    set({ theme })
    await window.api.settings.set({ theme })
  },

  setCornerStyle: async (cornerStyle) => {
    if (
      cornerStyle !== 'theme' &&
      !useOrbitPlusStore.getState().hasFeature('premium-appearance')
    ) {
      return
    }
    applyDomAttributes(
      get().theme,
      get().uiDensity,
      get().homeLayout,
      get().gameCardSize,
      get().backdropIntensity,
      cornerStyle
    )
    set({ cornerStyle })
    await window.api.settings.set({ cornerStyle })
  },

  syncOrbitPlusAppearance: () => {
    applyDomAttributes(
      get().theme,
      get().uiDensity,
      get().homeLayout,
      get().gameCardSize,
      get().backdropIntensity,
      get().cornerStyle
    )
  },

  setProfileAvatar: async (profileAvatar) => {
    if (profileAvatar === 'custom' && !get().customAvatarUrl) return
    set({ profileAvatar })
    await window.api.settings.set({ profileAvatar })
  },

  selectCustomAvatar: async () => {
    const customAvatarUrl = await window.api.profileAvatar.selectCustom()
    if (!customAvatarUrl) return false
    set({ customAvatarUrl, profileAvatar: 'custom' })
    await window.api.settings.set({ profileAvatar: 'custom' })
    return true
  },

  setHomeLayout: async (homeLayout) => {
    const showHomeBanners = homeLayout === 'orbit'
    applyDomAttributes(
      get().theme,
      get().uiDensity,
      homeLayout,
      get().gameCardSize,
      get().backdropIntensity,
      get().cornerStyle
    )
    set({ homeLayout, showHomeBanners })
    await window.api.settings.set({ homeLayout, showHomeBanners })
  },

  setGameCardSize: async (gameCardSize) => {
    applyDomAttributes(
      get().theme,
      get().uiDensity,
      get().homeLayout,
      gameCardSize,
      get().backdropIntensity,
      get().cornerStyle
    )
    set({ gameCardSize })
    await window.api.settings.set({ gameCardSize })
  },

  setLibraryGridColumns: async (libraryGridColumns) => {
    set({ libraryGridColumns })
    await window.api.settings.set({ libraryGridColumns })
  },

  setUninstalledGameColor: async (uninstalledGameColor) => {
    applyUninstalledGameColor(uninstalledGameColor)
    set({ uninstalledGameColor })
    await window.api.settings.set({ uninstalledGameColor })
  },

  setShowSteamSharedGames: async (showSteamSharedGames) => {
    set({ showSteamSharedGames })
    await window.api.settings.set({ showSteamSharedGames })
  },

  setBackdropIntensity: async (backdropIntensity) => {
    applyDomAttributes(
      get().theme,
      get().uiDensity,
      get().homeLayout,
      get().gameCardSize,
      backdropIntensity,
      get().cornerStyle
    )
    set({ backdropIntensity })
    await window.api.settings.set({ backdropIntensity })
  },

  setHomeBackdropMode: async (homeBackdropMode) => {
    if (homeBackdropMode === 'custom' && !get().customHomeWallpaper) return
    set({ homeBackdropMode })
    await window.api.settings.set({ homeBackdropMode })
  },

  setHomeBackdropMotion: async (homeBackdropMotion) => {
    if (
      homeBackdropMotion !== 'still' &&
      !useOrbitPlusStore.getState().hasFeature('background-motion')
    ) {
      return
    }
    set({ homeBackdropMotion })
    await window.api.settings.set({ homeBackdropMotion })
  },

  setPinnedBackdropGameId: async (pinnedBackdropGameId) => {
    set({ pinnedBackdropGameId })
    await window.api.settings.set({ pinnedBackdropGameId })
  },

  selectCustomHomeWallpaper: async () => {
    const customHomeWallpaper = await window.api.homeWallpaper.select()
    if (!customHomeWallpaper) return false
    set({ customHomeWallpaper, homeBackdropMode: 'custom' })
    await window.api.settings.set({ homeBackdropMode: 'custom' })
    return true
  },

  clearCustomHomeWallpaper: async () => {
    await window.api.homeWallpaper.clear()
    const homeBackdropMode = get().homeBackdropMode === 'custom' ? 'focus' : get().homeBackdropMode
    set({ customHomeWallpaper: undefined, homeBackdropMode })
    await window.api.settings.set({ homeBackdropMode })
  },

  fallbackFromCustomHomeWallpaper: async (url) => {
    const { customHomeWallpaper, homeBackdropMode } = get()
    if (homeBackdropMode !== 'custom' || customHomeWallpaper?.url !== url) return
    set({ homeBackdropMode: 'focus' })
    await window.api.settings.set({ homeBackdropMode: 'focus' })
  },

  setHomeCardBubbleEffect: async (homeCardBubbleEffect) => {
    applyHomeCardBubbleEffect(homeCardBubbleEffect)
    set({ homeCardBubbleEffect })
    await window.api.settings.set({ homeCardBubbleEffect })
  },

  setStartupAnimationMode: async (startupAnimationMode) => {
    if (startupAnimationMode === 'custom' && !get().customStartupVideoUrl) {
      return get().selectCustomStartupVideo()
    }
    cacheStartupAnimationMode(startupAnimationMode)
    set({ startupAnimationMode })
    await window.api.settings.set({ startupAnimationMode })
    return true
  },

  selectCustomStartupVideo: async () => {
    const customStartupVideoUrl = await window.api.startupVideo.select()
    if (!customStartupVideoUrl) return false
    cacheStartupVideoUrl(customStartupVideoUrl)
    cacheStartupAnimationMode('custom')
    set({ customStartupVideoUrl, startupAnimationMode: 'custom' })
    await window.api.settings.set({ startupAnimationMode: 'custom' })
    return true
  },

  setDockTheme: async (dockTheme) => {
    set({ dockTheme })
    await window.api.settings.set({ dockTheme })
  },

  setDockSize: async (dockSize) => {
    set({ dockSize })
    await window.api.settings.set({ dockSize })
  },

  setDockMotion: async (dockMotion) => {
    set({ dockMotion })
    await window.api.settings.set({ dockMotion })
  },

  setDensity: async (uiDensity) => {
    applyDomAttributes(
      get().theme,
      uiDensity,
      get().homeLayout,
      get().gameCardSize,
      get().backdropIntensity,
      get().cornerStyle
    )
    set({ uiDensity })
    await window.api.settings.set({ uiDensity })
  },

  setTextScale: async (value) => {
    const textScale = normalizeTextScale(value)
    const revision = ++textScaleRevision
    applyTextScale(textScale)
    set({ textScale, textScaleSaveState: 'saving' })
    try {
      await scheduleTextScaleSave(textScale)
      if (revision === textScaleRevision) set({ textScaleSaveState: 'idle' })
    } catch (error) {
      if (revision === textScaleRevision) set({ textScaleSaveState: 'error' })
      throw error
    }
  },

  setLanguage: async (language) => {
    if (!isLanguage(language)) return
    const revision = ++languageRevision
    document.documentElement.lang = language
    set({ language })
    const save = languageSaveQueue.then(() => window.api.settings.set({ language }))
    languageSaveQueue = save.catch(() => undefined)
    try {
      const saved = await save
      confirmedLanguage = normalizeLanguage(saved.language)
    } catch {
      if (revision !== languageRevision) return
      document.documentElement.lang = confirmedLanguage
      set({ language: confirmedLanguage })
      useNotificationStore.getState().push({
        titleKey: 'settings.language.title',
        messageKey: 'settings.saveFailed',
        force: true
      })
    }
  },

  setAudioPreset: async (audioPreset) => {
    if (
      audioPreset === 'manual' &&
      !useOrbitPlusStore.getState().hasFeature('manual-audio')
    ) {
      return
    }
    setUiAudioPreset(audioPreset, true)
    set({ audioPreset })
    await window.api.settings.set({ audioPreset })
  },

  selectCustomUiAudioCue: async (cueId) => {
    if (!useOrbitPlusStore.getState().hasFeature('manual-audio')) return false
    const customCue = await window.api.uiAudio.selectCustom(cueId)
    if (!customCue) return false
    const customUiAudioCues = { ...get().customUiAudioCues, [cueId]: customCue }
    set({ customUiAudioCues })
    await setUiAudioCustomCues(customUiAudioCues, cueId)
    return true
  },

  clearCustomUiAudioCue: async (cueId) => {
    await window.api.uiAudio.clearCustom(cueId)
    const customUiAudioCues = { ...get().customUiAudioCues }
    delete customUiAudioCues[cueId]
    set({ customUiAudioCues })
    await setUiAudioCustomCues(customUiAudioCues)
  },

  setShowStoreTab: async (showStoreTab) => {
    set({ showStoreTab })
    await window.api.settings.set({ showStoreTab })
  },

  setShowFriendsHub: async (showFriendsHub) => {
    set({ showFriendsHub })
    await window.api.settings.set({ showFriendsHub })
  },

  setShowHomeBanners: async (showHomeBanners) => {
    if (get().homeLayout !== 'orbit') return
    set({ showHomeBanners })
    await window.api.settings.set({ showHomeBanners })
  },

  setShowAchievements: async (showAchievements) => {
    set({ showAchievements })
    await window.api.settings.set({ showAchievements })
  },
  setBackgroundTrailers: async (backgroundTrailers) => {
    set({ backgroundTrailers })
    await window.api.settings.set({ backgroundTrailers })
  },

  setLauncherMusic: async (launcherMusic) => {
    set({ launcherMusic })
    await window.api.settings.set({ launcherMusic })
  },

  setLauncherMusicVolume: async (value) => {
    const launcherMusicVolume = normalizeLauncherMusicVolume(value)
    set({ launcherMusicVolume })
    await scheduleMusicSettingsSave({ launcherMusicVolume })
  },

  setLauncherMusicSource: async (launcherMusicSource) => {
    if (
      launcherMusicSource === 'custom' &&
      !useOrbitPlusStore.getState().hasFeature('manual-audio')
    ) {
      return false
    }
    if (launcherMusicSource === 'custom' && !get().customLauncherMusic) {
      return get().selectCustomLauncherMusic()
    }
    set({ launcherMusicSource })
    await window.api.settings.set({ launcherMusicSource })
    return true
  },

  selectCustomLauncherMusic: async () => {
    if (!useOrbitPlusStore.getState().hasFeature('manual-audio')) return false
    const customLauncherMusic = await window.api.launcherMusic.selectCustom()
    if (!customLauncherMusic) return false
    set({ customLauncherMusic, launcherMusicSource: 'custom' })
    await window.api.settings.set({ launcherMusicSource: 'custom' })
    return true
  },

  clearCustomLauncherMusic: async () => {
    await window.api.launcherMusic.clearCustom()
    set({ customLauncherMusic: undefined, launcherMusicSource: 'orbit' })
    await window.api.settings.set({ launcherMusicSource: 'orbit' })
  },

  setGameTitleMusic: async (gameTitleMusic) => {
    set({ gameTitleMusic })
    await window.api.settings.set({ gameTitleMusic })
  },

  setGameTitleMusicVolume: async (value) => {
    const gameTitleMusicVolume = normalizeGameTitleMusicVolume(value)
    set({ gameTitleMusicVolume })
    await scheduleMusicSettingsSave({ gameTitleMusicVolume })
  },

  setGameTitleMusicDelaySeconds: async (value) => {
    const gameTitleMusicDelaySeconds = normalizeGameTitleMusicDelay(value)
    set({ gameTitleMusicDelaySeconds })
    await scheduleMusicSettingsSave({ gameTitleMusicDelaySeconds })
  },

  setGameTitleMusicFadeSeconds: async (value) => {
    const gameTitleMusicFadeSeconds = normalizeGameTitleMusicFade(value)
    set({ gameTitleMusicFadeSeconds })
    await scheduleMusicSettingsSave({ gameTitleMusicFadeSeconds })
  },

  resetGameTitleMusicSettings: async () => {
    const titleMusicSettings = {
      gameTitleMusicVolume: GAME_TITLE_MUSIC_VOLUME_DEFAULT,
      gameTitleMusicDelaySeconds: GAME_TITLE_MUSIC_DELAY_DEFAULT,
      gameTitleMusicFadeSeconds: GAME_TITLE_MUSIC_FADE_DEFAULT
    }
    set(titleMusicSettings)
    await scheduleMusicSettingsSave(titleMusicSettings)
  },

  setGameCardPrimaryAction: async (gameCardPrimaryAction) => {
    set({ gameCardPrimaryAction })
    await window.api.settings.set({ gameCardPrimaryAction })
  },

  setCloseLaunchersAfterGame: async (closeLaunchersAfterGame) => {
    set({ closeLaunchersAfterGame })
    await window.api.settings.set({ closeLaunchersAfterGame })
  },

  setNotificationsEnabled: async (notificationsEnabled) => {
    set({ notificationsEnabled })
    await window.api.settings.set({ notificationsEnabled })
  },

  setNotificationPosition: async (notificationPosition) => {
    set({ notificationPosition })
    await window.api.settings.set({ notificationPosition })
  },

  setNotificationMotion: async (notificationMotion) => {
    set({ notificationMotion })
    await window.api.settings.set({ notificationMotion })
  },

  setHardwareControlEnabled: async (hardwareControlEnabled) => {
    await window.api.settings.set({ hardwareControlEnabled })
    set({ hardwareControlEnabled })
  },

  setHardwareControlButton: async (hardwareControlButton) => {
    await window.api.settings.set({ hardwareControlButton })
    set({ hardwareControlButton })
  },

  setHardwareControlHoldSeconds: async (hardwareControlHoldSeconds) => {
    await window.api.settings.set({ hardwareControlHoldSeconds })
    set({ hardwareControlHoldSeconds })
  }
}))
