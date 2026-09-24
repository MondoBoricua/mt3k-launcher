import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { formatLogLine, LOG_MAX_BYTES, type DiagnosticLevel } from '../shared/diagnosticLogPolicy'

/** No Electron dependency so the real disk writer can be verified with pure Node. */
export function createDiagnosticWriter(
  directory: string,
  io: { appendFile: typeof appendFile } = { appendFile }
) {
  const path = join(directory, 'mt3k-launcher.log')
  let pending = Promise.resolve()
  return {
    path,
    write(level: DiagnosticLevel, message: string): Promise<void> {
      pending = pending.then(async () => {
        let line = Buffer.from(formatLogLine(level, message))
        if (line.length > LOG_MAX_BYTES) {
          // Decode a bounded prefix and discard any incomplete final UTF-8 character.
          const prefix = line.subarray(0, LOG_MAX_BYTES - 32).toString('utf8').replace(/\uFFFD$/, '')
          line = Buffer.from(`${prefix} [truncated]\n`)
        }
        await mkdir(directory, { recursive: true })
        let size = 0
        try { size = (await stat(path)).size } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        if (size > 0 && size + line.length > LOG_MAX_BYTES) {
          await rm(`${path}.1`, { force: true })
          await rename(path, `${path}.1`)
        }
        await io.appendFile(path, line)
      }).catch(() => {
        // Logging must never cause another failure, including disk/permission errors.
      })
      return pending
    },
    flush(): Promise<void> { return pending }
  }
}
