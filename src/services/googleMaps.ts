let loadPromise: Promise<typeof google> | null = null

export function loadGoogleMaps(): Promise<typeof google> {
  if (window.google?.maps?.places) {
    return Promise.resolve(window.google)
  }

  if (loadPromise) {
    return loadPromise
  }

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return Promise.reject(
      new Error('Nedostaje VITE_GOOGLE_MAPS_API_KEY u .env.local'),
    )
  }

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&language=sr`
    script.async = true
    script.onload = () => {
      if (window.google?.maps?.places) {
        resolve(window.google)
      } else {
        reject(new Error('Google Maps Places nije dostupno'))
      }
    }
    script.onerror = () => {
      loadPromise = null
      reject(new Error('Neuspelo učitavanje Google Maps skripte'))
    }
    document.head.appendChild(script)
  })

  return loadPromise
}
