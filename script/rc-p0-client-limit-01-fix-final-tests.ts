import assert from "node:assert/strict";
import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, doc, getFirestore, setDoc, deleteDoc, type Firestore as ClientFirestore } from "firebase/firestore";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";
import {
  createClientCommand,
  deleteClientCommand,
  createProductCommand,
  createServiceCommand,
  PlanMutationError,
} from "../server/plan-authoritative-mutations";
import { upsertServiceResourceScheduleCommand } from "../server/service-availability-commands";
import { createServiceBookingHoldCommand, confirmServiceBookingHoldCommand } from "../server/service-booking-commands";
import type { WeeklyHours } from "../shared/service-availability";

/**
 * RC-P0-CLIENT-LIMIT-01-FIX-FINAL — runtime/emulator proof for the 3 defects reconciled on top of
 * 4c6537c (delete counter drift, public-booking counter unification, resource-specific/durable/
 * concurrency-safe initialization). Every assertion here exercises the real transactional commands
 * against the Auth+Firestore emulator — none of this is satisfied by source-text regex alone.
 */

const PROJECT_ID = "demo-revendasmart";
const NOW = "2026-09-09T00:00:00.000Z";

function requireLocalEmulators() {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
  assert.notEqual(process.env.GOOGLE_CLOUD_PROJECT, "revenda-smart");
}

function uidFor(label: string): string {
  return `rcp0cl-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function seedPlan(db: FirebaseFirestore.Firestore, uid: string, plan: "free" | "pro" | "premium") {
  await db.collection("users").doc(uid).collection("planData").doc("main").set({
    currentPlan: plan,
    premiumActive: plan === "premium",
    premiumExpiresAt: null,
    premiumStartedAt: null,
    premiumSource: plan === "premium" ? "admin" : null,
    referralCode: "",
    referralCount: 0,
    updatedAt: NOW,
    subscriptionId: null,
    subscriptionStatus: null,
    subscriptionPlanId: null,
    autoRenew: false,
    lastPaymentAt: null,
    nextBillingAt: null,
    canceledAt: null,
    paymentStatus: null,
  });
}

function validClientPayload(id: string) {
  return { id, name: `Cliente ${id}`, phone: "+55 11 90000-0000" };
}

/** Simula clientes "legados" já existentes ANTES deste sistema de cota (criados por escrita direta, nunca
 * contados em planUsage/summary.clientsCount) — exatamente o cenário real que motivou este ticket. */
async function seedLegacyClients(db: FirebaseFirestore.Firestore, uid: string, count: number) {
  const batch = db.batch();
  for (let i = 0; i < count; i += 1) {
    const id = `legacy-client-${i}`;
    batch.set(db.collection("users").doc(uid).collection("clients").doc(id), validClientPayload(id));
  }
  await batch.commit();
}

async function countClientDocs(db: FirebaseFirestore.Firestore, uid: string): Promise<number> {
  const snap = await db.collection("users").doc(uid).collection("clients").count().get();
  return snap.data().count;
}

async function readUsage(db: FirebaseFirestore.Firestore, uid: string): Promise<Record<string, unknown> | undefined> {
  const snap = await db.collection("users").doc(uid).collection("planUsage").doc("summary").get();
  return snap.exists ? snap.data() : undefined;
}

function createClient(db: FirebaseFirestore.Firestore, uid: string, id: string) {
  return createClientCommand(db, uid, { clientId: id, client: validClientPayload(id), idempotencyKey: `idem-create-${id}` });
}

function deleteClient(db: FirebaseFirestore.Firestore, uid: string, id: string) {
  return deleteClientCommand(db, uid, id);
}

async function expectLimitReached(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    assert.ok(error instanceof PlanMutationError, `${label}: erro deve usar o contrato PlanMutationError`);
    assert.equal((error as PlanMutationError).code, "PLAN_LIMIT_REACHED", label);
    console.log(`PASS ${label}`);
    return;
  }
  throw new Error(`${label}: esperava PLAN_LIMIT_REACHED`);
}

function validProduct(id: string) {
  return {
    id, name: `Produto ${id}`, brand: "Marca", origin: "Brasil", category: "Teste", productType: "Geral",
    costPrice: 10, salePrice: 20, stock: 1,
  };
}

function validService(id: string, uid: string, overrides: Record<string, unknown> = {}) {
  return {
    id, tenantUid: uid, name: "Corte de cabelo", active: true, published: true,
    pricing: { mode: "fixed", priceCents: 8000 }, cost: { kind: "unknown" },
    durationMinutes: 30, bookingMode: "instant",
    createdAt: NOW, updatedAt: NOW,
    ...overrides,
  };
}

async function seedService(db: FirebaseFirestore.Firestore, uid: string, id: string, overrides: Record<string, unknown> = {}) {
  await db.collection("users").doc(uid).collection("services").doc(id).set(validService(id, uid, overrides));
}

function allDayWeek(): WeeklyHours {
  const period = [{ start: "00:00", end: "23:45" }];
  return { sunday: period, monday: period, tuesday: period, wednesday: period, thursday: period, friday: period, saturday: period };
}

function futureSlot(daysAhead: number, hour = 14): string {
  const base = new Date(Date.now() + daysAhead * 24 * 60 * 60_000);
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hour, 0, 0, 0)).toISOString();
}

type ClientContext = { app: FirebaseApp; auth: Auth; db: ClientFirestore; uid?: string };

function createClientContext(label: string): ClientContext {
  const app = initializeApp(
    { apiKey: "demo-api-key", authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID, appId: `rcp0cl-${label}` },
    `rcp0cl-${label}-${Date.now()}-${Math.random()}`,
  );
  const auth = getAuth(app);
  const db = getFirestore(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  return { app, auth, db };
}

async function signIn(context: ClientContext, label: string) {
  const credential = await createUserWithEmailAndPassword(
    context.auth,
    `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
    "LocalTestPassword!123",
  );
  context.uid = credential.user.uid;
  return credential.user.uid;
}

