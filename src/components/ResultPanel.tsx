import type { AdjustedForeignTolls, AdjustedFare } from '../services/tollDiscounts'
import type {
  DetectedTollStation,
  PaidTollLeg,
  TollEstimate,
} from '../services/tollEstimate'
import type { ForeignTollSummary, RouteLeg } from '../types'
import { haversineMeters } from '../services/geo'
import { useLocale } from '../i18n/LocaleContext'
import type { MessageKey } from '../i18n/messages'

const COUNTRY_FALLBACK: Record<string, string> = {
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

function formatEur(amount: number): string {
  return `${amount.toFixed(2)} €`
}

function formatDistance(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`
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

function buildChronologicalGroups(
  routeLegs: RouteLeg[],
  paidLegs: PaidTollLeg[],
  foreignFares: AdjustedFare[],
  detected: DetectedTollStation[],
  unknownLegLabel: string,
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
        ? item.leg.routeLegLabel ?? unknownLegLabel
        : item.fare.routeLegLabel ?? unknownLegLabel
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
  categoryCode: string
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

const CATEGORY_KEYS: Record<string, MessageKey> = {
  '1': 'cat1',
  '2': 'cat2',
  '3': 'cat3',
  '4': 'cat4',
}

export function ResultPanel({
  grandTotal,
  categoryCode,
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
  const { t, countryName } = useLocale()
  const tollTotal = serbiaTollEur + foreignTollEur

  function formatDuration(seconds: number): string {
    const totalMinutes = Math.round(seconds / 60)
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    if (hours === 0) return `${minutes} ${t('min')}`
    if (minutes === 0) return `${hours} ${t('hour')}`
    return `${hours} ${t('hour')} ${minutes} ${t('min')}`
  }

  const chronoGroups = buildChronologicalGroups(
    routeLegs,
    toll.paidLegs,
    adjustedForeign?.fares ?? [],
    toll.detectedStations,
    t('unknownLeg'),
  )
  const itemCount = chronoGroups.reduce((sum, g) => sum + g.items.length, 0)
  const categoryKey = CATEGORY_KEYS[categoryCode]
  const categoryLabel = categoryKey ? t(categoryKey) : toll.categoryLabel

  function nameOf(code: string): string {
    return countryName(code) !== code
      ? countryName(code)
      : (COUNTRY_FALLBACK[code] ?? code)
  }

  return (
    <div className="result-panel">
      <header className="result-hero">
        <p className="result-hero-label">{t('totalApprox')}</p>
        <p className="result-hero-value">{formatEur(grandTotal)}</p>
        <p className="result-hero-sub">{categoryLabel}</p>
        <div className="result-trip-chips">
          <span className="result-chip">{formatDistance(distanceMeters)}</span>
          <span className="result-chip">{formatDuration(durationSeconds)}</span>
        </div>
      </header>

      <section className="result-block">
        <h3 className="result-block-title">{t('costSummary')}</h3>
        <div className="result-summary">
          <SummaryRow
            label={t('fuelRow', {
              liters: liters.toFixed(1),
              price: fuelPrice,
            })}
            value={formatEur(fuelCost)}
          />
          <SummaryRow label={t('tollTotal')} value={formatEur(tollTotal)} />
          <SummaryRow
            label={`↳ ${t('serbia')}`}
            value={formatEur(serbiaTollEur)}
            muted
          />
          {hasForeignTolls ? (
            <SummaryRow
              label={`↳ ${isTruck ? t('abroadNoVat') : t('abroad')}`}
              value={formatEur(foreignTollEur)}
              muted
            />
          ) : null}
          {foreignDiscount > 0 ? (
            <SummaryRow
              label={`↳ ${t('discount')}`}
              value={`−${formatEur(foreignDiscount)}`}
              muted
              accent="save"
            />
          ) : null}
          {foreignVatRemoved > 0 ? (
            <SummaryRow
              label={`↳ ${t('vatDeducted')}`}
              value={`−${formatEur(foreignVatRemoved)}`}
              muted
              accent="save"
            />
          ) : null}
          <SummaryRow label={t('driverFeeRow')} value={formatEur(driverFee)} />
          <SummaryRow
            label={t('operatingRow', {
              distance: formatDistance(distanceMeters),
              rate: operatingCostPerKm,
            })}
            value={formatEur(operatingCost)}
          />
        </div>
      </section>

      {serbiaTollEur > 0 || (adjustedForeign?.byCountry.length ?? 0) > 0 ? (
        <section className="result-block">
          <h3 className="result-block-title">{t('tollByCountry')}</h3>
          <div className="result-summary">
            {serbiaTollEur > 0 ? (
              <SummaryRow label={t('serbia')} value={formatEur(serbiaTollEur)} />
            ) : null}
            {adjustedForeign?.byCountry.map((entry) => (
              <SummaryRow
                key={`country-sum-${entry.country}`}
                label={`${nameOf(entry.country)} (${entry.country})`}
                value={formatEur(entry.netEur)}
              />
            ))}
            <SummaryRow label={t('tollTotal')} value={formatEur(tollTotal)} />
          </div>
        </section>
      ) : null}

      {itemCount > 0 ? (
        <section className="result-block">
          <h3 className="result-block-title">
            {t('tollChrono', { count: itemCount })}
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
                              ? t('bypass')
                              : t('cardN', { n: item.cardNumber })}
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
                            {t('ramps')} {item.leg.stations.join(' → ')}
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
                            {item.fare.kind === 'tunnel' ? t('tunnel') : t('toll')}
                          </span>
                          <strong className="result-card-price">
                            {formatEur(item.fare.netEur)}
                          </strong>
                        </div>
                        <p className="result-card-main">{item.fare.name}</p>
                        <p className="result-card-detail">
                          {nameOf(item.fare.country)}
                          {item.fare.system && item.fare.system !== item.fare.name
                            ? ` · ${item.fare.system}`
                            : ''}
                          {item.fare.discountPercent > 0
                            ? ` · ${t('discountPct', { pct: item.fare.discountPercent })}`
                            : ''}
                          {item.fare.netEur !== item.fare.grossEur
                            ? ` · ${t('hereGross', { amount: formatEur(item.fare.grossEur) })}`
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
            <p className="result-footnote">{t('unconverted')}</p>
          ) : null}
        </section>
      ) : (
        <div className="status status-ok result-empty">{t('noToll')}</div>
      )}

      <details className="result-notes">
        <summary>{t('notesSummary')}</summary>
        <div className="result-notes-body">
          <p className="result-disclaimer">{t('disclaimer')}</p>
          <p>{t('formulaNote')}</p>
          {exchangeRateLabel ? <p>{exchangeRateLabel}</p> : null}
          {toll.bypass.note ? <p>{toll.bypass.note}</p> : null}
          {toll.detectedStations.length > 0 ? (
            <>
              <p className="result-notes-label">
                {t('detectedRamps', { count: toll.detectedStations.length })}
              </p>
              <ul className="result-ramp-list">
                {toll.detectedStations.map((station, index) => (
                  <li
                    key={`${station.kind}-${station.name}-${station.passageIndex}-${index}`}
                  >
                    {station.name}
                    {station.kind === 'bypass' ? ` · ${t('bypassTag')}` : ''}
                    {station.passageIndex > 0 ? ` · ${t('againTag')}` : ''}
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
