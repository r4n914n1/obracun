import type { Locale } from './types'
import { LOCALE_STORAGE_KEY } from './types'

function browserSuggestsSerbia(): boolean {
  const lang = (navigator.language || '').toLowerCase()
  if (lang.startsWith('sr') || lang.includes('-rs') || lang.endsWith('_rs')) {
    return true
  }
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (zone === 'Europe/Belgrade') return true
  } catch {
    // ignore
  }
  return false
}

/** Detect country via IP; Serbia → sr, otherwise en. */
async function detectCountryIsSerbia(): Promise<boolean | null> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 2500)
  try {
    const response = await fetch('https://ipapi.co/country_code/', {
      signal: controller.signal,
    })
    if (!response.ok) return null
    const code = (await response.text()).trim().toUpperCase()
    if (code === 'RS') return true
    if (/^[A-Z]{2}$/.test(code)) return false
    return null
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

export function readStoredLocale(): Locale | null {
  try {
    const value = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (value === 'sr' || value === 'en') return value
  } catch {
    // ignore
  }
  return null
}

export function storeLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // ignore
  }
}

/**
 * Resolve UI locale: stored override → IP country (RS=sr) → browser/timezone fallback.
 */
export async function resolveLocale(): Promise<Locale> {
  const stored = readStoredLocale()
  if (stored) return stored

  const fromIp = await detectCountryIsSerbia()
  if (fromIp === true) return 'sr'
  if (fromIp === false) return 'en'

  return browserSuggestsSerbia() ? 'sr' : 'en'
}
