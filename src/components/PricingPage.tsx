import {
  MONTHLY_PLANS,
  QUARTERLY_PLANS,
  TRIAL_CALCULATIONS,
  type PricingPlan,
} from '../data/pricingPlans'
import { useLocale } from '../i18n/LocaleContext'
import type { MessageKey } from '../i18n/messages'
import {
  cancelUserSubscription,
  startBillingPortal,
  startCheckout,
} from '../services/billing'
import { rememberCheckoutPlan } from '../services/googleAds'
import {
  eurToRsd,
  fetchNbsMiddleRsdPerEur,
  type ExchangeRate,
} from '../services/exchangeRate'
import type { QuotaSnapshot } from '../types/billing'
import { BugReportButton } from './BugReportButton'
import { LanguageToggle } from './LanguageToggle'
import { AdUnit } from './AdUnit'
import { ConfirmDialog } from './ConfirmDialog'
import { useEffect, useState } from 'react'

interface PricingPageProps {
  onBack: () => void
  showLoginHint?: boolean
  isAuthenticated?: boolean
  quota?: QuotaSnapshot | null
  onRequireLogin?: () => void
  onQuotaChange?: (quota: QuotaSnapshot) => void
}

const PLAN_BLURB: Record<string, MessageKey> = {
  'lite-1m': 'planLiteBlurb',
  'starter-1m': 'planStarterBlurb',
  'standard-1m': 'planStandardBlurb',
  'pro-1m': 'planProBlurb',
  'starter-3m': 'planStarterQBlurb',
  'standard-3m': 'planStandardQBlurb',
  'pro-3m': 'planProQBlurb',
}

const ALL_PLANS = [...MONTHLY_PLANS, ...QUARTERLY_PLANS]

function PayPalMark({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`paypal-mark ${className}`.trim()}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#003087"
        d="M7.2 21.2H4.7c-.4 0-.7-.3-.6-.7L6.5 3.6c.1-.4.4-.7.8-.7h6.7c2.2 0 3.8.5 4.7 1.6.8 1 1 2.4.6 4.1-.1.5-.3 1-.5 1.4l-.1.2c-1 2.8-3.3 3.8-6.4 3.8H9.6c-.4 0-.7.3-.8.7l-.8 5.1c0 .2-.2.4-.4.4H7.2z"
      />
      <path
        fill="#009CDE"
        d="M19.3 8.6c0 .2-.1.3-.1.5-1.1 3.2-3.5 4.4-7 4.4h-1.7c-.4 0-.8.3-.9.7l-1 6.4c0 .2.1.4.3.4h2.4c.3 0 .6-.2.7-.6l.1-.3.6-3.6.0-.2c.1-.4.4-.6.8-.6h.5c3.2 0 5.7-1.3 6.4-5 .3-1.5.1-2.8-.6-3.7-.2-.3-.5-.5-.8-.7.1.3.2.7.2 1.1z"
      />
      <path
        fill="#012169"
        d="M18.4 8.1c-.2-.1-.4-.1-.6-.2-.2 0-.4-.1-.6-.1h-5.3c-.1 0-.3 0-.4.1-.3.1-.5.4-.5.7l-.9 5.9v.2c.1-.4.4-.7.8-.7h1.8c3.5 0 5.9-1.2 7-4.4.1-.2.1-.3.1-.5-.4-.3-.9-.6-1.4-.9z"
      />
    </svg>
  )
}

function planLabel(planId: string | null | undefined): string {
  if (!planId) return '—'
  const plan = ALL_PLANS.find((p) => p.id === planId)
  if (!plan) return planId
  return `${plan.name} (${plan.period === 'month' ? '1m' : '3m'})`
}

