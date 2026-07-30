"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitBugReport = void 0;
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const resendApiKey = (0, params_1.defineSecret)('RESEND_API_KEY');
const supportEmail = (0, params_1.defineString)('SUPPORT_EMAIL', {
    // Until transportcost.info is Verified in Resend, only the account email can receive.
    default: 'r4n914n1@gmail.com',
});
const mailFrom = (0, params_1.defineString)('MAIL_FROM', {
    default: 'Transport Cost <onboarding@resend.dev>',
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
            text: [
                `Reply-To / korisnik: ${replyTo}`,
                '',
                message,
            ].join('\n'),
        }),
    });
    if (!response.ok) {
        const body = await response.text();
        console.error('Resend error', response.status, body);
        let detail = 'Failed to send email.';
        try {
            const parsed = JSON.parse(body);
            if (parsed.message)
                detail = parsed.message;
        }
        catch {
            // keep default
        }
        throw new https_1.HttpsError('internal', detail);
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
    const apiKey = resendApiKey.value().trim();
    if (!apiKey || apiKey === 'placeholder-not-configured') {
        console.error('RESEND_API_KEY is missing or placeholder');
        throw new https_1.HttpsError('failed-precondition', 'E-mail slanje nije podešeno (Resend API key). Prijava je sačuvana u bazi.');
    }
    try {
        await sendWithResend(apiKey, mailFrom.value(), supportEmail.value(), email, message);
    }
    catch (err) {
        console.error(err);
        const detail = err instanceof https_1.HttpsError && err.message
            ? err.message
            : 'Prijava je sačuvana, ali slanje e-maila nije uspelo. Proveri Resend API key / domen.';
        throw new https_1.HttpsError('internal', detail.startsWith('Prijava')
            ? detail
            : `Prijava je sačuvana, ali slanje e-maila nije uspelo: ${detail}`);
    }
    return { ok: true };
});
//# sourceMappingURL=submitBugReport.js.map