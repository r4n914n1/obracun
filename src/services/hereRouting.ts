import { decode } from '@here/flexpolyline'
import type {
  ForeignTollFare,
  ForeignTollSummary,
  Location,
  RouteLeg,
  RouteResult,
  VehicleMode,
  VehicleTollOptions,
} from '../types'
import { haversineMeters } from './geo'
import {
  classifyForeignTollKind,
  foreignTollDisplayName,
} from './tollClassification'

interface HerePrice {
  currency?: string
  value?: number
}

interface HereFare {
  id?: string
  name?: string
  price?: HerePrice
  convertedPrice?: HerePrice
  reason?: string
  paymentMethods?: string[]
}

interface HereToll {
  countryCode?: string
  tollSystem?: string
  fares?: HereFare[]
}

interface HereSection {
  polyline: string
  summary?: {
    length?: number
    duration?: number
  }
  tolls?: HereToll[]
}

/** Serbia is priced by our own engine; HERE tolls are used only elsewhere. */
const SERBIA_COUNTRY_CODE = 'SRB'

/** Prefer electronic (tag/transponder) payment; fall back down the list. */
const PAYMENT_PRIORITY = [
  'transponder',
  'travelCard',
  'creditCard',
  'bankCard',
  'videoToll',
  'video',
  'cash',
]

function fareEur(fare: HereFare): number | null {
  const converted = fare.convertedPrice
  if (converted && typeof converted.value === 'number') {
    return converted.value
  }
  const price = fare.price
  if (price && typeof price.value === 'number' && price.currency === 'EUR') {
    return price.value
  }
  return null
}

/** Pick one fare per toll system: preferred payment method, then cheapest. */
function pickFare(fares: HereFare[]): HereFare | null {
  const usable = fares.filter((f) => f.id)
  if (usable.length === 0) return null

  for (const method of PAYMENT_PRIORITY) {
    const matches = usable.filter((f) => (f.paymentMethods ?? []).includes(method))
    if (matches.length > 0) {
      return matches.reduce((best, f) =>
        (fareEur(f) ?? Infinity) < (fareEur(best) ?? Infinity) ? f : best,
      )
    }
  }

  return usable.reduce((best, f) =>
    (fareEur(f) ?? Infinity) < (fareEur(best) ?? Infinity) ? f : best,
  )
}

/** Map a HERE section to the matching route leg label (A → B). */
function sectionLegLabel(
  section: HereSection,
  sectionIndex: number,
  sections: HereSection[],
  legs: RouteLeg[],
): string | null {
  if (legs.length === 0) return null

  if (sections.length === legs.length && sectionIndex < legs.length) {
    const leg = legs[sectionIndex]
    return `${leg.fromLabel} → ${leg.toLabel}`
  }

  const coords = decodeSectionCoordinates(section)
  if (coords.length === 0) return null

  const mid = coords[Math.floor(coords.length / 2)]
  let bestLeg = 0
  let bestDist = Infinity
  for (let i = 0; i < legs.length; i++) {
    for (const point of legs[i].coordinates) {
      const dist = haversineMeters(mid, point)
      if (dist < bestDist) {
        bestDist = dist
        bestLeg = i
      }
    }
  }

  const leg = legs[bestLeg]
  return `${leg.fromLabel} → ${leg.toLabel}`
}

/** Collect non-Serbian tolls across all sections, deduped by fare id (pay once). */
function summarizeForeignTolls(
  sections: HereSection[],
  legs: RouteLeg[],
): ForeignTollSummary {
  const chosen = new Map<string, ForeignTollFare>()
  let hasUnconverted = false

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    const section = sections[sectionIndex]
    const routeLegLabel = sectionLegLabel(section, sectionIndex, sections, legs)
    const midpoint = sectionMidpoint(section)

    for (const toll of section.tolls ?? []) {
      const country = toll.countryCode ?? ''
      if (!country || country === SERBIA_COUNTRY_CODE) continue

      const fare = pickFare(toll.fares ?? [])
      if (!fare || !fare.id) continue
      if (chosen.has(fare.id)) continue

      const eur = fareEur(fare)
      if (eur == null) {
        hasUnconverted = true
        continue
      }

      const methods = fare.paymentMethods ?? []
      const paymentMethod =
        PAYMENT_PRIORITY.find((m) => methods.includes(m)) ?? methods[0] ?? null
      const systemName = toll.tollSystem ?? ''
      const fareName = fare.name ?? systemName ?? country
      const kind = classifyForeignTollKind(fareName, systemName)

      chosen.set(fare.id, {
        country,
        system: systemName,
        name: foreignTollDisplayName(fareName, systemName, kind),
        eur,
        paymentMethod,
        kind,
        routeLegLabel,
        lat: midpoint?.[0] ?? null,
        lng: midpoint?.[1] ?? null,
      })
    }
  }

  const fares = [...chosen.values()]
  const byCountryMap = new Map<string, number>()
  for (const fare of fares) {
    byCountryMap.set(fare.country, (byCountryMap.get(fare.country) ?? 0) + fare.eur)
  }

  const byCountry = [...byCountryMap.entries()]
    .map(([country, eur]) => ({ country, eur: Math.round(eur * 100) / 100 }))
    .sort((a, b) => b.eur - a.eur)

  const totalEur =
    Math.round(fares.reduce((sum, f) => sum + f.eur, 0) * 100) / 100

  return { totalEur, byCountry, fares, hasUnconverted }
}

