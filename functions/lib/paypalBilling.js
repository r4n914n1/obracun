"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paypalWebhook = exports.createPortalSession = exports.cancelSubscription = exports.confirmPayPalSubscription = exports.createCheckoutSession = void 0;
const https_1 = require("firebase-functions/v2/https");
const plans_1 = require("./plans");
const billingCore_1 = require("./billingCore");
const paypalApi_1 = require("./paypalApi");
const paypalSecrets = [paypalApi_1.paypalClientId, paypalApi_1.paypalClientSecret, paypalApi_1.paypalWebhookId];
async function safeCancelPayPal(subscriptionId) {
    if (!subscriptionId)
        return;
    try {
        await (0, paypalApi_1.cancelPayPalSubscription)(subscriptionId);
    }
    catch (err) {
        console.warn('PayPal cancel (best-effort) failed', subscriptionId, err);
    }
}
async function applyOrQueueSubscription(uid, subscriptionId, fallbackPlanId) {
    const existing = await (0, billingCore_1.ensureUserDoc)(uid);
    const sub = await (0, paypalApi_1.fetchPayPalSubscription)(subscriptionId);
    const appPlanId = fallbackPlanId ?? (0, paypalApi_1.appPlanIdFromPaypalPlan)(sub.plan_id) ?? null;
    if (!appPlanId) {
        throw new https_1.HttpsError('failed-precondition', 'Nepoznat PayPal plan.');
    }
    const status = sub.status;
    const periodEnd = (0, paypalApi_1.parsePeriodEnd)(sub);
    const keepCurrent = (0, billingCore_1.isSubscriptionActive)(existing) &&
        !(0, billingCore_1.currentPeriodExhausted)(existing) &&
        typeof existing.paypalSubscriptionId === 'string' &&
        existing.paypalSubscriptionId !== subscriptionId;
    if (keepCurrent) {
        // Replace any previous queued PayPal subscription.
        if (typeof existing.queuedPaypalSubscriptionId === 'string' &&
            existing.queuedPaypalSubscriptionId !== subscriptionId) {
            await safeCancelPayPal(existing.queuedPaypalSubscriptionId);
        }
        await (0, billingCore_1.queuePayPalSubscription)(uid, {
            subscriptionId: sub.id,
            appPlanId,
            status,
            periodEnd,
            previousPaypalSubscriptionId: existing.paypalSubscriptionId,
        });
        // Stop billing the old plan; app-side quota continues until exhausted/expired.
        await safeCancelPayPal(existing.paypalSubscriptionId);
        return;
    }
    await (0, billingCore_1.applyPayPalSubscription)(uid, {
        subscriptionId: sub.id,
        appPlanId,
        status,
        periodEnd,
        resetUsage: true,
    });
}
async function findUidBySubscriptionId(subscriptionId) {
    const byActive = await (0, billingCore_1.db)()
        .collection('users')
        .where('paypalSubscriptionId', '==', subscriptionId)
        .limit(1)
        .get();
    if (!byActive.empty)
        return byActive.docs[0]?.id ?? null;
    const byQueued = await (0, billingCore_1.db)()
        .collection('users')
        .where('queuedPaypalSubscriptionId', '==', subscriptionId)
        .limit(1)
        .get();
    if (!byQueued.empty)
        return byQueued.docs[0]?.id ?? null;
    return null;
}
exports.createCheckoutSession = (0, https_1.onCall)({ secrets: paypalSecrets }, async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'Prijava je obavezna.');
    }
    const appPlanId = String(request.data?.planId ?? '').trim();
    if (!(0, plans_1.planDefinition)(appPlanId)) {
        throw new https_1.HttpsError('invalid-argument', 'Nepoznat paket.');
    }
    const uid = request.auth.uid;
    const user = await (0, billingCore_1.ensureUserDoc)(uid);
    const paypalPlanId = (0, paypalApi_1.paypalPlanIdForAppPlan)(appPlanId);
    const base = paypalApi_1.appUrl.value().replace(/\/?$/, '/');
    const returnUrl = `${base}?checkout=success`;
    const cancelUrl = `${base}?checkout=cancel`;
    const activeNow = (0, billingCore_1.isSubscriptionActive)(user) && !(0, billingCore_1.currentPeriodExhausted)(user);
    if (activeNow && user.planId === appPlanId && !(0, billingCore_1.hasQueuedPlan)(user)) {
        // Same active plan with remaining quota — queue a renewal.
    }
    else if (activeNow &&
        user.planId === appPlanId &&
        user.queuedPlanId === appPlanId) {
        throw new https_1.HttpsError('already-exists', 'Ovaj paket je već na čekanju. Aktiviraće se kad se potroši ili istekne trenutni period.');
    }
    try {
        const { id, approvalUrl } = await (0, paypalApi_1.createPayPalSubscription)(paypalPlanId, uid, returnUrl, cancelUrl);
        await (0, billingCore_1.db)().collection('users').doc(uid).set({
            pendingPaypalSubscriptionId: id,
            pendingPlanId: appPlanId,
        }, { merge: true });
        return {
            url: approvalUrl,
            willQueue: activeNow,
        };
    }
    catch (err) {
        console.error('PayPal createCheckoutSession failed', err);
        throw new https_1.HttpsError('internal', 'PayPal checkout trenutno nije dostupan. Pokušaj ponovo za minut.');
    }
});
exports.confirmPayPalSubscription = (0, https_1.onCall)({ secrets: paypalSecrets }, async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'Prijava je obavezna.');
    }
    const uid = request.auth.uid;
    const data = await (0, billingCore_1.ensureUserDoc)(uid);
    const fromClient = String(request.data?.subscriptionId ?? '').trim();
    const subscriptionId = (fromClient || null) ??
        (typeof data.pendingPaypalSubscriptionId === 'string'
            ? data.pendingPaypalSubscriptionId
            : null) ??
        (typeof data.queuedPaypalSubscriptionId === 'string'
            ? data.queuedPaypalSubscriptionId
            : null) ??
        (typeof data.paypalSubscriptionId === 'string'
            ? data.paypalSubscriptionId
            : null);
    if (!subscriptionId) {
        throw new https_1.HttpsError('failed-precondition', 'Nema PayPal pretplate za potvrdu.');
    }
    const fallbackPlanId = typeof data.pendingPlanId === 'string'
        ? data.pendingPlanId
        : typeof data.queuedPlanId === 'string'
            ? data.queuedPlanId
            : typeof data.planId === 'string'
                ? data.planId
                : null;
    await applyOrQueueSubscription(uid, subscriptionId, fallbackPlanId);
    let updated = await (0, billingCore_1.ensureUserDoc)(uid);
    updated = await (0, billingCore_1.promoteQueuedIfReady)(uid, updated);
    if (updated.plan !== 'subscribed' && !(0, billingCore_1.hasQueuedPlan)(updated)) {
        throw new https_1.HttpsError('failed-precondition', 'PayPal pretplata još nije aktivna. Sačekaj par sekundi i osveži stranicu.');
    }
    return (0, billingCore_1.quotaPayload)(updated);
});
exports.cancelSubscription = (0, https_1.onCall)({ secrets: paypalSecrets }, async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'Prijava je obavezna.');
    }
    const uid = request.auth.uid;
    const data = await (0, billingCore_1.ensureUserDoc)(uid);
    const activeId = typeof data.paypalSubscriptionId === 'string'
        ? data.paypalSubscriptionId
        : null;
    const queuedId = typeof data.queuedPaypalSubscriptionId === 'string'
        ? data.queuedPaypalSubscriptionId
        : null;
    const pendingId = typeof data.pendingPaypalSubscriptionId === 'string'
        ? data.pendingPaypalSubscriptionId
        : null;
    if (!activeId &&
        !queuedId &&
        !pendingId &&
        data.plan !== 'subscribed') {
        throw new https_1.HttpsError('failed-precondition', 'Nema aktivne PayPal pretplate za otkazivanje.');
    }
    if ((0, billingCore_1.isCancelAtPeriodEnd)(data) && !queuedId && !pendingId && !activeId) {
        throw new https_1.HttpsError('already-exists', 'Pretplata je već otkazana. Trenutni paket važi do potroška limita ili isteka perioda.');
    }
    await safeCancelPayPal(activeId);
    await safeCancelPayPal(queuedId);
    await safeCancelPayPal(pendingId);
    // Keep current paid access until quota used or period ends.
    await (0, billingCore_1.scheduleCancelAtPeriodEnd)(uid);
    const updated = await (0, billingCore_1.ensureUserDoc)(uid);
    return (0, billingCore_1.quotaPayload)(updated);
});
exports.createPortalSession = (0, https_1.onCall)(async () => {
    return { url: (0, paypalApi_1.paypalManageUrl)() };
});
exports.paypalWebhook = (0, https_1.onRequest)({ secrets: paypalSecrets }, async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method not allowed');
        return;
    }
    const verified = await (0, paypalApi_1.verifyPayPalWebhook)(req.headers, req.body);
    if (!verified) {
        res.status(400).send('Invalid webhook signature');
        return;
    }
    try {
        const event = req.body;
        const eventType = event.event_type ?? '';
        const resource = event.resource;
        const subscriptionId = resource?.id;
        const uidFromCustom = resource?.custom_id;
        const uid = uidFromCustom ||
            (subscriptionId
                ? await findUidBySubscriptionId(subscriptionId)
                : null);
        if ((eventType === 'BILLING.SUBSCRIPTION.ACTIVATED' ||
            eventType === 'BILLING.SUBSCRIPTION.UPDATED') &&
            uid &&
            subscriptionId) {
            const userSnap = await (0, billingCore_1.db)().collection('users').doc(uid).get();
            const userData = userSnap.data();
            const appPlanId = (0, paypalApi_1.appPlanIdFromPaypalPlan)(resource.plan_id ?? '') ??
                userData?.pendingPlanId ??
                userData?.queuedPlanId ??
                null;
            if (appPlanId) {
                await applyOrQueueSubscription(uid, subscriptionId, appPlanId);
            }
        }
        if ((eventType === 'BILLING.SUBSCRIPTION.CANCELLED' ||
            eventType === 'BILLING.SUBSCRIPTION.EXPIRED' ||
            eventType === 'BILLING.SUBSCRIPTION.SUSPENDED') &&
            uid &&
            subscriptionId) {
            const userSnap = await (0, billingCore_1.db)().collection('users').doc(uid).get();
            const userData = userSnap.data() ?? {};
            // Old plan cancelled after upgrade queue — keep current app period + queue.
            if (userData.paypalSubscriptionId === subscriptionId &&
                (0, billingCore_1.hasQueuedPlan)(userData)) {
                res.json({ received: true });
                return;
            }
            // Queued upgrade cancelled — drop queue only.
            if (userData.queuedPaypalSubscriptionId === subscriptionId) {
                await (0, billingCore_1.db)()
                    .collection('users')
                    .doc(uid)
                    .set({
                    queuedPlanId: null,
                    queuedPaypalSubscriptionId: null,
                    queuedPeriodEnd: null,
                }, { merge: true });
                res.json({ received: true });
                return;
            }
            // User cancelled renewal — keep paid access until period/quota ends.
            if ((0, billingCore_1.isSubscriptionActive)(userData) &&
                !(0, billingCore_1.currentPeriodExhausted)(userData)) {
                await (0, billingCore_1.scheduleCancelAtPeriodEnd)(uid);
                res.json({ received: true });
                return;
            }
            await (0, billingCore_1.deactivateSubscription)(uid);
        }
        res.json({ received: true });
    }
    catch (err) {
        console.error(err);
        res.status(500).send('Webhook handler failed');
    }
});
//# sourceMappingURL=paypalBilling.js.map