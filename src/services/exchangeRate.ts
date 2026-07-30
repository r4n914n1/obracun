export interface ExchangeRate {
  /** Middle RSD per 1 EUR (NBS srednji kurs) */
  rsdPerEur: number
  date: string
  source: string
}

const FALLBACK_RSD_PER_EUR = 117.37

let cached: ExchangeRate | null = null
let inflight: Promise<ExchangeRate> | null = null

/**
 * Official NBS middle RSD/EUR rate via kurs.resenje.org mirror
 * (refreshed from NBS web services daily).
 */
export async function fetchNbsMiddleRsdPerEur(): Promise<ExchangeRate> {
  if (cached) return cached
  if (inflight) return inflight

  inflight = (async () => {
    try {
      const response = await fetch(
        'https://kurs.resenje.org/api/v1/currencies/eur/rates/today',
      )
      if (!response.ok) {
        throw new Error(`Kurs API HTTP ${response.status}`)
      }
      const data = (await response.json()) as {
        date?: string
        exchange_middle?: number
      }
      const middle = Number(data.exchange_middle)
      if (!Number.isFinite(middle) || middle <= 0) {
        throw new Error('Kurs API nije vratio exchange_middle')
      }
      cached = {
        rsdPerEur: middle,
        date: data.date ?? new Date().toISOString().slice(0, 10),
        source: 'NBS srednji kurs (kurs.resenje.org)',
      }
      return cached
    } catch {
      cached = {
        rsdPerEur: FALLBACK_RSD_PER_EUR,
        date: new Date().toISOString().slice(0, 10),
        source: 'Fallback (NBS API nedostupan)',
      }
      return cached
    } finally {
      inflight = null
    }
  })()

  return inflight
}

export function rsdToEur(rsd: number, rsdPerEur: number): number {
  if (rsdPerEur <= 0) return 0
  return Math.round((rsd / rsdPerEur) * 100) / 100
}

export function eurToRsd(eur: number, rsdPerEur: number): number {
  if (rsdPerEur <= 0) return 0
  return Math.round(eur * rsdPerEur)
}
