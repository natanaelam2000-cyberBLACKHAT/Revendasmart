import assert from "node:assert/strict";
import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, type Auth } from "firebase/auth";
import { collection, connectFirestoreEmulator, deleteDoc, deleteField, doc, getDoc, getDocs, getFirestore, setDoc, updateDoc, type Firestore } from "firebase/firestore";
import { connectStorageEmulator, deleteObject, getBytes, getStorage, ref, uploadString, type FirebaseStorage } from "firebase/storage";
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp, type App as AdminApp } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { getStorage as getAdminStorage } from "firebase-admin/storage";
import { reserveOrderCreation, releaseOrderReservation, finalizeOrderReservation } from "../server/public-catalog-order-idempotency";
import { reserveOrderCharge, releaseOrderChargeReservation, finalizeOrderChargeReservation } from "../server/public-catalog-order-payment-idempotency";
import { finalizeSaleTransaction } from "../server/sale-finalize-transaction";

const PROJECT_ID = "demo-revendasmart";
const now = new Date("2026-07-17T00:00:00.000Z").toISOString();

function requireLocalFirebaseEmulators() {
  const expected = {
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
  };
  for (const [name, value] of Object.entries(expected)) {
    assert.equal(process.env[name], value, `${name} deve apontar para ${value}`);
  }
  assert.notEqual(process.env.GOOGLE_CLOUD_PROJECT, "revenda-smart");
}

type Context = { app: FirebaseApp; auth: Auth; db: Firestore; storage: FirebaseStorage; uid?: string };

function createContext(name: string): Context {
  const app = initializeApp({
    apiKey: "demo-api-key",
    authDomain: `${PROJECT_ID}.firebaseapp.com`,
    projectId: PROJECT_ID,
    storageBucket: `${PROJECT_ID}.appspot.com`,
    appId: `demo-${name}`,
  }, name);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const storage = getStorage(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  return { app, auth, db, storage };
}

async function signIn(context: Context, label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const credential = await createUserWithEmailAndPassword(context.auth, `${label}-${suffix}@example.test`, "LocalTestPassword!123");
  context.uid = credential.user.uid;
  return credential.user.uid;
}

async function expectSucceeds(label: string, operation: () => Promise<unknown>) {
  try {
    await operation();
    console.log(`PASS ${label}`);
  } catch (error) {
    const code = (error as { code?: string })?.code || "unknown";
    throw new Error(`${label}: esperava sucesso, recebeu ${code}`);
  }
}

async function expectFails(label: string, operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    const code = (error as { code?: string })?.code || "unknown";
    assert.notEqual(code, "unavailable", `${label}: emulador indisponível`);
    console.log(`PASS ${label} bloqueado com ${code}`);
    return;
  }
  throw new Error(`${label}: esperava bloqueio pelas rules, mas a operação passou`);
}

