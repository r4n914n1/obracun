import { useEffect, useId, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useLocale } from '../i18n/LocaleContext'
import { getAuthUsername } from '../services/auth'
import { submitBugReport } from '../services/bugReport'

interface BugReportDialogProps {
  open: boolean
  onClose: () => void
}

export function BugReportDialog({ open, onClose }: BugReportDialogProps) {
  const { t } = useLocale()
  const titleId = useId()
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null)
    setSent(false)
    const savedEmail = getAuthUsername()
    if (savedEmail?.includes('@')) {
      setEmail(savedEmail)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, busy, onClose])

  if (!open) return null

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmedEmail = email.trim()
    const trimmedMessage = message.trim()

    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setError(t('bugReportErrEmail'))
      return
    }
    if (trimmedMessage.length < 10) {
      setError(t('bugReportErrMessage'))
      return
    }

    setBusy(true)
    setError(null)
    try {
      await submitBugReport(trimmedEmail, trimmedMessage)
      setSent(true)
      setMessage('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('bugReportErrSend'))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={() => {
        if (!busy) onClose()
      }}
    >
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="modal-title">
          {t('bugReportDialogTitle')}
        </h2>

        {sent ? (
          <>
            <p className="modal-success">{t('bugReportSuccess')}</p>
            <button
              type="button"
              className="btn btn-primary btn-xl"
              onClick={onClose}
            >
              {t('bugReportClose')}
            </button>
          </>
        ) : (
          <form className="modal-form" onSubmit={(event) => void handleSubmit(event)}>
            <label className="login-field">
              <span>{t('bugReportEmailLabel')}</span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                disabled={busy}
                placeholder={t('bugReportEmailPlaceholder')}
                onChange={(event) => {
                  setEmail(event.target.value)
                  setError(null)
                }}
              />
            </label>

            <label className="login-field">
              <span>{t('bugReportMessageLabel')}</span>
              <textarea
                className="modal-textarea"
                rows={7}
                value={message}
                disabled={busy}
                placeholder={t('bugReportMessagePlaceholder')}
                onChange={(event) => {
                  setMessage(event.target.value)
                  setError(null)
                }}
              />
            </label>

            {error ? (
              <p className="login-error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={onClose}
              >
                {t('bugReportCancel')}
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? t('bugReportSending') : t('bugReportSend')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  )
}
