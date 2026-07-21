import { useEffect, useState } from 'react'
import { LoginScreen } from './components/LoginScreen'
import { PricingPage } from './components/PricingPage'
import { RouteForm } from './components/RouteForm'
import { ResultPanel } from './components/ResultPanel'
import { RouteMap } from './components/RouteMap'
import {
  isAuthenticated,
  logout,
  waitForAuthReady,
} from './services/auth'
import { fetchRoute } from './services/hereRouting'
import { fetchNbsMiddleRsdPerEur } from './services/exchangeRate'
import { estimateToll, type TollEstimate } from './services/tollEstimate'
import { adjustForeignTolls, defaultForeignTollRates } from './services/tollDiscounts'
import {
  loadTollRatesForUser,
  saveTollRatesForUser,
} from './services/tollRatesStorage'
import { geocodeAddresses, dedupeNearbyLocations } from './services/geocode'
import { buildWaypointsFromCsv } from './services/movementReportImport'
import {
  formatSyncSummary,
  formatSyncTime,
  latestIso,
  requestTollSync,
} from './services/syncToll'
import { openBugReportMail } from './services/bugReport'
import type {
  EmissionClass,
  ForeignTollRates,
  Location,
  RouteResult,
  VehicleMode,
} from './types'
import {
  DEFAULT_AXLE_COUNT,
  DEFAULT_CONSUMPTION_L_PER_100KM,
  DEFAULT_DRIVER_FEE_EUR,
  DEFAULT_EMISSION_CLASS,
  DEFAULT_FUEL_PRICE_EUR_PER_L,
  DEFAULT_OPERATING_COST_EUR_PER_KM,
  DEFAULT_VEHICLE_HEIGHT_CM,
  MAX_INTERMEDIATE_STOPS,
} from './types'
import naplatneStaniceMeta from './data/naplatne-stanice.json'
import cenovnikMeta from './data/cenovnik-putarine.json'
import { APP_DISCLAIMER } from './data/disclaimer'

