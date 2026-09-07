import { memo } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { BadgeCheck, CloudLightning, Download, UsersRound } from 'lucide-react'
import type { GameProvider, LibraryGame } from '@shared/ipc'
import { GameImage } from './GameImage'
import { useT } from '@renderer/i18n/useT'
import type { TranslationKey } from '@renderer/i18n/translations'
import { formatPlaytime } from '@renderer/lib/playtime'
import { useActivateGameCard } from '@renderer/hooks/useActivateGameCard'
import type { GameCardActivationTarget } from '@renderer/lib/gameCardActivation'
import { useGeForceNowStore } from '@renderer/state/geForceNowStore'
import {
  HomeCardReflection,
  type HomeCardReflectionState
} from './HomeCardReflection'
import { GameCardMenuHint } from './GameCardMenuHint'
import { LibraryProviderBadge } from './LibraryProviderBadge'
import { GameRunningIndicator } from './GameRunningIndicator'
import { useRunningGameId } from '@renderer/state/runningGameContext'
import { isNewXboxGamePassMembership } from '@shared/xboxGamePassHistory'

const PROVIDER_LABEL_KEYS = {
  steam: 'library.source.steam',
  epic: 'library.source.epic',
  gog: 'library.source.gog',
  xbox: 'library.source.xbox',
  playstation: 'library.source.playstation',
  retro: 'library.source.retro',
  ea: 'library.source.ea',
  ubisoft: 'library.source.ubisoft',
  local: 'library.source.local'
} satisfies Record<GameProvider, TranslationKey>

interface Props {
  game: LibraryGame
  navigationIndex?: number
  homeReflection?: HomeCardReflectionState | null
  onActiveChange?: (
    game: LibraryGame,
    active: boolean,
    source: 'focus' | 'pointer'
  ) => void
  activationTarget?: GameCardActivationTarget
  variant?: 'poster' | 'home' | 'float'
}