interface HereRoutesResponse {
  routes?: Array<{
    sections?: HereSection[]
  }>
  title?: string
  cause?: string
}

/** HERE transportMode + vehicle weight (kg) po kategoriji */
function routingParamsForVehicle(mode: VehicleMode): {
  transportMode: 'car' | 'truck'
  grossWeightKg?: number
} {
  switch (mode) {
    case 'car':
      return { transportMode: 'car' }
    case 'freight_under_3_5':
      return { transportMode: 'truck', grossWeightKg: 3500 }
    case 'freight_3_6_to_10':
      return { transportMode: 'truck', grossWeightKg: 10000 }
    case 'freight_over_10':
      return { transportMode: 'truck', grossWeightKg: 40000 }
  }
}

function formatCoord(location: Location): string {
  return `${location.lat},${location.lng}`
}

function decodeSectionCoordinates(section: HereSection): [number, number][] {
  const coordinates: [number, number][] = []
  const decoded = decode(section.polyline)

  for (const point of decoded.polyline) {
    const lat = point[0]
    const lng = point[1]
    if (typeof lat !== 'number' || typeof lng !== 'number') continue

    const last = coordinates[coordinates.length - 1]
    if (last && last[0] === lat && last[1] === lng) continue

    coordinates.push([lat, lng])
  }

  return coordinates
}

function sectionMidpoint(section: HereSection): [number, number] | null {
  const coordinates = decodeSectionCoordinates(section)
  if (coordinates.length === 0) return null
  return coordinates[Math.floor(coordinates.length / 2)]
}

function appendCoordinates(
  target: [number, number][],
  next: [number, number][],
): void {
  for (const point of next) {
    const last = target[target.length - 1]
    if (last && last[0] === point[0] && last[1] === point[1]) continue
    target.push(point)
  }
}

