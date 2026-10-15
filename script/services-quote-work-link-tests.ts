import assert from "node:assert/strict";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";
import {
  acceptQuoteCommand,
  convertAcceptedQuoteToWorkCommand,
  createServiceQuoteForWorkCommand,
  sendQuoteCommand,
} from "../server/service-quote-commands";
import { recordServicePaymentCommand } from "../server/service-payment-commands";
import { assertValidQuote, type Quote } from "../shared/service-quotes";
import {
  assertValidServiceWork,
  calculateCommercialTotals,
  createZeroServiceWorkFinancialSummary,
  normalizeServiceWorkDocument,
  type CommercialItem,
  type ServiceWork,
} from "../shared/services";

/**
 * SERV-QUOTE-LINK-01 — QW1-QW12: prova a relação mínima Quote<->Work decidida no ticket.
 * ServiceWork.quoteId é a fonte de verdade única (nunca duplicada em Quote.workId — o comando que cria o
 * Quote para um Work sempre cria uma Quote NOVA na mesma transação, então "Quote já ligado a outro Work"
 * é garantido por construção, sem precisar de um ponteiro reverso). Mesmo padrão de teste (comandos
 * chamados diretamente contra o emulador via Admin SDK, sem harness HTTP) já usado em
 * script/services-quote-tests.ts. QW10 (client direct write DENY) vive em script/services-security-tests.ts,
 * ao lado dos outros testes de Rules de ServiceWork/Quote.
 */
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

function requireEmulatorEnv() {
  assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-revendasmart");
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
}

function tenantUid(prefix = "quote-work-link"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, fieldValue]) => typeof fieldValue !== "undefined")) as T;
}

function hasCode(expectedCode: string) {
  return (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === expectedCode;
}

const baseItems: readonly CommercialItem[] = [
  {
    kind: "service",
    id: "line-service",
    snapshot: { sourceId: "service-1", capturedAt: "2026-08-28T00:00:00.000Z", name: "Corte", priceMode: "fixed", priceCents: 6000 },
    quantity: 1,
    unitPriceCents: 6000,
    lineTotalCents: 6000,
  },
];

async function seedManualWork(uid: string, workId: string, overrides: Partial<ServiceWork> = {}): Promise<ServiceWork> {
  const db = initializeFirebaseAdmin().firestore();
  const now = "2026-08-28T00:00:00.000Z";
  const items = overrides.items ?? baseItems;
  const work: ServiceWork = assertValidServiceWork({
    id: workId,
    tenantUid: uid,
    status: overrides.status ?? "planned",
    origin: "manual",
    customerId: overrides.customerId,
    items,
    totals: overrides.totals ?? calculateCommercialTotals(items),
    financialSummary: overrides.financialSummary ?? createZeroServiceWorkFinancialSummary(),
    cost: overrides.cost ?? { kind: "unknown" },
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    startedAt: overrides.startedAt,
    completedAt: overrides.completedAt,
    cancelledAt: overrides.cancelledAt,
  });
  await db.doc(`users/${uid}/serviceWorks/${workId}`).set(omitUndefined(work as unknown as Record<string, unknown>));
  return work;
}

async function getWork(uid: string, workId: string): Promise<ServiceWork> {
  const db = initializeFirebaseAdmin().firestore();
  const snapshot = await db.doc(`users/${uid}/serviceWorks/${workId}`).get();
  assert.equal(snapshot.exists, true, `Work ${workId} deve existir`);
  return normalizeServiceWorkDocument(snapshot.data() as ServiceWork);
}

async function getQuoteDoc(uid: string, quoteId: string): Promise<Quote> {
  const db = initializeFirebaseAdmin().firestore();
  const snapshot = await db.doc(`users/${uid}/quotes/${quoteId}`).get();
  assert.equal(snapshot.exists, true, `Quote ${quoteId} deve existir`);
  return assertValidQuote(snapshot.data() as Quote);
}

async function seedDraftQuote(uid: string, quoteId: string): Promise<Quote> {
  const db = initializeFirebaseAdmin().firestore();
  const now = "2026-08-28T00:00:00.000Z";
  const quote: Quote = assertValidQuote({
    id: quoteId, tenantUid: uid, status: "draft",
    draftItems: baseItems, draftTotals: calculateCommercialTotals(baseItems),
    draftValidUntil: isoDaysFromNow(7),
    createdAt: now, updatedAt: now,
  });
  await db.doc(`users/${uid}/quotes/${quoteId}`).set(omitUndefined(quote as unknown as Record<string, unknown>));
  return quote;
}

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60_000).toISOString();
}

