import type { Language } from './language'
export type { Language } from './language'
export type { CustomLauncherMusic, LauncherMusicSource } from './launcherMusic'
export type { NativeControllerInputSnapshot } from './steamController'
export type {
  GameMediaLinkKind,
  MediaLinkPasteResult,
  MediaLinkSearchOption,
  MediaLinkSearchResult
} from './mediaLinkSearch'
export type {
  MetadataLookupResult,
  MetadataSearchCandidate,
  MetadataSearchOption,
  MetadataSearchResult
} from './gameMetadataSearch'
export type { AchievementGuideResult } from './achievementGuide'

export const FREE_THEME_IDS = [
  'midnight',
  'coresense',
  'aurora',
  'violet',
  'sakura',
  'emerald',
  'ocean',
  'amber',
  'sunset',
  'crimson',
  'ice',
  'lime',
  'monochrome'
] as const
export const ORBIT_PLUS_THEME_IDS = [
  'cobalt',
  'ultraviolet',
  'magenta',
  'tangerine',
  'mint',
  'copper'
] as const
export const THEME_IDS = [...FREE_THEME_IDS, ...ORBIT_PLUS_THEME_IDS] as const
export type ThemeId = (typeof THEME_IDS)[number]
export const CORNER_STYLE_IDS = ['theme', 'square', 'soft', 'round'] as const
export type CornerStyleId = (typeof CORNER_STYLE_IDS)[number]

export function isThemeId(value: unknown): value is ThemeId {
  return THEME_IDS.includes(value as ThemeId)
}

export function isOrbitPlusThemeId(value: ThemeId): boolean {
  return ORBIT_PLUS_THEME_IDS.includes(value as (typeof ORBIT_PLUS_THEME_IDS)[number])
}

export function isCornerStyleId(value: unknown): value is CornerStyleId {
  return CORNER_STYLE_IDS.includes(value as CornerStyleId)
}
export type UiDensity = 'standard' | 'compact'
export const DOCK_THEME_IDS = ['standard', 'glass', 'neon', 'minimal'] as const
export type DockThemeId = (typeof DOCK_THEME_IDS)[number]
export const DOCK_SIZES = ['compact', 'standard', 'large'] as const
export type DockSize = (typeof DOCK_SIZES)[number]
export const DOCK_MOTIONS = ['calm', 'standard', 'lively'] as const
export type DockMotion = (typeof DOCK_MOTIONS)[number]
export const STARTUP_ANIMATION_MODES = ['orbit', 'custom', 'off'] as const
export type StartupAnimationMode = (typeof STARTUP_ANIMATION_MODES)[number]
export const CUSTOM_STARTUP_VIDEO_URL = 'orbit-media://startup.mp4'
export const FREE_HOME_LAYOUT_IDS = ['orbit', 'rolling', 'float', 'coresense', 'xmode'] as const
export const ORBIT_PLUS_HOME_LAYOUT_IDS = ['cuadro'] as const
export const HOME_LAYOUT_IDS = [...FREE_HOME_LAYOUT_IDS, ...ORBIT_PLUS_HOME_LAYOUT_IDS] as const
export type HomeLayoutId = (typeof HOME_LAYOUT_IDS)[number]

export function isHomeLayoutId(value: unknown): value is HomeLayoutId {
  return HOME_LAYOUT_IDS.includes(value as HomeLayoutId)
}

export function isOrbitPlusHomeLayoutId(value: HomeLayoutId): boolean {
  return ORBIT_PLUS_HOME_LAYOUT_IDS.includes(
    value as (typeof ORBIT_PLUS_HOME_LAYOUT_IDS)[number]
  )
}

export type GameCardSize = 'compact' | 'standard' | 'large'
export const GAME_CARD_PRIMARY_ACTIONS = ['launch', 'details'] as const
export type GameCardPrimaryAction = (typeof GAME_CARD_PRIMARY_ACTIONS)[number]
export const LIBRARY_GRID_COLUMN_OPTIONS = [4, 5, 6, 7, 8] as const
export type LibraryGridColumns = (typeof LIBRARY_GRID_COLUMN_OPTIONS)[number]
export const UNINSTALLED_GAME_COLORS = [
  'gray',
  'soft-gray',
  'none',
  'blue',
  'violet',
  'green',
  'amber',
  'rose'
] as const
export type UninstalledGameColor = (typeof UNINSTALLED_GAME_COLORS)[number]
export type BackdropIntensity = 'subtle' | 'balanced' | 'vivid'
export const HOME_BACKDROP_MODES = ['focus', 'pinned', 'slideshow', 'custom'] as const
export type HomeBackdropMode = (typeof HOME_BACKDROP_MODES)[number]
export const HOME_BACKDROP_MOTIONS = ['still', 'drift', 'cinematic'] as const
export type HomeBackdropMotion = (typeof HOME_BACKDROP_MOTIONS)[number]
export type HomeWallpaperKind = 'image' | 'video'
export interface HomeWallpaperAsset {
  kind: HomeWallpaperKind
  url: string
}
export const PROFILE_AVATAR_IDS = [
  'orbit',
  'nova',
  'pulse',
  'drift',
  'ember',
  'pixel',
  'custom',
  'steam'
] as const
export type ProfileAvatarId = (typeof PROFILE_AVATAR_IDS)[number]
export const NOTIFICATION_POSITIONS = ['top-right', 'top-center', 'bottom-right'] as const
export type NotificationPosition = (typeof NOTIFICATION_POSITIONS)[number]
export const NOTIFICATION_MOTIONS = ['slide', 'lift', 'scale'] as const
export type NotificationMotion = (typeof NOTIFICATION_MOTIONS)[number]

export const AUDIO_PRESETS = [
  'orbit',
  'soft',
  'deep',
  'minimal',
  'steam',
  'xbox',
  'playstation',
  'manual',
  'off'
] as const
export type AudioPreset = (typeof AUDIO_PRESETS)[number]
export const AUDIO_CUE_IDS = [
  'navigate',
  'confirm',
  'back',
  'switch',
  'open',
  'close',
  'error'
] as const
export type AudioCueId = (typeof AUDIO_CUE_IDS)[number]
export interface CustomUiAudioCue {
  /** Opaque orbit-media URL. The original local path never reaches the renderer. */
  url: string
  name: string
}
export type CustomUiAudioCues = Partial<Record<AudioCueId, CustomUiAudioCue>>

export function isAudioCueId(value: unknown): value is AudioCueId {
  return AUDIO_CUE_IDS.includes(value as AudioCueId)
}

export const AUDIO_CUE_PRESETS = [
  'orbit',
  'soft',
  'deep',
  'minimal',
  'steam',
  'xbox',
  'playstation',
  'off'
] as const
export type AudioCuePreset = (typeof AUDIO_CUE_PRESETS)[number]
export type AudioCuePresets = Record<AudioCueId, AudioCuePreset>
export const DEFAULT_AUDIO_CUE_PRESETS = {
  navigate: 'orbit',
  confirm: 'orbit',
  back: 'orbit',
  switch: 'orbit',
  open: 'orbit',
  close: 'orbit',
  error: 'orbit'
} as const satisfies AudioCuePresets
export type StoreRegionId = 'eu' | 'us' | 'gb' | 'ca' | 'au'
export type SystemPowerAction = 'sleep' | 'restart' | 'shutdown'
export type SystemSettingsTarget = 'power' | 'wifi' | 'ethernet' | 'bluetooth'
export type OrbitWallpaperApplyState = 'applied' | 'failed' | 'unsupported'

/** Sanitized result of applying ORBIT's bundled Windows personalization asset. */
export interface OrbitWallpaperApplyResult {
  platform: 'windows' | 'unsupported'
  desktop: OrbitWallpaperApplyState
  lockScreen: OrbitWallpaperApplyState
  appliedAt: number
}

export type AppControlAction = 'relaunch' | 'quit'
export type GraphicsAdapterVendor = 'nvidia' | 'amd' | 'intel' | 'other'

export type OrbitApplicationCategory = 'media' | 'launcher' | 'standard' | 'custom'
export type OrbitApplicationTarget = 'native' | 'web' | 'orbit-media'

export interface OrbitApplication {
  id: string
  name: string
  category: OrbitApplicationCategory
  target: OrbitApplicationTarget
  available: boolean
  issue?: 'executable-missing' | 'unsupported-platform'
  /** Custom executable paths are shown for transparent editing. Built-in discovery paths stay private. */
  executablePath?: string
  launchArguments?: string
  iconDataUrl?: string
  controllerOptimized?: boolean
}

export interface OrbitApplicationSnapshot {
  applications: OrbitApplication[]
  scannedAt: number
  platform: 'windows' | 'unsupported'
}

export type MediaKeyboardShortcut =
  | 'backspace'
  | 'space'
  | 'cursor-left'
  | 'cursor-right'
  | 'shift'
  | 'layout'
  | 'done'

export interface MediaKeyboardOpenPayload {
  requestId: string
  value: string
  selectionStart: number
  selectionEnd: number
  inputType: 'email' | 'number' | 'password' | 'search' | 'tel' | 'text' | 'url'
  label?: string
  maxLength?: number
}

