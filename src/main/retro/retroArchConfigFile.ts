import { copyFile, open, readFile, rename, rm, stat } from 'node:fs/promises'
import {
  decodeRetroArchConfigBytes,
  type RetroArchNetworkRestorePlan,
  type RetroArchNetworkWritePlan
} from '../../shared/retroArchCommands'

export type RetroArchConfigWriteResult = 'skipped' | 'written' | 'rejected'

/**
 * Escribe `retroarch.cfg` sin pisarlo en sitio.
 * Primero va el temporal, se hace fsync, se guarda UNA copia `.mt3k-bak`
 * del original y después el rename ocupa el lugar del cfg.
 * Si no hay original (archivo nuevo), no se inventa un backup.
 */
export async function commitRetroArchConfigAtomically(
  configPath: string,
  nextText: string
): Promise<void> {
  const tempPath = `${configPath}.mt3k-tmp`
  const backupPath = `${configPath}.mt3k-bak`
  const handle = await open(tempPath, 'w')
  try {
    await handle.writeFile(nextText, 'utf8')
    await handle.sync()
  } catch (error) {
    await handle.close()
    await rm(tempPath, { force: true })
    throw error
  }
  await handle.close()

  let originalExists = true
  try {
    await stat(configPath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      await rm(tempPath, { force: true })
      throw error
    }
    originalExists = false
  }

  if (originalExists) {
    try {
      await copyFile(configPath, backupPath)
      const backup = await open(backupPath, 'r+')
      try {
        await backup.sync()
      } finally {
        await backup.close()
      }
    } catch (error) {
      await rm(tempPath, { force: true })
      throw error
    }
  }

  try {
    await rename(tempPath, configPath)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
}

async function readConfigText(configPath: string, allowCreate: boolean): Promise<
  { ok: true; text: string } | { ok: false; reason: 'missing' | 'too-large' | 'invalid-utf8' }
> {
  let bytes: Buffer
  try {
    bytes = await readFile(configPath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' && allowCreate) return { ok: true, text: '' }
    if (code === 'ENOENT') return { ok: false, reason: 'missing' }
    throw error
  }
  const decoded = decodeRetroArchConfigBytes(bytes)
  if (!decoded.ok) return decoded
  return { ok: true, text: decoded.text }
}

/**
 * Lee el cfg, valida UTF-8 y el tamaño, y solo escribe si el plan dice
 * que el texto cambió. Un `skip` no crea temporal ni backup.
 */
export async function applyRetroArchConfigPlan(
  configPath: string,
  plan: (text: string) => RetroArchNetworkWritePlan | RetroArchNetworkRestorePlan,
  options?: { allowCreate?: boolean }
): Promise<RetroArchConfigWriteResult> {
  const current = await readConfigText(configPath, options?.allowCreate === true)
  if (!current.ok) {
    console.warn(`[retro-pause-menu] retroarch.cfg no se toca (${current.reason}): ${configPath}`)
    return 'rejected'
  }
  const next = plan(current.text)
  if (next.action === 'skip') return 'skipped'
  await commitRetroArchConfigAtomically(configPath, next.text)
  return 'written'
}
