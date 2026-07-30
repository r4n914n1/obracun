const STORAGE_PREFIX = 'transportcost.tutorial.v1'

function storageKey(accountId: string): string {
  return `${STORAGE_PREFIX}.${accountId}`
}

export function hasCompletedTutorial(accountId: string): boolean {
  try {
    return localStorage.getItem(storageKey(accountId)) === 'done'
  } catch {
    return false
  }
}

export function markTutorialCompleted(accountId: string): void {
  try {
    localStorage.setItem(storageKey(accountId), 'done')
  } catch {
    // ignore quota / private mode
  }
}
