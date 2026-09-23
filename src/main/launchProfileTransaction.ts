import { randomUUID } from 'node:crypto'
import { restorePlan, type DisplaySnapshot, type RestoreJournal, type LaunchProfileEvent } from '../shared/launchProfilePolicy'

export interface DisplayTransactionDependencies {
  read: () => RestoreJournal | null
  write: (journal: RestoreJournal) => void
  clear: () => void
  apply: (snapshot: DisplaySnapshot) => void
  emit: (event: LaunchProfileEvent) => void
  schedule: (callback: () => void) => () => void
  now: () => number
}

/** Single owner for the journal and rollback deadline. Failed restores retain the journal. */
export class LaunchProfileTransaction {
  private journal: RestoreJournal | null = null
  private pending: { token: string; expiresAt: number; resolve: (confirmed: boolean) => void; cancel: () => void } | null = null
  private readonly deps: DisplayTransactionDependencies
  constructor(deps: DisplayTransactionDependencies) { this.deps = deps }

  recover(): boolean {
    try {
      this.journal = this.deps.read()
      return this.restore()
    } catch (error) {
      console.warn('[launch-profiles] Recovery failed:', error)
      this.deps.emit({ kind: 'error' })
      return false
    }
  }

  begin(previous: DisplaySnapshot, applied: DisplaySnapshot): Promise<boolean> {
    if (this.pending || this.journal) return Promise.resolve(false)
    if (!restorePlan(previous, applied)) return Promise.resolve(true)
    try {
      const journal: RestoreJournal = { version: 1, previous, applied }
      this.deps.write(journal) // Durable before the first display mutation.
      this.journal = journal
      this.deps.apply(applied)
    } catch (error) {
      console.warn('[launch-profiles] Apply failed:', error)
      this.restore()
      this.deps.emit({ kind: 'error' })
      return Promise.resolve(false)
    }
    return new Promise((resolve) => {
      const token = randomUUID()
      this.pending = { token, expiresAt: this.deps.now() + 15_000, resolve, cancel: this.deps.schedule(() => {
        if (this.restore()) this.deps.emit({ kind: 'restored' })
      }) }
      this.deps.emit({ kind: 'confirm', token, profile: { ...applied.profile } })
    })
  }

  confirm(token: unknown): boolean {
    if (typeof token !== 'string' || token !== this.pending?.token) return false
    if (this.deps.now() >= this.pending.expiresAt) {
      if (this.restore()) this.deps.emit({ kind: 'restored' })
      return false
    }
    const pending = this.pending
    this.pending = null
    pending.cancel()
    this.deps.emit({ kind: 'closed' })
    pending.resolve(true)
    return true
  }

  /** Hay un journal en memoria que todavía no se pudo devolver. */
  hasJournal(): boolean {
    return this.journal !== null
  }

  /** El usuario todavía está en el aviso de "¿ves esta pantalla?". */
  confirmationPending(): boolean {
    return this.pending !== null
  }

  /**
   * Borra el journal sin tocar la pantalla.
   * Si hay una confirmación en curso, no hace nada: ese aviso tiene su propio cancelar.
   */
  forget(): boolean {
    if (this.pending) return false
    this.journal = null
    this.deps.clear()
    return true
  }

  restore(): boolean {
    const pending = this.pending
    this.pending = null
    pending?.cancel()
    try {
      if (this.journal) {
        this.deps.apply(this.journal.previous)
        this.deps.clear()
        this.journal = null
      }
      if (pending) this.deps.emit({ kind: 'closed' })
      return true
    } catch (error) {
      console.warn('[launch-profiles] Restore failed; retaining journal:', error)
      this.deps.emit({ kind: 'error' })
      return false
    } finally {
      pending?.resolve(false)
    }
  }
}
