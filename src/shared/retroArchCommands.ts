/**
 * Contrato puro del menú de pausa de RetroArch.
 * Aquí no entra Electron: el verify script y el proceso principal
 * comparten la misma lista de comandos, el parseo de GET_STATUS
 * y el recorte de retroarch.cfg.
 *
 * Los nombres salen de la interfaz de red de RetroArch:
 * https://docs.libretro.com/development/retroarch/network-control-interface/
 */

/** Puerto UDP que RetroArch escucha cuando network_cmd_port no se cambia. */
export const RETROARCH_NETWORK_PORT = 55355

/** Solo hablamos con la instancia local. Nunca aceptamos otro host. */
export const RETROARCH_NETWORK_HOST = '127.0.0.1'

/**
 * Comandos que el launcher tiene permiso de mandar.
 * Cualquier otra cadena se rechaza antes de tocar el socket.
 */
export const RETROARCH_COMMANDS = [
  'PAUSE_TOGGLE',
  'SAVE_STATE',
  'LOAD_STATE',
  'SCREENSHOT',
  'FAST_FORWARD',
  'QUIT',
  'GET_STATUS'
] as const

export type RetroArchCommandName = (typeof RETROARCH_COMMANDS)[number]

export type RetroArchPlayback = 'PLAYING' | 'PAUSED' | 'CONTENTLESS' | 'UNKNOWN'

export type RetroArchCommandError =
  | 'disabled'
  | 'not-retroarch'
  | 'rejected'
  | 'timeout'
  | 'unreachable'
  | 'unrecognized'

/** Lo que el renderer pinta: estado de la sesión y la respuesta cruda. */
export interface RetroArchStatusSnapshot {
  enabled: boolean
  retroArchSession: boolean
  playback: RetroArchPlayback
  reply: string | null
  error?: RetroArchCommandError
}

/** Resultado de un comando que no es GET_STATUS. */
export interface RetroArchCommandResult {
  ok: boolean
  reply: string | null
  error?: RetroArchCommandError
}

/** Estado ya interpretado. `raw` es el texto que contestó RetroArch. */
export interface RetroArchStatus {
  playback: RetroArchPlayback
  raw: string
  systemId?: string
  game?: string
  crc32?: string
}

export type RetroPauseMenuActionId =
  | 'resume'
  | 'saveState'
  | 'loadState'
  | 'screenshot'
  | 'fastForward'
  | 'quit'

export interface RetroPauseMenuAction {
  id: RetroPauseMenuActionId
  /** Resume manda PAUSE_TOGGLE solo si el juego está en pausa. */
  command: RetroArchCommandName
  enabled: boolean
}

const ALLOWED_COMMANDS = new Set<string>(RETROARCH_COMMANDS)

const NETWORK_COMMAND_KEYS = [
  ['network_cmd_enable', 'true'],
  ['network_cmd_port', '55355']
] as const

/**
 * La sesión de pausa es solo RetroArch con un juego ya confirmado.
 * Los emuladores sueltos (Snes9x, Dolphin, etc.) se quedan fuera.
 */
export function isRetroArchPauseSession(input: {
  phase: string
  provider?: string
  emulatorId?: string
}): boolean {
  return (
    input.phase === 'running' &&
    input.provider === 'retro' &&
    input.emulatorId === 'retroarch'
  )
}

/** True solo si el nombre es exactamente uno de la lista blanca. */
export function isRetroArchCommand(value: unknown): value is RetroArchCommandName {
  return typeof value === 'string' && ALLOWED_COMMANDS.has(value)
}

/**
 * Paquete UDP sin salto de línea, igual que `echo -n COMMAND`.
 * Si alguien cuela un comando raro, no se codifica.
 */
export function encodeRetroArchCommand(name: RetroArchCommandName): Buffer {
  if (!isRetroArchCommand(name)) {
    throw new Error('rejected')
  }
  return Buffer.from(name, 'utf8')
}

/**
 * Interpreta la respuesta de GET_STATUS.
 * Formatos oficiales:
 * - `GET_STATUS PLAYING system,juego,crc32=XXXXXXXX`
 * - `GET_STATUS PAUSED system,juego,crc32=XXXXXXXX`
 * - `GET_STATUS CONTENTLESS`
 * Cualquier otra cosa queda en UNKNOWN para que la UI enseñe el error.
 */
