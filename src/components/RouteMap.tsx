import { useEffect, useMemo, useRef } from 'react'
import {
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import L from 'leaflet'
import type { Location, MapPickTarget } from '../types'

import 'leaflet/dist/leaflet.css'

const DEFAULT_CENTER: [number, number] = [44.7866, 20.4489]
const DEFAULT_ZOOM = 7

interface RouteMapProps {
  origin: Location | null
  destination: Location | null
  stops: Location[]
  routeCoordinates: [number, number][]
  mapPickTarget?: MapPickTarget | null
  onMapPick?: (lat: number, lng: number) => void
}

function MapPickHandler({
  enabled,
  onPick,
}: {
  enabled: boolean
  onPick: (lat: number, lng: number) => void
}) {
  useMapEvents({
    click(event) {
      if (!enabled) return
      onPick(event.latlng.lat, event.latlng.lng)
    },
  })
  return null
}

function createPinIcon(label: string, color: string): L.DivIcon {
  return L.divIcon({
    className: 'route-pin',
    html: `<span class="route-pin-marker" style="--pin-color:${color}"><span class="route-pin-label">${label}</span></span>`,
    iconSize: [34, 42],
    iconAnchor: [17, 42],
    popupAnchor: [0, -36],
  })
}

function FitBounds({
  origin,
  destination,
  stops,
  routeCoordinates,
  mapPickTarget = null,
}: RouteMapProps) {
  const map = useMap()
  const previousPointCount = useRef(0)
  const previousSignature = useRef<string | null>(null)

  useEffect(() => {
    // Keep the user's current view while choosing a point on the map.
    if (mapPickTarget != null) return

    const points: [number, number][] = []

    if (routeCoordinates.length >= 2) {
      points.push(...routeCoordinates)
    } else {
      if (origin) points.push([origin.lat, origin.lng])
      for (const stop of stops) points.push([stop.lat, stop.lng])
      if (destination) points.push([destination.lat, destination.lng])
    }

    const nextCount =
      routeCoordinates.length >= 2
        ? routeCoordinates.length
        : (origin ? 1 : 0) + stops.length + (destination ? 1 : 0)

    const signature =
      routeCoordinates.length >= 2
        ? `route:${routeCoordinates.length}:${routeCoordinates[0]?.join(',')}:${routeCoordinates[routeCoordinates.length - 1]?.join(',')}`
        : points.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join('|')

    const clearedWhileEditing =
      nextCount < previousPointCount.current && routeCoordinates.length < 2

    const unchanged =
      previousSignature.current !== null &&
      previousSignature.current === signature &&
      previousPointCount.current === nextCount

    previousPointCount.current = nextCount
    previousSignature.current = signature

    // Keep the current view when a pin is cleared mid-typing,
    // or when parent re-rendered with the same geography.
    if (clearedWhileEditing || unchanged) return

    if (points.length === 0) {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM)
      return
    }

    if (points.length === 1) {
      map.setView(points[0], 12)
      return
    }

    map.fitBounds(L.latLngBounds(points), { padding: [40, 40] })
  }, [map, origin, destination, stops, routeCoordinates, mapPickTarget])

  return null
}

export function RouteMap({
  origin,
  destination,
  stops,
  routeCoordinates,
  mapPickTarget = null,
  onMapPick,
}: RouteMapProps) {
  const picking = mapPickTarget != null
  const originIcon = useMemo(() => createPinIcon('A', '#16a34a'), [])
  const destinationIcon = useMemo(() => createPinIcon('B', '#dc2626'), [])
  const stopIcons = useMemo(
    () => stops.map((_, index) => createPinIcon(String(index + 1), '#2563eb')),
    [stops],
  )

  return (
    <div className={`map-wrap${picking ? ' map-wrap-picking' : ''}`}>
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        className="map"
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <FitBounds
          origin={origin}
          destination={destination}
          stops={stops}
          routeCoordinates={routeCoordinates}
          mapPickTarget={mapPickTarget}
        />

        {picking && onMapPick ? (
          <MapPickHandler enabled onPick={onMapPick} />
        ) : null}

        {origin ? (
          <Marker
            position={[origin.lat, origin.lng]}
            icon={originIcon}
            title={`A: ${origin.label}`}
          />
        ) : null}

        {stops.map((stop, index) => (
          <Marker
            key={`${stop.lat}-${stop.lng}-${index}`}
            position={[stop.lat, stop.lng]}
            icon={stopIcons[index]}
            title={`Stop ${index + 1}: ${stop.label}`}
          />
        ))}

        {destination ? (
          <Marker
            position={[destination.lat, destination.lng]}
            icon={destinationIcon}
            title={`B: ${destination.label}`}
          />
        ) : null}

        {routeCoordinates.length >= 2 ? (
          <Polyline
            positions={routeCoordinates}
            pathOptions={{ color: '#1d4ed8', weight: 5, opacity: 0.85 }}
          />
        ) : null}
      </MapContainer>
    </div>
  )
}