/** Cria hold + service + schedule mínimos necessários para confirmServiceBookingHoldCommand, reusando o
 * mesmo padrão já aprovado em script/service-public-booking-tests.ts (nenhuma lógica de Availability
 * reimplementada aqui — só o setup mínimo para chegar a uma confirmação válida). */
async function createHoldForClientContactTest(db: FirebaseFirestore.Firestore, uid: string, label: string, dayOffset: number) {
  const serviceId = `svc-${label}`;
  await seedService(db, uid, serviceId);
  await upsertServiceResourceScheduleCommand(db, uid, "default", { timezone: "UTC", slotStepMinutes: 30, weeklyHours: allDayWeek() }, `sched-${label}`);
  const slot = futureSlot(10 + dayOffset);
  const hold = await createServiceBookingHoldCommand(db, uid, serviceId, "default", slot, undefined, `hold-${label}`);
  return (hold as { holdId: string }).holdId;
}

async function run() {
  requireLocalEmulators();
  process.env.FIREBASE_PROJECT_ID = PROJECT_ID;
  initializeFirebaseAdmin();
  const db = initializeFirebaseAdmin().firestore();

  // ===== D2/D5 — create/delete/create keeps the counter exact, over-limit recovery via delete =====
  {
    const uid = uidFor("d2");
    await seedPlan(db, uid, "free");
    await seedLegacyClients(db, uid, 49);
    await createClient(db, uid, "d2-fill-50"); // triggers first-use init: aggregates 49 legacy + this create -> 50
    assert.equal(await countClientDocs(db, uid), 50, "D2: 49 legacy + 1 create = 50 real docs");
    const usageAfterFill = await readUsage(db, uid);
    assert.equal(usageAfterFill?.clientsCount, 50, "D2: clientsCount accurately reflects 50 after first-use init + increment");

    await expectLimitReached("D2 #51 denied at cap", () => createClient(db, uid, "d2-51-denied"));
    assert.equal(await countClientDocs(db, uid), 50, "D2: denied create must not create a doc");

    await deleteClient(db, uid, "legacy-client-0");
    const usageAfterDelete = await readUsage(db, uid);
    assert.equal(usageAfterDelete?.clientsCount, 49, "D2: delete must decrement clientsCount atomically");
    assert.equal(await countClientDocs(db, uid), 49, "D2: delete must remove the real doc");

    await createClient(db, uid, "d2-recreate");
    const usageAfterRecreate = await readUsage(db, uid);
    assert.equal(usageAfterRecreate?.clientsCount, 50, "D2: create after delete restores clientsCount to 50, no drift");
    assert.equal(await countClientDocs(db, uid), 50, "D2: final real doc count = 50, matches clientsCount exactly");
    console.log("PASS D2 create/delete/create keeps counter == doc count");

    // Repeated delete of the SAME (already-deleted) id must be a safe no-op, never a double decrement.
    const beforeRepeat = await readUsage(db, uid);
    const repeatResult = await deleteClient(db, uid, "legacy-client-0");
    assert.equal((repeatResult as { deleted: boolean }).deleted, false, "repeated delete of an already-gone client must report deleted:false");
    const afterRepeat = await readUsage(db, uid);
    assert.equal(afterRepeat?.clientsCount, beforeRepeat?.clientsCount, "repeated delete must not decrement the counter a second time");
    console.log("PASS repeated delete does not double-decrement");
  }

  // ===== D4/§16 — over-limit initialization must count ALL existing docs, not just new ones =====
  {
    const uid = uidFor("d4");
    await seedPlan(db, uid, "free");
    await seedLegacyClients(db, uid, 60); // over the Free cap of 50, never touched by any command yet
    await expectLimitReached("D4 over-limit initialization denies create", () => createClient(db, uid, "d4-denied"));
    // Note: Firestore transactions are all-or-nothing — since assertWithinLimit throws INSIDE the same
    // transaction that lazily initializes the counter, the whole transaction (including that lazy write)
    // rolls back on denial. This is the same pre-existing behavior products/services already had. The
    // real, durable invariant is proven by the NEXT operation below (a delete, which does not throw and
    // therefore does commit), not by inspecting the doc immediately after a denied attempt.
    assert.equal(await countClientDocs(db, uid), 60, "D4: existing over-limit data must never be deleted");
    console.log("PASS D4 existing over-limit initialization + denial");

    // D4 recovery: delete until back under the limit, then confirm the next create is allowed.
    for (let i = 0; i < 11; i += 1) await deleteClient(db, uid, `legacy-client-${i}`); // 60 -> 49
    const usageAfterDeletes = await readUsage(db, uid);
    assert.equal(usageAfterDeletes?.clientsCount, 49, "D4: usage must track down to 49 after 11 deletes");
    await createClient(db, uid, "d4-recovered");
    const usageAfterRecover = await readUsage(db, uid);
    assert.equal(usageAfterRecover?.clientsCount, 50, "D4: create is allowed again once usage drops below the limit");
    assert.equal(await countClientDocs(db, uid), 50, "D4: final real doc count = 50 after downgrade-style recovery");
    console.log("PASS D4 downgrade-style delete-then-create recovery");
  }

  // ===== D1/D3/T9/§14 — missing-counter concurrent initialization must never over-admit =====
  {
    const uid = uidFor("d1d3");
    await seedPlan(db, uid, "free");
    await seedLegacyClients(db, uid, 49); // counter never initialized; exactly 1 real slot remains under Free=50
    const results = await Promise.allSettled([createClient(db, uid, "race-a"), createClient(db, uid, "race-b")]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejectedWithLimit = results.filter((r) => r.status === "rejected" && (r as PromiseRejectedResult).reason instanceof PlanMutationError && (r as PromiseRejectedResult).reason.code === "PLAN_LIMIT_REACHED");
    assert.equal(fulfilled.length, 1, "D1/D3: exactly one concurrent create must succeed when the counter is missing and only 1 slot remains");
    assert.equal(rejectedWithLimit.length, 1, "D1/D3: exactly one concurrent create must be rejected with PLAN_LIMIT_REACHED");
    assert.equal(await countClientDocs(db, uid), 50, "D1/D3: final real doc count must be exactly 50, never 51");
    const usage = await readUsage(db, uid);
    assert.equal(usage?.clientsCount, 50, "D1/D3: authoritative counter must equal real doc count after the race, no drift from missing-counter initialization");
    console.log("PASS D1/D3/T9 missing-counter concurrent initialization is race-safe");
  }

  // ===== D8/D9/§10 — direct Firestore create/delete denied by Rules for both authenticated owner =====
  {
    const owner = createClientContext("owner");
    const ownerUid = await signIn(owner, "owner");
    await seedPlan(db, ownerUid, "free");
    await db.collection("users").doc(ownerUid).collection("clients").doc("rules-target").set(validClientPayload("rules-target"));

    let createDenied = false;
    try {
      await setDoc(doc(owner.db, "users", ownerUid, "clients", "direct-create-attempt"), validClientPayload("direct-create-attempt"));
    } catch (error) {
      createDenied = true;
      assert.notEqual((error as { code?: string }).code, "unavailable", "D8: emulator must be reachable");
    }
    assert.ok(createDenied, "D8: direct Firestore Client create must be denied by Rules for the owner's own uid");
    console.log("PASS D8 direct Firestore Client create denied");

    let deleteDenied = false;
    try {
      await deleteDoc(doc(owner.db, "users", ownerUid, "clients", "rules-target"));
    } catch (error) {
      deleteDenied = true;
      assert.notEqual((error as { code?: string }).code, "unavailable", "D9: emulator must be reachable");
    }
    assert.ok(deleteDenied, "D9: direct Firestore Client delete must be denied by Rules, even for the owning uid");
    assert.equal(await countClientDocs(db, ownerUid), 1, "D9: the doc must still exist after the denied direct delete attempt");
    console.log("PASS D9 direct Firestore Client delete denied");

    // §18/§19 — blocking direct create/delete must not regress owner update, and cross-user access must
    // remain denied (both pre-existing invariants this ticket must preserve, not newly implement).
    await setDoc(doc(owner.db, "users", ownerUid, "clients", "rules-target"), { name: "Nome Atualizado" }, { merge: true });
    console.log("PASS CLIENT_RULES_OWNER_UPDATE_PASS owner update still allowed");

    const intruder = createClientContext("intruder");
    const intruderUid = await signIn(intruder, "intruder");
    await seedPlan(db, intruderUid, "free");
    let crossUserDenied = false;
    try {
      await setDoc(doc(intruder.db, "users", ownerUid, "clients", "rules-target"), { name: "Invasor" }, { merge: true });
    } catch (error) {
      crossUserDenied = true;
      assert.notEqual((error as { code?: string }).code, "unavailable", "CLIENT_RULES_CROSS_USER_PASS: emulator must be reachable");
    }
    assert.ok(crossUserDenied, "CLIENT_RULES_CROSS_USER_PASS: a different authenticated user must never mutate another tenant's Client");
    console.log("PASS CLIENT_RULES_CROSS_USER_PASS cross-user mutation denied");

    await deleteApp(owner.app);
    await deleteApp(intruder.app);
  }

  // ===== D10/T7/§12 — Product create must never touch/aggregate the Client counter =====
  {
    const uid = uidFor("d10");
    await seedPlan(db, uid, "free");
    await seedLegacyClients(db, uid, 5); // real clients exist, but the counter has never been touched
    await createProductCommand(db, uid, { productId: "p1", product: validProduct("p1"), idempotencyKey: "idem-p1" });
    const usage = await readUsage(db, uid);
    assert.equal(usage?.productsCount, 1, "D10: productsCount must be correctly initialized by the product create");
    assert.equal(typeof usage?.clientsCount, "undefined", "D10/T7: clientsCount must remain ABSENT — a product create must never aggregate or initialize the unrelated Client counter");
    console.log("PASS D10/T7 Product create never aggregates Clients");
  }

  // ===== D11/T8/§12 — Service create must never touch/aggregate the Client counter =====
  {
    const uid = uidFor("d11");
    await seedPlan(db, uid, "free");
    await seedLegacyClients(db, uid, 5);
    await createServiceCommand(db, uid, { serviceId: "s1", service: validService("s1", uid), idempotencyKey: "idem-s1" });
    const usage = await readUsage(db, uid);
    assert.equal(usage?.servicesCount, 1, "D11: servicesCount must be correctly initialized by the service create");
    assert.equal(typeof usage?.clientsCount, "undefined", "D11/T8: clientsCount must remain ABSENT — a service create must never aggregate or initialize the unrelated Client counter");
    console.log("PASS D11/T8 Service create never aggregates Clients");
  }

  // ===== D6/§8/§9 + D2 — public booking with an available Client slot: booking succeeds, but does not
  // create/associate a Client or touch the canonical Client counter =====
  {
    const uid = uidFor("d6ok");
    await seedPlan(db, uid, "free");
    const holdId = await createHoldForClientContactTest(db, uid, "d6ok", 0);
    const result = await confirmServiceBookingHoldCommand(db, uid, holdId, `confirm-${uid}`, {
      source: "public",
      publicCustomerContact: { name: "Cliente Público", phone: "+55 11 98888-0000" },
    });
    assert.equal((result as { idempotentReplay: boolean }).idempotentReplay, false, "D6: booking must succeed as a genuinely new confirmation");
    assert.equal(await countClientDocs(db, uid), 0, "D6/D2: public booking must not create a Client even when quota is available");
    const usage = await readUsage(db, uid);
    assert.equal(typeof usage?.clientsCount, "undefined", "D6/D2: public booking must not initialize or increment clientsCount");
    const booking = (await db.doc(`users/${uid}/bookings/booking-${holdId}`).get()).data();
    const work = (await db.doc(`users/${uid}/serviceWorks/booking-work-${holdId}`).get()).data();
    assert.equal(booking?.customerId, undefined, "D6/D2: public booking must not auto-associate customerId");
    assert.equal(work?.customerId, undefined, "D6/D2: Work must not auto-associate customerId");
    console.log("PASS D6 public booking with available slot does not create Client or counter");
  }

  // ===== D6/§8/§9 — public booking at Client quota: booking STILL succeeds, NO new Client is created =====
  {
    const uid = uidFor("d6full");
    await seedPlan(db, uid, "free");
    await seedLegacyClients(db, uid, 50); // at the Free cap, counter not yet initialized
    const holdId = await createHoldForClientContactTest(db, uid, "d6full", 1);
    const result = await confirmServiceBookingHoldCommand(db, uid, holdId, `confirm-full-${uid}`, {
      source: "public",
      publicCustomerContact: { name: "Cliente Sem Vaga", phone: "+55 11 97777-0000" },
    });
    assert.equal((result as { idempotentReplay: boolean }).idempotentReplay, false, "D6-full: the booking itself must still succeed even when Client quota is exhausted");
    assert.equal(await countClientDocs(db, uid), 50, "D6-full: no new Client doc may be created when quota is full — real count stays at 50");
    const usage = await readUsage(db, uid);
    assert.equal(typeof usage?.clientsCount, "undefined", "D6-full/D2: public booking must not initialize the unrelated Client counter");
    // Confirm the Booking/Work themselves were genuinely created (booking is never silently dropped).
    const bookingsSnap = await db.collection("users").doc(uid).collection("bookings").get();
    assert.equal(bookingsSnap.size, 1, "D6-full: exactly 1 Booking must exist even though no Client was created");
    console.log("PASS D6-full public booking at Client quota still succeeds, skips Client creation");
  }

  // ===== D7/§10 — normal create vs public booking racing for the last Client slot: at most one wins,
  // the booking ALWAYS succeeds regardless of which one wins =====
  {
    const uid = uidFor("d7");
    await seedPlan(db, uid, "free");
    await seedLegacyClients(db, uid, 49); // exactly 1 slot remains
    const holdId = await createHoldForClientContactTest(db, uid, "d7", 2);
    const [normalResult, bookingResult] = await Promise.allSettled([
      createClient(db, uid, "race-normal-create"),
      confirmServiceBookingHoldCommand(db, uid, holdId, `confirm-race-${uid}`, {
        source: "public",
        publicCustomerContact: { name: "Cliente Corrida", phone: "+55 11 96666-0000" },
      }),
    ]);
    // The booking transaction itself must NEVER fail because of the Client-quota race — only the
    // Client-creation portion inside it may be silently skipped.
    assert.equal(bookingResult.status, "fulfilled", "D7: the public booking must always succeed, win or lose the Client-quota race");
    const booking = (await db.doc(`users/${uid}/bookings/booking-${holdId}`).get()).data();
    const work = (await db.doc(`users/${uid}/serviceWorks/booking-work-${holdId}`).get()).data();
    const expectedContact = { name: "Cliente Corrida", phone: "+55 11 96666-0000" };
    assert.deepEqual(booking?.customerContactSnapshot, expectedContact);
    assert.deepEqual(work?.customerContactSnapshot, expectedContact);
    assert.equal(booking?.customerId, undefined, "D7/D2: public booking never consumes the last Client slot");
    assert.equal(work?.customerId, undefined, "D7/D2: Work remains unassociated until an explicit command");
    const finalDocCount = await countClientDocs(db, uid);
    assert.equal(finalDocCount, 50, "D7: at most one new Client document may be created — final count must be exactly 50, never 51");
    const usage = await readUsage(db, uid);
    assert.equal(usage?.clientsCount, 50, "D7: authoritative counter must match the real doc count exactly after the cross-path race");
    const normalSucceeded = normalResult.status === "fulfilled";
    const normalRejectedWithLimit = normalResult.status === "rejected" && (normalResult as PromiseRejectedResult).reason instanceof PlanMutationError && (normalResult as PromiseRejectedResult).reason.code === "PLAN_LIMIT_REACHED";
    assert.ok(normalSucceeded || normalRejectedWithLimit, "D7: the normal create must either succeed or be cleanly rejected with PLAN_LIMIT_REACHED, nothing else");
    console.log(`PASS D7 booking vs normal-create race is safe (normal create ${normalSucceeded ? "won" : "lost"} the last slot; booking succeeded either way)`);
  }

  console.log(
    "RC-P0-CLIENT-LIMIT-01-FIX-FINAL tests passed: D1-D11 — delete/recreate keeps clientsCount == real " +
    "doc count exactly, repeated delete never double-decrements, over-limit legacy data is counted " +
    "accurately on first use (never defaults to 0) and existing data is never deleted, missing-counter " +
    "concurrent initialization never over-admits, direct Firestore create/delete are both denied by " +
    "Rules, Product/Service creates never aggregate or initialize the unrelated Client counter, public " +
    "booking always succeeds and no longer creates a Client through the public confirmation path; explicit CRM creation remains under the SAME canonical " +
    "counter authority as POST /api/clients (leaving public bookings unassociated when quota is " +
    "full), and a normal create racing a public booking for the last slot never over-admits.",
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