export function parseStatus(reply: string): RetroArchStatus {
  const raw = reply.replace(/^\uFEFF/u, '').trim()
  const match = /^GET_STATUS\s+(PLAYING|PAUSED|CONTENTLESS)(?:\s+(.*))?$/iu.exec(raw)
  if (!match) return { playback: 'UNKNOWN', raw }

  const playback = match[1].toUpperCase() as Exclude<RetroArchPlayback, 'UNKNOWN'>
  if (playback === 'CONTENTLESS') return { playback, raw }

  const detail = (match[2] ?? '').trim()
  const crcMatch = /(?:^|,)\s*crc32=([0-9a-f]+)\s*$/iu.exec(detail)
  const withoutCrc = crcMatch ? detail.slice(0, crcMatch.index).replace(/,\s*$/u, '') : detail
  const comma = withoutCrc.indexOf(',')
  const systemId = (comma >= 0 ? withoutCrc.slice(0, comma) : withoutCrc).trim()
  const game = comma >= 0 ? withoutCrc.slice(comma + 1).trim() : ''

  return {
    playback,
    raw,
    systemId: systemId || undefined,
    game: game || undefined,
    crc32: crcMatch?.[1]
  }
}

/**
 * Al abrir el menú pausamos solo si RetroArch dice que está jugando.
 * Si ya está en pausa, un toggle lo reanudaría detrás del launcher.
 */
export function openShouldPause(status: RetroArchStatus): boolean {
  return status.playback === 'PLAYING'
}

/** Resume des-pausa únicamente cuando el estado confirmado es PAUSED. */
export function resumeShouldUnpause(status: RetroArchStatus): boolean {
  return status.playback === 'PAUSED'
}

/**
 * Botones del menú según el estado. Sin contenido cargado no tiene
 * sentido guardar o cargar; si RetroArch no contestó, no hay acción segura.
 */
export function pauseMenuActions(status: RetroArchStatus): readonly RetroPauseMenuAction[] {
  const contentLoaded = status.playback === 'PLAYING' || status.playback === 'PAUSED'
  const reachable = status.playback !== 'UNKNOWN'
  return [
    // Resume siempre se puede intentar: si RetroArch no contestó, igual
    // hay que poder volver al juego y no quedar atrapado en el menú.
    { id: 'resume', command: 'PAUSE_TOGGLE', enabled: true },
    { id: 'saveState', command: 'SAVE_STATE', enabled: contentLoaded },
    { id: 'loadState', command: 'LOAD_STATE', enabled: contentLoaded },
    { id: 'screenshot', command: 'SCREENSHOT', enabled: contentLoaded },
    { id: 'fastForward', command: 'FAST_FORWARD', enabled: contentLoaded },
    { id: 'quit', command: 'QUIT', enabled: reachable }
  ]
}

function preferredNewline(content: string): '\r\n' | '\n' {
  return content.includes('\r\n') ? '\r\n' : '\n'
}

/**
 * Cambia una clave plana de retroarch.cfg en todas sus apariciones.
 * RetroArch se queda con la última, así que un `false` más abajo
 * no puede ganarle al valor que acabamos de escribir.
 * Las líneas comentadas (`# ...`) se dejan quietas.
 */
function applyFlatKey(lines: readonly string[], key: string, value: string): string[] {
  const pattern = new RegExp(`^\\s*${key}\\s*=`, 'iu')
  let found = false
  const next = lines.map((line) => {
    if (!pattern.test(line)) return line
    found = true
    return `${key} = "${value}"`
  })
  if (!found) next.push(`${key} = "${value}"`)
  return next
}

/**
 * Mete `network_cmd_enable = "true"` y `network_cmd_port = "55355"`
 * sin reescribir el resto del archivo. Respeta CRLF y el salto final.
 */
export function upsertRetroArchNetworkCommands(content: string): string {
  const newline = preferredNewline(content)
  const trailingNewline = content.endsWith('\n')
  const body = content.replace(/(?:\r\n|\n)$/u, '')
  const lines = body.length === 0 ? [] : body.split(/\r?\n/u)
  const next = NETWORK_COMMAND_KEYS.reduce(
    (current, [key, value]) => applyFlatKey(current, key, value),
    lines
  )
  const joined = next.join(newline)
  if (trailingNewline || content.length === 0) return `${joined}${newline}`
  return joined
}

