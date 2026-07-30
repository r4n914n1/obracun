import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { defineSecret, defineString } from 'firebase-functions/params'

const resendApiKey = defineSecret('RESEND_API_KEY')
const supportEmail = defineString('SUPPORT_EMAIL', {
  // Until transportcost.info is Verified in Resend, only the account email can receive.
  default: 'r4n914n1@gmail.com',
})
const mailFrom = defineString('MAIL_FROM', {
  default: 'Transport Cost <onboarding@resend.dev>',
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
      text: [
        `Reply-To / korisnik: ${replyTo}`,
        '',
        message,
      ].join('\n'),
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    console.error('Resend error', response.status, body)
    let detail = 'Failed to send email.'
    try {
      const parsed = JSON.parse(body) as { message?: string }
      if (parsed.message) detail = parsed.message
    } catch {
      // keep default
    }
    throw new HttpsError('internal', detail)
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

    const apiKey = resendApiKey.value().trim()
    if (!apiKey || apiKey === 'placeholder-not-configured') {
      console.error('RESEND_API_KEY is missing or placeholder')
      throw new HttpsError(
        'failed-precondition',
        'E-mail slanje nije podešeno (Resend API key). Prijava je sačuvana u bazi.',
      )
    }

    try {
      await sendWithResend(
        apiKey,
        mailFrom.value(),
        supportEmail.value(),
        email,
        message,
      )
    } catch (err) {
      console.error(err)
      const detail =
        err instanceof HttpsError && err.message
          ? err.message
          : 'Prijava je sačuvana, ali slanje e-maila nije uspelo. Proveri Resend API key / domen.'
      throw new HttpsError(
        'internal',
        detail.startsWith('Prijava')
          ? detail
          : `Prijava je sačuvana, ali slanje e-maila nije uspelo: ${detail}`,
      )
    }

    return { ok: true }
  },
)
