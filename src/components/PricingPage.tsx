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
import type { QuotaSnapshot } from '../types/billing'
import { BugReportButton } from './BugReportButton'
import { LanguageToggle } from './LanguageToggle'
import { useState } from 'react'

interface PricingPageProps {
  onBack: () => void
  showLoginHint?: boolean
  isAuthenticated?: boolean
  quota?: QuotaSnapshot | null
  onRequireLogin?: () => void
  onQuotaChange?: (quota: QuotaSnapshot) => void
}

const PLAN_BLURB: Record<string, MessageKey> = {
  'starter-1m': 'planStarterBlurb',
  'standard-1m': 'planStandardBlurb',
  'pro-1m': 'planProBlurb',
  'starter-3m': 'planStarterQBlurb',
  'standard-3m': 'planStandardQBlurb',
  'pro-3m': 'planProQBlurb',
}

const ALL_PLANS = [...MONTHLY_PLANS, ...QUARTERLY_PLANS]

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
}: {
  plan: PricingPlan
  disabled: boolean
  busy: boolean
  isCurrent: boolean
  isSubscribed: boolean
  onSubscribe: (planId: string) => void
}) {
  const { t, numberLocale } = useLocale()
  const periodKey: MessageKey =
    plan.period === 'month' ? 'periodMonth' : 'periodQuarter'
  const blurbKey = PLAN_BLURB[plan.id] ?? 'planStarterBlurb'

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
      className={`pricing-card${plan.featured ? ' is-featured' : ''}${isCurrent ? ' is-current' : ''}`}
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
        {cta}
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
  const { t, numberLocale } = useLocale()
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null)
  const [portalBusy, setPortalBusy] = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const checkoutBusy = busyPlanId !== null
  const actionBusy = checkoutBusy || portalBusy || cancelBusy
  const isSubscribed = quota?.plan === 'subscribed'
  const currentPlanId = quota?.planId ?? null

  async function handleSubscribe(planId: string) {
    if (!isAuthenticated) {
      onRequireLogin?.()
      return
    }
    if (currentPlanId === planId) return

    if (isSubscribed && quota && quota.remaining > 0) {
      const ok = window.confirm(t('upgradeHoldConfirm'))
      if (!ok) return
    }

    setError(null)
    setNotice(null)
    setBusyPlanId(planId)
    try {
      const { url } = await startCheckout(planId)
      window.location.href = url
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('genericError'))
      setBusyPlanId(null)
    }
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

  async function handleCancel() {
    if (!window.confirm(t('cancelConfirm'))) return
    setError(null)
    setNotice(null)
    setCancelBusy(true)
    try {
      const next = await cancelUserSubscription()
      onQuotaChange?.(next)
      setNotice(t('cancelSuccess'))
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
                className="btn btn-secondary"
                disabled={actionBusy}
                onClick={() => void handlePortal()}
              >
                {portalBusy ? t('openingPortal') : t('manageSubscription')}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={actionBusy || Boolean(quota?.cancelAtPeriodEnd)}
                onClick={() => void handleCancel()}
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

        <section className="pricing-trial">
          <h2>{t('pricingTrialTitle')}</h2>
          <TrialParagraph />
        </section>

        <section className="pricing-section">
          <h2>{t('pricingMonthly')}</h2>
          <div className="pricing-grid">
            {MONTHLY_PLANS.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                disabled={actionBusy}
                busy={busyPlanId === plan.id}
                isCurrent={currentPlanId === plan.id}
                isSubscribed={Boolean(isSubscribed)}
                onSubscribe={(planId) => void handleSubscribe(planId)}
              />
            ))}
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
      </div>
    </div>
  )
}
