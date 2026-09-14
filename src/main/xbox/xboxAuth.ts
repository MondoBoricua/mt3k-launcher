import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { BrowserWindow, safeStorage, session } from 'electron'
import Store from 'electron-store'
import type {
  XboxAccount,
  XboxConnectionSnapshot,
  XboxLoginStatus
} from '@shared/ipc'
import { fetchWithElectronNet } from '../networkFetch'
import { getReleaseManifest } from '../releaseManifest'

const SESSION_PARTITION = 'orbit-xbox-login'
const OAUTH_REDIRECT_URI = 'https://login.microsoftonline.com/common/oauth2/nativeclient'
const OAUTH_SCOPE = 'XboxLive.signin XboxLive.offline_access'
const XBOX_USER_RELYING_PARTY = 'http://auth.xboxlive.com'
const XBOX_LIVE_RELYING_PARTY = 'http://xboxlive.com'
const TRUSTED_RELYING_PARTIES = new Set([XBOX_LIVE_RELYING_PARTY])
const SESSION_SKEW_MS = 60_000
const TRUSTED_LOGIN_DOMAINS = [
  'live.com',
  'microsoft.com',
  'microsoftonline.com',
  'microsoftonline-p.com'
] as const
const TRUSTED_SERVICE_HOSTS = new Set([
  'achievements.xboxlive.com',
  'titlehub.xboxlive.com',
  'peoplehub.xboxlive.com'
])

interface EncryptedRefreshTokenStore {
  payload?: string
}

interface PersistedRefreshToken {
  clientId: string
  refreshToken: string
}

interface OAuthTokenResponse {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
}

interface XboxSecurityTokenResponse {
  Token?: unknown
  NotAfter?: unknown
  DisplayClaims?: {
    xui?: unknown
  }
}

export interface XboxServiceSession {
  account: XboxAccount
  userHash: string
  token: string
  expiresAt: number
}

const refreshTokenStore = new Store<EncryptedRefreshTokenStore>({
  name: 'orbit-xbox-auth',
  defaults: {}
})
const accountCache = new Store<{ account?: XboxAccount }>({
  name: 'orbit-xbox-account',
  defaults: {}
})

function configuredClientId(): string | null {
  const environmentClientId = process.env.ORBIT_XBOX_CLIENT_ID?.trim()
  const value = environmentClientId || getReleaseManifest().integrations.xboxClientId
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null
}

function accountServicesAvailable(): boolean {
  return Boolean(configuredClientId()) && safeStorage.isEncryptionAvailable()
}

function base64Url(value: Buffer): string {
  return value.toString('base64url')
}

function oauthUrl(clientId: string, state: string, challenge: string): string {
  const url = new URL('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize')
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: OAUTH_REDIRECT_URI,
    response_mode: 'query',
    scope: OAUTH_SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account'
  }).toString()
  return url.toString()
}

function isTrustedLoginUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    return TRUSTED_LOGIN_DOMAINS.some(
      (domain) => host === domain || host.endsWith(`.${domain}`)
    )
  } catch {
    return false
  }
}

function redirectFromUrl(value: string): {
  code?: string
  state?: string
  error?: string
  errorDescription?: string
} | null {
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'login.microsoftonline.com' ||
      url.pathname.toLowerCase() !== '/common/oauth2/nativeclient'
    ) {
      return null
    }
    const code = url.searchParams.get('code')?.trim()
    const error = url.searchParams.get('error')?.trim()
    const errorDescription = url.searchParams.get('error_description')?.trim()
    return {
      code: code && code.length <= 4_096 ? code : undefined,
      state: url.searchParams.get('state')?.trim() || undefined,
      error: error && error.length <= 160 ? error : undefined,
      errorDescription:
        errorDescription && errorDescription.length <= 500 ? errorDescription : undefined
    }
  } catch {
    return null
  }
}

function responseError(prefix: string, response: Response): Error {
  return new Error(`${prefix} (${response.status})`)
}

function requiredText(value: unknown, label: string, maximum = 8_192): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error(`Xbox returned an invalid ${label}`)
  }
  return value.trim()
}

