import { join, extname, dirname, basename, isAbsolute, win32 } from 'node:path'
import { pathToFileURL } from 'node:url'
import type * as syncFs from 'node:fs'
import type * as asyncFs from 'node:fs/promises'

const USER_MARKERS = ['orbit-settings.json', 'orbit-library-v2.json']
const DOCUMENT_MARKERS = ['Emulators', 'ROMs']
function hasMarker(root: string, markers: string[], exists: (path: string) => boolean): boolean {
  return markers.some(marker => exists(join(root, marker)))
}

export function migrateUserData(oldPath: string, newPath: string,
  fs: Pick<typeof syncFs, 'existsSync' | 'renameSync' | 'rmdirSync'>
): { path: string; status: string; error?: string } {
  const oldExists = fs.existsSync(oldPath)
  const newExists = fs.existsSync(newPath)
  if (!oldExists) return { path: newPath, status: newExists ? 'new' : 'fresh' }
  if (newExists) {
    const oldLibrary = hasMarker(oldPath, USER_MARKERS, fs.existsSync)
    const newLibrary = hasMarker(newPath, USER_MARKERS, fs.existsSync)
    if (!oldLibrary || newLibrary) return { path: newPath, status: 'both-exist-old-left-in-place' }
    // rmdir removes only an empty directory; stale data is never deleted/merged.
    try { fs.rmdirSync(newPath) } catch (error) {
      if (!fs.existsSync(oldPath) && fs.existsSync(newPath)) return { path: newPath, status: 'concurrent-move', error: String(error) }
      return { path: oldPath, status: 'stale-target-old-library-retained', error: String(error) }
    }
  }
  try {
    fs.renameSync(oldPath, newPath)
    return { path: newPath, status: 'moved' }
  } catch (error) {
    // Another import-time startup may have completed the rename before this one.
    if (fs.existsSync(newPath)) return { path: newPath, status: 'concurrent-move', error: String(error) }
    return { path: oldPath, status: 'retry-next-start', error: String(error) }
  }
}

