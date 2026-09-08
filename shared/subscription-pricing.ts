/** Commercial prices in integer BRL cents. Entitlements remain in monetization. */
export type BillingCycle = "monthly" | "annual";
export type PaidPlan = "pro" | "premium";
export type PurchaseChannel = "web" | "android";
export const LEGACY_PREMIUM_PRICE_CENTS = 1990;
export const STANDARD_PRICE_CENTS = {
  free: { monthly: 0, annual: 0 },
  pro: { monthly: 4990, annual: 49900 },
  premium: { monthly: 7990, annual: 79900 },
} as const;
export const LAUNCH_PRICE_CENTS = {
  pro: { monthly: 2990, annual: 29900 },
  premium: { monthly: 4990, annual: 49900 },
} as const;
export interface CommercialOffer {
  pricingVersion: "v2";
  offerId: "standard" | "launch";
  plan: PaidPlan;
  billingCycle: BillingCycle;
  subscribedPriceCents: number;
  referencePriceCents: number;
}
export function annualSavings(monthlyCents: number, annualCents: number) {
  const fullYear = monthlyCents * 12;
  return { cents: Math.max(0, fullYear - annualCents), percent: fullYear > 0 ? Math.max(0, (fullYear - annualCents) / fullYear * 100) : 0 };
}
/** Slots only; actual Play product/base-plan IDs must be configured in the Android ticket. */
export const PLAY_COMMERCIAL_SLOTS = ["pro_monthly", "pro_annual", "premium_monthly", "premium_annual"] as const;
