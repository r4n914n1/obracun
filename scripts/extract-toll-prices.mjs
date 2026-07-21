import fs from 'fs'
import vm from 'vm'

const PAGE_URL =
  'https://www.putevi-srbije.rs/index.php/%D0%BA%D0%B0%D1%82%D0%B5%D0%B3%D0%BE%D1%80%D0%B8%D0%B7%D0%B0%D1%86%D0%B8%D1%98%D0%B0-%D0%B2%D0%BE%D0%B7%D0%B8%D0%BB%D0%B0-%D1%86%D0%B5%D0%BD%D0%BE%D0%B2%D0%BD%D0%B8%D0%BA-%D0%BF%D1%83%D1%82%D0%B0%D1%80%D0%B8%D0%BD%D0%B5'
const DIST_JS_URL = 'https://www.putevi-srbije.rs/cenovnici/dist.js?ver=2'

const CATEGORIES = [
  { code: '1a', label: '1а категорија' },
  { code: '1', label: '1. категорија' },
  { code: '2', label: '2. категорија' },
  { code: '3', label: '3. категорија' },
  { code: '4', label: '4. категорија' },
]

const CATEGORY_DEFINITIONS = [
  {
    code: '1a',
    label: '1а категорија',
    description:
      'Моторна возила са карактеристикама мотоцикла, моторног троцикла и четвороцикла',
  },
  {
    code: '1',
    label: '1. категорија',
    description:
      'Моторна возила са две осовине и висине ≤ 1,3m код прве осовине; или комби са две осовине, висине ≤ 1,9m и МДМ ≤ 3.500kg',
  },
  {
    code: '2',
    label: '2. категорија',
    description:
      'Возила 1. категорије са приколицом; или комби висине > 1,9m са МДМ ≤ 3.500kg',
  },
  {
    code: '3',
    label: '3. категорија',
    description:
      'Моторна возила са 2 или 3 осовине, висине > 1,3m код прве осовине и МДМ > 3.500kg',
  },
  {
    code: '4',
    label: '4. категорија',
    description:
      'Моторна возила са 4 и више осовина (укључујући приколицу), висине > 1,3m код прве осовине и МДМ > 3.500kg',
  },
]

function extractScriptByStart(html, marker) {
  const start = html.indexOf(marker)
  if (start < 0) throw new Error(`Nije pronađen marker: ${marker}`)
  const open = html.lastIndexOf('<script', start)
  const close = html.indexOf('</script>', start)
  if (open < 0 || close < 0) throw new Error(`Neispravan script blok oko: ${marker}`)
  const tagEnd = html.indexOf('>', open) + 1
  return html.slice(tagEnd, close)
}

function loadArrays(jsSource, names) {
  // Strip browser-only glue so matrices/lists can run in Node
  const sanitized = jsSource
    .replace(/window\.onload\s*=\s*start\s*;?/g, '')
    .replace(/function\s+\w+\s*\([^)]*\)\s*\{[\s\S]*?\n\}/g, '')

  const context = { Array }
  vm.createContext(context)
  vm.runInContext(sanitized, context)
  const out = {}
  for (const name of names) {
    if (!(name in context)) throw new Error(`Nedostaje ${name}`)
    out[name] = context[name]
  }
  return out
}

function buildMatrix(stationNames, distMatrix, euroMatrix) {
  const n = stationNames.length
  const pairs = []

  for (let from = 0; from < n; from++) {
    for (let to = 0; to < n; to++) {
      if (from === to) continue
      const row = distMatrix[from]
      const euroRow = euroMatrix[from]
      if (!row || !euroRow) continue

      const pricesRsd = {}
      const pricesEur = {}
      let hasPrice = false

      for (let c = 0; c < CATEGORIES.length; c++) {
        const code = CATEGORIES[c].code
        const rsd = Number(row[to * 5 + c])
        const eur = Number(euroRow[to * 5 + c])
        pricesRsd[code] = Number.isFinite(rsd) ? rsd : 0
        pricesEur[code] = Number.isFinite(eur) ? eur : 0
        if (pricesRsd[code] > 0 || pricesEur[code] > 0) hasPrice = true
      }

      if (!hasPrice) continue

      pairs.push({
        from: stationNames[from],
        fromIndex: from,
        to: stationNames[to],
        toIndex: to,
        pricesRsd,
        pricesEur,
      })
    }
  }

  return pairs
}

