import type {
  ForeignTollFare,
  ForeignTollRates,
  ForeignTollSummary,
} from '../types'
import config from '../data/foreign-toll-rates.json'

export interface AdjustedFare {
  country: string
  name: string
  system: string
  kind: ForeignTollFare['kind']
  grossEur: number
  netEur: number
  discountPercent: number
  vatPercent: number
  routeLegLabel: string | null
  lat: number | null
  lng: number | null
}

export interface AdjustedCountry {
  country: string
  grossEur: number
  netEur: number
  vatPercent: number
}

export interface AdjustedForeignTolls {
  grossEur: number
  netEur: number
  vatRemovedEur: number
  discountSavingsEur: number
  byCountry: AdjustedCountry[]
  fares: AdjustedFare[]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Default rate table (seed VAT + zero discounts) from JSON config. */
export function defaultForeignTollRates(): ForeignTollRates {
  const out: ForeignTollRates = {}
  const countries = config.countries as Record<
    string,
    {
      vat?: number
      tollDiscount?: number
      tunnelDiscount?: number
      discount?: number
    }
  >
  for (const [code, rate] of Object.entries(countries)) {
    out[code] = {
      vat: rate.vat ?? 0,
      tollDiscount: rate.tollDiscount ?? rate.discount ?? 0,
      tunnelDiscount: rate.tunnelDiscount ?? 0,
    }
  }
  return out
}

export const APPLIES_TO_CARS_TOO = Boolean(config.appliesToCarsToo)

function adjustAmount(
  grossEur: number,
  discountPercent: number,
  vatPercent: number,
): { netEur: number; discountSaved: number; vatRemoved: number } {
  const afterDiscount = round2(grossEur * (1 - discountPercent / 100))
  const netEur =
    vatPercent > 0
      ? round2(afterDiscount / (1 + vatPercent / 100))
      : afterDiscount
  return {
    netEur,
    discountSaved: round2(grossEur - afterDiscount),
    vatRemoved: round2(afterDiscount - netEur),
  }
}

/**
 * Per fare: popust (putarina ili tunel), zatim PDV na iznos posle popusta.
 */
export function adjustForeignTolls(
  foreign: ForeignTollSummary,
  opts: { isTruck: boolean; rates: ForeignTollRates },
): AdjustedForeignTolls {
  const applyDiscounts = opts.isTruck || APPLIES_TO_CARS_TOO

  const fares: AdjustedFare[] = foreign.fares.map((fare) => {
    const rate = opts.rates[fare.country]
    const vatPercent = opts.isTruck ? rate?.vat ?? 0 : 0
    const discountPercent = applyDiscounts
      ? fare.kind === 'tunnel'
        ? rate?.tunnelDiscount ?? 0
        : rate?.tollDiscount ?? 0
      : 0
    const grossEur = round2(fare.eur)
    const { netEur } = adjustAmount(grossEur, discountPercent, vatPercent)

    return {
      country: fare.country,
      name: fare.name,
      system: fare.system,
      kind: fare.kind,
      grossEur,
      netEur,
      discountPercent,
      vatPercent,
      routeLegLabel: fare.routeLegLabel,
      lat: fare.lat,
      lng: fare.lng,
    }
  })

  const byCountryMap = new Map<string, AdjustedCountry>()
  let grossEur = 0
  let netEur = 0
  let discountSavingsEur = 0
  let vatRemovedEur = 0

  for (const fare of fares) {
    const { discountSaved, vatRemoved } = adjustAmount(
      fare.grossEur,
      fare.discountPercent,
      fare.vatPercent,
    )
    grossEur += fare.grossEur
    netEur += fare.netEur
    discountSavingsEur += discountSaved
    vatRemovedEur += vatRemoved

    const existing = byCountryMap.get(fare.country)
    if (existing) {
      existing.grossEur = round2(existing.grossEur + fare.grossEur)
      existing.netEur = round2(existing.netEur + fare.netEur)
    } else {
      byCountryMap.set(fare.country, {
        country: fare.country,
        grossEur: fare.grossEur,
        netEur: fare.netEur,
        vatPercent: fare.vatPercent,
      })
    }
  }

  const byCountry = [...byCountryMap.values()].sort((a, b) => b.netEur - a.netEur)

  return {
    grossEur: round2(grossEur),
    netEur: round2(netEur),
    discountSavingsEur: round2(discountSavingsEur),
    vatRemovedEur: round2(vatRemovedEur),
    byCountry,
    fares,
  }
}
