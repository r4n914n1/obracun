import { getFirestore, Timestamp, type DocumentData } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue } from 'firebase-admin/firestore'
import { planDefinition } from './plans'

export const FREE_LIMIT = 5
/** Lifetime max rewarded-ad bonuses per account (no reset). */
export const AD_REWARD_LIFETIME_LIMIT = 3

export function db() {
  return getFirestore()
}

export function currentUsageMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

export function isSubscriptionActive(data: DocumentData, now = Date.now()) {
  if (data.plan !== 'subscribed') return false
  if (!data.periodEnd) return true
  return data.periodEnd.toMillis() > now
}

export function effectiveLimit(data: DocumentData): number {
  if (isSubscriptionActive(data)) {
    const fromPlan = typeof data.monthlyLimit === 'number' ? data.monthlyLimit : null
    if (fromPlan && fromPlan > 0) return fromPlan
    const planId = typeof data.planId === 'string' ? data.planId : null
    if (planId) {
      const def = planDefinition(planId)
      if (def) return def.monthlyLimit
    }
    return 1000
  }
  return FREE_LIMIT
}

/** Current paid period is finished by time or by used quota. */
export function currentPeriodExhausted(data: DocumentData, now = Date.now()) {
  if (data.plan !== 'subscribed') return true
  if (data.periodEnd && data.periodEnd.toMillis() <= now) return true
  const limit = effectiveLimit(data)
  const used = typeof data.calculationsUsed === 'number' ? data.calculationsUsed : 0
  return used >= limit
}

export function hasQueuedPlan(data: DocumentData) {
  return typeof data.queuedPlanId === 'string' && data.queuedPlanId.length > 0
}

export function isCancelAtPeriodEnd(data: DocumentData) {
  return data.cancelAtPeriodEnd === true
}

export function normalizeUsage(data: DocumentData): DocumentData {
  if (!isSubscriptionActive(data)) {
    return data
  }
  // While upgrade is queued or cancel is scheduled, keep current period usage.
  if (hasQueuedPlan(data) || isCancelAtPeriodEnd(data)) {
    return data
  }
  const month = currentUsageMonth()
  if (data.usageMonth !== month) {
    return { ...data, usageMonth: month, calculationsUsed: 0 }
  }
  return data
}

export function remainingFor(data: DocumentData) {
  const normalized = normalizeUsage(data)
  const limit = effectiveLimit(normalized)
  const used = normalized.calculationsUsed ?? 0
  return Math.max(0, limit - used)
}

export function bonusCalculationsFor(data: DocumentData): number {
  const n = data.bonusCalculations
  return typeof n === 'number' && n > 0 ? Math.floor(n) : 0
}

export function adRewardsClaimedFor(data: DocumentData): number {
  const n = data.adRewardsClaimed
  return typeof n === 'number' && n > 0 ? Math.floor(n) : 0
}

export function adRewardsRemainingFor(data: DocumentData): number {
  return Math.max(0, AD_REWARD_LIFETIME_LIMIT - adRewardsClaimedFor(data))
}

export function canCalculate(data: DocumentData) {
  if (hasQueuedPlan(data) && currentPeriodExhausted(data)) {
    // Queued plan will be promoted; treat as calculable after promote.
    return true
  }
  if (data.plan === 'subscribed' && !isSubscriptionActive(data)) {
    return false
  }
  return remainingFor(data) > 0 || bonusCalculationsFor(data) > 0
}

/** Free user with no plan remaining and lifetime ad rewards left. */
export function canClaimAdReward(data: DocumentData): boolean {
  if (isSubscriptionActive(data) || hasQueuedPlan(data)) return false
  if (remainingFor(data) > 0) return false
  return adRewardsRemainingFor(data) > 0
}

export function clearQueueFields(): Record<string, null> {
  return {
    queuedPlanId: null,
    queuedPaypalSubscriptionId: null,
    queuedPeriodEnd: null,
  }
}