export interface MediaKeyboardUpdatePayload {
  requestId: string
  value: string
  selectionStart: number
  selectionEnd: number
}

export interface MediaOverlayHintPayload {
  id: string
  title: string
  message: string
}

export interface CustomApplicationDraft {
  draftId: string
  suggestedName: string
  executablePath: string
  iconDataUrl?: string
}

export interface CustomApplicationCommitInput {
  draftId: string
  name: string
  launchArguments?: string
}

export interface CustomApplicationUpdateInput {
  applicationId: string
  name: string
  launchArguments?: string
}

export interface ApplicationLaunchResult {
  applicationId: string
  applicationName: string
  controllerBridge: 'active' | 'unavailable' | 'not-needed'
}
export const PLAYSTATION_REMOTE_PLAY_PREFERENCES = [
  'auto',
  'chiaki',
  'ps-remote-play'
] as const
export type PlayStationRemotePlayPreference =
  (typeof PLAYSTATION_REMOTE_PLAY_PREFERENCES)[number]
export type PlayStationRemotePlayAppId = Exclude<PlayStationRemotePlayPreference, 'auto'>

export type SystemStatusState = 'loading' | 'ready' | 'partial' | 'error' | 'unsupported'
export type SystemNetworkType = 'wifi' | 'ethernet' | 'offline' | 'unknown'

/** Sanitized, local-only device status for ORBIT's top-bar quick menu. */
export interface SystemStatusSnapshot {
  platform: 'windows' | 'unsupported'
  state: SystemStatusState
  checkedAt: number
  battery: {
    present: boolean
    level?: number
    charging: boolean
    powerSource: 'battery' | 'ac' | 'unknown'
  }
  network: {
    connected: boolean
    type: SystemNetworkType
    name?: string
    linkSpeed?: string
  }
  bluetooth: {
    available: boolean
    enabled: boolean
  }
}

export interface InstalledGraphicsAdapter {
  name: string
  manufacturer: string
  vendor: GraphicsAdapterVendor
  driverVersion: string
  driverDate?: string
}

export interface PendingWindowsUpdate {
  id: string
  title: string
  kbArticleIds: string[]
  severity?: string
  rebootRequired: boolean
  downloaded: boolean
}

export interface GraphicsDriverUpdate {
  id: string
  title: string
  vendor: GraphicsAdapterVendor
  driverClass: string
  manufacturer: string
  model: string
  provider: string
  driverDate?: string
  matchedAdapterNames: string[]
  rebootRequired: boolean
  downloaded: boolean
}

export interface SystemUpdateSnapshot {
  platform: 'windows' | 'unsupported'
  state: 'ready' | 'partial' | 'error' | 'unsupported'
  checkedAt: number
  windowsUpdates: PendingWindowsUpdate[]
  graphicsAdapters: InstalledGraphicsAdapter[]
  graphicsDriverUpdates: GraphicsDriverUpdate[]
  errors: {
    updateScan?: 'windows-update-unavailable'
    graphicsDetection?: 'graphics-detection-unavailable'
  }
}

export type AppUpdateInstallMode = 'appx' | 'nsis' | 'development' | 'unsupported'
export type AppUpdateStage =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'installing'
  | 'error'
export type AppUpdateError =
  | 'release-unavailable'
  | 'release-invalid'
  | 'download-failed'
  | 'verification-failed'
  | 'install-failed'
export type AppUpdateBlockedReason = 'game-active' | 'not-downloaded'
export type AppUpdateDownloadPauseReason = 'game-active' | 'launcher-download-active'
export type AppUpdateVerification = 'pending' | 'verifying' | 'verified' | 'installer-managed'

/** Sanitized application-update state. Download URLs, local paths and raw
 * installer errors intentionally never cross into the renderer. */
export interface AppUpdateSnapshot {
  stage: AppUpdateStage
  installMode: AppUpdateInstallMode
  currentVersion: string
  targetVersion?: string
  releaseName?: string
  releaseNotes?: string
  releasePageUrl?: string
  checkedAt?: number
  downloadedAt?: number
  installedVersion?: string
  transferredBytes?: number
  totalBytes?: number
  percent?: number
  bytesPerSecond?: number
  channel: 'stable' | 'beta'
  automaticChecksEnabled: boolean
  autoDownloadEnabled: boolean
  /** True for MT3K community builds (unsigned, SHA-256 verified releases from the fork). */
  community?: boolean
  /** What the toggle means when the user never touched it. */
  autoDownloadDefault?: boolean
  checkIntervalHours: number
  nextCheckAt?: number
  verification: AppUpdateVerification
  downloadPausedReason?: AppUpdateDownloadPauseReason
  canInstall: boolean
  blockedReason?: AppUpdateBlockedReason
  installScheduled: boolean
  installCountdownEndsAt?: number
  error?: AppUpdateError
}
export const HARDWARE_CONTROL_BUTTONS = [
  'menu',
  'view',
  'guide',
  'playstation',
  'a',
  'b',
  'x',
  'y',
  'dpad-up',
  'dpad-down',
  'dpad-left',
  'dpad-right',
  'left-trigger',
  'right-trigger',
  'left-bumper',
  'right-bumper',
  'left-stick',
  'right-stick'
] as const
export type HardwareControlButton = (typeof HARDWARE_CONTROL_BUTTONS)[number]
export const HARDWARE_CONTROL_HOLD_SECONDS = [1, 1.5, 2, 3] as const
export type HardwareControlHoldSeconds = (typeof HARDWARE_CONTROL_HOLD_SECONDS)[number]

/** A user-owned, provider-neutral game collection. Games remain referenced by
 * their durable `<provider>:<providerGameId>` library identity. */
export interface GameCollection {
  id: string
  name: string
  gameIds: string[]
  createdAt: number
}

export interface HardwareControlStatus {
  detail?: string
  state: 'disabled' | 'starting' | 'ready' | 'unavailable'
  connectedControllers: number
  reason?: 'unsupported-platform' | 'monitor-failed' | 'service-not-running'
  lastInputAt?: number
  lastTriggerAt?: number
  lastPressDurationMs?: number
  lastAnyInputAt?: number
  lastRawButtonMask?: number
}

export type OrbitBackgroundServiceAction = 'install' | 'repair' | 'restart' | 'remove'

export interface OrbitBackgroundServiceStatus {
  startsThroughXboxMode?: boolean
  backgroundModeAvailable?: boolean
  startWithWindows?: boolean
  detail?: string
  installation: 'not-installed' | 'installed' | 'repair-needed' | 'unsupported'
  runtime: 'stopped' | 'starting' | 'running'
  hardwareControl: HardwareControlStatus
  lastActivationAt?: number
  lastActivationResult?: 'focused' | 'launched' | 'failed'
  reason?:
    | 'unsupported-platform'
    | 'unsupported-package'
    | 'login-item-disabled'
    | 'configuration-mismatch'
    | 'machine-login-item'
    | 'machine-configuration-mismatch'
    | 'agent-unreachable'
}

