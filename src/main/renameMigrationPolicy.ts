import { join, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import type * as syncFs from 'node:fs'
import type * as asyncFs from 'node:fs/promises'

export function migrateUserData(oldPath: string, newPath: string,
  fs: Pick<typeof syncFs, 'existsSync' | 'renameSync'>
): { path: string; status: string; error?: string } {
  if (fs.existsSync(newPath)) return { path: newPath, status: fs.existsSync(oldPath) ? 'both-exist-old-left-in-place' : 'new' }
  if (!fs.existsSync(oldPath)) return { path: newPath, status: 'fresh' }
  try {
    fs.renameSync(oldPath, newPath)
    return { path: newPath, status: 'moved' }
  } catch (error) {
    return { path: oldPath, status: 'retry-next-start', error: String(error) }
  }
}

export function documentsRoot(documents: string, exists: (path: string) => boolean): string {
  const next = join(documents, 'MT3K Launcher')
  const old = join(documents, 'ORBIT')
  return exists(next) || !exists(old) ? next : old
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function fileUrl(value: string): string {
  return /^[a-z]:[\\/]/i.test(value)
    ? `file:///${value.replace(/\\/g, '/').split('/').map((part, i) => i === 0 ? part : encodeURIComponent(part)).join('/')}`
    : pathToFileURL(value).href
}

/** Match complete prefixes only; preserve the separator/JSON escaping used by each occurrence. */
export function rewritePathPrefixes(text: string, oldPath: string, newPath: string, windows = process.platform === 'win32'): string {
  const flags = windows ? 'gi' : 'g'
  const forms: [string, string][] = [
    [fileUrl(oldPath), fileUrl(newPath)],
    [oldPath.replace(/\\/g, '/'), newPath.replace(/\\/g, '/')],
    [oldPath.replace(/\//g, '\\'), newPath.replace(/\//g, '\\')]
  ]
  // Configs may embed JSON strings, with doubled backslashes or escaped slashes.
  for (const [old, next] of [...forms]) forms.unshift([JSON.stringify(old).slice(1, -1), JSON.stringify(next).slice(1, -1)])
  for (const [old, next] of forms) {
    text = text.replace(new RegExp(`${escapeRegex(old)}(?=$|[\\\\/\\s"'<>?#])`, flags), () => next)
  }
  return text
}

export function rewriteJsonPaths(text: string, oldPath: string, newPath: string, windows = process.platform === 'win32'): string {
  JSON.parse(text)
  const rewritten = rewritePathPrefixes(text, oldPath, newPath, windows)
  JSON.parse(rewritten)
  return rewritten
}

export const LAUNCHER_EXECUTABLES = ['MT3KLauncher.exe', 'ORBIT.exe'] as const
export function preferredLauncherExecutable(names: readonly string[]): string | undefined {
  return LAUNCHER_EXECUTABLES.find(name => names.some(actual => actual.toLowerCase() === name.toLowerCase()))
}

type MigrationFs = Pick<typeof asyncFs, 'lstat' | 'rename' | 'readFile' | 'writeFile' | 'mkdir' | 'readdir'>
interface Journal {
  oldPath: string; newPath: string; moved: boolean; complete: boolean
  rewritten: string[]; skipped: string[]; errors: string[]; rewrittenCount: number
}
const TEXT_EXTENSIONS = new Set(['.cfg', '.ini', '.json', '.txt', '.opt', '.lpl', '.yml', '.xml', '.conf'])

/** Atomic rename only. A durable intent journal makes a crash after moving resumable.
 * Each file is validated and atomically replaced; incomplete runs retry on next startup.
 * Symlinks are never followed and both-existing folders are never merged. */
export async function migrateDocuments(documents: string, userData: string, fs: MigrationFs,
  log: (message: string) => void, windows = process.platform === 'win32'): Promise<void> {
  const oldPath = join(documents, 'ORBIT')
  const newPath = join(documents, 'MT3K Launcher')
  const journalPath = join(userData, 'migrations', 'documents-folder.json')
  const exists = async (p: string): Promise<boolean> => {
    try { await fs.lstat(p); return true } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }
  const atomicWrite = async (p: string, text: string): Promise<void> => {
    const temporary = `${p}.mt3k-migration.tmp`
    await fs.writeFile(temporary, text, 'utf8')
    await fs.rename(temporary, p)
  }
  let journal: Journal = { oldPath, newPath, moved: false, complete: false, rewritten: [], skipped: [], errors: [], rewrittenCount: 0 }
  try {
    if (await exists(journalPath)) {
      const saved = JSON.parse(await fs.readFile(journalPath, 'utf8')) as Journal
      if (saved.oldPath === oldPath && saved.newPath === newPath) journal = saved
      if (journal.complete) return
    }
    const oldExists = await exists(oldPath)
    const newExists = await exists(newPath)
    if (oldExists && newExists) { log('[migration] Both Documents folders exist; old folder left untouched'); return }
    if (!oldExists && !newExists) return
    await fs.mkdir(join(userData, 'migrations'), { recursive: true })
    if (oldExists) {
      if (!(await fs.lstat(oldPath)).isDirectory()) throw new Error('Legacy Documents folder is not a directory')
      await atomicWrite(journalPath, JSON.stringify(journal, null, 2))
      try { await fs.rename(oldPath, newPath) } catch (error) {
        log(`[migration] Documents move failed; keeping old paths: ${String(error)}`)
        return
      }
    }
    if (!(await fs.lstat(newPath)).isDirectory()) throw new Error('Documents target is not a directory')
    journal.moved = journal.moved || oldExists
    journal.errors = []
    journal.skipped = []
    const rewrite = async (p: string, json: boolean): Promise<void> => {
      try {
        const info = await fs.lstat(p)
        if (!info.isFile() || info.size > 8 * 1024 * 1024) { journal.skipped.push(p); return }
        const bytes = await fs.readFile(p)
        let text: string
        try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
        catch { journal.skipped.push(p); return }
        if (/[\u0000-\u0008\u000e-\u001f]/u.test(text)) { journal.skipped.push(p); return }
        const bom = text.startsWith('\uFEFF') ? '\uFEFF' : ''
        const body = bom ? text.slice(1) : text
        const updated = bom + (json ? rewriteJsonPaths(body, oldPath, newPath, windows) : rewritePathPrefixes(body, oldPath, newPath, windows))
        if (updated !== text) {
          await atomicWrite(p, updated)
          if (!journal.rewritten.includes(p)) journal.rewritten.push(p)
          journal.rewrittenCount = journal.rewritten.length
          await atomicWrite(journalPath, JSON.stringify(journal, null, 2))
        }
      } catch (error) { journal.errors.push(`${p}: ${String(error)}`) }
    }
    for (const entry of await fs.readdir(userData, { withFileTypes: true })) {
      if (entry.isFile() && extname(entry.name).toLowerCase() === '.json') await rewrite(join(userData, entry.name), true)
    }
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const p = join(directory, entry.name)
        if (entry.isDirectory()) await walk(p)
        else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) await rewrite(p, extname(entry.name).toLowerCase() === '.json')
      }
    }
    await walk(newPath)
    journal.complete = journal.errors.length === 0
    await atomicWrite(journalPath, JSON.stringify(journal, null, 2))
    log(`[migration] Documents ${JSON.stringify(journal)}`)
  } catch (error) { log(`[migration] Documents migration will retry: ${String(error)}`) }
}
