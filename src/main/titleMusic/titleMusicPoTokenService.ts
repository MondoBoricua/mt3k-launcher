import { app, BrowserWindow, session, type Session } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo'
const GOOG_API_KEY = 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw'
const TOKEN_PARTITION = 'orbit-title-music-token'

export interface TitleMusicChallenge {
  program: string
  globalName: string
  interpreterJavascript: string
}

interface PreparedToken {
  generationId: string
  botGuardResponse: string
}

let tokenSession: Session | undefined
let rendererScriptTask: Promise<string> | undefined
let generationQueue = Promise.resolve()

function isolatedSession(): Session {
  if (tokenSession) return tokenSession
  const current = session.fromPartition(TOKEN_PARTITION, { cache: false })
  current.setPermissionCheckHandler(() => false)
  current.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  current.setUserAgent(session.defaultSession.getUserAgent())
  current.webRequest.onBeforeSendHeaders({
    urls: ['https://www.google.com/js/*', 'https://www.youtube.com/youtubei/*']
  }, ({ requestHeaders, url }, callback) => {
    if (url.startsWith('https://www.youtube.com/youtubei/')) {
      requestHeaders.Referer = 'https://www.youtube.com/'
      requestHeaders.Origin = 'https://www.youtube.com'
      requestHeaders['Sec-Fetch-Site'] = 'same-origin'
      requestHeaders['Sec-Fetch-Mode'] = 'same-origin'
      requestHeaders['X-Youtube-Bootstrap-Logged-In'] = 'false'
    } else {
      requestHeaders['Sec-Fetch-Dest'] = 'script'
      requestHeaders['Sec-Fetch-Site'] = 'cross-site'
      requestHeaders['Accept-Language'] = '*'
    }
    callback({ requestHeaders })
  })
  current.webRequest.onHeadersReceived({ urls: ['https://*/*'] }, ({ responseHeaders }, callback) => {
    callback({
      responseHeaders: responseHeaders && {
        ...responseHeaders,
        'Access-Control-Allow-Origin': ['*'],
        'Access-Control-Allow-Methods': ['GET, HEAD, POST, PUT, DELETE, CONNECT, OPTIONS, TRACE, PATCH']
      }
    })
  })
  current.webRequest.onBeforeRequest(
    { urls: ['<all_urls>'], types: ['cspReport', 'ping'] },
    (_details, callback) => callback({ cancel: true })
  )
  tokenSession = current
  return current
}

async function rendererScript(): Promise<string> {
  if (!rendererScriptTask) {
    rendererScriptTask = (async () => {
      const roots = [
        join(app.getAppPath(), 'out', 'renderer'),
        join(process.cwd(), 'out', 'renderer'),
        join(process.resourcesPath, 'app.asar', 'out', 'renderer')
      ]
      for (const rendererRoot of roots) {
        try {
          const html = await readFile(join(rendererRoot, 'titleMusicToken.html'), 'utf8')
          const asset = html.match(/src="\.\/(assets\/titleMusicToken-[^"]+\.js)"/u)?.[1]
          if (asset) return await readFile(join(rendererRoot, asset), 'utf8')
        } catch {
          // Try the next development or packaged application location.
        }
      }
      throw new Error('Title music token renderer asset is unavailable')
    })().catch((error) => {
      rendererScriptTask = undefined
      throw error
    })
  }
  return rendererScriptTask
}

async function requestIntegrityToken(botGuardResponse: string): Promise<unknown[]> {
  const response = await fetch('https://www.youtube.com/api/jnn/v1/GenerateIT', {
    method: 'POST',
    headers: {
      'content-type': 'application/json+protobuf',
      'x-goog-api-key': GOOG_API_KEY,
      'x-user-agent': 'grpc-web-javascript/0.1'
    },
    body: JSON.stringify([REQUEST_KEY, botGuardResponse]),
    signal: AbortSignal.timeout(15_000)
  })
  if (!response.ok) throw new Error(`Title music integrity request failed (${response.status})`)
  const result = await response.json()
  if (!Array.isArray(result) || typeof result[0] !== 'string') {
    throw new Error('Title music integrity token is unavailable')
  }
  return result
}

async function generate(
  contentBinding: string,
  challenge: TitleMusicChallenge,
  youtubeConfig: Record<string, unknown>
): Promise<string> {
  const currentSession = isolatedSession()
  let window: BrowserWindow | undefined
  try {
    window = new BrowserWindow({
      show: false,
      width: 1920,
      height: 1080,
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        safeDialogs: true,
        v8CacheOptions: 'none',
        session: currentSession
      }
    })
    window.webContents.setAudioMuted(true)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    await window.loadURL(
      'data:text/html,<!doctype html><html lang="en"><head></head><body></body></html>',
      { baseURLForDataURL: 'https://www.youtube.com/' }
    )
    const script = await rendererScript()
    await window.webContents.executeJavaScript(`${script}\n;true`, true)
    const prepared = await window.webContents.executeJavaScript(
      `window.__orbitPrepareTitleMusicPoToken(${JSON.stringify(contentBinding)}, ${JSON.stringify(challenge)}, ${JSON.stringify(youtubeConfig)})`,
      true
    ) as PreparedToken
    if (
      typeof prepared?.generationId !== 'string' ||
      typeof prepared?.botGuardResponse !== 'string'
    ) {
      throw new Error('Title music BotGuard response is invalid')
    }
    const integrity = await requestIntegrityToken(prepared.botGuardResponse)
    const token = await window.webContents.executeJavaScript(
      `window.__orbitMintTitleMusicPoToken(${JSON.stringify(prepared.generationId)}, ${JSON.stringify(integrity)})`,
      true
    )
    if (typeof token !== 'string' || token.length < 80 || token.length > 2048) {
      throw new Error('Title music proof token is invalid')
    }
    return token
  } finally {
    window?.destroy()
    await currentSession.closeAllConnections().catch(() => undefined)
    await currentSession.clearData().catch(() => undefined)
  }
}

export function generateTitleMusicPoToken(
  contentBinding: string,
  challenge: TitleMusicChallenge,
  youtubeConfig: Record<string, unknown>
): Promise<string> {
  const task = generationQueue.then(() => generate(contentBinding, challenge, youtubeConfig))
  generationQueue = task.then(() => undefined, () => undefined)
  return task
}
