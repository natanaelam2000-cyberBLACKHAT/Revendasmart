import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { STANDARD_PRICE_CENTS, LAUNCH_PRICE_CENTS, LEGACY_PREMIUM_PRICE_CENTS, annualSavings } from "../shared/subscription-pricing";
import { resolveCommercialOffer } from "../server/subscription-pricing";
import { getPurchaseOffer } from "../server/plan-purchase-availability";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";
import { createSubscriptionCommand, syncSubscriptionFromProviderCommand, parseSubscriptionExternalReference, buildSubscriptionExternalReference, registerSubscriptionRoutes } from "../server/subscriptions";
import { resolveBaseCommercialPlan, type PlanData } from "../shared/monetization";

async function run() {
  assert.equal(process.env.GCLOUD_PROJECT ?? "demo-revendasmart", "demo-revendasmart");
  assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^127\.0\.0\.1:\d+$/);
  assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "", /^127\.0\.0\.1:\d+$/);
  process.env.FIREBASE_PROJECT_ID = "demo-revendasmart";
  const admin = initializeFirebaseAdmin();
  const db = admin.firestore();
  const now = new Date();
  const before = new Date(now.getTime() - 60000).toISOString();
  const after = new Date(now.getTime() + 60000).toISOString();
  Object.assign(process.env, {
    MERCADOPAGO_ACCESS_TOKEN: "TEST-recording-provider-only",
    PRO_SUBSCRIPTION_ENABLED: "true", PREMIUM_V2_SUBSCRIPTION_ENABLED: "true",
    PRO_ANNUAL_SUBSCRIPTION_ENABLED: "true", PREMIUM_V2_ANNUAL_SUBSCRIPTION_ENABLED: "true",
    PRO_PRICE_BRL_CENTS: "4990", PREMIUM_V2_PRICE_BRL_CENTS: "7990",
    PRO_ANNUAL_PRICE_BRL_CENTS: "49900", PREMIUM_V2_ANNUAL_PRICE_BRL_CENTS: "79900",
    PRO_LAUNCH_PRICE_BRL_CENTS: "2990", PREMIUM_V2_LAUNCH_PRICE_BRL_CENTS: "4990",
    PRO_LAUNCH_ANNUAL_PRICE_BRL_CENTS: "29900", PREMIUM_V2_LAUNCH_ANNUAL_PRICE_BRL_CENTS: "49900",
    LAUNCH_OFFER_START: before, LAUNCH_OFFER_END: after,
  });
  assert.deepEqual(STANDARD_PRICE_CENTS, { free: { monthly: 0, annual: 0 }, pro: { monthly: 4990, annual: 49900 }, premium: { monthly: 7990, annual: 79900 } });
  assert.deepEqual(LAUNCH_PRICE_CENTS, { pro: { monthly: 2990, annual: 29900 }, premium: { monthly: 4990, annual: 49900 } });
  assert.equal(LEGACY_PREMIUM_PRICE_CENTS, 1990);
  assert.equal(annualSavings(2990, 29900).cents, 5980);
  assert.equal(annualSavings(4990, 49900).cents, 9980);

  for (const launch of [false, true]) {
    process.env.LAUNCH_OFFER_ENABLED = String(launch);
    for (const plan of ["pro", "premium"] as const) for (const cycle of ["monthly", "annual"] as const) {
      const uid = `pricing-${randomUUID()}`;
      const subId = `sub-${randomUUID()}`;
      const ref = db.doc(`users/${uid}/planData/main`);
      await ref.set({ currentPlan: "free", premiumActive: false });
      let calls = 0;
      const result = await createSubscriptionCommand(db, uid, "synthetic@example.test", plan, cycle, async (payload) => {
        calls++;
        assert.equal(payload.frequency, cycle === "annual" ? 12 : 1);
        assert.equal(payload.transactionAmountBRL, (launch ? LAUNCH_PRICE_CENTS : STANDARD_PRICE_CENTS)[plan][cycle] / 100);
        assert.equal(payload.externalReference, buildSubscriptionExternalReference(uid, plan, cycle));
        return { id: subId, init_point: "https://example.test/recorded-checkout" };
      });
      assert.ok(!("existing" in result));
      assert.equal(result.offerId, launch ? "launch" : "standard");
      assert.notEqual(result.priceCents, 1990);
      const contractRef = db.doc(`users/${uid}/subscriptionContracts/${subId}`);
      const contract = (await contractRef.get()).data();
      assert.equal(contract?.subscribedPriceCents, result.priceCents);
      process.env.LAUNCH_OFFER_END = before;
      const sync = async (status: "authorized" | "cancelled" | "expired") => syncSubscriptionFromProviderCommand(uid, subId, async () => ({
        externalReference: buildSubscriptionExternalReference(uid, plan, cycle), status,
        nextBillingDate: new Date(Date.now() + 86400000).toISOString(),
      }));
      await sync("authorized");
      assert.equal(resolveBaseCommercialPlan((await ref.get()).data() as PlanData), plan);
      assert.equal((await ref.get()).data()?.subscribedPriceCents, result.priceCents);
      await assert.rejects(syncSubscriptionFromProviderCommand(uid, subId, async () => { throw Error("synthetic provider outage"); }));
      assert.equal(resolveBaseCommercialPlan((await ref.get()).data() as PlanData), plan);
      const again = await createSubscriptionCommand(db, uid, "synthetic@example.test", plan, cycle, async () => { throw Error("duplicate provider call"); });
      assert.ok("existing" in again);
      await sync("cancelled");
      assert.equal((await ref.get()).data()?.subscribedPriceCents, result.priceCents);
      assert.deepEqual((await contractRef.get()).data(), contract);
      await ref.update({ paidThrough: new Date(Date.now() - 1000), nextBillingAt: new Date(Date.now() - 1000), paymentStatus: null });
      await sync("expired");
      assert.equal(resolveBaseCommercialPlan((await ref.get()).data() as PlanData), "free");
      const replacement = await createSubscriptionCommand(db, uid, "synthetic@example.test", plan, cycle, async (payload) => {
        assert.equal(payload.transactionAmountBRL, STANDARD_PRICE_CENTS[plan][cycle] / 100);
        return { id: `replacement-${randomUUID()}` };
      });
      assert.ok(!("existing" in replacement));
      assert.equal(replacement.offerId, "standard");
      assert.deepEqual((await contractRef.get()).data(), contract);
      assert.equal(calls, 1);
      process.env.LAUNCH_OFFER_END = after;
    }
  }
  process.env.LAUNCH_OFFER_ENABLED = "true";
  for (const time of [new Date(Date.parse(before) - 1), new Date(after)]) {
    assert.equal(resolveCommercialOffer({ plan: "premium", billingCycle: "annual", channel: "web", now: time }).offerId, "standard");
  }
  delete process.env.LAUNCH_OFFER_END;
  assert.equal(resolveCommercialOffer({ plan: "pro", billingCycle: "monthly", channel: "web" }).offerId, "standard");
  assert.equal(getPurchaseOffer("pro", "monthly", "android").available, false);
  process.env.PRO_PRICE_BRL_CENTS = "4990forged";
  assert.equal(getPurchaseOffer("pro", "monthly").available, false);
  process.env.PRO_PRICE_BRL_CENTS = "4990";
  for (const cycle of [null, undefined, "yearly", "12months", "year"]) {
    await assert.rejects(createSubscriptionCommand(db, "synthetic", "test@example.test", "pro", cycle, async () => { throw Error("must not call"); }), /Cadência/);
  }
  const legacyUid = `legacy-${randomUUID()}`;
  const legacyRef = db.doc(`users/${legacyUid}/planData/main`);
  await legacyRef.set({ currentPlan: "premium", premiumActive: true, premiumSource: "subscription", subscriptionStatus: "authorized", subscriptionId: "legacy-sub", subscribedPriceCents: 1990 });
  const legacyBefore = (await legacyRef.get()).data();
  const blocked = await createSubscriptionCommand(db, legacyUid, "test@example.test", "premium", "annual", async () => { throw Error("must not reprice legacy"); });
  assert.ok("existing" in blocked);
  assert.deepEqual((await legacyRef.get()).data(), legacyBefore);
  assert.equal(resolveBaseCommercialPlan(legacyBefore as PlanData), "premium");
  assert.deepEqual(parseSubscriptionExternalReference(legacyUid), { kind: "legacy", uid: legacyUid });

  // Exercise the retired HTTP route, including a forged client amount/offer.
  const app = express();
  app.use(express.json());
  registerSubscriptionRoutes(app, (req, _res, next) => { (req as any).firebaseUid = "synthetic-retired-new-user"; next(); });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/app-subscription/create`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: 1990, offerId: "legacy_1990" }) });
    assert.equal(response.status, 410);
    assert.equal((await response.json()).error, "LEGACY_OFFER_RETIRED");
  } finally { server.close(); }
  console.log("RC-P0-PRICING PASS: PC1-PC12, launch boundaries, eight contracts, monthly/annual lifecycle, retention, resubscription, legacy preservation, retired HTTP route, Android unavailable. REAL_PROVIDER_CALLS=0");
  await admin.app().delete();
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
