import { BotGuardClient } from 'bgutils-js/botguard'
import { WebPoMinter } from 'bgutils-js/webpo'

interface TitleMusicChallenge {
  program: string
  globalName: string
  interpreterJavascript?: string
  interpreterUrl?: string
  useYouTubeAPI?: boolean
}

interface YouTubeWindow extends Window {
  yt?: { config_: Record<string, unknown> }
}

interface PendingToken {
  botGuard: BotGuardClient
  contentBinding: string
  globalName: string
  webPoSignalOutput: Parameters<typeof WebPoMinter.create>[1]
  timeout: ReturnType<typeof setTimeout>
}

type IntegrityResponse = [unknown, number?, number?, string?]

const pendingTokens = new Map<string, PendingToken>()

async function cleanup(generationId: string): Promise<void> {
  const pending = pendingTokens.get(generationId)
  if (!pending) return
  pendingTokens.delete(generationId)
  clearTimeout(pending.timeout)
  await pending.botGuard.shutdown().catch(() => undefined)
  delete (window as unknown as Record<string, unknown>)[pending.globalName]
  delete (window as YouTubeWindow).yt
}

async function interpreterSource(challenge: TitleMusicChallenge): Promise<string> {
  const embedded = challenge.interpreterJavascript
  if (embedded) return embedded
  const path = challenge.interpreterUrl
  if (!path) throw new Error('BotGuard interpreter is unavailable')
  const url = path.startsWith('//') ? `https:${path}` : path
  const response = await fetch(url)
  if (!response.ok) throw new Error(`BotGuard interpreter request failed (${response.status})`)
  return response.text()
}

async function prepare(
  contentBinding: string,
  challenge: TitleMusicChallenge,
  youtubeConfig: Record<string, unknown>
): Promise<{ generationId: string; botGuardResponse: string }> {
  if (!contentBinding || contentBinding.length > 4096) throw new Error('Invalid content binding')
  if (!challenge.program || !challenge.globalName) throw new Error('Incomplete BotGuard challenge')

  let botGuard: BotGuardClient | undefined
  try {
    // This renderer is sandboxed, muted, permissionless and has an isolated session.
    // The challenge cannot reach ORBIT's preload, renderer state or Node.js APIs.
    ;(window as YouTubeWindow).yt = { config_: youtubeConfig }
    new Function(await interpreterSource(challenge))()
    botGuard = await BotGuardClient.create({
      program: challenge.program,
      globalName: challenge.globalName,
      globalObject: window
    })
    const webPoSignalOutput: Parameters<typeof WebPoMinter.create>[1] = []
    const botGuardResponse = await botGuard.snapshot({ webPoSignalOutput }, 10_000)
    const generationId = crypto.randomUUID()
    const timeout = setTimeout(() => void cleanup(generationId), 30_000)
    pendingTokens.set(generationId, {
      botGuard,
      contentBinding,
      globalName: challenge.globalName,
      webPoSignalOutput,
      timeout
    })
    return { generationId, botGuardResponse }
  } catch (error) {
    await botGuard?.shutdown().catch(() => undefined)
    delete (window as unknown as Record<string, unknown>)[challenge.globalName]
    delete (window as YouTubeWindow).yt
    throw error
  }
}

async function mint(generationId: string, integrity: IntegrityResponse): Promise<string> {
  const pending = pendingTokens.get(generationId)
  if (!pending) throw new Error('BotGuard token generation expired')
  try {
    const integrityToken = typeof integrity[0] === 'string' ? integrity[0] : undefined
    if (!integrityToken) throw new Error('BotGuard integrity token is unavailable')
    const minter = await WebPoMinter.create({
      integrityToken,
      estimatedTtlSecs: integrity[1],
      mintRefreshThreshold: integrity[2],
      websafeFallbackToken: integrity[3]
    }, pending.webPoSignalOutput)
    return minter.mintAsWebsafeString(pending.contentBinding)
  } finally {
    await cleanup(generationId)
  }
}

Object.defineProperty(window, '__orbitPrepareTitleMusicPoToken', {
  configurable: false,
  enumerable: false,
  writable: false,
  value: prepare
})

Object.defineProperty(window, '__orbitMintTitleMusicPoToken', {
  configurable: false,
  enumerable: false,
  writable: false,
  value: mint
})