/** Closest polyline index to a location, searching only from `fromIndex` onward */
function nearestIndexForward(
  coordinates: [number, number][],
  location: Location,
  fromIndex: number,
): number {
  const start = Math.max(0, Math.min(fromIndex, coordinates.length - 1))
  let best = start
  let bestDist = Infinity
  for (let i = start; i < coordinates.length; i++) {
    const d = haversineMeters(coordinates[i], [location.lat, location.lng])
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

/**
 * Split full polyline into waypoint legs.
 * Each next stop is matched only FORWARD along the route so a later visit to
 * the same area (e.g. Beograd / Vrčin on the return) is not snapped to the outbound pass.
 */
function buildLegsFromWaypoints(
  coordinates: [number, number][],
  points: Location[],
  sectionSummaries: Array<{ length: number; duration: number }>,
): RouteLeg[] {
  if (points.length < 2 || coordinates.length < 2) return []

  const indices: number[] = [0]
  for (let i = 1; i < points.length; i++) {
    const prev = indices[i - 1]
    let idx = nearestIndexForward(coordinates, points[i], prev + 1)
    // Last point: prefer the end of the polyline when it is the destination revisit
    if (i === points.length - 1) {
      const endDist = haversineMeters(
        coordinates[coordinates.length - 1],
        [points[i].lat, points[i].lng],
      )
      const candDist = haversineMeters(coordinates[idx], [
        points[i].lat,
        points[i].lng,
      ])
      // If the route end is reasonably close to the destination, use it
      if (endDist <= candDist + 2500) {
        idx = coordinates.length - 1
      }
    }
    if (idx <= prev) {
      idx = Math.min(coordinates.length - 1, prev + 1)
    }
    indices.push(idx)
  }

  const totalDist = sectionSummaries.reduce((s, x) => s + x.length, 0)
  const totalDur = sectionSummaries.reduce((s, x) => s + x.duration, 0)

  const legs: RouteLeg[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const start = indices[i]
    const end = indices[i + 1]
    const slice = coordinates.slice(start, end + 1)
    if (slice.length < 2) continue

    let sliceDist = 0
    for (let k = 1; k < slice.length; k++) {
      sliceDist += haversineMeters(slice[k - 1], slice[k])
    }
    const totalSliceApprox = Math.max(
      1,
      coordinates.reduce((sum, _p, idx) => {
        if (idx === 0) return 0
        return sum + haversineMeters(coordinates[idx - 1], coordinates[idx])
      }, 0),
    )
    const frac = sliceDist / totalSliceApprox

    legs.push({
      coordinates: slice,
      distanceMeters: totalDist * frac,
      durationSeconds: totalDur * frac,
      fromLabel: points[i].label,
      toLabel: points[i + 1].label,
    })
  }

  return legs
}

/**
 * Prefer HERE section boundaries when there is one section per waypoint leg.
 */
function buildLegsFromSections(
  sections: HereSection[],
  points: Location[],
): RouteLeg[] | null {
  const expected = points.length - 1
  if (sections.length !== expected || expected < 1) return null

  const legs: RouteLeg[] = []
  for (let i = 0; i < sections.length; i++) {
    const coordinates = decodeSectionCoordinates(sections[i])
    if (coordinates.length < 2) return null
    legs.push({
      coordinates,
      distanceMeters: sections[i].summary?.length ?? 0,
      durationSeconds: sections[i].summary?.duration ?? 0,
      fromLabel: points[i].label,
      toLabel: points[i + 1].label,
    })
  }
  return legs
}

export async function fetchRoute(
  origin: Location,
  destination: Location,
  stops: Location[],
  vehicleMode: VehicleMode,
  tollOptions?: VehicleTollOptions,
): Promise<RouteResult> {
  const apiKey = import.meta.env.VITE_HERE_API_KEY
  if (!apiKey) {
    throw new Error('Nedostaje VITE_HERE_API_KEY u .env.local')
  }

  const { transportMode, grossWeightKg } = routingParamsForVehicle(vehicleMode)

  const params = new URLSearchParams({
    transportMode,
    origin: formatCoord(origin),
    destination: formatCoord(destination),
    return: 'polyline,summary,tolls',
    currency: 'EUR',
    apikey: apiKey,
  })

  if (grossWeightKg != null) {
    params.set('vehicle[grossWeight]', String(grossWeightKg))
  }

  if (tollOptions) {
    // EURO class is valid for all modes; axles/height mostly affect truck tolls.
    if (tollOptions.emissionClass) {
      params.set('vehicle[emissionType]', tollOptions.emissionClass)
    }
    if (transportMode === 'truck') {
      if (tollOptions.axleCount > 0) {
        params.set('vehicle[axleCount]', String(Math.round(tollOptions.axleCount)))
      }
      if (tollOptions.heightCm > 0) {
        params.set('vehicle[height]', String(Math.round(tollOptions.heightCm)))
      }
    }
  }

  for (const stop of stops) {
    params.append('via', formatCoord(stop))
  }

  const response = await fetch(
    `https://router.hereapi.com/v8/routes?${params.toString()}`,
  )

  const data = (await response.json()) as HereRoutesResponse

  if (!response.ok) {
    throw new Error(data.title ?? data.cause ?? `HERE greška (${response.status})`)
  }

  const sections = data.routes?.[0]?.sections
  if (!sections?.length) {
    throw new Error('HERE nije vratio rutu za zadate lokacije')
  }

  const coordinates: [number, number][] = []
  const sectionSummaries: Array<{ length: number; duration: number }> = []
  let distanceMeters = 0
  let durationSeconds = 0

  for (const section of sections) {
    appendCoordinates(coordinates, decodeSectionCoordinates(section))
    const length = section.summary?.length ?? 0
    const duration = section.summary?.duration ?? 0
    sectionSummaries.push({ length, duration })
    distanceMeters += length
    durationSeconds += duration
  }

  if (coordinates.length < 2) {
    throw new Error('Ruta nema dovoljno tačaka za prikaz')
  }

  const waypoints = [origin, ...stops, destination]
  const sectionLegs = buildLegsFromSections(sections, waypoints)
  const legs =
    sectionLegs ??
    buildLegsFromWaypoints(coordinates, waypoints, sectionSummaries)

  const foreignTolls = summarizeForeignTolls(sections, legs)

  return {
    coordinates,
    distanceMeters,
    durationSeconds,
    foreignTolls,
    legs:
      legs.length > 0
        ? legs
        : [
            {
              coordinates,
              distanceMeters,
              durationSeconds,
              fromLabel: origin.label,
              toLabel: destination.label,
            },
          ],
  }
}
