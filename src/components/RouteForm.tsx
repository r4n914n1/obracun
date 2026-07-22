import { useRef } from 'react'
import type {
  EmissionClass,
  ForeignTollRates,
  Location,
  VehicleMode,
} from '../types'
import {
  EMISSION_CLASS_OPTIONS,
  MAX_INTERMEDIATE_STOPS,
  VEHICLE_MODE_VALUES,
} from '../types'
import { useLocale } from '../i18n/LocaleContext'
import type { MessageKey } from '../i18n/messages'
import { PlaceInput } from './PlaceInput'

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
  stops: Array<Location | null>
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
}: RouteFormProps) {
  const { t, countryName } = useLocale()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const tollRateEntries = Object.entries(tollRates)
  const incompleteStops = stops.some((stop) => stop === null)
  const missing: string[] = []
  if (!origin) missing.push('A')
  if (!destination) missing.push('B')
  if (incompleteStops) missing.push('stop')

  const busy = loading || importing
  const canSubmit = missing.length === 0 && !busy

  return (
    <form
      className="route-form"
      onSubmit={(event) => {
        event.preventDefault()
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
          disabled={busy || !onImportCsv}
          title={t('csvImportTitle')}
          onClick={() => fileInputRef.current?.click()}
        >
          {importing ? t('csvImporting') : t('csvImport')}
        </button>
      </div>

      <div className="form-compact">
        <PlaceInput
          label={t('originLabel')}
          placeholder={t('placePlaceholder')}
          value={origin}
          onChange={onOriginChange}
        />

        <div className="stops-compact">
          <div className="stops-header">
            <span className="field-label">
              {t('stopsLabel', { max: MAX_INTERMEDIATE_STOPS })}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onAddStop}
              disabled={busy || stops.length >= MAX_INTERMEDIATE_STOPS}
              title={
                stops.length >= MAX_INTERMEDIATE_STOPS
                  ? t('maxStopsTitle', { max: MAX_INTERMEDIATE_STOPS })
                  : t('addStopTitle')
              }
            >
              {t('addStop')}
            </button>
          </div>
          {stops.map((stop, index) => (
            <div className="stop-row" key={`stop-${index}`}>
              <PlaceInput
                label={t('stopN', { n: index + 1 })}
                placeholder={t('placePlaceholder')}
                value={stop}
                onChange={(location) => onStopChange(index, location)}
              />
              <button
                type="button"
                className="btn btn-danger btn-sm-square"
                onClick={() => onRemoveStop(index)}
                aria-label={t('removeStop', { n: index + 1 })}
                title={t('delete')}
              >
                X
              </button>
            </div>
          ))}
        </div>

        <div className="destination-row">
          <button
            type="button"
            className={`return-toggle${returnTrip ? ' is-on' : ''}`}
            aria-pressed={returnTrip}
            title={returnTrip ? t('returnOnTitle') : t('returnOffTitle')}
            disabled={busy}
            onClick={() => onReturnTripChange?.(!returnTrip)}
          >
            <span className="return-toggle-icon" aria-hidden>
              ⇄
            </span>
            <span className="return-toggle-text">
              {returnTrip ? t('returnOn') : t('returnOff')}
            </span>
          </button>
          <div className="destination-field">
            <PlaceInput
              label={t('destinationLabel')}
              placeholder={t('placePlaceholder')}
              value={destination}
              onChange={onDestinationChange}
            />
          </div>
        </div>

        <div className="vehicle-block">
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

        <div className="cost-settings">
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

        {!canSubmit && !busy ? (
          <p className="todo-line">{t('missing', { list: missing.join(', ') })}</p>
        ) : null}

        <button type="submit" className="btn btn-primary btn-xl" disabled={!canSubmit}>
          {importing
            ? t('csvImporting')
            : loading
              ? t('calculatingBtn')
              : t('calculate')}
        </button>

        <details className="cost-settings toll-rates-editor" open={isTruck}>
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