export async function applyQueuedPlan(
  uid: string,
  data: DocumentData,
): Promise<DocumentData> {
  const queuedPlanId =
    typeof data.queuedPlanId === 'string' ? data.queuedPlanId : null
  if (!queuedPlanId) return data

  const plan = planDefinition(queuedPlanId)
  const queuedSubId =
    typeof data.queuedPaypalSubscriptionId === 'string'
      ? data.queuedPaypalSubscriptionId
      : null
  const queuedPeriodEnd =
    data.queuedPeriodEnd && typeof data.queuedPeriodEnd.toDate === 'function'
      ? data.queuedPeriodEnd
      : null

  const update: Record<string, unknown> = {
    plan: 'subscribed',
    planId: queuedPlanId,
    monthlyLimit: plan?.monthlyLimit ?? FREE_LIMIT,
    paypalSubscriptionId: queuedSubId,
    calculationsUsed: 0,
    usageMonth: currentUsageMonth(),
    periodEnd: queuedPeriodEnd,
    pendingPaypalSubscriptionId: null,
    pendingPlanId: null,
    ...clearQueueFields(),
  }

  await db().collection('users').doc(uid).set(update, { merge: true })
  return { ...data, ...update }
}

/**
 * If a queued upgrade exists and the current period is done (time or quota),
 * promote the queued plan to active. If cancel was scheduled and period is done,
 * drop to free.
 */
export async function promoteQueuedIfReady(
  uid: string,
  data: DocumentData,
): Promise<DocumentData> {
  if (hasQueuedPlan(data) && currentPeriodExhausted(data)) {
    return applyQueuedPlan(uid, data)
  }
  if (
    isCancelAtPeriodEnd(data) &&
    currentPeriodExhausted(data) &&
    !hasQueuedPlan(data)
  ) {
    await deactivateSubscription(uid)
    const again = await db().collection('users').doc(uid).get()
    return again.data() ?? data
  }
  return data
}

export async function ensureUserDoc(uid: string) {
  const ref = db().collection('users').doc(uid)
  const snap = await ref.get()
  if (snap.exists) {
    let data = snap.data()!
    data = await promoteQueuedIfReady(uid, data)
    const normalized = normalizeUsage(data)
    if (
      normalized.usageMonth !== data.usageMonth ||
      normalized.calculationsUsed !== data.calculationsUsed
    ) {
      await ref.set(
        {
          usageMonth: normalized.usageMonth ?? null,
          calculationsUsed: normalized.calculationsUsed ?? 0,
        },
        { merge: true },
      )
    }
    return normalized
  }
  const authUser = await getAuth().getUser(uid)
  const created = {
    email: authUser.email ?? null,
    displayName: authUser.displayName ?? null,
    photoURL: authUser.photoURL ?? null,
    plan: 'free',
    planId: null,
    monthlyLimit: FREE_LIMIT,
    calculationsUsed: 0,
    usageMonth: null,
    periodStart: null,
    periodEnd: null,
    paypalSubscriptionId: null,
    pendingPaypalSubscriptionId: null,
    pendingPlanId: null,
    queuedPlanId: null,
    queuedPaypalSubscriptionId: null,
    queuedPeriodEnd: null,
    cancelAtPeriodEnd: false,
    bonusCalculations: 0,
    adRewardsClaimed: 0,
    createdAt: FieldValue.serverTimestamp(),
  }
  await ref.set(created, { merge: true })
  const again = await ref.get()
  return again.data()!
}

