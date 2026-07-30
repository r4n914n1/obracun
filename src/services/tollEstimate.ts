import naplatneStanice from '../data/naplatne-stanice.json'
import bypassPetlje from '../data/bypass-petlje.json'
import priceIndex from '../data/cenovnik-eur-index.json'
import type { VehicleMode } from '../types'
import { findPassagesAlongRoute, haversineMeters } from './geo'
import {
  assignStationsToIntervals,
  BYPASS_SESSION_MERGE_GAP_M,
  findBypassTollIntervals,
  findHighwayTollIntervals,
  mergeCloseSessions,
  SESSION_MERGE_GAP_M,
} from './tollNetwork'

/** Max distance from route centerline to count a toll station (m) */
const HIGHWAY_PROXIMITY_M = 1000
/** Bypass petlje — same radius as highway NS */
const BYPASS_PROXIMITY_M = 1000

const DEFAULT_RSD_PER_EUR = 117.37

export type TollCategoryCode = '1' | '2' | '3' | '4'

export interface DetectedTollStation {
  name: string
  cenovnikName: string | null
  lat: number
  lng: number
  distanceAlongRoute: number
  distanceToRoute: number
  kind: 'highway' | 'bypass'
  passageIndex: number
}

export interface PaidTollLeg {
  kind: 'highway' | 'bypass'
  from: string
  to: string
  eur: number
  stations: string[]
  /** Human label of itinerary segment, e.g. "Vršac → Niš" */
  routeLegLabel: string | null
}

export interface TollEstimate {
  category: TollCategoryCode
  categoryLabel: string
  detectedStations: DetectedTollStation[]
  paidLegs: PaidTollLeg[]
  highwayEur: number
  bypassEur: number
  bypass: {
    applicable: boolean
    note: string | null
    rsdPerEur: number | null
  }
  totalEur: number
}

const NAME_ALIASES: Record<string, string> = {
  'doljevac selo': 'Doljevac',
  malca: 'Niš Malča',
  'novi sad jug': 'Novi Sad',
  'novi sad sever': 'Novi Sad',
  preljina: 'Preljina jug',
}

/**
 * Čeone NS (Stara Pazova, Šimanovci): zvanični kalkulator traži ulaz kao „Beograd“.
 * https://putevi-srbije.rs — napomena uz cenovnik.
 */