export function documentsRoot(documents: string, exists: (path: string) => boolean): string {
  const next = join(documents, 'MT3K Launcher')
  const old = join(documents, 'ORBIT')
  if (exists(old) && (!exists(next) ||
    (hasMarker(old, DOCUMENT_MARKERS, exists) && !hasMarker(next, DOCUMENT_MARKERS, exists)))) return old
  return next
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
  const encodedPath = (value: string): string => value.replace(/\\/g, '/').split('/').map((part, i) => i === 0 ? part : encodeURIComponent(part)).join('/')
  const forms: [string, string][] = [
    [fileUrl(oldPath), fileUrl(newPath)],
    [fileUrl(oldPath).replace('file:///', 'file://'), fileUrl(newPath).replace('file:///', 'file://')],
    [encodedPath(oldPath), encodedPath(newPath)],
    [oldPath.replace(/\\/g, '/'), newPath.replace(/\\/g, '/')],
    [oldPath.replace(/\//g, '\\'), newPath.replace(/\//g, '\\')]
  ]
  for (const [old, next] of [...forms]) {
    forms.unshift([old.replaceAll('/', '\\/'), next.replaceAll('/', '\\/')])
  }
  // Configs may embed JSON strings, with doubled backslashes or escaped slashes.
  for (const [old, next] of [...forms]) forms.unshift([JSON.stringify(old).slice(1, -1), JSON.stringify(next).slice(1, -1)])
  for (const [old, next] of forms.sort((a, b) => b[0].length - a[0].length)) {
    text = text.replace(new RegExp(`${escapeRegex(old)}(?=$|[\\\\/\\s"'<>?#,)])`, flags), () => next)
  }
  return text
}

export function containsOldPathPrefix(text: string, oldPath: string, windows: boolean): boolean {
  const normalize = (value: string): string => {
    try { value = decodeURIComponent(value) } catch { /* retain malformed escapes */ }
    value = value.replace(/\\+/g, '/').replace(/\/+/g, '/')
    return windows ? value.toLowerCase() : value
  }
  return new RegExp(`${escapeRegex(normalize(oldPath))}(?=$|[/\\s"'<>?#,)])`).test(normalize(text))
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

type MigrationFs = Pick<typeof asyncFs, 'lstat' | 'rename' | 'readFile' | 'writeFile' | 'mkdir' | 'readdir' | 'rmdir' | 'stat' | 'readlink' | 'symlink' | 'unlink'>
interface PendingLink { path: string; target: string; directory: boolean }
interface Journal {
  links?: PendingLink[]
  rewriteDocuments?: boolean
  version?: number; movePending?: boolean; oldPath: string; newPath: string; moved: boolean; complete: boolean
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
  let journal: Journal = { version: 2, oldPath, newPath, moved: false, complete: false, rewritten: [], skipped: [], errors: [], rewrittenCount: 0 }
  try {
    if (await exists(journalPath)) {
      const saved = JSON.parse(await fs.readFile(journalPath, 'utf8')) as Journal
      if (saved.oldPath === oldPath && saved.newPath === newPath) journal = saved
      if (journal.complete && journal.version === 2) return
    }
    let oldExists = await exists(oldPath)
    let newExists = await exists(newPath)
    const resuming = !journal.complete && (journal.moved || journal.movePending || journal.rewriteDocuments || (journal.version === undefined && await exists(journalPath) && newExists))
    let rewriteDocuments = newExists && !oldExists
    await fs.mkdir(join(userData, 'migrations'), { recursive: true })
    if (oldExists && newExists && !resuming) {
      const oldLibrary = (await Promise.all(DOCUMENT_MARKERS.map(m => exists(join(oldPath, m))))).some(Boolean)
      const newLibrary = (await Promise.all(DOCUMENT_MARKERS.map(m => exists(join(newPath, m))))).some(Boolean)
      if (oldLibrary && !newLibrary) {
        try { await fs.rmdir(newPath); newExists = false }
        catch { log('[migration] Stale Documents target retained; using legacy library and retrying next start') }
      } else log('[migration] WARNING: Both Documents folders exist; no merge, old folder left untouched')
    }
    if (oldExists && !newExists) {
      if (!(await fs.stat(oldPath)).isDirectory()) throw new Error('Legacy Documents folder is not a directory')
      journal.movePending = true
      await atomicWrite(journalPath, JSON.stringify(journal, null, 2))
      try { await fs.rename(oldPath, newPath); oldExists = false; newExists = true; journal.moved = true }
      catch (error) { journal.movePending = false; log(`[migration] Documents move failed; keeping old paths: ${String(error)}`) }
    }
    rewriteDocuments = rewriteDocuments || (newExists && (resuming || !oldExists))
    const prefixes: [string, string][] = []
    if (rewriteDocuments) prefixes.push([oldPath, newPath])
    // Only rewrite Roaming paths when this run actually uses the new profile.
    if (['MT3K Launcher', 'mt3k-launcher'].includes(basename(userData))) {
      prefixes.push([join(dirname(userData), basename(userData) === 'mt3k-launcher' ? 'orbit' : 'ORBIT'), userData])
    }
    journal.version = 2
    journal.errors = []
    journal.skipped = []
    journal.rewriteDocuments = rewriteDocuments
    await atomicWrite(journalPath, JSON.stringify(journal, null, 2))
    const rewrite = async (p: string, json: boolean): Promise<void> => {
      try {
        const info = await fs.lstat(p)
        if (!info.isFile() || info.size > 8 * 1024 * 1024) { journal.skipped.push(p); throw new Error('Text file cannot be verified (type/size)') }
        const bytes = await fs.readFile(p)
        let text: string
        try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
        catch { journal.skipped.push(p); throw new Error('Text file is not decodable UTF-8') }
        if (/[\u0000-\u0008\u000e-\u001f]/u.test(text)) { journal.skipped.push(p); throw new Error('Text file contains binary control characters') }
        const bom = text.startsWith('\uFEFF') ? '\uFEFF' : ''
        const body = bom ? text.slice(1) : text
        let updated = body
        for (const [old, next] of prefixes) updated = json ? rewriteJsonPaths(updated, old, next, windows) : rewritePathPrefixes(updated, old, next, windows)
        for (const [old] of prefixes) {
          if (containsOldPathPrefix(updated, old, windows)) throw new Error(`Unresolved old prefix: ${old}`)
        }
        updated = bom + updated
        if (updated !== text) {
          await atomicWrite(p, updated)
          if (!journal.rewritten.includes(p)) journal.rewritten.push(p)
          journal.rewrittenCount = journal.rewritten.length
          await atomicWrite(journalPath, JSON.stringify(journal, null, 2))
        }
      } catch (error) { journal.errors.push(`${p}: ${String(error)}`) }
    }
    const finishLink = async (link: PendingLink): Promise<void> => {
      const temporary = `${link.path}.mt3k-link.tmp`
      // Persist intent before replacing the link itself, including Windows
      // directory junctions, so a crash between unlink and rename resumes.
      await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
      await fs.symlink(link.target, temporary, link.directory ? 'junction' : 'file')
      if (await exists(link.path)) {
        if (!(await fs.lstat(link.path)).isSymbolicLink()) throw new Error('Refusing to replace a non-link')
        await fs.unlink(link.path)
      }
      await fs.rename(temporary, link.path)
      if (!journal.rewritten.includes(link.path)) journal.rewritten.push(link.path)
      journal.rewrittenCount = journal.rewritten.length
      journal.links = journal.links?.filter(item => item.path !== link.path)
      await atomicWrite(journalPath, JSON.stringify(journal, null, 2))
    }
    for (const link of [...journal.links ?? []]) {
      try { await finishLink(link) } catch (error) { journal.errors.push(`${link.path}: ${String(error)}`) }
    }
    const rewriteLink = async (p: string): Promise<void> => {
      if (p.endsWith('.mt3k-link.tmp')) return
      try {
        const target = await fs.readlink(p)
        if (!isAbsolute(target) && !win32.isAbsolute(target)) return
        let updated = target
        for (const [old, next] of prefixes) updated = rewritePathPrefixes(updated, old, next, windows)
        if (updated === target) return
        // Inspect the new target's type, never its contents. The old target may
        // already be dangling because its parent directory was just renamed.
        const directory = await fs.stat(updated).then(info => info.isDirectory(), () => false)
        const link = { path: p, target: updated, directory }
        journal.links = [...journal.links?.filter(item => item.path !== p) ?? [], link]
        await atomicWrite(journalPath, JSON.stringify(journal, null, 2))
        await finishLink(link)
      } catch (error) { journal.errors.push(`${p}: ${String(error)}`) }
    }
    for (const entry of await fs.readdir(userData, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) await rewriteLink(join(userData, entry.name))
      else if (entry.isFile() && extname(entry.name).toLowerCase() === '.json') await rewrite(join(userData, entry.name), true)
    }
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const p = join(directory, entry.name)
        if (entry.isSymbolicLink()) await rewriteLink(p)
        else if (entry.isDirectory()) await walk(p)
        else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) await rewrite(p, extname(entry.name).toLowerCase() === '.json')
      }
    }
    if (rewriteDocuments) {
      if ((await fs.lstat(newPath)).isSymbolicLink()) await rewriteLink(newPath)
      else await walk(newPath)
    }
    journal.complete = newExists && journal.errors.length === 0 && !(oldExists && !rewriteDocuments)
    await atomicWrite(journalPath, JSON.stringify(journal, null, 2))
    log(`[migration] Documents ${JSON.stringify(journal)}`)
  } catch (error) { log(`[migration] Documents migration will retry: ${String(error)}`) }
}
