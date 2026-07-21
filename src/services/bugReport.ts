const BUG_REPORT_EMAIL = 'r4n914n1@gmail.com'

const BUG_REPORT_SUBJECT = 'Obračun — prijava greške'
const BUG_REPORT_BODY = `Opis problema:


Koraci za reprodukciju:
1.
2.

Očekivano ponašanje:


Stvarno ponašanje:


Pregledač / uređaj:


Dodatne napomene:
`

/** Opens the user's mail client with a pre-filled bug report. */
export function openBugReportMail(): void {
  const url =
    `mailto:${BUG_REPORT_EMAIL}` +
    `?subject=${encodeURIComponent(BUG_REPORT_SUBJECT)}` +
    `&body=${encodeURIComponent(BUG_REPORT_BODY)}`
  window.location.href = url
}

export { BUG_REPORT_EMAIL }