const CEONA_PRICED_AS_BEOGRAD = new Set(['stara pazova', 'simanovci'])

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/^ns\s+/i, '')
    .replace(/^petlja\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripNsPrefix(name: string): string {
  return name.replace(/^NS\s+/i, '').trim()
}

function toCenovnikHighwayName(stationName: string): string | null {
  const bare = stripNsPrefix(stationName)
  const key = normalizeName(bare)

  if (NAME_ALIASES[key]) return NAME_ALIASES[key]

  // Čeone NS nisu u cenovniku kao ulaz — čuvamo ime za prikaz; cenu mapiramo na Beograd.
  if (key === 'stara pazova') return 'Stara Pazova'
  if (key === 'simanovci') return 'Šimanovci'

  const exact = priceIndex.highwayStations.find(
    (s) => normalizeName(s) === key,
  )
  if (exact) return exact

  const partial = priceIndex.highwayStations.find((s) => {
    const n = normalizeName(s)
    return n.includes(key) || key.includes(n)
  })
  return partial ?? null
}

/** Map entry/exit name used for price lookup (čeona → Beograd). */
function pricingStationName(cenovnikName: string): string {
  if (CEONA_PRICED_AS_BEOGRAD.has(normalizeName(cenovnikName))) {
    return 'Beograd'
  }
  return cenovnikName
}

export function vehicleModeToTollCategory(mode: VehicleMode): {
  code: TollCategoryCode
  label: string
} {
  switch (mode) {
    case 'car':
      return { code: '1', label: '1. kategorija (automobil)' }
    case 'freight_under_3_5':
      return { code: '2', label: '2. kategorija (teretno <3.5t)' }
    case 'freight_3_6_to_10':
      return { code: '3', label: '3. kategorija (teretno 3.6–10t)' }
    case 'freight_over_10':
      return { code: '4', label: '4. kategorija (teretno 10t+)' }
  }
}

function lookupPrice(
  index: Record<string, Record<string, number>>,
  from: string,
  to: string,
  category: TollCategoryCode,
): number | null {
  const forward = index[`${from}|${to}`]
  if (forward && typeof forward[category] === 'number') {
    return forward[category]
  }
  const reverse = index[`${to}|${from}`]
  if (reverse && typeof reverse[category] === 'number') {
    return reverse[category]
  }
  return null
}

function priceSession(
  index: Record<string, Record<string, number>>,
  session: DetectedTollStation[],
  category: TollCategoryCode,
  kind: 'highway' | 'bypass',
  routeLegLabel: string | null,
  /** If set, index values are RSD and will be converted to EUR */
  rsdPerEur: number | null,
): PaidTollLeg | null {
  const names: string[] = []
  for (const s of session) {
    if (!s.cenovnikName) continue
    if (names[names.length - 1] === s.cenovnikName) continue
    names.push(s.cenovnikName)
  }

  if (names.length < 2) return null

  const fromDisplay = names[0]
  const toDisplay = names[names.length - 1]
  const from = pricingStationName(fromDisplay)
  const to = pricingStationName(toDisplay)
  if (from === to) return null

  let amount = lookupPrice(index, from, to, category)
  if (amount == null || amount <= 0) {
    let sum = 0
    let used = false
    for (let i = 0; i < names.length - 1; i++) {
      const segment = lookupPrice(
        index,
        pricingStationName(names[i]),
        pricingStationName(names[i + 1]),
        category,
      )
      if (segment != null && segment > 0) {
        sum += segment
        used = true
      }
    }
    amount = used ? sum : 0
  }

  if (amount <= 0) return null

  const eur =
    rsdPerEur != null && rsdPerEur > 0
      ? Math.round((amount / rsdPerEur) * 100) / 100
      : Math.round(amount * 100) / 100

  const fromLabel = fromDisplay
  const toLabel = toDisplay

  return {
    kind,
    from: fromLabel,
    to: toLabel,
    eur,
    stations: names,
    routeLegLabel,
  }
}

function priceAllSessions(
  sessions: DetectedTollStation[][],
  index: Record<string, Record<string, number>>,
  category: TollCategoryCode,
  kind: 'highway' | 'bypass',
  routeLegLabel: string | null,
  rsdPerEur: number | null = null,
): PaidTollLeg[] {
  const legs: PaidTollLeg[] = []
  for (const session of sessions) {
    const leg = priceSession(
      index,
      session,
      category,
      kind,
      routeLegLabel,
      rsdPerEur,
    )
    if (leg) legs.push(leg)
  }
  return legs
}

/**
 * Split station passages by leaving / re-entering the paid motorway corridor.
 * Each contiguous "on toll road" stretch = one ticket (sequence).
 */
export function splitIntoTollSessions(
  ordered: DetectedTollStation[],
  routeCoordinates: [number, number][],
  kind: 'highway' | 'bypass',
): DetectedTollStation[][] {
  if (ordered.length === 0) return []

  const intervals =
    kind === 'bypass'
      ? findBypassTollIntervals(routeCoordinates)
      : findHighwayTollIntervals(routeCoordinates)

  if (intervals.length === 0) {
    // Fallback: one session if stations exist but corridor sample missed
    return ordered.length >= 2 ? [ordered] : []
  }

  const assigned = assignStationsToIntervals(ordered, intervals).filter(
    (session) => session.length > 0,
  )
  const mergeGap =
    kind === 'bypass' ? BYPASS_SESSION_MERGE_GAP_M : SESSION_MERGE_GAP_M
  return mergeCloseSessions(assigned, mergeGap)
}

function estimateTollOnCoordinates(
  routeCoordinates: [number, number][],
  vehicleMode: VehicleMode,
  routeLegLabel: string | null,
  rsdPerEurInput?: number,
): Omit<TollEstimate, 'category' | 'categoryLabel'> & {
  category: TollCategoryCode
  categoryLabel: string
} {
  const { code: category, label: categoryLabel } =
    vehicleModeToTollCategory(vehicleMode)

  const detected: DetectedTollStation[] = []

  for (const station of naplatneStanice.stations) {
    const passages = findPassagesAlongRoute(
      [station.lat, station.lng],
      routeCoordinates,
      HIGHWAY_PROXIMITY_M,
    )

    passages.forEach((projection, passageIndex) => {
      detected.push({
        name: station.name,
        cenovnikName: toCenovnikHighwayName(station.name),
        lat: station.lat,
        lng: station.lng,
        distanceAlongRoute: projection.distanceAlongRoute,
        distanceToRoute: projection.distanceToRoute,
        kind: 'highway',
        passageIndex,
      })
    })
  }

  const bypassHits: DetectedTollStation[] = []
  for (const petlja of bypassPetlje) {
    const probePoints: Array<[number, number]> = [
      [petlja.lat, petlja.lng],
      ...((petlja.anchors as Array<[number, number]> | undefined) ?? []),
    ]

    const passages: Array<{
      distanceAlongRoute: number
      distanceToRoute: number
    }> = []

    for (const point of probePoints) {
      for (const projection of findPassagesAlongRoute(
        point,
        routeCoordinates,
        BYPASS_PROXIMITY_M,
      )) {
        passages.push(projection)
      }
    }

    passages.sort((a, b) => a.distanceAlongRoute - b.distanceAlongRoute)
    const merged: typeof passages = []
    for (const p of passages) {
      const last = merged[merged.length - 1]
      if (last && Math.abs(p.distanceAlongRoute - last.distanceAlongRoute) < 2500) {
        if (p.distanceToRoute < last.distanceToRoute) {
          last.distanceAlongRoute = p.distanceAlongRoute
          last.distanceToRoute = p.distanceToRoute
        }
        continue
      }
      merged.push({ ...p })
    }

    merged.forEach((projection, passageIndex) => {
      bypassHits.push({
        name: petlja.name,
        cenovnikName: petlja.name,
        lat: petlja.lat,
        lng: petlja.lng,
        distanceAlongRoute: projection.distanceAlongRoute,
        distanceToRoute: projection.distanceToRoute,
        kind: 'bypass',
        passageIndex,
      })
    })
  }

  detected.sort((a, b) => a.distanceAlongRoute - b.distanceAlongRoute)
  bypassHits.sort((a, b) => a.distanceAlongRoute - b.distanceAlongRoute)

  const highwaySessions = splitIntoTollSessions(
    detected,
    routeCoordinates,
    'highway',
  )
  const highwayLegs = priceAllSessions(
    highwaySessions,
    priceIndex.highways as Record<string, Record<string, number>>,
    category,
    'highway',
    routeLegLabel,
    null,
  )

  const rsdPerEur =
    typeof rsdPerEurInput === 'number' && rsdPerEurInput > 0
      ? rsdPerEurInput
      : DEFAULT_RSD_PER_EUR

  const bypassApplicable = vehicleMode === 'freight_over_10'
  let bypassNote: string | null = null
  let bypassLegs: PaidTollLeg[] = []

  const bypassIndex = priceIndex.bypassRsd as Record<
    string,
    Record<string, number>
  >

  if (!bypassApplicable) {
    if (bypassHits.length >= 2) {
      bypassNote =
        'Ruta prolazi Obilaznicom, ali putarina Obilaznice se računa samo za teretno 10t+.'
    }
  } else {
    const bypassSessions = splitIntoTollSessions(
      bypassHits,
      routeCoordinates,
      'bypass',
    )
    bypassLegs = priceAllSessions(
      bypassSessions,
      bypassIndex,
      category,
      'bypass',
      routeLegLabel,
      rsdPerEur,
    )
    if (bypassLegs.length > 0) {
      bypassNote = `Obilaznica: RSD→EUR po NBS srednjem kursu ${rsdPerEur.toFixed(4)}.`
    } else if (bypassHits.length === 1) {
      bypassNote = `Detektovana samo jedna petlja Obilaznice (${bypassHits[0].name}).`
    } else if (bypassHits.length >= 2) {
      bypassNote =
        'Petlje Obilaznice detektovane, ali nema cene u cenovniku za te parove.'
    }
  }

  const paidLegs = [...highwayLegs, ...bypassLegs]
  const highwayEur =
    Math.round(highwayLegs.reduce((sum, leg) => sum + leg.eur, 0) * 100) / 100
  const bypassEur =
    Math.round(bypassLegs.reduce((sum, leg) => sum + leg.eur, 0) * 100) / 100

  const allDetected = [...detected, ...bypassHits].sort(
    (a, b) => a.distanceAlongRoute - b.distanceAlongRoute,
  )

  return {
    category,
    categoryLabel,
    detectedStations: allDetected,
    paidLegs,
    highwayEur,
    bypassEur,
    bypass: {
      applicable: bypassApplicable,
      note: bypassNote,
      rsdPerEur: bypassApplicable ? rsdPerEur : null,
    },
    totalEur: Math.round((highwayEur + bypassEur) * 100) / 100,
  }
}

/** Offset detection distances so merged list stays ordered across itinerary legs. */
function offsetDetectedStations(
  stations: DetectedTollStation[],
  offsetMeters: number,
): DetectedTollStation[] {
  return stations.map((s) => ({
    ...s,
    distanceAlongRoute: s.distanceAlongRoute + offsetMeters,
  }))
}

/**
 * Estimate tolls for a full itinerary.
 * When `routeLegs` is provided (A → stops → B), each leg is priced separately
 * so a stop like Niš always starts a new toll ticket window.
 */
export function estimateToll(
  routeCoordinates: [number, number][],
  vehicleMode: VehicleMode,
  routeLegs?: Array<{
    coordinates: [number, number][]
    fromLabel: string
    toLabel: string
  }>,
  rsdPerEur?: number,
): TollEstimate {
  if (!routeLegs?.length) {
    return estimateTollOnCoordinates(
      routeCoordinates,
      vehicleMode,
      null,
      rsdPerEur,
    )
  }

  const { code: category, label: categoryLabel } =
    vehicleModeToTollCategory(vehicleMode)

  const paidLegs: PaidTollLeg[] = []
  const detectedStations: DetectedTollStation[] = []
  const bypassNotes: string[] = []
  let highwayEur = 0
  let bypassEur = 0
  let bypassApplicable = false
  let usedRate: number | null = null
  let distanceOffset = 0

  for (const leg of routeLegs) {
    if (leg.coordinates.length < 2) continue

    const label = `${leg.fromLabel} → ${leg.toLabel}`
    const part = estimateTollOnCoordinates(
      leg.coordinates,
      vehicleMode,
      label,
      rsdPerEur,
    )

    paidLegs.push(...part.paidLegs)
    detectedStations.push(
      ...offsetDetectedStations(part.detectedStations, distanceOffset),
    )
    highwayEur += part.highwayEur
    bypassEur += part.bypassEur
    bypassApplicable = bypassApplicable || part.bypass.applicable
    if (part.bypass.rsdPerEur != null) usedRate = part.bypass.rsdPerEur
    if (part.bypass.note) bypassNotes.push(`${label}: ${part.bypass.note}`)

    const legLength = leg.coordinates.reduce((sum, point, index) => {
      if (index === 0) return 0
      return sum + haversineMeters(leg.coordinates[index - 1], point)
    }, 0)
    distanceOffset += legLength
  }

  detectedStations.sort((a, b) => a.distanceAlongRoute - b.distanceAlongRoute)

  return {
    category,
    categoryLabel,
    detectedStations,
    paidLegs,
    highwayEur: Math.round(highwayEur * 100) / 100,
    bypassEur: Math.round(bypassEur * 100) / 100,
    bypass: {
      applicable: bypassApplicable,
      note: bypassNotes.length > 0 ? bypassNotes.join(' ') : null,
      rsdPerEur: usedRate,
    },
    totalEur: Math.round((highwayEur + bypassEur) * 100) / 100,
  }
}
