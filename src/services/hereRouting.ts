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
import {
  distanceAlongPolyline,
  haversineMeters,
  pointAlongPolyline,
  polylineLengthMeters,
} from './geo'
import {
  classifyForeignTollKind,
  foreignTollDisplayName,
  foreignVignetteKey,
  resolveVignetteValidDays,
} from './tollClassification'

interface HerePrice {
  currency?: string
  value?: number
}

interface HereFarePass {
  returnJourney?: boolean
  travels?: number
  transfers?: number
  seniorPass?: boolean
  validityPeriod?: {
    periodType?: string
    count?: number | null
  }
}

interface HereFare {
  id?: string
  name?: string
  price?: HerePrice
  convertedPrice?: HerePrice
  reason?: string
  paymentMethods?: string[]
  pass?: HereFarePass
  applicableTimes?: string
}

interface HereToll {
  countryCode?: string
  tollSystem?: string
  fares?: HereFare[]
}

interface HereSpan {
  offset?: number
  countryCode?: string
  length?: number
}

interface HereSection {
  polyline: string
  summary?: {
    length?: number
    duration?: number
  }
  tolls?: HereToll[]
  spans?: HereSpan[]
}

interface CountryRange {
  country: string
  startMeters: number
  endMeters: number
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

  // Prefer distance along the full itinerary so outbound vs return on the same
  // corridor (e.g. Beograd ↔ Solun) do not snap to the wrong pass.
  const ranges: Array<{ label: string; start: number; end: number }> = []
  const full: [number, number][] = []
  let offset = 0
  for (const leg of legs) {
    const len = polylineLengthMeters(leg.coordinates)
    ranges.push({
      label: `${leg.fromLabel} → ${leg.toLabel}`,
      start: offset,
      end: offset + len,
    })
    if (full.length === 0) full.push(...leg.coordinates)
    else full.push(...leg.coordinates.slice(1))
    offset += len
  }

  if (ranges.length === 0) return null

  const coords = decodeSectionCoordinates(section)
  const anchor =
    coords[0] ??
    (coords.length > 0 ? coords[Math.floor(coords.length / 2)] : null)

  let progress: number
  if (anchor && full.length >= 2) {
    progress = distanceAlongPolyline(full, anchor)
  } else {
    const frac = (sectionIndex + 0.5) / Math.max(1, sections.length)
    progress = frac * offset
  }

  for (const range of ranges) {
    if (progress >= range.start - 1 && progress <= range.end + 1) {
      return range.label
    }
  }

  let best = ranges[0]
  let bestDist = Infinity
  for (const range of ranges) {
    const mid = (range.start + range.end) / 2
    const dist = Math.abs(progress - mid)
    if (dist < bestDist) {
      bestDist = dist
      best = range
    }
  }
  return best.label
}

/** Cumulative meters from coord[0] to coord[index] along the polyline. */
function metersToIndex(coordinates: [number, number][], index: number): number {
  const end = Math.max(0, Math.min(index, coordinates.length - 1))
  let along = 0
  for (let i = 1; i <= end; i++) {
    along += haversineMeters(coordinates[i - 1], coordinates[i])
  }
  return along
}

/**
 * Build ordered country ranges and totals from HERE countryCode spans.
 * Ranges are absolute meters along the concatenated route polyline.
 */
function buildCountryMetrics(sections: HereSection[]): {
  distanceByCountry: Record<string, number>
  ranges: CountryRange[]
  fullCoordinates: [number, number][]
} {
  const distanceByCountry: Record<string, number> = {}
  const ranges: CountryRange[] = []
  const fullCoordinates: [number, number][] = []
  let routeOffset = 0

  for (const section of sections) {
    const coords = decodeSectionCoordinates(section)
    if (coords.length < 2) continue

    const sectionLen =
      section.summary?.length ??
      polylineLengthMeters(coords)

    const spans = [...(section.spans ?? [])].sort(
      (a, b) => (a.offset ?? 0) - (b.offset ?? 0),
    )

    if (spans.length === 0) {
      // No country data — treat whole section as unknown.
      appendCoordinates(fullCoordinates, coords)
      routeOffset += sectionLen
      continue
    }

    for (let i = 0; i < spans.length; i++) {
      const span = spans[i]
      const country = (span.countryCode ?? '').trim().toUpperCase()
      if (!country) continue

      const startIdx = Math.max(0, Math.min(span.offset ?? 0, coords.length - 1))
      const endIdx =
        i + 1 < spans.length
          ? Math.max(
              startIdx,
              Math.min(spans[i + 1].offset ?? coords.length - 1, coords.length - 1),
            )
          : coords.length - 1

      let spanLen =
        typeof span.length === 'number' && span.length > 0
          ? span.length
          : metersToIndex(coords, endIdx) - metersToIndex(coords, startIdx)
      if (spanLen < 0) spanLen = 0

      const polyLen = polylineLengthMeters(coords)
      const rawSum = spans.reduce((sum, s, si) => {
        const a = Math.max(0, Math.min(s.offset ?? 0, coords.length - 1))
        const b =
          si + 1 < spans.length
            ? Math.max(
                a,
                Math.min(spans[si + 1].offset ?? coords.length - 1, coords.length - 1),
              )
            : coords.length - 1
        const raw =
          typeof s.length === 'number' && s.length > 0
            ? s.length
            : metersToIndex(coords, b) - metersToIndex(coords, a)
        return sum + Math.max(0, raw)
      }, 0)
      if (rawSum > 0 && sectionLen > 0) {
        spanLen = (spanLen / rawSum) * sectionLen
      }

      const startRatio =
        polyLen > 0 ? metersToIndex(coords, startIdx) / polyLen : 0
      const absStart = routeOffset + startRatio * sectionLen
      const absEnd = absStart + spanLen

      ranges.push({
        country,
        startMeters: absStart,
        endMeters: Math.max(absStart, absEnd),
      })
      distanceByCountry[country] =
        (distanceByCountry[country] ?? 0) + spanLen
    }

    appendCoordinates(fullCoordinates, coords)
    routeOffset += sectionLen
  }

  // Merge adjacent ranges of the same country.
  const merged: CountryRange[] = []
  for (const range of ranges) {
    const prev = merged[merged.length - 1]
    if (
      prev &&
      prev.country === range.country &&
      Math.abs(prev.endMeters - range.startMeters) < 50
    ) {
      prev.endMeters = Math.max(prev.endMeters, range.endMeters)
    } else {
      merged.push({ ...range })
    }
  }

  return { distanceByCountry, ranges: merged, fullCoordinates }
}