export interface OrbitSettings {
  attractModeEnabled?: boolean
  attractModeIdleMinutes?: number
  captureShelfEnabled?: boolean
  launchProfilesEnabled?: boolean
  /** Start Lossless Scaling with local games (Windows only). Off by default. */
  losslessScalingEnabled?: boolean
  /** Newly launched local games use Lossless Scaling unless the game says otherwise. */
  losslessScalingDefaultForGames?: boolean
  /** Close Lossless Scaling at session end when the launcher started it. */
  losslessScalingCloseOnExit?: boolean
  /** Manual LosslessScaling.exe override; only the main-process file picker may set it. */
  losslessScalingPath?: string
  backgroundModeEnabled?: boolean
  startWithWindows?: boolean
  theme: ThemeId
  /** Optional shape override. Missing legacy values retain each theme's intended form. */
  cornerStyle?: CornerStyleId
  profileAvatar: ProfileAvatarId
  homeLayout: HomeLayoutId
  gameCardSize: GameCardSize
  libraryGridColumns: LibraryGridColumns
  uninstalledGameColor: UninstalledGameColor
  /** Include Steam Family/session-shared titles in Library browsing surfaces. */
  showSteamSharedGames: boolean
  favoriteGameIds: string[]
  customLibraries: GameCollection[]
  /** Games hidden from launcher surfaces by durable `<provider>:<providerGameId>` identity. */
  excludedGameIds: string[]
  backdropIntensity: BackdropIntensity
  homeBackdropMode: HomeBackdropMode
  homeBackdropMotion: HomeBackdropMotion
  pinnedBackdropGameId?: string
  homeCardBubbleEffect: boolean
  startupAnimationMode: StartupAnimationMode
  dockTheme: DockThemeId
  dockSize: DockSize
  dockMotion: DockMotion
  uiDensity: UiDensity
  /** Global typography percentage. Missing legacy values use 100. */
  textScale?: number
  language: Language
  audioPreset: AudioPreset
  audioCuePresets: AudioCuePresets
  hasCompletedOnboarding: boolean
  storeRegion: StoreRegionId
  showStoreTab: boolean
  showFriendsHub: boolean
  showHomeBanners: boolean
  showAchievements: boolean
  backgroundTrailers: boolean
  /** Ambient music for launcher surfaces outside game-specific focus. */
  launcherMusic?: boolean
  /** Launcher ambient volume as a percentage. Missing legacy values use 10. */
  launcherMusicVolume?: number
  /** Built-in ORBIT ambience or a validated local audio copy. */
  launcherMusicSource?: import('./launcherMusic').LauncherMusicSource
  gameTitleMusic: boolean
  /** Title-music output volume as a percentage. Missing legacy values use 10. */
  gameTitleMusicVolume?: number
  /** Stable game selection time before title music starts, in seconds. */
  gameTitleMusicDelaySeconds?: number
  /** Title-music fade duration in seconds. */
  gameTitleMusicFadeSeconds?: number
  gameCardPrimaryAction: GameCardPrimaryAction
  /** Cloud launch destination. Legacy settings retain web launches. */
  geForceNowLaunchMode?: GeForceNowLaunchMode
  closeLaunchersAfterGame: boolean
  notificationsEnabled: boolean
  notificationPosition: NotificationPosition
  notificationMotion: NotificationMotion
  appUpdateAutoDownload: boolean
  /** MT3K community edition: explicit choice for automatic downloads; unset means the release manifest default. */
  appUpdateAutoDownloadCommunity?: boolean
  retroRomDirectories: string[]
  /** Explicit emulator choice per ROM system. Missing entries use automatic detection. */
  retroSystemEmulators: Partial<Record<RetroSystemId, string>>
  retroAchievementsUsername?: string
  playstationRemotePlayPreference: PlayStationRemotePlayPreference
  hardwareControlEnabled: boolean
  hardwareControlButton: HardwareControlButton
  hardwareControlHoldSeconds: HardwareControlHoldSeconds
  /** Carpeta raíz para backups de save; vacío = userData/save-backups. */
  saveBackupDirectory?: string
  /** Menú de pausa de RetroArch. Apagado: no se toca el cfg ni se abre el menú. */
  retroPauseMenuEnabled?: boolean
  /** Guest / kid mode. Off by default; only the guest-mode IPC may change these keys. */
  guestModeEnabled?: boolean
  /** scrypt hash + salt of the guest PIN. Never leaves the main process. */
  guestModePinHash?: string
  /** Library collection whose games stay visible while guest mode is active. */
  guestModeAllowedCollectionId?: string
}

export type GuestModeFailureReason =
  | 'invalid-pin'
  | 'wrong-pin'
  | 'locked-out'
  | 'no-pin'
  | 'pin-exists'
  | 'unknown-collection'

export interface GuestModeStatus {
  enabled: boolean
  hasPin: boolean
  allowedCollectionId?: string
  /** Epoch milliseconds while PIN entry is refused after repeated failures. */
  lockedUntil?: number
  attemptsLeft: number
  /** Main-owned Settings unlock; the renderer only mirrors it. */
  settingsUnlockedUntil?: number
}

export type GuestModeVerifyResult =
  | { ok: true; status: GuestModeStatus }
  | {
      ok: false
      reason: GuestModeFailureReason
      status: GuestModeStatus
    }

export type StoreLoginState = 'idle' | 'waiting-for-browser' | 'success' | 'error'

export type SteamLoginStatus =
  | { state: 'idle' }
  | { state: 'waiting-for-browser' }
  | { state: 'success'; account: SteamAccount }
  | { state: 'error'; message: string }

export interface SteamAccount {
  steamId: string
  accountName: string
  avatarUrl?: string
}

export type EpicLoginStatus =
  | { state: 'idle' }
  | { state: 'waiting-for-browser' }
  | { state: 'success'; account: EpicAccount }
  | { state: 'error'; message: string }

export interface EpicAccount {
  accountId: string
  displayName: string
}

export interface RetroAchievementsCredentialStatus {
  /** True only when the main process can decrypt a stored Web API key. */
  configured: boolean
}

export type PlayStationLoginStatus =
  | { state: 'idle' }
  | { state: 'waiting-for-browser' }
  | { state: 'success'; account: PlayStationAccount }
  | { state: 'error'; message: string }

export interface PlayStationAccount {
  accountId: string
  onlineId: string
  avatarUrl?: string
}

export interface XboxAccount {
  xuid: string
  gamertag: string
}

export interface XboxConnectionSnapshot {
  /** False until ORBIT has its own registered Microsoft public-client ID. */
  available: boolean
  account: XboxAccount | null
}

export type XboxLoginStatus =
  | { state: 'idle' }
  | { state: 'waiting-for-browser' }
  | { state: 'success'; account: XboxAccount }
  | { state: 'error'; message: string }

export const ORBIT_PLUS_FEATURES = [
  'manual-audio',
  'cloud-gaming',
  'background-motion',
  'premium-appearance',
  'next-game-picker',
  'achievement-guides'
] as const
export type OrbitPlusFeature = (typeof ORBIT_PLUS_FEATURES)[number]
export type OrbitPlusAccessSource = 'patreon' | 'annual-pass' | 'lifetime-key'
export type OrbitPlusPlan = 'monthly' | 'annual' | 'lifetime'
export type OrbitPlusAccessState = 'locked' | 'active' | 'grace'
export type OrbitPlusMembershipState = 'active' | 'grace' | 'inactive'
export type OrbitPlusCommercePlan = Extract<OrbitPlusPlan, 'annual' | 'lifetime'>
export type OrbitPlusLicenseState =
  | 'none'
  | 'active'
  | 'grace'
  | 'expired'
  | 'disabled'
  | 'verification-required'
  | 'device-removed'
export type OrbitPlusIssue =
  | 'service-not-configured'
  | 'secure-storage-unavailable'
  | 'network-unavailable'
  | 'membership-required'
  | 'owner-test-disabled'
  | 'session-expired'
  | 'verification-failed'
  | 'license-invalid'
  | 'license-test-purchase'
  | 'license-product-mismatch'
  | 'license-expired'
  | 'license-disabled'
  | 'license-activation-limit'
  | 'license-device-removed'
  | 'cancelled'

/** Public, non-secret checkout metadata. The checkout URL itself remains in
 * the main process and can only be opened through a plan-scoped IPC action. */
export interface OrbitPlusCommerceOffer {
  plan: OrbitPlusCommercePlan
  priceCents: number
  currency: 'EUR'
  billing: 'yearly' | 'one-time'
  testMode: boolean
  available: boolean
}

/** Sanitized local license state. The license key and customer metadata never
 * cross the main-process credential boundary. */
export interface OrbitPlusLicenseSnapshot {
  state: OrbitPlusLicenseState
  configured: boolean
  plan?: OrbitPlusCommercePlan
  checkedAt?: number
  expiresAt?: number
  offlineAccessUntil?: number
}

/** Provider-neutral premium access. Patreon is the first issuer; annual and
 * lifetime licenses can grant the same feature IDs without changing callers. */
export interface OrbitPlusEntitlement {
  source: OrbitPlusAccessSource
  plan: OrbitPlusPlan
  features: OrbitPlusFeature[]
  verifiedAt: number
  expiresAt?: number
  offlineUntil?: number
}

/** Authoritative, provider-neutral membership decision from the ORBIT Plus
 * service. Revisions prevent an older asynchronous response from replacing a
 * newer billing decision. */
export interface OrbitPlusMembershipDecision {
  state: OrbitPlusMembershipState
  verifiedAt: number
  revision: number
  /** End of the already paid access period. Omitted for lifetime access. */
  paidThrough?: number
  /** Last instant at which a payment or verification grace remains usable. */
  graceUntil?: number
}

/** A successful positive membership check always remains usable offline for
 * at least seven days. This is a verification window, not a cancellation
 * signal: failed retries may extend it, while only `inactive` revokes access. */
export const ORBIT_PLUS_OFFLINE_ACCESS_MINIMUM_MS = 7 * 24 * 60 * 60_000
export const ORBIT_PLUS_PATREON_REFRESH_INTERVAL_MS = 15 * 60_000
export const ORBIT_PLUS_LICENSE_REFRESH_INTERVAL_MS = 24 * 60 * 60_000

/** Focus and visibility changes may wake the scheduler, but must not by
 * themselves create billing traffic or a visible verification cycle. */
export function orbitPlusBackgroundRefreshIsDue(
  snapshot: OrbitPlusSnapshot,
  now = Date.now()
): boolean {
  const patreonDue =
    snapshot.connected &&
    (snapshot.checkedAt === undefined ||
      snapshot.checkedAt + ORBIT_PLUS_PATREON_REFRESH_INTERVAL_MS <= now)
  const licenseDue =
    snapshot.license?.configured === true &&
    (snapshot.license.checkedAt === undefined ||
      snapshot.license.checkedAt + ORBIT_PLUS_LICENSE_REFRESH_INTERVAL_MS <= now)
  return patreonDue || licenseDue
}

