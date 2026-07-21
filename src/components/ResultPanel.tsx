import type { AdjustedForeignTolls, AdjustedFare } from '../services/tollDiscounts'
import type {
  DetectedTollStation,
  PaidTollLeg,
  TollEstimate,
} from '../services/tollEstimate'
import type { ForeignTollSummary, RouteLeg } from '../types'
import { haversineMeters } from '../services/geo'
import { APP_DISCLAIMER } from '../data/disclaimer'

const COUNTRY_NAMES: Record<string, string> = {
  SRB: 'Srbija',
  HRV: 'Hrvatska',
  HUN: 'Mađarska',
  SVN: 'Slovenija',
  AUT: 'Austrija',
  DEU: 'Nemačka',
  ITA: 'Italija',
  BIH: 'BiH',
  MNE: 'Crna Gora',
  MKD: 'S. Makedonija',
  BGR: 'Bugarska',
  ROU: 'Rumunija',
  GRC: 'Grčka',
  CZE: 'Češka',
  SVK: 'Slovačka',
  POL: 'Poljska',
  CHE: 'Švajcarska',
  FRA: 'Francuska',
  TUR: 'Turska',
  ALB: 'Albanija',
  XKX: 'Kosovo',
}

function countryName(code: string): string {
  return COUNTRY_NAMES[code] ?? code
}

function formatEur(amount: number): string {
  return `${amount.toFixed(2)} €`
}

function formatDistance(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`
}

function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} min`
  if (minutes === 0) return `${hours} h`
  return `${hours} h ${minutes} min`
}

function routeLegLabelOf(leg: RouteLeg): string {
  return `${leg.fromLabel} → ${leg.toLabel}`
}

type ChronoItem =
  | {
      kind: 'serbia'
      progress: number
      leg: PaidTollLeg
      cardNumber: number
    }
  | {
      kind: 'foreign'
      progress: number
      fare: AdjustedFare
    }

interface ChronoGroup {
  legLabel: string
  items: ChronoItem[]
  totalEur: number
}

function distanceAlongPolyline(
  coordinates: [number, number][],
  point: [number, number],
): number {
  if (coordinates.length < 2) return 0
  let bestDist = Infinity
  let bestAlong = 0
  let along = 0
  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i - 1]
    const b = coordinates[i]
    const segLen = haversineMeters(a, b)
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const toMid = haversineMeters(point, mid)
    const toA = haversineMeters(point, a)
    const toB = haversineMeters(point, b)
    const d = Math.min(toMid, toA, toB)
    if (d < bestDist) {
      bestDist = d
      if (toA <= toB && toA <= toMid) bestAlong = along
      else if (toB <= toA && toB <= toMid) bestAlong = along + segLen
      else bestAlong = along + segLen / 2
    }
    along += segLen
  }
  return bestAlong
}

function serbiaProgress(
  leg: PaidTollLeg,
  routeLeg: RouteLeg | undefined,
  detected: DetectedTollStation[],
  legOffset: number,
): number {
  for (const stationName of leg.stations) {
    const hit = detected.find(
      (s) =>
        s.cenovnikName === stationName ||
        s.name === stationName ||
        s.name.endsWith(stationName) ||
        stationName.endsWith(s.name.replace(/^NS\s+/i, '')),
    )
    if (hit) return hit.distanceAlongRoute
  }
  if (routeLeg && routeLeg.coordinates.length >= 2) {
    // Fallback: start of this itinerary segment
    return legOffset
  }
  return legOffset
}

function foreignProgress(
  fare: AdjustedFare,
  routeLeg: RouteLeg | undefined,
  legOffset: number,
): number {
  if (fare.lat == null || fare.lng == null || !routeLeg) {
    return legOffset + 1
  }
  return (
    legOffset +
    distanceAlongPolyline(routeLeg.coordinates, [fare.lat, fare.lng])
  )
}

