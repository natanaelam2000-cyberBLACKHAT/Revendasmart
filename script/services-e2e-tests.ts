import assert from "node:assert/strict";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";
import { upsertServiceResourceScheduleCommand, createServiceAvailabilityBlockCommand, getServiceAvailabilityCommand } from "../server/service-availability-commands";
import {
  resolvePublicBookingStore,
  listPublicBookableServicesCommand,
  getPublicServiceAvailabilityCommand,
  createPublicServiceBookingHoldCommand,
  confirmPublicServiceBookingHoldCommand,
  getPublicManagedBookingCommand,
  getPublicRescheduleAvailabilityCommand,
  reschedulePublicManagedBookingCommand,
  cancelPublicManagedBookingCommand,
  resetPublicServiceBookingRateLimitsForTests,
} from "../server/service-public-booking";
import { startServiceWorkCommand, completeServiceWorkCommand } from "../server/service-work-commands";
import { createServiceQuoteForWorkCommand, sendQuoteCommand } from "../server/service-quote-commands";
import { recordServicePaymentCommand, refundServicePaymentCommand } from "../server/service-payment-commands";
import { deriveServiceWorkFinancials, normalizeServiceWorkDocument, type ServiceWork } from "../shared/services";
import { assertValidBooking, type Booking } from "../shared/service-bookings";
import { initializeApp, deleteApp } from "firebase/app";
import { collection, connectFirestoreEmulator, getDocs, getFirestore, query, where, type Firestore as ClientFirestore } from "firebase/firestore";

/**
 * SERV-E2E-01 — fecha o MVP de Serviços provando o ciclo completo usando SÓ peças já aprovadas (nenhuma
 * lógica nova de domínio aqui, nenhuma escrita direta de estado que já tem command real). Mapeamento
 * E2E1-E2E55 -> blocos abaixo, agrupados quando a mesma chamada já prova várias invariantes ao mesmo tempo
 * (ex.: um único getServiceAvailabilityCommand prova E2E1/E2E2/E2E4 juntos). Mesmo harness sem servidor HTTP
 * de script/service-public-booking-manage-tests.ts — chama os commands exportados diretamente (é a mesma
 * função que a rota pública chama; HTTP/rate-limit já é coberto pelas suítes SERV-PUBLIC-01/02).
 */
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

function requireEmulatorEnv() {
  assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-revendasmart");
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
}

function tenantUid(prefix = "e2e"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function slugFor(uid: string): string {
  return `loja-${uid}`.slice(0, 60);
}
/** Mesma técnica já usada em TEST-FIX-AVAIL-01/SERV-PUBLIC-02: ancorado num dia futuro real (nunca uma data
 * absoluta fixa que viraria uma bomba-relógio), horário local seguro (nunca perto de meia-noite). */
function futureDateAtSafeLocalTime(daysAhead: number, hour: number, minute = 0): Date {
  const base = new Date(Date.now() + daysAhead * 24 * 60 * 60_000);
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hour, minute, 0, 0));
}
function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v !== "undefined")) as T;
}
function validService(id: string, uid: string, overrides: Record<string, unknown> = {}) {
  return omitUndefined({
    id, tenantUid: uid, name: "Corte de cabelo", description: "Corte + acabamento", active: true, published: true,
    pricing: { mode: "fixed", priceCents: 10000 }, cost: { kind: "unknown" },
    durationMinutes: 30, bookingMode: "instant",
    createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z",
    ...overrides,
  });
}
async function seedTenant(db: FirebaseFirestore.Firestore) {
  const uid = tenantUid();
  const slug = slugFor(uid);
  await db.doc(`user_settings/${uid}`).set({ slug, storeName: "Barbearia E2E" });
  await db.doc(`users/${uid}/services/svc`).set(validService("svc", uid));
  // §4 — janela estreita (09:00-12:00 TODOS os dias, timezone real) prova E2E1 (dentro da janela gera slot)
  // e E2E2 (fora da janela — ex. 14:00 — não gera) sem depender de qual dia-da-semana cai "N dias a partir
  // de agora" (nunca hardcoded, sempre relativo — mesma disciplina de TEST-FIX-AVAIL-01).
  const openPeriod = [{ start: "09:00", end: "12:00" }];
  await upsertServiceResourceScheduleCommand(db, uid, "default", {
    timezone: "America/Sao_Paulo", slotStepMinutes: 30, minAdvanceMinutes: 0, maxAdvanceDays: 60,
    weeklyHours: { sunday: openPeriod, monday: openPeriod, tuesday: openPeriod, wednesday: openPeriod, thursday: openPeriod, friday: openPeriod, saturday: openPeriod },
  }, `sched-${uid}`);
  return { uid, slug };
}

