import { languageLocale } from '@shared/language'
import { motion } from 'framer-motion'
import {
  CalendarClock,
  Check,
  Crown,
  ExternalLink,
  KeyRound,
  Link2,
  Loader2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Unlink
} from 'lucide-react'
import { FocusableButton } from '@renderer/components/FocusableButton'
import { useT } from '@renderer/i18n/useT'
import type { TranslationKey } from '@renderer/i18n/translations'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { useOrbitPlusStore } from '@renderer/state/orbitPlusStore'
import type { OrbitPlusIssue } from '@shared/ipc'

const FEATURE_KEYS: TranslationKey[] = [
  'orbitPlus.benefit.cloudGaming',
  'orbitPlus.benefit.backgroundMotion',
  'orbitPlus.benefit.appearance',
  'orbitPlus.benefit.manualAudio'
]

const MEMBER_BENEFIT_KEYS: TranslationKey[] = [
  'orbitPlus.benefit.beta',
  'orbitPlus.benefit.polls',
  'orbitPlus.benefit.updates',
  'orbitPlus.benefit.influence'
]

const ISSUE_KEYS: Record<OrbitPlusIssue, TranslationKey> = {
  'service-not-configured': 'orbitPlus.issue.serviceNotConfigured',
  'secure-storage-unavailable': 'orbitPlus.issue.secureStorageUnavailable',
  'network-unavailable': 'orbitPlus.issue.networkUnavailable',
  'membership-required': 'orbitPlus.issue.membershipRequired',
  'owner-test-disabled': 'orbitPlus.issue.ownerTestDisabled',
  'session-expired': 'orbitPlus.issue.sessionExpired',
  'verification-failed': 'orbitPlus.issue.verificationFailed',
  cancelled: 'orbitPlus.issue.cancelled'
}