function GameCardComponent({
  game,
  navigationIndex,
  homeReflection,
  onActiveChange,
  activationTarget = 'default',
  variant = 'poster'
}: Props): JSX.Element {
  const t = useT()
  const reduceMotion = useReducedMotion()
  const playtime = formatPlaytime(game, t)
  const providerLabel = t(PROVIDER_LABEL_KEYS[game.provider])
  const activateGameCard = useActivateGameCard()
  const geForceNowMatch = useGeForceNowStore((state) => state.matchesByGameId[game.id])
  const runningGameId = useRunningGameId()
  const isRunning = runningGameId === game.id
  // Cloud availability only changes presentation inside the cloud view. The
  // same uninstalled PC title remains muted in All and provider libraries.
  const showUninstalledState =
    !game.installed &&
    game.provider !== 'playstation' &&
    activationTarget !== 'geforce-now'
  const entitlement = game.metadata.entitlement
  const isNewGamePass = isNewXboxGamePassMembership(entitlement?.membershipDetectedAt)
  const entitlementLabel =
    entitlement?.kind === 'subscription'
      ? t('library.entitlement.gamePass')
      : entitlement?.kind === 'purchased'
        ? t('library.entitlement.purchased')
        : undefined
  const isHomeCard = variant === 'home' || variant === 'float'
  const activeMotion = reduceMotion ? { scale: 1, y: 0 } : { scale: 1.025, y: -1 }
  const homeMotion = isHomeCard
    ? homeReflection?.distance === 0
      ? activeMotion
      : { scale: 1, y: 0 }
    : undefined

  return (
    <motion.button
      data-focusable
      data-game-card="true"
      data-game-id={game.id}
      data-game-activation-target={activationTarget}
      data-game-installed={game.installed ? 'true' : 'false'}
      data-game-unavailable-locally={showUninstalledState ? 'true' : 'false'}
      data-game-running={isRunning ? 'true' : undefined}
      data-grid-index={navigationIndex}
      data-home-game-card={isHomeCard ? 'true' : undefined}
      aria-label={[
        game.name,
        providerLabel,
        game.libraryAccess === 'shared' ? t('details.steamShared') : undefined,
        entitlementLabel,
        isNewGamePass ? t('library.gamePass.newBadge') : undefined,
        geForceNowMatch ? t('library.geforceNow.available') : undefined,
        isRunning ? t('launch.running') : undefined,
        showUninstalledState ? t('library.notInstalled') : undefined,
        game.updateAvailable ? t('library.updateAvailable') : undefined
      ]
        .filter(Boolean)
        .join('. ')}
      onClick={() => activateGameCard(game.id, activationTarget)}
      onMouseEnter={() => onActiveChange?.(game, true, 'pointer')}
      onMouseLeave={(event) => {
        const next = event.relatedTarget
        if (next instanceof Element && next.closest('[data-home-game-card="true"]')) return
        onActiveChange?.(game, false, 'pointer')
      }}
      onFocus={() => onActiveChange?.(game, true, 'focus')}
      onBlur={(event) => {
        const next = event.relatedTarget as HTMLElement | null
        if (isHomeCard && next?.matches('[data-home-game-card="true"]')) return
        onActiveChange?.(game, false, 'focus')
      }}
      animate={homeMotion}
      whileHover={isHomeCard ? undefined : activeMotion}
      whileFocus={isHomeCard ? undefined : activeMotion}
      transition={
        reduceMotion
          ? { duration: 0 }
          : { duration: 0.115, ease: [0.22, 1, 0.36, 1] }
      }
      className={`group relative isolate w-full scroll-m-[clamp(1rem,4vh,2.5rem)] overflow-hidden rounded-xl2 bg-surface-2 text-left shadow-card ${
        isHomeCard ? 'home-card-convex ' : ''
      }${
        variant === 'home' ? 'aspect-[1/1.08]' : 'aspect-[2/3]'
      }`}
    >
      <GameRunningIndicator active={isRunning} className="bottom-2 right-2" />
      {/* Home shelves are still cover slots. Horizontal artwork is reserved for
          hero/backdrop surfaces; here it crops sparse backgrounds into blank tiles. */}
      <GameImage
        gameId={game.id}
        name={game.name}
        orientation="vertical"
        className={`game-card-artwork h-full w-full object-cover ${isHomeCard ? 'object-top' : ''}`}
      />
      {showUninstalledState && (
        <>
          <span
            aria-hidden="true"
            data-uninstalled-game-tint
            className="pointer-events-none absolute inset-0 z-10"
            style={{
              backgroundColor: 'rgb(var(--color-uninstalled-game))',
              mixBlendMode: 'color'
            }}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10 bg-black/20"
          />
          <span className="pointer-events-none absolute bottom-2 left-2 z-30 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-full border border-white/15 bg-black/75 px-2 py-1 text-[8px] font-bold uppercase tracking-[0.1em] text-white/82 shadow-card backdrop-blur-md">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: 'rgb(var(--color-uninstalled-game))' }}
            />
            <span className="truncate">{t('library.notInstalled')}</span>
          </span>
        </>
      )}
      <div
        data-game-card-badges="true"
        className={`absolute left-2 right-10 top-2 z-30 flex items-center gap-1 overflow-hidden ${
          isHomeCard
            ? 'opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[focused=true]:opacity-100 motion-reduce:transition-none'
            : ''
        }`}
      >
        <LibraryProviderBadge
          provider={game.provider}
          size={isHomeCard ? 'compact' : 'default'}
        />
        {entitlement?.kind === 'purchased' ? (
          <span
            data-game-entitlement="purchased"
            aria-hidden="true"
            title={entitlementLabel}
            className="flex h-7 shrink-0 items-center gap-1 rounded-[0.56rem] border border-sky-200/30 bg-[#07131f]/90 px-2 text-[8px] font-black uppercase tracking-[0.08em] text-sky-200 shadow-card backdrop-blur-md"
          >
            <BadgeCheck size={12} strokeWidth={2.4} />
            {t('library.entitlement.ownedShort')}
          </span>
        ) : null}
        {game.provider === 'steam' && game.libraryAccess === 'shared' && (
          <span
            data-steam-family-badge="true"
            aria-hidden="true"
            title={t('details.steamShared')}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[0.56rem] border border-sky-200/30 bg-[#07131f]/90 text-sky-200 shadow-card backdrop-blur-md"
          >
            <UsersRound size={15} strokeWidth={2.25} />
          </span>
        )}
        {geForceNowMatch && (
          <span
            data-geforce-now-badge="true"
            aria-hidden="true"
            title={t('library.geforceNow.available')}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[0.56rem] border border-[#9ee34b]/35 bg-[#0b1606]/90 text-[#a8e95a] shadow-card backdrop-blur-md"
          >
            <CloudLightning size={15} strokeWidth={2.25} />
          </span>
        )}
      </div>
      {isHomeCard && homeReflection && (
        <HomeCardReflection reflection={homeReflection} />
      )}
      <div className="pointer-events-none absolute inset-0 z-20 bg-gradient-to-t from-black/90 via-black/10 to-transparent opacity-0 transition-opacity group-hover:opacity-100 group-data-[focused=true]:opacity-100" />
      <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-end p-3 opacity-0 transition-opacity group-hover:opacity-100 group-data-[focused=true]:opacity-100">
        <p className="line-clamp-2 text-sm font-semibold text-white">{game.name}</p>
        {playtime && <p className="text-xs text-muted">{playtime}</p>}
      </div>
      {game.updateAvailable && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-0 z-20 flex items-center gap-1.5 rounded-bl-xl bg-accent px-3 py-2 text-xs font-bold text-black shadow-card"
        >
          <Download size={14} strokeWidth={2.5} />
          <span>{t('library.updateBadge')}</span>
        </div>
      )}
      <GameCardMenuHint
        className={`absolute right-2 z-20 opacity-0 transition-opacity group-hover:opacity-100 group-data-[focused=true]:opacity-100 ${
          game.updateAvailable ? 'top-11' : 'top-2'
        }`}
      />
    </motion.button>
  )
}

function sameReflection(
  left: HomeCardReflectionState | null | undefined,
  right: HomeCardReflectionState | null | undefined
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return (
    left.sourceIndex === right.sourceIndex &&
    left.distance === right.distance &&
    left.edge === right.edge &&
    left.strength === right.strength &&
    left.reach === right.reach
  )
}

export const GameCard = memo(
  GameCardComponent,
  (previous, next) =>
    previous.game === next.game &&
    previous.navigationIndex === next.navigationIndex &&
    previous.onActiveChange === next.onActiveChange &&
    previous.activationTarget === next.activationTarget &&
    previous.variant === next.variant &&
    sameReflection(previous.homeReflection, next.homeReflection)
)
