import naplatneStanice from '../data/naplatne-stanice.json'
import bypassPetlje from '../data/bypass-petlje.json'
import bypassCorridorData from '../data/bypass-corridor.json'
import { distanceToPolylineMeters, haversineMeters } from './geo'

/** How close the route must stay to the paid motorway corridor (m) */
export const TOLL_CORRIDOR_BUFFER_M = 1000
/**
 * Brief "off corridor" below this along-route length is treated as noise
 * (missing stations / curved A1 vs straight station polyline), not a real exit.
 * Highway: large — NS spacing / corridor approximation creates false holes.
 * Bypass: small — Avala→Beograd style shortcuts are real exits (~10–25 km).
 */
const MIN_OFF_GAP_HIGHWAY_M = 22_000
const MIN_OFF_GAP_BYPASS_M = 2_500
const MIN_ON_STRETCH_M = 2500
/** Sample spacing along the driver route */
const SAMPLE_STEP_M = 400
/** After interval split, merge sessions if station gap along route is below this */
export const SESSION_MERGE_GAP_M = 30_000
/** Bypass petlje are close; never glue re-entry tickets across a real exit. */
export const BYPASS_SESSION_MERGE_GAP_M = 2_000

export interface TollInterval {
  /** Distance along driver route where paid stretch starts */
  startAlong: number
  /** Distance along driver route where paid stretch ends */
  endAlong: number
}

function normalizeRoad(road: string): string {
  return road
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/auti-put/g, 'auto-put')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Order stations along a road by nearest-neighbor from an extreme end */
function chainStations(
  stations: Array<{ lat: number; lng: number }>,
): [number, number][] {
  if (stations.length === 0) return []
  if (stations.length === 1) return [[stations[0].lat, stations[0].lng]]

  // Prefer northmost as start (works well for Serbian N–S corridors)
  let startIdx = 0
  for (let i = 1; i < stations.length; i++) {
    if (stations[i].lat > stations[startIdx].lat) startIdx = i
  }

  const remaining = stations.map((s, i) => ({ s, i }))
  const ordered: [number, number][] = []
  let current = remaining.splice(startIdx, 1)[0].s
  ordered.push([current.lat, current.lng])

  while (remaining.length > 0) {
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineMeters(
        [current.lat, current.lng],
        [remaining[i].s.lat, remaining[i].s.lng],
      )
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
    current = remaining.splice(best, 1)[0].s
    ordered.push([current.lat, current.lng])
  }

  return ordered
}

function buildHighwayCorridors(): [number, number][][] {
  const byRoad = new Map<string, Array<{ lat: number; lng: number }>>()

  for (const station of naplatneStanice.stations) {
    const key = normalizeRoad(station.road || 'unknown')
    const list = byRoad.get(key) ?? []
    list.push({ lat: station.lat, lng: station.lng })
    byRoad.set(key, list)
  }

  const corridors: [number, number][][] = []
  const tagged: Array<{ lat: number; lng: number; road: string }> = []

  for (const [road, stations] of byRoad.entries()) {
    const line = chainStations(stations)
    if (line.length >= 2) corridors.push(line)
    for (const s of stations) tagged.push({ ...s, road })
  }

  // Junction connectors only between different roads (e.g. A1↔A5 near Ćićevac)
  for (let i = 0; i < tagged.length; i++) {
    for (let j = i + 1; j < tagged.length; j++) {
      const a = tagged[i]
      const b = tagged[j]
      if (a.road === b.road) continue
      const d = haversineMeters([a.lat, a.lng], [b.lat, b.lng])
      if (d > 500 && d < 18_000) {
        corridors.push([
          [a.lat, a.lng],
          [b.lat, b.lng],
        ])
      }
    }
  }

  return corridors
}

function buildBypassCorridor(): [number, number][] {
  const fromFile = (bypassCorridorData.coordinates ?? []) as [number, number][]
  if (fromFile.length >= 2) {
    return fromFile.map((p) => [p[0], p[1]])
  }

  // Fallback: petlja chain (less accurate — chords, not motorway centerline)
  const points: [number, number][] = []
  for (const petlja of bypassPetlje) {
    points.push([petlja.lat, petlja.lng])
    for (const anchor of petlja.anchors ?? []) {
      points.push([anchor[0], anchor[1]])
    }
  }
  const center: [number, number] = [44.78, 20.35]
  const unique: [number, number][] = []
  for (const p of points) {
    if (
      unique.some(
        (u) => Math.abs(u[0] - p[0]) < 1e-4 && Math.abs(u[1] - p[1]) < 1e-4,
      )
    ) {
      continue
    }
    unique.push(p)
  }
  unique.sort((a, b) => {
    const aa = Math.atan2(a[0] - center[0], a[1] - center[1])
    const bb = Math.atan2(b[0] - center[0], b[1] - center[1])
    return aa - bb
  })
  return unique
}

const HIGHWAY_CORRIDORS = buildHighwayCorridors()
const BYPASS_CORRIDOR = buildBypassCorridor()

