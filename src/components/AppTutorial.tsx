import { useEffect, useId, useLayoutEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useLocale } from '../i18n/LocaleContext'
import type { MessageKey } from '../i18n/messages'

export interface TutorialStep {
  target: string
  titleKey: MessageKey
  bodyKey: MessageKey
  /** Place the tip card to the left of the highlight (right-side targets). */
  preferLeft?: boolean
}

const STEPS: TutorialStep[] = [
  {
    target: '[data-tour="welcome"]',
    titleKey: 'tutorialWelcomeTitle',
    bodyKey: 'tutorialWelcomeBody',
  },
  {
    target: '[data-tour="quota"]',
    titleKey: 'tutorialQuotaTitle',
    bodyKey: 'tutorialQuotaBody',
  },
  {
    target: '[data-tour="route"]',
    titleKey: 'tutorialRouteTitle',
    bodyKey: 'tutorialRouteBody',
  },
  {
    target: '[data-tour="vehicle"]',
    titleKey: 'tutorialVehicleTitle',
    bodyKey: 'tutorialVehicleBody',
  },
  {
    target: '[data-tour="costs"]',
    titleKey: 'tutorialCostsTitle',
    bodyKey: 'tutorialCostsBody',
  },
  {
    target: '[data-tour="calculate"]',
    titleKey: 'tutorialCalculateTitle',
    bodyKey: 'tutorialCalculateBody',
  },
  {
    target: '[data-tour="foreign-rates"]',
    titleKey: 'tutorialForeignTitle',
    bodyKey: 'tutorialForeignBody',
  },
  {
    target: '[data-tour="map"]',
    titleKey: 'tutorialMapTitle',
    bodyKey: 'tutorialMapBody',
  },
  {
    target: '[data-tour="results"]',
    titleKey: 'tutorialResultsTitle',
    bodyKey: 'tutorialResultsBody',
    preferLeft: true,
  },
  {
    target: '[data-tour="pricing"]',
    titleKey: 'tutorialPricingTitle',
    bodyKey: 'tutorialPricingBody',
    preferLeft: true,
  },
  {
    target: '[data-tour="help"]',
    titleKey: 'tutorialHelpTitle',
    bodyKey: 'tutorialHelpBody',
    preferLeft: true,
  },
]

interface SpotRect {
  top: number
  left: number
  width: number
  height: number
}

interface AppTutorialProps {
  open: boolean
  onClose: (completed: boolean) => void
}

const PAD = 8

function readSpot(selector: string): SpotRect | null {
  const el = document.querySelector(selector)
  if (!(el instanceof HTMLElement)) return null
  const rect = el.getBoundingClientRect()
  if (rect.width < 2 && rect.height < 2) return null
  return {
    top: rect.top - PAD,
    left: rect.left - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  }
}

export function AppTutorial({ open, onClose }: AppTutorialProps) {
  const { t } = useLocale()
  const titleId = useId()
  const [stepIndex, setStepIndex] = useState(0)
  const [spot, setSpot] = useState<SpotRect | null>(null)

  useEffect(() => {
    if (!open) return
    setStepIndex(0)
  }, [open])

  useLayoutEffect(() => {
    if (!open) return

    const step = STEPS[stepIndex]
    if (!step) return

    const target = document.querySelector(step.target)
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
      if (target instanceof HTMLDetailsElement && !target.open) {
        target.open = true
      }
    }

    let cancelled = false
    function measure() {
      if (cancelled) return
      setSpot(readSpot(step.target))
    }

    measure()
    const timer = window.setTimeout(measure, 280)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open, stepIndex])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const step = STEPS[stepIndex]
  const isLast = stepIndex >= STEPS.length - 1
  const cardStyle: CSSProperties = spot
    ? (() => {
        const cardWidth = Math.min(352, window.innerWidth - 24)
        const cardApproxHeight = 220
        const spaceBelow = window.innerHeight - (spot.top + spot.height)
        const preferBelow = spaceBelow >= cardApproxHeight + 24
        const targetOnRight = spot.left + spot.width / 2 > window.innerWidth * 0.55
        const preferLeft = Boolean(step.preferLeft) || targetOnRight

        let left: number
        if (preferLeft) {
          // Keep the card left of right-side targets (results, pricing, help).
          left = spot.left - cardWidth - 12
          if (left < 12) {
            left = Math.max(12, Math.min(spot.left, window.innerWidth - cardWidth) - 72)
          }
        } else {
          left = spot.left
        }
        left = Math.min(Math.max(12, left), window.innerWidth - cardWidth - 12)

        if (preferBelow) {
          return { top: spot.top + spot.height + 12, left, width: cardWidth }
        }
        return {
          top: Math.max(12, spot.top - cardApproxHeight - 12),
          left,
          width: cardWidth,
        }
      })()
    : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }

  return createPortal(
    <div className="tutorial-root" role="presentation">
      {spot ? (
        <div
          className="tutorial-spotlight"
          style={{
            top: spot.top,
            left: spot.left,
            width: spot.width,
            height: spot.height,
          }}
          aria-hidden
        />
      ) : (
        <div className="tutorial-dim-fallback" aria-hidden />
      )}

      <div
        className="tutorial-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={cardStyle}
      >
        <p className="tutorial-step-label">
          {t('tutorialStep', {
            current: stepIndex + 1,
            total: STEPS.length,
          })}
        </p>
        <h2 id={titleId} className="tutorial-title">
          {t(step.titleKey)}
        </h2>
        <p className="tutorial-body">{t(step.bodyKey)}</p>
        <div className="tutorial-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onClose(false)}
          >
            {t('tutorialSkip')}
          </button>
          <div className="tutorial-actions-nav">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={stepIndex === 0}
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            >
              {t('tutorialBack')}
            </button>
            {isLast ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => onClose(true)}
              >
                {t('tutorialDone')}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() =>
                  setStepIndex((i) => Math.min(STEPS.length - 1, i + 1))
                }
              >
                {t('tutorialNext')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
