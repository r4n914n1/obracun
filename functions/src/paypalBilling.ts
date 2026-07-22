import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https'
import { planDefinition } from './plans'
import {
  applyPayPalSubscription,
  currentPeriodExhausted,
  deactivateSubscription,
  db,
  ensureUserDoc,
  hasQueuedPlan,
  isCancelAtPeriodEnd,
  isSubscriptionActive,
  promoteQueuedIfReady,
  queuePayPalSubscription,
  quotaPayload,
  scheduleCancelAtPeriodEnd,
} from './billingCore'
import {
  appPlanIdFromPaypalPlan,
  appUrl,
  cancelPayPalSubscription,
  createPayPalSubscription,
  fetchPayPalSubscription,
  parsePeriodEnd,
  paypalClientId,
  paypalClientSecret,
  paypalManageUrl,
  paypalPlanIdForAppPlan,
  paypalWebhookId,
  verifyPayPalWebhook,
} from './paypalApi'

const paypalSecrets = [paypalClientId, paypalClientSecret, paypalWebhookId]

async function safeCancelPayPal(subscriptionId: string | null | undefined) {
  if (!subscriptionId) return
  try {
    await cancelPayPalSubscription(subscriptionId)
  } catch (err) {
    console.warn('PayPal cancel (best-effort) failed', subscriptionId, err)
  }
}

async function applyOrQueueSubscription(
  uid: string,
  subscriptionId: string,
  fallbackPlanId: string | null,
) {
  const existing = await ensureUserDoc(uid)
  const sub = await fetchPayPalSubscription(subscriptionId)
  const appPlanId =
    fallbackPlanId ?? appPlanIdFromPaypalPlan(sub.plan_id) ?? null

  if (!appPlanId) {
    throw new HttpsError('failed-precondition', 'Nepoznat PayPal plan.')
  }

  const status = sub.status
  const periodEnd = parsePeriodEnd(sub)
  const keepCurrent =
    isSubscriptionActive(existing) &&
    !currentPeriodExhausted(existing) &&
    typeof existing.paypalSubscriptionId === 'string' &&
    existing.paypalSubscriptionId !== subscriptionId

  if (keepCurrent) {
    // Replace any previous queued PayPal subscription.
    if (
      typeof existing.queuedPaypalSubscriptionId === 'string' &&
      existing.queuedPaypalSubscriptionId !== subscriptionId
    ) {
      await safeCancelPayPal(existing.queuedPaypalSubscriptionId)
    }

    await queuePayPalSubscription(uid, {
      subscriptionId: sub.id,
      appPlanId,
      status,
      periodEnd,
      previousPaypalSubscriptionId: existing.paypalSubscriptionId,
    })

    // Stop billing the old plan; app-side quota continues until exhausted/expired.
    await safeCancelPayPal(existing.paypalSubscriptionId)
    return
  }

  await applyPayPalSubscription(uid, {
    subscriptionId: sub.id,
    appPlanId,
    status,
    periodEnd,
    resetUsage: true,
  })
}

async function findUidBySubscriptionId(
  subscriptionId: string,
): Promise<string | null> {
  const byActive = await db()
    .collection('users')
    .where('paypalSubscriptionId', '==', subscriptionId)
    .limit(1)
    .get()
  if (!byActive.empty) return byActive.docs[0]?.id ?? null

  const byQueued = await db()
    .collection('users')
    .where('queuedPaypalSubscriptionId', '==', subscriptionId)
    .limit(1)
    .get()
  if (!byQueued.empty) return byQueued.docs[0]?.id ?? null

  return null
}

export const createCheckoutSession = onCall(
  { secrets: paypalSecrets },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Prijava je obavezna.')
    }

    const appPlanId = String(request.data?.planId ?? '').trim()
    if (!planDefinition(appPlanId)) {
      throw new HttpsError('invalid-argument', 'Nepoznat paket.')
    }

    const uid = request.auth.uid
    const user = await ensureUserDoc(uid)
    const paypalPlanId = paypalPlanIdForAppPlan(appPlanId)
    const base = appUrl.value().replace(/\/?$/, '/')
    const returnUrl = `${base}?checkout=success`
    const cancelUrl = `${base}?checkout=cancel`

    const activeNow =
      isSubscriptionActive(user) && !currentPeriodExhausted(user)

    if (activeNow && user.planId === appPlanId && !hasQueuedPlan(user)) {
      // Same active plan with remaining quota — queue a renewal.
    } else if (
      activeNow &&
      user.planId === appPlanId &&
      user.queuedPlanId === appPlanId
    ) {
      throw new HttpsError(
        'already-exists',
        'Ovaj paket je već na čekanju. Aktiviraće se kad se potroši ili istekne trenutni period.',
      )
    }

    try {
      const { id, approvalUrl } = await createPayPalSubscription(
        paypalPlanId,
        uid,
        returnUrl,
        cancelUrl,
      )

      await db().collection('users').doc(uid).set(
        {
          pendingPaypalSubscriptionId: id,
          pendingPlanId: appPlanId,
        },
        { merge: true },
      )

      return {
        url: approvalUrl,
        willQueue: activeNow,
      }
    } catch (err) {
      console.error('PayPal createCheckoutSession failed', err)
      throw new HttpsError(
        'internal',
        'PayPal checkout trenutno nije dostupan. Pokušaj ponovo za minut.',
      )
    }
  },
)

