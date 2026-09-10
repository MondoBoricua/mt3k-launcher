import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  type CSSProperties
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Loader2, type LucideIcon } from 'lucide-react'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useFocusScope } from '@renderer/hooks/useFocusScope'

export interface GameDetailActionMenuItem {
  id: string
  label: string
  icon: LucideIcon
  onSelect: () => void
  disabled?: boolean
  busy?: boolean
  checked?: boolean
  keepOpen?: boolean
  separatorBefore?: boolean
  tone?: 'default' | 'accent' | 'warning' | 'danger'
}

interface GameDetailActionMenuProps {
  label: string
  icon: LucideIcon
  items: GameDetailActionMenuItem[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const GameDetailActionMenu = forwardRef<
  HTMLButtonElement,
  GameDetailActionMenuProps
>(function GameDetailActionMenu(
  { label, icon: Icon, items, open, onOpenChange },
  ref
): JSX.Element {
  const internalButtonRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  useImperativeHandle(ref, () => internalButtonRef.current as HTMLButtonElement, [])

  return (
    <>
      <button
        ref={internalButtonRef}
        data-focusable
        type="button"
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => onOpenChange(true)}
        className="game-detail-action game-detail-action--combo border-white/15 bg-white/[0.07] text-white hover:bg-white/15"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <Icon size={16} className="shrink-0" />
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown
          size={17}
          className={`shrink-0 text-white/45 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <GameDetailActionMenuPopup
              anchor={internalButtonRef.current}
              id={menuId}
              label={label}
              items={items}
              onClose={() => onOpenChange(false)}
            />
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
})

function popupPosition(anchor: HTMLElement | null): CSSProperties {
  const viewportPadding = 12
  if (!anchor) {
    return {
      right: viewportPadding,
      bottom: viewportPadding,
      width: 320,
      maxHeight: 'calc(100vh - 24px)'
    }
  }

  const rect = anchor.getBoundingClientRect()
  const width = Math.min(Math.max(rect.width, 360), window.innerWidth - viewportPadding * 2)
  const left = Math.min(
    Math.max(viewportPadding, rect.left),
    window.innerWidth - width - viewportPadding
  )
  const spaceBelow = window.innerHeight - rect.bottom - viewportPadding
  const spaceAbove = rect.top - viewportPadding
  const openAbove = spaceBelow < 300 && spaceAbove > spaceBelow
  const availableHeight = Math.max(
    176,
    Math.min(440, openAbove ? spaceAbove - 8 : spaceBelow - 8)
  )

  return openAbove
    ? { left, bottom: window.innerHeight - rect.top + 8, width, maxHeight: availableHeight }
    : { left, top: rect.bottom + 8, width, maxHeight: availableHeight }
}

function GameDetailActionMenuPopup({
  anchor,
  id,
  label,
  items,
  onClose
}: {
  anchor: HTMLButtonElement | null
  id: string
  label: string
  items: GameDetailActionMenuItem[]
  onClose: () => void
}): JSX.Element {
  const scopeRef = useRef<HTMLDivElement>(null)
  const firstItemRef = useRef<HTMLButtonElement>(null)

  useBackHandler(onClose)
  useFocusScope({
    scopeRef,
    resolveFocusTarget: () => firstItemRef.current,
    returnFocus: anchor
  })

  useEffect(() => {
    const closeOnResize = (): void => onClose()
    window.addEventListener('resize', closeOnResize)
    return () => window.removeEventListener('resize', closeOnResize)
  }, [onClose])

  const firstEnabledIndex = items.findIndex((item) => !item.disabled)

  return (
    <motion.div
      ref={scopeRef}
      data-focus-scope="active"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      className="fixed inset-0 z-[70] bg-black/25"
    >
      <motion.div
        id={id}
        role="menu"
        aria-label={label}
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 5, scale: 0.985 }}
        transition={{ duration: 0.14 }}
        style={popupPosition(anchor)}
        className="game-detail-action-menu scrollbar-none fixed overflow-y-auto rounded-2xl border border-white/[0.12] bg-[rgb(var(--color-surface-2)/0.98)] p-2 shadow-2xl backdrop-blur-2xl"
      >
        {items.map((item, index) => {
          const ItemIcon = item.icon
          const checked = item.checked !== undefined
          return (
            <div key={item.id} role="none">
              {item.separatorBefore && (
                <div role="separator" className="mx-2 my-1.5 h-px bg-white/[0.08]" />
              )}
              <button
                ref={index === firstEnabledIndex ? firstItemRef : undefined}
                data-focusable
                data-disabled={item.disabled ? 'true' : undefined}
                type="button"
                role={checked ? 'menuitemcheckbox' : 'menuitem'}
                aria-checked={checked ? item.checked : undefined}
                aria-busy={item.busy || undefined}
                disabled={item.disabled}
                onClick={() => {
                  item.onSelect()
                  if (!item.keepOpen) onClose()
                }}
                className={`game-detail-action-menu__item ${toneClass(item.tone)} ${
                  item.checked ? 'bg-accent/[0.12] text-accent' : ''
                }`}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="game-detail-action-menu__icon">
                    {item.busy ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <ItemIcon size={16} />
                    )}
                  </span>
                  <span className="truncate">{item.label}</span>
                </span>
                {checked && (
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      item.checked ? 'bg-accent' : 'bg-white/15'
                    }`}
                  />
                )}
              </button>
            </div>
          )
        })}
      </motion.div>
    </motion.div>
  )
}

function toneClass(tone: GameDetailActionMenuItem['tone']): string {
  switch (tone) {
    case 'accent':
      return 'text-accent hover:bg-accent/[0.12]'
    case 'warning':
      return 'text-amber-100 hover:bg-amber-300/[0.1]'
    case 'danger':
      return 'text-rose-200 hover:bg-rose-300/[0.1]'
    default:
      return 'text-white/72 hover:bg-white/[0.07] hover:text-white'
  }
}
