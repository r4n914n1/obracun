/** Parse vehicle movement report CSV and pick A / stops / B from long pauses. */

import { MAX_INTERMEDIATE_STOPS } from '../types'

export const MIN_PAUSE_MINUTES = 30
export { MAX_INTERMEDIATE_STOPS }

export interface MovementRow {
  time: string
  location: string
  pauseMinutes: number
  rowIndex: number
}

export interface MovementWaypoints {
  originLabel: string
  stopLabels: string[]
  destinationLabel: string
  /** How many significant pauses were found before capping */
  significantPauseCount: number
  usedFallback: boolean
}

function detectDelimiter(sample: string): ',' | ';' {
  const firstLines = sample.split(/\r?\n/).slice(0, 15).join('\n')
  const semis = (firstLines.match(/;/g) ?? []).length
  const commas = (firstLines.match(/,/g) ?? []).length
  return semis >= commas ? ';' : ','
}

/** Split one CSV line respecting quoted fields. */
function splitCsvLine(line: string, delimiter: ',' | ';'): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (ch === delimiter && !inQuotes) {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  cells.push(current.trim())
  return cells
}

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, '')
}

function normalizeHeader(cell: string): string {
  return cell
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function looksLikeTime(value: string): boolean {
  // DD.MM.YY HH:MM:SS or similar
  return /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\s+\d{1,2}:\d{2}/.test(value.trim())
}

function parseNumberCell(value: string): number {
  const cleaned = value.replace(/\s/g, '').replace(',', '.')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

interface ColumnMap {
  time: number
  location: number
  hours: number
  minutes: number
  seconds: number
}

function findHeaderRow(rows: string[][]): { index: number; map: ColumnMap } | null {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const headers = rows[i].map(normalizeHeader)
    const timeIdx = headers.findIndex(
      (h) => h === 'time' || h === 'vreme' || h === 'datum' || h.includes('time'),
    )
    const locationIdx = headers.findIndex(
      (h) =>
        h === 'location' ||
        h === 'lokacija' ||
        h === 'adresa' ||
        h.includes('location') ||
        h.includes('lokacij'),
    )
    if (timeIdx < 0 || locationIdx < 0) continue

    // First Hours / Minutes / Seconds trio after location = pause duration
    let hours = -1
    let minutes = -1
    let seconds = -1
    for (let c = locationIdx + 1; c < headers.length; c++) {
      const h = headers[c]
      if (hours < 0 && (h === 'hours' || h === 'sati' || h === 'h')) {
        hours = c
        continue
      }
      if (hours >= 0 && minutes < 0 && (h === 'minutes' || h === 'minuti' || h === 'min')) {
        minutes = c
        continue
      }
      if (
        hours >= 0 &&
        minutes >= 0 &&
        seconds < 0 &&
        (h === 'seconds' || h === 'sekunde' || h === 'sec' || h === 's')
      ) {
        seconds = c
        break
      }
    }

    // If headers are ambiguous (two "Hours" groups), positional fallback:
    // after Location often: empty?, km, Hours, Minutes, Seconds
    if (hours < 0 || minutes < 0 || seconds < 0) {
      const start = Math.max(locationIdx + 1, 0)
      for (let c = start; c < headers.length - 2; c++) {
        const a = headers[c]
        const b = headers[c + 1]
        const d = headers[c + 2]
        const isH = a === 'hours' || a === 'sati' || a === 'h' || a === ''
        const isM = b === 'minutes' || b === 'minuti' || b === 'min'
        const isS = d === 'seconds' || d === 'sekunde' || d === 'sec' || d === 's'
        if ((a === 'hours' || a === 'sati') && isM && isS) {
          hours = c
          minutes = c + 1
          seconds = c + 2
          break
        }
        void isH
      }
    }

    return {
      index: i,
      map: {
        time: timeIdx,
        location: locationIdx,
        hours,
        minutes,
        seconds,
      },
    }
  }
  return null
}

function pauseMinutesFromRow(cells: string[], map: ColumnMap): number {
  if (map.hours < 0 || map.minutes < 0 || map.seconds < 0) return 0
  const h = parseNumberCell(cells[map.hours] ?? '')
  const m = parseNumberCell(cells[map.minutes] ?? '')
  const s = parseNumberCell(cells[map.seconds] ?? '')
  return h * 60 + m + s / 60
}

function normalizeLocationKey(location: string): string {
  return location
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function dedupeConsecutive(rows: MovementRow[]): MovementRow[] {
  const out: MovementRow[] = []
  for (const row of rows) {
    const prev = out[out.length - 1]
    if (prev && normalizeLocationKey(prev.location) === normalizeLocationKey(row.location)) {
      // Keep the longer pause at same place
      if (row.pauseMinutes > prev.pauseMinutes) {
        out[out.length - 1] = row
      }
      continue
    }
    out.push(row)
  }
  return out
}

/**
 * From significant pauses (or fallback first/last), build origin / stops / destination labels.
 * Intermediate stops capped at MAX_INTERMEDIATE_STOPS (longest pauses kept).
 */
export function selectWaypoints(rows: MovementRow[]): MovementWaypoints {
  if (rows.length === 0) {
    throw new Error('CSV nema lokacija za rutu')
  }

  let significant = rows.filter((r) => r.pauseMinutes >= MIN_PAUSE_MINUTES)
  let usedFallback = false

  if (significant.length === 0) {
    usedFallback = true
    significant = [rows[0], rows[rows.length - 1]]
  } else if (significant.length === 1) {
    // One long pause only — still need A and B
    usedFallback = true
    const only = significant[0]
    if (normalizeLocationKey(rows[0].location) !== normalizeLocationKey(only.location)) {
      significant = [rows[0], only]
    }
    if (
      normalizeLocationKey(rows[rows.length - 1].location) !==
      normalizeLocationKey(significant[significant.length - 1].location)
    ) {
      significant = [...significant, rows[rows.length - 1]]
    }
  }

  significant = dedupeConsecutive(significant)
  const significantPauseCount = significant.length

  if (significant.length === 1) {
    return {
      originLabel: significant[0].location,
      stopLabels: [],
      destinationLabel: significant[0].location,
      significantPauseCount,
      usedFallback,
    }
  }

  const origin = significant[0]
  const destination = significant[significant.length - 1]
  let middle = significant.slice(1, -1)

  if (middle.length > MAX_INTERMEDIATE_STOPS) {
    middle = [...middle]
      .sort((a, b) => b.pauseMinutes - a.pauseMinutes)
      .slice(0, MAX_INTERMEDIATE_STOPS)
      .sort((a, b) => a.rowIndex - b.rowIndex)
  }

  return {
    originLabel: origin.location,
    stopLabels: middle.map((r) => r.location),
    destinationLabel: destination.location,
    significantPauseCount,
    usedFallback,
  }
}

/** Parse full CSV text into movement rows (all locations with pause duration). */
export function parseMovementReportCsv(text: string): MovementRow[] {
  const raw = stripBom(text)
  if (!raw.trim()) {
    throw new Error('CSV fajl je prazan')
  }

  const delimiter = detectDelimiter(raw)
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0)
  const table = lines.map((line) => splitCsvLine(line, delimiter))

  const header = findHeaderRow(table)
  let startRow: number
  let map: ColumnMap

  if (header) {
    startRow = header.index + 1
    map = header.map
  } else {
    // Heuristic: first row that looks like time + location
    let found = -1
    for (let i = 0; i < table.length; i++) {
      if (looksLikeTime(table[i][0] ?? '') && (table[i][1] ?? '').length > 5) {
        found = i
        break
      }
    }
    if (found < 0) {
      throw new Error(
        'Nisam našao tabelu (Time / Location). Proveri da je ovo izveštaj kretanja.',
      )
    }
    startRow = found
    map = { time: 0, location: 1, hours: 4, minutes: 5, seconds: 6 }
    // Try to detect Hours/Minutes/Seconds by scanning first data-like rows
    for (let c = 2; c < (table[found]?.length ?? 0) - 2; c++) {
      const sample = table.slice(found, Math.min(found + 5, table.length))
      const looksDuration = sample.every((row) => {
        const a = row[c] ?? ''
        const b = row[c + 1] ?? ''
        const d = row[c + 2] ?? ''
        return (
          (a === '' || !Number.isNaN(Number(a.replace(',', '.')))) &&
          (b === '' || !Number.isNaN(Number(b.replace(',', '.')))) &&
          (d === '' || !Number.isNaN(Number(d.replace(',', '.'))))
        )
      })
      if (looksDuration && c >= 3) {
        map = { time: 0, location: 1, hours: c, minutes: c + 1, seconds: c + 2 }
        break
      }
    }
  }

  const rows: MovementRow[] = []
  for (let i = startRow; i < table.length; i++) {
    const cells = table[i]
    const time = cells[map.time] ?? ''
    const location = cells[map.location] ?? ''
    if (!location || location.length < 3) continue
    // Skip summary footer rows
    const locNorm = normalizeHeader(location)
    if (
      locNorm.includes('total') ||
      locNorm.includes('pauze') ||
      locNorm.includes('avg') ||
      locNorm.startsWith('driver')
    ) {
      continue
    }
    if (!looksLikeTime(time) && i > startRow + 2) {
      // Likely footer once times stop
      if (!looksLikeTime(time)) continue
    }
    if (!looksLikeTime(time)) continue

    rows.push({
      time: time.trim(),
      location: location.trim(),
      pauseMinutes: pauseMinutesFromRow(cells, map),
      rowIndex: i,
    })
  }

  if (rows.length === 0) {
    throw new Error('Nema redova sa lokacijom u CSV fajlu')
  }

  return rows
}

export function buildWaypointsFromCsv(text: string): MovementWaypoints {
  const rows = parseMovementReportCsv(text)
  return selectWaypoints(rows)
}