async function run() {
  requireEmulatorEnv();
  const db = initializeFirebaseAdmin().firestore();

  // ===== QW1 — Work sem Quote =====
  {
    const uid = tenantUid();
    const work = await seedManualWork(uid, "work-qw1");
    assert.equal(work.quoteId, undefined, "QW1: Work recém-criado não deve ter quoteId");
  }

  // ===== QW2/QW3 — criar Quote para Work, Work passa a referenciar o Quote =====
  {
    const uid = tenantUid();
    await seedManualWork(uid, "work-qw2");
    const result = await createServiceQuoteForWorkCommand(db, uid, "work-qw2", { customerMessage: "Segue o orçamento" }, "qw2-key-1");
    assert.equal(result.action, "create_quote_for_work");
    assert.equal(result.workId, "work-qw2");
    assert.equal(result.idempotentReplay, false);
    assert.ok(result.quoteId, "QW2: um quoteId deve ser retornado");

    const quote = await getQuoteDoc(uid, result.quoteId);
    assert.equal(quote.status, "draft", "QW2: Quote criado começa em draft");
    assert.equal(quote.draftCustomerMessage, "Segue o orçamento");
    assert.deepEqual(quote.draftItems, baseItems, "QW2: itens do Quote espelham os itens do Work");

    const workAfter = await getWork(uid, "work-qw2");
    assert.equal(workAfter.quoteId, result.quoteId, "QW3: Work passa a referenciar o Quote criado");
  }

  // ===== QW4/QW7 — segunda criação: replay idempotente com a mesma key; rejeição determinística com key
  // diferente; nunca cria um segundo Quote =====
  {
    const uid = tenantUid();
    await seedManualWork(uid, "work-qw4");
    const first = await createServiceQuoteForWorkCommand(db, uid, "work-qw4", {}, "qw4-key-1");

    const replay = await createServiceQuoteForWorkCommand(db, uid, "work-qw4", {}, "qw4-key-1");
    assert.equal(replay.idempotentReplay, true, "QW4/QW7: mesma key -> replay idempotente");
    assert.equal(replay.quoteId, first.quoteId, "QW7: replay retorna o MESMO quoteId, nunca cria um segundo");

    await assert.rejects(
      createServiceQuoteForWorkCommand(db, uid, "work-qw4", {}, "qw4-key-2"),
      hasCode("WORK_ALREADY_HAS_QUOTE"),
      "QW4: key diferente sobre Work já vinculado deve ser rejeitada deterministicamente",
    );

    const quotesSnap = await db.collection(`users/${uid}/quotes`).get();
    assert.equal(quotesSnap.size, 1, "QW7: no máximo 1 Quote criado para este Work, mesmo após múltiplas tentativas");
  }

  // ===== QW5 — QuoteVersion preserva o mesmo vínculo Work<->Quote =====
  {
    const uid = tenantUid();
    await seedManualWork(uid, "work-qw5");
    const created = await createServiceQuoteForWorkCommand(db, uid, "work-qw5", {}, "qw5-key-1");
    // sendQuoteCommand exige draftValidUntil no futuro OU ausente; aqui está ausente (sem validUntil informado).
    await sendQuoteCommand(db, uid, created.quoteId, "qw5-send-1");
    const workAfter = await getWork(uid, "work-qw5");
    assert.equal(workAfter.quoteId, created.quoteId, "QW5: enviar/versionar o Quote não altera o vínculo com o Work");
  }

  // ===== QW6 — Quote -> Work (fluxo já existente de conversão) mantém o vínculo, agora também via quoteId =====
  {
    const uid = tenantUid();
    await seedDraftQuote(uid, "quote-qw6");
    await sendQuoteCommand(db, uid, "quote-qw6", "qw6-send-1");
    const sentQuote = await getQuoteDoc(uid, "quote-qw6");
    await acceptQuoteCommand(db, uid, "quote-qw6", sentQuote.currentVersionId as string, "qw6-accept-1");
    const convertResult = await convertAcceptedQuoteToWorkCommand(db, uid, "quote-qw6", "qw6-convert-1");
    assert.ok(convertResult.convertedWorkId, "QW6: conversão deve retornar o workId criado");
    const convertedWork = await getWork(uid, convertResult.convertedWorkId as string);
    assert.equal(convertedWork.origin, "quote");
    assert.equal(convertedWork.sourceQuoteId, "quote-qw6");
    assert.equal(convertedWork.quoteId, "quote-qw6", "QW6: quoteId espelha sourceQuoteId nos Works criados por conversão");
  }

  // ===== QW8 — concorrência: duas tentativas simultâneas, keys diferentes, no máximo 1 Quote vinculado =====
  {
    const uid = tenantUid();
    await seedManualWork(uid, "work-qw8");
    const [settledA, settledB] = await Promise.allSettled([
      createServiceQuoteForWorkCommand(db, uid, "work-qw8", {}, "qw8-key-a"),
      createServiceQuoteForWorkCommand(db, uid, "work-qw8", {}, "qw8-key-b"),
    ]);
    const succeeded = [settledA, settledB].filter((item) => item.status === "fulfilled");
    const failed = [settledA, settledB].filter((item) => item.status === "rejected");
    assert.equal(succeeded.length, 1, "QW8: exatamente uma das duas tentativas concorrentes deve ter sucesso");
    assert.equal(failed.length, 1, "QW8: a outra deve ser rejeitada (nunca as duas com sucesso)");
    assert.equal((failed[0] as PromiseRejectedResult).reason?.code, "WORK_ALREADY_HAS_QUOTE");

    const winningQuoteId = (succeeded[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof createServiceQuoteForWorkCommand>>>).value.quoteId;
    const workAfter = await getWork(uid, "work-qw8");
    assert.equal(workAfter.quoteId, winningQuoteId, "QW8: Work.quoteId aponta para o único Quote realmente criado");
    const quotesSnap = await db.collection(`users/${uid}/quotes`).get();
    assert.equal(quotesSnap.size, 1, "QW8: no máximo 1 Quote foi persistido, mesmo sob concorrência real");
  }

  // ===== QW9 — tenant isolation: criar Quote para um Work do tenant A nunca afeta o tenant B =====
  {
    const uidA = tenantUid("qw9-a");
    const uidB = tenantUid("qw9-b");
    await seedManualWork(uidA, "work-qw9");
    await seedManualWork(uidB, "work-qw9");
    await createServiceQuoteForWorkCommand(db, uidA, "work-qw9", {}, "qw9-key-a");
    const workA = await getWork(uidA, "work-qw9");
    const workB = await getWork(uidB, "work-qw9");
    assert.ok(workA.quoteId, "QW9: o Work do tenant A recebeu o vínculo");
    assert.equal(workB.quoteId, undefined, "QW9: o Work do tenant B (mesmo workId) nunca é afetado");
  }

  // ===== QW11/QW12 — Payment invariants preservadas: criar Quote nunca altera totals/financialSummary do
  // Work, e netReceivedCents <= contractedTotalCents continua valendo exatamente como antes =====
  {
    const uid = tenantUid();
    await seedManualWork(uid, "work-qw11");
    await recordServicePaymentCommand(db, uid, "work-qw11", 3000, "cash", "qw11-payment-1");
    const workBeforeQuote = await getWork(uid, "work-qw11");
    assert.equal(workBeforeQuote.financialSummary.netReceivedCents, 3000, "QW11: pagamento registrado antes do Quote");

    await createServiceQuoteForWorkCommand(db, uid, "work-qw11", {}, "qw11-quote-1");
    const workAfterQuote = await getWork(uid, "work-qw11");
    assert.deepEqual(workAfterQuote.totals, workBeforeQuote.totals, "QW11/QUOTE_EDIT_CHANGES_WORK_CONTRACTED_TOTAL=NO: criar Quote não altera totals do Work");
    assert.deepEqual(workAfterQuote.financialSummary, workBeforeQuote.financialSummary, "QW11: criar Quote não altera financialSummary do Work");
    assert.ok(
      workAfterQuote.financialSummary.netReceivedCents <= workAfterQuote.totals.contractedTotalCents,
      "QW12: netReceivedCents <= contractedTotalCents continua valendo após vincular um Quote",
    );
  }

  console.log("Services quote<->work link tests passed: a Work without a Quote stays valid (QW1), createServiceQuoteForWorkCommand links a fresh draft Quote to an existing Work and the Work reflects it via quoteId (QW2/QW3), a second attempt with the same key replays the same Quote while a different key is deterministically rejected and never creates a second Quote (QW4/QW7), sending/versioning the Quote preserves the same Work link (QW5), the existing Quote->Work conversion flow now also mirrors quoteId (QW6), true concurrency yields at most one linked Quote (QW8), tenant isolation holds even for identical workIds across tenants (QW9), and creating a Quote never touches the Work's totals/financialSummary — netReceivedCents <= contractedTotalCents remains exactly preserved (QW11/QW12).");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
