import { motion } from 'framer-motion'
import type { useT } from '@renderer/i18n/useT'

export function SettingsToggle({
  id,
  active,
  title,
  description,
  defaultActive,
  defaultInactive,
  disabled = false,
  onChange,
  t
}: {
  id: string
  active: boolean
  title: string
  description: string
  defaultActive?: boolean
  defaultInactive?: boolean
  disabled?: boolean
  onChange: (active: boolean) => void
  t: ReturnType<typeof useT>
}): JSX.Element {
  return (
    <motion.button
      data-focusable
      type="button"
      data-disabled={disabled ? 'true' : undefined}
      disabled={disabled}
      data-setting-toggle={id}
      aria-pressed={active}
      onClick={() => {
        if (!disabled) onChange(!active)
      }}
      whileHover={{ y: -2 }}
      className={`flex items-center justify-between gap-5 rounded-2xl border border-white/[0.07] bg-black/20 p-4 text-left ${
        disabled ? 'opacity-45' : ''
      }`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-white/85">{title}</p>
          {defaultActive && (
            <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[9px] uppercase tracking-wider text-white/40">
              {t('settings.defaultOn')}
            </span>
          )}
          {defaultInactive && (
            <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[9px] uppercase tracking-wider text-white/40">
              {t('settings.defaultOff')}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted">{description}</p>
      </div>
      <span
        className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${
          active ? 'border-accent/60 bg-accent' : 'border-white/10 bg-white/10'
        }`}
      >
        <motion.span
          animate={{ x: active ? 22 : 3 }}
          transition={{ type: 'spring', stiffness: 500, damping: 32 }}
          className={`absolute top-1 h-5 w-5 rounded-full ${active ? 'bg-black' : 'bg-white/60'}`}
        />
      </span>
    </motion.button>
  )
}
