import { createContext, Script } from 'node:vm'

const MAX_PLAYER_SCRIPT_BYTES = 2 * 1024 * 1024
const PLAYER_SCRIPT_TIMEOUT_MS = 1_000

type YouTubePlayerEvaluator = typeof import('youtubei.js').Platform.shim.eval

export const evaluateYouTubePlayerScript: YouTubePlayerEvaluator = (data) => {
  if (typeof data.output !== 'string' || Buffer.byteLength(data.output, 'utf8') > MAX_PLAYER_SCRIPT_BYTES) {
    throw new Error('YouTube player script is missing or exceeds the allowed size')
  }

  const context = createContext(Object.create(null), {
    name: 'orbit-youtube-player-decipher',
    codeGeneration: { strings: false, wasm: false }
  })
  const script = new Script(`(function () {\n${data.output}\n})()`, {
    filename: 'youtube-player-decipher.js'
  })
  return script.runInContext(context, { timeout: PLAYER_SCRIPT_TIMEOUT_MS })
}