export function quotaPayload(data: DocumentData) {
  const normalized = normalizeUsage(data)
  const limit = effectiveLimit(normalized)
  const used = normalized.calculationsUsed ?? 0
  const planRemaining = Math.max(0, limit - used)
  const bonus = bonusCalculationsFor(normalized)
  const adRewardsClaimed = adRewardsClaimedFor(normalized)
  const adRewardsRemaining = adRewardsRemainingFor(normalized)

  return {
    plan:
      isSubscriptionActive(normalized) || hasQueuedPlan(normalized)
        ? 'subscribed'
        : 'free',
    planId: typeof normalized.planId === 'string' ? normalized.planId : null,
    queuedPlanId:
      typeof normalized.queuedPlanId === 'string'
        ? normalized.queuedPlanId
        : null,
    cancelAtPeriodEnd: isCancelAtPeriodEnd(normalized),
    calculationsUsed: used,
    limit,
    remaining: planRemaining,
    bonusCalculations: bonus,
    adRewardsClaimed,
    adRewardsRemaining,
    canClaimAdReward: canClaimAdReward(normalized),
    canCalculate: canCalculate(normalized),
    periodEnd: normalized.periodEnd
      ? normalized.periodEnd.toDate().toISOString()
      : null,
  }
}

export async function applyPayPalSubscription(
  uid: string,
  options: {
    subscriptionId: string
    appPlanId: string
    status: string
    periodEnd: Date | null
    resetUsage: boolean
  },
) {
  const plan = planDefinition(options.appPlanId)
  const active = options.status === 'ACTIVE' || options.status === 'APPROVED'

  const update: Record<string, unknown> = {
    paypalSubscriptionId: options.subscriptionId,
    pendingPaypalSubscriptionId: null,
    pendingPlanId: null,
    cancelAtPeriodEnd: false,
    plan: active ? 'subscribed' : 'free',
    planId: active ? options.appPlanId : null,
    monthlyLimit: active ? (plan?.monthlyLimit ?? FREE_LIMIT) : FREE_LIMIT,
    periodEnd: options.periodEnd ? Timestamp.fromDate(options.periodEnd) : null,
    ...clearQueueFields(),
  }

  if (options.resetUsage && active) {
    update.calculationsUsed = 0
    update.usageMonth = currentUsageMonth()
  }
  if (!active) {
    update.paypalSubscriptionId = null
  }

  await db().collection('users').doc(uid).set(update, { merge: true })
}

/** Store a paid upgrade to activate when current period ends or quota is used. */
export async function queuePayPalSubscription(
  uid: string,
  options: {
    subscriptionId: string
    appPlanId: string
    status: string
    periodEnd: Date | null
    previousPaypalSubscriptionId: string | null
  },
) {
  const active = options.status === 'ACTIVE' || options.status === 'APPROVED'
  if (!active) {
    throw new Error('Queued PayPal subscription is not active.')
  }

  const update: Record<string, unknown> = {
    queuedPlanId: options.appPlanId,
    queuedPaypalSubscriptionId: options.subscriptionId,
    queuedPeriodEnd: options.periodEnd
      ? Timestamp.fromDate(options.periodEnd)
      : null,
    pendingPaypalSubscriptionId: null,
    pendingPlanId: null,
    cancelAtPeriodEnd: false,
    // Keep current plan/limit/usage/periodEnd as-is.
  }

  await db().collection('users').doc(uid).set(update, { merge: true })
}

export async function scheduleCancelAtPeriodEnd(uid: string) {
  await db().collection('users').doc(uid).set(
    {
      cancelAtPeriodEnd: true,
      paypalSubscriptionId: null,
      pendingPaypalSubscriptionId: null,
      pendingPlanId: null,
      ...clearQueueFields(),
      // Keep plan / planId / monthlyLimit / calculationsUsed / periodEnd.
    },
    { merge: true },
  )
}

export async function deactivateSubscription(uid: string) {
  await db().collection('users').doc(uid).set(
    {
      plan: 'free',
      planId: null,
      monthlyLimit: FREE_LIMIT,
      paypalSubscriptionId: null,
      pendingPaypalSubscriptionId: null,
      pendingPlanId: null,
      periodEnd: null,
      cancelAtPeriodEnd: false,
      ...clearQueueFields(),
    },
    { merge: true },
  )
}
