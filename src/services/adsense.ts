declare global {
  interface Window {
    adsbygoogle?: unknown[]
  }
}

const CLIENT_ID = (import.meta.env.VITE_ADSENSE_CLIENT_ID as string | undefined)?.trim() ?? ''

let loadPromise: Promise<void> | null = null

export function isAdSenseConfigured(): boolean {
  return CLIENT_ID.startsWith('ca-pub-')
}

/** Load the AdSense script once. Safe to call from multiple components. */
export function loadAdSenseScript(): Promise<void> {
  if (!isAdSenseConfigured()) {
    return Promise.resolve()
  }
  if (loadPromise) return loadPromise

  loadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]',
    )
    if (existing) {
      // AdSense queues .push() until the script finishes — safe to resolve now.
      resolve()
      return
    }

    const script = document.createElement('script')
    script.async = true
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(CLIENT_ID)}`
    script.crossOrigin = 'anonymous'
    script.dataset.adsense = 'true'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('AdSense script failed to load'))
    document.head.appendChild(script)
  })

  return loadPromise
}

export function adsenseClientId(): string {
  return CLIENT_ID
}
