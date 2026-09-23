import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import {
  isRetroArchConfigPath,
  parseRetroArchNetworkMemory,
  planRetroArchNetworkEnable,
  planRetroArchNetworkRestore,
  selectRetroArchConfigPath,
  type RetroArchNetworkMemory
} from '@shared/retroArchCommands'
import { settingsStore } from '../settingsStore'
import { access } from 'node:fs/promises'
import { applyRetroArchConfigPlan } from './retroArchConfigFile'

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function memoryPath(): string {
  return join(app.getPath('userData'), 'retroarch-network-config.json')
}

async function readMemory(): Promise<RetroArchNetworkMemory | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(memoryPath(), 'utf8'))
    return parseRetroArchNetworkMemory(parsed)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    console.warn(
      `[retro-pause-menu] no se pudo leer el recuerdo del cfg: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    return null
  }
}

async function writeMemory(memory: RetroArchNetworkMemory): Promise<void> {
  const file = memoryPath()
  const tempPath = `${file}.mt3k-tmp`
  await writeFile(tempPath, JSON.stringify(memory), { encoding: 'utf8', flush: true })
  await rename(tempPath, file)
}

async function clearMemory(): Promise<void> {
  await rm(memoryPath(), { force: true })
}

/**
 * Prende la interfaz de comandos en el cfg que RetroArch va a leer.
 * Con el toggle apagado no se lee ni se escribe nada.
 * Un fallo aquí no tumba el lanzamiento.
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
    if (!location || !isRetroArchConfigPath(location.path)) {
      console.warn('[retro-pause-menu] no hay un retroarch.cfg donde escribir los comandos de red')
      return
    }

    if (location.create) await mkdir(dirname(location.path), { recursive: true })
    let captured: RetroArchNetworkMemory | null = null
    const result = await applyRetroArchConfigPlan(
      location.path,
      (text) => {
        const plan = planRetroArchNetworkEnable(text)
        if (plan.action === 'write') {
          captured = {
            version: 1,
            configPath: location.path,
            original: plan.original,
            written: plan.written
          }
        }
        return plan
      },
      { allowCreate: location.create }
    )
    if (result === 'written' && captured) await writeMemory(captured)
  } catch (error) {
    console.warn(
      `[retro-pause-menu] no se pudo preparar retroarch.cfg: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

/**
 * Al apagar el toggle (o al arrancar si ya quedó apagado) devuelve
 * las claves originales, pero solo si nadie las cambió después.
 */
export async function restoreRetroArchNetworkCommandsOnDisable(): Promise<void> {
  if (settingsStore.store.retroPauseMenuEnabled === true) return
  if (process.platform !== 'win32') return

  try {
    const memory = await readMemory()
    if (!memory) return
    const result = await applyRetroArchConfigPlan(memory.configPath, (text) =>
      planRetroArchNetworkRestore(text, memory)
    )
    // Rechazado (cfg ilegible o enorme): se conserva el recuerdo pa' reintentar.
    if (result === 'rejected') return
    await clearMemory()
  } catch (error) {
    console.warn(
      `[retro-pause-menu] no se pudo restaurar retroarch.cfg: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}
