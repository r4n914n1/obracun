"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FREE_LIMIT = void 0;
exports.db = db;
exports.currentUsageMonth = currentUsageMonth;
exports.isSubscriptionActive = isSubscriptionActive;
exports.effectiveLimit = effectiveLimit;
exports.currentPeriodExhausted = currentPeriodExhausted;
exports.hasQueuedPlan = hasQueuedPlan;
exports.isCancelAtPeriodEnd = isCancelAtPeriodEnd;
exports.normalizeUsage = normalizeUsage;
exports.remainingFor = remainingFor;
exports.canCalculate = canCalculate;
exports.clearQueueFields = clearQueueFields;
exports.applyQueuedPlan = applyQueuedPlan;
exports.promoteQueuedIfReady = promoteQueuedIfReady;
exports.ensureUserDoc = ensureUserDoc;
exports.quotaPayload = quotaPayload;
exports.applyPayPalSubscription = applyPayPalSubscription;
exports.queuePayPalSubscription = queuePayPalSubscription;
exports.scheduleCancelAtPeriodEnd = scheduleCancelAtPeriodEnd;
exports.deactivateSubscription = deactivateSubscription;
const firestore_1 = require("firebase-admin/firestore");
const auth_1 = require("firebase-admin/auth");
const firestore_2 = require("firebase-admin/firestore");
const plans_1 = require("./plans");
exports.FREE_LIMIT = 10;
function db() {
    return (0, firestore_1.getFirestore)();
}
function currentUsageMonth() {
    return new Date().toISOString().slice(0, 7);
}
function isSubscriptionActive(data, now = Date.now()) {
    if (data.plan !== 'subscribed')
        return false;
    if (!data.periodEnd)
        return true;
    return data.periodEnd.toMillis() > now;
}
function effectiveLimit(data) {
    if (isSubscriptionActive(data)) {
        const fromPlan = typeof data.monthlyLimit === 'number' ? data.monthlyLimit : null;
        if (fromPlan && fromPlan > 0)
            return fromPlan;
        const planId = typeof data.planId === 'string' ? data.planId : null;
        if (planId) {
            const def = (0, plans_1.planDefinition)(planId);
            if (def)
                return def.monthlyLimit;
        }
        return 1000;
    }
    return exports.FREE_LIMIT;
}
/** Current paid period is finished by time or by used quota. */
function currentPeriodExhausted(data, now = Date.now()) {
    if (data.plan !== 'subscribed')
        return true;
    if (data.periodEnd && data.periodEnd.toMillis() <= now)
        return true;
    const limit = effectiveLimit(data);
    const used = typeof data.calculationsUsed === 'number' ? data.calculationsUsed : 0;
    return used >= limit;
}
function hasQueuedPlan(data) {
    return typeof data.queuedPlanId === 'string' && data.queuedPlanId.length > 0;
}
function isCancelAtPeriodEnd(data) {
    return data.cancelAtPeriodEnd === true;
}
function normalizeUsage(data) {
    if (!isSubscriptionActive(data)) {
        return data;
    }
    // While upgrade is queued or cancel is scheduled, keep current period usage.
    if (hasQueuedPlan(data) || isCancelAtPeriodEnd(data)) {
        return data;
    }
    const month = currentUsageMonth();
    if (data.usageMonth !== month) {
        return { ...data, usageMonth: month, calculationsUsed: 0 };
    }
    return data;
}
function remainingFor(data) {
    const normalized = normalizeUsage(data);
    const limit = effectiveLimit(normalized);
    const used = normalized.calculationsUsed ?? 0;
    return Math.max(0, limit - used);
}
function canCalculate(data) {
    if (hasQueuedPlan(data) && currentPeriodExhausted(data)) {
        // Queued plan will be promoted; treat as calculable after promote.
        return true;
    }
    if (data.plan === 'subscribed' && !isSubscriptionActive(data)) {
        return false;
    }
    return remainingFor(data) > 0;
}
function clearQueueFields() {
    return {
        queuedPlanId: null,
        queuedPaypalSubscriptionId: null,
        queuedPeriodEnd: null,
    };
}
async function applyQueuedPlan(uid, data) {
    const queuedPlanId = typeof data.queuedPlanId === 'string' ? data.queuedPlanId : null;
    if (!queuedPlanId)
        return data;
    const plan = (0, plans_1.planDefinition)(queuedPlanId);
    const queuedSubId = typeof data.queuedPaypalSubscriptionId === 'string'
        ? data.queuedPaypalSubscriptionId
        : null;
    const queuedPeriodEnd = data.queuedPeriodEnd && typeof data.queuedPeriodEnd.toDate === 'function'
        ? data.queuedPeriodEnd
        : null;
    const update = {
        plan: 'subscribed',
        planId: queuedPlanId,
        monthlyLimit: plan?.monthlyLimit ?? exports.FREE_LIMIT,
        paypalSubscriptionId: queuedSubId,
        calculationsUsed: 0,
        usageMonth: currentUsageMonth(),
        periodEnd: queuedPeriodEnd,
        pendingPaypalSubscriptionId: null,
        pendingPlanId: null,
        ...clearQueueFields(),
    };
    await db().collection('users').doc(uid).set(update, { merge: true });
    return { ...data, ...update };
}
/**
 * If a queued upgrade exists and the current period is done (time or quota),
 * promote the queued plan to active. If cancel was scheduled and period is done,
 * drop to free.
 */
