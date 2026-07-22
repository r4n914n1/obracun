import { doc, getDoc, setDoc } from 'firebase/firestore'
import type { ForeignTollRates } from '../types'
import { defaultForeignTollRates } from './tollDiscounts'
import {
  getAccountId,
  getAuthUsername,
  isCloudAccount,
} from './auth'
import { getFirestoreDb, isFirebaseConfigured } from './firebase'

const LOCAL_PREFIX = 'obracun.tollRates.v1.'

function localKey(accountId: string): string {
  return `${LOCAL_PREFIX}${accountId.trim().toLowerCase() || 'anonymous'}`
}

function isValidRates(value: unknown): value is ForeignTollRates {
  if (!value || typeof value !== 'object') return false
  return Object.values(value as Record<string, unknown>).every((entry) => {
    if (!entry || typeof entry !== 'object') return false
    const row = entry as Record<string, unknown>
    return (
      typeof row.vat === 'number' &&
      typeof row.tollDiscount === 'number' &&
      typeof row.tunnelDiscount === 'number'
    )
  })
}

function mergeRates(
  defaults: ForeignTollRates,
  saved: ForeignTollRates,
): ForeignTollRates {
  const merged: ForeignTollRates = { ...defaults }
  for (const [code, row] of Object.entries(saved)) {
    merged[code] = {
      vat: typeof row.vat === 'number' ? row.vat : defaults[code]?.vat ?? 0,
      tollDiscount:
        typeof row.tollDiscount === 'number'
          ? row.tollDiscount
          : defaults[code]?.tollDiscount ?? 0,
      tunnelDiscount:
        typeof row.tunnelDiscount === 'number'
          ? row.tunnelDiscount
          : defaults[code]?.tunnelDiscount ?? 0,
    }
  }
  return merged
}

function loadLocal(accountId: string | null): ForeignTollRates {
  const defaults = defaultForeignTollRates()
  if (!accountId) return defaults
  try {
    const raw = localStorage.getItem(localKey(accountId))
    if (!raw) return defaults
    const parsed: unknown = JSON.parse(raw)
    if (!isValidRates(parsed)) return defaults
    return mergeRates(defaults, parsed)
  } catch {
    return defaults
  }
}

function saveLocal(rates: ForeignTollRates, accountId: string | null): void {
  if (!accountId) return
  try {
    localStorage.setItem(localKey(accountId), JSON.stringify(rates))
  } catch {
    // ignore
  }
}

/** Load toll rates for the signed-in Google account (Firestore + local cache). */
export async function loadTollRatesForUser(
  accountId?: string | null,
): Promise<ForeignTollRates> {
  const defaults = defaultForeignTollRates()
  const id = accountId ?? getAccountId()

  if (isCloudAccount() && isFirebaseConfigured() && id) {
    try {
      const snap = await getDoc(doc(getFirestoreDb(), 'users', id))
      const data = snap.data()
      const saved = data?.foreignTollRates
      if (isValidRates(saved)) {
        const merged = mergeRates(defaults, saved)
        // Keep a local cache for faster startup / offline
        saveLocal(merged, id)
        return merged
      }
    } catch (err) {
      console.warn('Firestore toll rates load failed, using local cache.', err)
    }
  }

  return loadLocal(id ?? getAuthUsername())
}

/**
 * Persist toll rates for the signed-in account (cloud when Google login).
 */
export async function saveTollRatesForUser(
  rates: ForeignTollRates,
  accountId?: string | null,
): Promise<void> {
  const id = accountId ?? getAccountId()
  saveLocal(rates, id)

  if (isCloudAccount() && isFirebaseConfigured() && id) {
    try {
      await setDoc(
        doc(getFirestoreDb(), 'users', id),
        {
          foreignTollRates: rates,
          foreignTollRatesUpdatedAt: new Date().toISOString(),
        },
        { merge: true },
      )
    } catch (err) {
      console.warn('Firestore toll rates save failed (local cache kept).', err)
      throw err
    }
  }
}
