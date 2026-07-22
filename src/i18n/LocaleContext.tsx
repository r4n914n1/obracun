import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { resolveLocale, storeLocale } from './detectLocale'
import {
  countryLabel,
  interpolate,
  messages,
  type MessageKey,
} from './messages'
import type { Locale } from './types'

type TranslateFn = (
  key: MessageKey,
  vars?: Record<string, string | number>,
) => string

interface LocaleContextValue {
  locale: Locale
  ready: boolean
  setLocale: (locale: Locale) => void
  t: TranslateFn
  countryName: (code: string) => string
  numberLocale: string
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

function applyDocumentLang(locale: Locale): void {
  document.documentElement.lang = locale === 'sr' ? 'sr' : 'en'
  document.title = locale === 'sr' ? 'Obračun' : 'Transport Cost'
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('sr')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const resolved = await resolveLocale()
      if (cancelled) return
      setLocaleState(resolved)
      applyDocumentLang(resolved)
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    storeLocale(next)
    applyDocumentLang(next)
  }, [])

  const t = useCallback<TranslateFn>(
    (key, vars) => interpolate(messages[locale][key], vars),
    [locale],
  )

  const countryName = useCallback(
    (code: string) => countryLabel(code, (key) => messages[locale][key]),
    [locale],
  )

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      ready,
      setLocale,
      t,
      countryName,
      numberLocale: locale === 'sr' ? 'sr-RS' : 'en-US',
    }),
    [locale, ready, setLocale, t, countryName],
  )

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  )
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext)
  if (!ctx) {
    throw new Error('useLocale must be used within LocaleProvider')
  }
  return ctx
}
