/**
 * Build Belgrade Obilaznica corridor polyline from OSM motorway geometry,
 * ordered Bubanj Potok → … → Batajnica.
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '../src/data/bypass-corridor.json')

const PETLJE = [
  { name: 'petlja Bubanj Potok', lat: 44.719874303434814, lng: 20.548628435767057 },
  { name: 'petlja Avala', lat: 44.71834457257174, lng: 20.494109806320612 },
  { name: 'petlja Orlovača', lat: 44.71351237702179, lng: 20.41541350973312 },
  { name: 'petlja Ostružnica', lat: 44.73303512818516, lng: 20.33519703499634 },
  { name: 'petlja Surčin Jug', lat: 44.7693711932763, lng: 20.276893837641214 },
  { name: 'petlja Surčin', lat: 44.8038853459531, lng: 20.254262626349696 },
  { name: 'petlja Beograd', lat: 44.83594308037262, lng: 20.250628098202398 },
  { name: 'petlja Batajnica', lat: 44.891427277391536, lng: 20.29629959154503 },
]

const R = 6371000

function toRad(d) {
  return (d * Math.PI) / 180
}

function haversine(a, b) {
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const s1 = Math.sin(dLat / 2)
  const s2 = Math.sin(dLng / 2)
  const h =
    s1 * s1 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * s2 * s2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

function distPointSeg(p, a, b) {
  const ax = toRad(b[1] - a[1]) * R * Math.cos(toRad(a[0]))
  const ay = toRad(b[0] - a[0]) * R
  const px = toRad(p[1] - a[1]) * R * Math.cos(toRad(a[0]))
  const py = toRad(p[0] - a[0]) * R
  const len2 = ax * ax + ay * ay
  if (len2 < 1) return { d: Math.hypot(px, py), t: 0 }
  const t = Math.max(0, Math.min(1, (px * ax + py * ay) / len2))
  return { d: Math.hypot(px - ax * t, py - ay * t), t }
}

async function fetchMotorwayWays() {
  // Compact query — geom only, motorways (no links) to avoid 504
  const query = `
[out:json][timeout:60];
way["highway"="motorway"](44.70,20.22,44.92,20.58);
out geom;
`
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'User-Agent': 'ObracunCorridor/1.0',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ data: query }),
  })
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`)
  const json = await res.json()
  return json.elements.filter((e) => e.type === 'way' && e.geometry?.length >= 2)
}

function keyOf(lat, lng) {
  return `${lat.toFixed(6)},${lng.toFixed(6)}`
}

function buildGraph(ways) {
  /** @type {Map<string, { lat: number, lng: number, edges: string[] }>} */
  const nodes = new Map()

  const ensure = (lat, lng) => {
    const k = keyOf(lat, lng)
    if (!nodes.has(k)) nodes.set(k, { lat, lng, edges: [] })
    return k
  }

  const link = (a, b) => {
    if (a === b) return
    const na = nodes.get(a)
    const nb = nodes.get(b)
    if (!na.edges.includes(b)) na.edges.push(b)
    if (!nb.edges.includes(a)) nb.edges.push(a)
  }

  const refs = {}
  for (const way of ways) {
    const ref = way.tags?.ref || way.tags?.name || 'none'
    refs[ref] = (refs[ref] || 0) + 1
    const keys = way.geometry.map((g) => ensure(g.lat, g.lon))
    for (let i = 0; i < keys.length - 1; i++) link(keys[i], keys[i + 1])
  }

  // Bridge dual carriageways / tiny gaps via spatial hash (~40 m)
  const CELL = 0.0004 // ~45 m
  /** @type {Map<string, string[]>} */
  const grid = new Map()
  for (const [k, n] of nodes) {
    const gx = Math.floor(n.lng / CELL)
    const gy = Math.floor(n.lat / CELL)
    const ck = `${gx},${gy}`
    if (!grid.has(ck)) grid.set(ck, [])
    grid.get(ck).push(k)
  }

  const BRIDGE_M = 40
  for (const [k, n] of nodes) {
    const gx = Math.floor(n.lng / CELL)
    const gy = Math.floor(n.lat / CELL)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = grid.get(`${gx + dx},${gy + dy}`)
        if (!bucket) continue
        for (const other of bucket) {
          if (other <= k) continue
          const o = nodes.get(other)
          const d = haversine([n.lat, n.lng], [o.lat, o.lng])
          if (d > 0 && d <= BRIDGE_M) link(k, other)
        }
      }
    }
  }

  return { nodes, refs }
}