export default function App() {
  const [authReady, setAuthReady] = useState(false)
  const [authed, setAuthed] = useState(false)
  const [screen, setScreen] = useState<'app' | 'pricing'>('app')
  const [origin, setOrigin] = useState<Location | null>(null)
  const [destination, setDestination] = useState<Location | null>(null)
  const [stops, setStops] = useState<Array<Location | null>>([])
  const [vehicleMode, setVehicleMode] = useState<VehicleMode>('car')
  const [consumption, setConsumption] = useState(
    DEFAULT_CONSUMPTION_L_PER_100KM.car,
  )
  const [fuelPrice, setFuelPrice] = useState(DEFAULT_FUEL_PRICE_EUR_PER_L)
  const [driverFee, setDriverFee] = useState(DEFAULT_DRIVER_FEE_EUR)
  const [operatingCostPerKm, setOperatingCostPerKm] = useState(
    DEFAULT_OPERATING_COST_EUR_PER_KM,
  )
  const [emissionClass, setEmissionClass] = useState<EmissionClass>(
    DEFAULT_EMISSION_CLASS,
  )
  const [axleCount, setAxleCount] = useState(DEFAULT_AXLE_COUNT.car)
  const [vehicleHeight, setVehicleHeight] = useState(
    DEFAULT_VEHICLE_HEIGHT_CM.car,
  )
  const [tollRates, setTollRates] = useState<ForeignTollRates>(() =>
    defaultForeignTollRates(),
  )
  const [route, setRoute] = useState<RouteResult | null>(null)
  const [toll, setToll] = useState<TollEstimate | null>(null)
  const [exchangeRateLabel, setExchangeRateLabel] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [returnTrip, setReturnTrip] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(() =>
    latestIso(
      (naplatneStaniceMeta as { extractedAt?: string }).extractedAt,
      (cenovnikMeta as { extractedAt?: string }).extractedAt,
    ),
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await waitForAuthReady()
      if (cancelled) return
      const ok = isAuthenticated()
      setAuthed(ok)
      if (ok) {
        const rates = await loadTollRatesForUser()
        if (!cancelled) setTollRates(rates)
      }
      setAuthReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function refreshTollRatesFromAccount(): Promise<void> {
    const rates = await loadTollRatesForUser()
    setTollRates(rates)
  }

  const resolvedStops = stops.filter((stop): stop is Location => stop !== null)

  function clearRouteResults() {
    setRoute(null)
    setToll(null)
    setExchangeRateLabel(null)
  }

  async function handleSubmit() {
    if (!origin || !destination) return
    if (stops.some((stop) => stop === null)) return

    await calculateRoute(origin, destination, resolvedStops)
  }

  async function calculateRoute(
    from: Location,
    to: Location,
    via: Location[],
    roundTrip: boolean = returnTrip,
  ): Promise<void> {
    setLoading(true)
    setError(null)

    // Povratak: A → stopovi → B → A (B kao via, destinacija = A)
    const routeOrigin = from
    const routeDestination = roundTrip ? from : to
    const routeVias = roundTrip ? [...via, to] : via

    try {
      const [result, rate] = await Promise.all([
        fetchRoute(routeOrigin, routeDestination, routeVias, vehicleMode, {
          emissionClass,
          axleCount,
          heightCm: vehicleHeight,
        }),
        fetchNbsMiddleRsdPerEur(),
      ])
      const tollEstimate = estimateToll(
        result.coordinates,
        vehicleMode,
        result.legs,
        rate.rsdPerEur,
      )
      setRoute(result)
      setToll(tollEstimate)
      setExchangeRateLabel(
        `Kurs NBS danas: 1 € = ${rate.rsdPerEur.toFixed(2)} RSD (${rate.date})`,
      )
    } catch (err: unknown) {
      clearRouteResults()
      setError(err instanceof Error ? err.message : 'Nešto nije uspelo. Probaj ponovo.')
    } finally {
      setLoading(false)
    }
  }

  async function handleImportCsv(file: File): Promise<void> {
    setImporting(true)
    setError(null)
    clearRouteResults()

    try {
      const text = await file.text()
      const waypoints = buildWaypointsFromCsv(text)
      const labels = [
        waypoints.originLabel,
        ...waypoints.stopLabels,
        waypoints.destinationLabel,
      ]

      const geocoded = await geocodeAddresses(labels)
      const unique = dedupeNearbyLocations(geocoded)
      if (unique.length < 2) {
        throw new Error(
          'Posle geokodiranja ostala je manje od 2 različite tačke. Proveri CSV.',
        )
      }

      const nextOrigin = unique[0]
      const nextDestination = unique[unique.length - 1]
      const nextStops = unique.slice(1, -1).slice(0, MAX_INTERMEDIATE_STOPS)

      setOrigin(nextOrigin)
      setDestination(nextDestination)
      setStops(nextStops)
      await calculateRoute(nextOrigin, nextDestination, nextStops)
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Učitavanje CSV nije uspelo. Proveri format fajla.',
      )
    } finally {
      setImporting(false)
    }
  }

  async function handleSyncToll() {
    setSyncing(true)
    setSyncMessage(null)
    try {
      const result = await requestTollSync()
      setLastSyncAt(
        latestIso(result.syncedAt, result.prices?.afterAt) ?? new Date().toISOString(),
      )
      setSyncMessage(formatSyncSummary(result))
      window.setTimeout(() => {
        window.location.reload()
      }, 900)
    } catch (err: unknown) {
      setSyncMessage(
        err instanceof Error
          ? err.message
          : 'SYNC nije uspeo. Radi samo uz npm run dev.',
      )
    } finally {
      setSyncing(false)
    }
  }

  const distanceKm = route ? route.distanceMeters / 1000 : 0
  const liters = route ? (distanceKm * consumption) / 100 : 0
  const fuelCost = liters * fuelPrice
  const operatingCost = distanceKm * operatingCostPerKm
  const serbiaTollEur = toll?.totalEur ?? 0
  const foreignTolls = route?.foreignTolls ?? null
  const hasForeignTolls = (foreignTolls?.fares.length ?? 0) > 0
  const isTruck = vehicleMode !== 'car'
  const adjustedForeign = foreignTolls
    ? adjustForeignTolls(foreignTolls, { isTruck, rates: tollRates })
    : null
  const foreignTollEur = adjustedForeign?.netEur ?? 0
  const foreignVatRemoved = adjustedForeign?.vatRemovedEur ?? 0
  const foreignDiscount = adjustedForeign?.discountSavingsEur ?? 0
  const grandTotal =
    route && toll
      ? fuelCost + serbiaTollEur + foreignTollEur + driverFee + operatingCost
      : null

  if (!authReady) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-brand">Obračun</div>
          <p className="login-sub">Učitavam sesiju…</p>
        </div>
      </div>
    )
  }

  if (screen === 'pricing') {
    return (
      <div className="app">
        <PricingPage
          onBack={() => setScreen('app')}
          showLoginHint={!authed}
        />
      </div>
    )
  }

  if (!authed) {
    return (
      <LoginScreen
        onSuccess={() => {
          setAuthed(true)
          void refreshTollRatesFromAccount()
        }}
        onOpenPricing={() => setScreen('pricing')}
      />
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-row">
          <div>
            <h1>Koliko ću platiti putarinu?</h1>
            <p>Levo unos · sredina mapa · desno rezultat</p>
          </div>
          <div className="app-header-actions">
            <button
              type="button"
              className="btn btn-logout"
              onClick={() => openBugReportMail()}
              title="Pošalji prijavu greške na e-mail"
            >
              Bug report
            </button>
            <button
              type="button"
              className="btn btn-logout"
              onClick={() => setScreen('pricing')}
            >
              Pretplata
            </button>
            <button
              type="button"
              className="btn btn-logout"
              onClick={() => {
                void (async () => {
                  await logout()
                  setAuthed(false)
                  setScreen('app')
                  setTollRates(defaultForeignTollRates())
                })()
              }}
            >
              Odjavi se
            </button>
          </div>
        </div>
        <p className="app-disclaimer">{APP_DISCLAIMER}</p>
      </header>

      <main className="app-main">
        <aside className="sidebar">
          <RouteForm
            origin={origin}
            destination={destination}
            stops={stops}
            vehicleMode={vehicleMode}
            consumption={consumption}
            fuelPrice={fuelPrice}
            driverFee={driverFee}
            operatingCostPerKm={operatingCostPerKm}
            loading={loading}
            importing={importing}
            returnTrip={returnTrip}
            onImportCsv={(file) => {
              void handleImportCsv(file)
            }}
            onReturnTripChange={(value) => {
              setReturnTrip(value)
              clearRouteResults()
            }}
            onOriginChange={(location) => {
              setOrigin(location)
              clearRouteResults()
            }}
            onDestinationChange={(location) => {
              setDestination(location)
              clearRouteResults()
            }}
            onStopChange={(index, location) => {
              setStops((prev) => prev.map((item, i) => (i === index ? location : item)))
              clearRouteResults()
            }}
            onAddStop={() => {
              setStops((prev) =>
                prev.length >= MAX_INTERMEDIATE_STOPS ? prev : [...prev, null],
              )
              clearRouteResults()
            }}
            onRemoveStop={(index) => {
              setStops((prev) => prev.filter((_, i) => i !== index))
              clearRouteResults()
            }}
            onVehicleModeChange={(mode) => {
              setVehicleMode(mode)
              setConsumption(DEFAULT_CONSUMPTION_L_PER_100KM[mode])
              setAxleCount(DEFAULT_AXLE_COUNT[mode])
              setVehicleHeight(DEFAULT_VEHICLE_HEIGHT_CM[mode])
              clearRouteResults()
            }}
            onConsumptionChange={setConsumption}
            onFuelPriceChange={setFuelPrice}
            onDriverFeeChange={setDriverFee}
            onOperatingCostPerKmChange={setOperatingCostPerKm}
            emissionClass={emissionClass}
            axleCount={axleCount}
            vehicleHeight={vehicleHeight}
            onEmissionClassChange={setEmissionClass}
            onAxleCountChange={setAxleCount}
            onVehicleHeightChange={setVehicleHeight}
            tollRates={tollRates}
            isTruck={isTruck}
            onTollRateChange={(country, field, value) => {
              setTollRates((prev) => {
                const next = {
                  ...prev,
                  [country]: {
                    vat: field === 'vat' ? value : prev[country]?.vat ?? 0,
                    tollDiscount:
                      field === 'tollDiscount'
                        ? value
                        : prev[country]?.tollDiscount ?? 0,
                    tunnelDiscount:
                      field === 'tunnelDiscount'
                        ? value
                        : prev[country]?.tunnelDiscount ?? 0,
                  },
                }
                saveTollRatesForUser(next).catch(() => {
                  // local cache already written; cloud sync may fail without rules
                })
                return next
              })
            }}
            onSubmit={() => {
              void handleSubmit()
            }}
          />

          {error ? (
            <div className="status status-error" role="alert">
              <strong>Ups!</strong> {error}
            </div>
          ) : null}

          {loading ? (
            <div className="status status-loading">Računam rutu i putarinu…</div>
          ) : null}
          {importing ? (
            <div className="status status-loading">
              Učitavam izveštaj i geokodiram tačke…
            </div>
          ) : null}
        </aside>

        <section className="map-panel">
          <div className="map-caption">Mapa rute (plava linija = tvoj put)</div>
          <RouteMap
            origin={origin}
            destination={destination}
            stops={resolvedStops}
            routeCoordinates={route?.coordinates ?? []}
            tollStations={toll?.detectedStations ?? []}
          />
        </section>

        <aside className="results-sidebar">
          {route && toll && grandTotal !== null ? (
            <ResultPanel
              grandTotal={grandTotal}
              categoryLabel={toll.categoryLabel}
              distanceMeters={route.distanceMeters}
              durationSeconds={route.durationSeconds}
              liters={liters}
              fuelPrice={fuelPrice}
              fuelCost={fuelCost}
              serbiaTollEur={serbiaTollEur}
              foreignTollEur={foreignTollEur}
              foreignDiscount={foreignDiscount}
              foreignVatRemoved={foreignVatRemoved}
              driverFee={driverFee}
              operatingCostPerKm={operatingCostPerKm}
              operatingCost={operatingCost}
              isTruck={isTruck}
              hasForeignTolls={hasForeignTolls}
              toll={toll}
              adjustedForeign={adjustedForeign}
              foreignTolls={foreignTolls}
              routeLegs={route.legs}
              exchangeRateLabel={exchangeRateLabel}
            />
          ) : (
            <div className="result-placeholder">
              <strong>Ovde izlazi rezultat</strong>
              <p>Popuni rutu levo i pritisni IZRAČUNAJ.</p>
            </div>
          )}
        </aside>
      </main>

      {import.meta.env.DEV ? (
        <div className="sync-corner">
          <button
            type="button"
            className="btn btn-sync"
            disabled={syncing}
            onClick={() => {
              void handleSyncToll()
            }}
            title="Preuzmi stanice i cene sa Putevi Srbije (samo lokalno)"
          >
            {syncing ? 'SYNC…' : 'SYNC'}
          </button>
          <span className="sync-time" title={lastSyncAt ?? undefined}>
            Poslednji sync: {formatSyncTime(lastSyncAt)}
          </span>
          {syncMessage ? <span className="sync-message">{syncMessage}</span> : null}
        </div>
      ) : null}
    </div>
  )
}
