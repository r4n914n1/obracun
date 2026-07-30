/** Earth radius in meters */
const R = 6371000

export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

export function haversineMeters(
  a: [number, number],
  b: [number, number],
): number {
  const [lat1, lng1] = a
  const [lat2, lng2] = b
  const dLat = toRadians(lat2 - lat1)
  const dLng = toRadians(lng2 - lng1)
  const s1 = Math.sin(dLat / 2)
  const s2 = Math.sin(dLng / 2)
  const h =
    s1 * s1 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * s2 * s2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function polylineLengthMeters(coordinates: [number, number][]): number {
  let sum = 0
  for (let i = 1; i < coordinates.length; i++) {
    sum += haversineMeters(coordinates[i - 1], coordinates[i])
  }
  return sum
}

/** Distance along a polyline to the nearest point on any segment. */
export function distanceAlongPolyline(
  coordinates: [number, number][],
  point: [number, number],
): number {
  if (coordinates.length < 2) return 0
  let bestDist = Infinity
  let bestAlong = 0
  let along = 0
  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i - 1]
    const b = coordinates[i]
    const segLen = haversineMeters(a, b)
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const toMid = haversineMeters(point, mid)
    const toA = haversineMeters(point, a)
    const toB = haversineMeters(point, b)
    const d = Math.min(toMid, toA, toB)
    if (d < bestDist) {
      bestDist = d
      if (toA <= toB && toA <= toMid) bestAlong = along
      else if (toB <= toA && toB <= toMid) bestAlong = along + segLen
      else bestAlong = along + segLen / 2
    }
    along += segLen
  }
  return bestAlong
}

/** Point at a fraction (0–1) of the polyline length. */
export function pointAlongPolyline(
  coordinates: [number, number][],
  fraction: number,
): [number, number] | null {
  if (coordinates.length === 0) return null
  if (coordinates.length === 1) return coordinates[0]

  const total = polylineLengthMeters(coordinates)
  if (total <= 0) return coordinates[0]

  const target = Math.min(1, Math.max(0, fraction)) * total
  let along = 0
  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i - 1]
    const b = coordinates[i]
    const segLen = haversineMeters(a, b)
    if (along + segLen >= target || i === coordinates.length - 1) {
      if (segLen <= 0) return b
      const t = Math.min(1, Math.max(0, (target - along) / segLen))
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    }
    along += segLen
  }
  return coordinates[coordinates.length - 1]
}

/** Approximate local ENU meters relative to origin */
function toLocalMeters(
  origin: [number, number],
  point: [number, number],
): [number, number] {
  const [lat0, lng0] = origin
  const [lat, lng] = point
  const x = toRadians(lng - lng0) * R * Math.cos(toRadians(lat0))
  const y = toRadians(lat - lat0) * R
  return [x, y]
}

function distancePointToSegmentMeters(
  point: [number, number],
  a: [number, number],
  b: [number, number],
): { distance: number; t: number } {
  const [px, py] = toLocalMeters(a, point)
  const [bx, by] = toLocalMeters(a, b)
  const len2 = bx * bx + by * by
  if (len2 === 0) {
    return { distance: Math.hypot(px, py), t: 0 }
  }
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / len2))
  const dx = px - bx * t
  const dy = py - by * t
  return { distance: Math.hypot(dx, dy), t }
}

/** Minimum distance from a point to any segment of a polyline */
export function distanceToPolylineMeters(
  point: [number, number],
  polyline: [number, number][],
): number {
  if (polyline.length === 0) return Infinity
  if (polyline.length === 1) return haversineMeters(point, polyline[0])

  let best = Infinity
  for (let i = 0; i < polyline.length - 1; i++) {
    const { distance } = distancePointToSegmentMeters(
      point,
      polyline[i],
      polyline[i + 1],
    )
    if (distance < best) best = distance
  }
  return best
}

export interface RouteProjection {
  /** Distance along the polyline from start to the closest point */
  distanceAlongRoute: number
  /** Perpendicular distance from point to polyline */
  distanceToRoute: number
}

/**
 * Find every contiguous approach of the route to a point.
 * Same station can appear multiple times if the route comes near it more than once.
 */
export function findPassagesAlongRoute(
  point: [number, number],
  route: [number, number][],
  maxDistanceMeters: number,
): RouteProjection[] {
  if (route.length < 2) return []

  const passages: RouteProjection[] = []
  let inPassage = false
  let bestDist = Infinity
  let bestAlong = 0
  let traveled = 0

  const finishPassage = () => {
    if (!inPassage) return
    passages.push({
      distanceAlongRoute: bestAlong,
      distanceToRoute: bestDist,
    })
    inPassage = false
    bestDist = Infinity
    bestAlong = 0
  }

  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i]
    const b = route[i + 1]
    const segLen = haversineMeters(a, b)
    const { distance, t } = distancePointToSegmentMeters(point, a, b)
    const near = distance <= maxDistanceMeters

    if (near) {
      if (!inPassage) {
        inPassage = true
        bestDist = distance
        bestAlong = traveled + segLen * t
      } else if (distance < bestDist) {
        bestDist = distance
        bestAlong = traveled + segLen * t
      }
    } else {
      finishPassage()
    }

    traveled += segLen
  }

  finishPassage()
  return passages
}
