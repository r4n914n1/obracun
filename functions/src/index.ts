import { initializeApp } from 'firebase-admin/app'
import { FieldValue, type DocumentData } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getAuth } from 'firebase-admin/auth'
import {
  canCalculate,
  canClaimAdReward,
  currentPeriodExhausted,
  db,
  ensureUserDoc,
  FREE_LIMIT,
  AD_REWARD_LIFETIME_LIMIT,
  hasQueuedPlan,
  isSubscriptionActive,
  normalizeUsage,
  promoteQueuedIfReady,
  quotaPayload,
  remainingFor,
  bonusCalculationsFor,
  adRewardsClaimedFor,
} from './billingCore'
import { submitBugReport } from './submitBugReport'
import {
  confirmPayPalSubscription,
  cancelSubscription,
  createCheckoutSession,
  createPortalSession,
  paypalWebhook,
} from './paypalBilling'

initializeApp()

export const ensureUser = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Prijava je obavezna.')
  }
  const data = await ensureUserDoc(request.auth.uid)
  return quotaPayload(data)
})

export const recordSuccessfulCalculation = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Prijava je obavezna.')
  }
  const uid = request.auth.uid
  // Promote queued upgrade if current period already ended / quota used.
  await ensureUserDoc(uid)

  const ref = db().collection('users').doc(uid)
  let result: DocumentData = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    let data
    if (!snap.exists) {
      const authUser = await getAuth().getUser(uid)
      data = {
        email: authUser.email ?? null,
        displayName: authUser.displayName ?? null,
        photoURL: authUser.photoURL ?? null,
        plan: 'free',
        planId: null,
        monthlyLimit: FREE_LIMIT,
        calculationsUsed: 0,
        usageMonth: null,
        createdAt: FieldValue.serverTimestamp(),
      }
      tx.set(ref, data, { merge: true })
    } else {
      data = snap.data()!
    }

    data = normalizeUsage(data)

    if (
      data.plan === 'subscribed' &&
      !isSubscriptionActive(data) &&
      !hasQueuedPlan(data)
    ) {
      throw new HttpsError(
        'resource-exhausted',
        'Pretplata je istekla. Pretplati se ponovo da nastaviš.',
      )
    }
    if (!canCalculate(data)) {
      throw new HttpsError(
        'resource-exhausted',
        'Potrošio si limit računanja. Nadogradi paket ili odgledaj reklamu za +1 računanje.',
      )
    }

    const planRemaining = remainingFor(data)
    const bonus = bonusCalculationsFor(data)
    const update: Record<string, unknown> = {}

    if (planRemaining > 0) {
      const nextUsed = (data.calculationsUsed ?? 0) + 1
      update.calculationsUsed = nextUsed
      if (isSubscriptionActive(data)) {
        update.usageMonth = new Date().toISOString().slice(0, 7)
      }
      tx.set(ref, update, { merge: true })
      return { ...data, ...update }
    }

    if (bonus > 0) {
      update.bonusCalculations = bonus - 1
      tx.set(ref, update, { merge: true })
      return { ...data, ...update }
    }

    throw new HttpsError(
      'resource-exhausted',
      'Potrošio si limit računanja. Nadogradi paket ili odgledaj reklamu za +1 računanje.',
    )
  })

  if (hasQueuedPlan(result) && currentPeriodExhausted(result)) {
    result = await promoteQueuedIfReady(uid, result)
  }

  return quotaPayload(result)
})

/** Grant +1 bonus calculation after watching an ad (max 3 lifetime per account). */
export const claimAdReward = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Prijava je obavezna.')
  }
  const uid = request.auth.uid
  await ensureUserDoc(uid)

  const ref = db().collection('users').doc(uid)
  const result = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Nalog nije pronađen.')
    }
    let data = normalizeUsage(snap.data()!)

    if (isSubscriptionActive(data) || hasQueuedPlan(data)) {
      throw new HttpsError(
        'failed-precondition',
        'Bonus preko reklame važi samo za besplatni nalog.',
      )
    }
    if (remainingFor(data) > 0) {
      throw new HttpsError(
        'failed-precondition',
        'Još imaš besplatna računanja. Potroši ih pre reklame.',
      )
    }
    const claimed = adRewardsClaimedFor(data)
    if (claimed >= AD_REWARD_LIFETIME_LIMIT) {
      throw new HttpsError(
        'resource-exhausted',
        `Iskoristio si sva ${AD_REWARD_LIFETIME_LIMIT} bonus računanja preko reklame. Izaberi paket da nastaviš.`,
      )
    }
    if (!canClaimAdReward(data)) {
      throw new HttpsError(
        'failed-precondition',
        'Bonus preko reklame trenutno nije dostupan.',
      )
    }

    const nextClaimed = claimed + 1
    const nextBonus = bonusCalculationsFor(data) + 1
    const update = {
      adRewardsClaimed: nextClaimed,
      bonusCalculations: nextBonus,
    }
    tx.set(ref, update, { merge: true })
    return { ...data, ...update }
  })

  return quotaPayload(result)
})

export {
  createCheckoutSession,
  confirmPayPalSubscription,
  cancelSubscription,
  createPortalSession,
  paypalWebhook,
  submitBugReport,
}
