import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import type { Location } from '../types'
import type { DetectedTollStation } from '../services/tollEstimate'

import 'leaflet/dist/leaflet.css'

const DEFAULT_CENTER: [number, number] = [44.7866, 20.4489]
const DEFAULT_ZOOM = 7

interface RouteMapProps {
  origin: Location | null
  destination: Location | null
  stops: Location[]
  routeCoordinates: [number, number][]
  tollStations?: DetectedTollStation[]
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
}: RouteMapProps) {
  const map = useMap()
  const previousPointCount = useRef(0)

  useEffect(() => {
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

    const clearedWhileEditing =
      nextCount < previousPointCount.current && routeCoordinates.length < 2

    previousPointCount.current = nextCount

    // Keep the current view when a pin is cleared mid-typing.
    if (clearedWhileEditing) return

    if (points.length === 0) {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM)
      return
    }

    if (points.length === 1) {
      map.setView(points[0], 12)
      return
    }

    map.fitBounds(L.latLngBounds(points), { padding: [40, 40] })
  }, [map, origin, destination, stops, routeCoordinates])

  return null
}

export function RouteMap({
  origin,
  destination,
  stops,
  routeCoordinates,
  tollStations = [],
}: RouteMapProps) {
  const originIcon = useMemo(() => createPinIcon('A', '#16a34a'), [])
  const destinationIcon = useMemo(() => createPinIcon('B', '#dc2626'), [])
  const stopIcons = useMemo(
    () => stops.map((_, index) => createPinIcon(String(index + 1), '#2563eb')),
    [stops],
  )
  const tollIcon = useMemo(() => createPinIcon('N', '#b45309'), [])
  const bypassIcon = useMemo(() => createPinIcon('O', '#7c2d12'), [])

  return (
    <div className="map-wrap">
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
        />

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

        {tollStations.map((station) => (
          <Marker
            key={`toll-${station.kind}-${station.name}-${station.lat}`}
            position={[station.lat, station.lng]}
            icon={station.kind === 'bypass' ? bypassIcon : tollIcon}
            title={station.name}
          />
        ))}

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
