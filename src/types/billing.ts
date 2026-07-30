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
  /** Extra calculations earned by watching ads. */
  bonusCalculations: number
  /** How many ad bonuses already claimed (lifetime). */
  adRewardsClaimed: number
  /** How many ad bonuses can still be claimed (lifetime, max 3). */
  adRewardsRemaining: number
  /** Free user, plan quota empty, lifetime ad rewards left. */
  canClaimAdReward: boolean
  canCalculate: boolean
  periodEnd: string | null
}
