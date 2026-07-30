import type {
  EmissionClass,
  ForeignTollRates,
  Location,
  MapPickTarget,
  StopSlot,
  VehicleMode,
} from '../types'
import {
  EMISSION_CLASS_OPTIONS,
  isSameMapPickTarget,
  MAX_INTERMEDIATE_STOPS,
  VEHICLE_MODE_VALUES,
} from '../types'
import { useLocale } from '../i18n/LocaleContext'
import type { MessageKey } from '../i18n/messages'
import { PlaceInput } from './PlaceInput'
import { useRef, useState, type DragEvent } from 'react'

const VEHICLE_COPY: Record<
  VehicleMode,
  { label: MessageKey; hint: MessageKey }
> = {
  car: { label: 'vehicleCar', hint: 'vehicleCarHint' },
  freight_under_3_5: { label: 'vehicleVan', hint: 'vehicleVanHint' },
  freight_3_6_to_10: { label: 'vehicleMid', hint: 'vehicleMidHint' },
  freight_over_10: { label: 'vehicleHeavy', hint: 'vehicleHeavyHint' },
}

interface RouteFormProps {
  origin: Location | null
  destination: Location | null
  stops: StopSlot[]
  vehicleMode: VehicleMode
  consumption: number
  fuelPrice: number
  driverFee: number
  operatingCostPerKm: number
  emissionClass: EmissionClass
  axleCount: number
  vehicleHeight: number
  tollRates: ForeignTollRates
  isTruck: boolean
  loading: boolean
  importing?: boolean
  returnTrip?: boolean
  onImportCsv?: (file: File) => void
  onReturnTripChange?: (value: boolean) => void
  onOriginChange: (location: Location | null) => void
  onDestinationChange: (location: Location | null) => void
  onStopChange: (index: number, location: Location | null) => void
  onAddStop: () => void
  onRemoveStop: (index: number) => void
  onReorderStops: (fromIndex: number, toIndex: number) => void
  onSwapOriginDestination: () => void
  onVehicleModeChange: (mode: VehicleMode) => void
  onConsumptionChange: (value: number) => void
  onFuelPriceChange: (value: number) => void
  onDriverFeeChange: (value: number) => void
  onOperatingCostPerKmChange: (value: number) => void
  onEmissionClassChange: (value: EmissionClass) => void
  onAxleCountChange: (value: number) => void
  onVehicleHeightChange: (value: number) => void
  onTollRateChange: (
    country: string,
    field: 'vat' | 'tollDiscount' | 'tunnelDiscount',
    value: number,
  ) => void
  onSubmit: () => void
  routeInputsLocked?: boolean
  onRequireAuth?: () => void
  mapPickTarget?: MapPickTarget | null
  onMapPickRequest?: (target: MapPickTarget) => void
  mapPickingBusy?: boolean
}

