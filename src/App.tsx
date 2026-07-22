import { useEffect, useState } from 'react'
import { LoginScreen } from './components/LoginScreen'
import { PricingPage } from './components/PricingPage'
import { RouteForm } from './components/RouteForm'
import { ResultPanel } from './components/ResultPanel'
import { RouteMap } from './components/RouteMap'
import { LanguageToggle } from './components/LanguageToggle'
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
import { BugReportButton } from './components/BugReportButton'
import { fetchQuota, confirmPayPalCheckout, recordCalculationUsage } from './services/billing'
import { isFirebaseConfigured } from './services/firebase'
import { useLocale } from './i18n/LocaleContext'
import type { QuotaSnapshot } from './types/billing'
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

export default function App() {
  const { t, numberLocale, ready: localeReady } = useLocale()
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
  const [quota, setQuota] = useState<QuotaSnapshot | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function refreshQuota(): Promise<void> {
    if (!isFirebaseConfigured() || !isAuthenticated()) return
    try {
      const next = await fetchQuota()
      setQuota(next)
    } catch {
      // Billing functions may not be deployed yet.
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const checkout = params.get('checkout')
    if (!checkout) return

    if (checkout === 'success') {
      const subscriptionId = params.get('subscription_id')
      sessionStorage.setItem(
        'paypalCheckout',
        subscriptionId ? `sub:${subscriptionId}` : 'success',
      )
    } else if (checkout === 'cancel') {
      setNotice(t('checkoutCancel'))
    }

    params.delete('checkout')
    params.delete('subscription_id')
    params.delete('ba_token')
    params.delete('token')
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`
    window.history.replaceState({}, '', next)
  }, [t])

  useEffect(() => {
    if (!authReady || !authed) return

    const pending = sessionStorage.getItem('paypalCheckout')
    const recoverKey = 'paypalConfirmAttempted'
    const shouldRecover = !pending && !sessionStorage.getItem(recoverKey)
    if (!pending && !shouldRecover) return

    let cancelled = false
    void (async () => {
      const subscriptionId =
        pending?.startsWith('sub:') ? pending.slice(4) : undefined

      if (pending) {
        sessionStorage.removeItem('paypalCheckout')
      } else {
        sessionStorage.setItem(recoverKey, '1')
      }

      try {
        const next = await confirmPayPalCheckout(subscriptionId)
        if (cancelled) return
        if (next.plan === 'subscribed') {
          setQuota(next)
          if (next.queuedPlanId) {
            setNotice(t('checkoutQueuedSuccess'))
          } else if (pending) {
            setNotice(t('checkoutSuccess'))
          } else {
            setNotice(t('checkoutSuccess'))
          }
        }
      } catch {
        if (pending && !cancelled) {
          await refreshQuota()
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [authReady, authed, t])

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
        await refreshQuota()
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

    const routeOrigin = from
    const routeDestination = roundTrip ? from : to
    const routeVias = roundTrip ? [...via, to] : via

    try {
      if (quota && !quota.canCalculate) {
        throw new Error(t('quotaExhausted'))
      }

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
        t('exchangeRate', {
          rate: rate.rsdPerEur.toFixed(2),
          date: rate.date,
        }),
      )

      if (isFirebaseConfigured()) {
        try {
          const nextQuota = await recordCalculationUsage()
          setQuota(nextQuota)
        } catch (usageErr: unknown) {
          clearRouteResults()
          throw usageErr
        }
      }
    } catch (err: unknown) {
      clearRouteResults()
      setError(err instanceof Error ? err.message : t('genericError'))
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
        throw new Error(t('csvGeocodeFew'))
      }

      const nextOrigin = unique[0]
      const nextDestination = unique[unique.length - 1]
      const nextStops = unique.slice(1, -1).slice(0, MAX_INTERMEDIATE_STOPS)

      setOrigin(nextOrigin)
      setDestination(nextDestination)
      setStops(nextStops)
      await calculateRoute(nextOrigin, nextDestination, nextStops)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('csvImportFailed'))
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
        err instanceof Error ? err.message : t('syncFailed'),
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

  if (!localeReady || !authReady) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <h1 className="login-brand">{t('brand')}</h1>
          <p className="login-tagline">{t('brandTagline')}</p>
          <p className="login-sub">{t('loadingSession')}</p>
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
          isAuthenticated={authed}
          quota={quota}
          onRequireLogin={() => setScreen('app')}
          onQuotaChange={setQuota}
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
          void refreshQuota()
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
            <h1>{t('appTitle')}</h1>
            <p>{t('appSubtitle')}</p>
          </div>
          <div className="app-header-actions">
            <LanguageToggle />
            <BugReportButton className="btn btn-logout" title={t('bugReportTitle')} />
            <button
              type="button"
              className="btn btn-logout"
              onClick={() => setScreen('pricing')}
            >
              {t('pricingNav')}
            </button>
            <button
              type="button"
              className="btn btn-logout"
              onClick={() => {
                void (async () => {
                  await logout()
                  setAuthed(false)
                  setQuota(null)
                  setScreen('app')
                  setTollRates(defaultForeignTollRates())
                })()
              }}
            >
              {t('logout')}
            </button>
          </div>
        </div>
        {quota ? (
          <p className="app-quota">
            {t('quotaLabel', {
              remaining: quota.remaining,
              limit: quota.limit,
            })}
            {quota.plan === 'subscribed' && quota.periodEnd
              ? ` · ${t('quotaUntil', {
                  date: new Date(quota.periodEnd).toLocaleDateString(
                    numberLocale,
                    { dateStyle: 'medium' },
                  ),
                })}`
              : ''}
            {quota.cancelAtPeriodEnd
              ? ` · ${t('subscriptionCancelledPending')}`
              : ''}
          </p>
        ) : null}
        {notice ? <p className="app-notice">{notice}</p> : null}
        <p className="app-disclaimer">{t('disclaimer')}</p>
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
              <strong>{t('oops')}</strong> {error}
            </div>
          ) : null}

          {loading ? (
            <div className="status status-loading">{t('calculating')}</div>
          ) : null}
          {importing ? (
            <div className="status status-loading">{t('importingStatus')}</div>
          ) : null}
        </aside>

        <section className="map-panel">
          <div className="map-caption">{t('mapCaption')}</div>
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
              categoryCode={toll.category}
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
              <strong>{t('resultPlaceholderTitle')}</strong>
              <p>{t('resultPlaceholderBody')}</p>
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
            title={t('syncTitle')}
          >
            {syncing ? 'SYNC…' : 'SYNC'}
          </button>
          <span className="sync-time" title={lastSyncAt ?? undefined}>
            {t('lastSync')} {formatSyncTime(lastSyncAt)}
          </span>
          {syncMessage ? <span className="sync-message">{syncMessage}</span> : null}
        </div>
      ) : null}
    </div>
  )
}
