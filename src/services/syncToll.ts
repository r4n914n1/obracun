export interface SyncTollResult {
  ok: boolean
  syncedAt?: string
  error?: string
  stations?: {
    before: number
    after: number
    added: string[]
    removed: string[]
  }
  prices?: {
    beforeAt: string | null
    afterAt: string | null
    highwayStations: number | null
    bypassStations: number | null
  }
}

export async function requestTollSync(): Promise<SyncTollResult> {
  const response = await fetch('/api/sync-toll', { method: 'POST' })
  const data = (await response.json()) as SyncTollResult

  if (!response.ok || !data.ok) {
    throw new Error(data.error ?? `SYNC nije uspeo (HTTP ${response.status})`)
  }

  return data
}

export function latestIso(...values: Array<string | null | undefined>): string | null {
  const list = values.filter((value): value is string => Boolean(value))
  if (list.length === 0) return null
  return list.sort()[list.length - 1]
}

export function formatSyncTime(iso: string | null | undefined): string {
  if (!iso) return 'nema podataka'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('sr-RS', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatSyncSummary(result: SyncTollResult): string {
  const parts: string[] = []
  if (result.stations) {
    parts.push(`Stanice: ${result.stations.after}`)
    if (result.stations.added.length > 0) {
      parts.push(`+${result.stations.added.length} nove`)
    }
    if (result.stations.removed.length > 0) {
      parts.push(`−${result.stations.removed.length} uklonjene`)
    }
  }
  if (result.prices?.highwayStations != null) {
    parts.push(`Cenovnik NS: ${result.prices.highwayStations}`)
  }
  if (result.prices?.bypassStations != null) {
    parts.push(`Obilaznica: ${result.prices.bypassStations}`)
  }
  return parts.join(' · ') || 'Podaci osveženi'
}
