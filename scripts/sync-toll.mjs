import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function readJson(relPath) {
  const full = path.join(root, relPath)
  if (!fs.existsSync(full)) return null
  return JSON.parse(fs.readFileSync(full, 'utf8'))
}

function runScript(relScript) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, relScript)], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `Skripta završila sa kodom ${code}`))
        return
      }
      resolve(stdout.trim())
    })
  })
}

function stationNames(payload) {
  return new Set((payload?.stations ?? []).map((s) => s.name))
}

export async function syncTollData() {
  const stationsBefore = readJson('src/data/naplatne-stanice.json')
  const pricesBefore = readJson('src/data/cenovnik-putarine.json')
  const beforeNames = stationNames(stationsBefore)

  const stationsLog = await runScript('scripts/extract-toll-stations.mjs')
  const pricesLog = await runScript('scripts/extract-toll-prices.mjs')

  const stationsAfter = readJson('src/data/naplatne-stanice.json')
  const pricesAfter = readJson('src/data/cenovnik-putarine.json')
  const afterNames = stationNames(stationsAfter)

  const added = [...afterNames].filter((name) => !beforeNames.has(name)).sort((a, b) =>
    a.localeCompare(b, 'sr'),
  )
  const removed = [...beforeNames].filter((name) => !afterNames.has(name)).sort((a, b) =>
    a.localeCompare(b, 'sr'),
  )

  return {
    ok: true,
    syncedAt: new Date().toISOString(),
    stations: {
      before: beforeNames.size,
      after: afterNames.size,
      added,
      removed,
    },
    prices: {
      beforeAt: pricesBefore?.extractedAt ?? null,
      afterAt: pricesAfter?.extractedAt ?? null,
      highwayStations: pricesAfter?.highways?.stations?.length ?? null,
      bypassStations: pricesAfter?.belgradeBypass?.stations?.length ?? null,
    },
    logs: {
      stations: stationsLog,
      prices: pricesLog,
    },
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  try {
    const result = await syncTollData()
    console.log(JSON.stringify(result, null, 2))
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}
