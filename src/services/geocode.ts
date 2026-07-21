import type { Location } from '../types'
import { loadGoogleMaps } from './googleMaps'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

/**
 * Geocode a free-text address via Google Maps Geocoder.
 * Requires VITE_GOOGLE_MAPS_API_KEY (same as Places autocomplete).
 */
export async function geocodeAddress(address: string): Promise<Location> {
  const googleApi = await loadGoogleMaps()
  const geocoder = new googleApi.maps.Geocoder()

  const response = await geocoder.geocode({ address })
  const result = response.results[0]
  if (!result?.geometry?.location) {
    throw new Error(`Nisam našao koordinate za: ${address}`)
  }

  const lat = result.geometry.location.lat()
  const lng = result.geometry.location.lng()
  const label = result.formatted_address ?? address

  return { label, lat, lng }
}

/** Geocode many labels sequentially (gentle rate limit). */
export async function geocodeAddresses(
  labels: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Location[]> {
  const out: Location[] = []
  for (let i = 0; i < labels.length; i++) {
    onProgress?.(i, labels.length)
    const location = await geocodeAddress(labels[i])
    out.push(location)
    if (i < labels.length - 1) {
      await delay(120)
    }
  }
  onProgress?.(labels.length, labels.length)
  return out
}

/** Drop consecutive points that land almost on top of each other. */
export function dedupeNearbyLocations(
  points: Location[],
  minMeters = 800,
): Location[] {
  if (points.length === 0) return []
  const out: Location[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1]
    const d = haversineRoughMeters(prev, points[i])
    if (d < minMeters) continue
    out.push(points[i])
  }
  return out
}

function haversineRoughMeters(a: Location, b: Location): number {
  const R = 6371000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}
