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
