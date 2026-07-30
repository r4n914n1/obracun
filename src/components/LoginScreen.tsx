import { useLocale } from '../i18n/LocaleContext'
import { LanguageToggle } from './LanguageToggle'
import { AdUnit } from './AdUnit'
import { loginWithGoogle } from '../services/auth'
import { isFirebaseConfigured } from '../services/firebase'
import { useState } from 'react'

interface LoginScreenProps {
  onSuccess: () => void
  onOpenPricing?: () => void
  embedded?: boolean
  onClose?: () => void
}

export function LoginScreen({
  onSuccess,
  onOpenPricing,
  embedded = false,
  onClose,
}: LoginScreenProps) {
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

  const content = (
    <>
      {embedded && onClose ? (
        <button
          type="button"
          className="login-modal-close"
          onClick={onClose}
          aria-label={t('dialogBack')}
        >
          ×
        </button>
      ) : null}

      <img
        className={`login-logo${embedded ? ' login-logo-compact' : ''}`}
        src="/logo.png"
        alt={t('brand')}
        width={181}
        height={173}
        decoding="async"
        fetchPriority={embedded ? 'auto' : 'high'}
      />
      <p className="login-eyebrow">{t('loginEyebrow')}</p>
      <h1 className={embedded ? 'login-brand login-brand-modal' : 'login-brand'}>
        {embedded ? t('loginTitle') : t('brand')}
      </h1>
      {!embedded ? <p className="login-tagline">{t('brandTagline')}</p> : null}
      <p className="login-sub">{t('loginSub')}</p>

      <div className="login-cta">
        <button
          type="button"
          className="btn btn-primary btn-xl login-google"
          disabled={busy || !firebaseReady}
          onClick={() => {
            void handleGoogle()
          }}
        >
          {busy ? t('loginGoogleBusy') : t('loginGoogle')}
        </button>

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
      </div>

      {error ? (
        <p className="login-error" role="alert">
          {error}
        </p>
      ) : null}

      {!embedded ? (
        <ul className="login-points">
          <li>{t('loginPoint1')}</li>
          <li>{t('loginPoint2')}</li>
          <li>{t('loginPoint3')}</li>
        </ul>
      ) : null}

      {!embedded ? (
        <>
          <p className="login-disclaimer">{t('disclaimer')}</p>
          <p className="login-legal">
            <a href="/privacy" className="link-btn">
              {t('privacyLink')}
            </a>
          </p>
        </>
      ) : null}
    </>
  )

  if (embedded) {
    return (
      <div
        className="login-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <main className="login-hero login-hero-embedded" id="login-modal-title">
          {content}
        </main>
      </div>
    )
  }

  return (
    <div className="login-screen">
      <div className="login-atmosphere" aria-hidden="true" />

      <header className="login-topbar">
        <LanguageToggle />
      </header>

      <main className="login-hero">{content}</main>

      <div className="login-ad-wrap">
        <AdUnit slot={import.meta.env.VITE_ADSENSE_SLOT_LOGIN} />
      </div>
    </div>
  )
}
