import { defineSecret, defineString } from 'firebase-functions/params'

export const paypalClientId = defineSecret('PAYPAL_CLIENT_ID')
export const paypalClientSecret = defineSecret('PAYPAL_CLIENT_SECRET')
export const paypalWebhookId = defineSecret('PAYPAL_WEBHOOK_ID')
export const paypalMode = defineString('PAYPAL_MODE', { default: 'sandbox' })
export const appUrl = defineString('APP_URL', { default: 'https://transportcost.info/' })

const paypalPlanStarter1m = defineString('PAYPAL_PLAN_STARTER_1M')
const paypalPlanStandard1m = defineString('PAYPAL_PLAN_STANDARD_1M')
const paypalPlanPro1m = defineString('PAYPAL_PLAN_PRO_1M')
const paypalPlanStarter3m = defineString('PAYPAL_PLAN_STARTER_3M')
const paypalPlanStandard3m = defineString('PAYPAL_PLAN_STANDARD_3M')
const paypalPlanPro3m = defineString('PAYPAL_PLAN_PRO_3M')

const PAYPAL_PLAN_BY_APP: Record<string, ReturnType<typeof defineString>> = {
  'starter-1m': paypalPlanStarter1m,
  'standard-1m': paypalPlanStandard1m,
  'pro-1m': paypalPlanPro1m,
  'starter-3m': paypalPlanStarter3m,
  'standard-3m': paypalPlanStandard3m,
  'pro-3m': paypalPlanPro3m,
}

export function paypalApiBase(): string {
  return paypalMode.value() === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com'
}

export function paypalManageUrl(): string {
  return paypalMode.value() === 'live'
    ? 'https://www.paypal.com/myaccount/autopay/'
    : 'https://www.sandbox.paypal.com/myaccount/autopay/'
}

export function paypalPlanIdForAppPlan(appPlanId: string): string {
  const param = PAYPAL_PLAN_BY_APP[appPlanId]
  if (!param) {
    throw new Error('Nepoznat paket.')
  }
  const planId = param.value().trim()
  if (!planId) {
    throw new Error(`PayPal plan nije podešen za paket ${appPlanId}.`)
  }
  return planId
}

export function appPlanIdFromPaypalPlan(paypalPlanId: string): string | null {
  for (const [appPlanId, param] of Object.entries(PAYPAL_PLAN_BY_APP)) {
    if (param.value().trim() === paypalPlanId) {
      return appPlanId
    }
  }
  return null
}

let cachedToken: { value: string; expiresAt: number } | null = null

export async function getPayPalAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value
  }

  const clientId = paypalClientId.value()
  const clientSecret = paypalClientSecret.value()
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const response = await fetch(`${paypalApiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`PayPal auth failed: ${response.status} ${body}`)
  }

  const data = (await response.json()) as {
    access_token: string
    expires_in: number
  }
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
  return data.access_token
}

export interface PayPalSubscription {
  id: string
  status: string
  plan_id: string
  custom_id?: string
  billing_info?: {
    next_billing_time?: string
  }
}

export async function createPayPalSubscription(
  paypalPlanId: string,
  customId: string,
  returnUrl: string,
  cancelUrl: string,
): Promise<{ id: string; approvalUrl: string }> {
  const token = await getPayPalAccessToken()
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
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`PayPal subscription create failed: ${response.status} ${body}`)
  }

  const data = (await response.json()) as {
    id: string
    links?: Array<{ rel: string; href: string }>
  }
  const approval = data.links?.find((link) => link.rel === 'approve')
  if (!approval?.href) {
    throw new Error('PayPal nije vratio approval link.')
  }
  return { id: data.id, approvalUrl: approval.href }
}

export async function fetchPayPalSubscription(
  subscriptionId: string,
): Promise<PayPalSubscription> {
  const token = await getPayPalAccessToken()
  const response = await fetch(
    `${paypalApiBase()}/v1/billing/subscriptions/${subscriptionId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  )
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`PayPal subscription fetch failed: ${response.status} ${body}`)
  }
  return (await response.json()) as PayPalSubscription
}

export async function cancelPayPalSubscription(
  subscriptionId: string,
  reason = 'Cancelled by user in Transport Cost',
): Promise<void> {
  const token = await getPayPalAccessToken()
  const response = await fetch(
    `${paypalApiBase()}/v1/billing/subscriptions/${subscriptionId}/cancel`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason }),
    },
  )
  if (!response.ok && response.status !== 204) {
    const body = await response.text()
    throw new Error(`PayPal cancel failed: ${response.status} ${body}`)
  }
}

export async function revisePayPalSubscription(
  subscriptionId: string,
  paypalPlanId: string,
  returnUrl: string,
  cancelUrl: string,
): Promise<{ id: string; approvalUrl: string | null }> {
  const token = await getPayPalAccessToken()
  const response = await fetch(
    `${paypalApiBase()}/v1/billing/subscriptions/${subscriptionId}/revise`,
    {
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
    },
  )
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`PayPal revise failed: ${response.status} ${body}`)
  }

  const data = (await response.json()) as {
    id?: string
    links?: Array<{ rel: string; href: string }>
  }
  const approval = data.links?.find((link) => link.rel === 'approve')
  return {
    id: data.id ?? subscriptionId,
    approvalUrl: approval?.href ?? null,
  }
}

export async function verifyPayPalWebhook(
  headers: Record<string, string | string[] | undefined>,
  body: unknown,
): Promise<boolean> {
  const header = (name: string): string => {
    const raw = headers[name] ?? headers[name.toLowerCase()]
    if (Array.isArray(raw)) return raw[0] ?? ''
    return typeof raw === 'string' ? raw : ''
  }

  const token = await getPayPalAccessToken()
  const response = await fetch(
    `${paypalApiBase()}/v1/notifications/verify-webhook-signature`,
    {
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
        webhook_id: paypalWebhookId.value(),
        webhook_event: body,
      }),
    },
  )
  if (!response.ok) {
    console.error('PayPal webhook verify HTTP', response.status, await response.text())
    return false
  }
  const data = (await response.json()) as { verification_status?: string }
  return data.verification_status === 'SUCCESS'
}

export function parsePeriodEnd(sub: PayPalSubscription): Date | null {
  const raw = sub.billing_info?.next_billing_time
  if (!raw) return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}