function PlanCard({
  plan,
  disabled,
  busy,
  isCurrent,
  isSubscribed,
  onSubscribe,
  wide = false,
  exchangeRate,
}: {
  plan: PricingPlan
  disabled: boolean
  busy: boolean
  isCurrent: boolean
  isSubscribed: boolean
  onSubscribe: (planId: string) => void
  wide?: boolean
  exchangeRate: ExchangeRate | null
}) {
  const { locale, t, numberLocale } = useLocale()
  const periodKey: MessageKey =
    plan.period === 'month' ? 'periodMonth' : 'periodQuarter'
  const blurbKey = PLAN_BLURB[plan.id] ?? 'planStarterBlurb'
  const showRsd = locale === 'sr' && exchangeRate != null

  let cta = t('subscribe')
  if (busy) {
    cta = isSubscribed ? t('changingPlan') : t('subscribing')
  } else if (isCurrent) {
    cta = t('currentPlan')
  } else if (isSubscribed) {
    cta = t('changePlan')
  }

  return (
    <article
      className={`pricing-card${wide ? ' is-wide' : ''}${plan.featured ? ' is-featured' : ''}${isCurrent ? ' is-current' : ''}`}
    >
      {plan.featured && !isCurrent ? (
        <span className="pricing-badge">{t('recommended')}</span>
      ) : null}
      {isCurrent ? (
        <span className="pricing-badge pricing-badge-current">
          {t('currentPlan')}
        </span>
      ) : null}
      <h3 className="pricing-card-name">{plan.name}</h3>
      <p className="pricing-card-blurb">{t(blurbKey)}</p>
      <p className="pricing-card-price">
        <strong>{plan.priceEur} €</strong>
        <span> / {t(periodKey)}</span>
      </p>
      {showRsd ? (
        <p className="pricing-card-rsd">
          {t('pricingApproxRsd', {
            rsd: eurToRsd(plan.priceEur, exchangeRate.rsdPerEur).toLocaleString(
              numberLocale,
            ),
            date: exchangeRate.date,
          })}
        </p>
      ) : null}
      {plan.compareAtEur != null && plan.savingsEur != null ? (
        <p className="pricing-card-save">
          {t('insteadSave', {
            compare: plan.compareAtEur,
            save: plan.savingsEur,
          })}
        </p>
      ) : (
        <p className="pricing-card-save pricing-card-save-spacer">&nbsp;</p>
      )}
      <p className="pricing-card-limit">
        {t('upToCalcs', {
          limit: plan.monthlyLimit.toLocaleString(numberLocale),
        })}
      </p>
      <button
        type="button"
        className={`btn ${isCurrent ? 'btn-secondary' : 'btn-secondary'} pricing-card-cta`}
        disabled={disabled || busy || isCurrent}
        onClick={() => onSubscribe(plan.id)}
      >
        {!isCurrent ? <PayPalMark /> : null}
        <span>{cta}</span>
      </button>
    </article>
  )
}

function TrialParagraph() {
  const { t } = useLocale()
  const text = t('pricingTrialBody', { trial: TRIAL_CALCULATIONS })
  const token = String(TRIAL_CALCULATIONS)
  const idx = text.indexOf(token)
  if (idx < 0) return <p>{text}</p>

  const after = text.slice(idx + token.length)
  const endMatch = after.match(/^[^.]*/)
  const boldEnd = endMatch ? endMatch[0].length : 0

  return (
    <p>
      {text.slice(0, idx)}
      <strong>
        {token}
        {after.slice(0, boldEnd)}
      </strong>
      {after.slice(boldEnd)}
    </p>
  )
}

