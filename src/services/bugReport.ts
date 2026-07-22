import { getFunctions, httpsCallable } from 'firebase/functions'
import { getFirebaseApp, isFirebaseConfigured } from './firebase'

export const SUPPORT_EMAIL = 'support@transportcost.info'

export async function submitBugReport(
  email: string,
  message: string,
): Promise<void> {
  if (!isFirebaseConfigured()) {
    throw new Error('Bug report nije dostupan — Firebase nije podešen.')
  }

  const callable = httpsCallable<
    { email: string; message: string },
    { ok: boolean }
  >(getFunctions(getFirebaseApp()), 'submitBugReport')

  try {
    await callable({ email, message })
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: string }).code)
        : ''
    const details =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message?: string }).message)
        : ''

    if (code === 'functions/unavailable' || code === 'functions/not-found') {
      throw new Error(
        'Slanje trenutno nije dostupno. Pokušaj ponovo kasnije ili piši na support@transportcost.info.',
      )
    }
    if (details) {
      throw new Error(details)
    }
    throw err
  }
}
