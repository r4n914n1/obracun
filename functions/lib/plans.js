"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAN_DEFINITIONS = void 0;
exports.planDefinition = planDefinition;
/** Must match src/data/pricingPlans.ts plan ids. */
exports.PLAN_DEFINITIONS = {
    'lite-1m': { id: 'lite-1m', monthlyLimit: 100 },
    'starter-1m': { id: 'starter-1m', monthlyLimit: 500 },
    'standard-1m': { id: 'standard-1m', monthlyLimit: 1000 },
    'pro-1m': { id: 'pro-1m', monthlyLimit: 2500 },
    'starter-3m': { id: 'starter-3m', monthlyLimit: 500 },
    'standard-3m': { id: 'standard-3m', monthlyLimit: 1000 },
    'pro-3m': { id: 'pro-3m', monthlyLimit: 2500 },
};
function planDefinition(planId) {
    return exports.PLAN_DEFINITIONS[planId] ?? null;
}
//# sourceMappingURL=plans.js.map