/** Build one continuous list: route legs in travel order, SRB + foreign interleaved. */
function buildChronologicalGroups(
  routeLegs: RouteLeg[],
  paidLegs: PaidTollLeg[],
  foreignFares: AdjustedFare[],
  detected: DetectedTollStation[],
): ChronoGroup[] {
  const legByLabel = new Map<string, { leg: RouteLeg; offset: number; index: number }>()
  let offset = 0
  for (let i = 0; i < routeLegs.length; i++) {
    const leg = routeLegs[i]
    const label = routeLegLabelOf(leg)
    legByLabel.set(label, { leg, offset, index: i })
    const length = leg.coordinates.reduce((sum, point, idx) => {
      if (idx === 0) return 0
      return sum + haversineMeters(leg.coordinates[idx - 1], point)
    }, 0)
    offset += length
  }

  let serbiaCard = 0
  const items: ChronoItem[] = []

  for (const leg of paidLegs) {
    serbiaCard += 1
    const meta = leg.routeLegLabel ? legByLabel.get(leg.routeLegLabel) : undefined
    items.push({
      kind: 'serbia',
      progress: serbiaProgress(
        leg,
        meta?.leg,
        detected,
        meta?.offset ?? offset + serbiaCard,
      ),
      leg,
      cardNumber: serbiaCard,
    })
  }

  let foreignSeq = 0
  for (const fare of foreignFares) {
    foreignSeq += 1
    const meta = fare.routeLegLabel ? legByLabel.get(fare.routeLegLabel) : undefined
    items.push({
      kind: 'foreign',
      progress: foreignProgress(
        fare,
        meta?.leg,
        meta?.offset ?? offset + 100000 + foreignSeq,
      ),
      fare,
    })
  }

  items.sort((a, b) => a.progress - b.progress)

  const byLabel = new Map<string, ChronoGroup>()
  const groupOrder: string[] = []

  for (const item of items) {
    const label =
      item.kind === 'serbia'
        ? item.leg.routeLegLabel ?? 'Nepoznat deo rute'
        : item.fare.routeLegLabel ?? 'Nepoznat deo rute'
    let group = byLabel.get(label)
    if (!group) {
      group = { legLabel: label, items: [], totalEur: 0 }
      byLabel.set(label, group)
      groupOrder.push(label)
    }
    group.items.push(item)
    group.totalEur += item.kind === 'serbia' ? item.leg.eur : item.fare.netEur
  }

  for (const group of byLabel.values()) {
    group.items.sort((a, b) => a.progress - b.progress)
    group.totalEur = Math.round(group.totalEur * 100) / 100
  }

  // Prefer route-leg order for headers; append leftovers.
  const ordered: ChronoGroup[] = []
  const used = new Set<string>()
  for (const leg of routeLegs) {
    const label = routeLegLabelOf(leg)
    const group = byLabel.get(label)
    if (group) {
      ordered.push(group)
      used.add(label)
    }
  }
  for (const label of groupOrder) {
    if (!used.has(label)) {
      const group = byLabel.get(label)
      if (group) ordered.push(group)
    }
  }

  return ordered
}

interface ResultPanelProps {
  grandTotal: number
  categoryLabel: string
  distanceMeters: number
  durationSeconds: number
  liters: number
  fuelPrice: number
  fuelCost: number
  serbiaTollEur: number
  foreignTollEur: number
  foreignDiscount: number
  foreignVatRemoved: number
  driverFee: number
  operatingCostPerKm: number
  operatingCost: number
  isTruck: boolean
  hasForeignTolls: boolean
  toll: TollEstimate
  adjustedForeign: AdjustedForeignTolls | null
  foreignTolls: ForeignTollSummary | null
  routeLegs: RouteLeg[]
  exchangeRateLabel: string | null
}

