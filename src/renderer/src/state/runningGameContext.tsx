import { createContext, useContext, type ReactNode } from 'react'

const RunningGameContext = createContext<string | undefined>(undefined)
const RunningGameSourceContext = createContext<'local' | 'geforce-now'>('local')

export function RunningGameProvider({
  gameId,
  source = 'local',
  children
}: {
  gameId?: string
  source?: 'local' | 'geforce-now'
  children: ReactNode
}): JSX.Element {
  return (
    <RunningGameSourceContext.Provider value={source}>
      <RunningGameContext.Provider value={gameId}>{children}</RunningGameContext.Provider>
    </RunningGameSourceContext.Provider>
  )
}

export function useRunningGameId(): string | undefined {
  return useContext(RunningGameContext)
}

export function useRunningGameSource(): 'local' | 'geforce-now' {
  return useContext(RunningGameSourceContext)
}
