import {
  MONTHLY_PLANS,
  QUARTERLY_PLANS,
  type PricingPlan,
} from '../data/pricingPlans'

const ADS_ID =
  (import.meta.env.VITE_GOOGLE_ADS_ID as string | undefined)?.trim() ||
  'AW-18346625131'

/** Label from Google Ads → Goals → Conversions → Tag setup → Event snippet */
const ADS_LABEL = (
  import.meta.env.VITE_GOOGLE_ADS_CONVERSION_LABEL as string | undefined
)?.trim()

const PENDING_PLAN_KEY = 'googleAdsPendingPlanId'
const FIRED_TX_KEY = 'googleAdsFiredTx'

const ALL_PLANS: PricingPlan[] = [...MONTHLY_PLANS, ...QUARTERLY_PLANS]

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

function sendTo(): string | null {
  if (!ADS_LABEL) return null
  const label = ADS_LABEL.startsWith('AW-')
    ? ADS_LABEL
    : `${ADS_ID}/${ADS_LABEL.replace(/^\//, '')}`
  return label.includes('/') ? label : `${ADS_ID}/${label}`
}

export function rememberCheckoutPlan(planId: string): void {
  try {
    sessionStorage.setItem(PENDING_PLAN_KEY, planId)
  } catch {
    // ignore
  }
}

export function takeCheckoutPlan(fallback?: string | null): string | null {
  try {
    const fromSession = sessionStorage.getItem(PENDING_PLAN_KEY)
    if (fromSession) {
      sessionStorage.removeItem(PENDING_PLAN_KEY)
      return fromSession
    }
  } catch {
    // ignore
  }
  return fallback?.trim() || null
}

function planValueEur(planId: string | null | undefined): number | null {
  if (!planId) return null
  const plan = ALL_PLANS.find((p) => p.id === planId)
  return plan ? plan.priceEur : null
}

function alreadyFired(transactionId: string): boolean {
  try {
    const prev = sessionStorage.getItem(FIRED_TX_KEY)
    return prev === transactionId
  } catch {
    return false
  }
}

function markFired(transactionId: string): void {
  try {
    sessionStorage.setItem(FIRED_TX_KEY, transactionId)
  } catch {
    // ignore
  }
}

/**
 * Fire Google Ads purchase conversion after a successful PayPal checkout.
 * Requires VITE_GOOGLE_ADS_CONVERSION_LABEL (from Ads Event snippet).
 */
export function trackSubscriptionConversion(opts: {
  planId?: string | null
  transactionId?: string | null
}): boolean {
  const target = sendTo()
  if (!target) {
    console.warn(
      '[Google Ads] Missing VITE_GOOGLE_ADS_CONVERSION_LABEL — conversion not sent.',
    )
    return false
  }

  const gtag = window.gtag
  if (typeof gtag !== 'function') return false

  const transactionId = (opts.transactionId || '').trim() || undefined
  if (transactionId && alreadyFired(transactionId)) return false

  const value = planValueEur(opts.planId)
  const payload: Record<string, unknown> = {
    send_to: target,
    currency: 'EUR',
  }
  if (value != null) payload.value = value
  if (transactionId) payload.transaction_id = transactionId

  gtag('event', 'conversion', payload)
  if (transactionId) markFired(transactionId)
  return true
}

export function googleAdsConfigured(): boolean {
  return Boolean(sendTo())
}
