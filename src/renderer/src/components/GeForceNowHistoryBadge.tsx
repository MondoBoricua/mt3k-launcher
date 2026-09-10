import type { LibraryGame } from '@shared/ipc'
import badge from '@renderer/assets/geforce-now-badge.svg'
import { isCloudHomeGame } from '@renderer/lib/homeGameEntries'

export function GeForceNowHistoryBadge({ game, align = 'left' }: {
  game: LibraryGame
  align?: 'left' | 'right'
}): JSX.Element | null {
  if (!isCloudHomeGame(game)) return null
  return <img
    data-geforce-now-history-badge="true"
    src={badge}
    alt="GeForce NOW"
    draggable={false}
    width={96}
    height={26}
    className={`pointer-events-none absolute ${align === 'right' ? 'right-2' : 'left-2'} top-2 z-30 h-auto w-24 max-w-[calc(100%-1rem)] drop-shadow-md`}
  />
}