function toCsv(pairs) {
  const header = [
    'from',
    'to',
    'kat1a_rsd',
    'kat1_rsd',
    'kat2_rsd',
    'kat3_rsd',
    'kat4_rsd',
    'kat1a_eur',
    'kat1_eur',
    'kat2_eur',
    'kat3_eur',
    'kat4_eur',
  ].join(',')

  const rows = pairs.map((p) =>
    [
      `"${p.from}"`,
      `"${p.to}"`,
      p.pricesRsd['1a'],
      p.pricesRsd['1'],
      p.pricesRsd['2'],
      p.pricesRsd['3'],
      p.pricesRsd['4'],
      p.pricesEur['1a'],
      p.pricesEur['1'],
      p.pricesEur['2'],
      p.pricesEur['3'],
      p.pricesEur['4'],
    ].join(','),
  )

  return [header, ...rows].join('\n')
}

console.log('Downloading calculator page and dist.js...')
const [pageRes, distRes] = await Promise.all([
  fetch(PAGE_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } }),
  fetch(DIST_JS_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } }),
])

if (!pageRes.ok) throw new Error(`Page HTTP ${pageRes.status}`)
if (!distRes.ok) throw new Error(`dist.js HTTP ${distRes.status}`)

const pageHtml = await pageRes.text()
const distJs = await distRes.text()

const { city, petlja } = loadArrays(distJs, ['city', 'petlja'])
const stationNames = city.map((row) => row[0])
const bypassNames = petlja.map((row) => row[0])

const mainScript = extractScriptByStart(pageHtml, 'var dist = new Array()')
const bypassScript = extractScriptByStart(pageHtml, 'var dist1 = new Array()')

const { dist, euro } = loadArrays(mainScript, ['dist', 'euro'])
const { dist1, euro1 } = loadArrays(bypassScript, ['dist1', 'euro1'])

const mainPairs = buildMatrix(stationNames, dist, euro)
const bypassPairs = buildMatrix(bypassNames, dist1, euro1)

fs.mkdirSync('src/data', { recursive: true })
fs.mkdirSync('public/data', { recursive: true })

const payload = {
  source: PAGE_URL,
  extractedAt: new Date().toISOString(),
  categories: CATEGORY_DEFINITIONS,
  highways: {
    stations: stationNames,
    pairCount: mainPairs.length,
    pairs: mainPairs,
  },
  belgradeBypass: {
    stations: bypassNames,
    pairCount: bypassPairs.length,
    pairs: bypassPairs,
  },
  pdfs: {
    highways: 'https://www.putevi-srbije.rs/images/pdf/cene_putarina_cir.pdf',
    bypass:
      'https://www.putevi-srbije.rs/images/pdf/cene_putarina_obilaznica_lat.pdf',
  },
}

const json = JSON.stringify(payload, null, 2)
fs.writeFileSync('src/data/cenovnik-putarine.json', json, 'utf8')
fs.writeFileSync('public/data/cenovnik-putarine.json', json, 'utf8')

const mainCsv = toCsv(mainPairs)
const bypassCsv = toCsv(bypassPairs)
fs.writeFileSync('src/data/cenovnik-putarine.csv', mainCsv, 'utf8')
fs.writeFileSync('public/data/cenovnik-putarine.csv', mainCsv, 'utf8')
fs.writeFileSync('src/data/cenovnik-obilaznica.csv', bypassCsv, 'utf8')
fs.writeFileSync('public/data/cenovnik-obilaznica.csv', bypassCsv, 'utf8')

fs.writeFileSync(
  'src/data/kategorije-vozila.json',
  JSON.stringify(
    {
      source: PAGE_URL,
      extractedAt: new Date().toISOString(),
      categories: CATEGORY_DEFINITIONS,
    },
    null,
    2,
  ),
  'utf8',
)

function buildEurIndex(pairs) {
  const idx = {}
  for (const p of pairs) {
    idx[`${p.from}|${p.to}`] = p.pricesEur
  }
  return idx
}

/** Official bypass "euro" array equals RSD; keep RSD and convert at runtime with NBS middle rate. */
function buildBypassRsd(pairs) {
  const idx = {}
  for (const p of pairs) {
    idx[`${p.from}|${p.to}`] = p.pricesRsd
  }
  return idx
}

const eurIndex = {
  note: 'Highway EUR from official calculator. Bypass amounts are RSD; convert with NBS middle rate at runtime.',
  highways: buildEurIndex(mainPairs),
  bypassRsd: buildBypassRsd(bypassPairs),
  highwayStations: stationNames,
  bypassStations: bypassNames,
}
fs.writeFileSync(
  'src/data/cenovnik-eur-index.json',
  JSON.stringify(eurIndex),
  'utf8',
)

console.log(
  `Highways: ${stationNames.length} stations, ${mainPairs.length} priced pairs`,
)
console.log(
  `Bypass: ${bypassNames.length} stations, ${bypassPairs.length} priced pairs`,
)
console.log('Wrote src/data/cenovnik-putarine.json (+ csv + EUR index)')