function nearestNodeKey(nodes, lat, lng, maxM = 800) {
  let best = null
  let bestD = Infinity
  for (const [k, n] of nodes) {
    const d = haversine([lat, lng], [n.lat, n.lng])
    if (d < bestD) {
      bestD = d
      best = k
    }
  }
  if (best == null || bestD > maxM) {
    throw new Error(
      `No motorway node within ${maxM}m of ${lat},${lng} (nearest ${bestD.toFixed(0)}m)`,
    )
  }
  return { key: best, dist: bestD }
}

function dijkstra(nodes, startKey, endKey) {
  const dist = new Map([[startKey, 0]])
  const prev = new Map()
  /** binary-ish: push + occasional sort */
  /** @type {Array<[number, string]>} */
  const pq = [[0, startKey]]

  while (pq.length) {
    let bestI = 0
    for (let i = 1; i < pq.length; i++) {
      if (pq[i][0] < pq[bestI][0]) bestI = i
    }
    const [d, u] = pq.splice(bestI, 1)[0]
    if (u === endKey) break
    if (d > (dist.get(u) ?? Infinity)) continue
    const node = nodes.get(u)
    for (const v of node.edges) {
      const other = nodes.get(v)
      const w = haversine([node.lat, node.lng], [other.lat, other.lng])
      const nd = d + w
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd)
        prev.set(v, u)
        pq.push([nd, v])
      }
    }
  }

  if (!prev.has(endKey) && startKey !== endKey) {
    throw new Error(`No path ${startKey} → ${endKey}`)
  }

  const path = []
  let cur = endKey
  path.push(cur)
  while (cur !== startKey) {
    cur = prev.get(cur)
    if (!cur) break
    path.push(cur)
  }
  path.reverse()
  return path.map((k) => {
    const n = nodes.get(k)
    return /** @type {[number, number]} */ ([n.lat, n.lng])
  })
}

function decimate(coords, minStepM = 40) {
  if (coords.length === 0) return []
  const out = [coords[0]]
  for (let i = 1; i < coords.length; i++) {
    if (haversine(out[out.length - 1], coords[i]) >= minStepM) {
      out.push(coords[i])
    }
  }
  const last = coords[coords.length - 1]
  const tip = out[out.length - 1]
  if (tip[0] !== last[0] || tip[1] !== last[1]) out.push(last)
  return out
}

function pathLength(coords) {
  let s = 0
  for (let i = 1; i < coords.length; i++) s += haversine(coords[i - 1], coords[i])
  return s
}

async function main() {
  console.log('Fetching OSM motorways…')
  const ways = await fetchMotorwayWays()
  console.log('ways:', ways.length)

  const { nodes, refs } = buildGraph(ways)
  console.log('refs:', refs)
  console.log('nodes:', nodes.size)

  const snapped = PETLJE.map((p) => {
    const { key, dist } = nearestNodeKey(nodes, p.lat, p.lng, 1200)
    console.log(`  snap ${p.name}: ${dist.toFixed(0)}m → ${key}`)
    return { ...p, key }
  })

  /** @type {[number, number][]} */
  const corridor = []
  for (let i = 0; i < snapped.length - 1; i++) {
    const seg = dijkstra(nodes, snapped[i].key, snapped[i + 1].key)
    const km = pathLength(seg) / 1000
    console.log(
      `  ${snapped[i].name} → ${snapped[i + 1].name}: ${km.toFixed(1)} km, ${seg.length} pts`,
    )
    if (km > 25) {
      console.warn('  WARNING: segment unexpectedly long — check routing')
    }
    if (corridor.length) seg.shift()
    corridor.push(...seg)
  }

  const slim = decimate(corridor, 50)
  console.log(
    `corridor: ${slim.length} pts, ${(pathLength(slim) / 1000).toFixed(1)} km`,
  )

  const bat = [PETLJE[7].lat, PETLJE[7].lng]
  const bg = [PETLJE[6].lat, PETLJE[6].lng]
  let maxBulge = 0
  for (const p of slim) {
    const { d } = distPointSeg(p, bat, bg)
    if (d > maxBulge) maxBulge = d
  }
  console.log(`max bulge vs Bat–BG chord: ${maxBulge.toFixed(0)} m`)

  const payload = {
    note: 'Belgrade Obilaznica motorway centerline (OSM), Bubanj Potok → Batajnica. Regenerated by scripts/fetch-bypass-corridor.mjs',
    extractedAt: new Date().toISOString(),
    coordinates: slim,
  }
  writeFileSync(OUT, JSON.stringify(payload))
  console.log('wrote', OUT)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
