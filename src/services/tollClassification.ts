import type { ForeignTollFare } from '../types'
import tunnelSystems from '../data/tunnel-systems.json'

const TUNNEL_HINT =
  /tunnel|tunel|tünel|traforo|galleria|galerie|galerija|predor|mont[\s-]?blanc|monte[\s-]?bianco|karawan|karavan|frejus|fréjus|tauern|gotthard|arlberg|brenner|vielha|karawanken|karavanken|san[\s-]?bernardino|gran[\s-]?san[\s-]?bernardo|great[\s-]?st[\s-]?bernard|munt[\s-]?la[\s-]?schera|vereina/i

/** Time-based vignettes / stickers — buy once per country/system, not per passage. */
const VIGNETTE_HINT =
  /vignette|vinjeta|vinjet|e[\s-]?vignette|e[\s-]?vinjeta|timeticket|time[\s-]?ticket|day[\s-]?pass|dnevna|nalepnica|road[\s-]?tax[\s-]?disc|autobahnvignette|digital[\s-]?vignette/i

const NORMALIZED_OPERATORS = (tunnelSystems.operators as string[]).map(
  normalizeTollText,
)

function normalizeTollText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Tunnel vs vignette vs highway toll — HERE reason + keywords + known operators. */
export function classifyForeignTollKind(
  name: string,
  system: string,
  reason?: string | null,
): ForeignTollFare['kind'] {
  const reasonKey = (reason ?? '').trim().toLowerCase()
  if (
    reasonKey === 'vignette' ||
    reasonKey === 'ticket' ||
    reasonKey.includes('vignette')
  ) {
    return 'vignette'
  }

  const text = normalizeTollText(`${name} ${system}`)
  if (!text) return 'toll'

  if (VIGNETTE_HINT.test(text)) return 'vignette'

  if (TUNNEL_HINT.test(text)) return 'tunnel'

  for (const operator of NORMALIZED_OPERATORS) {
    if (operator && text.includes(operator)) return 'tunnel'
  }

  return 'toll'
}

/** Stable key so the same vignette is counted once on round trips. */
export function foreignVignetteKey(fare: {
  country: string
  system: string
  name: string
}): string {
  const system = normalizeTollText(fare.system)
  const name = normalizeTollText(fare.name)
  return `${fare.country}::${system || name}`
}

/**
 * Resolve vignette validity to whole days.
 * Prefers HERE `pass.validityPeriod`, then parses common patterns in the fare name.
 */
export function resolveVignetteValidDays(
  name: string,
  system: string,
  pass?: {
    validityPeriod?: {
      periodType?: string
      count?: number | null
    } | null
  } | null,
): number | null {
  const period = pass?.validityPeriod
  if (period?.periodType) {
    const type = period.periodType.trim().toLowerCase().replace(/-/g, '_')
    const count =
      typeof period.count === 'number' && Number.isFinite(period.count)
        ? Math.max(0, period.count)
        : null

    if (type === 'days' && count != null && count > 0) {
      return Math.round(count)
    }
    if (type === 'months' && count != null && count > 0) {
      return Math.round(count * 30)
    }
    if (type === 'minutes' && count != null && count > 0) {
      return Math.max(1, Math.ceil(count / (60 * 24)))
    }
    if (type === 'annual') return 365
    if (type === 'extended_annual') return 396
  }

  const text = `${name} ${system}`
  const dayMatch = text.match(
    /(\d+)\s*[-–]?\s*(?:day|days|dan|dana|dnevn\w*)\b/i,
  )
  if (dayMatch) {
    const days = Number(dayMatch[1])
    if (Number.isFinite(days) && days > 0) return Math.round(days)
  }

  const monthMatch = text.match(
    /(\d+)\s*[-–]?\s*(?:month|months|mesec|meseca|mjesec|mjeseca|Monat\w*)\b/i,
  )
  if (monthMatch) {
    const months = Number(monthMatch[1])
    if (Number.isFinite(months) && months > 0) return Math.round(months * 30)
  }

  if (
    /annual|godisnj|godišnj|jahresvignette|year\s*vignette|1\s*year|yearly/i.test(
      text,
    )
  ) {
    return 365
  }

  if (/weekend|vikend/i.test(text)) return 3

  return null
}

/** Display label for foreign toll line items. */
export function foreignTollDisplayName(
  name: string,
  system: string,
  kind: ForeignTollFare['kind'],
): string {
  const trimmedName = name.trim()
  const trimmedSystem = system.trim()
  if (kind === 'tunnel' && trimmedSystem && trimmedSystem !== trimmedName) {
    return `${trimmedName} (${trimmedSystem})`
  }
  return trimmedName || trimmedSystem
}