async function promoteQueuedIfReady(uid, data) {
    if (hasQueuedPlan(data) && currentPeriodExhausted(data)) {
        return applyQueuedPlan(uid, data);
    }
    if (isCancelAtPeriodEnd(data) &&
        currentPeriodExhausted(data) &&
        !hasQueuedPlan(data)) {
        await deactivateSubscription(uid);
        const again = await db().collection('users').doc(uid).get();
        return again.data() ?? data;
    }
    return data;
}
async function ensureUserDoc(uid) {
    const ref = db().collection('users').doc(uid);
    const snap = await ref.get();
    if (snap.exists) {
        let data = snap.data();
        data = await promoteQueuedIfReady(uid, data);
        const normalized = normalizeUsage(data);
        if (normalized.usageMonth !== data.usageMonth ||
            normalized.calculationsUsed !== data.calculationsUsed) {
            await ref.set({
                usageMonth: normalized.usageMonth ?? null,
                calculationsUsed: normalized.calculationsUsed ?? 0,
            }, { merge: true });
        }
        return normalized;
    }
    const authUser = await (0, auth_1.getAuth)().getUser(uid);
    const created = {
        email: authUser.email ?? null,
        displayName: authUser.displayName ?? null,
        photoURL: authUser.photoURL ?? null,
        plan: 'free',
        planId: null,
        monthlyLimit: exports.FREE_LIMIT,
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
        createdAt: firestore_2.FieldValue.serverTimestamp(),
    };
    await ref.set(created, { merge: true });
    const again = await ref.get();
    return again.data();
}
function quotaPayload(data) {
    const normalized = normalizeUsage(data);
    const limit = effectiveLimit(normalized);
    const used = normalized.calculationsUsed ?? 0;
    return {
        plan: isSubscriptionActive(normalized) || hasQueuedPlan(normalized)
            ? 'subscribed'
            : 'free',
        planId: typeof normalized.planId === 'string' ? normalized.planId : null,
        queuedPlanId: typeof normalized.queuedPlanId === 'string'
            ? normalized.queuedPlanId
            : null,
        cancelAtPeriodEnd: isCancelAtPeriodEnd(normalized),
        calculationsUsed: used,
        limit,
        remaining: Math.max(0, limit - used),
        canCalculate: canCalculate(normalized),
        periodEnd: normalized.periodEnd
            ? normalized.periodEnd.toDate().toISOString()
            : null,
    };
}
async function applyPayPalSubscription(uid, options) {
    const plan = (0, plans_1.planDefinition)(options.appPlanId);
    const active = options.status === 'ACTIVE' || options.status === 'APPROVED';
    const update = {
        paypalSubscriptionId: options.subscriptionId,
        pendingPaypalSubscriptionId: null,
        pendingPlanId: null,
        cancelAtPeriodEnd: false,
        plan: active ? 'subscribed' : 'free',
        planId: active ? options.appPlanId : null,
        monthlyLimit: active ? (plan?.monthlyLimit ?? exports.FREE_LIMIT) : exports.FREE_LIMIT,
        periodEnd: options.periodEnd ? firestore_1.Timestamp.fromDate(options.periodEnd) : null,
        ...clearQueueFields(),
    };
    if (options.resetUsage && active) {
        update.calculationsUsed = 0;
        update.usageMonth = currentUsageMonth();
    }
    if (!active) {
        update.paypalSubscriptionId = null;
    }
    await db().collection('users').doc(uid).set(update, { merge: true });
}
/** Store a paid upgrade to activate when current period ends or quota is used. */
async function queuePayPalSubscription(uid, options) {
    const active = options.status === 'ACTIVE' || options.status === 'APPROVED';
    if (!active) {
        throw new Error('Queued PayPal subscription is not active.');
    }
    const update = {
        queuedPlanId: options.appPlanId,
        queuedPaypalSubscriptionId: options.subscriptionId,
        queuedPeriodEnd: options.periodEnd
            ? firestore_1.Timestamp.fromDate(options.periodEnd)
            : null,
        pendingPaypalSubscriptionId: null,
        pendingPlanId: null,
        cancelAtPeriodEnd: false,
        // Keep current plan/limit/usage/periodEnd as-is.
    };
    await db().collection('users').doc(uid).set(update, { merge: true });
}
async function scheduleCancelAtPeriodEnd(uid) {
    await db().collection('users').doc(uid).set({
        cancelAtPeriodEnd: true,
        paypalSubscriptionId: null,
        pendingPaypalSubscriptionId: null,
        pendingPlanId: null,
        ...clearQueueFields(),
        // Keep plan / planId / monthlyLimit / calculationsUsed / periodEnd.
    }, { merge: true });
}
async function deactivateSubscription(uid) {
    await db().collection('users').doc(uid).set({
        plan: 'free',
        planId: null,
        monthlyLimit: exports.FREE_LIMIT,
        paypalSubscriptionId: null,
        pendingPaypalSubscriptionId: null,
        pendingPlanId: null,
        periodEnd: null,
        cancelAtPeriodEnd: false,
        ...clearQueueFields(),
    }, { merge: true });
}
//# sourceMappingURL=billingCore.js.map