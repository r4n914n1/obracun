"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitBugReport = exports.paypalWebhook = exports.createPortalSession = exports.cancelSubscription = exports.confirmPayPalSubscription = exports.createCheckoutSession = exports.claimAdReward = exports.recordSuccessfulCalculation = exports.ensureUser = void 0;
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
                monthlyLimit: billingCore_1.FREE_LIMIT,
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
            throw new https_1.HttpsError('resource-exhausted', 'Potrošio si limit računanja. Nadogradi paket ili odgledaj reklamu za +1 računanje.');
        }
        const planRemaining = (0, billingCore_1.remainingFor)(data);
        const bonus = (0, billingCore_1.bonusCalculationsFor)(data);
        const update = {};
        if (planRemaining > 0) {
            const nextUsed = (data.calculationsUsed ?? 0) + 1;
            update.calculationsUsed = nextUsed;
            if ((0, billingCore_1.isSubscriptionActive)(data)) {
                update.usageMonth = new Date().toISOString().slice(0, 7);
            }
            tx.set(ref, update, { merge: true });
            return { ...data, ...update };
        }
        if (bonus > 0) {
            update.bonusCalculations = bonus - 1;
            tx.set(ref, update, { merge: true });
            return { ...data, ...update };
        }
        throw new https_1.HttpsError('resource-exhausted', 'Potrošio si limit računanja. Nadogradi paket ili odgledaj reklamu za +1 računanje.');
    });
    if ((0, billingCore_1.hasQueuedPlan)(result) && (0, billingCore_1.currentPeriodExhausted)(result)) {
        result = await (0, billingCore_1.promoteQueuedIfReady)(uid, result);
    }
    return (0, billingCore_1.quotaPayload)(result);
});
/** Grant +1 bonus calculation after watching an ad (max 3 lifetime per account). */
exports.claimAdReward = (0, https_1.onCall)(async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'Prijava je obavezna.');
    }
    const uid = request.auth.uid;
    await (0, billingCore_1.ensureUserDoc)(uid);
    const ref = (0, billingCore_1.db)().collection('users').doc(uid);
    const result = await (0, billingCore_1.db)().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) {
            throw new https_1.HttpsError('not-found', 'Nalog nije pronađen.');
        }
        let data = (0, billingCore_1.normalizeUsage)(snap.data());
        if ((0, billingCore_1.isSubscriptionActive)(data) || (0, billingCore_1.hasQueuedPlan)(data)) {
            throw new https_1.HttpsError('failed-precondition', 'Bonus preko reklame važi samo za besplatni nalog.');
        }
        if ((0, billingCore_1.remainingFor)(data) > 0) {
            throw new https_1.HttpsError('failed-precondition', 'Još imaš besplatna računanja. Potroši ih pre reklame.');
        }
        const claimed = (0, billingCore_1.adRewardsClaimedFor)(data);
        if (claimed >= billingCore_1.AD_REWARD_LIFETIME_LIMIT) {
            throw new https_1.HttpsError('resource-exhausted', `Iskoristio si sva ${billingCore_1.AD_REWARD_LIFETIME_LIMIT} bonus računanja preko reklame. Izaberi paket da nastaviš.`);
        }
        if (!(0, billingCore_1.canClaimAdReward)(data)) {
            throw new https_1.HttpsError('failed-precondition', 'Bonus preko reklame trenutno nije dostupan.');
        }
        const nextClaimed = claimed + 1;
        const nextBonus = (0, billingCore_1.bonusCalculationsFor)(data) + 1;
        const update = {
            adRewardsClaimed: nextClaimed,
            bonusCalculations: nextBonus,
        };
        tx.set(ref, update, { merge: true });
        return { ...data, ...update };
    });
    return (0, billingCore_1.quotaPayload)(result);
});
//# sourceMappingURL=index.js.map