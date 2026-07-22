"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitBugReport = exports.paypalWebhook = exports.createPortalSession = exports.cancelSubscription = exports.confirmPayPalSubscription = exports.createCheckoutSession = exports.recordSuccessfulCalculation = exports.ensureUser = void 0;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const auth_1 = require("firebase-admin/auth");
const billingCore_1 = require("./billingCore");
const submitBugReport_1 = require("./submitBugReport");
Object.defineProperty(exports, "submitBugReport", { enumerable: true, get: function () { return submitBugReport_1.submitBugReport; } });
const paypalBilling_1 = require("./paypalBilling");
Object.defineProperty(exports, "confirmPayPalSubscription", { enumerable: true, get: function () { return paypalBilling_1.confirmPayPalSubscription; } });
Object.defineProperty(exports, "cancelSubscription", { enumerable: true, get: function () { return paypalBilling_1.cancelSubscription; } });
Object.defineProperty(exports, "createCheckoutSession", { enumerable: true, get: function () { return paypalBilling_1.createCheckoutSession; } });
Object.defineProperty(exports, "createPortalSession", { enumerable: true, get: function () { return paypalBilling_1.createPortalSession; } });
Object.defineProperty(exports, "paypalWebhook", { enumerable: true, get: function () { return paypalBilling_1.paypalWebhook; } });
(0, app_1.initializeApp)();
exports.ensureUser = (0, https_1.onCall)(async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'Prijava je obavezna.');
    }
    const data = await (0, billingCore_1.ensureUserDoc)(request.auth.uid);
    return (0, billingCore_1.quotaPayload)(data);
});
exports.recordSuccessfulCalculation = (0, https_1.onCall)(async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'Prijava je obavezna.');
    }
    const uid = request.auth.uid;
    // Promote queued upgrade if current period already ended / quota used.
    await (0, billingCore_1.ensureUserDoc)(uid);
    const ref = (0, billingCore_1.db)().collection('users').doc(uid);
    let result = await (0, billingCore_1.db)().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        let data;
        if (!snap.exists) {
            const authUser = await (0, auth_1.getAuth)().getUser(uid);
            data = {
                email: authUser.email ?? null,
                displayName: authUser.displayName ?? null,
                photoURL: authUser.photoURL ?? null,
                plan: 'free',
                planId: null,
                monthlyLimit: 10,
                calculationsUsed: 0,
                usageMonth: null,
                createdAt: firestore_1.FieldValue.serverTimestamp(),
            };
            tx.set(ref, data, { merge: true });
        }
        else {
            data = snap.data();
        }
        data = (0, billingCore_1.normalizeUsage)(data);
        if (data.plan === 'subscribed' &&
            !(0, billingCore_1.isSubscriptionActive)(data) &&
            !(0, billingCore_1.hasQueuedPlan)(data)) {
            throw new https_1.HttpsError('resource-exhausted', 'Pretplata je istekla. Pretplati se ponovo da nastaviš.');
        }
        if (!(0, billingCore_1.canCalculate)(data)) {
            throw new https_1.HttpsError('resource-exhausted', 'Potrošio si limit računanja. Nadogradi paket ili sačekaj sledeći period.');
        }
        const nextUsed = (data.calculationsUsed ?? 0) + 1;
        const update = {
            calculationsUsed: nextUsed,
        };
        if ((0, billingCore_1.isSubscriptionActive)(data)) {
            update.usageMonth = new Date().toISOString().slice(0, 7);
        }
        tx.set(ref, update, { merge: true });
        const next = { ...data, calculationsUsed: nextUsed, ...update };
        return next;
    });
    if ((0, billingCore_1.hasQueuedPlan)(result) && (0, billingCore_1.currentPeriodExhausted)(result)) {
        result = await (0, billingCore_1.promoteQueuedIfReady)(uid, result);
    }
    return (0, billingCore_1.quotaPayload)(result);
});
//# sourceMappingURL=index.js.map