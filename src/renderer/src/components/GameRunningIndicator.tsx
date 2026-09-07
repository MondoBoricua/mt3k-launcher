interface Props {
  active: boolean
  className?: string
}

export function GameRunningIndicator({ active, className = '' }: Props): JSX.Element | null {
  if (!active) return null

  return (
    <span
      aria-hidden="true"
      data-game-running-indicator="true"
      className={`pointer-events-none absolute z-50 flex h-4 w-4 items-center justify-center rounded-full border border-white/25 bg-black/80 shadow-lg ${className}`}
    >
      <span
        className="block h-2.5 w-2.5 rounded-full"
        style={{
          backgroundColor: 'rgb(var(--color-game-running))',
          boxShadow: '0 0 10px rgb(var(--color-game-running) / 0.95)'
        }}
      />
    </span>
  )
}
