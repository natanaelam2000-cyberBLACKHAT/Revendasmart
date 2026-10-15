import assert from "node:assert/strict";
import { isPaidEntitlementActive, isPremiumActive, resolveCommercialPlan, resolveGenericPaidPlan, type PlanData } from "../shared/monetization";
import { resolvePaidThroughDate, isWithinPaidPeriod } from "../server/subscriptions";

const now = new Date("2026-10-01T12:00:00Z");
const past = new Date("2026-09-30T12:00:00Z");
const future = new Date("2026-10-02T12:00:00Z");
let count = 0;
function check(label: string, data: Partial<PlanData>, expected: string, paid: boolean) {
  const snapshot = data as PlanData;
  assert.equal(resolveCommercialPlan(snapshot, now), expected, label);
  assert.equal(isPaidEntitlementActive(snapshot, now), paid, `${label}: paid authority`);
  assert.equal(isPremiumActive(snapshot, now), expected !== "free", `${label}: access`);
  if (data.pricingVersion === "v2") {
    assert.equal(resolveGenericPaidPlan(snapshot, now), paid ? expected : null, `${label}: v2 authority`);
  }
  count++;
}
const v2: Partial<PlanData> = { pricingVersion: "v2", currentPlan: "pro", subscriptionStatus: "authorized", paidThrough: null, premiumSource: "referral_reward", premiumExpiresAt: past };
check("A v2 Pro renewing with expired referral", v2, "pro", true);
check("B v2 Premium renewing with expired referral", { ...v2, currentPlan: "premium" }, "premium", true);
check("C v2 paid period expired", { ...v2, paidThrough: past }, "free", false);
check("D active reward only", { currentPlan: "premium", premiumSource: "referral_reward", premiumExpiresAt: future }, "premium", false);
check("E expired reward only", { currentPlan: "premium", premiumSource: "referral_reward", premiumExpiresAt: past }, "free", false);
check("F paid Pro plus active referral", { ...v2, paidThrough: future, premiumExpiresAt: future }, "pro", true);
check("G paid Pro plus expired referral", { ...v2, paidThrough: future }, "pro", true);
check("H paid Premium plus expired referral", { ...v2, currentPlan: "premium", paidThrough: future }, "premium", true);
for (const [label, paymentStatus] of [["I refund", "refunded"], ["J charged_back", "charged_back"], ["K chargeback", "chargeback"]]) {
  check(label, { ...v2, paidThrough: future, paymentStatus }, "free", false);
}
const cancellation = { ...v2, nextBillingAt: future };
assert.equal(resolvePaidThroughDate(cancellation)?.getTime(), future.getTime(), "L cancellation uses v2 period");
assert.equal(isWithinPaidPeriod(cancellation, now), true, "L paid period remains active");
check("L frozen cancellation period", { ...cancellation, subscriptionStatus: "cancelled", paidThrough: resolvePaidThroughDate(cancellation) }, "pro", true);
assert.equal(resolvePaidThroughDate({ ...cancellation, paidThrough: past })?.getTime(), past.getTime(), "L paidThrough outranks nextBillingAt");
assert.equal(resolvePaidThroughDate({ ...v2, nextBillingAt: null }), null, "L never falls back to referral expiry");
count++;
check("M legacy future", { currentPlan: "premium", premiumSource: "subscription", subscriptionStatus: "authorized", premiumExpiresAt: future }, "premium", true);
check("N legacy expired", { currentPlan: "premium", premiumSource: "subscription", subscriptionStatus: "authorized", premiumExpiresAt: past }, "free", false);
check("O authorized with expired paid entitlement", { ...v2, premiumSource: "subscription", premiumExpiresAt: future, paidThrough: past }, "free", false);
for (const status of ["active", "approved"] as const) {
  check(`${status} expired paid period`, { ...v2, subscriptionStatus: status, paidThrough: past }, "free", false);
}
check("exact expiry boundary", { ...v2, paidThrough: now }, "free", false);
assert.equal(resolvePaidThroughDate({ premiumExpiresAt: future, nextBillingAt: past })?.getTime(), future.getTime(), "legacy lifecycle precedence preserved");
// REFERRAL-HARDENING-09: historical flags cannot revive an inactive V2 subscription.
check("R1 cancelled null with residual flags", { ...v2, currentPlan: "premium", subscriptionStatus: "cancelled", premiumActive: true }, "free", false);
check("R2 expired null with subscription source", { ...v2, currentPlan: "free", subscriptionStatus: "expired", premiumSource: "subscription", premiumExpiresAt: null }, "free", false);
check("R3 paused null with old Pro/referral", { ...v2, subscriptionStatus: "paused" }, "free", false);
check("R4 paused future paidThrough", { ...v2, subscriptionStatus: "paused", paidThrough: future }, "pro", true);
check("R5 cancelled future paidThrough", { ...v2, currentPlan: "premium", subscriptionStatus: "cancelled", paidThrough: future }, "premium", true);
check("R6 authorized Pro null", v2, "pro", true);
check("R7 authorized Premium null", { ...v2, currentPlan: "premium" }, "premium", true);
for (const subscriptionStatus of ["pending", "unknown", null, " CANCELLED "]) {
  check(`inactive V2 ${subscriptionStatus} residual flags`, { ...v2, currentPlan: "premium", subscriptionStatus, premiumActive: true, premiumSource: "subscription", premiumExpiresAt: future }, "free", false);
}
for (const subscriptionStatus of ["paused", "cancelled"] as const) {
  check(`${subscriptionStatus} grace exact boundary`, { ...v2, subscriptionStatus, paidThrough: now }, "free", false);
}
console.log(`Referral hardening 07: ${count} temporal regressions passed`);
