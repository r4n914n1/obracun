import { useEffect, useRef } from 'react'
import { isAdSenseConfigured, loadAdSenseScript } from '../services/adsense'

interface AdUnitProps {
  slot?: string
  format?: 'auto' | 'fluid' | 'rectangle' | 'horizontal'
  className?: string
}

/**
 * Renders a Google AdSense unit when VITE_ADSENSE_CLIENT_ID (+ slot) are set.
 * Keeps the <ins> in the DOM (Google recommends not mounting ads as hidden).
 * Empty slots are collapsed via CSS on [data-ad-status="unfilled"].
 */
export function AdUnit({
  slot,
  format = 'auto',
  className = '',
}: AdUnitProps) {
  const insRef = useRef<HTMLModElement>(null)
  const client = import.meta.env.VITE_ADSENSE_CLIENT_ID as string | undefined
  const resolvedSlot = (slot ?? '').trim()
  const enabled = isAdSenseConfigured() && resolvedSlot.length > 0

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    void loadAdSenseScript()
      .then(() => {
        if (cancelled) return
        const el = insRef.current
        if (!el) return
        if (el.dataset.adsbygoogleStatus) return

        try {
          ;(window.adsbygoogle = window.adsbygoogle || []).push({})
        } catch {
          // Ad blockers / incomplete setup
        }
      })
      .catch(() => {
        // Script blocked or failed
      })

    return () => {
      cancelled = true
    }
  }, [enabled, resolvedSlot])

  if (!enabled || !client) return null

  return (
    <div className={`ad-unit ${className}`.trim()}>
      <ins
        ref={insRef}
        className="adsbygoogle"
        style={{ display: 'block', minWidth: 250, minHeight: 90 }}
        data-ad-client={client}
        data-ad-slot={resolvedSlot}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </div>
  )
}
