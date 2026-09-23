import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { isRestoreJournal, type RestoreJournal } from '../shared/launchProfilePolicy'

export function readRestoreJournal(file: string): RestoreJournal | null {
  if (!existsSync(file)) return null
  const data: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (!isRestoreJournal(data)) throw new Error('Invalid display restore journal')
  return data
}

export function writeRestoreJournal(file: string, journal: RestoreJournal): void {
  if (!isRestoreJournal(journal)) throw new Error('Invalid display restore journal')
  writeFileSync(`${file}.tmp`, JSON.stringify(journal), { mode: 0o600, flush: true })
  renameSync(`${file}.tmp`, file)
}

export function clearRestoreJournal(file: string): void {
  if (existsSync(file)) unlinkSync(file)
}
