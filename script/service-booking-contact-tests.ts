import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";
import { associateServiceBookingCustomerCommand, createClientFromServiceBookingCommand, createServiceBookingHoldCommand, confirmServiceBookingHoldCommand, cancelServiceBookingCommand, rescheduleServiceBookingCommand, ServiceBookingCommandError } from "../server/service-booking-commands";
import { startServiceWorkCommand, completeServiceWorkCommand, cancelServiceWorkCommand } from "../server/service-work-commands";
import { upsertServiceResourceScheduleCommand } from "../server/service-availability-commands";
import { deleteClientCommand } from "../server/plan-authoritative-mutations";
import { assertValidBooking } from "../shared/service-bookings";
import { normalizeServiceWorkDocument } from "../shared/services";
import { assertValidBookingContactSnapshot, bookingContactName } from "../shared/service-contact";
import { getPublicManagedBookingCommand, confirmPublicServiceBookingHoldCommand } from "../server/service-public-booking";
import { initializeApp, deleteApp } from "firebase/app";
import { connectAuthEmulator, getAuth, createUserWithEmailAndPassword } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, doc, updateDoc, deleteField, getDoc, setDoc } from "firebase/firestore";

async function run() {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
  assert.notEqual(process.env.GOOGLE_CLOUD_PROJECT, "revenda-smart");
  process.env.FIREBASE_PROJECT_ID = "demo-revendasmart";
  const db = initializeFirebaseAdmin().firestore();
  const contact = { name: "Ana Original", phone: "+55 11 99999-0000" };
  const changed = { name: "Outro contato", phone: "000000" };
  const root = `d1-${randomUUID()}`;
  const ref = (uid: string, collection: string, id: string) => db.doc(`users/${uid}/${collection}/${id}`);
  const slot = (day: number) => {
    const date = new Date(Date.now() + (10 + day) * 86400000);
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 14)).toISOString();
  };
  async function setup(uid: string, clients = 0) {
    const now = new Date().toISOString();
    const batch = db.batch();
    batch.set(ref(uid, "services", "svc"), {
      id: "svc", tenantUid: uid, name: "Serviço D1", active: true, published: true,
      pricing: { mode: "fixed", priceCents: 8000 }, cost: { kind: "unknown" },
      durationMinutes: 30, bookingMode: "instant", createdAt: now, updatedAt: now,
    });
    for (let i = 0; i < clients; i++) batch.set(ref(uid, "clients", `existing-${i}`), { id: `existing-${i}`, ...contact });
    await batch.commit();
    const period = [{ start: "00:00", end: "23:45" }];
    await upsertServiceResourceScheduleCommand(db, uid, "default", { timezone: "UTC", slotStepMinutes: 30,
      weeklyHours: { sunday: period, monday: period, tuesday: period, wednesday: period, thursday: period, friday: period, saturday: period },
    }, `schedule-${uid}`);
  }
  async function hold(uid: string, day = 0) {
    const result = await createServiceBookingHoldCommand(db, uid, "svc", "default", slot(day), undefined, `hold-${uid}-${day}`);
    assert.ok(!("conflict" in result));
    return result.holdId;
  }
  async function pair(uid: string, holdId: string) {
    const [b, w] = await Promise.all([ref(uid, "bookings", `booking-${holdId}`).get(), ref(uid, "serviceWorks", `booking-work-${holdId}`).get()]);
    assert.ok(b.exists && w.exists);
    return { booking: assertValidBooking(b.data() as Parameters<typeof assertValidBooking>[0]), work: normalizeServiceWorkDocument(w.data() as Parameters<typeof normalizeServiceWorkDocument>[0]) };
  }
  async function check(uid: string, holdId: string, expected = contact) {
    const data = await pair(uid, holdId);
    assert.deepEqual(data.booking.customerContactSnapshot, expected);
    assert.deepEqual(data.work.customerContactSnapshot, expected);
    return data;
  }
  const confirm = (uid: string, holdId: string, key: string, value = contact) =>
    confirmServiceBookingHoldCommand(db, uid, holdId, key, { source: "public", publicCustomerContact: value });

  // Both quota branches, same-key and different-key replay, immutable history after CRM changes.
  for (const count of [0, 50]) {
    const uid = `${root}-quota-${count}`;
    await setup(uid, count);
    const id = await hold(uid);
    const response = await confirmPublicServiceBookingHoldCommand(db, uid, id, contact.name, contact.phone, `confirm-${uid}`);
    assert.ok(response.manageToken);
    assert.equal("customerContactSnapshot" in response, false);
    const data = await check(uid, id);
    assert.equal(data.booking.customerId, undefined);
    assert.equal(data.work.customerId, undefined);
    assert.equal((await db.collection(`users/${uid}/clients`).count().get()).data().count, count);
    await confirm(uid, id, `confirm-${uid}`, changed);
    await confirm(uid, id, `confirm-other-${uid}`, changed);
    await check(uid, id);
    const managed = await getPublicManagedBookingCommand(db, uid, "Loja", response.manageToken!);
    assert.equal(managed.customerFirstName, "Ana");
    assert.equal("phone" in managed, false);
    const records = await db.collection(`users/${uid}/serviceBookingCommandIdempotency`).get();
    for (const record of records.docs) {
      assert.equal(JSON.stringify(record.data()).includes(contact.name), false);
      assert.equal(JSON.stringify(record.data()).includes(contact.phone), false);
    }
    await rescheduleServiceBookingCommand(db, uid, data.booking.id, slot(2), `reschedule-${uid}`);
    await check(uid, id);
    await cancelServiceBookingCommand(db, uid, data.booking.id, `cancel-${uid}`);
    await check(uid, id);
    assert.equal((await pair(uid, id)).work.status, "cancelled");
  }
  console.log("PASS D1 quota, replay, CRM edits/deletion, public projection, reschedule/cancel");

  // Same hold: competing payloads must not overwrite whichever confirmation committed first.
  {
    const uid = `${root}-same`;
    await setup(uid);
    const id = await hold(uid);
    const results = await Promise.all([confirm(uid, id, `first-${uid}`), confirm(uid, id, `second-${uid}`, changed)]);
    assert.equal(results.filter((x) => !x.idempotentReplay).length, 1);
    const expected = results[0].idempotentReplay ? changed : contact;
    const data = await check(uid, id, expected);
    assert.equal((await db.collection(`users/${uid}/clients`).count().get()).data().count, 0);
    assert.equal((await db.collection(`users/${uid}/bookings`).count().get()).data().count, 1);
    assert.equal((await db.collection(`users/${uid}/serviceWorks`).count().get()).data().count, 1);
    await startServiceWorkCommand(db, uid, data.work.id, `start-${uid}`);
    await check(uid, id, expected);
    await completeServiceWorkCommand(db, uid, data.work.id, `complete-${uid}`);
    await check(uid, id, expected);
  }
  // Different holds, same phone, last CRM slot: no identity association and both contacts preserved.
  {
    const uid = `${root}-last`;
    await setup(uid, 49);
    const ids = await Promise.all([hold(uid, 0), hold(uid, 1)]);
    await Promise.all(ids.map((id, i) => confirm(uid, id, `race-${uid}-${i}`)));
    const data = await Promise.all(ids.map((id) => check(uid, id)));
    assert.equal(data.filter((x) => x.booking.customerId !== undefined).length, 0);
    assert.equal((await db.collection(`users/${uid}/clients`).count().get()).data().count, 49);
    assert.equal((await ref(uid, "planUsage", "summary").get()).data()?.clientsCount, undefined);
  }
  console.log("PASS D2 public confirmations do not auto-create or auto-associate Clients");

  // Explicit association/disassociation is authenticated, idempotent and syncs Booking + Work.
  {
    const uid = `${root}-associate`;
    await setup(uid, 2);
    const id = await hold(uid);
    await confirm(uid, id, `assoc-confirm-${uid}`);
    const before = await check(uid, id);
    const associated = await associateServiceBookingCustomerCommand(db, uid, before.booking.id, "existing-0", null, `assoc-${uid}`);
    assert.equal(associated.customerId, "existing-0");
    assert.equal((await associateServiceBookingCustomerCommand(db, uid, before.booking.id, "existing-0", null, `assoc-${uid}`)).idempotentReplay, true);
    let data = await pair(uid, id);
    assert.equal(data.booking.customerId, "existing-0");
    assert.equal(data.work.customerId, "existing-0");
    await assert.rejects(
      associateServiceBookingCustomerCommand(db, uid, before.booking.id, "existing-1", null, `assoc-conflict-${uid}`),
      (error) => error instanceof ServiceBookingCommandError && error.code === "ASSOCIATION_CONFLICT",
    );
    await assert.rejects(
      associateServiceBookingCustomerCommand(db, uid, before.booking.id, "missing-client", "existing-0", `assoc-missing-${uid}`),
      (error) => error instanceof ServiceBookingCommandError && error.code === "CLIENT_NOT_FOUND",
    );
    await associateServiceBookingCustomerCommand(db, uid, before.booking.id, "existing-1", "existing-0", `assoc-change-${uid}`);
    await associateServiceBookingCustomerCommand(db, uid, before.booking.id, null, "existing-1", `assoc-clear-${uid}`);
    data = await pair(uid, id);
    assert.equal(data.booking.customerId, undefined);
    assert.equal(data.work.customerId, undefined);
    assert.deepEqual(data.booking.customerContactSnapshot, contact);
    assert.deepEqual(data.work.customerContactSnapshot, contact);
  }
  console.log("PASS D2 explicit association, conflict, missing-client and disassociation");

  // Explicit Client creation from snapshot uses quota and never infers identity by phone.
  {
    const uid = `${root}-create-client`;
    await setup(uid);
    const id = await hold(uid);
    await confirm(uid, id, `create-confirm-${uid}`);
    const before = await check(uid, id);
    const created = await createClientFromServiceBookingCommand(db, uid, before.booking.id, null, `create-client-${uid}`);
    assert.equal(created.customerId, `booking-client-${before.booking.id}`);
    assert.equal((await createClientFromServiceBookingCommand(db, uid, before.booking.id, null, `create-client-${uid}`)).idempotentReplay, true);
    const client = await ref(uid, "clients", created.customerId).get();
    assert.equal(client.exists, true);
    assert.equal(client.data()?.name, contact.name);
    assert.equal(client.data()?.phone, contact.phone);
    const after = await pair(uid, id);
    assert.equal(after.booking.customerId, created.customerId);
    assert.equal(after.work.customerId, created.customerId);
    assert.deepEqual(after.booking.customerContactSnapshot, contact);
    await deleteClientCommand(db, uid, created.customerId);
    const afterDelete = await pair(uid, id);
    assert.equal(afterDelete.booking.customerId, created.customerId);
    assert.equal(afterDelete.work.customerId, created.customerId);
  }
  {
    const uid = `${root}-create-full`;
    await setup(uid, 50);
    const id = await hold(uid);
    await confirm(uid, id, `full-confirm-${uid}`);
    const data = await check(uid, id);
    await assert.rejects(
      createClientFromServiceBookingCommand(db, uid, data.booking.id, null, `full-create-${uid}`),
      (error) => error instanceof ServiceBookingCommandError && error.code === "CLIENT_LIMIT_REACHED",
    );
    const after = await pair(uid, id);
    assert.equal(after.booking.customerId, undefined);
    assert.equal(after.work.customerId, undefined);
    assert.equal((await db.collection(`users/${uid}/clients`).count().get()).data().count, 50);
  }
  console.log("PASS D2 explicit create from snapshot, deletion history and full-quota failure");

  async function expectCommandError(action: Promise<unknown>, code: ServiceBookingCommandError["code"]) {
    await assert.rejects(action, (error) => error instanceof ServiceBookingCommandError && error.code === code);
  }
  async function planClientsCount(uid: string) {
    return (await ref(uid, "planUsage", "summary").get()).data()?.clientsCount ?? 0;
  }
  function assertSettledCommandError(result: PromiseSettledResult<unknown>, code: ServiceBookingCommandError["code"]) {
    assert.equal(result.status, "rejected");
    assert.ok(result.reason instanceof ServiceBookingCommandError);
    assert.equal(result.reason.code, code);
  }

  // D2 integrity: Booking without a valid Work is not associable; no counterpart is invented.
  {
    const uid = `${root}-missing-work-assoc`;
    await setup(uid, 1);
    const id = await hold(uid);
    await confirm(uid, id, `missing-work-confirm-${uid}`);
    const before = await check(uid, id);
    await ref(uid, "serviceWorks", before.work.id).delete();
    await expectCommandError(
      associateServiceBookingCustomerCommand(db, uid, before.booking.id, "existing-0", null, `missing-work-assoc-${uid}`),
      "BOOKING_WORK_INCONSISTENT",
    );
    assert.equal((await ref(uid, "bookings", before.booking.id).get()).data()?.customerId, undefined);
    assert.equal((await db.collection(`users/${uid}/clients`).count().get()).data().count, 1);
    assert.equal(await planClientsCount(uid), 0);
  }
  {
    const uid = `${root}-missing-work-create`;
    await setup(uid);
    const id = await hold(uid);
    await confirm(uid, id, `missing-work-create-confirm-${uid}`);
    const before = await check(uid, id);
    await ref(uid, "serviceWorks", before.work.id).delete();
    await expectCommandError(
      createClientFromServiceBookingCommand(db, uid, before.booking.id, null, `missing-work-create-${uid}`),
      "BOOKING_WORK_INCONSISTENT",
    );
    assert.equal((await ref(uid, "clients", `booking-client-${before.booking.id}`).get()).exists, false);
    assert.equal(await planClientsCount(uid), 0);
  }
  {
    const uid = `${root}-work-other-tenant`;
    await setup(uid, 1);
    const id = await hold(uid);
    await confirm(uid, id, `other-tenant-confirm-${uid}`);
    const before = await check(uid, id);
    await ref(uid, "serviceWorks", before.work.id).update({ tenantUid: `${uid}-other` });
    await expectCommandError(
      associateServiceBookingCustomerCommand(db, uid, before.booking.id, "existing-0", null, `other-tenant-assoc-${uid}`),
      "BOOKING_WORK_INCONSISTENT",
    );
    assert.equal((await ref(uid, "bookings", before.booking.id).get()).data()?.customerId, undefined);
  }
  {
    const uid = `${root}-work-inconsistent`;
    await setup(uid, 1);
    const id = await hold(uid);
    await confirm(uid, id, `inconsistent-confirm-${uid}`);
    const before = await check(uid, id);
    await ref(uid, "serviceWorks", before.work.id).update({ customerId: "existing-0" });
    await expectCommandError(
      associateServiceBookingCustomerCommand(db, uid, before.booking.id, "existing-0", null, `inconsistent-assoc-${uid}`),
      "BOOKING_WORK_INCONSISTENT",
    );
    assert.equal((await ref(uid, "bookings", before.booking.id).get()).data()?.customerId, undefined);
  }
  {
    const uid = `${root}-no-workid`;
    await setup(uid, 1);
    const id = await hold(uid);
    await confirm(uid, id, `no-workid-confirm-${uid}`);
    const before = await check(uid, id);
    const { workId: _workId, ...withoutWorkId } = before.booking;
    await ref(uid, "bookings", before.booking.id).set(withoutWorkId);
    await expectCommandError(
      associateServiceBookingCustomerCommand(db, uid, before.booking.id, "existing-0", null, `no-workid-assoc-${uid}`),
      "BOOKING_WORK_INCONSISTENT",
    );
    await expectCommandError(
      createClientFromServiceBookingCommand(db, uid, before.booking.id, null, `no-workid-create-${uid}`),
      "BOOKING_WORK_INCONSISTENT",
    );
    assert.equal((await ref(uid, "serviceWorks", before.work.id).get()).data()?.customerId, undefined);
  }
  console.log("PASS D2 Work integrity, missing Work and no-workId protections");

  // D2 tenant isolation: identity association never crosses tenant boundaries.
  {
    const uidA = `${root}-tenant-a`;
    const uidB = `${root}-tenant-b`;
    await setup(uidA);
    await setup(uidB, 1);
    const id = await hold(uidA);
    await confirm(uidA, id, `tenant-confirm-${uidA}`);
    const before = await check(uidA, id);
    await expectCommandError(
      associateServiceBookingCustomerCommand(db, uidA, before.booking.id, "existing-0", null, `tenant-client-b-${uidA}`),
      "CLIENT_NOT_FOUND",
    );
    await expectCommandError(
      associateServiceBookingCustomerCommand(db, uidB, before.booking.id, "existing-0", null, `tenant-assoc-b-${uidB}`),
      "NOT_FOUND",
    );
    await expectCommandError(
      createClientFromServiceBookingCommand(db, uidB, before.booking.id, null, `tenant-create-b-${uidB}`),
      "NOT_FOUND",
    );
    const after = await pair(uidA, id);
    assert.equal(after.booking.customerId, undefined);
    assert.equal(after.work.customerId, undefined);
    assert.equal((await db.collection(`users/${uidB}/clients`).count().get()).data().count, 1);
  }
  console.log("PASS D2 cross-tenant association/create isolation");

  // D2 idempotency: same key only replays the exact same payload.
  {
    const uid = `${root}-idem-assoc`;
    await setup(uid, 2);
    const id = await hold(uid);
    await confirm(uid, id, `idem-assoc-confirm-${uid}`);
    const before = await check(uid, id);
    const first = await associateServiceBookingCustomerCommand(db, uid, before.booking.id, "existing-0", null, `idem-assoc-${uid}`);
    assert.equal(first.customerId, "existing-0");
    assert.equal((await associateServiceBookingCustomerCommand(db, uid, before.booking.id, "existing-0", null, `idem-assoc-${uid}`)).idempotentReplay, true);
    await expectCommandError(
      associateServiceBookingCustomerCommand(db, uid, before.booking.id, "existing-1", null, `idem-assoc-${uid}`),
      "IDEMPOTENCY_CONFLICT",
    );
    await expectCommandError(
      associateServiceBookingCustomerCommand(db, uid, before.booking.id, "existing-0", "existing-0", `idem-assoc-${uid}`),
      "IDEMPOTENCY_CONFLICT",
    );
  }
  {
    const uid = `${root}-idem-create`;
    await setup(uid);
    const id = await hold(uid);
    await confirm(uid, id, `idem-create-confirm-${uid}`);
    const before = await check(uid, id);
    const first = await createClientFromServiceBookingCommand(db, uid, before.booking.id, null, `idem-create-${uid}`);
    assert.equal((await createClientFromServiceBookingCommand(db, uid, before.booking.id, null, `idem-create-${uid}`)).idempotentReplay, true);
    await expectCommandError(
      createClientFromServiceBookingCommand(db, uid, before.booking.id, first.customerId, `idem-create-${uid}`),
      "IDEMPOTENCY_CONFLICT",
    );
    assert.equal((await db.collection(`users/${uid}/clients`).count().get()).data().count, 1);
    assert.equal(await planClientsCount(uid), 1);
  }
  console.log("PASS D2 idempotency payload compatibility and replay counters");

  // D2 concurrency: CAS keeps Booking and Work consistent and counters exact.
  {
    const uid = `${root}-race-assoc`;
    await setup(uid, 2);
    const id = await hold(uid);
    await confirm(uid, id, `race-assoc-confirm-${uid}`);
    const before = await check(uid, id);
    const results = await Promise.allSettled([
      associateServiceBookingCustomerCommand(db, uid, before.booking.id, "existing-0", null, `race-assoc-a-${uid}`),
      associateServiceBookingCustomerCommand(db, uid, before.booking.id, "existing-1", null, `race-assoc-b-${uid}`),
    ]);
    assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(results.filter((x) => x.status === "rejected").length, 1);
    const rejected = results.find((x) => x.status === "rejected")!;
    assertSettledCommandError(rejected, "ASSOCIATION_CONFLICT");
    const after = await pair(uid, id);
    assert.ok(after.booking.customerId === "existing-0" || after.booking.customerId === "existing-1");
    assert.equal(after.work.customerId, after.booking.customerId);
    assert.deepEqual(after.booking.customerContactSnapshot, contact);
  }
  {
    const uid = `${root}-race-create-same`;
    await setup(uid);
    const id = await hold(uid);
    await confirm(uid, id, `race-create-same-confirm-${uid}`);
    const before = await check(uid, id);
    const results = await Promise.allSettled([
      createClientFromServiceBookingCommand(db, uid, before.booking.id, null, `race-create-same-${uid}`),
      createClientFromServiceBookingCommand(db, uid, before.booking.id, null, `race-create-same-${uid}`),
    ]);
    assert.ok(results.filter((x) => x.status === "fulfilled").length >= 1);
    assert.equal((await createClientFromServiceBookingCommand(db, uid, before.booking.id, null, `race-create-same-${uid}`)).idempotentReplay, true);
    const after = await pair(uid, id);
    assert.equal(after.booking.customerId, `booking-client-${before.booking.id}`);
    assert.equal(after.work.customerId, after.booking.customerId);
    assert.equal((await db.collection(`users/${uid}/clients`).count().get()).data().count, 1);
    assert.equal(await planClientsCount(uid), 1);
  }
  {
    const uid = `${root}-race-create-different`;
    await setup(uid);
    const id = await hold(uid);
    await confirm(uid, id, `race-create-different-confirm-${uid}`);
    const before = await check(uid, id);
    const results = await Promise.allSettled([
      createClientFromServiceBookingCommand(db, uid, before.booking.id, null, `race-create-a-${uid}`),
      createClientFromServiceBookingCommand(db, uid, before.booking.id, null, `race-create-b-${uid}`),
    ]);
    assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(results.filter((x) => x.status === "rejected").length, 1);
    assertSettledCommandError(results.find((x) => x.status === "rejected")!, "ASSOCIATION_CONFLICT");
    const after = await pair(uid, id);
    assert.equal(after.booking.customerId, `booking-client-${before.booking.id}`);
    assert.equal(after.work.customerId, after.booking.customerId);
    assert.equal((await db.collection(`users/${uid}/clients`).count().get()).data().count, 1);
    assert.equal(await planClientsCount(uid), 1);
  }
  {
    const uid = `${root}-race-assoc-create`;
    await setup(uid, 1);
    const id = await hold(uid);
    await confirm(uid, id, `race-assoc-create-confirm-${uid}`);
    const before = await check(uid, id);
    const createdId = `booking-client-${before.booking.id}`;
    const results = await Promise.allSettled([
      associateServiceBookingCustomerCommand(db, uid, before.booking.id, "existing-0", null, `race-existing-${uid}`),
      createClientFromServiceBookingCommand(db, uid, before.booking.id, null, `race-create-from-booking-${uid}`),
    ]);
    assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(results.filter((x) => x.status === "rejected").length, 1);
    assertSettledCommandError(results.find((x) => x.status === "rejected")!, "ASSOCIATION_CONFLICT");
    const after = await pair(uid, id);
    assert.ok(after.booking.customerId === "existing-0" || after.booking.customerId === createdId);
    assert.equal(after.work.customerId, after.booking.customerId);
    const createdExists = (await ref(uid, "clients", createdId).get()).exists;
    assert.equal(createdExists, after.booking.customerId === createdId);
    assert.equal((await db.collection(`users/${uid}/clients`).count().get()).data().count, createdExists ? 2 : 1);
    assert.equal(await planClientsCount(uid), createdExists ? 2 : 0);
  }
  console.log("PASS D2 association/create concurrency and exact counters");

  // DECISÃO DE PRODUTO D2: associação é ação de cadastro para atendimentos abertos; cancelados/concluídos ficam imutáveis.
  {
    const uid = `${root}-terminal-cancelled`;
    await setup(uid, 1);
    const id = await hold(uid);
    await confirm(uid, id, `terminal-cancel-confirm-${uid}`);
    const before = await check(uid, id);
    await cancelServiceBookingCommand(db, uid, before.booking.id, `terminal-cancel-${uid}`);
    await expectCommandError(
      associateServiceBookingCustomerCommand(db, uid, before.booking.id, "existing-0", null, `terminal-cancel-assoc-${uid}`),
      "BOOKING_NOT_ASSOCIABLE",
    );
    await expectCommandError(
      createClientFromServiceBookingCommand(db, uid, before.booking.id, null, `terminal-cancel-create-${uid}`),
      "BOOKING_NOT_ASSOCIABLE",
    );
    const after = await pair(uid, id);
    assert.equal(after.booking.customerId, undefined);
    assert.equal(after.work.customerId, undefined);
    assert.equal((await ref(uid, "clients", `booking-client-${before.booking.id}`).get()).exists, false);
  }
  {
    const uid = `${root}-terminal-completed`;
    await setup(uid, 1);
    const id = await hold(uid);
    await confirm(uid, id, `terminal-complete-confirm-${uid}`);
    const before = await check(uid, id);
    await startServiceWorkCommand(db, uid, before.work.id, `terminal-start-${uid}`);
    await completeServiceWorkCommand(db, uid, before.work.id, `terminal-complete-${uid}`);
    await expectCommandError(
      associateServiceBookingCustomerCommand(db, uid, before.booking.id, "existing-0", null, `terminal-complete-assoc-${uid}`),
      "BOOKING_NOT_ASSOCIABLE",
    );
    await expectCommandError(
      createClientFromServiceBookingCommand(db, uid, before.booking.id, null, `terminal-complete-create-${uid}`),
      "BOOKING_NOT_ASSOCIABLE",
    );
    const after = await pair(uid, id);
    assert.equal(after.booking.customerId, undefined);
    assert.equal(after.work.customerId, undefined);
    assert.equal((await ref(uid, "clients", `booking-client-${before.booking.id}`).get()).exists, false);
  }
  console.log("PASS D2 terminal booking/work association policy");

  // Explicit legacy fixture: absent snapshot stays absent on reads, replay and transitions.
  {
    const uid = `${root}-legacy`;
    await setup(uid);
    const id = await hold(uid);
    await confirm(uid, id, `legacy-${uid}`);
    const data = await pair(uid, id);
    for (const [collection, document] of [["bookings", data.booking], ["serviceWorks", data.work]] as const) {
      const { customerContactSnapshot: _snapshot, ...legacy } = document;
      assert.deepEqual(_snapshot, contact);
      await ref(uid, collection, document.id).set(legacy);
    }
    await confirm(uid, id, `legacy-${uid}`, changed);
    await confirm(uid, id, `legacy-other-${uid}`, changed);
    await cancelServiceWorkCommand(db, uid, data.work.id, `legacy-cancel-${uid}`);
    const legacy = await pair(uid, id);
    assert.equal(legacy.booking.customerContactSnapshot, undefined);
    assert.equal(legacy.work.customerContactSnapshot, undefined);
    assert.equal(bookingContactName(legacy.booking, new Map()), "Contato não disponível nesta reserva");
    assert.equal(bookingContactName(legacy.booking, new Map([["qualquer-cliente", "Cadastro atual"]])), "Contato não disponível nesta reserva");
  }
  assert.equal(bookingContactName({ customerId: "public-hold-old", customerContactSnapshot: contact }, new Map([["public-hold-old", "Alterado"]])), contact.name);
  assert.throws(() => assertValidBookingContactSnapshot({ name: "", phone: "123" }));
  assert.throws(() => assertValidBookingContactSnapshot({ ...contact, extra: true }));
  console.log("PASS D1 legacy compatibility and display resolution");

  // Rules must permit ordinary Work edits while preserving server-written snapshots, not changing them.
  const app = initializeApp({ apiKey: "demo-key", projectId: "demo-revendasmart" }, root);
  try {
    const auth = getAuth(app);
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    const clientDb = getFirestore(app);
    connectFirestoreEmulator(clientDb, "127.0.0.1", 8080);
    const uid = (await createUserWithEmailAndPassword(auth, `${root}@example.test`, "LocalTestPassword123!")).user.uid;
    await setup(uid);
    const id = await hold(uid);
    await confirm(uid, id, `rules-${uid}`);
    const data = await check(uid, id);
    const workRef = doc(clientDb, "users", uid, "serviceWorks", data.work.id);
    const updatedAt = new Date(Date.now() + 1000).toISOString();
    await updateDoc(workRef, { cost: { kind: "known", amountCents: 100 }, updatedAt });
    assert.deepEqual((await getDoc(workRef)).data()?.customerContactSnapshot, contact);
    await assert.rejects(updateDoc(workRef, { customerId: "existing-0", updatedAt: new Date(Date.now() + 1500).toISOString() }), (e: { code: string }) => e.code === "permission-denied");
    await assert.rejects(updateDoc(workRef, { customerContactSnapshot: changed, updatedAt: new Date(Date.now() + 2000).toISOString() }), (e: { code: string }) => e.code === "permission-denied");
    await assert.rejects(updateDoc(workRef, { customerContactSnapshot: deleteField(), updatedAt: new Date(Date.now() + 3000).toISOString() }), (e: { code: string }) => e.code === "permission-denied");
    await assert.rejects(setDoc(doc(clientDb, "users", uid, "serviceWorks", "manual-contact"), { ...data.work, id: "manual-contact", origin: "manual" }), (e: { code: string }) => e.code === "permission-denied");
  } finally {
    await deleteApp(app);
  }
  console.log("PASS D1 immutable snapshot Rules");
}

run().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
