import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import { getFirebaseAuth, isFirebaseConfigured } from './firebase'

export type AuthMode = 'firebase' | 'none'

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
  return cachedFirebaseUser ? 'firebase' : 'none'
}

export function isAuthenticated(): boolean {
  return Boolean(cachedFirebaseUser)
}

/** Firebase uid for cloud prefs. */
export function getAccountId(): string | null {
  return cachedFirebaseUser?.uid ?? null
}

export function getAuthUsername(): string | null {
  if (!cachedFirebaseUser) return null
  return (
    cachedFirebaseUser.email ??
    cachedFirebaseUser.displayName ??
    cachedFirebaseUser.uid
  )
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
  return result.user
}

export async function logout(): Promise<void> {
  if (isFirebaseConfigured()) {
    try {
      await signOut(getFirebaseAuth())
    } catch {
      // ignore
    }
  }
  cachedFirebaseUser = null
}

