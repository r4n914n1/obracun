export interface PlanDefinition {
  id: string
  monthlyLimit: number
}

/** Must match src/data/pricingPlans.ts plan ids. */
export const PLAN_DEFINITIONS: Record<string, PlanDefinition> = {
  'lite-1m': { id: 'lite-1m', monthlyLimit: 100 },
  'starter-1m': { id: 'starter-1m', monthlyLimit: 500 },
  'standard-1m': { id: 'standard-1m', monthlyLimit: 1000 },
  'pro-1m': { id: 'pro-1m', monthlyLimit: 2500 },
  'starter-3m': { id: 'starter-3m', monthlyLimit: 500 },
  'standard-3m': { id: 'standard-3m', monthlyLimit: 1000 },
  'pro-3m': { id: 'pro-3m', monthlyLimit: 2500 },
}

export function planDefinition(planId: string): PlanDefinition | null {
  return PLAN_DEFINITIONS[planId] ?? null
}
