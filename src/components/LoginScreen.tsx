import { useLocale } from '../i18n/LocaleContext'
import { LanguageToggle } from './LanguageToggle'
import { loginWithGoogle } from '../services/auth'
import { isFirebaseConfigured } from '../services/firebase'
import { useState } from 'react'

interface LoginScreenProps {
  onSuccess: () => void
  onOpenPricing?: () => void
}

export function LoginScreen({ onSuccess, onOpenPricing }: LoginScreenProps) {
  const { t } = useLocale()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const firebaseReady = isFirebaseConfigured()

  async function handleGoogle() {
    setError(null)
    setBusy(true)
    try {
      await loginWithGoogle()
      onSuccess()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('loginErrGoogle'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-top-row">
          <span className="login-lang-spacer" aria-hidden="true" />
          <LanguageToggle />
        </div>

        <h1 className="login-brand">{t('brand')}</h1>
        <p className="login-tagline">{t('brandTagline')}</p>
        <p className="login-sub">{t('loginSub')}</p>

        <button
          type="button"
          className="btn btn-primary btn-xl"
          disabled={busy || !firebaseReady}
          onClick={() => {
            void handleGoogle()
          }}
        >
          {busy ? t('loginGoogleBusy') : t('loginGoogle')}
        </button>

        {error ? (
          <p className="login-error" role="alert">
            {error}
          </p>
        ) : null}

        {onOpenPricing ? (
          <button
            type="button"
            className="btn btn-secondary login-pricing-link"
            onClick={onOpenPricing}
            disabled={busy}
          >
            {t('loginPricing')}
          </button>
        ) : null}

        <p className="login-disclaimer">{t('disclaimer')}</p>
      </div>
    </div>
  )
}