function validProduct(id: string) {
  return {
    id,
    name: "Perfume Teste Local",
    brand: "Marca Local",
    origin: "Brasil",
    category: "Perfumes",
    productType: "Cosméticos & Perfumes",
    costPrice: 50,
    salePrice: 120,
    stock: 3,
    barcode: "0012345678905",
    description: "Produto sintético do Firebase Emulator Suite",
    imageUrl: "",
    storagePath: "",
    gender: "unissex",
    extras: { volume: "100ml" },
    isFeatured: false,
    isOnSale: false,
    discountPercent: 0,
    nameNormalized: "perfume teste local",
    brandNormalized: "marca local",
    categoryNormalized: "perfumes",
    barcodeNormalized: "0012345678905",
    productTypeNormalized: "cosmeticos perfumes",
    searchTokens: ["perfume", "teste", "local", "marca", "perfumes", "0012345678905"],
    searchSchemaVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
}

/** PRO-07K — shape mínimo válido de um approvedCutout, no caminho canônico do próprio produto/usuário. */
function validApprovedCutout(uid: string, productId: string) {
  return {
    sourceAssetId: "product-asset:" + productId + ":v1",
    cutoutAssetId: "product-cutout-approved:" + productId + ":sha256:emulatortest",
    storagePath: `users/${uid}/product-cutouts/${productId}/cutout-v1.png`,
    width: 800,
    height: 800,
    mimeType: "image/png",
    coordinateSpaceVersion: "product-image-coordinate-space-v1",
    preservesOriginalPixels: true,
    method: "specialized-api",
    createdAt: now,
  };
}

/** PLAN-IMPL-02B1 X2 — shape mínimo válido de Service para as Rules (mesmos campos obrigatórios de
 * isValidServiceShape em firestore.rules); `overrides` permite semear já com planAccessState="preserved". */
function validService(id: string, uid: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    tenantUid: uid,
    name: "Corte de Cabelo Local",
    active: true,
    published: true,
    pricing: { mode: "fixed", priceCents: 8000 },
    cost: { kind: "unknown" },
    bookingMode: "instant",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function validClient(id: string) {
  return {
    id,
    name: "Cliente Local",
    phone: "11999999999",
    whatsapp: "11999999999",
    email: "cliente@example.test",
    notes: "Cliente sintético",
    createdAt: now,
    updatedAt: now,
    totalSpent: 0,
    purchaseCount: 0,
  };
}

function validSale(id: string, clientId: string, productId: string) {
  return {
    id,
    clientId,
    products: [{ productId, quantity: 1, price: 120 }],
    subtotal: 120,
    total: 120,
    paymentType: "avista",
    date: now,
  };
}

const laterThanNow = new Date("2026-07-18T00:00:00.000Z").toISOString();

/**
 * Pedido mínimo aceito pelas Rules. createdAt e updatedAt nascem IGUAIS de propósito: a Rule de
 * create exige isso para provar que o documento acabou de ser criado.
 */
function validOrder(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    clientId: "client-local",
    clientName: "Cliente Local",
    status: "new",
    items: [{ productId: "product-local", name: "Perfume Teste Local", quantity: 2, unitPrice: 120 }],
    total: 240,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Cria um pedido já no status desejado, usando o Admin SDK (que ignora as Rules) para montar o cenário. */
async function seedOrderWithStatus(adminApp: AdminApp, ownerUid: string, orderId: string, status: string) {
  await getAdminFirestore(adminApp).doc(`users/${ownerUid}/orders/${orderId}`).set(validOrder(orderId, { status }));
}

async function seedBackendOnlyData(ownerUid: string) {
  const adminApp = initializeAdminApp({ projectId: PROJECT_ID }, `admin-${Date.now()}`);
  const adminDb = getAdminFirestore(adminApp);
  await adminDb.doc(`users/${ownerUid}/charges/charge-local`).set({
    id: "charge-local",
    clientId: "client-local",
    clientName: "Cliente Local",
    amount: 120,
    status: "pending",
    dueDate: now,
    createdAt: now,
  });
  await adminDb.doc(`users/${ownerUid}/installments/installment-local`).set({
    id: "installment-local",
    amount: 120,
    paidAmount: 0,
    status: "pending",
    dueDate: now,
  });
  await adminDb.doc(`users/${ownerUid}/mercadopago_connections/connection-local`).set({
    id: "connection-local",
    status: "connected",
    tokenSource: "connected",
    createdAt: now,
  });
  // LGPD/segurança (REVENDASMART-LGPD-ANPD-REMEDIATION-01, Fase 9): sales agora só é gravável pelo
  // backend (Admin SDK) — seed aqui para os testes de leitura/imutabilidade abaixo terem um documento.
  await adminDb.doc(`users/${ownerUid}/sales/sale-local`).set(validSale("sale-local", "client-local", "product-local"));
  await adminDb.doc(`user_settings/${ownerUid}`).set({
    storeName: "Loja Local",
    premiumActive: false,
  });
  return adminApp;
}

async function run() {
  requireLocalFirebaseEmulators();

  const owner = createContext("owner");
  const intruder = createContext("intruder");
  const anonymous = createContext("anonymous");
  let adminApp: AdminApp | undefined;

  try {
    const ownerUid = await signIn(owner, "owner");
    const intruderUid = await signIn(intruder, "intruder");
    assert.notEqual(ownerUid, intruderUid);
    adminApp = await seedBackendOnlyData(ownerUid);

    const ownerProductRef = doc(owner.db, "users", ownerUid, "products", "product-local");
    // PLAN-IMPL-02A2-FINALIZE — Product create is now server-authoritative only (firestore.rules:
    // allow create: if false, unconditionally — POST /api/products via server/plan-authoritative-
    // mutations.ts is the only path in, proven end-to-end by script/plan-impl-02a2-authoritative-
    // mutations-tests.ts). A direct client setDoc/create must be denied regardless of shape validity;
    // every fixture the shape/ownership tests below need is seeded through the Admin SDK instead (a
    // trusted setup step, same pattern seedBackendOnlyData already uses for server-owned collections),
    // and every case that used to prove "an invalid CREATE is rejected" now proves "an invalid UPDATE
    // is rejected" instead — isValidProductUpdate reuses the exact same shape contract as create, so no
    // coverage is lost, only the mechanism that reaches it (§18 of the ticket).
    await expectFails("owner não cria produto direto via setDoc (create é server-authoritative)", () => setDoc(ownerProductRef, validProduct("product-local")));
    const adminProductsDb = getAdminFirestore(adminApp!);
    const productFixtureIds = [
      "product-local", "product-cutout-ok", "product-legacy", "product-mass-assignment-target",
      "product-cutout-b64", "product-cutout-b64-upper", "product-cutout-mime", "product-cutout-preserve",
      "product-cutout-coordinate", "product-cutout-extra", "product-cutout-wrongpath",
      "product-cutout-other-user", "product-cutout-dimensions",
    ];
    await Promise.all(productFixtureIds.map((id) => adminProductsDb.doc(`users/${ownerUid}/products/${id}`).set(validProduct(id))));

    await expectSucceeds("owner lê próprio produto", async () => {
      const snapshot = await getDoc(ownerProductRef);
      assert.equal(snapshot.exists(), true);
      assert.equal(snapshot.data()?.nameNormalized, "perfume teste local");
    });
    await expectFails("outro usuário não lê produto do owner", () => getDoc(doc(intruder.db, "users", ownerUid, "products", "product-local")));
    await expectFails("usuário anônimo não lê produto privado", () => getDoc(doc(anonymous.db, "users", ownerUid, "products", "product-local")));
    await expectFails("mass assignment de produto é bloqueado", () => updateDoc(doc(owner.db, "users", ownerUid, "products", "product-mass-assignment-target"), { premiumActive: true }));

    // ===== PRO-07K: approvedCutout persistido =====
    await expectSucceeds("owner define approvedCutout válido via update", () =>
      updateDoc(doc(owner.db, "users", ownerUid, "products", "product-cutout-ok"), { approvedCutout: validApprovedCutout(ownerUid, "product-cutout-ok") }));
    await expectSucceeds("owner atualiza outro campo mantendo approvedCutout válido", () =>
      updateDoc(doc(owner.db, "users", ownerUid, "products", "product-cutout-ok"), { name: "Perfume Teste Local Atualizado" }));
    await expectSucceeds("owner adiciona approvedCutout num produto legacy sem o campo", () =>
      updateDoc(doc(owner.db, "users", ownerUid, "products", "product-legacy"), { approvedCutout: validApprovedCutout(ownerUid, "product-legacy") }));
    await expectSucceeds("owner remove approvedCutout (invalidação manual)", () =>
      updateDoc(doc(owner.db, "users", ownerUid, "products", "product-legacy"), { approvedCutout: deleteField() }));
    await expectFails("approvedCutout com base64 inline é bloqueado", () =>
      updateDoc(doc(owner.db, "users", ownerUid, "products", "product-cutout-b64"), { approvedCutout: { ...validApprovedCutout(ownerUid, "product-cutout-b64"), downloadUrl: "data:image/png;base64,AAAA" } }));
    await expectFails("approvedCutout com DATA URL em maiúsculas é bloqueado", () =>
      updateDoc(doc(owner.db, "users", ownerUid, "products", "product-cutout-b64-upper"), { approvedCutout: { ...validApprovedCutout(ownerUid, "product-cutout-b64-upper"), downloadUrl: "DATA:image/png;base64,AAAA" } }));
    await expectFails("approvedCutout com mimeType diferente de PNG é bloqueado", () =>
      updateDoc(doc(owner.db, "users", ownerUid, "products", "product-cutout-mime"), { approvedCutout: { ...validApprovedCutout(ownerUid, "product-cutout-mime"), mimeType: "image/jpeg" } }));
    await expectFails("approvedCutout com preservesOriginalPixels != true é bloqueado", () =>
      updateDoc(doc(owner.db, "users", ownerUid, "products", "product-cutout-preserve"), { approvedCutout: { ...validApprovedCutout(ownerUid, "product-cutout-preserve"), preservesOriginalPixels: false } }));
    await expectFails("approvedCutout com coordinateSpaceVersion inválida é bloqueado", () =>
      updateDoc(doc(owner.db, "users", ownerUid, "products", "product-cutout-coordinate"), { approvedCutout: { ...validApprovedCutout(ownerUid, "product-cutout-coordinate"), coordinateSpaceVersion: "other-coordinate-space" } }));
    await expectFails("approvedCutout com campo extra é bloqueado", () =>
      updateDoc(doc(owner.db, "users", ownerUid, "products", "product-cutout-extra"), { approvedCutout: { ...validApprovedCutout(ownerUid, "product-cutout-extra"), apiKey: "secret" } }));
    await expectFails("approvedCutout apontando para storagePath de outro produto é bloqueado", () =>
      updateDoc(doc(owner.db, "users", ownerUid, "products", "product-cutout-wrongpath"), { approvedCutout: validApprovedCutout(ownerUid, "outro-produto") }));
    await expectFails("approvedCutout apontando para storagePath de outro usuário é bloqueado", () =>
      updateDoc(doc(owner.db, "users", ownerUid, "products", "product-cutout-other-user"), {
        approvedCutout: {
          ...validApprovedCutout(ownerUid, "product-cutout-other-user"),
          storagePath: `users/${intruderUid}/product-cutouts/product-cutout-other-user/cutout-v1.png`,
        },
      }));
    await expectFails("approvedCutout com dimensões inválidas é bloqueado", () =>
      updateDoc(doc(owner.db, "users", ownerUid, "products", "product-cutout-dimensions"), { approvedCutout: { ...validApprovedCutout(ownerUid, "product-cutout-dimensions"), width: 0 } }));
    await expectFails("update não aceita approvedCutout com MIME inválido", () =>
      updateDoc(doc(owner.db, "users", ownerUid, "products", "product-cutout-ok"), { approvedCutout: { ...validApprovedCutout(ownerUid, "product-cutout-ok"), mimeType: "image/jpeg" } }));
    await expectFails("trocar foto original sem remover approvedCutout stale é bloqueado", () =>
      updateDoc(doc(owner.db, "users", ownerUid, "products", "product-cutout-ok"), { imageUrl: "https://example.test/new-original.jpg" }));
    await expectSucceeds("trocar foto original removendo approvedCutout stale é permitido", () =>
      updateDoc(doc(owner.db, "users", ownerUid, "products", "product-cutout-ok"), {
        imageUrl: "https://example.test/new-original.jpg",
        approvedCutout: deleteField(),
      }));
    await expectFails("outro usuário não escreve approvedCutout no produto do owner", () =>
      updateDoc(doc(intruder.db, "users", ownerUid, "products", "product-cutout-ok"), { approvedCutout: validApprovedCutout(ownerUid, "product-cutout-ok") }));

    // ===== PLAN-IMPL-02B1 §29/X2 — planAccessState nunca é alterável pelo client, mesmo pelo dono do
    // próprio produto/serviço; só o servidor (Admin SDK, reconcilePlanAccess) grava este campo. Editar
    // outros campos de um documento já preservado continua permitido (não quebra a edição normal). =====
    await expectFails("owner não marca o próprio produto como preserved via updateDoc", () =>
      updateDoc(doc(owner.db, "users", ownerUid, "products", "product-local"), { planAccessState: "preserved" }));

    const adminDbForAccessState = getAdminFirestore(adminApp!);
    await adminDbForAccessState.doc(`users/${ownerUid}/products/product-preserved`).set({ ...validProduct("product-preserved"), planAccessState: "preserved" });
    await expectFails("owner não reativa produto preserved via updateDoc", () =>
      updateDoc(doc(owner.db, "users", ownerUid, "products", "product-preserved"), { planAccessState: "active" }));
    await expectSucceeds("owner ainda edita outros campos de um produto preserved", () =>
      updateDoc(doc(owner.db, "users", ownerUid, "products", "product-preserved"), { name: "Perfume Preservado Editado" }));
    await expectSucceeds("owner lê o próprio produto preserved", async () => {
      const snapshot = await getDoc(doc(owner.db, "users", ownerUid, "products", "product-preserved"));
      assert.equal(snapshot.exists(), true);
      assert.equal(snapshot.data()?.planAccessState, "preserved");
    });

    await adminDbForAccessState.doc(`users/${ownerUid}/services/service-local`).set(validService("service-local", ownerUid));
    await adminDbForAccessState.doc(`users/${ownerUid}/services/service-preserved`).set(validService("service-preserved", ownerUid, { planAccessState: "preserved" }));
    await expectFails("owner não marca o próprio serviço como preserved via updateDoc", () =>
      updateDoc(doc(owner.db, "users", ownerUid, "services", "service-local"), { planAccessState: "preserved" }));
    await expectFails("owner não reativa serviço preserved via updateDoc", () =>
      updateDoc(doc(owner.db, "users", ownerUid, "services", "service-preserved"), { planAccessState: "active" }));
    await expectSucceeds("owner ainda edita outros campos de um serviço preserved", () =>
      updateDoc(doc(owner.db, "users", ownerUid, "services", "service-preserved"), { name: "Serviço Preservado Editado" }));

    const ownerClientRef = doc(owner.db, "users", ownerUid, "clients", "client-local");
    await expectSucceeds("owner cria cliente válido", () => setDoc(ownerClientRef, validClient("client-local")));
    await expectFails("outro usuário não altera cliente do owner", () => updateDoc(doc(intruder.db, "users", ownerUid, "clients", "client-local"), { notes: "tentativa indevida" }));

    // LGPD/segurança (REVENDASMART-LGPD-ANPD-REMEDIATION-01, Fase 9): sales só é gravável pelo backend
    // (Admin SDK, /api/sales/finalize) — nenhum caller no cliente grava aqui, então o create client-side
    // foi bloqueado nas Rules em vez de só validar formato sem recalcular total/decrementar estoque.
    // "sale-local" já existe (seedado via Admin SDK em seedBackendOnlyData) para os testes abaixo.
    await expectFails("owner não cria venda diretamente pelo cliente — só o backend grava em sales", () =>
      setDoc(doc(owner.db, "users", ownerUid, "sales", "sale-client-attempt"), validSale("sale-client-attempt", "client-local", "product-local")));
    await expectFails("venda criada pelo backend não pode ser alterada pelo cliente", () => updateDoc(doc(owner.db, "users", ownerUid, "sales", "sale-local"), { total: 1 }));
    await expectFails("owner não apaga venda criada pelo backend", () => deleteDoc(doc(owner.db, "users", ownerUid, "sales", "sale-local")));
    await expectSucceeds("owner lê a própria venda criada pelo backend", () => getDoc(doc(owner.db, "users", ownerUid, "sales", "sale-local")));
    await expectFails("outro usuário não lê venda do owner", () => getDoc(doc(intruder.db, "users", ownerUid, "sales", "sale-local")));

    await expectSucceeds("owner lista próprios produtos", async () => {
      const snapshot = await getDocs(collection(owner.db, "users", ownerUid, "products"));
      // PLAN-IMPL-02A2-FINALIZE — todos os productFixtureIds existem agora (seedados via Admin SDK antes
      // de qualquer tentativa de update, diferente do fluxo antigo onde um create recusado nunca chegava
      // a existir), mais "product-preserved" (seedado adiante, no bloco PLAN-IMPL-02B1 §29/X2). Comparar
      // o SET de ids em vez de só o tamanho torna a asserção auto-descritiva e não silenciosamente
      // desatualizada se um dos dois blocos de fixtures crescer no futuro.
      const expectedIds = new Set([...productFixtureIds, "product-preserved"]);
      const actualIds = new Set(snapshot.docs.map((docSnap) => docSnap.id));
      assert.deepEqual(actualIds, expectedIds);
    });
    await expectFails("outro usuário não consulta coleção de produtos do owner", () => getDocs(collection(intruder.db, "users", ownerUid, "products")));

    await expectSucceeds("owner lê cobrança backend-only", () => getDoc(doc(owner.db, "users", ownerUid, "charges", "charge-local")));
    await expectFails("cliente não cria cobrança backend-only", () => setDoc(doc(owner.db, "users", ownerUid, "charges", "charge-client"), { amount: 10, status: "pending" }));
    await expectFails("outro usuário não lê cobrança do owner", () => getDoc(doc(intruder.db, "users", ownerUid, "charges", "charge-local")));

    await expectSucceeds("owner registra pagamento parcial permitido", () => updateDoc(doc(owner.db, "users", ownerUid, "installments", "installment-local"), { status: "partial", paidAmount: 60 }));
    await expectFails("owner não altera termos da parcela", () => updateDoc(doc(owner.db, "users", ownerUid, "installments", "installment-local"), { amount: 1 }));

    await expectSucceeds("owner lê conexão Mercado Pago backend-only", () => getDoc(doc(owner.db, "users", ownerUid, "mercadopago_connections", "connection-local")));
    await expectFails("cliente não altera conexão Mercado Pago", () => updateDoc(doc(owner.db, "users", ownerUid, "mercadopago_connections", "connection-local"), { status: "revoked" }));
    await expectFails("user_settings segue backend-only", () => getDoc(doc(owner.db, "user_settings", ownerUid)));

    // ===== RELEASE-18: product images/branding/cutout são SERVER_WRITE_ONLY — `server/uploads.ts`
    // valida magic bytes/dimensões/quota reais e grava via Admin SDK (que ignora estas Rules por
    // completo); o client autenticado nunca pode gravar OU apagar direto nesses paths, só ler. O Admin
    // SDK aqui simula exatamente o que o endpoint real faz, para provar que a leitura pública continua
    // funcionando mesmo com o bypass de write fechado.
    const adminBucket = getAdminStorage(adminApp).bucket(`${PROJECT_ID}.appspot.com`);

    const ownerImagePath = `users/${ownerUid}/products/product-local/image.webp`;
    await adminBucket.file(ownerImagePath).save(Buffer.from("fake-webp-content"), { contentType: "image/webp" });
    await expectFails("owner NÃO consegue upload direto de imagem de produto (SERVER_WRITE_ONLY)", () =>
      uploadString(ref(owner.storage, ownerImagePath), "fake-webp-content", "raw", { contentType: "image/webp" }));
    await expectSucceeds("leitura pública de imagem de produto continua permitida", async () => {
      const bytes = await getBytes(ref(anonymous.storage, ownerImagePath));
      assert.ok(bytes.byteLength > 0);
    });
    await expectFails("outro usuário também não escreve no path de imagem do owner", () =>
      uploadString(ref(intruder.storage, `users/${ownerUid}/products/product-local/intruder.webp`), "bad", "raw", { contentType: "image/webp" }));
    await expectFails("SVG continua bloqueado no Storage (write sempre negado, não só o content-type)", () =>
      uploadString(ref(owner.storage, `users/${ownerUid}/products/product-local/bad.svg`), "<svg />", "raw", { contentType: "image/svg+xml" }));
    await expectFails("owner NÃO consegue apagar direto a própria imagem de produto (SERVER_WRITE_ONLY)", () =>
      deleteObject(ref(owner.storage, ownerImagePath)));
    await expectFails("outro usuário não apaga imagem do owner", () => deleteObject(ref(intruder.storage, ownerImagePath)));
    await expectFails("delete de outro usuário no path do owner é bloqueado", () => deleteDoc(doc(intruder.db, "users", ownerUid, "products", "product-local")));

    // ===== RELEASE-18: branding/logo — mesma política SERVER_WRITE_ONLY =====
    const ownerLogoPath = `users/${ownerUid}/branding/store-logo.png`;
    await adminBucket.file(ownerLogoPath).save(Buffer.from("fake-logo-content"), { contentType: "image/png" });
    await expectFails("owner NÃO consegue upload direto de logo/branding (SERVER_WRITE_ONLY)", () =>
      uploadString(ref(owner.storage, ownerLogoPath), "fake-logo-content", "raw", { contentType: "image/png" }));
    await expectSucceeds("leitura pública do logo continua permitida", async () => {
      const bytes = await getBytes(ref(anonymous.storage, ownerLogoPath));
      assert.ok(bytes.byteLength > 0);
    });
    await expectFails("owner NÃO consegue apagar direto o logo (SERVER_WRITE_ONLY)", () => deleteObject(ref(owner.storage, ownerLogoPath)));

    // ===== PRO-07K: Storage do cutout derivado (path canônico, PNG-only) — mesma política =====
    const ownerCutoutPath = `users/${ownerUid}/product-cutouts/product-cutout-ok/cutout-v1.png`;
    await adminBucket.file(ownerCutoutPath).save(Buffer.from("fake-png-content"), { contentType: "image/png" });
    await expectFails("owner NÃO consegue upload direto do cutout aprovado (SERVER_WRITE_ONLY)", () =>
      uploadString(ref(owner.storage, ownerCutoutPath), "fake-png-content", "raw", { contentType: "image/png" }));
    await expectSucceeds("leitura pública do cutout aprovado é permitida", async () => {
      const bytes = await getBytes(ref(anonymous.storage, ownerCutoutPath));
      assert.ok(bytes.byteLength > 0);
    });
    await expectFails("WEBP continua bloqueado no path do cutout derivado (write sempre negado)", () =>
      uploadString(ref(owner.storage, `users/${ownerUid}/product-cutouts/product-cutout-webp/cutout-v1.png`), "fake-webp", "raw", { contentType: "image/webp" }));
    await expectFails("outro usuário não envia cutout no path do owner", () =>
      uploadString(ref(intruder.storage, ownerCutoutPath), "bad", "raw", { contentType: "image/png" }));
    await expectFails("owner NÃO consegue apagar direto o cutout aprovado (SERVER_WRITE_ONLY)", () =>
      deleteObject(ref(owner.storage, ownerCutoutPath)));

    // ===== Encomendas/Pedidos =====
    // Rascunho de pedido: isolado por UID, com campos travados na criação e status que só anda para
    // frente. order.total NÃO é autoridade financeira — as Rules validam formato, não a soma.
    const orderRef = (context: Context, uid: string, id: string) => doc(context.db, "users", uid, "orders", id);

    // --- CREATE ---
    await expectSucceeds("owner cria pedido válido", () => setDoc(orderRef(owner, ownerUid, "order-ok"), validOrder("order-ok")));
    await expectSucceeds("owner cria pedido com snapshots de telefone e loja", () =>
      setDoc(orderRef(owner, ownerUid, "order-snap"), validOrder("order-snap", { clientPhone: "5516999999999", storeName: "Loja Local" })));
    await expectSucceeds("owner cria pedido sem snapshots (compatibilidade com pedidos antigos)", () =>
      setDoc(orderRef(owner, ownerUid, "order-nosnap"), validOrder("order-nosnap")));

    await expectFails("outro usuário não cria pedido no espaço do owner", () =>
      setDoc(orderRef(intruder, ownerUid, "order-intruder"), validOrder("order-intruder")));
    await expectFails("pedido sem items é bloqueado", () => {
      const withoutItems: Record<string, unknown> = validOrder("order-no-items");
      delete withoutItems.items;
      return setDoc(orderRef(owner, ownerUid, "order-no-items"), withoutItems);
    });
    await expectFails("pedido com items vazio é bloqueado", () =>
      setDoc(orderRef(owner, ownerUid, "order-empty-items"), validOrder("order-empty-items", { items: [] })));
    await expectFails("campo extra no pedido é bloqueado", () =>
      setDoc(orderRef(owner, ownerUid, "order-extra"), validOrder("order-extra", { premiumActive: true })));
    await expectFails("pedido não pode nascer com status diferente de new", () =>
      setDoc(orderRef(owner, ownerUid, "order-bad-status"), validOrder("order-bad-status", { status: "delivered" })));
    await expectFails("total negativo é bloqueado", () =>
      setDoc(orderRef(owner, ownerUid, "order-neg-total"), validOrder("order-neg-total", { total: -1 })));
    await expectFails("total acima do limite é bloqueado", () =>
      setDoc(orderRef(owner, ownerUid, "order-huge-total"), validOrder("order-huge-total", { total: 100000001 })));
    await expectFails("createdAt diferente de updatedAt na criação é bloqueado", () =>
      setDoc(orderRef(owner, ownerUid, "order-mismatch"), validOrder("order-mismatch", { updatedAt: laterThanNow })));
    await expectFails("id divergente do documento é bloqueado", () =>
      setDoc(orderRef(owner, ownerUid, "order-id-mismatch"), validOrder("outro-id")));

    // --- READ ---
    await expectSucceeds("owner lê próprio pedido", async () => {
      const snapshot = await getDoc(orderRef(owner, ownerUid, "order-snap"));
      assert.equal(snapshot.exists(), true);
      assert.equal(snapshot.data()?.clientPhone, "5516999999999");
      assert.equal(snapshot.data()?.storeName, "Loja Local");
    });
    await expectFails("outro usuário não lê pedido do owner", () => getDoc(orderRef(intruder, ownerUid, "order-ok")));
    await expectFails("usuário anônimo não lê pedido", () => getDoc(orderRef(anonymous, ownerUid, "order-ok")));

    // --- UPDATES VÁLIDOS (fluxo para frente + cancelamento) ---
    const validTransitions: [string, string][] = [
      ["new", "in_progress"],
      ["in_progress", "ready"],
      ["ready", "delivered"],
      ["new", "cancelled"],
      ["in_progress", "cancelled"],
      ["ready", "cancelled"],
    ];
    for (const [from, to] of validTransitions) {
      const id = `order-ok-${from}-${to}`;
      await seedOrderWithStatus(adminApp, ownerUid, id, from);
      await expectSucceeds(`transição ${from} -> ${to}`, () =>
        updateDoc(orderRef(owner, ownerUid, id), { status: to, updatedAt: laterThanNow }));
    }

    // --- UPDATES INVÁLIDOS (voltar atrás ou sair de estado terminal) ---
    const invalidTransitions: [string, string][] = [
      ["ready", "new"],
      ["delivered", "in_progress"],
      ["cancelled", "new"],
      ["delivered", "cancelled"],
      ["in_progress", "new"],
      ["cancelled", "delivered"],
    ];
    for (const [from, to] of invalidTransitions) {
      const id = `order-bad-${from}-${to}`;
      await seedOrderWithStatus(adminApp, ownerUid, id, from);
      await expectFails(`transição ${from} -> ${to}`, () =>
        updateDoc(orderRef(owner, ownerUid, id), { status: to, updatedAt: laterThanNow }));
    }

    // --- UPDATES INVÁLIDOS: campos que ninguém pode editar depois de criado ---
    await seedOrderWithStatus(adminApp, ownerUid, "order-immutable", "new");
    const immutableAttempts: [string, Record<string, unknown>][] = [
      ["items", { items: [{ productId: "x", name: "Hack", quantity: 1, unitPrice: 1 }], updatedAt: laterThanNow }],
      ["total", { total: 1, updatedAt: laterThanNow }],
      ["clientId", { clientId: "outro-cliente", updatedAt: laterThanNow }],
      ["clientName", { clientName: "Outro Nome", updatedAt: laterThanNow }],
      ["clientPhone", { clientPhone: "5511888888888", updatedAt: laterThanNow }],
      ["storeName", { storeName: "Loja Renomeada", updatedAt: laterThanNow }],
      ["notes", { notes: "alterado", updatedAt: laterThanNow }],
      ["expectedDate", { expectedDate: laterThanNow, updatedAt: laterThanNow }],
      ["createdAt", { createdAt: laterThanNow, updatedAt: laterThanNow }],
    ];
    for (const [field, patch] of immutableAttempts) {
      await expectFails(`alterar ${field} depois de criado`, () =>
        updateDoc(orderRef(owner, ownerUid, "order-immutable"), patch));
    }

    // --- UPDATES INVÁLIDOS: carimbo e status precisam mudar de verdade ---
    await expectFails("status igual ao atual é bloqueado", () =>
      updateDoc(orderRef(owner, ownerUid, "order-immutable"), { status: "new", updatedAt: laterThanNow }));
    await expectFails("updatedAt igual ao atual é bloqueado", () =>
      updateDoc(orderRef(owner, ownerUid, "order-immutable"), { status: "in_progress", updatedAt: now }));
    await expectFails("update sem updatedAt é bloqueado", () =>
      updateDoc(orderRef(owner, ownerUid, "order-immutable"), { status: "in_progress" }));
    await expectFails("outro usuário não altera status de pedido do owner", () =>
      updateDoc(orderRef(intruder, ownerUid, "order-immutable"), { status: "cancelled", updatedAt: laterThanNow }));

    // --- DELETE ---
    // Cancelar é status = 'cancelled'; exclusão física não existe para ninguém, nem para o dono.
    await expectFails("owner não apaga pedido", () => deleteDoc(orderRef(owner, ownerUid, "order-ok")));
    await expectFails("outro usuário não apaga pedido do owner", () => deleteDoc(orderRef(intruder, ownerUid, "order-ok")));

    // ===== Histórico de Anúncios (marketingHistory) =====
    // Antes desta sprint a subcoleção não tinha Rule própria e caía no default-deny da raiz: toda
    // escrita era negada em silêncio (o app guarda no histórico local no catch).
    const historyRef = (context: Context, uid: string, id: string) => doc(context.db, "users", uid, "marketingHistory", id);
    const validHistoryEntry = (overrides: Record<string, unknown> = {}) => ({
      action: "generated",
      productId: "product-local",
      productName: "Perfume Teste Local",
      generatedText: "Confira este produto!",
      template: "promo",
      price: "R$ 120,00",
      headline: "Oferta",
      storeName: "Loja Local",
      primaryColor: "#ec4899",
      createdAtISO: now,
      ...overrides,
    });
    const validProductAssetSnapshot = (overrides: Record<string, unknown> = {}) => ({
      productId: "product-local",
      assetId: "marketing-session:product-local:0123456789abcdef",
      assetRef: "marketing-session-asset:0123456789abcdef",
      sourceUrl: "https://exemplo.test/foto.jpg",
      width: 1200,
      height: 1600,
      mimeType: "image/jpeg",
      ...overrides,
    });

    await expectSucceeds("owner cria entrada de histórico de anúncio", () =>
      setDoc(historyRef(owner, ownerUid, "ad-local-1"), validHistoryEntry()));
    await expectSucceeds("owner lê própria entrada de histórico", async () => {
      const snapshot = await getDoc(historyRef(owner, ownerUid, "ad-local-1"));
      assert.equal(snapshot.exists(), true);
      assert.equal(snapshot.data()?.action, "generated");
    });
    await expectSucceeds("owner edita anúncio salvo preservando a data de criação", () =>
      updateDoc(historyRef(owner, ownerUid, "ad-local-1"), { action: "edited", note: "texto novo", updatedAtISO: laterThanNow }));
    await expectFails("reescrever a data de criação do histórico é bloqueado", () =>
      updateDoc(historyRef(owner, ownerUid, "ad-local-1"), { createdAtISO: laterThanNow }));
    await expectFails("ação desconhecida é bloqueada", () =>
      setDoc(historyRef(owner, ownerUid, "ad-bad-action"), validHistoryEntry({ action: "hackeado" })));
    await expectFails("campo extra no histórico é bloqueado", () =>
      setDoc(historyRef(owner, ownerUid, "ad-extra"), validHistoryEntry({ premiumActive: true })));
    // --- productAssetSnapshot (PRO-07D.1): opcional no legado, fechado e sem bytes inline ---
    await expectSucceeds("histórico legado sem snapshot continua permitido", () =>
      setDoc(historyRef(owner, ownerUid, "ad-snapshot-legacy"), validHistoryEntry()));
    await expectSucceeds("snapshot válido é permitido", () =>
      setDoc(historyRef(owner, ownerUid, "ad-snapshot-valid"), validHistoryEntry({ productAssetSnapshot: validProductAssetSnapshot() })));
    await expectFails("campo extra dentro do snapshot é bloqueado", () =>
      setDoc(historyRef(owner, ownerUid, "ad-snapshot-extra"), validHistoryEntry({ productAssetSnapshot: validProductAssetSnapshot({ safeSrc: "https://exemplo.test/raw" }) })));
    await expectFails("snapshot com productId vazio é bloqueado", () =>
      setDoc(historyRef(owner, ownerUid, "ad-snapshot-product-empty"), validHistoryEntry({ productAssetSnapshot: validProductAssetSnapshot({ productId: "" }) })));
    await expectFails("snapshot com productId divergente é bloqueado", () =>
      setDoc(historyRef(owner, ownerUid, "ad-snapshot-product-other"), validHistoryEntry({ productAssetSnapshot: validProductAssetSnapshot({ productId: "other-product" }) })));
    await expectFails("snapshot com assetId vazio é bloqueado", () =>
      setDoc(historyRef(owner, ownerUid, "ad-snapshot-asset-empty"), validHistoryEntry({ productAssetSnapshot: validProductAssetSnapshot({ assetId: "" }) })));
    await expectFails("snapshot com assetRef vazio é bloqueado", () =>
      setDoc(historyRef(owner, ownerUid, "ad-snapshot-ref-empty"), validHistoryEntry({ productAssetSnapshot: validProductAssetSnapshot({ assetRef: "" }) })));
    await expectFails("snapshot com width zero é bloqueado", () =>
      setDoc(historyRef(owner, ownerUid, "ad-snapshot-width"), validHistoryEntry({ productAssetSnapshot: validProductAssetSnapshot({ width: 0 }) })));
    await expectFails("snapshot com height negativo é bloqueado", () =>
      setDoc(historyRef(owner, ownerUid, "ad-snapshot-height"), validHistoryEntry({ productAssetSnapshot: validProductAssetSnapshot({ height: -1 }) })));
    await expectFails("snapshot com sourceUrl data é bloqueado", () =>
      setDoc(historyRef(owner, ownerUid, "ad-snapshot-source-data"), validHistoryEntry({ productAssetSnapshot: validProductAssetSnapshot({ sourceUrl: "data:image/png;base64,AAAA" }) })));
    await expectFails("snapshot com assetRef data é bloqueado", () =>
      setDoc(historyRef(owner, ownerUid, "ad-snapshot-ref-data"), validHistoryEntry({ productAssetSnapshot: validProductAssetSnapshot({ assetRef: "DATA:image/png;base64,AAAA" }) })));
    await expectFails("snapshot com string excessiva é bloqueado", () =>
      setDoc(historyRef(owner, ownerUid, "ad-snapshot-large"), validHistoryEntry({ productAssetSnapshot: validProductAssetSnapshot({ assetId: "a".repeat(257) }) })));
    await expectSucceeds("update preservando snapshot válido é permitido", () =>
      updateDoc(historyRef(owner, ownerUid, "ad-snapshot-valid"), { action: "edited", updatedAtISO: laterThanNow }));
    await expectFails("update trocando snapshot por shape inválido é bloqueado", () =>
      updateDoc(historyRef(owner, ownerUid, "ad-snapshot-valid"), { productAssetSnapshot: validProductAssetSnapshot({ width: 0 }), updatedAtISO: laterThanNow }));
    await expectFails("entrada sem action é bloqueada", () => {
      const semAction: Record<string, unknown> = validHistoryEntry();
      delete semAction.action;
      return setDoc(historyRef(owner, ownerUid, "ad-sem-action"), semAction);
    });
    await expectFails("outro usuário não cria histórico no espaço do owner", () =>
      setDoc(historyRef(intruder, ownerUid, "ad-intruder"), validHistoryEntry()));
    await expectFails("outro usuário não lê histórico do owner", () => getDoc(historyRef(intruder, ownerUid, "ad-local-1")));
    await expectFails("usuário anônimo não lê histórico", () => getDoc(historyRef(anonymous, ownerUid, "ad-local-1")));
    await expectFails("outro usuário não apaga histórico do owner", () => deleteDoc(historyRef(intruder, ownerUid, "ad-local-1")));
    // --- campo `source` (P1): opcional para o legado, restrito quando presente ---
    await expectSucceeds("histórico com source=manual", () =>
      setDoc(historyRef(owner, ownerUid, "ad-src-manual"), validHistoryEntry({ source: "manual" })));
    await expectSucceeds("histórico com source=catalog", () =>
      setDoc(historyRef(owner, ownerUid, "ad-src-catalog"), validHistoryEntry({ source: "catalog" })));
    // Entrada legada, criada antes do campo existir, continua válida sem ele.
    await expectSucceeds("histórico legado SEM source continua aceito", () =>
      setDoc(historyRef(owner, ownerUid, "ad-src-ausente"), validHistoryEntry()));
    await expectFails("source com valor arbitrário é bloqueado", () =>
      setDoc(historyRef(owner, ownerUid, "ad-src-invalido"), validHistoryEntry({ source: "instagram" })));
    await expectFails("source com tipo errado é bloqueado", () =>
      setDoc(historyRef(owner, ownerUid, "ad-src-tipo"), validHistoryEntry({ source: 42 })));
    await expectSucceeds("update mantendo source válido", () =>
      updateDoc(historyRef(owner, ownerUid, "ad-src-manual"), { action: "edited", source: "catalog", updatedAtISO: laterThanNow }));
    await expectFails("update com source inválido é bloqueado", () =>
      updateDoc(historyRef(owner, ownerUid, "ad-src-manual"), { source: "tiktok", updatedAtISO: laterThanNow }));
    // Entrada legada sem source permanece editável — nenhuma migração é exigida do usuário.
    await expectSucceeds("update de entrada legada sem source", () =>
      updateDoc(historyRef(owner, ownerUid, "ad-src-ausente"), { action: "edited", updatedAtISO: laterThanNow }));

    // Payload REAL de recordAction: todos os campos que sanitizeMarketingHistoryPayload deixa passar.
    // Se a allowlist da Rule estiver incompleta, a escrita real do app falha — é isto que este caso prova.
    await expectSucceeds("payload real completo de recordAction", () =>
      setDoc(historyRef(owner, ownerUid, "ad-payload-real"), {
        action: "shared",
        productId: "product-local",
        productName: "Perfume Teste Local",
        productBrand: "Marca Local",
        productImageUrl: "https://exemplo.test/foto.jpg",
        productVolume: "100ml",
        stockStatus: "Pronta entrega",
        imageUrl: "https://exemplo.test/thumb.jpg",
        photoUrl: "https://exemplo.test/photo.jpg",
        image: "https://exemplo.test/image.jpg",
        imageId: "img-local-1",
        generatedText: "Confira este produto!",
        template: "promo",
        templateId: "promo",
        themeId: "brand",
        price: "R$ 120,00",
        priceText: "R$ 120,00",
        headline: "Oferta especial",
        note: "Últimas unidades",
        ctaText: "Chamar no WhatsApp",
        storeName: "Loja Local",
        storeLogoUrl: "https://exemplo.test/logo.png",
        primaryColor: "#ec4899",
        showBrand: true,
        showVolume: true,
        showStockStatus: true,
        showWhatsAppCta: true,
        backgroundStyle: "soft-gradient",
        catalogUrl: "https://exemplo.test/u/minha-loja",
        source: "manual",
        productAssetSnapshot: validProductAssetSnapshot(),
        createdAtISO: now,
      }));

    // Apagar o próprio registro É permitido: a UI tem "remover" e "limpar histórico".
    await expectSucceeds("owner apaga própria entrada de histórico", () => deleteDoc(historyRef(owner, ownerUid, "ad-local-1")));

    // ===== ADS-PRO-03: histórico do Anúncios Pro (mode="pro" + proBackground/proCutout) =====
    // Mesma coleção/Rule do histórico clássico (ONE_MARKETING_HISTORY_SYSTEM) — só campos adicionais,
    // todos opcionais, validados por isValidProBackground/isValidProCutout.
    const validProHistoryEntry = (overrides: Record<string, unknown> = {}) => ({
      action: "generated",
      mode: "pro",
      productId: "product-pro-local",
      productName: "Perfume Pro Local",
      generatedText: "",
      template: "pro-ad",
      price: "R$ 189,90",
      headline: "Perfume Pro Local",
      storeName: "Loja Local",
      primaryColor: "#6d5dfc",
      composerVersion: 1,
      creativeFamily: "luxury",
      creativeConceptId: "concept-luxury-1",
      format: "square",
      proBackground: { sourceType: "GENERATED_DETERMINISTIC", backgroundId: "luxury-onyx-spotlight", backgroundVersion: 1, backgroundFamily: "luxury" },
      proCutout: { cutoutAssetId: "product-cutout-approved:product-pro-local:sha256:abc123", storagePath: "users/owner-local/product-cutouts/product-pro-local/cutout-v1.png", sourceAssetId: "asset-original-1" },
      createdAtISO: now,
      ...overrides,
    });

    await expectSucceeds("owner cria entrada de histórico Pro válida", () =>
      setDoc(historyRef(owner, ownerUid, "ad-pro-1"), validProHistoryEntry()));
    await expectSucceeds("owner lê própria entrada Pro", async () => {
      const snapshot = await getDoc(historyRef(owner, ownerUid, "ad-pro-1"));
      assert.equal(snapshot.exists(), true);
      assert.equal(snapshot.data()?.mode, "pro");
      assert.equal((snapshot.data()?.proBackground as Record<string, unknown> | undefined)?.backgroundVersion, 1);
    });
    // H2: histórico clássico (sem nenhum campo Pro) continua válido lado a lado.
    await expectSucceeds("histórico clássico sem campos Pro continua válido", () =>
      setDoc(historyRef(owner, ownerUid, "ad-classic-alongside-pro"), validHistoryEntry()));

    await expectFails("mode com valor arbitrário é bloqueado", () =>
      setDoc(historyRef(owner, ownerUid, "ad-pro-bad-mode"), validProHistoryEntry({ mode: "premium" })));
    await expectFails("composerVersion zero é bloqueado", () =>
      setDoc(historyRef(owner, ownerUid, "ad-pro-bad-version"), validProHistoryEntry({ composerVersion: 0 })));
    await expectFails("composerVersion não-inteiro é bloqueado", () =>
      setDoc(historyRef(owner, ownerUid, "ad-pro-bad-version-float"), validProHistoryEntry({ composerVersion: 1.5 })));
    await expectFails("format inválido é bloqueado", () =>
      setDoc(historyRef(owner, ownerUid, "ad-pro-bad-format"), validProHistoryEntry({ format: "landscape" })));

    // --- proBackground ---
    await expectFails("proBackground com sourceType inválido é bloqueado", () =>
      setDoc(historyRef(owner, ownerUid, "ad-pro-bg-bad-source"), validProHistoryEntry({ proBackground: { sourceType: "MADE_UP" } })));
    await expectFails("proBackground com campo extra é bloqueado", () =>
      setDoc(historyRef(owner, ownerUid, "ad-pro-bg-extra"), validProHistoryEntry({ proBackground: { sourceType: "GENERATED_DETERMINISTIC", backgroundId: "x", hackedField: true } })));
    await expectFails("proBackground com backgroundVersion negativo é bloqueado", () =>
      setDoc(historyRef(owner, ownerUid, "ad-pro-bg-neg-version"), validProHistoryEntry({ proBackground: { sourceType: "GENERATED_DETERMINISTIC", backgroundId: "x", backgroundVersion: -1, backgroundFamily: "luxury" } })));
    // H20 (variante): sourceType "ai" — só generationId é reproduzível hoje, nada mais é exigido.
    await expectSucceeds("proBackground sourceType AI_GENERATED com só generationId é permitido", () =>
      setDoc(historyRef(owner, ownerUid, "ad-pro-bg-ai"), validProHistoryEntry({ proBackground: { sourceType: "AI_GENERATED", generationId: "gen-abc123" } })));

    // --- proCutout ---
    await expectFails("proCutout sem storagePath é bloqueado", () => {
      const bad = validProHistoryEntry() as Record<string, unknown>;
      const cutout = { ...(bad.proCutout as Record<string, unknown>) };
      delete cutout.storagePath;
      return setDoc(historyRef(owner, ownerUid, "ad-pro-cutout-missing"), { ...bad, proCutout: cutout });
    });
    await expectFails("proCutout com storagePath inline (data:) é bloqueado", () =>
      setDoc(historyRef(owner, ownerUid, "ad-pro-cutout-data"), validProHistoryEntry({ proCutout: { cutoutAssetId: "x", storagePath: "data:image/png;base64,AAAA" } })));
    await expectFails("proCutout com campo extra é bloqueado", () =>
      setDoc(historyRef(owner, ownerUid, "ad-pro-cutout-extra"), validProHistoryEntry({ proCutout: { cutoutAssetId: "x", storagePath: "users/owner-local/product-cutouts/p/cutout-v1.png", hackedField: true } })));
    await expectSucceeds("proCutout sem sourceAssetId (opcional) é permitido", () => {
      const entry = validProHistoryEntry() as Record<string, unknown>;
      const cutout = { ...(entry.proCutout as Record<string, unknown>) };
      delete cutout.sourceAssetId;
      return setDoc(historyRef(owner, ownerUid, "ad-pro-cutout-no-source"), { ...entry, proCutout: cutout });
    });

    // --- H19/H20/H21: isolamento por tenant, mesmo padrão do histórico clássico ---
    await expectFails("outro usuário não lê histórico Pro do owner", () => getDoc(historyRef(intruder, ownerUid, "ad-pro-1")));
    await expectFails("outro usuário não cria histórico Pro no espaço do owner", () =>
      setDoc(historyRef(intruder, ownerUid, "ad-pro-intruder"), validProHistoryEntry()));
    await expectFails("outro usuário não altera histórico Pro do owner", () =>
      updateDoc(historyRef(intruder, ownerUid, "ad-pro-1"), { note: "hackeado", updatedAtISO: laterThanNow }));
    await expectFails("usuário anônimo não lê histórico Pro", () => getDoc(historyRef(anonymous, ownerUid, "ad-pro-1")));

    await expectSucceeds("owner apaga própria entrada de histórico Pro", () => deleteDoc(historyRef(owner, ownerUid, "ad-pro-1")));

    // RELEASE-CHECKOUT-02 §1/§9-A/§9-B — idempotência atômica do pedido do catálogo público, contra o
    // emulador REAL (não mocada): duas reservas concorrentes com o MESMO clientOrderId só podem
    // produzir UM vencedor (Firestore optimistic concurrency control na transaction), nunca dois
    // pedidos. Usa o Admin SDK apontado para o emulador — o mesmo módulo que a rota real chama.
    {
      const adminDb = getAdminFirestore(adminApp!);
      const concurrentClientOrderId = `concurrent-${Date.now()}`;

      const [first, second] = await Promise.all([
        reserveOrderCreation(adminDb, ownerUid, concurrentClientOrderId),
        reserveOrderCreation(adminDb, ownerUid, concurrentClientOrderId),
      ]);
      const winners = [first, second].filter((result) => !result.alreadyExisted);
      const losers = [first, second].filter((result) => result.alreadyExisted);
      assert.equal(winners.length, 1, "A: exatamente UMA das duas tentativas simultâneas com o mesmo clientOrderId deve vencer a reserva");
      assert.equal(losers.length, 1, "A: a outra tentativa precisa ver a reserva já existente, nunca criar uma segunda");
      assert.equal(losers[0].status, "pending", "A: a perdedora vê status pending (a vencedora ainda não terminou de gravar o pedido)");
      assert.equal(winners[0].orderId, losers[0].orderId, "A: as duas tentativas concorrentes precisam apontar para o MESMO orderId — nunca dois pedidos diferentes");

      // B: replay do mesmo clientOrderId depois que o pedido já foi finalizado ("ready") devolve o
      // MESMO orderId — nunca cria um segundo.
      await finalizeOrderReservation(adminDb, ownerUid, concurrentClientOrderId, winners[0].orderId);
      const replay = await reserveOrderCreation(adminDb, ownerUid, concurrentClientOrderId);
      assert.equal(replay.alreadyExisted, true, "B: replay do clientOrderId já finalizado precisa ver a reserva existente");
      assert.equal(replay.status, "ready", "B: reserva finalizada fica com status ready");
      assert.equal(replay.orderId, winners[0].orderId, "B: replay devolve o MESMO orderId do pedido original");

      // C: double-click que falha (ex.: item ficou indisponível) libera a reserva — um novo clientOrderId
      // (o app sempre gera um novo por tentativa) não fica bloqueado por uma reserva de uma tentativa
      // anterior que nunca terminou.
      const abandonedClientOrderId = `abandoned-${Date.now()}`;
      const abandoned = await reserveOrderCreation(adminDb, ownerUid, abandonedClientOrderId);
      assert.equal(abandoned.alreadyExisted, false, "C: primeira reserva de um clientOrderId novo sempre vence");
      await releaseOrderReservation(adminDb, ownerUid, abandonedClientOrderId);
      const retryAfterRelease = await reserveOrderCreation(adminDb, ownerUid, abandonedClientOrderId);
      assert.equal(retryAfterRelease.alreadyExisted, false, "C: depois de liberar a reserva de uma tentativa abandonada, uma nova tentativa com o mesmo id reserva normalmente");

      console.log("Order idempotency tests passed: concurrent reservation (A), replay (B), abandoned-reservation release (C).");
    }

    // RELEASE-CHECKOUT-03 §11-F — idempotência atômica da COBRANÇA de cartão por pedido, mesmo padrão
    // acima, contra o emulador real: duas tentativas concorrentes de pagar o MESMO orderId só podem
    // produzir UMA cobrança.
    {
      const adminDb = getAdminFirestore(adminApp!);
      const chargeOrderId = `order-for-charge-${Date.now()}`;

      const [first, second] = await Promise.all([
        reserveOrderCharge(adminDb, ownerUid, chargeOrderId),
        reserveOrderCharge(adminDb, ownerUid, chargeOrderId),
      ]);
      const chargeWinners = [first, second].filter((result) => !result.alreadyExisted);
      const chargeLosers = [first, second].filter((result) => result.alreadyExisted);
      assert.equal(chargeWinners.length, 1, "F: exatamente UMA das duas tentativas simultâneas de pagar o mesmo pedido deve vencer a reserva de cobrança");
      assert.equal(chargeLosers.length, 1, "F: a outra tentativa precisa ver a reserva já existente, nunca criar uma segunda cobrança");
      assert.equal(chargeWinners[0].chargeId, chargeLosers[0].chargeId, "F: as duas tentativas concorrentes precisam apontar para o MESMO chargeId — nunca duas cobranças para o mesmo pedido");

      await finalizeOrderChargeReservation(adminDb, ownerUid, chargeOrderId, chargeWinners[0].chargeId);
      const chargeReplay = await reserveOrderCharge(adminDb, ownerUid, chargeOrderId);
      assert.equal(chargeReplay.alreadyExisted, true, "F: replay de pagamento do mesmo pedido já finalizado precisa ver a reserva existente");
      assert.equal(chargeReplay.chargeId, chargeWinners[0].chargeId, "F: replay devolve o MESMO chargeId da cobrança original");

      // J: falha do provider (simulada aqui como "nunca chegou a finalizar") libera a reserva — o
      // pedido pode ser tentado de novo sem ficar travado para sempre em "pending".
      const failedChargeOrderId = `order-charge-failed-${Date.now()}`;
      const failedAttempt = await reserveOrderCharge(adminDb, ownerUid, failedChargeOrderId);
      assert.equal(failedAttempt.alreadyExisted, false, "J: primeira tentativa de cobrança de um pedido novo sempre vence");
      await releaseOrderChargeReservation(adminDb, ownerUid, failedChargeOrderId);
      const retryAfterProviderFailure = await reserveOrderCharge(adminDb, ownerUid, failedChargeOrderId);
      assert.equal(retryAfterProviderFailure.alreadyExisted, false, "J: depois de uma falha do provider liberar a reserva, o mesmo pedido pode tentar pagar de novo");

      console.log("Order charge idempotency tests passed: concurrent reservation + replay (F), provider-failure release (J).");
    }

    // RELEASE-QUALITY-05 §12 — segurança de estoque/venda concorrente, contra o emulador REAL (não
    // mocada), chamando a MESMA função que a rota `/api/sales/finalize` chama (extraída em
    // `sale-finalize-transaction.ts` só para ser testável sem subir o Express inteiro).
    {
      const adminDb = getAdminFirestore(adminApp!);
      const baseSale = (saleId: string, productId: string, quantity: number) => ({
        uid: ownerUid,
        saleId,
        clientId: "client-local",
        products: [{ productId, quantity }],
        paymentType: "avista" as const,
        discountType: "fixed" as const,
        discountValue: 0,
        downPayment: 0,
        installmentCount: 0,
        paymentMethod: "dinheiro",
        downPaymentMethod: null,
      });

      // A: estoque 10, duas vendas concorrentes (-2 e -3) => 5, nunca 8/7/10 nem um valor sobrescrito.
      const stockRaceProductRef = adminDb.doc(`users/${ownerUid}/products/stock-race-product`);
      await stockRaceProductRef.set({ id: "stock-race-product", name: "Produto Corrida de Estoque", salePrice: 50, stock: 10 });
      const raceSaleIdA = `race-sale-a-${Date.now()}`;
      const raceSaleIdB = `race-sale-b-${Date.now()}`;
      await Promise.all([
        finalizeSaleTransaction(adminDb, baseSale(raceSaleIdA, "stock-race-product", 2)),
        finalizeSaleTransaction(adminDb, baseSale(raceSaleIdB, "stock-race-product", 3)),
      ]);
      const stockAfterRace = (await stockRaceProductRef.get()).data()?.stock;
      assert.equal(stockAfterRace, 5, "A: 10 - 2 - 3 precisa dar exatamente 5, nunca 8/7/10 nem outro valor de uma escrita perdida");

      // B/E: reenviar o MESMO saleId (retry, reconnect, restart do app, double-click) precisa lançar
      // SALE_ALREADY_EXISTS e NUNCA decrementar estoque de novo.
      await assert.rejects(
        () => finalizeSaleTransaction(adminDb, baseSale(raceSaleIdA, "stock-race-product", 2)),
        /SALE_ALREADY_EXISTS/,
        "B/E: replay do mesmo saleId precisa ser rejeitado, nunca criar uma segunda venda",
      );
      const stockAfterReplay = (await stockRaceProductRef.get()).data()?.stock;
      assert.equal(stockAfterReplay, 5, "B/E: replay do mesmo saleId não pode decrementar estoque uma segunda vez");

      // C: estoque 2, duas vendas concorrentes de 2 cada => uma vence, a outra recusa por
      // INSUFFICIENT_STOCK — nunca deixa stock negativo, nunca decide "no escuro" da outra.
      const scarceProductRef = adminDb.doc(`users/${ownerUid}/products/stock-scarce-product`);
      await scarceProductRef.set({ id: "stock-scarce-product", name: "Produto Estoque Escasso", salePrice: 30, stock: 2 });
      const scarceSaleIdA = `scarce-sale-a-${Date.now()}`;
      const scarceSaleIdB = `scarce-sale-b-${Date.now()}`;
      const scarceResults = await Promise.allSettled([
        finalizeSaleTransaction(adminDb, baseSale(scarceSaleIdA, "stock-scarce-product", 2)),
        finalizeSaleTransaction(adminDb, baseSale(scarceSaleIdB, "stock-scarce-product", 2)),
      ]);
      const scarceFulfilled = scarceResults.filter((r) => r.status === "fulfilled");
      const scarceRejected = scarceResults.filter((r) => r.status === "rejected");
      assert.equal(scarceFulfilled.length, 1, "C: com estoque para só uma das duas vendas de 2, exatamente uma precisa ter sucesso");
      assert.equal(scarceRejected.length, 1, "C: a outra precisa ser recusada, nunca as duas aceitas");
      assert.match((scarceRejected[0] as PromiseRejectedResult).reason.message, /INSUFFICIENT_STOCK/, "C: a recusa precisa ser especificamente por falta de estoque, não um erro genérico");
      const stockAfterScarce = (await scarceProductRef.get()).data()?.stock;
      assert.equal(stockAfterScarce, 0, "C: estoque final precisa ser exatamente 0, nunca negativo");

      // D: sincronização de venda offline após reconectar é, do ponto de vista do servidor, a MESMA
      // chamada de sempre — reafirma que uma venda nova (saleId nunca visto) continua sendo aceita
      // normalmente depois dos cenários de conflito acima (a fila offline não fica "travada" por eles).
      const offlineSyncProductRef = adminDb.doc(`users/${ownerUid}/products/stock-offline-sync-product`);
      await offlineSyncProductRef.set({ id: "stock-offline-sync-product", name: "Produto Sync Offline", salePrice: 40, stock: 5 });
      const offlineSaleId = `offline-sale-${Date.now()}`;
      const offlineResult = await finalizeSaleTransaction(adminDb, baseSale(offlineSaleId, "stock-offline-sync-product", 1));
      assert.equal(offlineResult.saleId, offlineSaleId, "D: venda sincronizada após reconectar precisa ser aceita normalmente");
      const saleDocAfterSync = await adminDb.doc(`users/${ownerUid}/sales/${offlineSaleId}`).get();
      assert.equal(saleDocAfterSync.exists, true, "D: a venda sincronizada precisa existir de fato em `sales`, não só retornar sucesso");

      // F: tenant isolation — a venda do owner nunca decide/altera o estoque do MESMO productId sob a
      // conta de outro usuário (intruder), mesmo id de documento, paths completamente separados por uid.
      const intruderProductRef = adminDb.doc(`users/${intruderUid}/products/stock-race-product`);
      await intruderProductRef.set({ id: "stock-race-product", name: "Produto Igual, Outro Dono", salePrice: 999, stock: 42 });
      const intruderClientRef = adminDb.doc(`users/${intruderUid}/clients/client-local`);
      await intruderClientRef.set({ id: "client-local", name: "Cliente Intruder", phone: "5511900000000" });
      await finalizeSaleTransaction(adminDb, { ...baseSale(`intruder-isolation-${Date.now()}`, "stock-race-product", 1), uid: ownerUid });
      const intruderStockAfter = (await intruderProductRef.get()).data()?.stock;
      assert.equal(intruderStockAfter, 42, "F: uma venda na conta do owner nunca pode tocar o estoque de outro uid, mesmo com o mesmo productId");

      console.log("Sale/stock concurrency tests passed: concurrent decrement (A), replay never double-decrements (B/E), insufficient-stock conflict (C), offline-sync acceptance (D), tenant isolation (F).");
    }

    console.log("Firebase emulator integration tests passed: auth, firestore rules, storage rules (server-write-only bypass closed) and tenant isolation.");
  } finally {
    await Promise.allSettled([deleteApp(owner.app), deleteApp(intruder.app), deleteApp(anonymous.app)]);
    if (adminApp) await deleteAdminApp(adminApp);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