export function orbitPlusConfirmedOfflineAccessUntil(
  entitlement: OrbitPlusEntitlement | undefined,
  decision: OrbitPlusMembershipDecision | undefined,
  confirmedAt: number
): number | undefined {
  if (!entitlement || decision?.state === 'inactive') return undefined
  return Math.max(
    confirmedAt + ORBIT_PLUS_OFFLINE_ACCESS_MINIMUM_MS,
    entitlement.offlineUntil ?? 0,
    decision?.graceUntil ?? 0
  )
}

export function orbitPlusMembershipDecisionAccess(
  decision: OrbitPlusMembershipDecision,
  entitlement: OrbitPlusEntitlement | undefined,
  now = Date.now(),
  offlineAccessUntil?: number
): { access: OrbitPlusAccessState; accessUntil?: number } {
  if (decision.state === 'inactive' || !entitlement) return { access: 'locked' }
  const permanent = entitlement.plan === 'lifetime' && decision.paidThrough === undefined
  const paidThrough = permanent ? Infinity : decision.paidThrough ?? 0
  const graceUntil = permanent
    ? Infinity
    : Math.max(decision.graceUntil ?? paidThrough, offlineAccessUntil ?? 0)
  if (decision.state === 'grace' || paidThrough < now) {
    return graceUntil >= now
      ? { access: 'grace', accessUntil: Number.isFinite(graceUntil) ? graceUntil : undefined }
      : { access: 'locked' }
  }
  return {
    access: 'active',
    accessUntil: Number.isFinite(paidThrough) ? paidThrough : undefined
  }
}

export interface OrbitPlusOwnerTestAccess {
  available: true
  enabled: boolean
}

/** Sanitized ORBIT Plus state. Provider IDs, OAuth codes and session tokens
 * stay in the main-process credential boundary. */
export interface OrbitPlusSnapshot {
  access: OrbitPlusAccessState
  /** Main-process deadline covering verification freshness and offline grace. */
  accessUntil?: number
  /** Local minimum window retained after the last confirmed positive decision. */
  offlineAccessUntil?: number
  connected: boolean
  serviceAvailable: boolean
  secureStorageAvailable: boolean
  purchaseUrl: string
  offers?: OrbitPlusCommerceOffer[]
  license?: OrbitPlusLicenseSnapshot
  /** Every independently verified grant currently keeping Plus available. */
  activeSources?: OrbitPlusAccessSource[]
  accountName?: string
  entitlement?: OrbitPlusEntitlement
  membership?: OrbitPlusMembershipDecision
  ownerTestAccess?: OrbitPlusOwnerTestAccess
  checkedAt?: number
  issue?: OrbitPlusIssue
  /** Community build: every feature is included locally, with no membership or license. */
  communityEdition?: boolean
}

export type OrbitPlusConnectionStatus =
  | { state: 'idle'; snapshot: OrbitPlusSnapshot }
  | { state: 'opening-browser'; snapshot: OrbitPlusSnapshot }
  | { state: 'waiting-for-browser'; snapshot: OrbitPlusSnapshot }
  | { state: 'verifying'; snapshot: OrbitPlusSnapshot }
  | { state: 'success'; snapshot: OrbitPlusSnapshot }
  | { state: 'error'; snapshot: OrbitPlusSnapshot; issue: OrbitPlusIssue }

export function orbitPlusHasFeature(
  snapshot: OrbitPlusSnapshot,
  feature: OrbitPlusFeature,
  now = Date.now()
): boolean {
  const resolvedAccess = snapshot.membership
    ? orbitPlusMembershipDecisionAccess(
        snapshot.membership,
        snapshot.entitlement,
        now,
        snapshot.offlineAccessUntil
      )
    : { access: snapshot.access, accessUntil: snapshot.accessUntil }
  return (
    (resolvedAccess.access === 'active' || resolvedAccess.access === 'grace') &&
    snapshot.ownerTestAccess?.enabled !== false &&
    (resolvedAccess.accessUntil === undefined || resolvedAccess.accessUntil >= now) &&
    Boolean(snapshot.entitlement?.features.includes(feature))
  )
}

/** Path-free local Remote Play discovery state. Executable paths never cross
 * the Electron process boundary. */
export interface PlayStationRemotePlayStatus {
  platform: 'windows' | 'unsupported'
  apps: Array<{
    id: PlayStationRemotePlayAppId
    name: string
    installed: boolean
  }>
  preference: PlayStationRemotePlayPreference
  selectedApp?: PlayStationRemotePlayAppId
  checkedAt: number
}

export const FRIENDS_PROVIDERS = ['steam', 'discord', 'epic', 'xbox'] as const
export type FriendsProvider = (typeof FRIENDS_PROVIDERS)[number]
export type FriendPresence = 'online' | 'away' | 'busy' | 'offline' | 'unknown'
export type FriendsProviderState =
  | 'ready'
  | 'not-connected'
  | 'setup-required'
  | 'connecting'
  | 'external'
  | 'error'
export type FriendsProviderIssue =
  | 'api-key-required'
  | 'api-key-invalid'
  | 'private-profile'
  | 'provider-unavailable'
  | 'authentication-failed'
  | 'sdk-unavailable'
  | 'integration-required'

/** Provider-neutral social identity. Provider credentials and raw responses
 * remain in the main process and never cross this contract. */
export interface OrbitFriend {
  id: string
  provider: FriendsProvider
  providerUserId: string
  displayName: string
  avatarUrl?: string
  profileUrl?: string
  presence: FriendPresence
  activity?: string
  lastSeenAt?: number
}

export interface FriendsProviderStatus {
  provider: FriendsProvider
  state: FriendsProviderState
  friendCount: number
  onlineCount: number
  updatedAt?: number
  accountName?: string
  issue?: FriendsProviderIssue
}

export interface FriendsSnapshot {
  friends: OrbitFriend[]
  providers: Record<FriendsProvider, FriendsProviderStatus>
  updatedAt: number
  isRefreshing: boolean
}

export type DiscordChatIssue =
  | 'not-connected'
  | 'history-unavailable'
  | 'send-failed'
  | 'provider-unavailable'

export interface DiscordChatMessage {
  id: string
  userId: string
  content: string
  sentAt: number
  editedAt?: number
  direction: 'incoming' | 'outgoing'
  unsupportedContent: boolean
}

export interface DiscordChatHistory {
  state: 'ready' | 'unavailable'
  userId: string
  messages: DiscordChatMessage[]
  issue?: DiscordChatIssue
}

export interface DiscordChatConversation {
  userId: string
  lastMessageId: string
  lastMessage?: DiscordChatMessage
}

export interface DiscordChatInbox {
  state: 'ready' | 'unavailable'
  conversations: DiscordChatConversation[]
  issue?: DiscordChatIssue
}

export interface DiscordChatSendResult {
  ok: boolean
  message?: DiscordChatMessage
  issue?: DiscordChatIssue
}

export type DiscordChatEvent =
  | { kind: 'created' | 'updated'; message: DiscordChatMessage }
  | { kind: 'deleted'; messageId: string }

export type DiscordServerIssue = 'not-connected' | 'provider-unavailable'

/** A minimal Discord guild record. The Social SDK intentionally exposes no
 * server icon in this discovery response, so ORBIT keeps this contract small. */
export interface DiscordServer {
  id: string
  name: string
}

export interface SteamWebApiCredentialStatus {
  /** True only when the main process can decrypt the stored Steam Web API key. */
  configured: boolean
}

export interface DiscordServerList {
  state: 'ready' | 'unavailable'
  servers: DiscordServer[]
  issue?: DiscordServerIssue
}

export type GameProvider =
  | 'steam'
  | 'epic'
  | 'gog'
  | 'xbox'
  | 'playstation'
  | 'retro'
  | 'ea'
  | 'ubisoft'
  | 'local'

/** How the current account can access a provider library title. */
export type LibraryAccessKind = 'owned' | 'shared'

export type LauncherDownloadProvider = Extract<GameProvider, 'steam' | 'epic' | 'xbox'>
export type LauncherDownloadPhase =
  | 'downloading'
  | 'updating'
  | 'installing'
  | 'verifying'
  | 'paused'
  | 'completed'
  | 'error'
export type LauncherDownloadConfidence = 'exact' | 'approximate' | 'heuristic'
export type LauncherDownloadControlAction = 'pause' | 'resume' | 'cancel' | 'open-provider'
export type LauncherDownloadControlState = 'accepted' | 'provider-opened' | 'unsupported'

export interface LauncherDownloadControlResult {
  state: LauncherDownloadControlState
}

/** Ephemeral, path-free activity reported by a locally installed launcher. */
export interface LauncherDownloadActivity {
  id: string
  provider: LauncherDownloadProvider
  providerGameId: string
  gameId?: string
  title: string
  phase: LauncherDownloadPhase
  confidence: LauncherDownloadConfidence
  /** Normalized 0..1 progress. Omitted when the launcher exposes no reliable total. */
  progress?: number
  bytesDownloaded?: number
  bytesTotal?: number
  bytesPerSecond?: number
  etaSeconds?: number
  updatedAt: number
}

export interface LauncherDownloadSnapshot {
  revision: number
  /** Most recent completed provider-monitor pass or provider event. */
  checkedAt: number
  /** Most recent user-visible activity change. */
  updatedAt: number
  activities: LauncherDownloadActivity[]
}

