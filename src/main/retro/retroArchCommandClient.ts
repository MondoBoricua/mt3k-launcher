import { createSocket, type Socket } from 'node:dgram'
import {
  RETROARCH_NETWORK_HOST,
  RETROARCH_NETWORK_PORT,
  encodeRetroArchCommand,
  isRetroArchCommand,
  type RetroArchCommandError,
  type RetroArchCommandName
} from '../../shared/retroArchCommands'

/** Un segundo, lo mismo que `nc -w1` en la documentación de RetroArch. */
export const RETROARCH_COMMAND_TIMEOUT_MS = 1_000

export interface RetroArchUdpResult {
  ok: boolean
  reply: string | null
  error?: RetroArchCommandError
}

export interface RetroArchUdpOptions {
  /** Solo se usa en el verify script. En producción queda en 55355. */
  port?: number
  timeoutMs?: number
  host?: string
}

function closeSocket(socket: Socket): void {
  try {
    socket.close()
  } catch (error) {
    console.warn(
      `[retro-pause-menu] no se pudo cerrar el socket UDP: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

/**
 * Manda un comando de la lista blanca a RetroArch por UDP.
 * No tira excepciones: el renderer siempre recibe un resultado
 * que puede traducir. GET_STATUS espera hasta un segundo porque
 * tiene respuesta. Los demás son hotkeys: en cuanto el paquete
 * sale, listo. RetroArch no manda acuse de esos.
 */
export function sendRetroArchUdp(
  command: RetroArchCommandName,
  options: RetroArchUdpOptions = {}
): Promise<RetroArchUdpResult> {
  if (!isRetroArchCommand(command)) {
    return Promise.resolve({ ok: false, reply: null, error: 'rejected' })
  }

  const host = options.host ?? RETROARCH_NETWORK_HOST
  if (host !== '127.0.0.1' && host !== 'localhost') {
    return Promise.resolve({ ok: false, reply: null, error: 'rejected' })
  }

  const port = options.port ?? RETROARCH_NETWORK_PORT
  const timeoutMs = options.timeoutMs ?? RETROARCH_COMMAND_TIMEOUT_MS
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.resolve({ ok: false, reply: null, error: 'rejected' })
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 5_000) {
    return Promise.resolve({ ok: false, reply: null, error: 'rejected' })
  }

  return new Promise((resolve) => {
    const socket = createSocket('udp4')
    let settled = false

    const finish = (result: RetroArchUdpResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      closeSocket(socket)
      resolve(result)
    }

    const timer = setTimeout(() => {
      if (command === 'GET_STATUS') {
        console.warn('[retro-pause-menu] RetroArch no contestó GET_STATUS')
        finish({ ok: false, reply: null, error: 'timeout' })
        return
      }
      // Si el send no avisó, no dejamos la promesa colgada.
      finish({ ok: true, reply: null })
    }, timeoutMs)

    socket.once('error', (error) => {
      console.warn(`[retro-pause-menu] error UDP: ${error.message}`)
      finish({ ok: false, reply: null, error: 'unreachable' })
    })

    socket.once('message', (message) => {
      finish({ ok: true, reply: message.toString('utf8') })
    })

    let packet: Buffer
    try {
      packet = encodeRetroArchCommand(command)
    } catch (error) {
      console.warn(
        `[retro-pause-menu] comando rechazado: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      finish({ ok: false, reply: null, error: 'rejected' })
      return
    }

    socket.send(packet, port, host, (error) => {
      if (error) {
        console.warn(`[retro-pause-menu] no se pudo enviar el comando: ${error.message}`)
        finish({ ok: false, reply: null, error: 'unreachable' })
        return
      }
      // Hotkey sin respuesta: no dejamos el menú esperando el segundo entero.
      if (command !== 'GET_STATUS') finish({ ok: true, reply: null })
    })
  })
}
