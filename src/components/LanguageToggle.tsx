import { useLocale } from '../i18n/LocaleContext'
import type { Locale } from '../i18n/types'

interface LanguageToggleProps {
  className?: string
}

export function LanguageToggle({ className = '' }: LanguageToggleProps) {
  const { locale, setLocale, t } = useLocale()

  function select(next: Locale) {
    if (next !== locale) setLocale(next)
  }

  return (
    <div
      className={`lang-toggle ${className}`.trim()}
      role="group"
      title={t('langSwitchTitle')}
      aria-label={t('langSwitchTitle')}
    >
      <button
        type="button"
        className={`lang-toggle-btn${locale === 'sr' ? ' is-active' : ''}`}
        aria-pressed={locale === 'sr'}
        onClick={() => select('sr')}
      >
        {t('langSr')}
      </button>
      <button
        type="button"
        className={`lang-toggle-btn${locale === 'en' ? ' is-active' : ''}`}
        aria-pressed={locale === 'en'}
        onClick={() => select('en')}
      >
        {t('langEn')}
      </button>
    </div>
  )
}
