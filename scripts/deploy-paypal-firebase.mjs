/**
 * Postavlja PayPal secrets i params u Firebase iz functions/.env
 * (pokreni posle scripts/setup-paypal.mjs)
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(root, 'functions', '.env')
const secretsPath = path.join(root, 'functions', '.env.secrets')

function loadEnvFile(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Nema ${file} — prvo pokreni: node scripts/setup-paypal.mjs`)
  }
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

function secretValues() {
  const fileEnv = {
    ...loadEnvFile(envPath),
    ...(fs.existsSync(secretsPath) ? loadEnvFile(secretsPath) : {}),
  }
  const pick = (key) => (process.env[key] ?? fileEnv[key] ?? '').trim()
  return {
    PAYPAL_CLIENT_ID: pick('PAYPAL_CLIENT_ID'),
    PAYPAL_CLIENT_SECRET: pick('PAYPAL_CLIENT_SECRET'),
    PAYPAL_WEBHOOK_ID: pick('PAYPAL_WEBHOOK_ID'),
  }
}

function runFirebaseSecretSet(name, value) {
  const tempFile = path.join(os.tmpdir(), `firebase-secret-${name}-${Date.now()}.txt`)
  fs.writeFileSync(tempFile, value, 'utf8')
  return new Promise((resolve, reject) => {
    const child = spawn('firebase', ['functions:secrets:set', name, '--data-file', tempFile], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => {
      stdout += c
    })
    child.stderr.on('data', (c) => {
      stderr += c
    })
    child.on('error', reject)
    child.on('close', (code) => {
      fs.rmSync(tempFile, { force: true })
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `exit ${code}`))
        return
      }
      resolve(stdout.trim())
    })
  })
}

async function setSecret(name, value) {
  if (!value) {
    console.warn(`Preskačem ${name} (prazno)`)
    return
  }
  console.log(`Postavljam secret ${name}...`)
  await runFirebaseSecretSet(name, value)
}

async function verifyPayPalAuth(clientId, clientSecret, mode) {
  const base =
    mode === 'live'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com'
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const response = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`PayPal ${mode} auth ne prolazi: ${response.status} ${body}`)
  }
}

async function main() {
  const fileEnv = loadEnvFile(envPath)
  const mode = (process.env.PAYPAL_MODE ?? fileEnv.PAYPAL_MODE ?? 'sandbox')
    .trim()
    .toLowerCase()
  const secrets = secretValues()
  const required = [
    'PAYPAL_CLIENT_ID',
    'PAYPAL_CLIENT_SECRET',
    'PAYPAL_WEBHOOK_ID',
  ]
  for (const key of required) {
    if (!secrets[key]) {
      throw new Error(
        `Nedostaje ${key}. Postavi env var ili pokreni setup-paypal prvo.`,
      )
    }
  }

  console.log(`Proveravam PayPal ${mode} auth...`)
  await verifyPayPalAuth(
    secrets.PAYPAL_CLIENT_ID,
    secrets.PAYPAL_CLIENT_SECRET,
    mode,
  )

  await setSecret('PAYPAL_CLIENT_ID', secrets.PAYPAL_CLIENT_ID)
  await setSecret('PAYPAL_CLIENT_SECRET', secrets.PAYPAL_CLIENT_SECRET)
  await setSecret('PAYPAL_WEBHOOK_ID', secrets.PAYPAL_WEBHOOK_ID)

  // Firebase učitava functions/.env + .env.<project> — bez secret key-eva
  // (inače konflikt sa defineSecret).
  const projectEnv = path.join(root, 'functions', '.env.transportcost')
  const paramLines = [
    '# Generated for Firebase params — no PAYPAL_CLIENT_* / WEBHOOK secrets',
    `PAYPAL_MODE=${fileEnv.PAYPAL_MODE ?? mode}`,
    `APP_URL=${fileEnv.APP_URL ?? 'https://transportcost.info/'}`,
  ]
  for (const key of [
    'PAYPAL_PLAN_LITE_1M',
    'PAYPAL_PLAN_STARTER_1M',
    'PAYPAL_PLAN_STANDARD_1M',
    'PAYPAL_PLAN_PRO_1M',
    'PAYPAL_PLAN_STARTER_3M',
    'PAYPAL_PLAN_STANDARD_3M',
    'PAYPAL_PLAN_PRO_3M',
  ]) {
    if (fileEnv[key]) paramLines.push(`${key}=${fileEnv[key]}`)
  }
  fs.writeFileSync(projectEnv, `${paramLines.join('\n')}\n`, 'utf8')
  console.log(`Kopirano (bez secreta) u ${projectEnv}`)

  console.log('\nGotovo. Deploy:')
  console.log('  firebase deploy --only functions')
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