export function RouteForm({
  origin,
  destination,
  stops,
  vehicleMode,
  consumption,
  fuelPrice,
  driverFee,
  operatingCostPerKm,
  emissionClass,
  axleCount,
  vehicleHeight,
  tollRates,
  isTruck,
  loading,
  importing = false,
  returnTrip = false,
  onImportCsv,
  onReturnTripChange,
  onOriginChange,
  onDestinationChange,
  onStopChange,
  onAddStop,
  onRemoveStop,
  onReorderStops,
  onSwapOriginDestination,
  onVehicleModeChange,
  onConsumptionChange,
  onFuelPriceChange,
  onDriverFeeChange,
  onOperatingCostPerKmChange,
  onEmissionClassChange,
  onAxleCountChange,
  onVehicleHeightChange,
  onTollRateChange,
  onSubmit,
  routeInputsLocked = false,
  onRequireAuth,
  mapPickTarget = null,
  onMapPickRequest,
  mapPickingBusy = false,
}: RouteFormProps) {
  const { t, countryName } = useLocale()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const tollRateEntries = Object.entries(tollRates)
  const incompleteStops = stops.some((stop) => stop.location === null)
  const missing: string[] = []
  if (!origin) missing.push('A')
  if (!destination) missing.push('B')
  if (incompleteStops) missing.push('stop')

  const busy = loading || importing || mapPickingBusy
  const canSubmit = missing.length === 0 && !busy

  function requestMapPick(target: MapPickTarget) {
    if (routeInputsLocked) {
      onRequireAuth?.()
      return
    }
    onMapPickRequest?.(target)
  }

  function isPickActive(target: MapPickTarget): boolean {
    return mapPickTarget != null && isSameMapPickTarget(mapPickTarget, target)
  }

  function handleDragStart(index: number) {
    setDragIndex(index)
  }

  function handleDragOver(event: DragEvent, index: number) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (dragIndex == null || dragIndex === index) return
    setDropIndex(index)
  }

  function handleDrop(index: number) {
    if (dragIndex != null && dragIndex !== index) {
      onReorderStops(dragIndex, index)
    }
    setDragIndex(null)
    setDropIndex(null)
  }

  function handleDragEnd() {
    setDragIndex(null)
    setDropIndex(null)
  }

  return (
    <form
      className="route-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (routeInputsLocked) {
          onRequireAuth?.()
          return
        }
        if (canSubmit) onSubmit()
      }}
    >
      <div className="import-row">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="visually-hidden"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file && onImportCsv) onImportCsv(file)
          }}
        />
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy || !onImportCsv || routeInputsLocked}
          title={routeInputsLocked ? t('placeLoginRequired') : t('csvImportTitle')}
          onClick={() => fileInputRef.current?.click()}
        >
          {importing ? t('csvImporting') : t('csvImport')}
        </button>
      </div>

      <div className="form-compact">
        <div className="waypoint-list" data-tour="route">
          <div className="waypoint-row">
            <span className="waypoint-rail" aria-hidden />
            <span className="waypoint-badge waypoint-badge-a" aria-hidden>
              A
            </span>
            <div className="waypoint-field">
              <PlaceInput
                label={t('originLabel')}
                placeholder={t('placePlaceholder')}
                value={origin}
                onChange={onOriginChange}
                compact
                locked={routeInputsLocked}
                onLockedInteract={onRequireAuth}
              />
            </div>
            <div className="waypoint-actions">
              <button
                type="button"
                className={`waypoint-icon-btn waypoint-icon-btn-pin${isPickActive({ kind: 'origin' }) ? ' is-active' : ''}`}
                onClick={() => requestMapPick({ kind: 'origin' })}
                disabled={busy}
                title={t('mapPickOriginTitle')}
                aria-label={t('mapPickOriginTitle')}
                aria-pressed={isPickActive({ kind: 'origin' })}
              >
                📍
              </button>
              <button
                type="button"
                className="waypoint-icon-btn"
                onClick={onSwapOriginDestination}
                disabled={busy || routeInputsLocked || (!origin && !destination)}
                title={t('swapEndsTitle')}
                aria-label={t('swapEndsTitle')}
              >
                ⇅
              </button>
            </div>
          </div>

          {stops.map((stop, index) => (
            <div
              className={`waypoint-row${dragIndex === index ? ' is-dragging' : ''}${dropIndex === index ? ' is-drop-target' : ''}`}
              key={stop.id}
              onDragOver={(event) => handleDragOver(event, index)}
              onDrop={() => handleDrop(index)}
              onDragEnd={handleDragEnd}
            >
              <button
                type="button"
                className="waypoint-handle"
                draggable={!busy && !routeInputsLocked}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move'
                  handleDragStart(index)
                }}
                aria-label={t('reorderStop', { n: index + 1 })}
                title={t('reorderStopTitle')}
                disabled={busy || routeInputsLocked}
              >
                ⋮⋮
              </button>
              <span className="waypoint-badge" aria-hidden>
                {index + 1}
              </span>
              <div className="waypoint-field">
                <PlaceInput
                  label={t('stopN', { n: index + 1 })}
                  placeholder={t('placePlaceholder')}
                  value={stop.location}
                  onChange={(location) => onStopChange(index, location)}
                  compact
                  locked={routeInputsLocked}
                  onLockedInteract={onRequireAuth}
                />
              </div>
              <div className="waypoint-actions">
                <button
                  type="button"
                  className={`waypoint-icon-btn waypoint-icon-btn-pin${isPickActive({ kind: 'stop', index }) ? ' is-active' : ''}`}
                  onClick={() => requestMapPick({ kind: 'stop', index })}
                  disabled={busy}
                  title={t('mapPickStopTitle', { n: index + 1 })}
                  aria-label={t('mapPickStopTitle', { n: index + 1 })}
                  aria-pressed={isPickActive({ kind: 'stop', index })}
                >
                  📍
                </button>
                <button
                  type="button"
                  className="waypoint-icon-btn waypoint-icon-btn-up"
                  disabled={busy || routeInputsLocked || index === 0}
                  onClick={() => onReorderStops(index, index - 1)}
                  aria-label={t('moveStopUp', { n: index + 1 })}
                  title={t('moveStopUpTitle')}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="waypoint-icon-btn waypoint-icon-btn-down"
                  disabled={busy || routeInputsLocked || index >= stops.length - 1}
                  onClick={() => onReorderStops(index, index + 1)}
                  aria-label={t('moveStopDown', { n: index + 1 })}
                  title={t('moveStopDownTitle')}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="waypoint-icon-btn waypoint-icon-btn-danger"
                  disabled={busy || routeInputsLocked}
                  onClick={() => onRemoveStop(index)}
                  aria-label={t('removeStop', { n: index + 1 })}
                  title={t('delete')}
                >
                  ×
                </button>
              </div>
            </div>
          ))}

          <div className="waypoint-row">
            <span className="waypoint-rail" aria-hidden />
            <span className="waypoint-badge waypoint-badge-b" aria-hidden>
              B
            </span>
            <div className="waypoint-field">
              <PlaceInput
                label={t('destinationLabel')}
                placeholder={t('placePlaceholder')}
                value={destination}
                onChange={onDestinationChange}
                compact
                locked={routeInputsLocked}
                onLockedInteract={onRequireAuth}
              />
            </div>
            <div className="waypoint-actions">
              <button
                type="button"
                className={`waypoint-icon-btn waypoint-icon-btn-pin${isPickActive({ kind: 'destination' }) ? ' is-active' : ''}`}
                onClick={() => requestMapPick({ kind: 'destination' })}
                disabled={busy}
                title={t('mapPickDestinationTitle')}
                aria-label={t('mapPickDestinationTitle')}
                aria-pressed={isPickActive({ kind: 'destination' })}
              >
                📍
              </button>
            </div>
          </div>

          <div className="waypoint-return-row">
            <button
              type="button"
              className={`waypoint-return${returnTrip ? ' is-on' : ''}`}
              aria-pressed={returnTrip}
              title={returnTrip ? t('returnOnTitle') : t('returnOffTitle')}
              disabled={busy || routeInputsLocked}
              onClick={() => onReturnTripChange?.(!returnTrip)}
            >
              <span aria-hidden>⇄</span>
              <span>{returnTrip ? t('returnOn') : t('returnOff')}</span>
            </button>
          </div>

          <button
            type="button"
            className="waypoint-add"
            onClick={onAddStop}
            disabled={busy || routeInputsLocked || stops.length >= MAX_INTERMEDIATE_STOPS}
            title={
              stops.length >= MAX_INTERMEDIATE_STOPS
                ? t('maxStopsTitle', { max: MAX_INTERMEDIATE_STOPS })
                : t('addStopTitle')
            }
          >
            {t('addStop')}
          </button>
        </div>

        <div className="vehicle-block" data-tour="vehicle">
          <span className="field-label">{t('vehicleLabel')}</span>
          <div className="vehicle-grid">
            {VEHICLE_MODE_VALUES.map((mode) => {
              const copy = VEHICLE_COPY[mode]
              return (
                <button
                  key={mode}
                  type="button"
                  className={`vehicle-card${vehicleMode === mode ? ' is-active' : ''}`}
                  onClick={() => onVehicleModeChange(mode)}
                  title={t(copy.hint)}
                >
                  <span className="vehicle-card-title">{t(copy.label)}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="cost-settings" data-tour="costs">
          <span className="field-label">{t('costSettings')}</span>
          <div className="cost-settings-row">
            <label className="cost-field">
              <span>{t('consumption')}</span>
              <input
                type="number"
                min={0}
                step={0.1}
                value={Number.isFinite(consumption) ? consumption : ''}
                onChange={(event) => {
                  const next = Number(event.target.value)
                  onConsumptionChange(Number.isFinite(next) ? next : 0)
                }}
              />
            </label>
            <label className="cost-field">
              <span>{t('fuelPrice')}</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={Number.isFinite(fuelPrice) ? fuelPrice : ''}
                onChange={(event) => {
                  const next = Number(event.target.value)
                  onFuelPriceChange(Number.isFinite(next) ? next : 0)
                }}
              />
            </label>
            <label className="cost-field">
              <span>{t('driverFee')}</span>
              <input
                type="number"
                min={0}
                step={1}
                value={Number.isFinite(driverFee) ? driverFee : ''}
                onChange={(event) => {
                  const next = Number(event.target.value)
                  onDriverFeeChange(Number.isFinite(next) ? next : 0)
                }}
              />
              <span className="cost-field-hint">{t('driverFeeHint')}</span>
            </label>
            <label className="cost-field">
              <span>{t('operatingCost')}</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={Number.isFinite(operatingCostPerKm) ? operatingCostPerKm : ''}
                onChange={(event) => {
                  const next = Number(event.target.value)
                  onOperatingCostPerKmChange(Number.isFinite(next) ? next : 0)
                }}
              />
              <span className="cost-field-hint">{t('operatingCostHint')}</span>
            </label>
          </div>
          <p className="cost-settings-hint">{t('costHint')}</p>
        </div>

        <details className="cost-settings advanced-settings">
          <summary className="field-label">{t('advancedTitle')}</summary>
          <div className="cost-settings-row">
            <label className="cost-field">
              <span>{t('euroClass')}</span>
              <select
                value={emissionClass}
                onChange={(event) =>
                  onEmissionClassChange(event.target.value as EmissionClass)
                }
              >
                {EMISSION_CLASS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <label className="cost-field">
              <span>{t('axleCount')}</span>
              <input
                type="number"
                min={2}
                step={1}
                disabled={!isTruck}
                value={Number.isFinite(axleCount) ? axleCount : ''}
                onChange={(event) => {
                  const next = Number(event.target.value)
                  onAxleCountChange(Number.isFinite(next) ? next : 0)
                }}
              />
            </label>
            <label className="cost-field">
              <span>{t('heightCm')}</span>
              <input
                type="number"
                min={0}
                step={10}
                disabled={!isTruck}
                value={Number.isFinite(vehicleHeight) ? vehicleHeight : ''}
                onChange={(event) => {
                  const next = Number(event.target.value)
                  onVehicleHeightChange(Number.isFinite(next) ? next : 0)
                }}
              />
            </label>
          </div>
          <p className="cost-settings-hint">{t('advancedHint')}</p>
        </details>

        {!canSubmit && !busy && !routeInputsLocked ? (
          <p className="todo-line">{t('missing', { list: missing.join(', ') })}</p>
        ) : null}

        <button
          type="submit"
          className="btn btn-primary btn-xl"
          data-tour="calculate"
          disabled={busy || (!routeInputsLocked && !canSubmit)}
        >
          {importing
            ? t('csvImporting')
            : loading
              ? t('calculatingBtn')
              : t('calculate')}
        </button>

        <details
          className="cost-settings toll-rates-editor"
          data-tour="foreign-rates"
          open={isTruck}
        >
          <summary className="field-label">{t('foreignRatesTitle')}</summary>
          <p className="cost-settings-hint">{t('foreignRatesHint')}</p>
          <div className="toll-rates-table toll-rates-table-wide">
            <div className="toll-rates-head">
              <span>{t('countryCol')}</span>
              <span>{t('tollPct')}</span>
              <span>{t('tunnelPct')}</span>
              <span>{t('vatPct')}</span>
            </div>
            {tollRateEntries.map(([country, rate]) => (
              <div className="toll-rates-row" key={`rate-${country}`}>
                <span className="toll-rates-country">
                  {countryName(country)}
                </span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  disabled={!isTruck}
                  value={Number.isFinite(rate.tollDiscount) ? rate.tollDiscount : ''}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    onTollRateChange(
                      country,
                      'tollDiscount',
                      Number.isFinite(next) ? next : 0,
                    )
                  }}
                />
                <input
                  type="number"
                  min={0}
                  step={1}
                  disabled={!isTruck}
                  value={
                    Number.isFinite(rate.tunnelDiscount) ? rate.tunnelDiscount : ''
                  }
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    onTollRateChange(
                      country,
                      'tunnelDiscount',
                      Number.isFinite(next) ? next : 0,
                    )
                  }}
                />
                <input
                  type="number"
                  min={0}
                  step={1}
                  disabled={!isTruck}
                  value={Number.isFinite(rate.vat) ? rate.vat : ''}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    onTollRateChange(country, 'vat', Number.isFinite(next) ? next : 0)
                  }}
                />
              </div>
            ))}
          </div>
        </details>
      </div>
    </form>
  )
}
