/**
 * Kreira PayPal product, 6 billing planova i webhook preko REST API-ja.
 *
 * Upotreba (Sandbox):
 *   PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... node scripts/setup-paypal.mjs
 *
 * Ili stavi kredencijale u functions/.env pa:
 *   node scripts/setup-paypal.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(root, 'functions', '.env')
const webhookUrl =
  'https://us-central1-transportcost.cloudfunctions.net/paypalWebhook'

const PLANS = [
  { id: 'starter-1m', name: 'Starter', priceEur: 3, months: 1, limit: 500 },
  { id: 'standard-1m', name: 'Standard', priceEur: 5, months: 1, limit: 1000 },
  { id: 'pro-1m', name: 'Pro', priceEur: 10, months: 1, limit: 2500 },
  { id: 'starter-3m', name: 'Starter', priceEur: 8, months: 3, limit: 500 },
  { id: 'standard-3m', name: 'Standard', priceEur: 12, months: 3, limit: 1000 },
  { id: 'pro-3m', name: 'Pro', priceEur: 25, months: 3, limit: 2500 },
]

const ENV_KEYS = {
  'starter-1m': 'PAYPAL_PLAN_STARTER_1M',
  'standard-1m': 'PAYPAL_PLAN_STANDARD_1M',
  'pro-1m': 'PAYPAL_PLAN_PRO_1M',
  'starter-3m': 'PAYPAL_PLAN_STARTER_3M',
  'standard-3m': 'PAYPAL_PLAN_STANDARD_3M',
  'pro-3m': 'PAYPAL_PLAN_PRO_3M',
}

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return {}
  const out = {}
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return out
}

function env() {
  const fileEnv = loadEnvFile(envPath)
  return {
    mode: process.env.PAYPAL_MODE ?? fileEnv.PAYPAL_MODE ?? 'sandbox',
    clientId: process.env.PAYPAL_CLIENT_ID ?? fileEnv.PAYPAL_CLIENT_ID ?? '',
    clientSecret:
      process.env.PAYPAL_CLIENT_SECRET ?? fileEnv.PAYPAL_CLIENT_SECRET ?? '',
    webhookId: process.env.PAYPAL_WEBHOOK_ID ?? fileEnv.PAYPAL_WEBHOOK_ID ?? '',
  }
}

function apiBase(mode) {
  return mode === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com'
}

async function getAccessToken({ mode, clientId, clientSecret }) {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const response = await fetch(`${apiBase(mode)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!response.ok) {
    throw new Error(`OAuth failed: ${response.status} ${await response.text()}`)
  }
  const data = await response.json()
  return data.access_token
}

async function paypalFetch(token, mode, pathSuffix, options = {}) {
  const response = await fetch(`${apiBase(mode)}${pathSuffix}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
  const text = await response.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!response.ok) {
    throw new Error(
      `PayPal ${options.method ?? 'GET'} ${pathSuffix} → ${response.status}: ${text}`,
    )
  }
  return body
}

async function findOrCreateProduct(token, mode) {
  const listed = await paypalFetch(token, mode, '/v1/catalogs/products?page_size=20')
  const existing = listed?.products?.find(
    (p) => p.name === 'Transport Cost' || p.id === 'TRANSPORT_COST',
  )
  if (existing?.id) {
    console.log(`Product već postoji: ${existing.id}`)
    return existing.id
  }

  const created = await paypalFetch(token, mode, '/v1/catalogs/products', {
    method: 'POST',
    body: JSON.stringify({
      id: 'TRANSPORT_COST',
      name: 'Transport Cost',
      description: 'Pretplata za transportcost.info — obračun putarine i troškova',
      type: 'SERVICE',
      category: 'SOFTWARE',
    }),
  })
  console.log(`Product kreiran: ${created.id}`)
  return created.id
}

function planLabel(plan) {
  const period = plan.months === 1 ? 'Monthly' : 'Quarterly'
  return `Transport Cost ${plan.name} (${period}, ${plan.limit}/mo)`
}

async function findPlanByName(token, mode, name) {
  const listed = await paypalFetch(
    token,
    mode,
    '/v1/billing/plans?page_size=20&total_required=true',
  )
  return listed?.plans?.find((p) => p.name === name) ?? null
}

async function createPlan(token, mode, productId, plan) {
  const name = planLabel(plan)
  const existing = await findPlanByName(token, mode, name)
  if (existing?.id) {
    console.log(`Plan već postoji: ${plan.id} → ${existing.id}`)
    return existing.id
  }

  const created = await paypalFetch(token, mode, '/v1/billing/plans', {
    method: 'POST',
    body: JSON.stringify({
      product_id: productId,
      name,
      description: `${plan.limit} računanja mesečno`,
      billing_cycles: [
        {
          frequency: {
            interval_unit: 'MONTH',
            interval_count: plan.months,
          },
          tenure_type: 'REGULAR',
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: {
            fixed_price: {
              value: plan.priceEur.toFixed(2),
              currency_code: 'EUR',
            },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        setup_fee_failure_action: 'CONTINUE',
        payment_failure_threshold: 3,
      },
    }),
  })

  try {
    await paypalFetch(token, mode, `/v1/billing/plans/${created.id}/activate`, {
      method: 'POST',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!message.includes('PLAN_STATUS_INVALID')) {
      throw err
    }
  }

  console.log(`Plan kreiran: ${plan.id} → ${created.id}`)
  return created.id
}

async function findWebhook(token, mode) {
  const listed = await paypalFetch(token, mode, '/v1/notifications/webhooks')
  return (
    listed?.webhooks?.find((w) =>
      w.url?.includes('transportcost.cloudfunctions.net/paypalWebhook'),
    ) ?? null
  )
}

async function createWebhook(token, mode) {
  const existing = await findWebhook(token, mode)
  if (existing?.id) {
    console.log(`Webhook već postoji: ${existing.id}`)
    return existing.id
  }

  const created = await paypalFetch(token, mode, '/v1/notifications/webhooks', {
    method: 'POST',
    body: JSON.stringify({
      url: webhookUrl,
      event_types: [
        { name: 'BILLING.SUBSCRIPTION.ACTIVATED' },
        { name: 'BILLING.SUBSCRIPTION.CANCELLED' },
        { name: 'BILLING.SUBSCRIPTION.EXPIRED' },
        { name: 'BILLING.SUBSCRIPTION.SUSPENDED' },
      ],
    }),
  })
  console.log(`Webhook kreiran: ${created.id}`)
  return created.id
}

function upsertEnvFile(planIds, webhookId, clientId, clientSecret, mode) {
  const lines = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, 'utf8').split('\n')
    : []

  const map = new Map()
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    map.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim())
  }

  map.set('PAYPAL_MODE', mode)
  for (const [planId, paypalPlanId] of Object.entries(planIds)) {
    map.set(ENV_KEYS[planId], paypalPlanId)
  }
  if (!map.has('APP_URL')) {
    map.set('APP_URL', 'https://transportcost.info/')
  }

  const header = [
    '# Auto-generated by scripts/setup-paypal.mjs — ne commituj!',
    `# Webhook: ${webhookUrl}`,
    '',
  ]
  const body = [...map.entries()].map(([k, v]) => `${k}=${v}`).join('\n')
  fs.writeFileSync(envPath, `${header.join('\n')}${body}\n`, 'utf8')
  console.log(`\nSačuvano u ${envPath}`)
}

async function promptCredentials(current) {
  if (current.clientId && current.clientSecret) return current
  const rl = readline.createInterface({ input, output })
  try {
    console.log(
      'PayPal Sandbox kredencijali (Apps → Sandbox → Default Application → Client ID / Secret)\n',
    )
    const clientId =
      current.clientId ||
      (await rl.question('PAYPAL_CLIENT_ID: ')).trim()
    const clientSecret =
      current.clientSecret ||
      (await rl.question('PAYPAL_CLIENT_SECRET: ')).trim()
    return { ...current, clientId, clientSecret }
  } finally {
    rl.close()
  }
}

async function main() {
  let { mode, clientId, clientSecret } = env()
  ;({ clientId, clientSecret } = await promptCredentials({ clientId, clientSecret }))
  if (!clientId || !clientSecret) {
    console.error(
      'Nedostaju PAYPAL_CLIENT_ID i PAYPAL_CLIENT_SECRET.\n' +
        'Uzmi ih sa https://developer.paypal.com/dashboard/applications/sandbox\n' +
        'pa pokreni:\n' +
        '  PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... node scripts/setup-paypal.mjs',
    )
    process.exit(1)
  }

  console.log(`PayPal setup (${mode})...\n`)
  const token = await getAccessToken({ mode, clientId, clientSecret })
  const productId = await findOrCreateProduct(token, mode)

  const planIds = {}
  for (const plan of PLANS) {
    planIds[plan.id] = await createPlan(token, mode, productId, plan)
  }

  const webhookId = await createWebhook(token, mode)

  console.log('\n=== Plan IDs ===')
  for (const [planId, paypalId] of Object.entries(planIds)) {
    console.log(`${ENV_KEYS[planId]}=${paypalId}`)
  }
  console.log(`PAYPAL_WEBHOOK_ID=${webhookId}`)

  upsertEnvFile(planIds, webhookId, clientId, clientSecret, mode)

  console.log('\nSledeći korak (Firebase deploy):')
  console.log('  firebase functions:secrets:set PAYPAL_CLIENT_ID')
  console.log('  firebase functions:secrets:set PAYPAL_CLIENT_SECRET')
  console.log('  firebase functions:secrets:set PAYPAL_WEBHOOK_ID')
  console.log('  # zatim postavi PAYPAL_PLAN_* params u Firebase')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
