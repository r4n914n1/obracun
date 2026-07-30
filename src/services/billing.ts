import { getFunctions, httpsCallable } from 'firebase/functions'
import { getFirebaseApp, isFirebaseConfigured } from './firebase'
import type { QuotaSnapshot } from '../types/billing'

function billingFunctions() {
  return getFunctions(getFirebaseApp())
}

function mapBillingError(err: unknown): Error {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: string }).code)
      : ''
  const message =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message?: string }).message)
      : ''

  if (code === 'functions/resource-exhausted' && message) {
    return new Error(message)
  }
  if (code === 'functions/unauthenticated') {
    return new Error('Prijava je obavezna.')
  }
  if (code === 'functions/failed-precondition' && message) {
    return new Error(message)
  }
  if (code === 'functions/already-exists' && message) {
    return new Error(message)
  }
  if (message) return new Error(message)
  return err instanceof Error ? err : new Error('Billing nije dostupan.')
}

export async function fetchQuota(): Promise<QuotaSnapshot> {
  if (!isFirebaseConfigured()) {
    return {
      plan: 'free',
      planId: null,
      queuedPlanId: null,
      cancelAtPeriodEnd: false,
      calculationsUsed: 0,
      limit: 5,
      remaining: 5,
      bonusCalculations: 0,
      adRewardsClaimed: 0,
      adRewardsRemaining: 3,
      canClaimAdReward: false,
      canCalculate: true,
      periodEnd: null,
    }
  }
  const fn = httpsCallable<void, QuotaSnapshot>(billingFunctions(), 'ensureUser')
  try {
    const result = await fn()
    return result.data
  } catch (err) {
    throw mapBillingError(err)
  }
}

export async function claimAdRewardBonus(): Promise<QuotaSnapshot> {
  const fn = httpsCallable<void, QuotaSnapshot>(
    billingFunctions(),
    'claimAdReward',
  )
  try {
    const result = await fn()
    return result.data
  } catch (err) {
    throw mapBillingError(err)
  }
}

export async function recordCalculationUsage(): Promise<QuotaSnapshot> {
  const fn = httpsCallable<void, QuotaSnapshot>(
    billingFunctions(),
    'recordSuccessfulCalculation',
  )
  try {
    const result = await fn()
    return result.data
  } catch (err) {
    throw mapBillingError(err)
  }
}

export async function startCheckout(
  planId: string,
): Promise<{ url: string; willQueue: boolean }> {
  const fn = httpsCallable<
    { planId: string },
    { url: string; willQueue?: boolean }
  >(billingFunctions(), 'createCheckoutSession')
  try {
    const result = await fn({ planId })
    if (!result.data.url) {
      throw new Error('PayPal nije vratio approval URL.')
    }
    return {
      url: result.data.url,
      willQueue: Boolean(result.data.willQueue),
    }
  } catch (err) {
    throw mapBillingError(err)
  }
}

export async function confirmPayPalCheckout(
  subscriptionId?: string,
): Promise<QuotaSnapshot> {
  const fn = httpsCallable<{ subscriptionId?: string }, QuotaSnapshot>(
    billingFunctions(),
    'confirmPayPalSubscription',
  )
  try {
    const result = await fn(
      subscriptionId ? { subscriptionId } : {},
    )
    return result.data
  } catch (err) {
    throw mapBillingError(err)
  }
}

export async function cancelUserSubscription(): Promise<QuotaSnapshot> {
  const fn = httpsCallable<void, QuotaSnapshot>(
    billingFunctions(),
    'cancelSubscription',
  )
  try {
    const result = await fn()
    return result.data
  } catch (err) {
    throw mapBillingError(err)
  }
}

export async function startBillingPortal(): Promise<string> {
  const fn = httpsCallable<void, { url: string }>(
    billingFunctions(),
    'createPortalSession',
  )
  try {
    const result = await fn()
    if (!result.data.url) {
      throw new Error('PayPal nije vratio URL za upravljanje pretplatom.')
    }
    return result.data.url
  } catch (err) {
    throw mapBillingError(err)
  }
}
