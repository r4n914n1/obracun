export interface PricingPlan {
  id: string
  name: string
  priceEur: number
  periodLabel: string
  monthlyLimit: number
  compareAtEur?: number
  savingsEur?: number
  blurb: string
  featured?: boolean
}

export const TRIAL_CALCULATIONS = 10

/** Mesečni paketi */
export const MONTHLY_PLANS: PricingPlan[] = [
  {
    id: 'starter-1m',
    name: 'Starter',
    priceEur: 3,
    periodLabel: 'mesečno',
    monthlyLimit: 500,
    blurb: 'Za povremenu upotrebu',
  },
  {
    id: 'standard-1m',
    name: 'Standard',
    priceEur: 5,
    periodLabel: 'mesečno',
    monthlyLimit: 1000,
    blurb: 'Za redovan rad',
    featured: true,
  },
  {
    id: 'pro-1m',
    name: 'Pro',
    priceEur: 10,
    periodLabel: 'mesečno',
    monthlyLimit: 2500,
    blurb: 'Za intenzivnu upotrebu',
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
    periodLabel: '3 meseca',
    monthlyLimit: 500,
    compareAtEur: 9,
    savingsEur: 1,
    blurb: '500 računanja svakog meseca',
  },
  {
    id: 'standard-3m',
    name: 'Standard',
    priceEur: 12,
    periodLabel: '3 meseca',
    monthlyLimit: 1000,
    compareAtEur: 15,
    savingsEur: 3,
    blurb: '1.000 računanja svakog meseca',
    featured: true,
  },
  {
    id: 'pro-3m',
    name: 'Pro',
    priceEur: 25,
    periodLabel: '3 meseca',
    monthlyLimit: 2500,
    compareAtEur: 30,
    savingsEur: 5,
    blurb: '2.500 računanja svakog meseca',
  },
]
