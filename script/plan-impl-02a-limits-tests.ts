import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canAddProduct,
  canAddClient,
  canAddService,
  getLimitStatus,
  buildPlanUsageSnapshot,
  resolveCommercialPlan,
  type PlanData,
} from "../shared/monetization";
import { checkProductLimit, checkClientLimit, checkServiceLimit } from "../client/src/lib/plan-helpers";

/**
 * PLAN-IMPL-02A — L1-L11/T1-T3.
 *
 * This pure suite covers product/client/service limits. Monthly booking quota now
 * has its own server-side tenant timezone and dedicated integration tests; those
 * runtime scenarios are not executed or certified by this file.
 */

function run(): void {
  // L1-L3 — product boundaries (regression: PLAN-IMPL-01 already fixed and tested these; re-confirmed
  // here because PLAN-IMPL-02A §3 requires PRODUCT_LIMIT_REGRESSION=NO as part of this ticket's own gate).
  assert.equal(canAddProduct("free", 29), true, "L1: Free must allow the 30th product");
  assert.equal(canAddProduct("free", 30), false, "L1: Free must reject the 31st product");
  assert.equal(canAddProduct("pro", 499), true, "L2: Pro must allow the 500th product");
  assert.equal(canAddProduct("pro", 500), false, "L2: Pro must reject the 501st product");
  assert.equal(canAddProduct("premium", 1999), true, "L3: Premium must allow the 2000th product");
  assert.equal(canAddProduct("premium", 2000), false, "L3: Premium must reject the 2001st product");

  // L4-L6 — client boundaries, per PLAN-IMPL-02A §4 exactly.
  assert.equal(canAddClient("free", 49), true, "L4: Free must allow the 50th client");
  assert.equal(checkClientLimit("free", 49).allowed, true);
  assert.equal(canAddClient("free", 50), false, "L4: Free must reject the 51st client");
  assert.equal(checkClientLimit("free", 50).allowed, false);
  assert.equal(canAddClient("pro", 1999), true, "L5: Pro must allow the 2000th client");
  assert.equal(canAddClient("pro", 2000), false, "L5: Pro must reject the 2001st client");
  assert.equal(canAddClient("premium", 9999), true, "L6: Premium must allow the 10000th client");
  assert.equal(canAddClient("premium", 10000), false, "L6: Premium must reject the 10001st client");

  // L7-L9 — service boundaries, per PLAN-IMPL-02A §8 exactly.
  assert.equal(canAddService("free", 4), true, "L7: Free must allow the 5th service");
  assert.equal(checkServiceLimit("free", 4).allowed, true);
  assert.equal(canAddService("free", 5), false, "L7: Free must reject the 6th service");
  assert.equal(checkServiceLimit("free", 5).allowed, false);
  assert.equal(canAddService("pro", 49), true, "L8: Pro must allow the 50th service");
  assert.equal(canAddService("pro", 50), false, "L8: Pro must reject the 51st service");
  assert.equal(canAddService("premium", 199), true, "L9: Premium must allow the 200th service");
  assert.equal(canAddService("premium", 200), false, "L9: Premium must reject the 201st service");

  // L10 — over-limit is DETECTED as pure data, never a side-effecting deletion. getLimitStatus takes a
  // plain count/limit pair and returns a plain object — there is no Firestore call, no mutation, nothing
  // it could delete even if it wanted to; this is provable by its signature, not just by inspection.
  const over = getLimitStatus(35, 30);
  assert.equal(over.overLimit, true, "L10: 35 of 30 must report overLimit");
  assert.equal(over.overBy, 5, "L10: 35 of 30 must report overBy=5");
  assert.equal(over.withinLimit, false);
  assert.equal(over.atLimit, false);
  const atLimit = getLimitStatus(30, 30);
  assert.deepEqual(atLimit, { withinLimit: false, atLimit: true, overLimit: false, remaining: 0, overBy: 0 });
  const within = getLimitStatus(10, 30);
  assert.deepEqual(within, { withinLimit: true, atLimit: false, overLimit: false, remaining: 20, overBy: 0 });
  // UNLIMITED sentinel never reports at/over limit, matching canAddProduct/canAddClient/canAddService.
  const unlimited = getLimitStatus(999_999, -1);
  assert.deepEqual(unlimited, { withinLimit: true, atLimit: false, overLimit: false, remaining: Infinity, overBy: 0 });

  // L11 — being over limit blocks only NEW creation (canAdd*/check* return false); it says nothing about,
  // and never touches, any existing record. The two facts co-exist deliberately: overLimit=true (L10) and
  // canAddProduct=false (creation blocked) are both true for the same count/limit pair, with no code path
  // connecting either to deleting/archiving the 5 existing-but-excess records.
  assert.equal(getLimitStatus(35, 30).overLimit, true);
  assert.equal(canAddProduct("free", 35), false, "L11: over-limit count must block a new product");
  assert.equal(canAddClient("free", 55), false, "L11: over-limit count must block a new client");
  assert.equal(canAddService("free", 8), false, "L11: over-limit count must block a new service");
  // buildPlanUsageSnapshot: same over-limit tenant, read-only summary, still no deletion anywhere.
  // PLAN-IMPL-02B1 — signature now takes {active, preserved} per domain instead of a flat count; a
  // pre-reconciliation tenant (never touched by reconcilePlanAccess) is represented as everything
  // "active" with preserved=0, matching resolvePlanAccessState's own backward-compat default.
  const snapshot = buildPlanUsageSnapshot("free", { products: { active: 35, preserved: 0 }, clients: 55, services: { active: 8, preserved: 0 } });
  assert.equal(snapshot.products.status, "overLimit");
  assert.equal(snapshot.products.overBy, 5);
  assert.equal(snapshot.clients.status, "overLimit");
  assert.equal(snapshot.services.status, "overLimit");
  // No monthly booking usage was supplied to this snapshot; do not fabricate it.
  assert.equal(snapshot.bookingsCurrentMonth, null, "a snapshot without monthly booking usage must not invent a count");
  // PLAN-IMPL-02B1 §28 — active/preserved counts and selectionRequired now exist on the snapshot.
  assert.equal(snapshot.products.active, 35);
  assert.equal(snapshot.products.preserved, 0);
  assert.equal(snapshot.selectionRequired, false, "no preserved documents yet must mean selectionRequired=false");

  // T1 — tenant isolation: every limit function is pure and takes counts as plain arguments, never reads
  // any shared/global state — calling the same function back-to-back with different counts (simulating
  // two different tenants) must never let one call's count leak into the other's result.
  const tenantA = canAddProduct("free", 29);
  const tenantB = canAddProduct("free", 30);
  assert.equal(tenantA, true, "T1: tenant A's own count must decide tenant A's result");
  assert.equal(tenantB, false, "T1: tenant B's own count must decide tenant B's result, unaffected by A's call");
  const snapshotA = buildPlanUsageSnapshot("free", { products: { active: 5, preserved: 0 }, clients: 5, services: { active: 1, preserved: 0 } });
  const snapshotB = buildPlanUsageSnapshot("premium", { products: { active: 5, preserved: 0 }, clients: 5, services: { active: 1, preserved: 0 } });
  assert.notEqual(snapshotA.products.limit, snapshotB.products.limit, "T1: identical counts under different plans must never be conflated");

  // T2 — admin/internal override preserved (also covered from a different angle in PLAN-IMPL-01's P23;
  // re-confirmed here since PLAN-IMPL-02A touched checkProductLimit's internal bypass condition again).
  assert.equal(checkProductLimit("admin", 999_999).allowed, true, "T2: admin bypass must remain intact");
  assert.equal(checkProductLimit("free", 30, true).allowed, true, "T2: an explicit legitimate openAccess bypass must still work");
  assert.equal(checkClientLimit("free", 50, true).allowed, true, "T2: checkClientLimit's openAccess bypass must still work");
  assert.equal(checkServiceLimit("free", 5, true).allowed, true, "T2: checkServiceLimit's openAccess bypass must still work");

  // T3 — invalid plan falls back safely (re-confirmed from PLAN-IMPL-01's P6; resolveCommercialPlan is
  // the shared authority every new check in this ticket builds on).
  const corrupted = { currentPlan: "not-a-real-plan" } as unknown as PlanData;
  assert.doesNotThrow(() => resolveCommercialPlan(corrupted));
  assert.equal(resolveCommercialPlan(corrupted), "free", "T3: an invalid currentPlan must fall back to free");
  assert.equal(resolveCommercialPlan(null), "free", "T3: null planData must fall back to free");

  // Source-level regression guards: confirm the actual fixes exist in the 4 real client-creation paths and
  // in the booking transaction, not just that the underlying helpers behave correctly in isolation.
  const sellSource = readFileSync("client/src/pages/sell.tsx", "utf-8");
  assert.match(sellSource, /checkClientLimit\(activePlan, clientCountSnapshot\.data\(\)\.count\)/, "sell.tsx's quick-add client flow must be plan-limited");

  const useCreateClientSource = readFileSync("client/src/hooks/useCreateClient.ts", "utf-8");
  assert.match(useCreateClientSource, /checkClientLimit\(activePlan, clientCountSnapshot\.data\(\)\.count\)/, "useCreateClient.ts (NewOrderSheet's quick-add) must be plan-limited");

  const servicesPersistenceSource = readFileSync("client/src/lib/services-persistence.ts", "utf-8");
  // RS-SERVICOS-01R extracted the advisory count check; creation itself is now
  // server-authoritative. Guard the complete path rather than its old variable names.
  assert.match(servicesPersistenceSource, /return runWithServiceQuotaPrecheck\(\s*input\.activePlan,\s*async \(\) => \(await getCountFromServer\(servicesCollection\(uid\)\)\)\.data\(\)\.count,/, "createService must pass its current plan and fresh count to the precheck");
  assert.match(servicesPersistenceSource, /checkServiceLimit\(activePlan, await readCount\(\)\)/, "the extracted precheck must still enforce the actual service limit");
  assert.match(servicesPersistenceSource, /apiRequest<[^>]+>\("\/api\/services",\s*\{\s*method: "POST",\s*auth: true,/, "service creation must use the authenticated server command");
  const authoritativeSource = readFileSync("server/plan-authoritative-mutations.ts", "utf-8");
  const createServiceCommand = authoritativeSource.slice(authoritativeSource.indexOf("export async function createServiceCommand"), authoritativeSource.indexOf("export async function createClientInTransaction"));
  assert.match(createServiceCommand, /await ensureLifecycleForPlanSensitiveMutation\(db, uid\)/, "service creation must fail closed if plan lifecycle cannot be resolved");
  assert.match(createServiceCommand, /await resolveServerPlan\(db, uid\)/, "the server must resolve the authoritative plan, not trust the caller's plan");
  assert.match(createServiceCommand, /db\.runTransaction/, "quota and creation must share a transaction");
  const quotaCheck = createServiceCommand.indexOf('assertWithinLimit("service", plan, usage.servicesCount)');
  const serviceWrite = createServiceCommand.indexOf("tx.set(docRef, service)");
  assert.ok(quotaCheck >= 0 && serviceWrite > quotaCheck, "the service quota check must precede the first creation write");

  const bookingCommandsSource = readFileSync("server/service-booking-commands.ts", "utf-8");
  // D2 (5a5a70a): public confirmation stores a contact snapshot and never creates
  // a CRM Client. Client creation is now a separate authenticated command, where
  // the canonical CRM quota must still be enforced. Scope guards to each command.
  const confirmationStart = bookingCommandsSource.indexOf("export async function confirmServiceBookingHoldCommand");
  const confirmationEnd = bookingCommandsSource.indexOf("export async function releaseServiceBookingHoldCommand", confirmationStart);
  assert.ok(confirmationStart >= 0 && confirmationEnd > confirmationStart);
  const confirmationSource = bookingCommandsSource.slice(confirmationStart, confirmationEnd);
  assert.doesNotMatch(
    confirmationSource,
    /throw new ServiceBookingCommandError\("CLIENT_LIMIT_REACHED"/,
    "confirmServiceBookingHoldCommand must never abort a booking solely because the Client quota is full",
  );
  assert.doesNotMatch(
    confirmationSource,
    /clientCountSnap/,
    "the booking transaction must no longer read its own independent Client-count aggregation — only the canonical planUsage/summary.clientsCount counter (via createClientInTransaction) may decide the quota",
  );
  assert.doesNotMatch(confirmationSource, /createClientInTransaction/, "public confirmation must not create a CRM Client as a side effect");
  assert.match(confirmationSource, /const customerId = contact \? undefined : hold\.customerId/, "declared public contact must not become a fabricated CRM identity");
  assert.match(confirmationSource, /assertValidBookingContactSnapshot\(\{ name: contact\.name, phone: contact\.phone \}\)/, "public contact must remain validated and preserved as a snapshot");
  assert.match(confirmationSource, /isWithinBookingsMonthlyLimit\(plan, monthlyUsage\.confirmedCount\)/, "the separate booking quota remains enforced");
  const explicitStart = bookingCommandsSource.indexOf("export async function createClientFromServiceBookingCommand");
  const explicitEnd = bookingCommandsSource.indexOf("function sendServiceBookingCommandError", explicitStart);
  assert.ok(explicitStart >= 0 && explicitEnd > explicitStart);
  const explicitCreationSource = bookingCommandsSource.slice(explicitStart, explicitEnd);
  assert.match(explicitCreationSource, /await createClientInTransaction\(tx, db, uid, customerId,/, "explicit CRM creation must use the canonical transactional quota authority");
  assert.match(explicitCreationSource, /error instanceof PlanMutationError && error\.code === "PLAN_LIMIT_REACHED"/, "explicit creation must preserve CRM quota rejection");
  assert.match(explicitCreationSource, /throw new ServiceBookingCommandError\("CLIENT_LIMIT_REACHED"/, "explicit creation reports the quota failure instead of swallowing it");
  const clientCreateAttemptIndex = explicitCreationSource.indexOf("await createClientInTransaction(tx, db, uid, customerId");
  const firstOtherWriteIndex = explicitCreationSource.indexOf("tx.update(bookingDocRef, patch)");
  assert.ok(clientCreateAttemptIndex > 0 && firstOtherWriteIndex > clientCreateAttemptIndex, "CRM quota must be checked before any association writes");

  console.log(
    "PLAN-IMPL-02A limits tests passed: L1-L11 (product/client/service boundaries per tier, over-limit " +
    "detected as pure data never a deletion, over-limit blocks only new creation), T1-T3 (tenant " +
    "isolation, admin/internal override intact, invalid plan falls back safely), source-verified for " +
    "client creation paths, server-authoritative services and explicit booking-to-CRM creation. Monthly " +
    "booking runtime scenarios are outside this pure suite.",
  );
}

run();