export type GamePlatform = 'windows' | 'macos' | 'linux'

export interface GameSystemRequirements {
  minimum?: string
  recommended?: string
}

/** Ordered, provider-supplied artwork candidates. The shared image pipeline
 * validates dimensions, caches the best file and falls back independently. */
export interface GameArtworkCandidates {
  vertical?: string[]
  horizontal?: string[]
  icon?: string[]
  /** Transparent or tightly cropped game wordmark/title treatment. */
  logo?: string[]
}

export interface GameCompletionTimes {
  state: 'available' | 'unavailable'
  provider: 'howlongtobeat'
  mainStoryMinutes?: number
  mainExtraMinutes?: number
  completionistMinutes?: number
  allStylesMinutes?: number
  sourceGameId?: number
  sourceTitle?: string
  sourceUrl?: string
  confidence?: number
  /** Cleaned name sent to the provider (see completionTimesQuery); lets a stale negative answer expire when the query changes. */
  query?: string
  fetchedAt: number
}

/** License/entitlement evidence that ORBIT can present without inferring
 * ownership from a locally installed package. */
export type GameEntitlementKind = 'purchased' | 'subscription' | 'unknown'
export type GameSubscription = 'xbox-game-pass'
export type GameEntitlementEvidence = 'account-library' | 'local-cache' | 'local-install'

export interface GameEntitlement {
  kind: GameEntitlementKind
  subscription?: GameSubscription
  evidence: GameEntitlementEvidence
  /** When ORBIT first observed the current subscription-catalog membership.
   * This is intentionally not presented as Microsoft's original release date. */
  membershipDetectedAt?: number
}

export interface GameAchievement {
  id: string
  name: string
  description?: string
  iconUrl?: string
  lockedIconUrl?: string
  unlocked: boolean
  unlockedAt?: number
  progress?: number
  hidden?: boolean
}

export interface GameAchievementsSnapshot {
  language?: Language
  gameId: string
  provider: GameProvider
  state: 'available' | 'unavailable'
  achievements: GameAchievement[]
  unlocked: number
  total: number
  fetchedAt: number
  reason?: 'private' | 'unsupported' | 'unavailable' | 'not-connected'
  source?: 'steam-community' | 'steam-web-api' | 'retroachievements' | 'xbox-network'
}

/** Rich, provider-neutral metadata persisted with each library record. */
export interface GameMetadata {
  iconUrl?: string
  summary?: string
  description?: string
  genres?: string[]
  features?: string[]
  developers?: string[]
  publishers?: string[]
  releaseDateText?: string
  comingSoon?: boolean
  criticScore?: number
  recommendationCount?: number
  requiredAge?: number
  website?: string
  storeUrl?: string
  /** Optional user-selected trailer. Direct video/HLS links play in ORBIT;
   * ordinary HTTPS pages open in the system browser. */
  trailerUrl?: string
  /** Optional YouTube track used instead of ORBIT's automatic title-music search. */
  titleMusicUrl?: string
  /** Optional external achievement guide or provider achievement page. */
  achievementsUrl?: string
  /** Validated provider launch target, such as a Windows AppsFolder AUMID. */
  launchUri?: string
  /** Validated provider executable used for direct launch and process identification. */
  launchExecutable?: string
  /** Provider-supplied argv parsed and validated in the main process. */
  launchArguments?: string[]
  /** Store catalog identity when it differs from the durable provider game identity. */
  providerStoreId?: string
  /** Provider-native title identity used by account services such as Xbox achievements. */
  providerTitleId?: string
  /** Validated Windows package family used to reconcile launcher and network identities. */
  providerPackageFamilyName?: string
  /** Provider-neutral access classification backed by an explicit local or
   * account signal. An installed package alone never becomes a purchase. */
  entitlement?: GameEntitlement
  languages?: string[]
  controllerSupport?: string
  platforms?: GamePlatform[]
  achievementCount?: number
  contentDescriptorNotes?: string
  systemRequirements?: GameSystemRequirements
  backgroundUrl?: string
  storeHeaderUrl?: string
  artwork?: GameArtworkCandidates
  completionTimes?: GameCompletionTimes
}

/** Metadata fields a user may safely override without changing provider
 * identity, installation evidence or launch configuration. `null` deliberately
 * hides a provider value; an absent key keeps the provider value. */
export const EDITABLE_GAME_METADATA_KEYS = [
  'summary',
  'description',
  'genres',
  'features',
  'developers',
  'publishers',
  'releaseDateText',
  'comingSoon',
  'criticScore',
  'recommendationCount',
  'requiredAge',
  'website',
  'storeUrl',
  'trailerUrl',
  'titleMusicUrl',
  'achievementsUrl',
  'languages',
  'controllerSupport',
  'platforms',
  'achievementCount',
  'contentDescriptorNotes',
  'systemRequirements',
  'completionTimes'
] as const satisfies readonly (keyof GameMetadata)[]

export type EditableGameMetadataKey = (typeof EDITABLE_GAME_METADATA_KEYS)[number]
export type GameMetadataOverrides = Partial<{
  [Key in EditableGameMetadataKey]: GameMetadata[Key] | null
}>

export interface GameMetadataUpdateInput {
  gameId: string
  /** Omit to keep the current manual title; null restores the provider title. */
  name?: string | null
  /** Patch semantics: omitted fields keep their current override. */
  metadata?: GameMetadataOverrides
  /** Restores every provider value before applying this payload's patches. */
  resetAll?: boolean
}

export interface GameMetadataSyncResult {
  snapshot: LibrarySnapshot
  synchronizedAt: number
  stages: {
    library: 'complete' | 'failed' | 'skipped'
    metadata: 'complete' | 'failed' | 'skipped'
    artwork: 'queued'
    completionTimes: 'complete' | 'failed' | 'skipped'
    achievements: 'complete' | 'failed' | 'skipped'
  }
}

export type LocalGameBackupState = 'never' | 'success' | 'failed'

export interface LocalGameConfig {
  executablePath: string
  /** Parsed argv passed directly to the executable without a command shell. */
  launchArguments?: string[]
  savePath?: string
  backupEnabled: boolean
  lastBackupAt?: number
  lastBackupState?: LocalGameBackupState
}

export type RetroSystemId =
  | 'nes'
  | 'fds'
  | 'snes'
  | 'gb'
  | 'gbc'
  | 'gba'
  | 'n64'
  | 'nds'
  | 'gamecube'
  | 'wii'
  | 'wiiu'
  | 'megadrive'
  | 'mastersystem'
  | 'gamegear'
  | 'sega32x'
  | 'segacd'
  | 'saturn'
  | 'dreamcast'
  | 'ps1'
  | 'ps2'
  | 'ps3'
  | 'psp'
  | 'xbox360'
  | 'atari2600'
  | 'atari7800'
  | 'atarilynx'
  | 'pce'
  | 'wonderswan'
  | 'wonderswancolor'
  | 'ngp'
  | 'ngpc'
  | 'virtualboy'
  | 'colecovision'
  | 'arcade'

export type RetroAchievementMatch =
  | 'matched'
  | 'unmatched'
  | 'unavailable'
  | 'not-configured'
  | 'unsupported'

export interface RetroGameConfig {
  romPath: string
  sourceDirectory: string
  systemId: RetroSystemId
  systemName: string
  emulatorId?: string
  emulatorName?: string
  emulatorPath?: string
  corePath?: string
  /** Complete per-game argv override. ORBIT still enforces the emulator's fullscreen contract. */
  launchArguments?: string[]
  retroAchievementsHash?: string
  retroAchievementsGameId?: number
  retroAchievementsMatch: RetroAchievementMatch
}

export interface DetectedRetroEmulator {
  id: string
  name: string
  kind: 'retroarch' | 'standalone'
  supportedSystems: RetroSystemId[]
  readySystems: RetroSystemId[]
  achievementsSupported: boolean
  coreCount?: number
}

export interface RetroRomDirectoryStatus {
  path: string
  state: 'ready' | 'missing' | 'error'
  gameCount: number
  issue?: 'scan-failed' | 'scan-limit-reached'
}

export interface RetroLibraryStatus {
  state: 'idle' | 'scanning' | 'ready' | 'partial' | 'error'
  emulators: DetectedRetroEmulator[]
  directories: RetroRomDirectoryStatus[]
  gameCount: number
  matchedAchievementsCount: number
  scannedAt?: number
}

export interface RetroLibraryResult {
  snapshot: LibrarySnapshot
  status: RetroLibraryStatus
}

export interface RetroEmulatorDownloadInput {
  systemId: RetroSystemId
  /** Omit to open ORBIT's recommended emulator page for the system. */
  emulatorId?: string
}

export interface RetroEmulatorDownloadResult {
  systemId: RetroSystemId
  emulatorId: string
  emulatorName: string
  directoryPath: string
  emulatorDirectoryPath: string
  firmwareMayBeRequired: boolean
}

export interface RetroEmulatorInstallInput {
  systemId: RetroSystemId
  /** Omit to install ORBIT's recommended emulator for the system. */
  emulatorId?: string
}