export function OrbitPlusPanel({ context = 'settings' }: { context?: 'onboarding' | 'settings' }): JSX.Element {
  const t = useT()
  const language = usePreferencesStore((state) => state.language)
  const snapshot = useOrbitPlusStore((state) => state.snapshot)
  const activity = useOrbitPlusStore((state) => state.activity)
  const issue = useOrbitPlusStore((state) => state.issue)
  const connectPatreon = useOrbitPlusStore((state) => state.connectPatreon)
  const cancelPatreon = useOrbitPlusStore((state) => state.cancelPatreon)
  const setOwnerTestAccess = useOrbitPlusStore((state) => state.setOwnerTestAccess)
  const refresh = useOrbitPlusStore((state) => state.refresh)
  const disconnect = useOrbitPlusStore((state) => state.disconnect)
  const openMembership = useOrbitPlusStore((state) => state.openMembership)
  const active = useOrbitPlusStore(
    (state) =>
      state.hasFeature('manual-audio') ||
      state.hasFeature('cloud-gaming') ||
      state.hasFeature('background-motion') ||
      state.hasFeature('premium-appearance')
  )
  const busy =
    activity === 'opening-browser' ||
    activity === 'waiting-for-browser' ||
    activity === 'verifying'
  const canConnect = snapshot.serviceAvailable && snapshot.secureStorageAvailable
  const accessLabel =
    snapshot.ownerTestAccess && !snapshot.ownerTestAccess.enabled
      ? t('orbitPlus.status.testInactive')
      : active
        ? snapshot.access === 'grace'
          ? t('orbitPlus.status.offline')
          : t('orbitPlus.status.active')
        : snapshot.connected
          ? t('orbitPlus.status.connected')
          : t('orbitPlus.status.locked')
  const expiration = snapshot.entitlement?.expiresAt
    ? new Intl.DateTimeFormat(languageLocale(language), {
        dateStyle: 'medium'
      }).format(snapshot.entitlement.expiresAt)
    : undefined

  return (
    <section className="relative overflow-hidden rounded-[1.75rem] border border-amber-200/15 bg-[linear-gradient(135deg,rgba(251,191,36,0.12),rgba(0,0,0,0.3)_42%,rgba(255,255,255,0.035))] shadow-card">
      <div className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full bg-amber-300/[0.08] blur-3xl" />
      <div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-amber-200/80 to-transparent" />

      <div className="relative grid gap-6 p-[clamp(1.25rem,3vw,2.25rem)] xl:grid-cols-[minmax(0,1.2fr)_minmax(24rem,0.8fr)]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-amber-200/25 bg-amber-300/10 text-amber-200 shadow-[0_0_24px_rgba(251,191,36,0.12)]">
              <Crown size={21} />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-200">
                  {t('orbitPlus.eyebrow')}
                </p>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.14em] ${
                    active
                      ? 'border-emerald-300/25 bg-emerald-300/10 text-emerald-200'
                      : 'border-amber-200/20 bg-amber-200/[0.07] text-amber-100/80'
                  }`}
                >
                  {accessLabel}
                </span>
              </div>
              <h2 className="mt-1 text-[clamp(1.65rem,3vw,2.7rem)] font-black leading-none tracking-[-0.04em] text-white">
                ORBIT <span className="text-amber-200">PLUS</span>
              </h2>
            </div>
          </div>

          <p className="mt-5 max-w-3xl text-sm leading-relaxed text-white/58">
            {t(context === 'onboarding' ? 'orbitPlus.onboardingBody' : 'orbitPlus.settingsBody')}
          </p>

          <div className="mt-5 flex flex-wrap items-end gap-x-3 gap-y-1">
            <span className="text-3xl font-black tracking-tight text-white">
              {t('orbitPlus.price')}
            </span>
            <span className="pb-1 text-xs font-semibold text-white/42">
              {t('orbitPlus.trial')}
            </span>
          </div>

          <div className="mt-5">
            <h3 className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-200/85">
              {t('orbitPlus.featuresTitle')}
            </h3>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {FEATURE_KEYS.map((key) => (
                <li
                  key={key}
                  data-orbit-plus-feature={key}
                  className="flex items-start gap-2 rounded-xl border border-amber-200/10 bg-amber-200/[0.035] px-3 py-2.5 text-xs leading-relaxed text-white/70"
                >
                  <Check size={14} strokeWidth={2.6} className="mt-0.5 shrink-0 text-amber-200" />
                  <span>{t(key)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-4 border-t border-white/[0.07] pt-4">
            <h3 className="text-[9px] font-black uppercase tracking-[0.16em] text-white/38">
              {t('orbitPlus.memberBenefitsTitle')}
            </h3>
            <ul className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
              {MEMBER_BENEFIT_KEYS.map((key) => (
                <li
                  key={key}
                  data-orbit-plus-member-benefit={key}
                  className="flex items-start gap-2 text-[11px] leading-relaxed text-white/52"
                >
                <Check size={14} strokeWidth={2.6} className="mt-0.5 shrink-0 text-amber-200" />
                <span>{t(key)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {!active && (
              <FocusableButton
                data-onboarding-primary={context === 'onboarding' ? true : undefined}
                onClick={() => void openMembership()}
                className="bg-amber-200 px-5 text-black hover:bg-amber-100"
              >
                <span className="flex items-center gap-2">
                  <ExternalLink size={14} />
                  {t('orbitPlus.openPatreon')}
                </span>
              </FocusableButton>
            )}

            {busy ? (
              <FocusableButton variant="ghost" onClick={() => void cancelPatreon()}>
                <span className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  {t('orbitPlus.cancel')}
                </span>
              </FocusableButton>
            ) : snapshot.connected ? (
              <>
                <FocusableButton variant="ghost" onClick={() => void refresh()}>
                  <span className="flex items-center gap-2">
                    <RefreshCw size={14} />
                    {t('orbitPlus.checkAgain')}
                  </span>
                </FocusableButton>
                {snapshot.ownerTestAccess && (
                  <FocusableButton
                    variant="ghost"
                    aria-pressed={snapshot.ownerTestAccess.enabled}
                    onClick={() =>
                      void setOwnerTestAccess(!snapshot.ownerTestAccess?.enabled)
                    }
                  >
                    <span className="flex items-center gap-2">
                      {snapshot.ownerTestAccess.enabled ? (
                        <ToggleRight size={15} />
                      ) : (
                        <ToggleLeft size={15} />
                      )}
                      {t(
                        snapshot.ownerTestAccess.enabled
                          ? 'orbitPlus.ownerTest.disable'
                          : 'orbitPlus.ownerTest.enable'
                      )}
                    </span>
                  </FocusableButton>
                )}
                <FocusableButton variant="ghost" onClick={() => void disconnect()}>
                  <span className="flex items-center gap-2">
                    <Unlink size={14} />
                    {t('orbitPlus.disconnect')}
                  </span>
                </FocusableButton>
              </>
            ) : (
              <FocusableButton
                variant={active ? 'solid' : 'ghost'}
                disabled={!canConnect}
                data-disabled={!canConnect ? 'true' : undefined}
                onClick={() => void connectPatreon()}
                className={!canConnect ? 'cursor-not-allowed opacity-45' : ''}
              >
                <span className="flex items-center gap-2">
                  <Link2 size={14} />
                  {t('orbitPlus.connectPatreon')}
                </span>
              </FocusableButton>
            )}
          </div>

          <div className="mt-4 min-h-5 text-[11px] leading-relaxed" aria-live="polite">
            {busy ? (
              <p className="flex items-center gap-2 text-amber-100/80">
                <Loader2 size={12} className="animate-spin" />
                {t(
                  activity === 'verifying'
                    ? 'orbitPlus.activity.verifying'
                    : 'orbitPlus.activity.browser'
                )}
              </p>
            ) : active ? (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-emerald-200/85">
                <ShieldCheck size={13} />
                <span>
                  {t('orbitPlus.activeAs', {
                    name: snapshot.accountName ?? t('orbitPlus.member')
                  })}
                  {expiration ? ` · ${t('orbitPlus.validUntil', { date: expiration })}` : ''}
                </span>
              </p>
            ) : issue ? (
              <p className="flex items-start gap-2 text-amber-100/70">
                <LockKeyhole size={12} className="mt-0.5 shrink-0" />
                {t(ISSUE_KEYS[issue])}
              </p>
            ) : (
              <p className="text-white/35">{t('orbitPlus.secureHint')}</p>
            )}
          </div>
        </div>

        <div className="grid content-start gap-3">
          <AccessRoute
            icon={Sparkles}
            title="Patreon"
            description={t('orbitPlus.route.patreon')}
            badge={active && snapshot.entitlement?.source === 'patreon' ? t('orbitPlus.active') : t('orbitPlus.available')}
            active={active && snapshot.entitlement?.source === 'patreon'}
          />
          <AccessRoute
            icon={CalendarClock}
            title={t('orbitPlus.route.annualTitle')}
            description={t('orbitPlus.route.annual')}
            badge={t('orbitPlus.later')}
          />
          <AccessRoute
            icon={KeyRound}
            title={t('orbitPlus.route.lifetimeTitle')}
            description={t('orbitPlus.route.lifetime')}
            badge={t('orbitPlus.later')}
          />
          <p className="px-1 pt-1 text-[10px] leading-relaxed text-white/28">
            {t('orbitPlus.providerNeutral')}
          </p>
        </div>
      </div>
    </section>
  )
}

function AccessRoute({
  icon: Icon,
  title,
  description,
  badge,
  active = false
}: {
  icon: typeof Sparkles
  title: string
  description: string
  badge: string
  active?: boolean
}): JSX.Element {
  return (
    <motion.article
      animate={{ borderColor: active ? 'rgba(110,231,183,0.3)' : 'rgba(255,255,255,0.075)' }}
      className={`rounded-2xl border p-4 ${
        active ? 'bg-emerald-300/[0.07]' : 'bg-black/20'
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
            active ? 'bg-emerald-300/12 text-emerald-200' : 'bg-white/[0.055] text-white/45'
          }`}
        >
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-sm font-bold text-white/85">{title}</h3>
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] ${
                active
                  ? 'border-emerald-300/20 bg-emerald-300/10 text-emerald-200'
                  : 'border-white/10 bg-white/[0.04] text-white/38'
              }`}
            >
              {badge}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-white/38">{description}</p>
        </div>
      </div>
    </motion.article>
  )
}
