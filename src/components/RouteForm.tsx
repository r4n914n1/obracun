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
  VEHICLE_OPTIONS,
} from '../types'
import { PlaceInput } from './PlaceInput'

const COUNTRY_LABELS: Record<string, string> = {
  ITA: 'Italija',
  FRA: 'Francuska',
  ESP: 'Španija',
  PRT: 'Portugal',
  AUT: 'Austrija',
  DEU: 'Nemačka',
  BEL: 'Belgija',
  POL: 'Poljska',
  HUN: 'Mađarska',
  HRV: 'Hrvatska',
  SVN: 'Slovenija',
  BGR: 'Bugarska',
  ROU: 'Rumunija',
  MKD: 'S. Makedonija',
  MNE: 'Crna Gora',
  GRC: 'Grčka',
  TUR: 'Turska',
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
          title="Telematic izveštaj, učitaće se do 8 najdužih stop lokacija u kartu"
          onClick={() => fileInputRef.current?.click()}
        >
          {importing ? 'Učitavam…' : 'Učitaj CSV sa stajanjem'}
        </button>
      </div>

      <div className="form-compact">
        <PlaceInput
          label="1. Odakle (A)"
          placeholder="Kucaj + klikni predlog…"
          value={origin}
          onChange={onOriginChange}
        />

        <div className="stops-compact">
          <div className="stops-header">
            <span className="field-label">
              2. Stopovi (opciono, max {MAX_INTERMEDIATE_STOPS})
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onAddStop}
              disabled={busy || stops.length >= MAX_INTERMEDIATE_STOPS}
              title={
                stops.length >= MAX_INTERMEDIATE_STOPS
                  ? `Najviše ${MAX_INTERMEDIATE_STOPS} međustopova`
                  : 'Dodaj stop'
              }
            >
              + Stop
            </button>
          </div>
          {stops.map((stop, index) => (
            <div className="stop-row" key={`stop-${index}`}>
              <PlaceInput
                label={`Stop ${index + 1}`}
                placeholder="Kucaj + klikni predlog…"
                value={stop}
                onChange={(location) => onStopChange(index, location)}
              />
              <button
                type="button"
                className="btn btn-danger btn-sm-square"
                onClick={() => onRemoveStop(index)}
                aria-label={`Ukloni stop ${index + 1}`}
                title="Obriši"
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
            title={
              returnTrip
                ? 'Povratak uključen: uračunava se i B → A'
                : 'Uključi povratak (B → A)'
            }
            disabled={busy}
            onClick={() => onReturnTripChange?.(!returnTrip)}
          >
            <span className="return-toggle-icon" aria-hidden>
              ⇄
            </span>
            <span className="return-toggle-text">
              {returnTrip ? 'Povratak' : 'Jedan smer'}
            </span>
          </button>
          <div className="destination-field">
            <PlaceInput
              label="3. Gde (B)"
              placeholder="Kucaj + klikni predlog…"
              value={destination}
              onChange={onDestinationChange}
            />
          </div>
        </div>

        <div className="vehicle-block">
          <span className="field-label">4. Vozilo</span>
          <div className="vehicle-grid">
            {VEHICLE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`vehicle-card${vehicleMode === option.value ? ' is-active' : ''}`}
                onClick={() => onVehicleModeChange(option.value)}
                title={option.hint}
              >
                <span className="vehicle-card-title">{option.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="cost-settings">
          <span className="field-label">5. Podešavanja troška</span>
          <div className="cost-settings-row">
            <label className="cost-field">
              <span>Potrošnja (L/100 km)</span>
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
              <span>Cena goriva (€/L)</span>
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
              <span>Naknada vozača (€)</span>
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
            </label>
            <label className="cost-field">
              <span>Operativni troškovi (€/km)</span>
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
            </label>
          </div>
          <p className="cost-settings-hint">
            Ukupno = litri × cena goriva + putarina + naknada + operativni (km × €/km)
          </p>
        </div>

        <details className="cost-settings advanced-settings">
          <summary className="field-label">
            6. Napredno — strane putarine
          </summary>
          <div className="cost-settings-row">
            <label className="cost-field">
              <span>EURO klasa</span>
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
              <span>Broj osovina</span>
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
              <span>Visina (cm)</span>
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
          <p className="cost-settings-hint">
            Utiče na putarine van Srbije (HERE). Osovine i visina se koriste za
            kamione.
          </p>
        </details>

        {!canSubmit && !busy ? (
          <p className="todo-line">Fali: {missing.join(', ')}</p>
        ) : null}

        <button type="submit" className="btn btn-primary btn-xl" disabled={!canSubmit}>
          {importing ? 'Učitavam…' : loading ? 'Računam…' : 'IZRAČUNAJ'}
        </button>

        <details className="cost-settings toll-rates-editor" open={isTruck}>
          <summary className="field-label">
            Strane putarine — PDV i popust (kamioni)
          </summary>
          <p className="cost-settings-hint">
            Primenjuje se samo na kamione. Putarina i tuneli imaju poseban
            popust po zemlji, zatim skidanje PDV-a. Sa Google nalogom izmene se
            čuvaju na serveru (svi uređaji); lokalni nalog — samo u ovom
            pregledaču.
          </p>
          <div className="toll-rates-table toll-rates-table-wide">
            <div className="toll-rates-head">
              <span>Zemlja</span>
              <span>Put. %</span>
              <span>Tunel %</span>
              <span>PDV %</span>
            </div>
            {tollRateEntries.map(([country, rate]) => (
              <div className="toll-rates-row" key={`rate-${country}`}>
                <span className="toll-rates-country">
                  {COUNTRY_LABELS[country] ?? country}
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
