import type { AdjustedForeignTolls, AdjustedFare } from '../services/tollDiscounts'
import type {
  DetectedTollStation,
  PaidTollLeg,
  TollEstimate,
} from '../services/tollEstimate'
import type { ForeignTollSummary, RouteLeg } from '../types'
import { distanceAlongPolyline, polylineLengthMeters } from '../services/geo'
import { routeLabelEn, rampsLabelEn } from '../services/stationNamesEn'
import { exportResultsPdf } from '../services/exportResultsPdf'
import { useLocale } from '../i18n/LocaleContext'
import type { MessageKey } from '../i18n/messages'
import { useState } from 'react'

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
      sequence: number
      leg: PaidTollLeg
      cardNumber: number
    }
  | {
      kind: 'foreign'
      progress: number
      sequence: number
      fare: AdjustedFare
    }

function stationMatchesName(
  station: DetectedTollStation,
  stationName: string,
): boolean {
  return (
    station.cenovnikName === stationName ||
    station.name === stationName ||
    station.name.endsWith(stationName) ||
    stationName.endsWith(station.name.replace(/^NS\s+/i, ''))
  )
}

/**
 * Place a Serbian ticket at the exit ramp (last station along the route leg).
 * Entry would put return tickets (Preševo→BG) before foreign corridor tolls on
 * the same long return section.
 */
function serbiaProgress(
  leg: PaidTollLeg,
  routeLeg: RouteLeg | undefined,
  detected: DetectedTollStation[],
  legOffset: number,
): number {
  const legLength = routeLeg ? polylineLengthMeters(routeLeg.coordinates) : 0
  const legEnd = legOffset + Math.max(legLength, 1)

  let bestAlong = -1
  for (const stationName of leg.stations) {
    for (const station of detected) {
      if (!stationMatchesName(station, stationName)) continue
      if (
        station.distanceAlongRoute < legOffset - 50 ||
        station.distanceAlongRoute > legEnd + 50
      ) {
        continue
      }
      if (station.distanceAlongRoute > bestAlong) {
        bestAlong = station.distanceAlongRoute
      }
    }
  }
  if (bestAlong >= 0) return bestAlong

  if (routeLeg && routeLeg.coordinates.length >= 2) {
    let bestProjected = -1
    for (const stationName of leg.stations) {
      const anyHit = detected.find((s) => stationMatchesName(s, stationName))
      if (!anyHit) continue
      const along =
        legOffset +
        distanceAlongPolyline(routeLeg.coordinates, [anyHit.lat, anyHit.lng])
      if (along > bestProjected) bestProjected = along
    }
    if (bestProjected >= 0) return bestProjected
    return legOffset
  }

  return legOffset
}

function foreignProgress(
  fare: AdjustedFare,
  routeLeg: RouteLeg | undefined,
  legOffset: number,
): number {
  if (fare.progressMeters != null && Number.isFinite(fare.progressMeters)) {
    return fare.progressMeters
  }
  if (fare.lat == null || fare.lng == null || !routeLeg) {
    return legOffset + 1
  }
  return (
    legOffset +
    distanceAlongPolyline(routeLeg.coordinates, [fare.lat, fare.lng])
  )
}

function buildChronologicalItems(
  routeLegs: RouteLeg[],
  paidLegs: PaidTollLeg[],
  foreignFares: AdjustedFare[],
  detected: DetectedTollStation[],
): ChronoItem[] {
  const legByLabel = new Map<string, { leg: RouteLeg; offset: number }>()
  let offset = 0
  for (const leg of routeLegs) {
    const label = routeLegLabelOf(leg)
    legByLabel.set(label, { leg, offset })
    offset += polylineLengthMeters(leg.coordinates)
  }

  const items: ChronoItem[] = []

  for (const leg of paidLegs) {
    const meta = leg.routeLegLabel ? legByLabel.get(leg.routeLegLabel) : undefined
    items.push({
      kind: 'serbia',
      progress: serbiaProgress(
        leg,
        meta?.leg,
        detected,
        meta?.offset ?? offset + items.length,
      ),
      sequence: 0,
      leg,
      cardNumber: 0,
    })
  }

  for (const fare of foreignFares) {
    const meta = fare.routeLegLabel ? legByLabel.get(fare.routeLegLabel) : undefined
    items.push({
      kind: 'foreign',
      progress: foreignProgress(
        fare,
        meta?.leg,
        meta?.offset ?? offset + 100000 + fare.sequence,
      ),
      sequence: fare.sequence,
      fare,
    })
  }

  items.sort((a, b) => {
    if (a.progress !== b.progress) return a.progress - b.progress
    return a.sequence - b.sequence
  })

  let serbiaCard = 0
  for (const item of items) {
    if (item.kind === 'serbia') {
      serbiaCard += 1
      item.cardNumber = serbiaCard
    }
  }

  return items
}

