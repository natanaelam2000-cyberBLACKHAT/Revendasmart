import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PLANS,
  PLAN_CONFIG,
  PLAN_PRICING,
  UNLIMITED,
  canAddProduct,
  canAddClient,
  canAddService,
  canUseFeature,
  getActivePlan,
  resolveCommercialPlan,
  resolveEntitlements,
  type PlanData,
} from "../shared/monetization";
import { checkProductLimit, checkClientLimit, checkServiceLimit } from "../client/src/lib/plan-helpers";

function basePlanData(overrides: Partial<PlanData> = {}): PlanData {
  return {
    currentPlan: "free",
    premiumActive: false,
    premiumExpiresAt: null,
    premiumStartedAt: null,
    premiumSource: null,
    referralCode: "USER-000000000",
    referralCount: 0,
    updatedAt: new Date(),
    subscriptionId: null,
    subscriptionStatus: null,
    subscriptionPlanId: null,
    autoRenew: false,
    lastPaymentAt: null,
    nextBillingAt: null,
    canceledAt: null,
    paymentStatus: null,
    ...overrides,
  };
}

function run(): void {
  // P1-P3 — PlanType accepts all three tiers.
  assert.equal(PLANS.FREE, "free", "P1: PlanType must accept 'free'");
  assert.ok(PLAN_CONFIG.free, "P1: PLAN_CONFIG must have a free entry");
  assert.equal(PLANS.PRO, "pro", "P2: PlanType must accept 'pro'");
  assert.ok(PLAN_CONFIG.pro, "P2: PLAN_CONFIG must have a pro entry");
  assert.equal(PLANS.PREMIUM, "premium", "P3: PlanType must accept 'premium'");
  assert.ok(PLAN_CONFIG.premium, "P3: PLAN_CONFIG must have a premium entry");

  // P4-P6 — backward compatibility with old free/premium docs and safe fallback for unknown values.
  const oldFreeDoc = basePlanData({ currentPlan: "free" });
  assert.equal(resolveCommercialPlan(oldFreeDoc), "free", "P4: an old free document must still resolve to free");
  assert.equal(getActivePlan(oldFreeDoc), "free", "P4: getActivePlan must still resolve an old free document to free");

  const oldPremiumDoc = basePlanData({ currentPlan: "premium", premiumActive: true });
  assert.equal(resolveCommercialPlan(oldPremiumDoc), "premium", "P5: an old premium document must still resolve to premium");
  assert.equal(getActivePlan(oldPremiumDoc), "premium", "P5: getActivePlan must still resolve an old premium document to premium");

  const corruptedDoc = basePlanData({ currentPlan: "not-a-real-plan" as PlanData["currentPlan"] });
  assert.doesNotThrow(() => resolveCommercialPlan(corruptedDoc), "P6: an invalid currentPlan must never throw");
  assert.equal(resolveCommercialPlan(corruptedDoc), "free", "P6: an invalid/unknown currentPlan must fall back to free");
  assert.equal(resolveCommercialPlan(null), "free", "P6: a null planData must fall back to free");
  const missingCurrentPlanDoc = basePlanData();
  delete (missingCurrentPlanDoc as { currentPlan?: unknown }).currentPlan;
  assert.equal(resolveCommercialPlan(missingCurrentPlanDoc), "free", "P6: a missing currentPlan must fall back to free");

  // A genuinely new "pro" document must resolve to pro (not silently collapse to free).
  const proDoc = basePlanData({ currentPlan: "pro" });
  assert.equal(resolveCommercialPlan(proDoc), "pro", "resolveCommercialPlan must recognize a real pro document");
  assert.equal(getActivePlan(proDoc), "pro", "getActivePlan must recognize a real pro document");
  // Premium always wins over a stale/incorrect "pro" currentPlan when real premium access exists.
  const proDocButPremiumActive = basePlanData({ currentPlan: "pro", premiumActive: true });
  assert.equal(resolveCommercialPlan(proDocButPremiumActive), "premium", "premiumActive must win over a currentPlan of 'pro'");

  // P7-P9 — product limits per tier.
  assert.equal(PLAN_CONFIG.free.limits.products, 30, "P7: Free products must be 30");
  assert.equal(PLAN_CONFIG.pro.limits.products, 500, "P8: Pro products must be 500");
  assert.equal(PLAN_CONFIG.premium.limits.products, 2000, "P9: Premium products must be 2000");

  // P10-P12 — client limits per tier.
  assert.equal(PLAN_CONFIG.free.limits.clients, 50, "P10: Free clients must be 50");
  assert.equal(PLAN_CONFIG.pro.limits.clients, 2000, "P11: Pro clients must be 2000");
  assert.equal(PLAN_CONFIG.premium.limits.clients, 10000, "P12: Premium clients must be 10000");

  // P13-P15 — service limits per tier (contract only, not yet enforced anywhere real — see §11).
  assert.equal(PLAN_CONFIG.free.limits.services, 5, "P13: Free services must be 5");
  assert.equal(PLAN_CONFIG.pro.limits.services, 50, "P14: Pro services must be 50");
  assert.equal(PLAN_CONFIG.premium.limits.services, 200, "P15: Premium services must be 200");

  // P16-P18 — booking limits per tier.
  assert.equal(PLAN_CONFIG.free.limits.bookingsMonthly, 20, "P16: Free bookings/month must be 20");
  assert.equal(PLAN_CONFIG.pro.limits.bookingsMonthly, UNLIMITED, "P17: Pro bookings must use the canonical unlimited/fair-use sentinel");
  assert.equal(PLAN_CONFIG.premium.limits.bookingsMonthly, UNLIMITED, "P18: Premium bookings must use the canonical unlimited/fair-use sentinel");

  // P19 — sales are unlimited on every tier; never compared against a count anywhere.
  assert.equal(PLAN_CONFIG.free.limits.sales, true, "P19: sales must be unrestricted on Free");
  assert.equal(PLAN_CONFIG.pro.limits.sales, true, "P19: sales must be unrestricted on Pro");
  assert.equal(PLAN_CONFIG.premium.limits.sales, true, "P19: sales must be unrestricted on Premium");

  // P20-P22 — the product limit is ACTUALLY enforced at the real boundary, through the exact helper
  // add-product.tsx now calls (no bypass argument, matching the fixed call site).
  assert.equal(canAddProduct("free", 29), true, "P20: Free must allow the 30th product (count=29 before adding)");
  assert.equal(checkProductLimit("free", 29).allowed, true, "P20: checkProductLimit must allow the 30th product");
  assert.equal(canAddProduct("free", 30), false, "P20: Free must reject the 31st product (count=30 before adding)");
  assert.equal(checkProductLimit("free", 30).allowed, false, "P20: checkProductLimit must reject the 31st product");

  assert.equal(canAddProduct("pro", 499), true, "P21: Pro must allow the 500th product");
  assert.equal(checkProductLimit("pro", 499).allowed, true, "P21: checkProductLimit must allow Pro's 500th product");
  assert.equal(canAddProduct("pro", 500), false, "P21: Pro must reject the 501st product");
  assert.equal(checkProductLimit("pro", 500).allowed, false, "P21: checkProductLimit must reject Pro's 501st product");

  assert.equal(canAddProduct("premium", 1999), true, "P22: Premium must allow the 2000th product");
  assert.equal(checkProductLimit("premium", 1999).allowed, true, "P22: checkProductLimit must allow Premium's 2000th product");
  assert.equal(canAddProduct("premium", 2000), false, "P22: Premium must reject the 2001st product");
  assert.equal(checkProductLimit("premium", 2000).allowed, false, "P22: checkProductLimit must reject Premium's 2001st product");

  // P23 — admin/internal override remains intact: checkProductLimit's own "admin" bypass is untouched,
  // and internal grants (tester/premium_plus) still compose to full access regardless of the new pro tier.
  assert.equal(checkProductLimit("admin", 999_999).allowed, true, "P23: the admin bypass in checkProductLimit must remain intact");
  const testerEntitlements = resolveEntitlements(basePlanData({ currentPlan: "free" }), { benefitGrant: "tester" });
  assert.equal(testerEntitlements.hasPremiumAccess, true, "P23: a tester grant must still compose to hasPremiumAccess=true on a free plan");
  const premiumPlusEntitlements = resolveEntitlements(basePlanData({ currentPlan: "free" }), { benefitGrant: "premium_plus" });
  assert.equal(premiumPlusEntitlements.hasPremiumAccess, true, "P23: a premium_plus grant must still compose to hasPremiumAccess=true on a free plan");
  // An explicit openAccess=true (the legitimate, non-hardcoded kind — e.g. a real global-promo flag)
  // must still work as a bypass; only the hardcoded call site in add-product.tsx was the bug.
  assert.equal(checkProductLimit("free", 30, true).allowed, true, "P23: an explicit legitimate openAccess bypass must still work");

  // Client and service limit helpers mirror the same enforcement shape (contract-level; services is not
  // wired into any real UI yet, per SERVICES_RUNTIME_BEHAVIOR_CHANGED=NO).
  assert.equal(canAddClient("pro", 1999), true);
  assert.equal(canAddClient("pro", 2000), false);
  assert.equal(checkClientLimit("premium", 9999).allowed, true);
  assert.equal(checkClientLimit("premium", 10000).allowed, false);
  assert.equal(canAddService("free", 4), true);
  assert.equal(canAddService("free", 5), false);
  assert.equal(checkServiceLimit("pro", 49).allowed, true);
  assert.equal(checkServiceLimit("pro", 50).allowed, false);

  // canUseFeature/resolver must not crash for plan="pro" and must have explicit, sane behavior.
  assert.doesNotThrow(() => canUseFeature("pro", "proAds"));
  assert.equal(canUseFeature("pro", "noAds"), true, "Pro must have noAds per PLAN-DEFINITION-01 §2/§10");
  assert.equal(canUseFeature("pro", "charges"), true, "Pro must have charges per PLAN-DEFINITION-01 §2");
  assert.equal(canUseFeature("free", "proAds"), false, "Free must never have proAds");

  // Ads Pro quota contract exists (values only — PLAN-IMPL-05 enforces it, not this ticket).
  assert.equal(PLAN_CONFIG.free.limits.proAdPreparationsMonthly, 0);
  assert.equal(PLAN_CONFIG.pro.limits.proAdPreparationsMonthly, 3);
  assert.equal(PLAN_CONFIG.premium.limits.proAdPreparationsMonthly, 100);

  // Canonical pricing metadata exists (contract only — not wired to display/checkout, see
  // PRICE_ACTIVATION_BLOCKED_BY_PROVIDER in the ticket report).
  assert.deepEqual(PLAN_PRICING.free, { monthly: 0, annual: 0 });
  assert.deepEqual(PLAN_PRICING.pro, { monthly: 49.90, annual: 499 });
  assert.deepEqual(PLAN_PRICING.premium, { monthly: 79.90, annual: 799 });

  // Source-level regression guard for the actual P0 fix: the exact hardcoded-bypass call must be gone
  // from add-product.tsx, and the corrected 3-way-aware call must be present.
  const addProductSource = readFileSync("client/src/pages/add-product.tsx", "utf-8");
  assert.doesNotMatch(
    addProductSource,
    /checkProductLimit\(safePlan,\s*productCountSnapshot\.data\(\)\.count,\s*true\)/,
    "add-product.tsx must never again hardcode openAccess=true for the product limit check",
  );
  assert.match(
    addProductSource,
    /const safePlan: PlanType = activePlan === "premium" \|\| activePlan === "pro" \? activePlan : "free";/,
    "add-product.tsx must preserve 'pro' instead of collapsing it to 'free'",
  );

  // Source-level regression guard: PlanProvider must delegate to the canonical PLAN_CONFIG instead of
  // reconstructing a second, divergent limits object (the "no parallel config" requirement, §2).
  const planProviderSource = readFileSync("client/src/providers/PlanProvider.tsx", "utf-8");
  assert.doesNotMatch(planProviderSource, /products:\s*Infinity/, "PlanProvider must not hardcode Infinity for products anymore");
  assert.match(planProviderSource, /return PLAN_CONFIG\[activePlan\]\.limits;/, "PlanProvider's resolveLimits must delegate to PLAN_CONFIG");
  assert.match(planProviderSource, /data\?\.currentPlan === PLANS\.PRO/, "PlanProvider's resolveActivePlan must recognize a pro currentPlan");

  const clientsSource = readFileSync("client/src/pages/clients.tsx", "utf-8");
  // Matches the old check as actual code (inside an `if (`), not the explanatory comment that quotes
  // the old pattern in backticks for context — a stray match on prose would be a false positive here.
  assert.doesNotMatch(clientsSource, /if \(\(totalCount \?\? clients\.length\) >= 50 && activePlan === 'free'\)/, "clients.tsx must not keep the hardcoded 50-client duplicate as real code");
  assert.match(clientsSource, /checkClientLimit\(activePlan, totalCount \?\? clients\.length\)/, "clients.tsx must use the canonical checkClientLimit helper");

  console.log(
    "PLAN-IMPL-01 canonical foundation tests passed: P1-P23 (3-tier PlanType, backward-compatible " +
    "resolution, safe fallback for unknown plans, product/client/service/booking limits per tier, " +
    "the Free/Pro/Premium product limit is genuinely enforced at the real boundary, admin/internal " +
    "overrides intact, Ads Pro quota contract present but unenforced, pricing metadata present but " +
    "not activated, add-product.tsx/PlanProvider.tsx/clients.tsx source verified for the actual fixes).",
  );
}

run();