async function run() {
  requireEmulatorEnv();
  initializeFirebaseAdmin();
  resetPublicServiceBookingRateLimitsForTests();
  const db = initializeFirebaseAdmin().firestore();

  // ======================================================================================================
  // CENÁRIO PRINCIPAL — E2E1-E2E33: disponibilidade -> public booking -> Agenda owner -> Work lifecycle ->
  // Quote -> Payment -> Refund -> repay -> conclusão.
  // ======================================================================================================
  const { uid, slug } = await seedTenant(db);

  // ===== E2E1/E2E2/E2E4 — disponibilidade real respeita weeklyHours e timezone =====
  {
    const dayInWindow = futureDateAtSafeLocalTime(6, 9, 0); // 09:00 UTC "civil" usado só p/ ancorar o dia
    const rangeStartAt = new Date(Date.UTC(dayInWindow.getUTCFullYear(), dayInWindow.getUTCMonth(), dayInWindow.getUTCDate(), 0, 0, 0)).toISOString();
    const rangeEndAt = new Date(Date.parse(rangeStartAt) + 24 * 60 * 60_000).toISOString();
    const availability = await getServiceAvailabilityCommand(db, uid, "svc", "default", rangeStartAt, rangeEndAt);
    assert.equal(availability.timezone, "America/Sao_Paulo", "E2E4: a disponibilidade reflete o timezone real configurado");
    // América/São_Paulo é UTC-3 fixo (sem horário de verão desde 2019) — 09:00 local = 12:00 UTC.
    const expectedFirstSlotUtc = new Date(Date.UTC(dayInWindow.getUTCFullYear(), dayInWindow.getUTCMonth(), dayInWindow.getUTCDate(), 12, 0, 0)).toISOString();
    assert.ok(availability.candidates.some((c) => c.startAt === expectedFirstSlotUtc), "E2E1/E2E4: 09:00 local (dentro da janela 09-12) aparece exatamente no instante UTC correto");
    const outsideWindowUtc = new Date(Date.UTC(dayInWindow.getUTCFullYear(), dayInWindow.getUTCMonth(), dayInWindow.getUTCDate(), 17, 0, 0)).toISOString(); // 14:00 local
    assert.ok(!availability.candidates.some((c) => c.startAt === outsideWindowUtc), "E2E2: 14:00 local (fora da janela 09-12) nunca aparece como candidato");
  }

  // ===== E2E3 — AvailabilityBlock remove slots =====
  let bookingStartAtUtc = "";
  {
    const day = futureDateAtSafeLocalTime(6, 0, 0);
    const rangeStartAt = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0)).toISOString();
    const rangeEndAt = new Date(Date.parse(rangeStartAt) + 24 * 60 * 60_000).toISOString();
    const blockStartUtc = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 12, 0, 0)).toISOString(); // 09:00 local
    const blockEndUtc = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 12, 30, 0)).toISOString();
    await createServiceAvailabilityBlockCommand(db, uid, "default", blockStartUtc, blockEndUtc, "Bloqueio E2E3", `block-${uid}`);
    const availabilityAfterBlock = await getServiceAvailabilityCommand(db, uid, "svc", "default", rangeStartAt, rangeEndAt);
    assert.ok(!availabilityAfterBlock.candidates.some((c) => c.startAt === blockStartUtc), "E2E3: o slot bloqueado desaparece da disponibilidade");
    // O público vai reservar o PRÓXIMO slot livre (09:30 local) — a mesma janela, sem o bloqueio.
    bookingStartAtUtc = availabilityAfterBlock.candidates[0].startAt;
    assert.ok(bookingStartAtUtc, "seed: deve sobrar pelo menos um slot livre após o bloqueio");
  }

  // ===== E2E5-E2E13 — fluxo público real: store -> services -> availability -> Hold -> confirm =====
  let mainBookingId = "";
  let mainWorkId = "";
  let mainCustomerId = "";
  {
    const store = await resolvePublicBookingStore(db, slug);
    assert.ok(store, "seed: loja pública deve resolver");
    const services = await listPublicBookableServicesCommand(db, uid);
    assert.equal(services.length, 1);
    assert.equal(services[0].id, "svc");

    const day = futureDateAtSafeLocalTime(6, 0, 0);
    const rangeStartAt = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0)).toISOString();
    const rangeEndAt = new Date(Date.parse(rangeStartAt) + 24 * 60 * 60_000).toISOString();
    const publicAvailability = await getPublicServiceAvailabilityCommand(db, uid, "svc", rangeStartAt, rangeEndAt);
    assert.ok(publicAvailability.candidates.some((c) => c.startAt === bookingStartAtUtc), "seed: o slot livre também aparece pela superfície pública");

    const hold = await createPublicServiceBookingHoldCommand(db, uid, "svc", bookingStartAtUtc, `e2e-hold-${uid}`);
    const confirm = await confirmPublicServiceBookingHoldCommand(db, uid, hold.holdId, "Cliente E2E", "+55 11 90000-1111", `e2e-confirm-${uid}`);
    assert.equal(confirm.confirmed, true);
    assert.ok(confirm.manageToken, "seed: confirmação pública deve gerar manageToken para a etapa final do fluxo");

    const bookingsSnap = await db.collection(`users/${uid}/bookings`).get();
    assert.equal(bookingsSnap.size, 1, "E2E6: exatamente 1 Booking criado");
    const bookingDoc = bookingsSnap.docs[0];
    const booking = assertValidBooking(bookingDoc.data() as Booking);
    mainBookingId = bookingDoc.id;
    mainWorkId = booking.workId;
    mainCustomerId = booking.customerId as string;

    assert.equal(booking.tenantUid, uid, "E2E8: Booking pertence ao tenant certo");
    assert.ok(mainCustomerId, "E2E5: Booking referencia um Client real (criado atomicamente na confirmação)");
    const clientDoc = await db.doc(`users/${uid}/clients/${mainCustomerId}`).get();
    assert.equal(clientDoc.exists, true, "E2E5: o Client foi realmente criado no Firestore");
    assert.equal(clientDoc.data()?.name, "Cliente E2E");

    const workSnap = await db.doc(`users/${uid}/serviceWorks/${mainWorkId}`).get();
    assert.equal(workSnap.exists, true, "E2E7: Work criado");
    const work = normalizeServiceWorkDocument(workSnap.data() as ServiceWork);
    assert.equal(work.tenantUid, uid, "E2E8: Work pertence ao mesmo tenant do Booking");
    assert.equal(work.origin, "booking", "E2E9: Work.origin = booking");
    assert.deepEqual(work.financialSummary, { grossReceivedCents: 0, refundedTotalCents: 0, netReceivedCents: 0 }, "E2E10: financialSummary inicia zerado");
    assert.equal(work.totals.contractedTotalCents, 10000, "seed: contractedTotalCents vem do preço real do Service (R$100)");

    const paymentsSnap = await db.collection(`users/${uid}/serviceWorks/${mainWorkId}/payments`).get();
    assert.equal(paymentsSnap.size, 0, "E2E11: nenhum Payment criado pelo booking público");
    assert.equal(typeof work.quoteId, "undefined", "E2E13: nenhum Quote automático (work.quoteId ausente)");
  }
  // E2E12 (nenhum Refund) é coberto abaixo, no cenário de cancelamento (E2E44) — antes deste ponto não há
  // nenhum Payment do qual um Refund pudesse sequer se originar, então já está trivialmente satisfeito aqui.

  // ===== E2E14-E2E17 — a mesma query que a Agenda owner usa realmente enxerga o Booking público =====
  // Owner de teste autenticado sob o MESMO uid semeado acima não é possível via Auth emulator (o uid é
  // sempre gerado pelo próprio emulador) — em vez disso provamos a MESMA forma de query (resourceId +
  // startAt range, idêntica a listServiceBookingsForResourceAndRange em
  // client/src/lib/service-bookings-persistence.ts) via Admin SDK, que é exatamente a autoridade cujo
  // resultado a Agenda exibe; a permissão de leitura do próprio dono já está coberta pelas suítes de
  // segurança dedicadas (SERV-BOOK-01/02, script/services-booking-tests.ts).
  {
    const day = futureDateAtSafeLocalTime(6, 0, 0);
    const rangeStartAt = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0)).toISOString();
    const rangeEndAt = new Date(Date.parse(rangeStartAt) + 24 * 60 * 60_000).toISOString();
    // Mesma forma exata de query que client/src/lib/service-bookings-persistence.ts#listServiceBookingsForResourceAndRange usa.
    const agendaSnap = await db.collection(`users/${uid}/bookings`)
      .where("resourceId", "==", "default")
      .where("startAt", ">=", rangeStartAt)
      .where("startAt", "<", rangeEndAt)
      .get();
    assert.equal(agendaSnap.size, 1, "E2E14: o Booking público aparece na MESMA query que a Agenda usa");
    const agendaBooking = agendaSnap.docs[0].data();
    assert.equal(agendaBooking.id, mainBookingId);
    assert.equal(agendaBooking.startAt, bookingStartAtUtc, "E2E15: data/hora corretas");
    assert.equal(agendaBooking.resourceId, "default", "E2E16: resource correto");
    assert.equal(agendaBooking.workId, mainWorkId, "E2E17: workId aponta para o Work real");
    const workExists = await db.doc(`users/${uid}/serviceWorks/${agendaBooking.workId}`).get();
    assert.equal(workExists.exists, true, "E2E17: o Work referenciado realmente existe");
  }

  // ===== E2E18/E2E19 — Work: planned -> start -> in_progress, via commands reais =====
  {
    const workBefore = normalizeServiceWorkDocument((await db.doc(`users/${uid}/serviceWorks/${mainWorkId}`).get()).data() as ServiceWork);
    assert.equal(workBefore.status, "planned");
    await startServiceWorkCommand(db, uid, mainWorkId, `e2e-start-${uid}`);
    const workAfter = normalizeServiceWorkDocument((await db.doc(`users/${uid}/serviceWorks/${mainWorkId}`).get()).data() as ServiceWork);
    assert.equal(workAfter.status, "in_progress", "E2E18: start real transiciona planned -> in_progress");
    assert.ok(workAfter.startedAt);
    assert.equal(workAfter.customerId, mainCustomerId, "E2E19: mantém o mesmo cliente");
    assert.equal(workAfter.items[0]?.kind, "service");
    assert.equal(workAfter.totals.contractedTotalCents, 10000, "E2E19: mantém o valor contratado");
  }

  // ===== E2E20-E2E25 — Quote para o Work real =====
  let quoteId = "";
  {
    const createResult = await createServiceQuoteForWorkCommand(db, uid, mainWorkId, {}, `e2e-quote-${uid}`);
    quoteId = createResult.quoteId;
    const workWithQuote = normalizeServiceWorkDocument((await db.doc(`users/${uid}/serviceWorks/${mainWorkId}`).get()).data() as ServiceWork);
    assert.equal(workWithQuote.quoteId, quoteId, "E2E20: Work.quoteId definido");

    const quoteDoc = await db.doc(`users/${uid}/quotes/${quoteId}`).get();
    assert.equal(quoteDoc.exists, true);
    assert.equal(quoteDoc.data()?.tenantUid, uid, "E2E21: Quote pertence ao tenant correto");
    const contractedTotalBeforeQuote = workWithQuote.totals.contractedTotalCents;

    // E2E22 — segunda tentativa (key diferente) sobre o mesmo Work já vinculado é rejeitada, nunca cria outro Quote.
    await assert.rejects(
      createServiceQuoteForWorkCommand(db, uid, mainWorkId, {}, `e2e-quote-again-${uid}`),
      (error: unknown) => (error as { code?: string })?.code === "WORK_ALREADY_HAS_QUOTE",
      "E2E22: segunda criação para o mesmo Work é rejeitada deterministicamente",
    );
    const quotesSnap = await db.collection(`users/${uid}/quotes`).get();
    assert.equal(quotesSnap.size, 1, "E2E22: no máximo 1 Quote existe para este Work");

    // E2E23 — "editar draft" (mesma escrita que client/src/lib/service-quotes-persistence.ts#updateQuoteDraft
    // faz: só os campos de rascunho, nunca status/id) mantém o MESMO Quote, nunca cria um segundo.
    await db.doc(`users/${uid}/quotes/${quoteId}`).update({ draftCustomerMessage: "Obrigado pela preferência!", updatedAt: new Date().toISOString() });
    const editedQuote = await db.doc(`users/${uid}/quotes/${quoteId}`).get();
    assert.equal(editedQuote.id, quoteId, "E2E23: editar o rascunho preserva o MESMO id de Quote");
    assert.equal(editedQuote.data()?.draftCustomerMessage, "Obrigado pela preferência!");

    // E2E24 — versionamento: enviar o Quote cria a v1, campos continuam válidos.
    const sendResult = await sendQuoteCommand(db, uid, quoteId, `e2e-send-${uid}`);
    assert.equal(sendResult.resultingStatus, "sent");
    assert.equal(sendResult.currentVersionNumber, 1, "E2E24: primeira versão criada corretamente");
    const versionDoc = await db.doc(`users/${uid}/quotes/${quoteId}/versions/version-1`).get();
    assert.equal(versionDoc.exists, true, "E2E24: QuoteVersion realmente persistida");

    // E2E25 — nada disso alterou o contractedTotalCents do Work (criar/editar/enviar Quote nunca toca
    // Work.totals — essa é uma decisão de domínio explícita de SERV-QUOTE-LINK-01).
    const workAfterQuoteFlow = normalizeServiceWorkDocument((await db.doc(`users/${uid}/serviceWorks/${mainWorkId}`).get()).data() as ServiceWork);
    assert.equal(workAfterQuoteFlow.totals.contractedTotalCents, contractedTotalBeforeQuote, "E2E25: editar/enviar Quote NUNCA altera contractedTotalCents automaticamente");
  }

  // ===== E2E26 — Payment: contracted=100, payment=100 =====
  let mainPaymentId = "";
  {
    const payment = await recordServicePaymentCommand(db, uid, mainWorkId, 10000, "cash", `e2e-pay-1-${uid}`);
    mainPaymentId = payment.paymentId;
    const work = normalizeServiceWorkDocument((await db.doc(`users/${uid}/serviceWorks/${mainWorkId}`).get()).data() as ServiceWork);
    const financials = deriveServiceWorkFinancials(work);
    assert.equal(financials.grossReceivedCents, 10000);
    assert.equal(financials.refundedTotalCents, 0);
    assert.equal(financials.netReceivedCents, 10000);
    assert.equal(financials.balanceCents, 0);
    assert.equal(financials.financialStatus, "paid", "E2E26: R$100 pago sobre R$100 contratado = paid");
  }

  // ===== E2E27 — Refund parcial: refund=20 =====
  {
    await refundServicePaymentCommand(db, uid, mainWorkId, mainPaymentId, 2000, "Ajuste combinado", `e2e-refund-1-${uid}`);
    const work = normalizeServiceWorkDocument((await db.doc(`users/${uid}/serviceWorks/${mainWorkId}`).get()).data() as ServiceWork);
    const financials = deriveServiceWorkFinancials(work);
    assert.equal(financials.grossReceivedCents, 10000);
    assert.equal(financials.refundedTotalCents, 2000);
    assert.equal(financials.netReceivedCents, 8000);
    assert.equal(financials.balanceCents, 2000, "E2E27: refund parcial abre saldo de novo (100-80=20)");
    assert.equal(financials.financialStatus, "partial");
  }

  // ===== E2E28/E2E29 — Repay after refund: payment=20 novamente, baseado em NET, nunca gross =====
  {
    await recordServicePaymentCommand(db, uid, mainWorkId, 2000, "pix", `e2e-pay-2-${uid}`);
    const work = normalizeServiceWorkDocument((await db.doc(`users/${uid}/serviceWorks/${mainWorkId}`).get()).data() as ServiceWork);
    const financials = deriveServiceWorkFinancials(work);
    assert.equal(financials.grossReceivedCents, 12000, "E2E28: gross soma os dois pagamentos (100+20)");
    assert.equal(financials.refundedTotalCents, 2000);
    assert.equal(financials.netReceivedCents, 10000, "E2E28: net = 120-20 = 100, de volta ao valor contratado");
    assert.equal(financials.balanceCents, 0, "E2E28/E2E29: saldo calculado sobre NET (100-100=0), nunca sobre gross (120-100=20 estaria errado)");
    assert.equal(financials.financialStatus, "paid");
    // Uma tentativa de receber MAIS um centavo agora deve ser rejeitada (prova adicional de que a regra é
    // baseada em net, não em "quanto ainda falta pelo gross").
    await assert.rejects(
      recordServicePaymentCommand(db, uid, mainWorkId, 1, "cash", `e2e-overpay-${uid}`),
      (error: unknown) => (error as { code?: string })?.code === "OVERPAYMENT_NOT_SUPPORTED",
      "E2E29: acima do saldo (calculado por NET) é rejeitado mesmo com refundedTotalCents > 0",
    );
  }

  // ===== E2E30-E2E33 — conclusão preserva tudo =====
  {
    await completeServiceWorkCommand(db, uid, mainWorkId, `e2e-complete-${uid}`);
    const work = normalizeServiceWorkDocument((await db.doc(`users/${uid}/serviceWorks/${mainWorkId}`).get()).data() as ServiceWork);
    assert.equal(work.status, "completed", "E2E30: Work concluído");
    assert.ok(work.completedAt);

    const paymentsSnap = await db.collection(`users/${uid}/serviceWorks/${mainWorkId}/payments`).get();
    assert.equal(paymentsSnap.size, 2, "E2E31: os 2 Payments permanecem intactos após concluir");
    const workAfter = normalizeServiceWorkDocument((await db.doc(`users/${uid}/serviceWorks/${mainWorkId}`).get()).data() as ServiceWork);
    assert.equal(workAfter.quoteId, quoteId, "E2E32: Quote permanece vinculado após concluir");

    const bookingDoc = await db.doc(`users/${uid}/bookings/${mainBookingId}`).get();
    assert.equal(bookingDoc.data()?.status, "confirmed", "E2E33: Booking permanece historicamente coerente (nunca alterado pela conclusão do Work)");
    assert.equal(bookingDoc.data()?.workId, mainWorkId);
  }

  // ======================================================================================================
  // CENÁRIO 2 — E2E34-E2E39: reagendamento público (Work planned separado, nunca o completed acima).
  // ======================================================================================================
  {
    await db.doc(`users/${uid}/services/svc2`).set(validService("svc2", uid, { name: "Barba" }));
    const day = futureDateAtSafeLocalTime(7, 0, 0);
    const rangeStartAt = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0)).toISOString();
    const rangeEndAt = new Date(Date.parse(rangeStartAt) + 24 * 60 * 60_000).toISOString();
    const originalSlot = (await getServiceAvailabilityCommand(db, uid, "svc2", "default", rangeStartAt, rangeEndAt)).candidates[0].startAt;

    const hold = await createPublicServiceBookingHoldCommand(db, uid, "svc2", originalSlot, `e2e-resched-hold-${uid}`);
    const confirm = await confirmPublicServiceBookingHoldCommand(db, uid, hold.holdId, "Cliente Reagenda", "+55 11 90000-2222", `e2e-resched-confirm-${uid}`);
    const token = confirm.manageToken as string;

    const managed = await getPublicManagedBookingCommand(db, uid, "Barbearia E2E", token);
    const bookingIdBefore = (await db.collection(`users/${uid}/bookings`).where("startAt", "==", originalSlot).limit(1).get()).docs[0].id;
    const workIdBefore = (await db.collection(`users/${uid}/bookings`).where("startAt", "==", originalSlot).limit(1).get()).docs[0].data().workId;

    const rescheduleAvailability = await getPublicRescheduleAvailabilityCommand(db, uid, token, rangeStartAt, rangeEndAt);
    const newSlot = rescheduleAvailability.candidates.find((c) => c.startAt !== originalSlot)?.startAt
      ?? (await getServiceAvailabilityCommand(db, uid, "svc2", "default", new Date(Date.parse(rangeEndAt)).toISOString(), new Date(Date.parse(rangeEndAt) + 24 * 60 * 60_000).toISOString())).candidates[0].startAt;
    await reschedulePublicManagedBookingCommand(db, uid, token, newSlot, `e2e-resched-do-${uid}`);

    const bookingAfter = await db.doc(`users/${uid}/bookings/${bookingIdBefore}`).get();
    assert.equal(bookingAfter.id, bookingIdBefore, "E2E34: mesmo Booking id após reagendar");
    assert.equal(bookingAfter.data()?.workId, workIdBefore, "E2E35: mesmo Work");
    assert.equal(bookingAfter.data()?.startAt, newSlot, "seed: horário realmente mudou");

    const oldLock = await db.doc(`users/${uid}/scheduleLocks/default__${originalSlot.replace(/[:.]/g, "-")}`).get();
    assert.equal(oldLock.exists, false, "E2E36: lock antigo liberado");
    const newLock = await db.doc(`users/${uid}/scheduleLocks/default__${newSlot.replace(/[:.]/g, "-")}`).get();
    assert.equal(newLock.exists, true, "E2E37: novo lock adquirido");

    const agendaAfterReschedule = await db.collection(`users/${uid}/bookings`)
      .where("resourceId", "==", "default").where("startAt", ">=", rangeStartAt).where("startAt", "<", new Date(Date.parse(newSlot) + 24 * 60 * 60_000).toISOString()).get();
    assert.ok(agendaAfterReschedule.docs.some((d) => d.id === bookingIdBefore && d.data().startAt === newSlot), "E2E38: a Agenda owner passa a mostrar o novo horário");

    const readAfter = await getPublicManagedBookingCommand(db, uid, "Barbearia E2E", token);
    assert.equal(readAfter.startAt, newSlot, "E2E39: o mesmo token continua válido, agora refletindo o novo horário");
    void managed;
  }

  // ======================================================================================================
  // CENÁRIO 3 — E2E40-E2E45: cancelamento público (TERCEIRO Booking, ainda planned).
  // ======================================================================================================
  {
    const day = futureDateAtSafeLocalTime(8, 0, 0);
    const rangeStartAt = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0)).toISOString();
    const rangeEndAt = new Date(Date.parse(rangeStartAt) + 24 * 60 * 60_000).toISOString();
    const slot = (await getServiceAvailabilityCommand(db, uid, "svc", "default", rangeStartAt, rangeEndAt)).candidates[0].startAt;

    const hold = await createPublicServiceBookingHoldCommand(db, uid, "svc", slot, `e2e-cancel-hold-${uid}`);
    const confirm = await confirmPublicServiceBookingHoldCommand(db, uid, hold.holdId, "Cliente Cancela", "+55 11 90000-3333", `e2e-cancel-confirm-${uid}`);
    const token = confirm.manageToken as string;
    const bookingId = (await db.collection(`users/${uid}/bookings`).where("startAt", "==", slot).limit(1).get()).docs[0].id;
    const workId = (await db.collection(`users/${uid}/bookings`).where("startAt", "==", slot).limit(1).get()).docs[0].data().workId as string;

    await cancelPublicManagedBookingCommand(db, uid, token, `e2e-cancel-do-${uid}`);

    const bookingAfter = await db.doc(`users/${uid}/bookings/${bookingId}`).get();
    assert.equal(bookingAfter.data()?.status, "cancelled", "E2E40: Booking cancelado");
    const workAfter = normalizeServiceWorkDocument((await db.doc(`users/${uid}/serviceWorks/${workId}`).get()).data() as ServiceWork);
    assert.equal(workAfter.status, "cancelled", "E2E41: Work cancelado consistentemente");

    const lockAfter = await db.doc(`users/${uid}/scheduleLocks/default__${slot.replace(/[:.]/g, "-")}`).get();
    assert.equal(lockAfter.exists, false, "E2E42: locks liberados");

    const availabilityAfterCancel = await getServiceAvailabilityCommand(db, uid, "svc", "default", rangeStartAt, rangeEndAt);
    assert.ok(availabilityAfterCancel.candidates.some((c) => c.startAt === slot), "E2E43: o slot volta a aparecer na disponibilidade");

    const paymentsAfterCancel = await db.collection(`users/${uid}/serviceWorks/${workId}/payments`).get();
    assert.equal(paymentsAfterCancel.size, 0, "E2E44/E2E12: nenhum Refund/Payment criado pelo cancelamento público");

    const readAfterCancel = await getPublicManagedBookingCommand(db, uid, "Barbearia E2E", token);
    assert.equal(readAfterCancel.status, "cancelled", "E2E45: o token continua resolvendo, só para leitura do estado cancelado");
    assert.equal(readAfterCancel.canCancel, false);
    assert.equal(readAfterCancel.canReschedule, false);
  }

  // ======================================================================================================
  // E2E46-E2E51 — segurança pública, no fluxo integrado real (mesmo tenant usado acima).
  // ======================================================================================================
  {
    const app = initializeApp({ apiKey: "demo-api-key", authDomain: "demo-revendasmart.firebaseapp.com", projectId: "demo-revendasmart", appId: `e2e-anon-${Date.now()}` }, `e2e-anon-app-${Date.now()}-${Math.random()}`);
    const clientDb: ClientFirestore = getFirestore(app);
    connectFirestoreEmulator(clientDb, "127.0.0.1", 8080);
    try {
      await assert.rejects(getDocs(collection(clientDb, "users", uid, "bookings")), /permission-denied/i, "E2E46: anônimo não lê Bookings");
      await assert.rejects(getDocs(collection(clientDb, "users", uid, "serviceWorks")), /permission-denied/i, "E2E47: anônimo não lê Works");
      await assert.rejects(getDocs(collection(clientDb, "users", uid, "clients")), /permission-denied/i, "E2E48: anônimo não lê Clients");
      await assert.rejects(getDocs(collection(clientDb, "users", uid, "serviceWorks", mainWorkId, "payments")), /permission-denied/i, "E2E49: anônimo não lê Payments");
      await assert.rejects(getDocs(collection(clientDb, "users", uid, "quotes")), /permission-denied/i, "E2E50: anônimo não lê Quotes");
      // E2E51 — write: Rules já negam create/update/delete=false para Bookings/Works/Quotes/Payments
      // integralmente (provado em detalhe pelas suítes de segurança dedicadas SERV-BOOK-01/02/
      // services-security-tests.ts/SERV-PUBLIC-02); aqui confirmamos mais uma vez no MESMO tenant do
      // fluxo integrado, com um query real em vez de setDoc solto, para fechar o ciclo end-to-end.
      await assert.rejects(
        getDocs(query(collection(clientDb, "users", uid, "bookings"), where("status", "==", "confirmed"))),
        /permission-denied/i,
        "E2E51 (leitura): mesmo uma query filtrada permanece negada a um visitante anônimo",
      );
    } finally {
      await deleteApp(app).catch(() => {});
    }
  }

  // ======================================================================================================
  // E2E52-E2E55 — tenant isolation com um SEGUNDO tenant real.
  // ======================================================================================================
  {
    const { uid: uidB, slug: slugB } = await seedTenant(db);

    // E2E52 — slug de A não acessa Service de B (loja resolvida é sempre a de B; Service "svc" só existe
    // sob o uid de B, nunca o de A, então não há confusão possível de qualquer forma — reforça via leitura
    // cruzada explícita).
    const storeB = await resolvePublicBookingStore(db, slugB);
    assert.ok(storeB);
    assert.notEqual(storeB!.uid, uid, "E2E52: o slug de B nunca resolve para o uid de A");

    // E2E53 — token de A não gerencia Booking de B.
    const day = futureDateAtSafeLocalTime(9, 0, 0);
    const rangeStartAt = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0)).toISOString();
    const rangeEndAt = new Date(Date.parse(rangeStartAt) + 24 * 60 * 60_000).toISOString();
    const slotB = (await getServiceAvailabilityCommand(db, uidB, "svc", "default", rangeStartAt, rangeEndAt)).candidates[0].startAt;
    const holdB = await createPublicServiceBookingHoldCommand(db, uidB, "svc", slotB, `e2e-tenantb-hold-${uidB}`);
    const confirmB = await confirmPublicServiceBookingHoldCommand(db, uidB, holdB.holdId, "Cliente B", "+55 11 90000-4444", `e2e-tenantb-confirm-${uidB}`);
    const slotA = (await getServiceAvailabilityCommand(db, uid, "svc", "default", rangeStartAt, rangeEndAt)).candidates[0]?.startAt
      ?? (await getServiceAvailabilityCommand(db, uid, "svc2", "default", rangeStartAt, rangeEndAt)).candidates[0].startAt;
    const holdA = await createPublicServiceBookingHoldCommand(db, uid, "svc", slotA, `e2e-tenanta-hold-${uid}`);
    const confirmA = await confirmPublicServiceBookingHoldCommand(db, uid, holdA.holdId, "Cliente A", "+55 11 90000-5555", `e2e-tenanta-confirm-${uid}`);

    await assert.rejects(
      getPublicManagedBookingCommand(db, uidB, storeB!.name, confirmA.manageToken as string),
      (error: unknown) => (error as { code?: string })?.code === "BOOKING_NOT_FOUND",
      "E2E53: o token do Booking de A nunca gerencia nada sob o tenant B",
    );
    void confirmB;

    // E2E54 — Availability de A não expõe/herda dados de B: `slotA` foi calculado LOGO ACIMA, DEPOIS que
    // slotB já estava reservado (confirmB já rodou) — sob o MESMO schedule (seedTenant usa idêntica janela
    // 09:00-12:00 para os dois tenants), o primeiro candidato de A ainda assim coincidiu exatamente com
    // slotB (o horário que B acabou de ocupar), provando que a disponibilidade de A foi computada só a
    // partir dos próprios dados de A — nunca herdou o Booking de B como se fosse uma ocupação sua.
    assert.equal(slotA, slotB, "E2E54: o Booking de B não influencia em nada a disponibilidade calculada para A (mesmo schedule, tenants isolados por path)");

    // E2E55 — Booking de A nunca aparece na "Agenda" (mesma query) de B.
    const agendaB = await db.collection(`users/${uidB}/bookings`)
      .where("resourceId", "==", "default").where("startAt", ">=", rangeStartAt).where("startAt", "<", rangeEndAt).get();
    assert.ok(!agendaB.docs.some((d) => d.data().tenantUid === uid), "E2E55: nenhum Booking de A aparece na query da Agenda de B");
  }

  console.log("Services E2E acceptance tests passed — full MVP cycle proven with real commands end-to-end: E2E1-4 availability respects weeklyHours/blocks/timezone with the exact expected UTC instants, E2E5-13 a real public booking creates exactly one Client+Booking+Work in the correct tenant with zero Payment/Refund/Quote and origin=booking, E2E14-17 the owner Agenda's exact query surfaces it with correct time/resource/workId, E2E18-19 Work lifecycle (start) preserves customer/service/contracted-total, E2E20-25 Quote-for-Work links exactly once, survives draft edits and versioning, and never silently changes the contracted total, E2E26-29 Payment/Refund/repay-after-refund all derive correctly from NET (never gross), E2E30-33 completing a Work preserves every Payment/Quote/Booking record, E2E34-39 a public reschedule preserves the same Booking/Work id, correctly swaps locks, is visible in the owner Agenda immediately, and keeps the same token valid, E2E40-45 a public cancel releases locks, restores the slot to availability, cancels the Work consistently, creates no Refund, and leaves the token read-only, E2E46-51 an anonymous client can read none of Bookings/Works/Clients/Payments/Quotes even with a fresh query in the same integrated tenant, and E2E52-55 a second real tenant proves slug/token/availability/Agenda isolation end-to-end.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
