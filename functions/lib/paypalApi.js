"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appUrl = exports.paypalMode = exports.paypalWebhookId = exports.paypalClientSecret = exports.paypalClientId = void 0;
exports.paypalApiBase = paypalApiBase;
exports.paypalManageUrl = paypalManageUrl;
exports.paypalPlanIdForAppPlan = paypalPlanIdForAppPlan;
exports.appPlanIdFromPaypalPlan = appPlanIdFromPaypalPlan;
exports.getPayPalAccessToken = getPayPalAccessToken;
exports.createPayPalSubscription = createPayPalSubscription;
exports.fetchPayPalSubscription = fetchPayPalSubscription;
exports.cancelPayPalSubscription = cancelPayPalSubscription;
exports.revisePayPalSubscription = revisePayPalSubscription;
exports.verifyPayPalWebhook = verifyPayPalWebhook;
exports.parsePeriodEnd = parsePeriodEnd;
const params_1 = require("firebase-functions/params");
exports.paypalClientId = (0, params_1.defineSecret)('PAYPAL_CLIENT_ID');
exports.paypalClientSecret = (0, params_1.defineSecret)('PAYPAL_CLIENT_SECRET');
exports.paypalWebhookId = (0, params_1.defineSecret)('PAYPAL_WEBHOOK_ID');
exports.paypalMode = (0, params_1.defineString)('PAYPAL_MODE', { default: 'sandbox' });
exports.appUrl = (0, params_1.defineString)('APP_URL', { default: 'https://transportcost.info/' });
const paypalPlanLite1m = (0, params_1.defineString)('PAYPAL_PLAN_LITE_1M');
const paypalPlanStarter1m = (0, params_1.defineString)('PAYPAL_PLAN_STARTER_1M');
const paypalPlanStandard1m = (0, params_1.defineString)('PAYPAL_PLAN_STANDARD_1M');
const paypalPlanPro1m = (0, params_1.defineString)('PAYPAL_PLAN_PRO_1M');
const paypalPlanStarter3m = (0, params_1.defineString)('PAYPAL_PLAN_STARTER_3M');
const paypalPlanStandard3m = (0, params_1.defineString)('PAYPAL_PLAN_STANDARD_3M');
const paypalPlanPro3m = (0, params_1.defineString)('PAYPAL_PLAN_PRO_3M');
const PAYPAL_PLAN_BY_APP = {
    'lite-1m': paypalPlanLite1m,
    'starter-1m': paypalPlanStarter1m,
    'standard-1m': paypalPlanStandard1m,
    'pro-1m': paypalPlanPro1m,
    'starter-3m': paypalPlanStarter3m,
    'standard-3m': paypalPlanStandard3m,
    'pro-3m': paypalPlanPro3m,
};
function paypalApiBase() {
    return exports.paypalMode.value() === 'live'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com';
}
function paypalManageUrl() {
    return exports.paypalMode.value() === 'live'
        ? 'https://www.paypal.com/myaccount/autopay/'
        : 'https://www.sandbox.paypal.com/myaccount/autopay/';
}
function paypalPlanIdForAppPlan(appPlanId) {
    const param = PAYPAL_PLAN_BY_APP[appPlanId];
    if (!param) {
        throw new Error('Nepoznat paket.');
    }
    const planId = param.value().trim();
    if (!planId) {
        throw new Error(`PayPal plan nije podešen za paket ${appPlanId}.`);
    }
    return planId;
}
function appPlanIdFromPaypalPlan(paypalPlanId) {
    for (const [appPlanId, param] of Object.entries(PAYPAL_PLAN_BY_APP)) {
        if (param.value().trim() === paypalPlanId) {
            return appPlanId;
        }
    }
    return null;
}
let cachedToken = null;
async function getPayPalAccessToken() {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) {
        return cachedToken.value;
    }
    const clientId = exports.paypalClientId.value();
    const clientSecret = exports.paypalClientSecret.value();
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await fetch(`${paypalApiBase()}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`PayPal auth failed: ${response.status} ${body}`);
    }
    const data = (await response.json());
    cachedToken = {
        value: data.access_token,
        expiresAt: Date.now() + data.expires_in * 1000,
    };
    return data.access_token;
}
async function createPayPalSubscription(paypalPlanId, customId, returnUrl, cancelUrl) {
    const token = await getPayPalAccessToken();
    const response = await fetch(`${paypalApiBase()}/v1/billing/subscriptions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            plan_id: paypalPlanId,
            custom_id: customId,
            application_context: {
                brand_name: 'Transport Cost',
                user_action: 'SUBSCRIBE_NOW',
                return_url: returnUrl,
                cancel_url: cancelUrl,
            },
        }),
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`PayPal subscription create failed: ${response.status} ${body}`);
    }
    const data = (await response.json());
    const approval = data.links?.find((link) => link.rel === 'approve');
    if (!approval?.href) {
        throw new Error('PayPal nije vratio approval link.');
    }
    return { id: data.id, approvalUrl: approval.href };
}
async function fetchPayPalSubscription(subscriptionId) {
    const token = await getPayPalAccessToken();
    const response = await fetch(`${paypalApiBase()}/v1/billing/subscriptions/${subscriptionId}`, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`PayPal subscription fetch failed: ${response.status} ${body}`);
    }
    return (await response.json());
}
async function cancelPayPalSubscription(subscriptionId, reason = 'Cancelled by user in Transport Cost') {
    const token = await getPayPalAccessToken();
    const response = await fetch(`${paypalApiBase()}/v1/billing/subscriptions/${subscriptionId}/cancel`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason }),
    });
    if (!response.ok && response.status !== 204) {
        const body = await response.text();
        throw new Error(`PayPal cancel failed: ${response.status} ${body}`);
    }
}
async function revisePayPalSubscription(subscriptionId, paypalPlanId, returnUrl, cancelUrl) {
    const token = await getPayPalAccessToken();
    const response = await fetch(`${paypalApiBase()}/v1/billing/subscriptions/${subscriptionId}/revise`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            plan_id: paypalPlanId,
            application_context: {
                brand_name: 'Transport Cost',
                user_action: 'SUBSCRIBE_NOW',
                return_url: returnUrl,
                cancel_url: cancelUrl,
            },
        }),
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`PayPal revise failed: ${response.status} ${body}`);
    }
    const data = (await response.json());
    const approval = data.links?.find((link) => link.rel === 'approve');
    return {
        id: data.id ?? subscriptionId,
        approvalUrl: approval?.href ?? null,
    };
}
async function verifyPayPalWebhook(headers, body) {
    const header = (name) => {
        const raw = headers[name] ?? headers[name.toLowerCase()];
        if (Array.isArray(raw))
            return raw[0] ?? '';
        return typeof raw === 'string' ? raw : '';
    };
    const token = await getPayPalAccessToken();
    const response = await fetch(`${paypalApiBase()}/v1/notifications/verify-webhook-signature`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            auth_algo: header('paypal-auth-algo'),
            cert_url: header('paypal-cert-url'),
            transmission_id: header('paypal-transmission-id'),
            transmission_sig: header('paypal-transmission-sig'),
            transmission_time: header('paypal-transmission-time'),
            webhook_id: exports.paypalWebhookId.value(),
            webhook_event: body,
        }),
    });
    if (!response.ok) {
        console.error('PayPal webhook verify HTTP', response.status, await response.text());
        return false;
    }
    const data = (await response.json());
    return data.verification_status === 'SUCCESS';
}
function parsePeriodEnd(sub) {
    const raw = sub.billing_info?.next_billing_time;
    if (!raw)
        return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
}
//# sourceMappingURL=paypalApi.js.map