export const confirmPayPalSubscription = onCall(
  { secrets: paypalSecrets },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Prijava je obavezna.')
    }

    const uid = request.auth.uid
    const data = await ensureUserDoc(uid)
    const fromClient = String(request.data?.subscriptionId ?? '').trim()
    const subscriptionId =
      (fromClient || null) ??
      (typeof data.pendingPaypalSubscriptionId === 'string'
        ? data.pendingPaypalSubscriptionId
        : null) ??
      (typeof data.queuedPaypalSubscriptionId === 'string'
        ? data.queuedPaypalSubscriptionId
        : null) ??
      (typeof data.paypalSubscriptionId === 'string'
        ? data.paypalSubscriptionId
        : null)

    if (!subscriptionId) {
      throw new HttpsError(
        'failed-precondition',
        'Nema PayPal pretplate za potvrdu.',
      )
    }

    const fallbackPlanId =
      typeof data.pendingPlanId === 'string'
        ? data.pendingPlanId
        : typeof data.queuedPlanId === 'string'
          ? data.queuedPlanId
          : typeof data.planId === 'string'
            ? data.planId
            : null

    await applyOrQueueSubscription(uid, subscriptionId, fallbackPlanId)
    let updated = await ensureUserDoc(uid)
    updated = await promoteQueuedIfReady(uid, updated)

    if (updated.plan !== 'subscribed' && !hasQueuedPlan(updated)) {
      throw new HttpsError(
        'failed-precondition',
        'PayPal pretplata još nije aktivna. Sačekaj par sekundi i osveži stranicu.',
      )
    }
    return quotaPayload(updated)
  },
)

export const cancelSubscription = onCall(
  { secrets: paypalSecrets },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Prijava je obavezna.')
    }

    const uid = request.auth.uid
    const data = await ensureUserDoc(uid)
    const activeId =
      typeof data.paypalSubscriptionId === 'string'
        ? data.paypalSubscriptionId
        : null
    const queuedId =
      typeof data.queuedPaypalSubscriptionId === 'string'
        ? data.queuedPaypalSubscriptionId
        : null
    const pendingId =
      typeof data.pendingPaypalSubscriptionId === 'string'
        ? data.pendingPaypalSubscriptionId
        : null

    if (
      !activeId &&
      !queuedId &&
      !pendingId &&
      data.plan !== 'subscribed'
    ) {
      throw new HttpsError(
        'failed-precondition',
        'Nema aktivne PayPal pretplate za otkazivanje.',
      )
    }

    if (isCancelAtPeriodEnd(data) && !queuedId && !pendingId && !activeId) {
      throw new HttpsError(
        'already-exists',
        'Pretplata je već otkazana. Trenutni paket važi do potroška limita ili isteka perioda.',
      )
    }

    await safeCancelPayPal(activeId)
    await safeCancelPayPal(queuedId)
    await safeCancelPayPal(pendingId)

    // Keep current paid access until quota used or period ends.
    await scheduleCancelAtPeriodEnd(uid)
    const updated = await ensureUserDoc(uid)
    return quotaPayload(updated)
  },
)

export const createPortalSession = onCall(async () => {
  return { url: paypalManageUrl() }
})

export const paypalWebhook = onRequest(
  { secrets: paypalSecrets },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed')
      return
    }

    const verified = await verifyPayPalWebhook(req.headers, req.body)
    if (!verified) {
      res.status(400).send('Invalid webhook signature')
      return
    }

    try {
      const event = req.body as {
        event_type?: string
        resource?: {
          id?: string
          custom_id?: string
          plan_id?: string
          status?: string
        }
      }

      const eventType = event.event_type ?? ''
      const resource = event.resource
      const subscriptionId = resource?.id
      const uidFromCustom = resource?.custom_id
      const uid =
        uidFromCustom ||
        (subscriptionId
          ? await findUidBySubscriptionId(subscriptionId)
          : null)

      if (
        (eventType === 'BILLING.SUBSCRIPTION.ACTIVATED' ||
          eventType === 'BILLING.SUBSCRIPTION.UPDATED') &&
        uid &&
        subscriptionId
      ) {
        const userSnap = await db().collection('users').doc(uid).get()
        const userData = userSnap.data()
        const appPlanId =
          appPlanIdFromPaypalPlan(resource.plan_id ?? '') ??
          userData?.pendingPlanId ??
          userData?.queuedPlanId ??
          null
        if (appPlanId) {
          await applyOrQueueSubscription(uid, subscriptionId, appPlanId)
        }
      }

      if (
        (eventType === 'BILLING.SUBSCRIPTION.CANCELLED' ||
          eventType === 'BILLING.SUBSCRIPTION.EXPIRED' ||
          eventType === 'BILLING.SUBSCRIPTION.SUSPENDED') &&
        uid &&
        subscriptionId
      ) {
        const userSnap = await db().collection('users').doc(uid).get()
        const userData = userSnap.data() ?? {}

        // Old plan cancelled after upgrade queue — keep current app period + queue.
        if (
          userData.paypalSubscriptionId === subscriptionId &&
          hasQueuedPlan(userData)
        ) {
          res.json({ received: true })
          return
        }

        // Queued upgrade cancelled — drop queue only.
        if (userData.queuedPaypalSubscriptionId === subscriptionId) {
          await db()
            .collection('users')
            .doc(uid)
            .set(
              {
                queuedPlanId: null,
                queuedPaypalSubscriptionId: null,
                queuedPeriodEnd: null,
              },
              { merge: true },
            )
          res.json({ received: true })
          return
        }

        // User cancelled renewal — keep paid access until period/quota ends.
        if (
          isSubscriptionActive(userData) &&
          !currentPeriodExhausted(userData)
        ) {
          await scheduleCancelAtPeriodEnd(uid)
          res.json({ received: true })
          return
        }

        await deactivateSubscription(uid)
      }

      res.json({ received: true })
    } catch (err) {
      console.error(err)
      res.status(500).send('Webhook handler failed')
    }
  },
)