interface CountryCostRow {
  code: string
  tollEur: number
  liters: number | null
}

interface ResultPanelProps {
  grandTotal: number
  categoryCode: string
  distanceMeters: number
  durationSeconds: number
  liters: number
  fuelPrice: number
  fuelCost: number
  consumption: number
  serbiaTollEur: number
  foreignTollEur: number
  foreignDiscount: number
  foreignVatRemoved: number
  driverFee: number
  operatingCostPerKm: number
  operatingCost: number
  toll: TollEstimate
  adjustedForeign: AdjustedForeignTolls | null
  foreignTolls: ForeignTollSummary | null
  routeLegs: RouteLeg[]
  distanceByCountry: Record<string, number>
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
  consumption,
  serbiaTollEur,
  foreignTollEur,
  foreignDiscount,
  foreignVatRemoved,
  driverFee,
  operatingCostPerKm,
  operatingCost,
  toll,
  adjustedForeign,
  foreignTolls,
  routeLegs,
  distanceByCountry,
  exchangeRateLabel,
}: ResultPanelProps) {
  const { t, countryName, numberLocale } = useLocale()
  const [pdfError, setPdfError] = useState<string | null>(null)
  const tollTotal = serbiaTollEur + foreignTollEur

  function formatDuration(seconds: number): string {
    const totalMinutes = Math.round(seconds / 60)
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    if (hours === 0) return `${minutes} ${t('min')}`
    if (minutes === 0) return `${hours} ${t('hour')}`
    return `${hours} ${t('hour')} ${minutes} ${t('min')}`
  }

  const chronoItems = buildChronologicalItems(
    routeLegs,
    toll.paidLegs,
    adjustedForeign?.fares ?? [],
    toll.detectedStations,
  )
  const itemCount = chronoItems.length
  const categoryKey = CATEGORY_KEYS[categoryCode]
  const categoryLabel = categoryKey ? t(categoryKey) : toll.categoryLabel

  function nameOf(code: string): string {
    return countryName(code) !== code
      ? countryName(code)
      : (COUNTRY_FALLBACK[code] ?? code)
  }

  function litersForCountry(code: string): number | null {
    const meters = distanceByCountry[code]
    if (meters == null || meters <= 0 || !Number.isFinite(consumption)) return null
    return Math.round(((meters / 1000) * consumption) / 100 * 10) / 10
  }

  const countryRows: CountryCostRow[] = []
  if (serbiaTollEur > 0 || (distanceByCountry.SRB ?? 0) > 0) {
    countryRows.push({
      code: 'SRB',
      tollEur: serbiaTollEur,
      liters: litersForCountry('SRB'),
    })
  }
  for (const entry of adjustedForeign?.byCountry ?? []) {
    countryRows.push({
      code: entry.country,
      tollEur: entry.netEur,
      liters: litersForCountry(entry.country),
    })
  }
  // Countries with distance but no toll entry yet (rare).
  for (const [code, meters] of Object.entries(distanceByCountry)) {
    if (meters <= 0) continue
    if (countryRows.some((r) => r.code === code)) continue
    if (code === 'SRB') continue
    countryRows.push({ code, tollEur: 0, liters: litersForCountry(code) })
  }

  function handleExportPdf() {
    setPdfError(null)
    try {
      const summaryRows = [
        {
          label: t('fuelRow', {
            liters: liters.toFixed(1),
            price: fuelPrice,
          }),
          value: formatEur(fuelCost),
        },
        { label: t('tollTotal'), value: formatEur(tollTotal) },
      ]
      if (foreignDiscount > 0) {
        summaryRows.push({
          label: `↳ ${t('discount')}`,
          value: `−${formatEur(foreignDiscount)}`,
        })
      }
      if (foreignVatRemoved > 0) {
        summaryRows.push({
          label: `↳ ${t('vatDeducted')}`,
          value: `−${formatEur(foreignVatRemoved)}`,
        })
      }
      summaryRows.push(
        { label: t('driverFeeRow'), value: formatEur(driverFee) },
        {
          label: t('operatingRow', {
            distance: formatDistance(distanceMeters),
            rate: operatingCostPerKm,
          }),
          value: formatEur(operatingCost),
        },
      )

      const countryPdfRows = countryRows.map((row) => ({
        label: nameOf(row.code),
        value:
          row.liters != null
            ? t('countryTollFuel', {
                toll: formatEur(row.tollEur),
                liters: row.liters.toFixed(1),
              })
            : t('countryTollFuelNoDist', { toll: formatEur(row.tollEur) }),
      }))

      const chronoPdfItems = chronoItems.map((item) => {
        if (item.kind === 'serbia') {
          const details = [
            `${t('routeEn')} ${routeLabelEn(item.leg.from, item.leg.to)}`,
          ]
          if (item.leg.stations.length > 0) {
            details.push(`${t('ramps')} ${item.leg.stations.join(' → ')}`)
            details.push(`${t('rampsEn')} ${rampsLabelEn(item.leg.stations)}`)
          }
          return {
            tag:
              item.leg.kind === 'bypass'
                ? `SRB · ${t('bypass')}`
                : `SRB · ${t('cardN', { n: item.cardNumber })}`,
            price: formatEur(item.leg.eur),
            main: `${item.leg.from} → ${item.leg.to}`,
            details,
          }
        }
        const detailParts = [nameOf(item.fare.country)]
        if (item.fare.system && item.fare.system !== item.fare.name) {
          detailParts.push(item.fare.system)
        }
        if (item.fare.discountPercent > 0) {
          detailParts.push(t('discountPct', { pct: item.fare.discountPercent }))
        }
        if (item.fare.netEur !== item.fare.grossEur) {
          detailParts.push(
            t('hereGross', { amount: formatEur(item.fare.grossEur) }),
          )
        }
        return {
          tag: `${item.fare.country} · ${
            item.fare.kind === 'tunnel' ? t('tunnel') : t('toll')
          }`,
          price: formatEur(item.fare.netEur),
          main: item.fare.name,
          details: [detailParts.join(' · ')],
        }
      })

      const notes: string[] = [t('disclaimer'), t('formulaNote')]
      if (exchangeRateLabel) notes.push(exchangeRateLabel)
      if (toll.bypass.note) notes.push(toll.bypass.note)
      if (foreignTolls?.hasUnconverted) notes.push(t('unconverted'))

      exportResultsPdf({
        title: t('pdfReportTitle'),
        generatedLabel: t('pdfGenerated'),
        generatedAt: new Date().toLocaleString(numberLocale, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }),
        heroLabel: t('totalApprox'),
        grandTotal: formatEur(grandTotal),
        categoryLabel,
        distance: formatDistance(distanceMeters),
        duration: formatDuration(durationSeconds),
        routeLines: routeLegs.map((leg) => `${leg.fromLabel} → ${leg.toLabel}`),
        summaryTitle: t('costSummary'),
        summaryRows,
        countryTitle: countryRows.length > 0 ? t('tollByCountry') : null,
        countryRows: countryPdfRows,
        countryHint: countryRows.length > 0 ? t('countryFuelHint') : null,
        chronoTitle:
          itemCount > 0 ? t('tollChrono', { count: itemCount }) : null,
        chronoItems: chronoPdfItems,
        notesTitle: t('notesSummary'),
        notes,
      })
    } catch {
      setPdfError(t('exportPdfBlocked'))
    }
  }

  return (
    <div className="result-panel">
      <div className="result-toolbar">
        <button
          type="button"
          className="btn btn-secondary btn-sm result-export-pdf"
          title={t('exportPdfTitle')}
          onClick={handleExportPdf}
        >
          {t('exportPdf')}
        </button>
        {pdfError ? (
          <span className="result-export-error" role="alert">
            {pdfError}
          </span>
        ) : null}
      </div>
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

      {countryRows.length > 0 ? (
        <section className="result-block">
          <h3 className="result-block-title">{t('tollByCountry')}</h3>
          <div className="result-summary">
            {countryRows.map((row) => (
              <SummaryRow
                key={row.code}
                label={nameOf(row.code)}
                value={
                  row.liters != null
                    ? t('countryTollFuel', {
                        toll: formatEur(row.tollEur),
                        liters: row.liters.toFixed(1),
                      })
                    : t('countryTollFuelNoDist', {
                        toll: formatEur(row.tollEur),
                      })
                }
              />
            ))}
          </div>
          <p className="result-footnote">{t('countryFuelHint')}</p>
        </section>
      ) : null}

      {itemCount > 0 ? (
        <section className="result-block">
          <h3 className="result-block-title">
            {t('tollChrono', { count: itemCount })}
          </h3>
          <div className="result-card-list">
            {chronoItems.map((item, index) =>
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
                  <p className="result-card-detail">
                    {t('routeEn')} {routeLabelEn(item.leg.from, item.leg.to)}
                  </p>
                  {item.leg.stations.length > 0 ? (
                    <>
                      <p className="result-card-detail">
                        {t('ramps')} {item.leg.stations.join(' → ')}
                      </p>
                      <p className="result-card-detail">
                        {t('rampsEn')} {rampsLabelEn(item.leg.stations)}
                      </p>
                    </>
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