export interface RetroArchConfigLocationInput {
  besideConfigPath: string
  besideConfigExists: boolean
  appDataConfigPath: string | null
  appDataConfigExists: boolean
  /** Hay `cores/` o `retroarch.default.cfg` junto al exe: build portable. */
  portableLayout: boolean
}

export interface RetroArchConfigLocation {
  path: string
  create: boolean
}

/**
 * Elige el retroarch.cfg que RetroArch va a leer de verdad.
 * Crear uno al lado del exe cuando el usuario ya usa AppData
 * haría que RetroArch ignore su configuración completa.
 */
export function selectRetroArchConfigPath(
  input: RetroArchConfigLocationInput
): RetroArchConfigLocation | null {
  if (input.besideConfigExists) return { path: input.besideConfigPath, create: false }
  if (input.appDataConfigExists && input.appDataConfigPath) {
    return { path: input.appDataConfigPath, create: false }
  }
  if (input.portableLayout) return { path: input.besideConfigPath, create: true }
  if (input.appDataConfigPath) return { path: input.appDataConfigPath, create: true }
  return null
}

/** Tope del cfg: más de esto no se toca, pa' no reescribir un archivo raro. */
export const RETROARCH_CONFIG_MAX_BYTES = 4 * 1024 * 1024

/** Valores que el launcher escribe. `null` quiere decir que la clave no estaba. */
export interface RetroArchNetworkKeyState {
  network_cmd_enable: string | null
  network_cmd_port: string | null
}

/**
 * Recuerdo de lo que había en el cfg antes de tocarlo.
 * Vive en userData (`retroarch-network-config.json`), no dentro de RetroArch.
 */
export interface RetroArchNetworkMemory {
  version: 1
  configPath: string
  original: RetroArchNetworkKeyState
  written: RetroArchNetworkKeyState
}

const WANTED_NETWORK_KEYS: RetroArchNetworkKeyState = {
  network_cmd_enable: 'true',
  network_cmd_port: '55355'
}

/**
 * Lee el cfg como bytes. Si no es UTF-8 válido o pasa de 4 MB,
 * no devolvemos texto: el que llama tiene que dejar el archivo quieto.
 */
export function decodeRetroArchConfigBytes(
  bytes: Uint8Array
): { ok: true; text: string } | { ok: false; reason: 'too-large' | 'invalid-utf8' } {
  if (bytes.byteLength > RETROARCH_CONFIG_MAX_BYTES) return { ok: false, reason: 'too-large' }
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch {
    return { ok: false, reason: 'invalid-utf8' }
  }
}

