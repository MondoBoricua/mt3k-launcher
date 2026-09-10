import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react'
import { useIsPresent } from 'framer-motion'
import { ChevronDown, type LucideIcon } from 'lucide-react'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { focusElement } from '@renderer/lib/spatialNavigation'

const SectionsContext = createContext<{
  expandedId: string | null
  toggle: (id: string) => void
} | null>(null)

/** One open topic per category; mounted panels retain unfinished input when folded. */
export function SettingsSections({
  children,
  initialExpandedId = null
}: {
  children: React.ReactNode
  initialExpandedId?: string | null
}): JSX.Element {
  const [expandedId, setExpandedId] = useState<string | null>(initialExpandedId)
  const rootRef = useRef<HTMLDivElement>(null)
  const isPresent = useIsPresent()

  useLayoutEffect(() => {
    rootRef.current?.toggleAttribute('inert', !isPresent)
  }, [isPresent])

  useBackHandler(() => {
    const header = rootRef.current?.querySelector<HTMLElement>(
      '[data-settings-section-header][aria-expanded="true"]'
    )
    focusElement(header ?? null, { ensureVisible: false })
    setExpandedId(null)
  }, isPresent && expandedId !== null)

  return (
    <SectionsContext.Provider
      value={{
        expandedId,
        toggle: (id) => setExpandedId((current) => current === id ? null : id)
      }}
    >
      <div ref={rootRef} className="settings-sections">
        {children}
      </div>
    </SectionsContext.Provider>
  )
}

export function SettingsSection({
  id,
  icon: Icon,
  title,
  description,
  summary,
  children
}: {
  id: string
  icon: LucideIcon
  title: string
  description: string
  summary?: React.ReactNode
  children: React.ReactNode
}): JSX.Element {
  const context = useContext(SectionsContext)
  if (!context) throw new Error('SettingsSection requires SettingsSections')
  const expanded = context.expandedId === id
  const [visited, setVisited] = useState(false)
  const headerRef = useRef<HTMLButtonElement>(null)
  const headerId = `settings-${id}-header`
  const panelId = `settings-${id}-panel`

  // Re-check visibility after the previous topic has collapsed and layout has settled.
  useLayoutEffect(() => {
    if (document.activeElement === headerRef.current) focusElement(headerRef.current)
  }, [context.expandedId])

  return (
    <section
      data-settings-section={id}
      className={`settings-section relative rounded-xl2 border shadow-card backdrop-blur-xl ${
        expanded
          ? 'border-accent/25 bg-white/[0.035]'
          : 'border-white/[0.07] bg-white/[0.025]'
      }`}
    >
      <h2>
        <button
          ref={headerRef}
          id={headerId}
          type="button"
          data-focusable
          data-settings-section-header={id}
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => {
            focusElement(headerRef.current, { ensureVisible: false })
            setVisited(true)
            context.toggle(id)
          }}
          className="flex w-full items-center gap-3 rounded-xl2 px-5 py-3 text-left transition-colors hover:bg-white/[0.04]"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.07] bg-black/25 text-accent">
            <Icon size={17} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-white/85">{title}</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-white/45">{description}</span>
          </span>
          {summary && (
            <span className="max-w-[30%] shrink-0 text-right text-xs font-medium text-accent">
              {summary}
            </span>
          )}
          <ChevronDown
            size={17}
            aria-hidden="true"
            className={`shrink-0 text-white/45 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
      </h2>
      <div
        id={panelId}
        role="region"
        aria-labelledby={headerId}
        data-settings-section-content
        hidden={!expanded}
        className="border-t border-white/[0.07] p-5"
      >
        {(expanded || visited) && children}
      </div>
    </section>
  )
}