export function PricingPage({
  onBack,
  showLoginHint = false,
  isAuthenticated = false,
  quota = null,
  onRequireLogin,
  onQuotaChange,
}: PricingPageProps) {
  const { locale, t, numberLocale } = useLocale()
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null)
  const [portalBusy, setPortalBusy] = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [upgradePlanId, setUpgradePlanId] = useState<string | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [exchangeRate, setExchangeRate] = useState<ExchangeRate | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchNbsMiddleRsdPerEur().then((rate) => {
      if (!cancelled) setExchangeRate(rate)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const checkoutBusy = busyPlanId !== null
  const actionBusy = checkoutBusy || portalBusy || cancelBusy
  const isSubscribed = quota?.plan === 'subscribed'
  const currentPlanId = quota?.planId ?? null

  async function beginCheckout(planId: string) {
    setError(null)
    setNotice(null)
    setBusyPlanId(planId)
    try {
      rememberCheckoutPlan(planId)
      const { url } = await startCheckout(planId)
      window.location.href = url
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('genericError'))
      setBusyPlanId(null)
    }
  }

  async function handleSubscribe(planId: string) {
    if (!isAuthenticated) {
      onRequireLogin?.()
      return
    }
    if (currentPlanId === planId) return

    if (isSubscribed && quota && quota.remaining > 0) {
      setUpgradePlanId(planId)
      return
    }

    await beginCheckout(planId)
  }

  async function handlePortal() {
    setError(null)
    setPortalBusy(true)
    try {
      const url = await startBillingPortal()
      window.location.href = url
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('genericError'))
      setPortalBusy(false)
    }
  }

  async function runCancel() {
    setError(null)
    setNotice(null)
    setCancelBusy(true)
    try {
      const next = await cancelUserSubscription()
      onQuotaChange?.(next)
      setNotice(t('cancelSuccess'))
      setCancelOpen(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('genericError'))
    } finally {
      setCancelBusy(false)
    }
  }

  const periodEndLabel = (() => {
    if (!quota?.periodEnd) return null
    const date = new Date(quota.periodEnd)
    if (Number.isNaN(date.getTime())) return null
    return date.toLocaleString(numberLocale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  })()

  return (
    <div className="pricing-page">
      <header className="pricing-top">
        <div className="pricing-top-row">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}>
            {showLoginHint ? t('pricingBackLogin') : t('pricingBackApp')}
          </button>
          <div className="pricing-top-actions">
            <LanguageToggle />
            <BugReportButton
              className="btn btn-secondary btn-sm"
              title={t('bugReportTitle')}
            />
          </div>
        </div>
      </header>

      <div className="pricing-inner">
        <p className="pricing-eyebrow">{t('pricingEyebrow')}</p>
        <h1 className="pricing-title">{t('pricingTitle')}</h1>
        <p className="pricing-hero">
          {t('pricingHero', { trial: TRIAL_CALCULATIONS })}
        </p>

        <section className="pricing-payment" aria-labelledby="pricing-payment-title">
          <h2 id="pricing-payment-title">{t('pricingPaymentTitle')}</h2>
          <p>{t('pricingPaymentBody')}</p>
          {locale === 'sr' ? (
            <p className="pricing-payment-disclaimer">{t('pricingFxDisclaimer')}</p>
          ) : null}
        </section>

        {!isAuthenticated ? (
          <p className="pricing-login-hint">{t('loginToSubscribe')}</p>
        ) : null}

        {quota ? (
          <p className="pricing-quota">
            {t('quotaLabel', {
              remaining: quota.remaining,
              limit: quota.limit,
            })}
            {quota.plan === 'subscribed' && periodEndLabel
              ? ` · ${t('quotaUntil', { date: periodEndLabel })}`
              : ''}
          </p>
        ) : null}

        {isAuthenticated && isSubscribed ? (
          <section className="pricing-manage">
            <h2>{t('subscriptionPanelTitle')}</h2>
            <p>
              {t('subscriptionActivePlan', {
                plan: planLabel(currentPlanId),
              })}
            </p>
            <p>
              {periodEndLabel
                ? t('subscriptionValidUntil', { date: periodEndLabel })
                : t('subscriptionValidUntilUnknown')}
            </p>
            {quota?.queuedPlanId ? (
              <>
                <p className="pricing-queued">
                  {t('subscriptionQueuedPlan', {
                    plan: planLabel(quota.queuedPlanId),
                  })}
                </p>
                <p className="pricing-manage-hint">{t('upgradeHoldNotice')}</p>
              </>
            ) : quota?.cancelAtPeriodEnd ? (
              <p className="pricing-manage-hint">
                {t('subscriptionCancelledPending')}
              </p>
            ) : (
              <p className="pricing-manage-hint">{t('subscriptionManageHint')}</p>
            )}
            <div className="pricing-manage-actions">
              <button
                type="button"
                className="btn btn-secondary btn-with-paypal"
                disabled={actionBusy}
                onClick={() => void handlePortal()}
              >
                <PayPalMark />
                <span>
                  {portalBusy ? t('openingPortal') : t('manageSubscription')}
                </span>
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={actionBusy || Boolean(quota?.cancelAtPeriodEnd)}
                onClick={() => setCancelOpen(true)}
              >
                {cancelBusy ? t('cancellingSubscription') : t('cancelSubscription')}
              </button>
            </div>
          </section>
        ) : null}

        {notice ? (
          <p className="pricing-notice" role="status">
            {notice}
          </p>
        ) : null}

        {error ? (
          <p className="login-error" role="alert">
            {error}
          </p>
        ) : null}

        {!isAuthenticated ? (
          <section className="pricing-trial">
            <h2>{t('pricingTrialTitle')}</h2>
            <TrialParagraph />
          </section>
        ) : null}

        <section className="pricing-section">
          <h2>{t('pricingMonthly')}</h2>
          <div className="pricing-grid">
            {MONTHLY_PLANS.filter((plan) => plan.id === 'lite-1m').map(
              (plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  wide
                  disabled={actionBusy}
                  busy={busyPlanId === plan.id}
                  isCurrent={currentPlanId === plan.id}
                  isSubscribed={Boolean(isSubscribed)}
                  onSubscribe={(planId) => void handleSubscribe(planId)}
                  exchangeRate={exchangeRate}
                />
              ),
            )}
            {MONTHLY_PLANS.filter((plan) => plan.id !== 'lite-1m').map(
              (plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  disabled={actionBusy}
                  busy={busyPlanId === plan.id}
                  isCurrent={currentPlanId === plan.id}
                  isSubscribed={Boolean(isSubscribed)}
                  onSubscribe={(planId) => void handleSubscribe(planId)}
                  exchangeRate={exchangeRate}
                />
              ),
            )}
          </div>
        </section>

        <section className="pricing-section">
          <h2>{t('pricingQuarterly')}</h2>
          <p className="pricing-section-note">{t('pricingQuarterlyNote')}</p>
          <div className="pricing-grid">
            {QUARTERLY_PLANS.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                disabled={actionBusy}
                busy={busyPlanId === plan.id}
                isCurrent={currentPlanId === plan.id}
                isSubscribed={Boolean(isSubscribed)}
                onSubscribe={(planId) => void handleSubscribe(planId)}
                exchangeRate={exchangeRate}
              />
            ))}
          </div>
        </section>

        <section className="pricing-faq">
          <h2>{t('pricingFaq')}</h2>
          <dl>
            <div>
              <dt>{t('faqQ1')}</dt>
              <dd>{t('faqA1')}</dd>
            </div>
            <div>
              <dt>{t('faqQ2')}</dt>
              <dd>{t('faqA2')}</dd>
            </div>
            <div>
              <dt>{t('faqQ3')}</dt>
              <dd>{t('faqA3')}</dd>
            </div>
            <div>
              <dt>{t('faqQ4')}</dt>
              <dd>{t('faqA4')}</dd>
            </div>
            <div>
              <dt>{t('faqQ5')}</dt>
              <dd>{t('faqA5')}</dd>
            </div>
            <div>
              <dt>{t('faqQ6')}</dt>
              <dd>{t('disclaimer')}</dd>
            </div>
          </dl>
        </section>

        <p className="pricing-legal">
          <a href="/privacy" className="link-btn">
            {t('privacyLink')}
          </a>
        </p>

        <div className="pricing-ad-wrap">
          <AdUnit slot={import.meta.env.VITE_ADSENSE_SLOT_PRICING} />
        </div>
      </div>

      <ConfirmDialog
        open={upgradePlanId !== null}
        title={t('upgradeHoldTitle')}
        message={t('upgradeHoldConfirm')}
        cancelLabel={t('dialogBack')}
        confirmLabel={t('dialogContinuePayPal')}
        busy={checkoutBusy}
        onCancel={() => {
          if (!checkoutBusy) setUpgradePlanId(null)
        }}
        onConfirm={() => {
          if (!upgradePlanId) return
          const planId = upgradePlanId
          setUpgradePlanId(null)
          void beginCheckout(planId)
        }}
      />

      <ConfirmDialog
        open={cancelOpen}
        title={t('cancelConfirmTitle')}
        message={t('cancelConfirm')}
        cancelLabel={t('dialogBack')}
        confirmLabel={t('cancelConfirmYes')}
        danger
        busy={cancelBusy}
        onCancel={() => {
          if (!cancelBusy) setCancelOpen(false)
        }}
        onConfirm={() => {
          void runCancel()
        }}
      />
    </div>
  )
}