function accountFromSecurityToken(payload: XboxSecurityTokenResponse): {
  account: XboxAccount
  userHash: string
} {
  const candidates = Array.isArray(payload.DisplayClaims?.xui)
    ? payload.DisplayClaims?.xui
    : []
  const claim = candidates[0]
  if (!claim || typeof claim !== 'object') throw new Error('Xbox account identity is missing')
  const data = claim as Record<string, unknown>
  const userHash = requiredText(data.uhs, 'user hash', 128)
  const xuid = requiredText(data.xid, 'account ID', 64)
  const gamertagValue = typeof data.gtg === 'string' ? data.gtg.trim().slice(0, 64) : ''
  return {
    userHash,
    account: { xuid, gamertag: gamertagValue || `Xbox ${xuid.slice(-6)}` }
  }
}

export class XboxAuthManager {
  private account: XboxAccount | null = null
  private serviceSessions = new Map<string, XboxServiceSession>()
  private sessionRefreshes = new Map<string, Promise<XboxServiceSession>>()
  private loginWindow: BrowserWindow | null = null
  private authGeneration = 0

  getAccount(): XboxAccount | null {
    return this.account
  }

  getConnectionSnapshot(): XboxConnectionSnapshot {
    return { available: accountServicesAvailable(), account: this.account }
  }

  async restoreSession(): Promise<XboxConnectionSnapshot> {
    const clientId = configuredClientId()
    if (!clientId || !safeStorage.isEncryptionAvailable()) {
      this.account = null
      this.serviceSessions.clear()
      return { available: false, account: null }
    }
    const stored = this.loadRefreshToken()
    if (!stored || stored.clientId !== clientId) {
      this.account = null
      return { available: true, account: null }
    }
    const generation = this.authGeneration
    try {
      await this.refreshServiceSession(stored, XBOX_LIVE_RELYING_PARTY, generation)
    } catch {
      if (generation === this.authGeneration) this.account = accountCache.get('account') ?? null
    }
    return this.getConnectionSnapshot()
  }

  async getXboxLiveSession(forceRefresh = false): Promise<XboxServiceSession> {
    return this.getServiceSession(XBOX_LIVE_RELYING_PARTY, forceRefresh)
  }

  /** New Xbox capabilities must explicitly allow their relying party above and
   * keep the resulting XSTS session within the main process. */
  private async getServiceSession(
    relyingParty: string,
    forceRefresh = false
  ): Promise<XboxServiceSession> {
    if (!TRUSTED_RELYING_PARTIES.has(relyingParty)) {
      throw new Error('Untrusted Xbox relying party')
    }
    const cached = this.serviceSessions.get(relyingParty)
    if (!forceRefresh && cached && Date.now() < cached.expiresAt - SESSION_SKEW_MS) {
      return cached
    }
    const active = this.sessionRefreshes.get(relyingParty)
    if (active) return active
    const stored = this.loadRefreshToken()
    if (!stored || stored.clientId !== configuredClientId()) {
      throw new Error('No active Xbox session')
    }
    const generation = this.authGeneration
    const request = this.refreshServiceSession(stored, relyingParty, generation).finally(() => {
      if (this.sessionRefreshes.get(relyingParty) === request) {
        this.sessionRefreshes.delete(relyingParty)
      }
    })
    this.sessionRefreshes.set(relyingParty, request)
    return request
  }

  async fetchXboxService(
    input: URL,
    init: RequestInit = {},
    contractVersion = '2'
  ): Promise<Response> {
    if (input.protocol !== 'https:' || !TRUSTED_SERVICE_HOSTS.has(input.hostname.toLowerCase())) {
      throw new Error('Untrusted Xbox service URL')
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const xboxSession = await this.getXboxLiveSession(attempt > 0)
      const headers = new Headers(init.headers)
      headers.set('Authorization', `XBL3.0 x=${xboxSession.userHash};${xboxSession.token}`)
      headers.set('x-xbl-contract-version', contractVersion)
      headers.set('Accept', 'application/json')
      const response = await fetchWithElectronNet(input, { ...init, headers })
      if (response.status !== 401 || attempt > 0) return response
      await response.body?.cancel().catch(() => undefined)
    }
    throw new Error('Xbox session could not be refreshed')
  }

  async startLogin(
    onStatus: (status: XboxLoginStatus) => void,
    parentWindow?: BrowserWindow
  ): Promise<void> {
    const clientId = configuredClientId()
    if (!clientId || !safeStorage.isEncryptionAvailable()) {
      throw new Error('Xbox sign-in is not configured for this MT3K Launcher build')
    }
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.show()
      this.loginWindow.focus()
      return
    }