function positionInRanges(
  ranges: CountryRange[],
  index: number,
  count: number,
): number {
  if (ranges.length === 0 || count <= 0) return 0
  const total = ranges.reduce((s, r) => s + Math.max(0, r.endMeters - r.startMeters), 0)
  if (total <= 0) return ranges[0].startMeters
  const target = ((index + 0.5) / count) * total
  let along = 0
  for (const range of ranges) {
    const len = Math.max(0, range.endMeters - range.startMeters)
    if (along + len >= target || range === ranges[ranges.length - 1]) {
      const t = len <= 0 ? 0 : Math.min(1, Math.max(0, (target - along) / len))
      return range.startMeters + t * len
    }
    along += len
  }
  return ranges[ranges.length - 1].endMeters
}

/** Collect non-Serbian tolls across all sections (once per fare per route leg). */
function summarizeForeignTolls(
  sections: HereSection[],
  legs: RouteLeg[],
  countryRanges: CountryRange[],
  fullCoordinates: [number, number][],
): ForeignTollSummary {
  const chosen = new Map<string, ForeignTollFare>()
  let hasUnconverted = false
  let sequence = 0

  // Leg absolute offsets along concatenated route.
  const legRanges: Array<{ label: string; start: number; end: number }> = []
  let legOffset = 0
  for (const leg of legs) {
    const len = polylineLengthMeters(leg.coordinates)
    legRanges.push({
      label: `${leg.fromLabel} → ${leg.toLabel}`,
      start: legOffset,
      end: legOffset + len,
    })
    legOffset += len
  }

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    const section = sections[sectionIndex]
    const routeLegLabel = sectionLegLabel(section, sectionIndex, sections, legs)
    const sectionCoords = decodeSectionCoordinates(section)
    const sectionTolls = section.tolls ?? []

    const pending: Array<{
      dedupeKey: string
      country: string
      systemName: string
      fareName: string
      kind: ForeignTollFare['kind']
      eur: number
      paymentMethod: string | null
      validDays: number | null
    }> = []

    for (const toll of sectionTolls) {
      const country = toll.countryCode ?? ''
      if (!country || country === SERBIA_COUNTRY_CODE) continue

      const fare = pickFare(toll.fares ?? [])
      if (!fare || !fare.id) continue

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
      const kind = classifyForeignTollKind(fareName, systemName, fare.reason)

      // Vignettes are time-based: one purchase covers the whole trip (and return).
      const dedupeKey =
        kind === 'vignette'
          ? `vignette::${foreignVignetteKey({
              country,
              system: systemName,
              name: fareName,
            })}`
          : `${fare.id}::${routeLegLabel ?? `section:${sectionIndex}`}`
      if (chosen.has(dedupeKey)) continue

      const validDays =
        kind === 'vignette'
          ? resolveVignetteValidDays(fareName, systemName, fare.pass)
          : null

      pending.push({
        dedupeKey,
        country,
        systemName,
        fareName,
        kind,
        eur,
        paymentMethod,
        validDays,
      })
    }

    // Group by country preserving HERE order for placement inside country ranges.
    const byCountryOrder: string[] = []
    const groups = new Map<string, typeof pending>()
    for (const item of pending) {
      if (!groups.has(item.country)) {
        groups.set(item.country, [])
        byCountryOrder.push(item.country)
      }
      groups.get(item.country)!.push(item)
    }

    const legMeta = routeLegLabel
      ? legRanges.find((r) => r.label === routeLegLabel)
      : undefined

    for (const country of byCountryOrder) {
      const group = groups.get(country) ?? []
      const n = group.length
      const matchingRanges = countryRanges.filter((r) => {
        if (r.country !== country) return false
        if (!legMeta) return true
        // Overlap with this route leg (outbound vs return).
        return r.endMeters > legMeta.start - 1 && r.startMeters < legMeta.end + 1
      })

      for (let i = 0; i < n; i++) {
        const item = group[i]
        let progressMeters: number
        if (matchingRanges.length > 0) {
          progressMeters = positionInRanges(matchingRanges, i, n)
        } else {
          const fraction = n === 1 ? 0.5 : (i + 0.5) / n
          const sectionProgress =
            (legMeta?.start ?? 0) +
            fraction * Math.max(1, (legMeta?.end ?? 1) - (legMeta?.start ?? 0))
          progressMeters = sectionProgress
        }

        const totalLen = Math.max(1, polylineLengthMeters(fullCoordinates))
        const point =
          pointAlongPolyline(fullCoordinates, progressMeters / totalLen) ??
          pointAlongPolyline(sectionCoords, (i + 0.5) / Math.max(1, n)) ??
          sectionMidpoint(section)

        sequence += 1
        chosen.set(item.dedupeKey, {
          country: item.country,
          system: item.systemName,
          name: foreignTollDisplayName(item.fareName, item.systemName, item.kind),
          eur: item.eur,
          paymentMethod: item.paymentMethod,
          kind: item.kind,
          validDays: item.validDays,
          routeLegLabel,
          lat: point?.[0] ?? null,
          lng: point?.[1] ?? null,
          sequence,
          progressMeters,
        })
      }
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

function mergeForeignTollSummaries(
  outbound: ForeignTollSummary,
  inbound: ForeignTollSummary,
  outboundDistanceMeters: number,
): ForeignTollSummary {
  const seenVignettes = new Set<string>()
  const merged: ForeignTollFare[] = []

  const pushFare = (fare: ForeignTollFare, progressOffset: number) => {
    if (fare.kind === 'vignette') {
      const key = foreignVignetteKey(fare)
      if (seenVignettes.has(key)) return
      seenVignettes.add(key)
    }
    merged.push({
      ...fare,
      progressMeters:
        fare.progressMeters != null
          ? fare.progressMeters + progressOffset
          : fare.progressMeters,
    })
  }

  for (const fare of outbound.fares) pushFare(fare, 0)
  for (const fare of inbound.fares) pushFare(fare, outboundDistanceMeters)

  const fares = merged.map((fare, index) => ({ ...fare, sequence: index + 1 }))

  const byCountryMap = new Map<string, number>()
  for (const fare of fares) {
    byCountryMap.set(
      fare.country,
      (byCountryMap.get(fare.country) ?? 0) + fare.eur,
    )
  }

  const byCountry = [...byCountryMap.entries()]
    .map(([country, eur]) => ({ country, eur: Math.round(eur * 100) / 100 }))
    .sort((a, b) => b.eur - a.eur)

  const totalEur =
    Math.round(fares.reduce((sum, fare) => sum + fare.eur, 0) * 100) / 100

  return {
    totalEur,
    byCountry,
    fares,
    hasUnconverted: outbound.hasUnconverted || inbound.hasUnconverted,
  }
}

/** Combine outbound (A → stops → B) and return (B → A) into one itinerary. */
export function mergeRouteResults(
  outbound: RouteResult,
  inbound: RouteResult,
): RouteResult {
  const coordinates: [number, number][] = [...outbound.coordinates]
  appendCoordinates(coordinates, inbound.coordinates)

  const distanceByCountry = { ...outbound.distanceByCountry }
  for (const [country, meters] of Object.entries(inbound.distanceByCountry)) {
    distanceByCountry[country] = (distanceByCountry[country] ?? 0) + meters
  }

  return {
    coordinates,
    distanceMeters: outbound.distanceMeters + inbound.distanceMeters,
    durationSeconds: outbound.durationSeconds + inbound.durationSeconds,
    legs: [...outbound.legs, ...inbound.legs],
    foreignTolls: mergeForeignTollSummaries(
      outbound.foreignTolls,
      inbound.foreignTolls,
      outbound.distanceMeters,
    ),
    distanceByCountry,
  }
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
    spans: 'countryCode',
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

  const countryMetrics = buildCountryMetrics(sections)

  const foreignTolls = summarizeForeignTolls(
    sections,
    legs,
    countryMetrics.ranges,
    countryMetrics.fullCoordinates.length >= 2
      ? countryMetrics.fullCoordinates
      : coordinates,
  )

  return {
    coordinates,
    distanceMeters,
    durationSeconds,
    foreignTolls,
    distanceByCountry: countryMetrics.distanceByCountry,
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
