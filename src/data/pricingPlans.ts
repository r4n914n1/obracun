export interface PricingPlan {
  id: string
  name: string
  priceEur: number
  period: 'month' | 'quarter'
  monthlyLimit: number
  compareAtEur?: number
  savingsEur?: number
  featured?: boolean
}

export const TRIAL_CALCULATIONS = 5

/** Mesečni paketi */
export const MONTHLY_PLANS: PricingPlan[] = [
  {
    id: 'lite-1m',
    name: 'Lite',
    priceEur: 1,
    period: 'month',
    monthlyLimit: 100,
  },
  {
    id: 'starter-1m',
    name: 'Starter',
    priceEur: 3,
    period: 'month',
    monthlyLimit: 500,
  },
  {
    id: 'standard-1m',
    name: 'Standard',
    priceEur: 5,
    period: 'month',
    monthlyLimit: 1000,
    featured: true,
  },
  {
    id: 'pro-1m',
    name: 'Pro',
    priceEur: 10,
    period: 'month',
    monthlyLimit: 2500,
  },
]

/**
 * Paketi na 3 meseca — isti mesečni limit kao odgovarajući mesečni paket,
 * plaćanje unapred (jeftinije od 3× mesečno).
 */
export const QUARTERLY_PLANS: PricingPlan[] = [
  {
    id: 'starter-3m',
    name: 'Starter',
    priceEur: 8,
    period: 'quarter',
    monthlyLimit: 500,
    compareAtEur: 9,
    savingsEur: 1,
  },
  {
    id: 'standard-3m',
    name: 'Standard',
    priceEur: 12,
    period: 'quarter',
    monthlyLimit: 1000,
    compareAtEur: 15,
    savingsEur: 3,
    featured: true,
  },
  {
    id: 'pro-3m',
    name: 'Pro',
    priceEur: 25,
    period: 'quarter',
    monthlyLimit: 2500,
    compareAtEur: 30,
    savingsEur: 5,
  },
]