    const generation = ++this.authGeneration
    const report = (status: XboxLoginStatus): void => {
      try {
        onStatus(status)
      } catch {
        // The parent renderer may close while Microsoft completes the redirect.
      }
    }
    report({ state: 'waiting-for-browser' })
    const state = randomUUID()
    const verifier = base64Url(randomBytes(64))
    const challenge = base64Url(createHash('sha256').update(verifier).digest())
    const loginSession = session.fromPartition(SESSION_PARTITION)
    loginSession.setPermissionCheckHandler(() => false)
    loginSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    const parent = parentWindow && !parentWindow.isDestroyed() ? parentWindow : undefined
    const window = new BrowserWindow({
      width: 680,
      height: 820,
      minWidth: 480,
      minHeight: 620,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      title: 'Bei Xbox anmelden',
      ...(parent ? { parent, modal: true } : {}),
      webPreferences: {
        partition: SESSION_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools: false,
        spellcheck: false
      }
    })
    this.loginWindow = window

    await new Promise<void>((resolve, reject) => {
      let finished = false
      let handlingRedirect = false

      const restoreParentFocus = (): void => {
        if (!parent || parent.isDestroyed()) return
        parent.show()
        parent.focus()
      }
      const close = (): void => {
        if (this.loginWindow === window) this.loginWindow = null
        if (!window.isDestroyed()) window.destroy()
        restoreParentFocus()
      }
      const fail = (cause: unknown): void => {
        if (finished) return
        finished = true
        const error = cause instanceof Error ? cause : new Error('Xbox sign-in failed')
        report({ state: 'error', message: error.message })
        close()
        reject(error)
      }
      const capture = (value: string, event?: { preventDefault: () => void }): boolean => {
        const redirect = redirectFromUrl(value)
        if (!redirect) return false
        event?.preventDefault()
        if (handlingRedirect || finished) return true
        if (redirect.state !== state) {
          fail(new Error('Xbox sign-in returned an invalid state'))
          return true
        }
        if (!redirect.code) {
          fail(new Error(redirect.errorDescription || redirect.error || 'Xbox sign-in was denied'))
          return true
        }
        handlingRedirect = true
        void this.completeLogin(clientId, redirect.code, verifier, generation)
          .then(async (account) => {
            if (finished || generation !== this.authGeneration) return
            finished = true
            await loginSession.clearStorageData({ storages: ['cookies'] }).catch(() => undefined)
            report({ state: 'success', account })
            close()
            resolve()
          })
          .catch(fail)
        return true
      }

      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-redirect', (event, value) => capture(value, event))
      window.webContents.on('will-navigate', (event, value) => {
        if (capture(value, event)) return
        if (!isTrustedLoginUrl(value)) event.preventDefault()
      })
      window.webContents.on('did-navigate-in-page', (_event, value) => capture(value))
      window.once('closed', () => {
        if (finished) return
        finished = true
        if (this.loginWindow === window) this.loginWindow = null
        report({ state: 'idle' })
        restoreParentFocus()
        resolve()
      })
      window.once('ready-to-show', () => window.show())
      window.loadURL(oauthUrl(clientId, state, challenge)).catch(fail)
    })
  }

  cancelLogin(): void {
    this.authGeneration += 1
    if (this.loginWindow && !this.loginWindow.isDestroyed()) this.loginWindow.destroy()
    this.loginWindow = null
  }

  async logout(): Promise<void> {
    this.cancelLogin()
    this.account = null
    this.serviceSessions.clear()
    this.sessionRefreshes.clear()
    refreshTokenStore.delete('payload')
    accountCache.delete('account')
    await session.fromPartition(SESSION_PARTITION).clearStorageData().catch(() => undefined)
  }

  private async completeLogin(
    clientId: string,
    code: string,
    verifier: string,
    generation: number
  ): Promise<XboxAccount> {
    const tokens = await this.exchangeOAuthToken(clientId, {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: OAUTH_REDIRECT_URI
    })
    const sessionResult = await this.exchangeXboxTokens(tokens.accessToken, XBOX_LIVE_RELYING_PARTY)
    if (generation !== this.authGeneration) throw new Error('Xbox sign-in was cancelled')
    this.persistRefreshToken({ clientId, refreshToken: tokens.refreshToken })
    this.serviceSessions.set(XBOX_LIVE_RELYING_PARTY, sessionResult)
    this.account = sessionResult.account
    accountCache.set('account', sessionResult.account)
    return sessionResult.account
  }

  private async refreshServiceSession(
    stored: PersistedRefreshToken,
    relyingParty: string,
    generation: number
  ): Promise<XboxServiceSession> {
    const tokens = await this.exchangeOAuthToken(stored.clientId, {
      grant_type: 'refresh_token',
      refresh_token: stored.refreshToken
    }, stored.refreshToken)
    const xboxSession = await this.exchangeXboxTokens(tokens.accessToken, relyingParty)
    if (generation !== this.authGeneration) throw new Error('Xbox session refresh was cancelled')
    this.persistRefreshToken({ clientId: stored.clientId, refreshToken: tokens.refreshToken })
    this.serviceSessions.set(relyingParty, xboxSession)
    this.account = xboxSession.account
    accountCache.set('account', xboxSession.account)
    return xboxSession
  }

  private async exchangeOAuthToken(
    clientId: string,
    fields: Record<string, string>,
    fallbackRefreshToken?: string
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const response = await fetchWithElectronNet(
      'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          scope: OAUTH_SCOPE,
          ...fields
        }).toString(),
        signal: AbortSignal.timeout(20_000)
      }
    )
    if (!response.ok) throw responseError('Microsoft sign-in failed', response)
    const payload = (await response.json()) as OAuthTokenResponse
    const accessToken = requiredText(payload.access_token, 'access token')
    const refreshToken = requiredText(
      typeof payload.refresh_token === 'string'
        ? payload.refresh_token
        : fallbackRefreshToken,
      'refresh token'
    )
    return { accessToken, refreshToken }
  }

  private async exchangeXboxTokens(
    accessToken: string,
    relyingParty: string
  ): Promise<XboxServiceSession> {
    if (!TRUSTED_RELYING_PARTIES.has(relyingParty)) {
      throw new Error('Untrusted Xbox relying party')
    }
    let userTokenPayload: XboxSecurityTokenResponse | null = null
    let lastStatus = 0
    for (const prefix of ['d=', 't=']) {
      const response = await fetchWithElectronNet('https://user.auth.xboxlive.com/user/authenticate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-xbl-contract-version': '1'
        },
        body: JSON.stringify({
          Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `${prefix}${accessToken}` },
          RelyingParty: XBOX_USER_RELYING_PARTY,
          TokenType: 'JWT'
        }),
        signal: AbortSignal.timeout(20_000)
      })
      lastStatus = response.status
      if (response.ok) {
        userTokenPayload = (await response.json()) as XboxSecurityTokenResponse
        break
      }
    }
    if (!userTokenPayload) throw new Error(`Xbox user authentication failed (${lastStatus})`)
    const userToken = requiredText(userTokenPayload.Token, 'user token')

    const response = await fetchWithElectronNet('https://xsts.auth.xboxlive.com/xsts/authorize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-xbl-contract-version': '1'
      },
      body: JSON.stringify({
        Properties: { SandboxId: 'RETAIL', UserTokens: [userToken] },
        RelyingParty: relyingParty,
        TokenType: 'JWT'
      }),
      signal: AbortSignal.timeout(20_000)
    })
    if (!response.ok) throw responseError('Xbox security authorization failed', response)
    const payload = (await response.json()) as XboxSecurityTokenResponse
    const token = requiredText(payload.Token, 'security token')
    const identity = accountFromSecurityToken(payload)
    const expiry = Date.parse(typeof payload.NotAfter === 'string' ? payload.NotAfter : '')
    return {
      ...identity,
      token,
      expiresAt: Number.isFinite(expiry) ? expiry : Date.now() + 60 * 60 * 1_000
    }
  }

  private loadRefreshToken(): PersistedRefreshToken | null {
    const payload = refreshTokenStore.get('payload')
    if (!payload || !safeStorage.isEncryptionAvailable()) return null
    try {
      const parsed = JSON.parse(
        safeStorage.decryptString(Buffer.from(payload, 'base64'))
      ) as Partial<PersistedRefreshToken>
      if (
        typeof parsed.clientId !== 'string' ||
        typeof parsed.refreshToken !== 'string' ||
        parsed.refreshToken.length < 20
      ) {
        return null
      }
      return { clientId: parsed.clientId, refreshToken: parsed.refreshToken }
    } catch {
      return null
    }
  }

  private persistRefreshToken(value: PersistedRefreshToken): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure Xbox credential storage is unavailable')
    }
    const encrypted = safeStorage.encryptString(JSON.stringify(value))
    refreshTokenStore.set('payload', encrypted.toString('base64'))
  }
}

export const xboxAuthManager = new XboxAuthManager()