export type RetroEmulatorInstallPhase =
  | 'checking'
  | 'resolving'
  | 'downloading'
  | 'extracting'
  | 'installing-core'
  | 'verifying'
  | 'complete'

export interface RetroEmulatorInstallProgress {
  systemId: RetroSystemId
  emulatorId: string
  emulatorName: string
  phase: RetroEmulatorInstallPhase
  receivedBytes?: number
  totalBytes?: number
}

export interface RetroEmulatorInstallResult extends RetroLibraryResult {
  systemId: RetroSystemId
  emulatorId: string
  emulatorName: string
  directoryPath: string
  emulatorDirectoryPath: string
  alreadyInstalled: boolean
  emulatorInstalled: boolean
  coreInstalled: boolean
  firmwareMayBeRequired: boolean
}

export interface RetroSystemDirectoryResult {
  systemId: RetroSystemId
  directoryPath: string
  created: boolean
}

export type CustomGameImportSource = 'executable' | 'folder'
export type CustomGameSaveSource = 'file' | 'folder'

export interface CustomGameDraft {
  id: string
  name: string
  executablePath: string
  installDir: string
  iconPreviewUrl?: string
  artworkPreviewUrl?: string
  savePath?: string
}

export interface CustomGameCommitInput {
  draftId: string
  name: string
  /** User-facing Windows argument string; parsed and validated in the main process. */
  launchArguments?: string
}

export interface CustomGameLaunchArgumentsInput {
  gameId: string
  /** User-facing Windows argument string; parsed and validated in the main process. */
  launchArguments?: string
}

export interface LocalGameBackupResult {
  state: 'success' | 'failed' | 'skipped'
  completedAt: number
  backupPath?: string
}

export interface LocalGameBackupEntry {
  id: string
  createdAt: number
  fileCount: number
  totalBytes: number
}

export type LocalGameRestoreFailureReason =
  | 'restore-in-progress'
  | 'game-running'
  | 'invalid-game'
  | 'invalid-backup'
  | 'safety-backup-failed'
  | 'restore-failed'
  | 'rollback-failed'

export interface LocalGameRestoreResult {
  state: 'success' | 'cleanup-failed' | 'failed'
  completedAt: number
  safetyBackupId?: string
  reason?: LocalGameRestoreFailureReason
}

export interface SaveBackupDirectoryStatus {
  configuredPath?: string
  effectivePath: string
  isDefault: boolean
}

/**
 * Provider-neutral library record. `id` is the durable identity used by ORBIT's
 * database (`<provider>:<providerGameId>`); `appId` remains Steam-specific data
 * and must never be used as a cross-provider key.
 */
export interface LibraryGame {
  id: string
  provider: GameProvider
  providerGameId: string
  appId?: number
  name: string
  metadata: GameMetadata
  /** Present when the displayed title is protected from provider refreshes. */
  nameOverride?: string
  /** Persisted manual values layered over provider metadata. */
  metadataOverrides?: GameMetadataOverrides
  metadataRevision: number
  metadataUpdatedAt?: number
  metadataLocale?: string
  metadataSource?: string
  /** Canonical playtime with second precision. Provider time is preferred when available. */
  playtimeSeconds?: number
  /** Compatibility/aggregate value derived from `playtimeSeconds`. */
  playtimeMinutes?: number
  lastPlayedTimestamp?: number
  lastStartedAt?: number
  /** Separate Home continuation history; canonical game identity and playtime stay shared. */
  lastLocalStartedAt?: number
  lastGeForceNowStartedAt?: number
  installed: boolean
  installDir?: string
  /** `shared` covers Steam Family and other licenses exposed only by the active Steam session. */
  libraryAccess?: LibraryAccessKind
  /** Locally detected provider update that has not finished downloading yet. */
  updateAvailable?: boolean
  local?: LocalGameConfig
  retro?: RetroGameConfig
  addedAt: number
  updatedAt: number
}

export type GeForceNowCatalogState = 'locked' | 'loading' | 'ready' | 'stale' | 'error'
export type GeForceNowLaunchMode = 'web' | 'native'

/** Exact store-identity match between one ORBIT title and NVIDIA's regional catalog. */
export interface GeForceNowLibraryMatch {
  gameId: string
  geforceNowGameId: string
  geforceNowTitle: string
  cmsId: number
  variantId: string
  shortName?: string
  appStore: string
  storeId: string
  boxArtUrl?: string
  playabilityState?: string
}

export interface GeForceNowCatalogSnapshot {
  state: GeForceNowCatalogState
  matches: GeForceNowLibraryMatch[]
  catalogSize: number
  region: 'DE' | 'US' | 'ES'
  updatedAt?: number
  issue?: 'catalog-unavailable'
}

export type LibraryStatusProvider =
  | 'steam'
  | 'epic'
  | 'gog'
  | 'xbox'
  | 'playstation'
  | 'retro'
  | 'ea'
  | 'ubisoft'
export type LibraryProviderState =
  | 'idle'
  | 'scanning'
  | 'ready'
  | 'partial'
  | 'local-only'
  | 'error'
export type LibraryProviderConnection = 'connected' | 'not-connected' | 'automatic'
export type LibraryDetectionMethod =
  | 'local-manifests'
  | 'account-api'
  | 'community-profile'
  | 'launcher-session'
  | 'epic-catalog'
  | 'xbox-app-cache'
  | 'xbox-display-catalog'
  | 'windows-packages'
  | 'psn-purchased-library'
  | 'psn-play-history'
  | 'remote-play-apps'
  | 'windows-registry'
  | 'launcher-cache'
  | 'rom-folders'
  | 'emulator-installations'
  | 'retroachievements-hash'
  | 'cached-data'
export type LibraryProviderIssue =
  | 'not-connected'
  | 'online-library-unavailable'
  | 'metadata-pending'
  | 'source-unavailable'
  | 'supplemental-source-unavailable'
  | 'local-source-unavailable'
  | 'authentication-failed'
  | 'remote-play-app-unavailable'
  | 'emulator-missing'
  | 'rom-source-unavailable'
  | 'no-games-found'

export interface LibraryProviderStatus {
  provider: LibraryStatusProvider
  state: LibraryProviderState
  connection: LibraryProviderConnection
  methods: LibraryDetectionMethod[]
  gameCount: number
  installedCount: number
  installableCount: number
  pendingCount?: number
  /** Sanitized active products and entitlement counts; no account IDs or raw
   * provider product identifiers cross the process boundary. */
  subscriptions?: GameSubscription[]
  entitlementCounts?: Partial<Record<GameEntitlementKind, number>>
  issue?: LibraryProviderIssue
  lastCheckedAt?: number
}

/** A completed game session observed by ORBIT itself. */
export interface LibrarySessionRecord {
  id: string
  gameId: string
  startedAt: number
  endedAt: number
  durationSeconds: number
}

export interface LibraryActivityWindow {
  playtimeSeconds: number
  sessionCount: number
}

export interface LibraryActivitySummary {
  /** Best installed continuation target: ORBIT session first, provider activity second. */
  continueGameId?: string
  lastSession?: LibrarySessionRecord
  sevenDays: LibraryActivityWindow
  thirtyDays: LibraryActivityWindow
  recordedSessionCount: number
}

export interface LibrarySnapshot {
  /** User-facing game projection after provider-local cleanup and visibility policy. */
  games: LibraryGame[]
  /** Provider-filterable projection; durable identities remain in the main-process database. */
  providerGames: LibraryGame[]
  /** Excluded records remain available only to Settings so the choice is reversible. */
  excludedGames: LibraryGame[]
  recentGameIds: string[]
  loadedAt: number
  isLoadingMetadata: boolean
  /** Rolling local activity. Provider totals remain authoritative for lifetime playtime. */
  activity?: LibraryActivitySummary
  /** Safe, user-facing provider diagnostics; no tokens, paths or account IDs. */
  providerStatuses?: LibraryProviderStatus[]
}

export interface LibraryStats {
  gameCount: number
  installedCount: number
  totalPlaytimeMinutes: number
  mostPlayedGameName?: string
  mostPlayedMinutes?: number
  achievementsUnlocked: number
  achievementsTotal: number
}

export type GameLaunchPhase = 'idle' | 'launching' | 'running' | 'returning' | 'error'
export const GAME_LAUNCH_CANCEL_WINDOW_MS = 3_000
export const GAME_TRACKING_STOP_HOLD_MS = 3_000

export type GameLaunchFailureReason =
  | 'restore-in-progress'
  | 'launch-rejected'
  | 'not-started'
  | 'startup-ended'
  | 'monitor-unavailable'

export interface GameLaunchStatus {
  phase: GameLaunchPhase
  gameId?: string
  gameName?: string
  provider?: GameProvider
  requestedAt?: number
  cancelableUntil?: number
  startedAt?: number
  detectedAt?: number
  endedAt?: number
  sessionDurationSeconds?: number
  totalPlaytimeSeconds?: number
  /** Provider-specific identity that confirmed this session. */
  trackingMethod?: import('./gameTracking').GameTrackingMethod
  /** Zero is the provider's primary method; larger values are ordered fallbacks. */
  trackingFallbackIndex?: number
  returnTask?: 'backing-up' | 'backup-complete' | 'backup-failed' | 'tracking-stopped'
  failureReason?: GameLaunchFailureReason
  message?: string
  /** True only while a confirmed RetroArch session is running. Standalone emulators stay false. */
  retroArchSession?: boolean
}

