import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  selectRetroArchConfigPath,
  upsertRetroArchNetworkCommands
} from '@shared/retroArchCommands'
import { settingsStore } from '../settingsStore'

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Prende la interfaz de comandos de RetroArch en el cfg que el usuario
 * ya tiene. Si el toggle está apagado, no leemos ni escribimos nada.
 * Un fallo aquí no tumba el lanzamiento: el menú dirá que RetroArch
 * no contestó y el juego igual abre.
 */
export async function ensureRetroArchNetworkCommands(executablePath: string): Promise<void> {
  if (settingsStore.store.retroPauseMenuEnabled !== true) return
  if (process.platform !== 'win32') return

  const executable = executablePath.trim()
  if (!executable) return

  try {
    const besideConfigPath = join(dirname(executable), 'retroarch.cfg')
    const appData = process.env.APPDATA?.trim()
    const appDataConfigPath = appData ? join(appData, 'RetroArch', 'retroarch.cfg') : null
    const portableLayout =
      (await pathExists(join(dirname(executable), 'cores'))) ||
      (await pathExists(join(dirname(executable), 'retroarch.default.cfg')))
    const location = selectRetroArchConfigPath({
      besideConfigPath,
      besideConfigExists: await pathExists(besideConfigPath),
      appDataConfigPath,
      appDataConfigExists: appDataConfigPath ? await pathExists(appDataConfigPath) : false,
      portableLayout
    })
    if (!location) {
      console.warn('[retro-pause-menu] no hay un retroarch.cfg donde escribir los comandos de red')
      return
    }

    let current = ''
    if (!location.create) {
      current = await readFile(location.path, 'utf8')
    }
    const updated = upsertRetroArchNetworkCommands(current)
    if (updated === current) return

    if (location.create) await mkdir(dirname(location.path), { recursive: true })
    await writeFile(location.path, updated, 'utf8')
  } catch (error) {
    console.warn(
      `[retro-pause-menu] no se pudo preparar retroarch.cfg: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}
