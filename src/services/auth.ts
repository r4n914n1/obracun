import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import { getFirebaseAuth, isFirebaseConfigured } from './firebase'

const LEGACY_SESSION_KEY = 'obracun.auth'
const LEGACY_USER_KEY = 'obracun.auth.user'

const EXPECTED_USER =
  (import.meta.env.VITE_LOGIN_USER as string | undefined)?.trim() || 'airspeed'
const EXPECTED_PASSWORD =
  (import.meta.env.VITE_LOGIN_PASSWORD as string | undefined)?.trim() ||
  'Airspeed1!'

export type AuthMode = 'firebase' | 'legacy' | 'none'

let cachedFirebaseUser: User | null = null
let authReadyPromise: Promise<void> | null = null

/** Wait until Firebase restores session (if configured). */
export function waitForAuthReady(): Promise<void> {
  if (!isFirebaseConfigured()) {
    return Promise.resolve()
  }
  if (!authReadyPromise) {
    authReadyPromise = new Promise((resolve) => {
      const auth = getFirebaseAuth()
      const unsub = onAuthStateChanged(auth, (user) => {
        cachedFirebaseUser = user
        unsub()
        resolve()
      })
    })
  }
  return authReadyPromise
}

export function subscribeAuth(callback: (user: User | null) => void): () => void {
  if (!isFirebaseConfigured()) {
    callback(null)
    return () => {}
  }
  return onAuthStateChanged(getFirebaseAuth(), (user) => {
    cachedFirebaseUser = user
    callback(user)
  })
}

export function getAuthMode(): AuthMode {
  if (cachedFirebaseUser) return 'firebase'
  if (isLegacyAuthenticated()) return 'legacy'
  return 'none'
}

export function isAuthenticated(): boolean {
  if (isFirebaseConfigured() && cachedFirebaseUser) return true
  return isLegacyAuthenticated()
}

function isLegacyAuthenticated(): boolean {
  try {
    return sessionStorage.getItem(LEGACY_SESSION_KEY) === '1'
  } catch {
    return false
  }
}

/** Stable account id for cloud prefs (Firebase uid) or legacy username. */
export function getAccountId(): string | null {
  if (cachedFirebaseUser?.uid) return cachedFirebaseUser.uid
  try {
    if (!isLegacyAuthenticated()) return null
    return sessionStorage.getItem(LEGACY_USER_KEY)
  } catch {
    return null
  }
}

export function getAuthUsername(): string | null {
  if (cachedFirebaseUser) {
    return (
      cachedFirebaseUser.email ??
      cachedFirebaseUser.displayName ??
      cachedFirebaseUser.uid
    )
  }
  try {
    if (!isLegacyAuthenticated()) return null
    return sessionStorage.getItem(LEGACY_USER_KEY)
  } catch {
    return null
  }
}

export function isCloudAccount(): boolean {
  return Boolean(cachedFirebaseUser?.uid)
}

export async function loginWithGoogle(): Promise<User> {
  if (!isFirebaseConfigured()) {
    throw new Error(
      'Google prijava zahteva Firebase. Dodaj VITE_FIREBASE_* u .env.local.',
    )
  }
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  const result = await signInWithPopup(getFirebaseAuth(), provider)
  cachedFirebaseUser = result.user
  try {
    sessionStorage.removeItem(LEGACY_SESSION_KEY)
    sessionStorage.removeItem(LEGACY_USER_KEY)
  } catch {
    // ignore
  }
  return result.user
}

/** Local shared-password login (prefs stay in this browser only). */
export function loginLegacy(username: string, password: string): boolean {
  const ok =
    username.trim() === EXPECTED_USER && password === EXPECTED_PASSWORD
  if (!ok) return false
  try {
    sessionStorage.setItem(LEGACY_SESSION_KEY, '1')
    sessionStorage.setItem(LEGACY_USER_KEY, username.trim())
  } catch {
    // ignore
  }
  return true
}

/** @deprecated use loginLegacy */
export function login(username: string, password: string): boolean {
  return loginLegacy(username, password)
}

export async function logout(): Promise<void> {
  try {
    sessionStorage.removeItem(LEGACY_SESSION_KEY)
    sessionStorage.removeItem(LEGACY_USER_KEY)
  } catch {
    // ignore
  }
  if (isFirebaseConfigured()) {
    try {
      await signOut(getFirebaseAuth())
    } catch {
      // ignore
    }
  }
  cachedFirebaseUser = null
}