export type StoreOfferSource = 'steam' | 'epic' | 'gog' | 'xbox' | 'instant-gaming'
export type StoreOfferKind = 'official' | 'keyshop' | 'search'

export interface StoreOffer {
  id: string
  source: StoreOfferSource
  sourceLabel: string
  kind: StoreOfferKind
  url: string
  available: boolean
  exactMatch: boolean
  priceMinor?: number
  originalPriceMinor?: number
  currency?: string
  formattedPrice?: string
  discountPercent?: number
  checkedAt: number
  platform?: 'pc' | 'xbox'
}

export interface StoreProduct {
  id: string
  steamAppId?: number
  canonicalSource?: StoreOfferSource
  sourceProductId?: string
  name: string
  summary?: string
  genres?: string[]
  developers?: string[]
  publishers?: string[]
  metadataLocale?: string
  supportedLanguages?: string[]
  discoverEligible?: boolean
  artworkStatus?: 'available' | 'missing' | 'pending'
  searchOnly?: boolean
  releaseDateText?: string
  headerUrl?: string
  heroUrl?: string
  portraitUrl?: string
  steamWishlisted: boolean
  orbitWishlisted: boolean
  steamWishlistAddedAt?: number
  offers: StoreOffer[]
  bestOffer?: StoreOffer
  recommendationScore: number
  recommendationReason?: string
  detailsUpdatedAt?: number
  priceUpdatedAt?: number
  providerPricesUpdatedAt?: number
  providerPipelineVersion?: number
  updatedAt: number
}

export interface StoreRelease {
  id: string
  source: StoreOfferSource
  sourceProductId: string
  steamAppId?: number
  name: string
  releaseDate: number
  capsuleUrl: string
  heroUrl?: string
  storeUrl: string
  featured: boolean
  orbitWishlisted: boolean
}

export interface StorePricePoint {
  priceMinor: number
  currency: string
  source: StoreOfferSource
  recordedAt: number
}

export interface StorePriceAlert {
  id: string
  productId: string
  region: StoreRegionId
  targetPriceMinor: number
  currency: string
  startPriceMinor?: number
  currentPriceMinor?: number
  createdAt: number
  triggeredAt?: number
  enabled: boolean
}

export interface StoreSnapshot {
  products: StoreProduct[]
  monthlyReleases: StoreRelease[]
  releaseCalendarMonth?: string
  releaseCalendarUpdatedAt?: number
  releaseCalendarError: boolean
  catalogError: boolean
  region: StoreRegionId
  updatedAt: number
  lastSuccessfulRefreshAt?: number
  isRefreshing: boolean
  changedSinceLastRefresh: number
  priceHistory: Record<string, StorePricePoint[]>
  priceAlerts: StorePriceAlert[]
}

export interface StoreSearchResponse {
  query: string
  products: StoreProduct[]
}

export type ImageOrientation = 'vertical' | 'horizontal' | 'icon' | 'logo'

export interface ResolvedImage {
  url: string
  contain: boolean
  revision: number
}

export interface ImageUpdate {
  gameId: string
  orientation: ImageOrientation
  image: ResolvedImage | null
}

export interface SteamGridDbArtworkOption {
  id: number
  previewUrl: string
  width?: number
  height?: number
  authorName?: string
}

export type SteamGridDbTokenState =
  | 'not-configured'
  | 'valid'
  | 'expired'
  | 'invalid'
  | 'unavailable'

/** Credential metadata only. The SteamGridDB token itself stays out of this
 * dedicated status contract. */
export interface SteamGridDbTokenStatus {
  state: SteamGridDbTokenState
  checkedAt?: number
  expiresAt?: number
}

export interface ArtworkMaintenanceResult {
  clearedEntries: number
  clearedFiles: number
  freedBytes: number
  queuedAssets: number
}

export type ArtworkSearchSource = 'steam-store' | 'steamgriddb'

export interface ArtworkSearchOption {
  /** Opaque, server-validated candidate identity. Never a renderer-supplied URL. */
  id: string
  previewUrl: string
  source: ArtworkSearchSource
  sourceTitle?: string
  width?: number
  height?: number
  authorName?: string
}

export interface RetroGameLaunchArgumentsInput {
  gameId: string
  /** User-facing Windows argument string; parsed and validated in the main process. */
  launchArguments?: string
}

export interface ArtworkSearchOptions {
  state: 'ready' | 'missing' | 'unavailable'
  options: ArtworkSearchOption[]
}

export type SyncPipelineId = 'library' | 'metadata' | 'artwork' | 'achievements' | 'store'
export type SyncPipelineState = 'idle' | 'running' | 'complete' | 'error'

export interface SyncPipelineProgress {
  id: SyncPipelineId
  state: SyncPipelineState
  completed: number
  total: number
  detail?: string
  updatedAt: number
}

export interface SystemSyncStatus {
  startedAt?: number
  updatedAt: number
  pipelines: Record<SyncPipelineId, SyncPipelineProgress>
}

