import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { defineSecret, defineString } from 'firebase-functions/params'

const resendApiKey = defineSecret('RESEND_API_KEY')
const supportEmail = defineString('SUPPORT_EMAIL', {
  default: 'support@transportcost.info',
})
const mailFrom = defineString('MAIL_FROM', {
  default: 'Transport Cost <noreply@transportcost.info>',
})

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function parsePayload(data: unknown): { email: string; message: string } {
  if (!data || typeof data !== 'object') {
    throw new HttpsError('invalid-argument', 'Invalid payload.')
  }
  const row = data as Record<string, unknown>
  const email = String(row.email ?? '').trim()
  const message = String(row.message ?? '').trim()

  if (!EMAIL_RE.test(email)) {
    throw new HttpsError('invalid-argument', 'Invalid email.')
  }
  if (message.length < 10) {
    throw new HttpsError('invalid-argument', 'Message is too short.')
  }
  if (message.length > 8000) {
    throw new HttpsError('invalid-argument', 'Message is too long.')
  }

  return { email, message }
}

async function sendWithResend(
  apiKey: string,
  from: string,
  to: string,
  replyTo: string,
  message: string,
): Promise<void> {
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
  })

  if (!response.ok) {
    const body = await response.text()
    console.error('Resend error', response.status, body)
    throw new HttpsError('internal', 'Failed to send email.')
  }
}

export const submitBugReport = onCall(
  { secrets: [resendApiKey] },
  async (request) => {
    const { email, message } = parsePayload(request.data)

    await getFirestore()
      .collection('bugReports')
      .add({
        email,
        message,
        uid: request.auth?.uid ?? null,
        createdAt: FieldValue.serverTimestamp(),
        userAgent:
          typeof request.rawRequest?.headers?.['user-agent'] === 'string'
            ? request.rawRequest.headers['user-agent']
            : null,
      })

    await sendWithResend(
      resendApiKey.value(),
      mailFrom.value(),
      supportEmail.value(),
      email,
      message,
    )

    return { ok: true }
  },
)
