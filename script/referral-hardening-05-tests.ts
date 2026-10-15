import assert from "node:assert/strict";
import { isPaidEntitlementActive, isPremiumActive, resolveCommercialPlan, type PlanData } from "../shared/monetization";
const now = new Date("2026-10-01T12:00:00Z");
const past = new Date("2026-09-30T12:00:00Z");
const future = new Date("2026-10-02T12:00:00Z");
let count = 0;
function check(label: string, data: Partial<PlanData> | null, plan: string, paid: boolean) {
  const snapshot = data as PlanData | null;
  assert.equal(resolveCommercialPlan(snapshot, now), plan, label);
  assert.equal(isPaidEntitlementActive(snapshot, now), paid, `${label}: paid authority`);
  count++;
}
check("Free", {currentPlan: "free", premiumActive: false}, "free", false);
check("null", null, "free", false);
for (const plan of ["pro", "premium"] as const) {
  const paid = {currentPlan: plan, pricingVersion: "v2", premiumSource: "subscription", premiumActive: true} as Partial<PlanData>;
  for (const status of ["authorized", "active", "approved"]) {
    check(`${plan} ${status} future`, {...paid, subscriptionStatus: status, paidThrough: future}, plan, true);
    check(`${plan} ${status} expired`, {...paid, subscriptionStatus: status, paidThrough: past}, "free", false);
    check(`${plan} ${status} boundary`, {...paid, subscriptionStatus: status, paidThrough: now}, "free", false);
    check(`${plan} ${status} unrelated legacy expired`, {...paid, subscriptionStatus: status, premiumExpiresAt: past}, plan, true);
  }
  check(`${plan} cancelled grace`, {...paid, subscriptionStatus: "cancelled", paidThrough: future}, plan, true);
  check(`${plan} cancelled expired`, {...paid, subscriptionStatus: "cancelled", paidThrough: past}, "free", false);
  for (const paymentStatus of ["refunded", "charged_back", "chargeback"]) {
    check(`${plan} ${paymentStatus}`, {...paid, subscriptionStatus: "authorized", paymentStatus, paidThrough: future}, "free", false);
    assert.equal(isPremiumActive({...paid, paymentStatus, paidThrough: future} as PlanData, now), false);
  }
  check(`${plan} paid plus reward`, {...paid, subscriptionStatus: "authorized", paidThrough: future, premiumExpiresAt: past, referralCount: 3, referralLifetimeCount: 3}, plan, true);
  check(`${plan} expired plus historical reward`, {...paid, subscriptionStatus: "authorized", paidThrough: past, premiumExpiresAt: future, referralCount: 3, referralLifetimeCount: 3}, "free", false);
}
check("legacy paid authorized expired", {currentPlan: "premium", premiumActive: true, premiumSource: "subscription", subscriptionStatus: "authorized", premiumExpiresAt: past}, "free", false);
check("reward only", {currentPlan: "premium", premiumSource: "referral_reward", premiumActive: true, premiumExpiresAt: future}, "premium", false);
check("reward expired", {currentPlan: "premium", premiumSource: "referral_reward", premiumActive: true, premiumExpiresAt: past}, "free", false);
check("trial active", {currentPlan: "free", trialStatus: "active", trialEndsAt: future}, "premium", false);
check("trial expired", {currentPlan: "free", trialStatus: "active", trialEndsAt: past}, "free", false);
check("renewing no expiry", {currentPlan: "premium", premiumSource: "subscription", subscriptionStatus: "authorized"}, "premium", true);
console.log(`Referral hardening 05: ${count} entitlement regressions passed`);
