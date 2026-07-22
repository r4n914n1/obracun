"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitBugReport = void 0;
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const resendApiKey = (0, params_1.defineSecret)('RESEND_API_KEY');
const supportEmail = (0, params_1.defineString)('SUPPORT_EMAIL', {
    default: 'support@transportcost.info',
});
const mailFrom = (0, params_1.defineString)('MAIL_FROM', {
    default: 'Transport Cost <noreply@transportcost.info>',
});
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function parsePayload(data) {
    if (!data || typeof data !== 'object') {
        throw new https_1.HttpsError('invalid-argument', 'Invalid payload.');
    }
    const row = data;
    const email = String(row.email ?? '').trim();
    const message = String(row.message ?? '').trim();
    if (!EMAIL_RE.test(email)) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid email.');
    }
    if (message.length < 10) {
        throw new https_1.HttpsError('invalid-argument', 'Message is too short.');
    }
    if (message.length > 8000) {
        throw new https_1.HttpsError('invalid-argument', 'Message is too long.');
    }
    return { email, message };
}
async function sendWithResend(apiKey, from, to, replyTo, message) {
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from,
            to: [to],
            reply_to: replyTo,
            subject: `[Bug report] ${replyTo}`,
            text: message,
        }),
    });
    if (!response.ok) {
        const body = await response.text();
        console.error('Resend error', response.status, body);
        throw new https_1.HttpsError('internal', 'Failed to send email.');
    }
}
exports.submitBugReport = (0, https_1.onCall)({ secrets: [resendApiKey] }, async (request) => {
    const { email, message } = parsePayload(request.data);
    await (0, firestore_1.getFirestore)()
        .collection('bugReports')
        .add({
        email,
        message,
        uid: request.auth?.uid ?? null,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
        userAgent: typeof request.rawRequest?.headers?.['user-agent'] === 'string'
            ? request.rawRequest.headers['user-agent']
            : null,
    });
    await sendWithResend(resendApiKey.value(), mailFrom.value(), supportEmail.value(), email, message);
    return { ok: true };
});
//# sourceMappingURL=submitBugReport.js.map