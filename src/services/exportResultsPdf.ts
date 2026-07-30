/** Escape text for safe insertion into print HTML. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface PdfSummaryRow {
  label: string
  value: string
}

export interface PdfChronoItem {
  tag: string
  price: string
  main: string
  details: string[]
}

export interface ResultsPdfPayload {
  title: string
  generatedLabel: string
  generatedAt: string
  heroLabel: string
  grandTotal: string
  categoryLabel: string
  distance: string
  duration: string
  routeLines: string[]
  summaryTitle: string
  summaryRows: PdfSummaryRow[]
  countryTitle: string | null
  countryRows: PdfSummaryRow[]
  countryHint: string | null
  chronoTitle: string | null
  chronoItems: PdfChronoItem[]
  notesTitle: string
  notes: string[]
}

/**
 * Opens an A4 print document with all results and triggers the browser print dialog
 * (user can choose “Save as PDF”).
 */
export function exportResultsPdf(payload: ResultsPdfPayload): void {
  const summaryHtml = payload.summaryRows
    .map(
      (row) =>
        `<div class="row"><span>${esc(row.label)}</span><strong>${esc(row.value)}</strong></div>`,
    )
    .join('')

  const countryHtml =
    payload.countryTitle && payload.countryRows.length > 0
      ? `<section>
          <h2>${esc(payload.countryTitle)}</h2>
          ${payload.countryRows
            .map(
              (row) =>
                `<div class="row"><span>${esc(row.label)}</span><strong>${esc(row.value)}</strong></div>`,
            )
            .join('')}
          ${payload.countryHint ? `<p class="hint">${esc(payload.countryHint)}</p>` : ''}
        </section>`
      : ''

  const chronoHtml =
    payload.chronoTitle && payload.chronoItems.length > 0
      ? `<section class="chrono">
          <h2>${esc(payload.chronoTitle)}</h2>
          <div class="toll-list">
          ${payload.chronoItems
            .map(
              (item) => `<article class="toll-row">
                <div class="toll-top">
                  <span class="toll-tag">${esc(item.tag)}</span>
                  <strong class="toll-price">${esc(item.price)}</strong>
                </div>
                <p class="toll-main">${esc(item.main)}</p>
                ${item.details.map((d) => `<p class="toll-detail">${esc(d)}</p>`).join('')}
              </article>`,
            )
            .join('')}
          </div>
        </section>`
      : ''

  const routeHtml =
    payload.routeLines.length > 0
      ? `<p class="route">${payload.routeLines.map(esc).join('<br/>')}</p>`
      : ''

  const notesHtml =
    payload.notes.length > 0
      ? `<section class="notes">
          <h2>${esc(payload.notesTitle)}</h2>
          ${payload.notes.map((n) => `<p>${esc(n)}</p>`).join('')}
        </section>`
      : ''

  const html = `<!DOCTYPE html>
<html lang="sr">
<head>
  <meta charset="utf-8" />
  <title>${esc(payload.title)}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      font-size: 10.5pt;
      line-height: 1.4;
      color: #14213d;
    }
    h1 {
      margin: 0 0 0.2rem;
      font-size: 16pt;
      letter-spacing: -0.02em;
    }
    .meta { margin: 0 0 0.85rem; color: #64748b; font-size: 9pt; }
    .hero {
      border: 1px solid #cfe8da;
      background: #f4fbf7;
      border-radius: 8px;
      padding: 0.75rem 0.9rem;
      margin-bottom: 0.9rem;
    }
    .hero-label { margin: 0; color: #047857; font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
    .hero-value { margin: 0.15rem 0; font-size: 22pt; font-weight: 800; color: #0f2744; }
    .hero-sub { margin: 0; color: #475569; }
    .chips { margin-top: 0.35rem; color: #334155; font-size: 9.5pt; }
    .route { margin: 0.35rem 0 0; color: #334155; font-size: 9.5pt; }
    section { margin-bottom: 0.85rem; }
    section.hero-block { break-inside: avoid; }
    h2 {
      margin: 0 0 0.4rem;
      font-size: 11pt;
      color: #0f2744;
      border-bottom: 1px solid #dbe3ee;
      padding-bottom: 0.2rem;
    }
    .row {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.18rem 0;
      border-bottom: 1px dotted #e2e8f0;
    }
    .row strong { white-space: nowrap; }
    .hint { margin: 0.35rem 0 0; color: #64748b; font-size: 8.5pt; }
    .chrono h2 { font-size: 10pt; margin-bottom: 0.3rem; }
    .toll-list {
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      overflow: hidden;
    }
    .toll-row {
      padding: 0.28rem 0.4rem;
      border-bottom: 1px solid #eef2f7;
      break-inside: avoid;
      font-size: 7.5pt;
      line-height: 1.3;
    }
    .toll-row:last-child { border-bottom: 0; }
    .toll-top {
      display: flex;
      justify-content: space-between;
      gap: 0.5rem;
      align-items: baseline;
    }
    .toll-tag { color: #475569; font-weight: 650; font-size: 7pt; }
    .toll-price { font-size: 7.5pt; white-space: nowrap; }
    .toll-main { margin: 0.08rem 0 0; font-weight: 650; font-size: 7.5pt; }
    .toll-detail { margin: 0.05rem 0 0; color: #64748b; font-size: 6.5pt; }
    .notes p { margin: 0.25rem 0; color: #475569; font-size: 8.5pt; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <h1>${esc(payload.title)}</h1>
  <p class="meta">${esc(payload.generatedLabel)}: ${esc(payload.generatedAt)}</p>
  <div class="hero">
    <p class="hero-label">${esc(payload.heroLabel)}</p>
    <p class="hero-value">${esc(payload.grandTotal)}</p>
    <p class="hero-sub">${esc(payload.categoryLabel)}</p>
    <p class="chips">${esc(payload.distance)} · ${esc(payload.duration)}</p>
    ${routeHtml}
  </div>
  <section>
    <h2>${esc(payload.summaryTitle)}</h2>
    ${summaryHtml}
  </section>
  ${countryHtml}
  ${chronoHtml}
  ${notesHtml}
</body>
</html>`

  const win = window.open('', '_blank')
  if (!win) {
    throw new Error('POPUP_BLOCKED')
  }
  win.document.open()
  win.document.write(html)
  win.document.close()
  win.focus()
  // Wait for layout before print so A4 pagination is correct.
  win.onafterprint = () => {
    win.close()
  }
  setTimeout(() => {
    try {
      win.print()
    } catch {
      // User can still print manually from the opened tab.
    }
  }, 250)
}
