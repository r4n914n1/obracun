import { initializeApp } from 'firebase-admin/app'
import { FieldValue, type DocumentData } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getAuth } from 'firebase-admin/auth'
import {
  canCalculate,
  currentPeriodExhausted,
  db,
  ensureUserDoc,
  hasQueuedPlan,
  isSubscriptionActive,
  normalizeUsage,
  promoteQueuedIfReady,
  quotaPayload,
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
        monthlyLimit: 10,
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
        'Potrošio si limit računanja. Nadogradi paket ili sačekaj sledeći period.',
      )
    }

    const nextUsed = (data.calculationsUsed ?? 0) + 1
    const update: Record<string, unknown> = {
      calculationsUsed: nextUsed,
    }
    if (isSubscriptionActive(data)) {
      update.usageMonth = new Date().toISOString().slice(0, 7)
    }
    tx.set(ref, update, { merge: true })

    const next = { ...data, calculationsUsed: nextUsed, ...update }
    return next
  })

  if (hasQueuedPlan(result) && currentPeriodExhausted(result)) {
    result = await promoteQueuedIfReady(uid, result)
  }

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
