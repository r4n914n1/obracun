import { useState, type FormEvent } from 'react'
import { loginLegacy, loginWithGoogle } from '../services/auth'
import { isFirebaseConfigured } from '../services/firebase'
import { APP_DISCLAIMER } from '../data/disclaimer'

interface LoginScreenProps {
  onSuccess: () => void
  onOpenPricing?: () => void
}

export function LoginScreen({ onSuccess, onOpenPricing }: LoginScreenProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
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
      setError(
        err instanceof Error
          ? err.message
          : 'Google prijava nije uspela. Probaj ponovo.',
      )
    } finally {
      setBusy(false)
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!username.trim() || !password) {
      setError('Unesi korisničko ime i lozinku.')
      return
    }
    if (!loginLegacy(username, password)) {
      setError('Pogrešno korisničko ime ili lozinka.')
      return
    }
    setError(null)
    onSuccess()
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-brand">Obračun</div>
        <h1 className="login-title">Prijava</h1>
        <p className="login-sub">
          {firebaseReady
            ? 'Prijavi se Google nalogom da se podešavanja (popusti) čuvaju na nalogu na svim uređajima.'
            : 'Unesi podatke da nastaviš na kalkulator putarine.'}
        </p>

        {firebaseReady ? (
          <>
            <button
              type="button"
              className="btn btn-primary btn-xl"
              disabled={busy}
              onClick={() => {
                void handleGoogle()
              }}
            >
              {busy ? 'Prijava…' : 'Nastavi sa Google'}
            </button>
            <p className="login-divider">ili lokalni nalog</p>
          </>
        ) : null}

        <label className="login-field">
          <span>Korisničko ime</span>
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(event) => {
              setUsername(event.target.value)
              setError(null)
            }}
            autoFocus={!firebaseReady}
          />
        </label>

        <label className="login-field">
          <span>Lozinka</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              setError(null)
            }}
          />
        </label>

        {error ? (
          <p className="login-error" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className="btn btn-secondary btn-xl" disabled={busy}>
          Uloguj se
        </button>

        {firebaseReady ? (
          <p className="login-hint">
            Lokalni nalog čuva popuste samo u ovom pregledaču. Google nalog —
            na serveru, na svim uređajima.
          </p>
        ) : (
          <p className="login-hint">
            Za čuvanje po nalogu (ne samo u browseru) podesi Firebase u
            .env.local — vidi .env.example.
          </p>
        )}

        {onOpenPricing ? (
          <button
            type="button"
            className="btn btn-secondary login-pricing-link"
            onClick={onOpenPricing}
            disabled={busy}
          >
            Pogledaj pretplate
          </button>
        ) : null}

        <p className="login-disclaimer">{APP_DISCLAIMER}</p>
      </form>
    </div>
  )
}
