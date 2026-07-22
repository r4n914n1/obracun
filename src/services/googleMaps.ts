let loadPromise: Promise<typeof google> | null = null
let loadedLanguage: string | null = null

function mapsReady(): boolean {
  return Boolean(window.google?.maps && 'importLibrary' in window.google.maps)
}

function bootstrapMapsScript(apiKey: string, language: string): Promise<void> {
  if (mapsReady()) {
    return Promise.resolve()
  }

  const existing = document.querySelector<HTMLScriptElement>(
    'script[src*="maps.googleapis.com/maps/api/js"]',
  )
  if (existing) {
    return new Promise((resolve, reject) => {
      const started = Date.now()
      const poll = () => {
        if (mapsReady()) {
          resolve()
          return
        }
        if (Date.now() - started > 15_000) {
          reject(new Error('Neuspelo učitavanje Google Maps skripte'))
          return
        }
        window.setTimeout(poll, 50)
      }
      poll()
    })
  }

  return new Promise((resolve, reject) => {
    const callbackName = `_tcMapsInit_${Date.now()}`
    const win = window as unknown as Record<string, unknown>

    win[callbackName] = () => {
      delete win[callbackName]
      resolve()
    }

    const script = document.createElement('script')
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}` +
      `&language=${language}&loading=async&callback=${callbackName}`
    script.async = true
    script.onerror = () => {
      delete win[callbackName]
      reject(new Error('Neuspelo učitavanje Google Maps skripte'))
    }
    document.head.appendChild(script)
  })
}

export function loadGoogleMaps(
  language: 'sr' | 'en' = 'sr',
): Promise<typeof google> {
  if (window.google?.maps?.places && loadedLanguage === language) {
    return Promise.resolve(window.google)
  }

  if (loadPromise && loadedLanguage === language) {
    return loadPromise
  }

  // Maps language cannot change without full page reload.
  if (window.google?.maps?.places) {
    return Promise.resolve(window.google)
  }

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return Promise.reject(
      new Error('Nedostaje VITE_GOOGLE_MAPS_API_KEY u .env.local'),
    )
  }

  loadedLanguage = language
  loadPromise = bootstrapMapsScript(apiKey, language)
    .then(() => google.maps.importLibrary('places'))
    .then(() => {
      if (!window.google?.maps?.places) {
        throw new Error('Google Maps Places nije dostupno')
      }
      return window.google
    })
    .catch((err) => {
      loadPromise = null
      loadedLanguage = null
      throw err
    })

  return loadPromise
}
