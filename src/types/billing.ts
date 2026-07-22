export interface QuotaSnapshot {
  plan: 'free' | 'subscribed'
  planId: string | null
  /** Paid upgrade waiting until current period ends or quota is used. */
  queuedPlanId: string | null
  /** Cancelled renewal; current plan stays until period ends or quota used. */
  cancelAtPeriodEnd: boolean
  calculationsUsed: number
  limit: number
  remaining: number
  canCalculate: boolean
  periodEnd: string | null
}