function SummaryRow({
  label,
  value,
  muted,
  accent,
}: {
  label: string
  value: string
  muted?: boolean
  accent?: 'save'
}) {
  return (
    <div
      className={`result-summary-row${muted ? ' is-muted' : ''}${accent === 'save' ? ' is-save' : ''}`}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export function ResultPanel({
  grandTotal,
  categoryLabel,
  distanceMeters,
  durationSeconds,
  liters,
  fuelPrice,
  fuelCost,
  serbiaTollEur,
  foreignTollEur,
  foreignDiscount,
  foreignVatRemoved,
  driverFee,
  operatingCostPerKm,
  operatingCost,
  isTruck,
  hasForeignTolls,
  toll,
  adjustedForeign,
  foreignTolls,
  routeLegs,
  exchangeRateLabel,
}: ResultPanelProps) {
  const tollTotal = serbiaTollEur + foreignTollEur
  const chronoGroups = buildChronologicalGroups(
    routeLegs,
    toll.paidLegs,
    adjustedForeign?.fares ?? [],
    toll.detectedStations,
  )
  const itemCount = chronoGroups.reduce((sum, g) => sum + g.items.length, 0)

  return (
    <div className="result-panel">
      <header className="result-hero">
        <p className="result-hero-label">Ukupno (okvirno)</p>
        <p className="result-hero-value">{formatEur(grandTotal)}</p>
        <p className="result-hero-sub">{categoryLabel}</p>
        <div className="result-trip-chips">
          <span className="result-chip">{formatDistance(distanceMeters)}</span>
          <span className="result-chip">{formatDuration(durationSeconds)}</span>
        </div>
      </header>

      <section className="result-block">
        <h3 className="result-block-title">Sažetak troškova</h3>
        <div className="result-summary">
          <SummaryRow
            label={`Gorivo · ${liters.toFixed(1)} L × ${fuelPrice} €`}
            value={formatEur(fuelCost)}
          />
          <SummaryRow label="Putarina ukupno" value={formatEur(tollTotal)} />
          <SummaryRow
            label="↳ Srbija"
            value={formatEur(serbiaTollEur)}
            muted
          />
          {hasForeignTolls ? (
            <SummaryRow
              label={`↳ Inostranstvo${isTruck ? ' (bez PDV)' : ''}`}
              value={formatEur(foreignTollEur)}
              muted
            />
          ) : null}
          {foreignDiscount > 0 ? (
            <SummaryRow
              label="↳ Popust"
              value={`−${formatEur(foreignDiscount)}`}
              muted
              accent="save"
            />
          ) : null}
          {foreignVatRemoved > 0 ? (
            <SummaryRow
              label="↳ PDV odbijen"
              value={`−${formatEur(foreignVatRemoved)}`}
              muted
              accent="save"
            />
          ) : null}
          <SummaryRow label="Naknada vozača" value={formatEur(driverFee)} />
          <SummaryRow
            label={`Operativni troškovi · ${formatDistance(distanceMeters)} × ${operatingCostPerKm} €`}
            value={formatEur(operatingCost)}
          />
        </div>
      </section>

      {serbiaTollEur > 0 || (adjustedForeign?.byCountry.length ?? 0) > 0 ? (
        <section className="result-block">
          <h3 className="result-block-title">Putarina po zemljama</h3>
          <div className="result-summary">
            {serbiaTollEur > 0 ? (
              <SummaryRow label="Srbija" value={formatEur(serbiaTollEur)} />
            ) : null}
            {adjustedForeign?.byCountry.map((entry) => (
              <SummaryRow
                key={`country-sum-${entry.country}`}
                label={`${countryName(entry.country)} (${entry.country})`}
                value={formatEur(entry.netEur)}
              />
            ))}
            <SummaryRow label="Putarina ukupno" value={formatEur(tollTotal)} />
          </div>
        </section>
      ) : null}

      {itemCount > 0 ? (
        <section className="result-block">
          <h3 className="result-block-title">
            Putarina · redosled vožnje ({itemCount})
          </h3>
          <div className="result-leg-groups">
            {chronoGroups.map((group) => (
              <div className="result-leg-group" key={group.legLabel}>
                <div className="result-leg-header">
                  <span>{group.legLabel}</span>
                  <strong>{formatEur(group.totalEur)}</strong>
                </div>
                <div className="result-card-list">
                  {group.items.map((item, index) =>
                    item.kind === 'serbia' ? (
                      <article
                        className="result-card"
                        key={`srb-${item.leg.from}-${item.leg.to}-${index}`}
                      >
                        <div className="result-card-top">
                          <span className="result-card-tag">
                            SRB ·{' '}
                            {item.leg.kind === 'bypass'
                              ? 'Obilaznica'
                              : `Kartica ${item.cardNumber}`}
                          </span>
                          <strong className="result-card-price">
                            {formatEur(item.leg.eur)}
                          </strong>
                        </div>
                        <p className="result-card-main">
                          {item.leg.from} → {item.leg.to}
                        </p>
                        {item.leg.stations.length > 0 ? (
                          <p className="result-card-detail">
                            Rampe: {item.leg.stations.join(' → ')}
                          </p>
                        ) : null}
                      </article>
                    ) : (
                      <article
                        className="result-card"
                        key={`ino-${item.fare.country}-${item.fare.name}-${index}`}
                      >
                        <div className="result-card-top">
                          <span className="result-card-tag">
                            {item.fare.country} ·{' '}
                            {item.fare.kind === 'tunnel' ? 'Tunel' : 'Putarina'}
                          </span>
                          <strong className="result-card-price">
                            {formatEur(item.fare.netEur)}
                          </strong>
                        </div>
                        <p className="result-card-main">{item.fare.name}</p>
                        <p className="result-card-detail">
                          {countryName(item.fare.country)}
                          {item.fare.system && item.fare.system !== item.fare.name
                            ? ` · ${item.fare.system}`
                            : ''}
                          {item.fare.discountPercent > 0
                            ? ` · popust −${item.fare.discountPercent}%`
                            : ''}
                          {item.fare.netEur !== item.fare.grossEur
                            ? ` · HERE ${formatEur(item.fare.grossEur)}`
                            : ''}
                        </p>
                      </article>
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>
          {foreignTolls?.hasUnconverted ? (
            <p className="result-footnote">
              Neke stavke HERE nije mogao da preračuna u EUR.
            </p>
          ) : null}
        </section>
      ) : (
        <div className="status status-ok result-empty">
          Nema putarine na ovoj trasi.
        </div>
      )}

      <details className="result-notes">
        <summary>Napomene i sve rampe</summary>
        <div className="result-notes-body">
          <p className="result-disclaimer">{APP_DISCLAIMER}</p>
          <p>
            Formula: litri × cena goriva + putarina (SRB + inostranstvo) + naknada
            + operativni (km × €/km). Stavke su poređane kako ide vozilo (A → stopovi →
            B). Svaki izlazak sa autoputa i povratak = nova kartica.
          </p>
          {exchangeRateLabel ? <p>{exchangeRateLabel}</p> : null}
          {toll.bypass.note ? <p>{toll.bypass.note}</p> : null}
          {toll.detectedStations.length > 0 ? (
            <>
              <p className="result-notes-label">
                Detektovane rampe na ruti ({toll.detectedStations.length})
              </p>
              <ul className="result-ramp-list">
                {toll.detectedStations.map((station, index) => (
                  <li
                    key={`${station.kind}-${station.name}-${station.passageIndex}-${index}`}
                  >
                    {station.name}
                    {station.kind === 'bypass' ? ' · obilaznica' : ''}
                    {station.passageIndex > 0 ? ' · ponovo' : ''}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </details>
    </div>
  )
}
