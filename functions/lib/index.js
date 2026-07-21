"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripeWebhook = exports.createPortalSession = exports.createCheckoutSession = exports.recordSuccessfulCalculation = exports.ensureUser = void 0;
const app_1 = require("firebase-admin/app");
const auth_1 = require("firebase-admin/auth");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const stripe_1 = __importDefault(require("stripe"));
(0, app_1.initializeApp)();
const FREE_LIMIT = 10;
const SUB_LIMIT = 1000;
const stripeSecretKey = (0, params_1.defineSecret)('STRIPE_SECRET_KEY');
const stripeWebhookSecret = (0, params_1.defineSecret)('STRIPE_WEBHOOK_SECRET');
const stripePriceId = (0, params_1.defineString)('STRIPE_PRICE_ID');
const appUrl = (0, params_1.defineString)('APP_URL', { default: 'https://transportcost.info/' });
function db() {
    return (0, firestore_1.getFirestore)();
}
function stripeClient(secret) {
    return new stripe_1.default(secret, { apiVersion: '2025-02-24.acacia' });
}
function isSubscriptionActive(data, now = Date.now()) {
    if (data.plan !== 'subscribed')
        return false;
    if (!data.periodEnd)
        return true;
    return data.periodEnd.toMillis() > now;
}
function limitFor(data) {
    return isSubscriptionActive(data) ? SUB_LIMIT : FREE_LIMIT;
}
function remainingFor(data) {
    const limit = limitFor(data);
    return Math.max(0, limit - (data.calculationsUsed ?? 0));
}
function canCalculate(data) {
    if (data.plan === 'subscribed' && !isSubscriptionActive(data)) {
        return false;
    }
    return remainingFor(data) > 0;
}
async function ensureUserDoc(uid) {
    const ref = db().collection('users').doc(uid);
    const snap = await ref.get();
    if (snap.exists) {
        return snap.data();
    }
    const authUser = await (0, auth_1.getAuth)().getUser(uid);
    const created = {
        email: authUser.email ?? null,
        displayName: authUser.displayName ?? null,
        photoURL: authUser.photoURL ?? null,
        plan: 'free',
        calculationsUsed: 0,
        periodStart: null,
        periodEnd: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    };
    await ref.set(created, { merge: true });
    const again = await ref.get();
    return again.data();
}
function quotaPayload(data) {
    const active = isSubscriptionActive(data);
    const limit = active ? SUB_LIMIT : FREE_LIMIT;
    const used = data.calculationsUsed ?? 0;
    return {
        plan: active ? 'subscribed' : 'free',
        calculationsUsed: used,
        limit,
        remaining: Math.max(0, limit - used),
        canCalculate: canCalculate(data),
        periodEnd: data.periodEnd ? data.periodEnd.toDate().toISOString() : null,
    };
}
/** Ensure profile exists and return quota snapshot. */
exports.ensureUser = (0, https_1.onCall)(async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'Prijava je obavezna.');
    }
    const data = await ensureUserDoc(request.auth.uid);
    return quotaPayload(data);
});
/** After a successful route calculation, increment usage (transactional). */
exports.recordSuccessfulCalculation = (0, https_1.onCall)(async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'Prijava je obavezna.');
    }
    const uid = request.auth.uid;
    const ref = db().collection('users').doc(uid);
    const result = await db().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        let data;
        if (!snap.exists) {
            const authUser = await (0, auth_1.getAuth)().getUser(uid);
            data = {
                email: authUser.email ?? null,
                displayName: authUser.displayName ?? null,
                photoURL: authUser.photoURL ?? null,
                plan: 'free',
                calculationsUsed: 0,
                createdAt: firestore_1.FieldValue.serverTimestamp(),
            };
            tx.set(ref, data, { merge: true });
        }
        else {
            data = snap.data();
        }
        // Downgrade expired subscription for quota purposes
        if (data.plan === 'subscribed' && !isSubscriptionActive(data)) {
            throw new https_1.HttpsError('resource-exhausted', 'Pretplata je istekla. Pretplati se ponovo da nastaviš.');
        }
        if (!canCalculate(data)) {
            throw new https_1.HttpsError('resource-exhausted', 'Nemaš više besplatnih prorаčuna. Pretplati se za 3 €/mesec.');
        }
        const nextUsed = (data.calculationsUsed ?? 0) + 1;
        tx.update(ref, { calculationsUsed: nextUsed });
        const next = { ...data, calculationsUsed: nextUsed };
        return quotaPayload(next);
    });
    return result;
});
exports.createCheckoutSession = (0, https_1.onCall)({ secrets: [stripeSecretKey] }, async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'Prijava je obavezna.');
    }
    const uid = request.auth.uid;
    const data = await ensureUserDoc(uid);
    const stripe = stripeClient(stripeSecretKey.value());
    const priceId = stripePriceId.value();
    if (!priceId) {
        throw new https_1.HttpsError('failed-precondition', 'STRIPE_PRICE_ID nije podešen.');
    }
    let customerId = data.stripeCustomerId ?? undefined;
    if (!customerId) {
        const customer = await stripe.customers.create({
            email: data.email ?? undefined,
            name: data.displayName ?? undefined,
            metadata: { firebaseUid: uid },
        });
        customerId = customer.id;
        await db().collection('users').doc(uid).set({ stripeCustomerId: customerId }, { merge: true });
    }
    const base = appUrl.value().replace(/\/?$/, '/');
    const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${base}?checkout=success`,
        cancel_url: `${base}?checkout=cancel`,
        client_reference_id: uid,
        metadata: { firebaseUid: uid },
        subscription_data: {
            metadata: { firebaseUid: uid },
        },
    });
    if (!session.url) {
        throw new https_1.HttpsError('internal', 'Stripe nije vratio checkout URL.');
    }
    return { url: session.url };
});
exports.createPortalSession = (0, https_1.onCall)({ secrets: [stripeSecretKey] }, async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'Prijava je obavezna.');
    }
    const data = await ensureUserDoc(request.auth.uid);
    if (!data.stripeCustomerId) {
        throw new https_1.HttpsError('failed-precondition', 'Nema Stripe naloga — prvo se pretplati.');
    }
    const stripe = stripeClient(stripeSecretKey.value());
    const base = appUrl.value().replace(/\/?$/, '/');
    const session = await stripe.billingPortal.sessions.create({
        customer: data.stripeCustomerId,
        return_url: base,
    });
    return { url: session.url };
});
async function findUidByCustomer(customerId) {
    const q = await db()
        .collection('users')
        .where('stripeCustomerId', '==', customerId)
        .limit(1)
        .get();
    if (!q.empty)
        return q.docs[0].id;
    return null;
}
async function applySubscription(uid, subscription, resetUsage) {
    const active = subscription.status === 'active' || subscription.status === 'trialing';
    const periodStart = firestore_1.Timestamp.fromMillis(subscription.current_period_start * 1000);
    const periodEnd = firestore_1.Timestamp.fromMillis(subscription.current_period_end * 1000);
    const update = {
        plan: active ? 'subscribed' : 'free',
        stripeSubscriptionId: subscription.id,
        periodStart,
        periodEnd,
    };
    if (typeof subscription.customer === 'string') {
        update.stripeCustomerId = subscription.customer;
    }
    if (resetUsage && active) {
        update.calculationsUsed = 0;
    }
    if (!active) {
        // Keep used count; block further until resubscribe
        update.plan = 'free';
    }
    await db().collection('users').doc(uid).set(update, { merge: true });
}
exports.stripeWebhook = (0, https_1.onRequest)({ secrets: [stripeSecretKey, stripeWebhookSecret] }, async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method not allowed');
        return;
    }
    const stripe = stripeClient(stripeSecretKey.value());
    const sig = req.headers['stripe-signature'];
    if (!sig || typeof sig !== 'string') {
        res.status(400).send('Missing signature');
        return;
    }
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.rawBody, sig, stripeWebhookSecret.value());
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid payload';
        res.status(400).send(`Webhook Error: ${message}`);
        return;
    }
    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object;
                const uid = session.client_reference_id ||
                    session.metadata?.firebaseUid ||
                    null;
                if (uid && session.subscription) {
                    const subId = typeof session.subscription === 'string'
                        ? session.subscription
                        : session.subscription.id;
                    const subscription = await stripe.subscriptions.retrieve(subId);
                    await applySubscription(uid, subscription, true);
                }
                break;
            }
            case 'customer.subscription.updated':
            case 'customer.subscription.deleted': {
                const subscription = event.data.object;
                const uid = subscription.metadata?.firebaseUid ||
                    (await findUidByCustomer(typeof subscription.customer === 'string'
                        ? subscription.customer
                        : subscription.customer.id));
                if (uid) {
                    await applySubscription(uid, subscription, false);
                    if (event.type === 'customer.subscription.deleted') {
                        await db().collection('users').doc(uid).set({
                            plan: 'free',
                            stripeSubscriptionId: null,
                        }, { merge: true });
                    }
                }
                break;
            }
            case 'invoice.paid': {
                const invoice = event.data.object;
                const subRef = invoice.subscription;
                if (invoice.billing_reason === 'subscription_cycle' && subRef) {
                    const subId = typeof subRef === 'string' ? subRef : subRef.id;
                    const subscription = await stripe.subscriptions.retrieve(subId);
                    const uid = subscription.metadata?.firebaseUid ||
                        (await findUidByCustomer(typeof subscription.customer === 'string'
                            ? subscription.customer
                            : subscription.customer.id));
                    if (uid) {
                        await applySubscription(uid, subscription, true);
                    }
                }
                break;
            }
            default:
                break;
        }
        res.json({ received: true });
    }
    catch (err) {
        console.error(err);
        res.status(500).send('Webhook handler failed');
    }
});
//# sourceMappingURL=index.js.map