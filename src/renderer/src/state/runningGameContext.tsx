import { createContext, useContext, type ReactNode } from 'react'

const RunningGameContext = createContext<string | undefined>(undefined)

export function RunningGameProvider({
  gameId,
  children
}: {
  gameId?: string
  children: ReactNode
}): JSX.Element {
  return <RunningGameContext.Provider value={gameId}>{children}</RunningGameContext.Provider>
}

export function useRunningGameId(): string | undefined {
  return useContext(RunningGameContext)
}
