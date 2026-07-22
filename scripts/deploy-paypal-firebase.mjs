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
  const fileEnv = loadEnvFile(envPath)
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

async function verifyPayPalAuth(clientId, clientSecret) {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const response = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`PayPal sandbox auth ne prolazi: ${response.status} ${body}`)
  }
}

async function main() {
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

  await verifyPayPalAuth(secrets.PAYPAL_CLIENT_ID, secrets.PAYPAL_CLIENT_SECRET)

  await setSecret('PAYPAL_CLIENT_ID', secrets.PAYPAL_CLIENT_ID)
  await setSecret('PAYPAL_CLIENT_SECRET', secrets.PAYPAL_CLIENT_SECRET)
  await setSecret('PAYPAL_WEBHOOK_ID', secrets.PAYPAL_WEBHOOK_ID)

  // Firebase učitava functions/.env pri deploy-u za defineString params
  const projectEnv = path.join(root, 'functions', '.env.transportcost')
  fs.copyFileSync(envPath, projectEnv)
  console.log(`Kopirano u ${projectEnv}`)

  console.log('\nGotovo. Deploy:')
  console.log('  firebase deploy --only functions,hosting')
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
