import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";
import { createServiceBookingHoldCommand, confirmServiceBookingHoldCommand, cancelServiceBookingCommand, rescheduleServiceBookingCommand } from "../server/service-booking-commands";
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
    confirmServiceBookingHoldCommand(db, uid, holdId, key, { source: "public", publicCustomerContact: { clientId: `public-${holdId}`, ...value } });

  // Both quota branches, same-key and different-key replay, immutable history after CRM changes.
  for (const count of [0, 50]) {
    const uid = `${root}-quota-${count}`;
    await setup(uid, count);
    const id = await hold(uid);
    const response = await confirmPublicServiceBookingHoldCommand(db, uid, id, contact.name, contact.phone, `confirm-${uid}`);
    assert.ok(response.manageToken);
    assert.equal("customerContactSnapshot" in response, false);
    const data = await check(uid, id);
    assert.equal(data.booking.customerId, count === 0 ? `public-${id}` : undefined);
    assert.equal(data.work.customerId, data.booking.customerId);
    assert.equal((await db.collection(`users/${uid}/clients`).count().get()).data().count, count || 1);
    await confirm(uid, id, `confirm-${uid}`, changed);
    await confirm(uid, id, `confirm-other-${uid}`, changed);
    await check(uid, id);
    if (count === 0) {
      await ref(uid, "clients", `public-${id}`).update(changed);
      await check(uid, id);
      await deleteClientCommand(db, uid, `public-${id}`);
      await check(uid, id);
    }
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
    assert.equal((await db.collection(`users/${uid}/clients`).count().get()).data().count, 1);
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
    assert.equal(data.filter((x) => x.booking.customerId !== undefined).length, 1);
    assert.equal((await db.collection(`users/${uid}/clients`).count().get()).data().count, 50);
    assert.equal((await ref(uid, "planUsage", "summary").get()).data()?.clientsCount, 50);
    for (const item of data) if (item.booking.customerId) assert.ok(item.booking.customerId.startsWith("public-"));
  }
  console.log("PASS D1 same-hold concurrency and last-slot race");

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
    assert.equal(bookingContactName(legacy.booking, new Map([[legacy.booking.customerId!, "Cadastro atual"]])), "Cadastro atual");
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
    await assert.rejects(updateDoc(workRef, { customerContactSnapshot: changed, updatedAt: new Date(Date.now() + 2000).toISOString() }), (e: { code: string }) => e.code === "permission-denied");
    await assert.rejects(updateDoc(workRef, { customerContactSnapshot: deleteField(), updatedAt: new Date(Date.now() + 3000).toISOString() }), (e: { code: string }) => e.code === "permission-denied");
    await assert.rejects(setDoc(doc(clientDb, "users", uid, "serviceWorks", "manual-contact"), { ...data.work, id: "manual-contact", origin: "manual" }), (e: { code: string }) => e.code === "permission-denied");
  } finally {
    await deleteApp(app);
  }
  console.log("PASS D1 immutable snapshot Rules");
}

run().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
