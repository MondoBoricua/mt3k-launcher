import { create } from 'zustand'
import type { XboxAccount, XboxLoginStatus } from '@shared/ipc'

interface XboxAuthState {
  available: boolean
  account: XboxAccount | null
  status: XboxLoginStatus
  restore: () => Promise<void>
  startLogin: () => Promise<void>
  cancelLogin: () => Promise<void>
  logout: () => Promise<void>
}

let unsubscribe: (() => void) | null = null

function listen(set: (partial: Partial<XboxAuthState>) => void): void {
  unsubscribe?.()
  unsubscribe = window.api.xbox.onStatus((status) => {
    set({ status })
    if (status.state === 'success') set({ account: status.account })
  })
}

export const useXboxAuthStore = create<XboxAuthState>((set, get) => ({
  available: false,
  account: null,
  status: { state: 'idle' },

  restore: async () => {
    const connection = await window.api.xbox.getConnection()
    set({ available: connection.available, account: connection.account })
  },

  startLogin: async () => {
    if (!get().available || get().status.state === 'waiting-for-browser') return
    listen(set)
    set({ status: { state: 'waiting-for-browser' } })
    try {
      await window.api.xbox.startLogin()
    } catch (error) {
      set({
        status: {
          state: 'error',
          message: error instanceof Error ? error.message : 'Xbox sign-in could not be started.'
        }
      })
    }
  },

  cancelLogin: async () => {
    await window.api.xbox.cancelLogin()
    set({ status: { state: 'idle' } })
  },

  logout: async () => {
    await window.api.xbox.logout()
    set({ account: null, status: { state: 'idle' } })
  }
}))
