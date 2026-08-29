import assert from "node:assert/strict";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, type Auth } from "firebase/auth";
import { deleteApp as deleteAdminApp, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import {
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  setDoc,
  updateDoc,
  type Firestore,
} from "firebase/firestore";

const PROJECT_ID = "demo-revendasmart";
const NOW = "2026-08-27T00:00:00.000Z";
const LATER = "2026-08-27T01:00:00.000Z";

type Context = { app: FirebaseApp; auth: Auth; db: Firestore; uid?: string };

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, fieldValue]) => typeof fieldValue !== "undefined")) as T;
}

function assertEmulatorEnv() {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
}

function createContext(label: string): Context {
  const app = initializeApp(
    {
      apiKey: "demo-api-key",
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
      appId: `services-security-${label}`,
    },
    `services-security-${label}-${Date.now()}-${Math.random()}`,
  );
  const auth = getAuth(app);
  const db = getFirestore(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  return { app, auth, db };
}

async function signIn(context: Context, label: string) {
  const credential = await createUserWithEmailAndPassword(
    context.auth,
    `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
    "LocalTestPassword!123",
  );
  context.uid = credential.user.uid;
  return credential.user.uid;
}

async function expectSucceeds(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    console.log(`PASS ${label}`);
  } catch (error) {
    const code = (error as { code?: string }).code ?? "unknown";
    throw new Error(`${label}: esperava sucesso, recebeu ${code}`);
  }
}

async function expectFails(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    const code = (error as { code?: string }).code ?? "unknown";
    assert.notEqual(code, "unavailable", `${label}: emulador indisponível`);
    console.log(`PASS ${label} bloqueado com ${code}`);
    return;
  }
  throw new Error(`${label}: esperava bloqueio pelas rules`);
}

function validService(id: string, tenantUid: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    tenantUid,
    name: "Corte de cabelo",
    active: true,
    published: true,
    pricing: { mode: "fixed", priceCents: 6000 },
    cost: { kind: "unknown" },
    bookingMode: "none",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function validServiceWork(id: string, tenantUid: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    tenantUid,
    status: "planned",
    origin: "manual",
    items: [],
    totals: {
      serviceRevenueCents: 0,
      productRevenueCents: 0,
      additionalRevenueCents: 0,
      discountTotalCents: 0,
      contractedTotalCents: 0,
    },
    financialSummary: {
      grossReceivedCents: 0,
      refundedTotalCents: 0,
      netReceivedCents: 0,
    },
    cost: { kind: "unknown" },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function validPayment(id: string, tenantUid: string, workId: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    tenantUid,
    workId,
    amountCents: 1000,
    method: "pix",
    recordedAt: NOW,
    refundedTotalCents: 0,
    idempotencyKey: `idem-${id}`,
    ...overrides,
  };
}

function validRefund(id: string, tenantUid: string, workId: string, paymentId: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    tenantUid,
    workId,
    paymentId,
    amountCents: 500,
    refundedAt: LATER,
    idempotencyKey: `idem-${id}`,
    ...overrides,
  };
}

function validQuote(id: string, tenantUid: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    tenantUid,
    status: "draft",
    customerId: "client-1",
    draftItems: [],
    draftTotals: {
      serviceRevenueCents: 0,
      productRevenueCents: 0,
      additionalRevenueCents: 0,
      discountTotalCents: 0,
      contractedTotalCents: 0,
    },
    draftCustomerMessage: "Mensagem",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function validQuoteVersion(id: string, quoteId: string, tenantUid: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    tenantUid,
    quoteId,
    versionNumber: 1,
    customerId: "client-1",
    items: [],
    totals: {
      serviceRevenueCents: 0,
      productRevenueCents: 0,
      additionalRevenueCents: 0,
      discountTotalCents: 0,
      contractedTotalCents: 0,
    },
    customerMessage: "Mensagem",
    createdAt: NOW,
    sentAt: NOW,
    ...overrides,
  };
}

async function run() {
  assertEmulatorEnv();
  const tenantA = createContext("tenant-a");
  const tenantB = createContext("tenant-b");
  const anonymous = createContext("anonymous");
  const adminApp = initializeAdminApp({ projectId: PROJECT_ID }, `services-security-admin-${Date.now()}-${Math.random()}`);

  try {
    const uidA = await signIn(tenantA, "services-a");
    const uidB = await signIn(tenantB, "services-b");
    assert.notEqual(uidA, uidB);
    const adminDb = getAdminFirestore(adminApp);

    const serviceARef = doc(tenantA.db, "users", uidA, "services", "service-1");
    const workARef = doc(tenantA.db, "users", uidA, "serviceWorks", "work-1");
    const quoteARef = doc(tenantA.db, "users", uidA, "quotes", "quote-1");

    await expectSucceeds("tenant A cria Service próprio", () => setDoc(serviceARef, validService("service-1", uidA)));
    await expectSucceeds("tenant A lê Service próprio", async () => {
      const snapshot = await getDoc(serviceARef);
      assert.equal(snapshot.exists(), true);
      assert.equal(snapshot.data()?.tenantUid, uidA);
    });
    await expectFails("tenant B não lê Service de A", () => getDoc(doc(tenantB.db, "users", uidA, "services", "service-1")));
    await expectFails("público não lê Service published", () => getDoc(doc(anonymous.db, "users", uidA, "services", "service-1")));
    await expectFails("tenant B não altera Service de A", () => updateDoc(doc(tenantB.db, "users", uidA, "services", "service-1"), { name: "Ataque" }));
    await expectFails("tenant A não cria Service no path de B", () => setDoc(doc(tenantA.db, "users", uidB, "services", "service-path-b"), validService("service-path-b", uidA)));
    await expectFails("tenantUid divergente em Service", () => setDoc(doc(tenantA.db, "users", uidA, "services", "service-bad-tenant"), validService("service-bad-tenant", uidB)));
    await expectSucceeds("pricing starting_at válido", () => setDoc(doc(tenantA.db, "users", uidA, "services", "service-starting"), validService("service-starting", uidA, { pricing: { mode: "starting_at", startingAtPriceCents: 5000 } })));
    await expectSucceeds("pricing quote válido", () => setDoc(doc(tenantA.db, "users", uidA, "services", "service-quote"), validService("service-quote", uidA, { pricing: { mode: "quote" } })));
    await expectFails("pricing fixed sem price é negado", () => setDoc(doc(tenantA.db, "users", uidA, "services", "service-missing-price"), validService("service-missing-price", uidA, { pricing: { mode: "fixed" } })));
    await expectFails("pricing negativo é negado", () => setDoc(doc(tenantA.db, "users", uidA, "services", "service-negative"), validService("service-negative", uidA, { pricing: { mode: "fixed", priceCents: -1 } })));
    await expectFails("pricing fracionário é negado", () => setDoc(doc(tenantA.db, "users", uidA, "services", "service-fraction"), validService("service-fraction", uidA, { pricing: { mode: "fixed", priceCents: 19.5 } })));
    await expectSucceeds("cost known zero válido", () => setDoc(doc(tenantA.db, "users", uidA, "services", "service-cost-zero"), validService("service-cost-zero", uidA, { cost: { kind: "known", amountCents: 0 } })));
    await expectSucceeds("cost known positivo válido", () => setDoc(doc(tenantA.db, "users", uidA, "services", "service-cost-positive"), validService("service-cost-positive", uidA, { cost: { kind: "known", amountCents: 1500 } })));
    await expectFails("cost negativo é negado", () => setDoc(doc(tenantA.db, "users", uidA, "services", "service-cost-negative"), validService("service-cost-negative", uidA, { cost: { kind: "known", amountCents: -1 } })));
    await expectFails("mudar id do Service é negado", () => updateDoc(serviceARef, { id: "other-id" }));
    await expectFails("mudar tenantUid do Service é negado", () => updateDoc(serviceARef, { tenantUid: uidB }));
    await expectFails("delete de Service é negado", () => deleteDoc(serviceARef));

    await expectSucceeds("owner cria Work planned válido", () => setDoc(workARef, validServiceWork("work-1", uidA)));
    await expectSucceeds("owner lê Work próprio", async () => {
      const snapshot = await getDoc(workARef);
      assert.equal(snapshot.exists(), true);
      assert.equal(snapshot.data()?.status, "planned");
    });
    await expectFails("tenant B não lê Work de A", () => getDoc(doc(tenantB.db, "users", uidA, "serviceWorks", "work-1")));
    await expectFails("público não lê Work", () => getDoc(doc(anonymous.db, "users", uidA, "serviceWorks", "work-1")));
    await expectFails("owner não cria Work já completed", () => setDoc(doc(tenantA.db, "users", uidA, "serviceWorks", "work-completed"), validServiceWork("work-completed", uidA, { status: "completed" })));
    await expectFails("owner não altera status do Work", () => updateDoc(workARef, { status: "completed", updatedAt: LATER }));
    await expectFails("owner não altera completedAt do Work", () => updateDoc(workARef, { completedAt: LATER, updatedAt: LATER }));
    await expectFails("owner não altera tenantUid do Work", () => updateDoc(workARef, { tenantUid: uidB, updatedAt: LATER }));
    await expectFails("owner não altera id do Work", () => updateDoc(workARef, { id: "other-work", updatedAt: LATER }));
    await expectFails("delete de Work é negado", () => deleteDoc(workARef));
    await expectFails("owner não altera financialSummary do Work", () =>
      updateDoc(workARef, {
        financialSummary: {
          grossReceivedCents: 10,
          refundedTotalCents: 0,
          netReceivedCents: 10,
        },
        updatedAt: LATER,
      }));
    await expectSucceeds("owner altera campo seguro do Work", () =>
      updateDoc(workARef, {
        customerId: "client-1",
        items: [],
        totals: {
          serviceRevenueCents: 6000,
          productRevenueCents: 0,
          additionalRevenueCents: 0,
          discountTotalCents: 0,
          contractedTotalCents: 6000,
        },
        cost: { kind: "known", amountCents: 0 },
        updatedAt: LATER,
      }),
    );
    await expectFails("novo Work manual com summary nonzero é negado", () =>
      setDoc(doc(tenantA.db, "users", uidA, "serviceWorks", "work-bad-summary"), validServiceWork("work-bad-summary", uidA, {
        financialSummary: {
          grossReceivedCents: 100,
          refundedTotalCents: 0,
          netReceivedCents: 100,
        },
      })));

    await expectSucceeds("owner cria Quote draft válida", () => setDoc(quoteARef, validQuote("quote-1", uidA)));
    await expectSucceeds("owner lê Quote própria", async () => {
      const snapshot = await getDoc(quoteARef);
      assert.equal(snapshot.exists(), true);
      assert.equal(snapshot.data()?.status, "draft");
    });
    await expectFails("tenant B não lê Quote de A", () => getDoc(doc(tenantB.db, "users", uidA, "quotes", "quote-1")));
    await expectFails("anônimo não lê Quote", () => getDoc(doc(anonymous.db, "users", uidA, "quotes", "quote-1")));
    await expectSucceeds("owner atualiza draft da Quote", () =>
      updateDoc(quoteARef, {
        draftCustomerMessage: "Mensagem atualizada",
        updatedAt: LATER,
      }));
    await expectFails("owner não muda status da Quote diretamente", () =>
      updateDoc(quoteARef, {
        status: "sent",
        updatedAt: LATER,
      }));
    await expectFails("owner não muda lifecycle field da Quote diretamente", () =>
      updateDoc(quoteARef, {
        lastSentAt: LATER,
        updatedAt: LATER,
      }));
    await expectFails("owner não deleta Quote", () => deleteDoc(quoteARef));

    await adminDb.doc(`users/${uidA}/quotes/quote-sent`).set(omitUndefined(validQuote("quote-sent", uidA, {
      status: "sent",
      currentVersionId: "version-1",
      currentVersionNumber: 1,
      lastSentAt: NOW,
    })));
    await adminDb.doc(`users/${uidA}/quotes/quote-accepted`).set(omitUndefined(validQuote("quote-accepted", uidA, {
      status: "accepted",
      currentVersionId: "version-1",
      currentVersionNumber: 1,
      lastSentAt: NOW,
      acceptedVersionId: "version-1",
      acceptedAt: LATER,
    })));
    await adminDb.doc(`users/${uidA}/quotes/quote-rejected`).set(omitUndefined(validQuote("quote-rejected", uidA, {
      status: "rejected",
      currentVersionId: "version-1",
      currentVersionNumber: 1,
      lastSentAt: NOW,
      rejectedAt: LATER,
    })));
    await adminDb.doc(`users/${uidA}/quotes/quote-cancelled`).set(omitUndefined(validQuote("quote-cancelled", uidA, {
      status: "cancelled",
      cancelledAt: LATER,
    })));
    await expectFails("Quote sent não aceita update comercial client-side", () =>
      updateDoc(doc(tenantA.db, "users", uidA, "quotes", "quote-sent"), {
        draftCustomerMessage: "Ataque",
        updatedAt: "2026-08-27T02:00:00.000Z",
      }));
    await expectFails("Quote accepted não aceita update comercial client-side", () =>
      updateDoc(doc(tenantA.db, "users", uidA, "quotes", "quote-accepted"), {
        draftCustomerMessage: "Ataque",
        updatedAt: "2026-08-27T02:00:00.000Z",
      }));
    await expectFails("Quote rejected não aceita update comercial client-side", () =>
      updateDoc(doc(tenantA.db, "users", uidA, "quotes", "quote-rejected"), {
        draftCustomerMessage: "Ataque",
        updatedAt: "2026-08-27T02:00:00.000Z",
      }));
    await expectFails("Quote cancelled não aceita update comercial client-side", () =>
      updateDoc(doc(tenantA.db, "users", uidA, "quotes", "quote-cancelled"), {
        draftCustomerMessage: "Ataque",
        updatedAt: "2026-08-27T02:00:00.000Z",
      }));

    const versionRef = doc(tenantA.db, "users", uidA, "quotes", "quote-sent", "versions", "version-1");
    await adminDb.doc(`users/${uidA}/quotes/quote-sent/versions/version-1`).set(omitUndefined(validQuoteVersion("version-1", "quote-sent", uidA)));
    await expectSucceeds("owner lê QuoteVersion própria", async () => {
      const snapshot = await getDoc(versionRef);
      assert.equal(snapshot.exists(), true);
      assert.equal(snapshot.data()?.quoteId, "quote-sent");
    });
    await expectFails("owner não cria QuoteVersion direto no client", () =>
      setDoc(doc(tenantA.db, "users", uidA, "quotes", "quote-sent", "versions", "version-2"), validQuoteVersion("version-2", "quote-sent", uidA, { versionNumber: 2 })));
    await expectFails("owner não altera QuoteVersion", () =>
      updateDoc(versionRef, { customerMessage: "Alterada" }));
    await expectFails("owner não deleta QuoteVersion", () => deleteDoc(versionRef));

    await expectFails("client não forja sourceQuote refs num Work manual", () =>
      setDoc(doc(tenantA.db, "users", uidA, "serviceWorks", "work-quote-forge"), validServiceWork("work-quote-forge", uidA, {
        sourceQuoteId: "quote-1",
        sourceQuoteVersionId: "version-1",
      })));
    await expectFails("client não cria Work origin quote diretamente", () =>
      setDoc(doc(tenantA.db, "users", uidA, "serviceWorks", "work-origin-quote"), validServiceWork("work-origin-quote", uidA, {
        origin: "quote",
        sourceQuoteId: "quote-1",
        sourceQuoteVersionId: "version-1",
      })));

    await adminDb.doc(`users/${uidA}/serviceWorks/work-from-quote`).set(omitUndefined(validServiceWork("work-from-quote", uidA, {
      origin: "quote",
      sourceQuoteId: "quote-sent",
      sourceQuoteVersionId: "version-1",
    })));
    await expectFails("sourceQuote refs do Work são imutáveis", () =>
      updateDoc(doc(tenantA.db, "users", uidA, "serviceWorks", "work-from-quote"), {
        sourceQuoteId: "quote-2",
        updatedAt: "2026-08-27T03:00:00.000Z",
      }));

    await adminDb.doc(`users/${uidA}/serviceWorks/work-paid`).set(omitUndefined(validServiceWork("work-paid", uidA, {
      totals: {
        serviceRevenueCents: 10000,
        productRevenueCents: 0,
        additionalRevenueCents: 0,
        discountTotalCents: 0,
        contractedTotalCents: 10000,
      },
      financialSummary: {
        grossReceivedCents: 10000,
        refundedTotalCents: 2000,
        netReceivedCents: 8000,
      },
    })));
    await expectSucceeds("contracted 100/net80 -> update 90 PASS", () =>
      updateDoc(doc(tenantA.db, "users", uidA, "serviceWorks", "work-paid"), {
        totals: {
          serviceRevenueCents: 9000,
          productRevenueCents: 0,
          additionalRevenueCents: 0,
          discountTotalCents: 0,
          contractedTotalCents: 9000,
        },
        updatedAt: "2026-08-27T04:00:00.000Z",
      }));
    await expectFails("contracted 100/net80 -> update 70 DENY", () =>
      updateDoc(doc(tenantA.db, "users", uidA, "serviceWorks", "work-paid"), {
        totals: {
          serviceRevenueCents: 7000,
          productRevenueCents: 0,
          additionalRevenueCents: 0,
          discountTotalCents: 0,
          contractedTotalCents: 7000,
        },
        updatedAt: "2026-08-27T05:00:00.000Z",
      }));

    await adminDb.doc(`users/${uidA}/serviceWorks/work-legacy`).set(omitUndefined({
      id: "work-legacy",
      tenantUid: uidA,
      status: "planned",
      origin: "manual",
      items: [],
      totals: {
        serviceRevenueCents: 0,
        productRevenueCents: 0,
        additionalRevenueCents: 0,
        discountTotalCents: 0,
        contractedTotalCents: 0,
      },
      cost: { kind: "unknown" },
      createdAt: NOW,
      updatedAt: NOW,
    }));
    await expectSucceeds("legacy Work sem summary continua editável com net zero", () =>
      updateDoc(doc(tenantA.db, "users", uidA, "serviceWorks", "work-legacy"), {
        customerId: "client-legacy",
        updatedAt: "2026-08-27T06:00:00.000Z",
      }));
    await expectFails("client não adiciona summary arbitrariamente a legacy Work", () =>
      updateDoc(doc(tenantA.db, "users", uidA, "serviceWorks", "work-legacy"), {
        financialSummary: {
          grossReceivedCents: 1,
          refundedTotalCents: 0,
          netReceivedCents: 1,
        },
        updatedAt: "2026-08-27T07:00:00.000Z",
      }));

    await adminDb.doc(`users/${uidA}/serviceWorks/work-financial/payments/payment-1`).set(omitUndefined(validPayment("payment-1", uidA, "work-financial")));
    await adminDb.doc(`users/${uidA}/serviceWorks/work-financial/payments/payment-1/refunds/refund-1`).set(omitUndefined(validRefund("refund-1", uidA, "work-financial", "payment-1")));
    await adminDb.doc(`users/${uidA}/servicePaymentCommandIdempotency/key-1`).set({
      key: "key-1",
      tenantUid: uidA,
      action: "record_payment",
      workId: "work-financial",
      paymentId: "payment-1",
      amountCents: 1000,
      method: "pix",
      recordedAt: NOW,
      createdAt: NOW,
    });
    await expectSucceeds("owner lê Payment", async () => {
      const snapshot = await getDoc(doc(tenantA.db, "users", uidA, "serviceWorks", "work-financial", "payments", "payment-1"));
      assert.equal(snapshot.exists(), true);
      assert.equal(snapshot.data()?.amountCents, 1000);
    });
    await expectFails("tenant B não lê Payment", () =>
      getDoc(doc(tenantB.db, "users", uidA, "serviceWorks", "work-financial", "payments", "payment-1")));
    await expectFails("anonymous não lê Payment", () =>
      getDoc(doc(anonymous.db, "users", uidA, "serviceWorks", "work-financial", "payments", "payment-1")));
    await expectFails("client não cria Payment", () =>
      setDoc(doc(tenantA.db, "users", uidA, "serviceWorks", "work-financial", "payments", "payment-client"), validPayment("payment-client", uidA, "work-financial")));
    await expectFails("client não atualiza Payment", () =>
      updateDoc(doc(tenantA.db, "users", uidA, "serviceWorks", "work-financial", "payments", "payment-1"), { refundedTotalCents: 1 }));
    await expectFails("client não deleta Payment", () =>
      deleteDoc(doc(tenantA.db, "users", uidA, "serviceWorks", "work-financial", "payments", "payment-1")));
    await expectSucceeds("owner lê Refund", async () => {
      const snapshot = await getDoc(doc(tenantA.db, "users", uidA, "serviceWorks", "work-financial", "payments", "payment-1", "refunds", "refund-1"));
      assert.equal(snapshot.exists(), true);
      assert.equal(snapshot.data()?.amountCents, 500);
    });
    await expectFails("client não cria Refund", () =>
      setDoc(doc(tenantA.db, "users", uidA, "serviceWorks", "work-financial", "payments", "payment-1", "refunds", "refund-client"), validRefund("refund-client", uidA, "work-financial", "payment-1")));
    await expectFails("client não atualiza Refund", () =>
      updateDoc(doc(tenantA.db, "users", uidA, "serviceWorks", "work-financial", "payments", "payment-1", "refunds", "refund-1"), { amountCents: 300 }));
    await expectFails("client não deleta Refund", () =>
      deleteDoc(doc(tenantA.db, "users", uidA, "serviceWorks", "work-financial", "payments", "payment-1", "refunds", "refund-1")));
    await expectFails("idempotency collection invisível", () =>
      getDoc(doc(tenantA.db, "users", uidA, "servicePaymentCommandIdempotency", "key-1")));
  } finally {
    await Promise.all([deleteApp(tenantA.app), deleteApp(tenantB.app), deleteApp(anonymous.app)]);
    await deleteAdminApp(adminApp);
  }
}

run().then(() => {
  console.log("Services security emulator tests passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