function unquoteConfigValue(raw: string): string {
  const trimmed = raw.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/**
 * La última asignación sin comentar gana, igual que RetroArch.
 * Si la clave no aparece, el valor queda en `null` (ausente).
 */
export function readRetroArchNetworkKeys(content: string): RetroArchNetworkKeyState {
  const pattern = /^\s*(network_cmd_enable|network_cmd_port)\s*=\s*(.*?)\s*$/iu
  return content.split(/\r?\n/u).reduce<RetroArchNetworkKeyState>((current, line) => {
    if (/^\s*#/u.test(line)) return current
    const match = pattern.exec(line)
    if (!match) return current
    const key = match[1].toLowerCase() as keyof RetroArchNetworkKeyState
    return { ...current, [key]: unquoteConfigValue(match[2] ?? '') }
  }, { network_cmd_enable: null, network_cmd_port: null })
}

function sameNetworkKeys(left: RetroArchNetworkKeyState, right: RetroArchNetworkKeyState): boolean {
  return (
    left.network_cmd_enable === right.network_cmd_enable &&
    left.network_cmd_port === right.network_cmd_port
  )
}

/** True cuando las dos claves ya tienen lo que el launcher iba a escribir. */
export function networkCommandsAlreadyWanted(content: string): boolean {
  return sameNetworkKeys(readRetroArchNetworkKeys(content), WANTED_NETWORK_KEYS)
}

export interface RetroArchNetworkWritePlan {
  action: 'skip' | 'write'
  text: string
  original: RetroArchNetworkKeyState
  written: RetroArchNetworkKeyState
}

/**
 * Decide si hay que escribir. Si las dos claves ya valen lo que queremos,
 * no se toca el archivo (ni el backup).
 */
export function planRetroArchNetworkEnable(content: string): RetroArchNetworkWritePlan {
  const original = readRetroArchNetworkKeys(content)
  if (sameNetworkKeys(original, WANTED_NETWORK_KEYS)) {
    return { action: 'skip', text: content, original, written: { ...WANTED_NETWORK_KEYS } }
  }
  return {
    action: 'write',
    text: upsertRetroArchNetworkCommands(content),
    original,
    written: { ...WANTED_NETWORK_KEYS }
  }
}

function removeFlatKey(lines: readonly string[], key: string): string[] {
  const pattern = new RegExp(`^\\s*${key}\\s*=`, 'iu')
  return lines.filter((line) => !pattern.test(line))
}

/**
 * Devuelve el cfg a los valores de antes.
 * Si la clave no existía, se quitan las líneas que el launcher metió.
 */
export function applyRetroArchNetworkOriginals(
  content: string,
  original: RetroArchNetworkKeyState
): string {
  const newline = preferredNewline(content)
  const trailingNewline = content.endsWith('\n')
  const body = content.replace(/(?:\r\n|\n)$/u, '')
  const lines = body.length === 0 ? [] : body.split(/\r?\n/u)
  const next = (['network_cmd_enable', 'network_cmd_port'] as const).reduce(
    (current, key) => {
      const value = original[key]
      return value === null ? removeFlatKey(current, key) : applyFlatKey(current, key, value)
    },
    lines
  )
  if (next.length === 0) return ''
  const joined = next.join(newline)
  if (trailingNewline || content.length === 0) return `${joined}${newline}`
  return joined
}

export interface RetroArchNetworkRestorePlan {
  action: 'skip' | 'restore'
  text: string
}

/**
 * Solo restauramos si el cfg sigue con lo que el launcher escribió.
 * Si el usuario cambió una clave después, el archivo se queda como está.
 */
export function planRetroArchNetworkRestore(
  content: string,
  memory: Pick<RetroArchNetworkMemory, 'original' | 'written'>
): RetroArchNetworkRestorePlan {
  const current = readRetroArchNetworkKeys(content)
  if (!sameNetworkKeys(current, memory.written)) return { action: 'skip', text: content }
  const text = applyRetroArchNetworkOriginals(content, memory.original)
  if (text === content) return { action: 'skip', text }
  return { action: 'restore', text }
}

function isNetworkKeyValue(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= 64 && !value.includes('\0'))
}

function parseNetworkKeyState(value: unknown): RetroArchNetworkKeyState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => key !== 'network_cmd_enable' && key !== 'network_cmd_port')) {
    return null
  }
  if (!isNetworkKeyValue(record.network_cmd_enable) || !isNetworkKeyValue(record.network_cmd_port)) {
    return null
  }
  return {
    network_cmd_enable: record.network_cmd_enable,
    network_cmd_port: record.network_cmd_port
  }
}

/**
 * El JSON del sidecar es data de afuera: si no cuadra, se ignora.
 * La ruta tiene que apuntar a un `retroarch.cfg` y no puede subir de carpeta.
 */
export function parseRetroArchNetworkMemory(value: unknown): RetroArchNetworkMemory | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.version !== 1 || !isRetroArchConfigPath(record.configPath)) return null
  const original = parseNetworkKeyState(record.original)
  const written = parseNetworkKeyState(record.written)
  if (!original || !written) return null
  return { version: 1, configPath: record.configPath, original, written }
}

/** Ruta absoluta a retroarch.cfg, sin `..` ni bytes nulos. */
export function isRetroArchConfigPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return false
  if (value.includes('\0')) return false
  const normalized = value.replaceAll('\\', '/')
  if (normalized.split('/').some((part) => part === '..' || part === '.')) return false
  const absolute = /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//') || normalized.startsWith('/')
  return absolute && /\/retroarch\.cfg$/iu.test(normalized)
}