function distanceToCorridors(
  point: [number, number],
  corridors: [number, number][][],
): number {
  let best = Infinity
  for (const corridor of corridors) {
    const d = distanceToPolylineMeters(point, corridor)
    if (d < best) best = d
  }
  return best
}

function sampleRoute(
  route: [number, number][],
  stepMeters: number,
): Array<{ point: [number, number]; along: number }> {
  const samples: Array<{ point: [number, number]; along: number }> = []
  if (route.length === 0) return samples

  samples.push({ point: route[0], along: 0 })
  let along = 0
  let sinceSample = 0

  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i]
    const b = route[i + 1]
    const segLen = haversineMeters(a, b)
    if (segLen < 1) continue

    let consumed = 0
    while (sinceSample + (segLen - consumed) >= stepMeters) {
      const need = stepMeters - sinceSample
      const t = (consumed + need) / segLen
      const lat = a[0] + (b[0] - a[0]) * t
      const lng = a[1] + (b[1] - a[1]) * t
      along += need
      samples.push({ point: [lat, lng], along })
      consumed += need
      sinceSample = 0
    }

    sinceSample += segLen - consumed
    along += segLen - consumed
  }

  const last = route[route.length - 1]
  const lastSample = samples[samples.length - 1]
  if (
    !lastSample ||
    lastSample.point[0] !== last[0] ||
    lastSample.point[1] !== last[1]
  ) {
    samples.push({ point: last, along })
  }

  return samples
}

function intervalsFromFlags(
  samples: Array<{ along: number; on: boolean }>,
  minOffGapM: number,
): TollInterval[] {
  const raw: TollInterval[] = []
  let start: number | null = null

  for (const sample of samples) {
    if (sample.on && start == null) start = sample.along
    if (!sample.on && start != null) {
      raw.push({ startAlong: start, endAlong: sample.along })
      start = null
    }
  }
  if (start != null) {
    raw.push({
      startAlong: start,
      endAlong: samples[samples.length - 1]?.along ?? start,
    })
  }

  // Merge if OFF gap between stretches is tiny (GPS/sample noise)
  const merged: TollInterval[] = []
  for (const interval of raw) {
    const prev = merged[merged.length - 1]
    if (prev && interval.startAlong - prev.endAlong < minOffGapM) {
      prev.endAlong = interval.endAlong
    } else {
      merged.push({ ...interval })
    }
  }

  return merged.filter((i) => i.endAlong - i.startAlong >= MIN_ON_STRETCH_M)
}

/**
 * Find contiguous stretches where the route stays on the paid highway network.
 * Leaving the corridor ends a sequence; re-entering starts a new one.
 */
export function findHighwayTollIntervals(
  route: [number, number][],
  bufferMeters: number = TOLL_CORRIDOR_BUFFER_M,
): TollInterval[] {
  const samples = sampleRoute(route, SAMPLE_STEP_M).map((s) => ({
    along: s.along,
    on: distanceToCorridors(s.point, HIGHWAY_CORRIDORS) <= bufferMeters,
  }))
  return intervalsFromFlags(samples, MIN_OFF_GAP_HIGHWAY_M)
}

export function findBypassTollIntervals(
  route: [number, number][],
  bufferMeters: number = 500,
): TollInterval[] {
  const corridors = [BYPASS_CORRIDOR]
  const samples = sampleRoute(route, SAMPLE_STEP_M).map((s) => ({
    along: s.along,
    on: distanceToCorridors(s.point, corridors) <= bufferMeters,
  }))
  return intervalsFromFlags(samples, MIN_OFF_GAP_BYPASS_M)
}

/** Assign detected station passages into corridor ON intervals */
export function assignStationsToIntervals<
  T extends { distanceAlongRoute: number },
>(stations: T[], intervals: TollInterval[]): T[][] {
  return intervals.map((interval) =>
    stations.filter(
      (s) =>
        s.distanceAlongRoute >= interval.startAlong - 500 &&
        s.distanceAlongRoute <= interval.endAlong + 500,
    ),
  )
}

/** Merge sessions separated only by a short along-route gap (false corridor holes). */
export function mergeCloseSessions<
  T extends { distanceAlongRoute: number },
>(sessions: T[][], maxGapMeters: number = SESSION_MERGE_GAP_M): T[][] {
  const nonempty = sessions.filter((s) => s.length > 0)
  if (nonempty.length === 0) return []

  const merged: T[][] = [nonempty[0]]
  for (let i = 1; i < nonempty.length; i++) {
    const prev = merged[merged.length - 1]
    const curr = nonempty[i]
    const prevEnd = prev[prev.length - 1].distanceAlongRoute
    const currStart = curr[0].distanceAlongRoute
    if (currStart - prevEnd <= maxGapMeters) {
      merged[merged.length - 1] = [...prev, ...curr]
    } else {
      merged.push(curr)
    }
  }
  return merged
}
