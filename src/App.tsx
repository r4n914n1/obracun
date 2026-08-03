import { useEffect, useRef, useState } from 'react'
import { LoginScreen } from './components/LoginScreen'
import { PricingPage } from './components/PricingPage'
import { RouteForm } from './components/RouteForm'
import { ResultPanel } from './components/ResultPanel'
import { RouteMap } from './components/RouteMap'
import { LanguageToggle } from './components/LanguageToggle'
import {
  getAccountId,
  isAuthenticated,
  logout,
  waitForAuthReady,
} from './services/auth'
import { fetchRoute, mergeRouteResults } from './services/hereRouting'
import { fetchNbsMiddleRsdPerEur } from './services/exchangeRate'
import { estimateToll, type TollEstimate } from './services/tollEstimate'
import { adjustForeignTolls, defaultForeignTollRates } from './services/tollDiscounts'
import {
  loadTollRatesForUser,
  saveTollRatesForUser,
} from './services/tollRatesStorage'
import { geocodeAddresses, dedupeNearbyLocations, reverseGeocode } from './services/geocode'
import { buildWaypointsFromCsv } from './services/movementReportImport'
import {
  formatSyncSummary,
  formatSyncTime,
  latestIso,
  requestTollSync,
} from './services/syncToll'
import { BugReportButton } from './components/BugReportButton'
import { AppTutorial } from './components/AppTutorial'
import { AdRewardDialog } from './components/AdRewardDialog'
import { fetchQuota, confirmPayPalCheckout, recordCalculationUsage } from './services/billing'
import {
  takeCheckoutPlan,
  trackSubscriptionConversion,
} from './services/googleAds'
import { isFirebaseConfigured } from './services/firebase'
import {
  hasCompletedTutorial,
  markTutorialCompleted,
} from './services/tutorialStorage'
import { useLocale } from './i18n/LocaleContext'
import type { QuotaSnapshot } from './types/billing'
import type {
  EmissionClass,
  ForeignTollRates,
  Location,
  MapPickTarget,
  RouteResult,
  StopSlot,
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
  createStopSlot,
  isSameMapPickTarget,
  mapPickShortLabel,
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
  const [stops, setStops] = useState<StopSlot[]>([])
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
  const [adRewardOpen, setAdRewardOpen] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [mapPickTarget, setMapPickTarget] = useState<MapPickTarget | null>(null)
  const [mapGeocoding, setMapGeocoding] = useState(false)
  const tutorialAutoStarted = useRef(false)

  async function handleLoginSuccess(): Promise<void> {
    setAuthed(true)
    setLoginOpen(false)
    await refreshTollRatesFromAccount()
    await refreshQuota()
  }

  function requireAuth(): boolean {
    if (authed) return true
    setLoginOpen(true)
    return false
  }

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
      // Keep ?checkout=success long enough for URL-based Ads conversion + gtag.
      const planFromUrl = params.get('plan')
      if (planFromUrl) {
        try {
          sessionStorage.setItem('googleAdsPendingPlanId', planFromUrl)
        } catch {
          // ignore
        }
      }
    } else if (checkout === 'cancel') {
      setNotice(t('checkoutCancel'))
    }

    const clearParams = () => {
      params.delete('checkout')
      params.delete('subscription_id')
      params.delete('ba_token')
      params.delete('token')
      params.delete('plan')
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`
      window.history.replaceState({}, '', next)
    }

    // Delay stripping success URL so Ads page-load / Tag Assistant can see it.
    if (checkout === 'success') {
      window.setTimeout(clearParams, 5000)
    } else {
      clearParams()
    }
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
          const planId = takeCheckoutPlan(next.planId ?? next.queuedPlanId)
          trackSubscriptionConversion({
            planId,
            transactionId: subscriptionId || next.planId || 'paypal-success',
          })
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

  useEffect(() => {
    if (!authReady || !authed || screen !== 'app') return
    if (tutorialAutoStarted.current) return
    const accountId = getAccountId()
    if (!accountId) return
    tutorialAutoStarted.current = true
    if (!hasCompletedTutorial(accountId)) {
      setTutorialOpen(true)
    }
  }, [authReady, authed, screen])

  async function refreshTollRatesFromAccount(): Promise<void> {
    const rates = await loadTollRatesForUser()
    setTollRates(rates)
  }

  const resolvedStops = stops
    .map((stop) => stop.location)
    .filter((stop): stop is Location => stop !== null)

  function clearRouteResults() {
    setRoute(null)
    setToll(null)
    setExchangeRateLabel(null)
  }

  function handleMapPickRequest(target: MapPickTarget) {
    if (!requireAuth()) return
    setMapPickTarget((prev) =>
      prev && isSameMapPickTarget(prev, target) ? null : target,
    )
  }

  async function handleMapPick(lat: number, lng: number) {
    if (!mapPickTarget || !authed) return
    const target = mapPickTarget
    setMapGeocoding(true)
    setError(null)
    try {
      const location = await reverseGeocode(lat, lng)
      if (target.kind === 'origin') {
        setOrigin(location)
      } else if (target.kind === 'destination') {
        setDestination(location)
      } else {
        setStops((prev) =>
          prev.map((item, i) =>
            i === target.index ? { ...item, location } : item,
          ),
        )
      }
      clearRouteResults()
      setMapPickTarget(null)
    } catch {
      setError(t('mapPickFailed'))
    } finally {
      setMapGeocoding(false)
    }
  }

  useEffect(() => {
    if (!mapPickTarget) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMapPickTarget(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mapPickTarget])

  async function handleSubmit() {
    if (!origin || !destination) return
    if (stops.some((stop) => stop.location === null)) return
    if (!requireAuth()) return

    await calculateRoute(origin, destination, resolvedStops)
  }

  async function calculateRoute(
    from: Location,
    to: Location,
    via: Location[],
    roundTrip: boolean = returnTrip,
  ): Promise<void> {
    // Guard before any HERE / billing calls — avoids burning API then wiping results.
    if (!isAuthenticated()) {
      setLoginOpen(true)
      return
    }

    setLoading(true)
    setError(null)

    const routeOptions = {
      emissionClass,
      axleCount,
      heightCm: vehicleHeight,
    }

    try {
      if (quota && !quota.canCalculate) {
        if (quota.canClaimAdReward) {
          setAdRewardOpen(true)
        }
        throw new Error(t('quotaExhausted'))
      }

      const [result, rate] = await Promise.all([
        roundTrip
          ? Promise.all([
              fetchRoute(from, to, via, vehicleMode, routeOptions),
              fetchRoute(to, from, [], vehicleMode, routeOptions),
            ]).then(([outbound, inbound]) => mergeRouteResults(outbound, inbound))
          : fetchRoute(from, to, via, vehicleMode, routeOptions),
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
    if (!requireAuth()) return

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
      setStops(nextStops.map((location) => createStopSlot(location)))
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
        <div className="login-atmosphere" aria-hidden="true" />
        <main className="login-hero login-hero-loading">
          <img
            className="login-logo login-logo-compact"
            src="/logo.png"
            alt={t('brand')}
            width={181}
            height={173}
            decoding="async"
          />
          <h1 className="login-brand">{t('brand')}</h1>
          <p className="login-tagline">{t('brandTagline')}</p>
          <p className="login-sub">{t('loadingSession')}</p>
        </main>
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
          onRequireLogin={() => {
            setScreen('app')
            setLoginOpen(true)
          }}
          onQuotaChange={setQuota}
        />
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-row">
          <div className="app-brand" data-tour="welcome">
            <img
              className="app-logo"
              src="/logo.png"
              alt={t('brand')}
              width={181}
              height={173}
              decoding="async"
            />
            <div>
              <h1>{t('appTitle')}</h1>
              <p>{t('appSubtitle')}</p>
            </div>
          </div>
          <div className="app-header-actions">
            <LanguageToggle />
            <button
              type="button"
              className="btn btn-logout btn-tutorial-help"
              data-tour="help"
              title={t('tutorialHelpTitleAttr')}
              aria-label={t('tutorialHelpTitleAttr')}
              onClick={() => setTutorialOpen(true)}
            >
              {t('tutorialHelp')}
            </button>
            <BugReportButton className="btn btn-logout" title={t('bugReportTitle')} />
            <button
              type="button"
              className="btn btn-logout"
              data-tour="pricing"
              onClick={() => setScreen('pricing')}
            >
              {t('pricingNav')}
            </button>
            <a href="/privacy" className="btn btn-logout">
              {t('privacyNav')}
            </a>
            {authed ? (
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
                    setTutorialOpen(false)
                    setLoginOpen(false)
                    tutorialAutoStarted.current = false
                    clearRouteResults()
                  })()
                }}
              >
                {t('logout')}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-logout"
                onClick={() => setLoginOpen(true)}
              >
                {t('loginGoogle')}
              </button>
            )}
          </div>
        </div>
        {quota ? (
          <div className="app-quota" data-tour="quota" aria-live="polite">
            <div className="app-quota-main">
              <span className="app-quota-heading">{t('quotaHeading')}</span>
              <span className="app-quota-nums">
                {(
                  quota.remaining + (quota.bonusCalculations ?? 0)
                ).toLocaleString(numberLocale)}
                {' / '}
                {quota.limit.toLocaleString(numberLocale)}
              </span>
            </div>
            <div className="app-quota-extra">
              <span
                className={`app-quota-chip${(quota.bonusCalculations ?? 0) > 0 ? '' : ' is-muted'}`}
              >
                {(quota.bonusCalculations ?? 0) > 0
                  ? t('quotaBonus', { bonus: quota.bonusCalculations })
                  : t('quotaBonus', { bonus: 0 })}
              </span>
              <span
                className={`app-quota-chip${quota.plan === 'subscribed' && quota.periodEnd ? '' : ' is-muted'}`}
              >
                {quota.plan === 'subscribed' && quota.periodEnd
                  ? t('quotaUntil', {
                      date: new Date(quota.periodEnd).toLocaleDateString(
                        numberLocale,
                        { dateStyle: 'medium' },
                      ),
                    })
                  : t('quotaNoPeriod')}
              </span>
              <span
                className={`app-quota-chip${quota.cancelAtPeriodEnd ? ' is-warn' : ' is-muted'}`}
              >
                {quota.cancelAtPeriodEnd
                  ? t('quotaCancelChip')
                  : '—'}
              </span>
              {quota.canClaimAdReward ? (
                <button
                  type="button"
                  className="app-quota-chip app-quota-chip-action"
                  onClick={() => setAdRewardOpen(true)}
                >
                  {t('adRewardCta')}
                </button>
              ) : (
                <span className="app-quota-chip is-muted app-quota-chip-spacer" aria-hidden>
                  —
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="app-quota app-quota-skeleton" data-tour="quota" aria-hidden>
            <div className="app-quota-main">
              <span className="app-quota-heading">{t('quotaHeading')}</span>
              <span className="app-quota-nums">— / —</span>
            </div>
            <div className="app-quota-extra">
              <span className="app-quota-chip is-muted">—</span>
              <span className="app-quota-chip is-muted">—</span>
              <span className="app-quota-chip is-muted">—</span>
              <span className="app-quota-chip is-muted app-quota-chip-spacer">—</span>
            </div>
          </div>
        )}
        {notice ? <p className="app-notice">{notice}</p> : null}
        <p className="app-disclaimer">
          {t('disclaimer')}{' '}
          <a href="/privacy" className="link-btn">
            {t('privacyLink')}
          </a>
        </p>
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
              setStops((prev) =>
                prev.map((item, i) =>
                  i === index ? { ...item, location } : item,
                ),
              )
              clearRouteResults()
            }}
            onAddStop={() => {
              setStops((prev) =>
                prev.length >= MAX_INTERMEDIATE_STOPS
                  ? prev
                  : [...prev, createStopSlot(null)],
              )
              clearRouteResults()
            }}
            onRemoveStop={(index) => {
              setStops((prev) => prev.filter((_, i) => i !== index))
              setMapPickTarget((prev) => {
                if (!prev || prev.kind !== 'stop') return prev
                if (prev.index === index) return null
                if (prev.index > index) {
                  return { kind: 'stop', index: prev.index - 1 }
                }
                return prev
              })
              clearRouteResults()
            }}
            onReorderStops={(fromIndex, toIndex) => {
              setStops((prev) => {
                if (
                  fromIndex < 0 ||
                  toIndex < 0 ||
                  fromIndex >= prev.length ||
                  toIndex >= prev.length ||
                  fromIndex === toIndex
                ) {
                  return prev
                }
                const next = [...prev]
                const [moved] = next.splice(fromIndex, 1)
                next.splice(toIndex, 0, moved)
                return next
              })
              clearRouteResults()
            }}
            onSwapOriginDestination={() => {
              setOrigin(destination)
              setDestination(origin)
              setStops((prev) => [...prev].reverse())
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
            routeInputsLocked={!authed}
            onRequireAuth={() => setLoginOpen(true)}
            mapPickTarget={mapPickTarget}
            onMapPickRequest={handleMapPickRequest}
            mapPickingBusy={mapGeocoding}
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
          {mapGeocoding ? (
            <div className="status status-loading">{t('mapGeocoding')}</div>
          ) : null}
        </aside>

        <section
          className={`map-panel${mapPickTarget ? ' map-panel-picking' : ''}`}
          data-tour="map"
        >
          <div className="map-caption">
            {mapPickTarget
              ? t('mapPickHint', { label: mapPickShortLabel(mapPickTarget) })
              : t('mapCaption')}
          </div>
          <RouteMap
            origin={origin}
            destination={destination}
            stops={resolvedStops}
            routeCoordinates={route?.coordinates ?? []}
            mapPickTarget={mapPickTarget}
            onMapPick={(lat, lng) => {
              void handleMapPick(lat, lng)
            }}
          />
        </section>

        <aside className="results-sidebar" data-tour="results">
          {route && toll && grandTotal !== null ? (
            <ResultPanel
              grandTotal={grandTotal}
              categoryCode={toll.category}
              distanceMeters={route.distanceMeters}
              durationSeconds={route.durationSeconds}
              liters={liters}
              fuelPrice={fuelPrice}
              fuelCost={fuelCost}
              consumption={consumption}
              serbiaTollEur={serbiaTollEur}
              foreignTollEur={foreignTollEur}
              foreignDiscount={foreignDiscount}
              foreignVatRemoved={foreignVatRemoved}
              driverFee={driverFee}
              operatingCostPerKm={operatingCostPerKm}
              operatingCost={operatingCost}
              toll={toll}
              adjustedForeign={adjustedForeign}
              foreignTolls={foreignTolls}
              routeLegs={route.legs}
              distanceByCountry={route.distanceByCountry ?? {}}
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

      <AdRewardDialog
        open={adRewardOpen}
        adRewardsRemaining={quota?.adRewardsRemaining ?? 0}
        onClose={() => setAdRewardOpen(false)}
        onClaimed={(next) => {
          setQuota(next)
          setNotice(t('adRewardReady'))
        }}
        onOpenPricing={() => {
          setAdRewardOpen(false)
          setScreen('pricing')
        }}
      />

      <AppTutorial
        open={tutorialOpen}
        onClose={(completed) => {
          setTutorialOpen(false)
          const accountId = getAccountId()
          if (accountId && (completed || !hasCompletedTutorial(accountId))) {
            markTutorialCompleted(accountId)
          }
        }}
      />

      {!authed && loginOpen ? (
        <div className="login-overlay">
          <LoginScreen
            onSuccess={() => {
              void handleLoginSuccess()
            }}
            onOpenPricing={() => {
              setLoginOpen(false)
              setScreen('pricing')
            }}
          />
        </div>
      ) : null}

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
