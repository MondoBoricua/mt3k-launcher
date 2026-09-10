import { languageLocale } from '@shared/language'
import { motion } from 'framer-motion'
import { useState } from 'react'
import {
  CalendarClock,
  Check,
  Crown,
  ExternalLink,
  Eye,
  EyeOff,
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
import type {
  OrbitPlusCommerceOffer,
  OrbitPlusIssue,
  OrbitPlusPlan
} from '@shared/ipc'
import { ORBIT_PLUS_FEATURES } from '@shared/ipc'

const FEATURE_KEYS: TranslationKey[] = [
  'orbitPlus.benefit.cloudGaming',
  'orbitPlus.benefit.cuadroLayout',
  'orbitPlus.benefit.themes',
  'orbitPlus.benefit.launcherMusic',
  'orbitPlus.benefit.interfaceSounds',
  'orbitPlus.benefit.cornerStyling',
  'orbitPlus.benefit.achievementGuides',
  'orbitPlus.benefit.nextGamePicker',
  'orbitPlus.benefit.backgroundMotion'
]

const MEMBER_BENEFIT_KEYS: TranslationKey[] = [
  'orbitPlus.benefit.beta',
  'orbitPlus.benefit.polls',
  'orbitPlus.benefit.updates',
  'orbitPlus.benefit.influence'
]

const PLAN_KEYS: Record<OrbitPlusPlan, TranslationKey> = {
  monthly: 'orbitPlus.plan.monthly',
  annual: 'orbitPlus.plan.annual',
  lifetime: 'orbitPlus.plan.lifetime'
}

const ISSUE_KEYS: Record<OrbitPlusIssue, TranslationKey> = {
  'service-not-configured': 'orbitPlus.issue.serviceNotConfigured',
  'secure-storage-unavailable': 'orbitPlus.issue.secureStorageUnavailable',
  'network-unavailable': 'orbitPlus.issue.networkUnavailable',
  'membership-required': 'orbitPlus.issue.membershipRequired',
  'owner-test-disabled': 'orbitPlus.issue.ownerTestDisabled',
  'session-expired': 'orbitPlus.issue.sessionExpired',
  'verification-failed': 'orbitPlus.issue.verificationFailed',
  'license-invalid': 'orbitPlus.issue.licenseInvalid',
  'license-test-purchase': 'orbitPlus.issue.licenseTestPurchase',
  'license-product-mismatch': 'orbitPlus.issue.licenseProductMismatch',
  'license-expired': 'orbitPlus.issue.licenseExpired',
  'license-disabled': 'orbitPlus.issue.licenseDisabled',
  'license-activation-limit': 'orbitPlus.issue.licenseActivationLimit',
  'license-device-removed': 'orbitPlus.issue.licenseDeviceRemoved',
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
  const openCheckout = useOrbitPlusStore((state) => state.openCheckout)
  const activateLicense = useOrbitPlusStore((state) => state.activateLicense)
  const deactivateLicense = useOrbitPlusStore((state) => state.deactivateLicense)
  const setOwnerTestAccess = useOrbitPlusStore((state) => state.setOwnerTestAccess)
  const refresh = useOrbitPlusStore((state) => state.refresh)
  const disconnect = useOrbitPlusStore((state) => state.disconnect)
  const openMembership = useOrbitPlusStore((state) => state.openMembership)
  const [licenseKey, setLicenseKey] = useState('')
  const [licenseVisible, setLicenseVisible] = useState(false)
  const active = useOrbitPlusStore(
    (state) => ORBIT_PLUS_FEATURES.some((feature) => state.hasFeature(feature))
  )
  const busy =
    activity === 'opening-browser' ||
    activity === 'waiting-for-browser' ||
    activity === 'verifying'
  const patreonConnecting =
    activity === 'opening-browser' || activity === 'waiting-for-browser'
  const canConnect = snapshot.serviceAvailable && snapshot.secureStorageAvailable
  const accessLabel =
    snapshot.ownerTestAccess && !snapshot.ownerTestAccess.enabled
      ? t('orbitPlus.status.testInactive')
      : active
        ? snapshot.access === 'grace'
          ? t(snapshot.membership ? 'orbitPlus.status.grace' : 'orbitPlus.status.offline')
          : t('orbitPlus.status.active')
        : snapshot.connected
          ? t('orbitPlus.status.connected')
          : t('orbitPlus.status.locked')
  const paidThroughTimestamp =
    snapshot.membership?.paidThrough ?? snapshot.entitlement?.expiresAt
  const offlineProtectionTimestamp =
    Math.max(
      snapshot.membership?.graceUntil ?? 0,
      snapshot.entitlement?.offlineUntil ?? 0,
      snapshot.offlineAccessUntil ?? 0
    ) || undefined
  const formatDate = (timestamp: number | undefined): string | undefined =>
    timestamp
      ? new Intl.DateTimeFormat(languageLocale(language), {
          dateStyle: 'medium'
        }).format(timestamp)
      : undefined
  const paidThrough = formatDate(paidThroughTimestamp)
  const offlineProtection = formatDate(
    offlineProtectionTimestamp !== undefined &&
      (snapshot.access === 'grace' ||
        paidThroughTimestamp === undefined ||
        offlineProtectionTimestamp > paidThroughTimestamp)
      ? offlineProtectionTimestamp
      : undefined
  )
  const planLabel = snapshot.entitlement
    ? t(PLAN_KEYS[snapshot.entitlement.plan])
    : undefined
  const annualOffer = snapshot.offers?.find((offer) => offer.plan === 'annual')
  const lifetimeOffer = snapshot.offers?.find((offer) => offer.plan === 'lifetime')
  const commerceAvailable = snapshot.offers?.some((offer) => offer.available) ?? false
  const annualActive = snapshot.activeSources?.includes('annual-pass') ?? false
  const lifetimeActive = snapshot.activeSources?.includes('lifetime-key') ?? false
  const patreonActive = snapshot.activeSources?.includes('patreon') ?? false
  const licenseConfigured = snapshot.license?.configured ?? false
  const formatOfferPrice = (offer: OrbitPlusCommerceOffer | undefined): string | undefined =>
    offer
      ? new Intl.NumberFormat(languageLocale(language), {
          style: 'currency',
          currency: offer.currency
        }).format(offer.priceCents / 100)
      : undefined
  const activateCurrentLicense = async (): Promise<void> => {
    const key = licenseKey.trim()
    if (!key || busy) return
    const result = await activateLicense(key)
    if (result.license?.state === 'active' || result.license?.state === 'grace') {
      setLicenseKey('')
      setLicenseVisible(false)
    }
  }

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

          <p className="mt-5 text-xs font-semibold text-amber-100/65">
            {t(commerceAvailable ? 'orbitPlus.chooseAccess' : 'orbitPlus.preparingAccess')}
          </p>

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

            {patreonConnecting ? (
              <FocusableButton variant="ghost" onClick={() => void cancelPatreon()}>
                <span className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  {t('orbitPlus.cancel')}
                </span>
              </FocusableButton>
            ) : snapshot.connected ? (
              <>
                <FocusableButton variant="ghost" onClick={() => void refresh(true)}>
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
                disabled={!canConnect || busy}
                data-disabled={!canConnect || busy ? 'true' : undefined}
                onClick={() => void connectPatreon()}
                className={!canConnect || busy ? 'cursor-not-allowed opacity-45' : ''}
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
                    name:
                      snapshot.accountName ??
                      (snapshot.entitlement?.source === 'patreon'
                        ? t('orbitPlus.member')
                        : t('orbitPlus.licenseMember'))
                  })}
                  {planLabel ? ` · ${planLabel}` : ''}
                  {paidThrough ? ` · ${t('orbitPlus.paidThrough', { date: paidThrough })}` : ''}
                  {offlineProtection
                    ? ` · ${t('orbitPlus.offlineProtectedUntil', { date: offlineProtection })}`
                    : ''}
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
            badge={patreonActive ? t('orbitPlus.active') : t('orbitPlus.available')}
            active={patreonActive}
          />
          <AccessRoute
            icon={CalendarClock}
            title={t('orbitPlus.route.annualTitle')}
            description={t('orbitPlus.route.annual')}
            price={formatOfferPrice(annualOffer)}
            priceSuffix={t('orbitPlus.billing.yearly')}
            badge={
              annualActive
                ? t('orbitPlus.active')
                : !annualOffer?.available
                  ? t('orbitPlus.later')
                  : annualOffer.testMode
                  ? t('orbitPlus.testMode')
                  : t('orbitPlus.recurring')
            }
            active={annualActive}
            actionLabel={
              !annualActive && annualOffer?.available ? t('orbitPlus.buyAnnual') : undefined
            }
            onAction={() => void openCheckout('annual')}
          />
          <AccessRoute
            icon={KeyRound}
            title={t('orbitPlus.route.lifetimeTitle')}
            description={t('orbitPlus.route.lifetime')}
            price={formatOfferPrice(lifetimeOffer)}
            priceSuffix={t('orbitPlus.billing.once')}
            badge={
              lifetimeActive
                ? t('orbitPlus.active')
                : !lifetimeOffer?.available
                  ? t('orbitPlus.later')
                  : lifetimeOffer.testMode
                  ? t('orbitPlus.testMode')
                  : t('orbitPlus.once')
            }
            active={lifetimeActive}
            actionLabel={
              !lifetimeActive && lifetimeOffer?.available
                ? t('orbitPlus.buyLifetime')
                : undefined
            }
            onAction={() => void openCheckout('lifetime')}
          />

          {(commerceAvailable || licenseConfigured) && (
            <div className="rounded-2xl border border-amber-200/10 bg-amber-200/[0.035] p-4">
              <div className="flex items-center gap-2 text-amber-100/85">
                <KeyRound size={15} />
                <h3 className="text-xs font-black uppercase tracking-[0.12em]">
                  {t('orbitPlus.license.title')}
                </h3>
              </div>
              {commerceAvailable && (
                <>
                  <p className="mt-2 text-[11px] leading-relaxed text-white/42">
                    {t('orbitPlus.license.body')}
                  </p>
                  <div className="mt-3 flex items-center rounded-xl border border-white/10 bg-black/25 pr-1 focus-within:border-amber-200/35">
                    <input
                      data-focusable
                      type={licenseVisible ? 'text' : 'password'}
                      value={licenseKey}
                      maxLength={255}
                      autoComplete="off"
                      spellCheck={false}
                      aria-label={t('orbitPlus.license.placeholder')}
                      placeholder={t('orbitPlus.license.placeholder')}
                      onChange={(event) => setLicenseKey(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter') return
                        event.preventDefault()
                        void activateCurrentLicense()
                      }}
                      className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-xs text-white outline-none placeholder:text-white/28"
                    />
                    <button
                      data-focusable
                      type="button"
                      aria-label={t(
                        licenseVisible ? 'orbitPlus.license.hide' : 'orbitPlus.license.show'
                      )}
                      aria-pressed={licenseVisible}
                      onClick={() => setLicenseVisible((visible) => !visible)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/38 transition-colors hover:bg-white/[0.07] hover:text-white"
                    >
                      {licenseVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {commerceAvailable && (
                  <FocusableButton
                    disabled={!licenseKey.trim() || busy || !snapshot.secureStorageAvailable}
                    data-disabled={
                      !licenseKey.trim() || busy || !snapshot.secureStorageAvailable
                        ? 'true'
                        : undefined
                    }
                    onClick={() => void activateCurrentLicense()}
                    className="bg-amber-200 px-4 py-2 text-[11px] text-black hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <span className="flex items-center gap-2">
                      {busy && <Loader2 size={12} className="animate-spin" />}
                      {t('orbitPlus.license.activate')}
                    </span>
                  </FocusableButton>
                )}
                {licenseConfigured && (
                  <FocusableButton
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void deactivateLicense()}
                    className="px-4 py-2 text-[11px] disabled:opacity-45"
                  >
                    {t('orbitPlus.license.deactivate')}
                  </FocusableButton>
                )}
              </div>
              {licenseConfigured && snapshot.license && (
                <p
                  className={`mt-3 text-[10px] font-semibold ${
                    snapshot.license.state === 'active' || snapshot.license.state === 'grace'
                      ? 'text-emerald-200/75'
                      : 'text-amber-100/65'
                  }`}
                >
                  {t(`orbitPlus.license.state.${snapshot.license.state}` as TranslationKey)}
                </p>
              )}
            </div>
          )}
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
  active = false,
  price,
  priceSuffix,
  actionLabel,
  onAction
}: {
  icon: typeof Sparkles
  title: string
  description: string
  badge: string
  active?: boolean
  price?: string
  priceSuffix?: string
  actionLabel?: string
  onAction?: () => void
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
          {(price || actionLabel) && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              {price && (
                <p className="text-sm font-black tracking-tight text-white/88">
                  {price}
                  {priceSuffix && (
                    <span className="ml-1 text-[10px] font-semibold text-white/36">
                      {priceSuffix}
                    </span>
                  )}
                </p>
              )}
              {actionLabel && onAction && (
                <FocusableButton
                  onClick={onAction}
                  className="bg-amber-200 px-4 py-2 text-[10px] text-black hover:bg-amber-100"
                >
                  <span className="flex items-center gap-1.5">
                    <ExternalLink size={11} />
                    {actionLabel}
                  </span>
                </FocusableButton>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.article>
  )
}
