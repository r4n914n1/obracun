/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_MAPS_API_KEY: string
  readonly VITE_HERE_API_KEY: string
  readonly VITE_BASE?: string
  readonly VITE_APP_URL?: string
  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string
  readonly VITE_FIREBASE_APP_ID?: string
  readonly VITE_ADSENSE_CLIENT_ID?: string
  readonly VITE_ADSENSE_SLOT_LOGIN?: string
  readonly VITE_ADSENSE_SLOT_PRICING?: string
  readonly VITE_ADSENSE_SLOT_REWARD?: string
  /** Google Ads account tag, e.g. AW-18346625131 */
  readonly VITE_GOOGLE_ADS_ID?: string
  /**
   * Conversion label from Ads Event snippet (part after AW-…/),
   * or full send_to like AW-18346625131/AbCdEfGhIjKlMnOp
   */
  readonly VITE_GOOGLE_ADS_CONVERSION_LABEL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