export const IPC = {
  displayListModes: "display:listModes",
  launchProfilesGet: "launchProfiles:get",
  launchProfilesSave: "launchProfiles:save",
  launchProfilesConfirm: "launchProfiles:confirm",
  launchProfilesRevert: "launchProfiles:revert",
  launchProfilesPending: "launchProfiles:pending",
  launchProfilesDiscard: "launchProfiles:discard",
  launchProfilesEvent: "launchProfiles:event",
  losslessScalingStatus: 'losslessScaling:status',
  losslessScalingChoosePath: 'losslessScaling:choose-path',
  losslessScalingClearPath: 'losslessScaling:clear-path',
  losslessScalingGameGet: 'losslessScaling:game:get',
  losslessScalingGameSet: 'losslessScaling:game:set',
  losslessScalingEvent: 'losslessScaling:event',
  launchProfilesError: "launchProfiles:error",
  steamLoginStart: 'steam:login:start',
  steamLoginCancel: 'steam:login:cancel',
  steamLoginStatus: 'steam:login:status',
  steamAccountUpdated: 'steam:account:updated',
  steamLogout: 'steam:logout',
  steamGetAccount: 'steam:get-account',
  epicLoginStart: 'epic:login:start',
  epicLoginCancel: 'epic:login:cancel',
  epicLoginStatus: 'epic:login:status',
  epicLogout: 'epic:logout',
  epicGetAccount: 'epic:get-account',
  playstationLoginStart: 'playstation:login:start',
  playstationLoginCancel: 'playstation:login:cancel',
  playstationLoginStatus: 'playstation:login:status',
  playstationLogout: 'playstation:logout',
  playstationGetAccount: 'playstation:get-account',
  playstationRemotePlayGet: 'playstation:remote-play:get',
  playstationRemotePlayRefresh: 'playstation:remote-play:refresh',
  xboxLoginStart: 'xbox:login:start',
  xboxLoginCancel: 'xbox:login:cancel',
  xboxLoginStatus: 'xbox:login:status',
  xboxLogout: 'xbox:logout',
  xboxGetConnection: 'xbox:get-connection',
  orbitPlusGet: 'orbit-plus:get',
  orbitPlusRefresh: 'orbit-plus:refresh',
  orbitPlusPatreonConnect: 'orbit-plus:patreon:connect',
  orbitPlusPatreonCancel: 'orbit-plus:patreon:cancel',
  orbitPlusCheckoutOpen: 'orbit-plus:checkout:open',
  orbitPlusLicenseActivate: 'orbit-plus:license:activate',
  orbitPlusLicenseDeactivate: 'orbit-plus:license:deactivate',
  orbitPlusOwnerTestSet: 'orbit-plus:owner-test:set',
  orbitPlusDisconnect: 'orbit-plus:disconnect',
  orbitPlusStatus: 'orbit-plus:status',
  friendsGet: 'friends:get',
  friendsRefresh: 'friends:refresh',
  friendsConnect: 'friends:provider:connect',
  friendsDisconnect: 'friends:provider:disconnect',
  friendsUpdated: 'friends:updated',
  friendsOpenProvider: 'friends:provider:open',
  discordChatInbox: 'friends:discord-chat:inbox',
  discordChatHistory: 'friends:discord-chat:history',
  discordChatSend: 'friends:discord-chat:send',
  discordChatSetVisible: 'friends:discord-chat:set-visible',
  discordChatMessage: 'friends:discord-chat:message',
  discordServersList: 'friends:discord-servers:list',
  discordServerOpen: 'friends:discord-server:open',
  libraryGet: 'library:get',
  libraryStatsGet: 'library:stats:get',
  libraryStartupRefresh: 'library:refresh:startup',
  libraryRefresh: 'library:refresh',
  libraryUpdated: 'library:updated',
  libraryGameExclude: 'library:game:exclude',
  libraryGameRestore: 'library:game:restore',
  libraryGameMetadataUpdate: 'library:game:metadata:update',
  libraryGameMetadataSync: 'library:game:metadata:sync',
  libraryGameMetadataMediaSearch: 'library:game:metadata:media-search',
  libraryGameMetadataMediaPaste: 'library:game:metadata:media-paste',
  libraryGameMetadataStoreSearch: 'library:game:metadata:store-search',
  libraryGameMetadataStoreLookup: 'library:game:metadata:store-lookup',
  geforceNowCatalogGet: 'geforce-now:catalog:get',
  geforceNowCatalogRefresh: 'geforce-now:catalog:refresh',
  geforceNowCatalogUpdated: 'geforce-now:catalog:updated',
  geforceNowGameLaunch: 'geforce-now:game:launch',
  geforceNowNativeAvailable: 'geforce-now:native:available',
  geforceNowOpenBrowser: 'geforce-now:browser:open',
  launcherDownloadsGet: 'launcher-downloads:get',
  launcherDownloadsControl: 'launcher-downloads:control',
  launcherDownloadsUpdated: 'launcher-downloads:updated',
  customGameBeginImport: 'library:custom:import:begin',
  customGameSelectArtwork: 'library:custom:artwork:select',
  customGameSelectSave: 'library:custom:save:select',
  customGameClearSave: 'library:custom:save:clear',
  customGameCommit: 'library:custom:commit',
  customGameSetLaunchArguments: 'library:custom:launch-arguments:set',
  customGameCancel: 'library:custom:cancel',
  customGameRemove: 'library:custom:remove',
  customGameBackup: 'library:custom:backup',
  customGameOpenBackups: 'library:custom:backups:open',
  customGameListBackups: 'library:custom:backups:list',
  customGameRestoreBackup: 'library:custom:backup:restore',
  settingsSaveBackupDirectoryGet: 'settings:save-backup-directory:get',
  settingsSaveBackupDirectoryChoose: 'settings:save-backup-directory:choose',
  settingsSaveBackupDirectoryUseDefault: 'settings:save-backup-directory:use-default',
  retroLibraryStatusGet: 'library:retro:status:get',
  retroLibraryRefresh: 'library:retro:refresh',
  retroLibraryDirectoryAdd: 'library:retro:directory:add',
  retroLibraryDirectoryRemove: 'library:retro:directory:remove',
  retroSystemDirectoryEnsure: 'library:retro:system-directory:ensure',
  retroSystemDirectoryOpen: 'library:retro:system-directory:open',
  retroEmulatorDownloadOpen: 'library:retro:emulator-download:open',
  retroEmulatorInstall: 'library:retro:emulator:install',
  retroEmulatorInstallCancel: 'library:retro:emulator:install:cancel',
  retroEmulatorInstallProgress: 'library:retro:emulator:install-progress',
  retroGameSetLaunchArguments: 'library:retro:launch-arguments:set',
  gameLaunch: 'game:launch',
  gameInstall: 'game:install',
  gameUninstall: 'game:uninstall',
  gameLaunchCancel: 'game:launch:cancel',
  gameTrackingStop: 'game:tracking:stop',
  gameLaunchGet: 'game:launch:get',
  gameLaunchRevealLauncher: 'game:launch:reveal-launcher',
  gameLaunchStatus: 'game:launch:status',
  gameCompletionTimesResolve: 'game:completion-times:resolve',
  gameTrailerResolve: 'game:trailer:resolve',
  gameTitleMusicResolve: 'game:title-music:resolve',
  gameAchievementsResolve: 'game:achievements:resolve',
  gameAchievementGuideResolve: 'game:achievement-guide:resolve',
  gameAchievementsSync: 'game:achievements:sync',
  attractArtwork: 'attract:artwork',
  capturesList: 'captures:list',
  capturesOpen: 'captures:open',
  capturesOpenFolder: 'captures:open-folder',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  steamWebApiCredentialGet: 'steam:web-api-credential:get',
  steamWebApiCredentialSet: 'steam:web-api-credential:set',
  steamWebApiCredentialClear: 'steam:web-api-credential:clear',
  retroAchievementsCredentialGet: 'retro-achievements:credential:get',
  retroAchievementsCredentialSet: 'retro-achievements:credential:set',
  retroAchievementsCredentialClear: 'retro-achievements:credential:clear',
  profileAvatarGetCustom: 'profile-avatar:custom:get',
  profileAvatarSelectCustom: 'profile-avatar:custom:select',
  homeWallpaperGet: 'home-wallpaper:get',
  homeWallpaperSelect: 'home-wallpaper:select',
  homeWallpaperClear: 'home-wallpaper:clear',
  launcherMusicGetCustom: 'launcher-music:custom:get',
  launcherMusicSelectCustom: 'launcher-music:custom:select',
  launcherMusicClearCustom: 'launcher-music:custom:clear',
  uiAudioGetCustom: 'ui-audio:custom:get',
  uiAudioSelectCustom: 'ui-audio:custom:select',
  uiAudioClearCustom: 'ui-audio:custom:clear',
  startupVideoGet: 'startup-video:get',
  startupVideoSelect: 'startup-video:select',
  applicationsGet: 'applications:get',
  applicationsRefresh: 'applications:refresh',
  applicationsLaunch: 'applications:launch',
  mediaKeyboardOpen: 'media-keyboard:open',
  mediaKeyboardShortcut: 'media-keyboard:shortcut',
  mediaKeyboardUpdate: 'media-keyboard:update',
  mediaKeyboardComplete: 'media-keyboard:complete',
  mediaKeyboardClose: 'media-keyboard:close',
  mediaOverlayHintOpen: 'media-overlay:hint-open',
  mediaOverlayHintDismiss: 'media-overlay:hint-dismiss',
  customApplicationSelect: 'applications:custom:select',
  customApplicationCommit: 'applications:custom:commit',
  customApplicationUpdate: 'applications:custom:update',
  customApplicationRemove: 'applications:custom:remove',
  customApplicationCancel: 'applications:custom:cancel',
  appVersion: 'app:version',
  appLogPath: 'app:log-path',
  appOpenLogFolder: 'app:open-log-folder',
  appUpdateGet: 'app:update:get',
  appUpdateCheck: 'app:update:check',
  appUpdateDownload: 'app:update:download',
  appUpdateInstall: 'app:update:install',
  appUpdateDefer: 'app:update:defer',
  appUpdateStatus: 'app:update:status',
  backgroundServiceGetStatus: 'background-service:status:get',
  backgroundServiceControl: 'background-service:control',
  backgroundServiceStatus: 'background-service:status',
  hardwareControlGetStatus: 'hardware-control:status:get',
  hardwareControlStatus: 'hardware-control:status',
  retroArchStatus: 'retro-arch:status',
  retroArchCommand: 'retro-arch:command',
  retroArchReturn: 'retro-arch:return',
  retroArchPauseRequested: 'retro-arch:pause-requested',
  guestModeStatus: 'guest-mode:status',
  guestModeSetup: 'guest-mode:setup',
  guestModeVerify: 'guest-mode:verify',
  guestModeEnable: 'guest-mode:enable',
  guestModeDisable: 'guest-mode:disable',
  guestModeSetAllowedCollection: 'guest-mode:allowed-collection:set',
  guestModeStatusUpdated: 'guest-mode:status:updated',
  guestModeLockSettings: 'guest-mode:settings:lock',
  controllerInputState: 'controller-input:state',
  imageResolve: 'image:resolve',
  imageArtworkSearchList: 'image:artwork-search:list',
  imageArtworkSearchApply: 'image:artwork-search:apply',
  imageSelectCustom: 'image:custom:select',
  imagePasteCustom: 'image:custom:paste',
  imageResetCustom: 'image:custom:reset',
  imageHasCustom: 'image:custom:has',
  imageReportFailure: 'image:failure:report',
  imageTokenStatusGet: 'image:token-status:get',
  imageTokenSet: 'image:token:set',
  imageTokenClear: 'image:token:clear',
  imageCacheClear: 'image:cache:clear',
  imageArtworkReload: 'image:artwork:reload',
  imageCacheInvalidated: 'image:cache:invalidated',
  imageUpdated: 'image:updated',
  storeGet: 'store:get',
  storeRefresh: 'store:refresh',
  storeCompareProduct: 'store:product:compare',
  storeSearch: 'store:search',
  storeUpdated: 'store:updated',
  storeToggleWishlist: 'store:wishlist:toggle',
  storeSetPriceAlert: 'store:price-alert:set',
  storeRemovePriceAlert: 'store:price-alert:remove',
  storeSetRegion: 'store:region:set',
  syncGet: 'sync:get',
  syncUpdated: 'sync:updated',
  systemUpdatesCheck: 'system:updates:check',
  systemOpenUpdateSettings: 'system:updates:open-settings',
  systemStatusGet: 'system:status:get',
  systemStatusRefresh: 'system:status:refresh',
  systemKeyboardShow: 'system:keyboard:show',
  systemStatusUpdated: 'system:status:updated',
  systemOpenSettings: 'system:settings:open',
  systemWallpaperApply: 'system:wallpaper:apply',
  systemPower: 'system:power',
  appControl: 'app:control',
  openExternal: 'shell:open-external'
} as const
