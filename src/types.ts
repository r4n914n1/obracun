export type VehicleMode =
  | 'car'
  | 'freight_under_3_5'
  | 'freight_3_6_to_10'
  | 'freight_over_10'

export interface Location {
  label: string
  lat: number
  lng: number
}

export interface RouteLeg {
  coordinates: [number, number][]
  distanceMeters: number
  durationSeconds: number
  fromLabel: string
  toLabel: string
}

/** A single foreign (non-Serbian) toll fare, priced in EUR by HERE. */
export interface ForeignTollFare {
  country: string
  system: string
  name: string
  eur: number
  paymentMethod: string | null
  kind: 'toll' | 'tunnel'
  /** Route segment A → B where HERE reported this toll (when known). */
  routeLegLabel: string | null
  /** Approximate map position from the HERE section carrying this toll. */
  lat: number | null
  lng: number | null
}

export interface ForeignTollSummary {
  totalEur: number
  byCountry: Array<{ country: string; eur: number }>
  fares: ForeignTollFare[]
  /** true if some fares couldn't be converted to EUR (excluded from total) */
  hasUnconverted: boolean
}

export interface RouteResult {
  coordinates: [number, number][]
  distanceMeters: number
  durationSeconds: number
  /** Polyline segments between consecutive waypoints (A → stop → … → B) */
  legs: RouteLeg[]
  /** Tolls outside Serbia, computed by HERE (Serbia handled by our own engine). */
  foreignTolls: ForeignTollSummary
}

export const VEHICLE_MODE_VALUES: VehicleMode[] = [
  'car',
  'freight_under_3_5',
  'freight_3_6_to_10',
  'freight_over_10',
]

/** Map of app vehicle modes to Putevi Srbije toll categories */
export const VEHICLE_TOLL_CATEGORY: Record<VehicleMode, '1' | '2' | '3' | '4'> = {
  car: '1',
  freight_under_3_5: '2',
  freight_3_6_to_10: '3',
  freight_over_10: '4',
}

/** Default fuel consumption (L/100 km) by vehicle / toll category */
export const DEFAULT_CONSUMPTION_L_PER_100KM: Record<VehicleMode, number> = {
  car: 7,
  freight_under_3_5: 10,
  freight_3_6_to_10: 15,
  freight_over_10: 30,
}

export const DEFAULT_DRIVER_FEE_EUR = 0
export const DEFAULT_FUEL_PRICE_EUR_PER_L = 1.5
/** Operativni troškovi (€/km) — default 0; unesi ako računaš servis/amortizaciju */
export const DEFAULT_OPERATING_COST_EUR_PER_KM = 0
/** Max međustopova između A i B (ručni unos i CSV import) */
export const MAX_INTERMEDIATE_STOPS = 8

/** EURO emission class — affects foreign (esp. truck) toll rates. */
export type EmissionClass =
  | 'euro1'
  | 'euro2'
  | 'euro3'
  | 'euro4'
  | 'euro5'
  | 'euro6'

export const EMISSION_CLASS_OPTIONS: EmissionClass[] = [
  'euro6',
  'euro5',
  'euro4',
  'euro3',
  'euro2',
  'euro1',
]

export const DEFAULT_EMISSION_CLASS: EmissionClass = 'euro6'

/** Optional vehicle parameters used for HERE toll accuracy outside Serbia. */
export interface VehicleTollOptions {
  emissionClass: EmissionClass
  axleCount: number
  heightCm: number
}

/** Per-country VAT (%) and discounts (%) for foreign tolls. */
export interface ForeignTollRate {
  vat: number
  /** Popust na autoput / mostove / klasične putarine */
  tollDiscount: number
  /** Popust na naplatne tunele (posebna stopa po ugovoru) */
  tunnelDiscount: number
}

export type ForeignTollRates = Record<string, ForeignTollRate>

export const DEFAULT_AXLE_COUNT: Record<VehicleMode, number> = {
  car: 2,
  freight_under_3_5: 2,
  freight_3_6_to_10: 2,
  freight_over_10: 5,
}

export const DEFAULT_VEHICLE_HEIGHT_CM: Record<VehicleMode, number> = {
  car: 160,
  freight_under_3_5: 260,
  freight_3_6_to_10: 350,
  freight_over_10: 400,
}
