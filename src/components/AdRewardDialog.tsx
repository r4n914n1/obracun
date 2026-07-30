import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocale } from '../i18n/LocaleContext'
import { AdUnit } from './AdUnit'
import { claimAdRewardBonus } from '../services/billing'
import type { QuotaSnapshot } from '../types/billing'

const WATCH_SECONDS = 20

interface AdRewardDialogProps {
  open: boolean
  adRewardsRemaining: number
  onClose: () => void
  onClaimed: (quota: QuotaSnapshot) => void
  onOpenPricing: () => void
}

export function AdRewardDialog({
  open,
  adRewardsRemaining,
  onClose,
  onClaimed,
  onOpenPricing,
}: AdRewardDialogProps) {
  const { t } = useLocale()
  const [secondsLeft, setSecondsLeft] = useState(WATCH_SECONDS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSecondsLeft(WATCH_SECONDS)
    setBusy(false)
    setError(null)
  }, [open])

  useEffect(() => {
    if (!open || secondsLeft <= 0) return
    const id = window.setTimeout(() => {
      setSecondsLeft((s) => Math.max(0, s - 1))
    }, 1000)
    return () => window.clearTimeout(id)
  }, [open, secondsLeft])

  if (!open) return null

  const canClaim = secondsLeft <= 0 && !busy
  const rewardSlot =
    (import.meta.env.VITE_ADSENSE_SLOT_REWARD as string | undefined)?.trim() ||
    (import.meta.env.VITE_ADSENSE_SLOT_LOGIN as string | undefined)?.trim()

  async function handleClaim() {
    setBusy(true)
    setError(null)
    try {
      const next = await claimAdRewardBonus()
      onClaimed(next)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('adRewardErr'))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card ad-reward-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ad-reward-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="ad-reward-title" className="modal-title">
          {t('adRewardTitle')}
        </h2>
        <p className="ad-reward-body">{t('adRewardBody')}</p>
        <p className="ad-reward-meta">
          {t('adRewardLeft', { count: adRewardsRemaining })}
        </p>

        <div className="ad-reward-slot">
          <AdUnit slot={rewardSlot} />
        </div>

        <p className="ad-reward-timer" aria-live="polite">
          {secondsLeft > 0
            ? t('adRewardWait', { seconds: secondsLeft })
            : t('adRewardReady')}
        </p>

        {error ? (
          <p className="login-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="modal-actions ad-reward-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={busy}
          >
            {t('adRewardCancel')}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onOpenPricing}
            disabled={busy}
          >
            {t('adRewardPricing')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canClaim}
            onClick={() => {
              void handleClaim()
            }}
          >
            {busy ? t('adRewardClaiming') : t('adRewardClaim')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
