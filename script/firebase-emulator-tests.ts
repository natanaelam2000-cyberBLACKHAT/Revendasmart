import assert from "node:assert/strict";
import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, type Auth } from "firebase/auth";
import { collection, connectFirestoreEmulator, deleteDoc, doc, getDoc, getDocs, getFirestore, setDoc, updateDoc, type Firestore } from "firebase/firestore";
import { connectStorageEmulator, deleteObject, getBytes, getStorage, ref, uploadString, type FirebaseStorage } from "firebase/storage";
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp, type App as AdminApp } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";

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
    await expectSucceeds("owner cria produto válido", () => setDoc(ownerProductRef, validProduct("product-local")));
    await expectSucceeds("owner lê próprio produto", async () => {
      const snapshot = await getDoc(ownerProductRef);
      assert.equal(snapshot.exists(), true);
      assert.equal(snapshot.data()?.nameNormalized, "perfume teste local");
    });
    await expectFails("outro usuário não lê produto do owner", () => getDoc(doc(intruder.db, "users", ownerUid, "products", "product-local")));
    await expectFails("usuário anônimo não lê produto privado", () => getDoc(doc(anonymous.db, "users", ownerUid, "products", "product-local")));
    await expectFails("mass assignment de produto é bloqueado", () => setDoc(doc(owner.db, "users", ownerUid, "products", "product-invalid"), { ...validProduct("product-invalid"), premiumActive: true }));

    const ownerClientRef = doc(owner.db, "users", ownerUid, "clients", "client-local");
    await expectSucceeds("owner cria cliente válido", () => setDoc(ownerClientRef, validClient("client-local")));
    await expectFails("outro usuário não altera cliente do owner", () => updateDoc(doc(intruder.db, "users", ownerUid, "clients", "client-local"), { notes: "tentativa indevida" }));

    await expectSucceeds("owner cria venda válida", () => setDoc(doc(owner.db, "users", ownerUid, "sales", "sale-local"), validSale("sale-local", "client-local", "product-local")));
    await expectFails("venda criada não pode ser alterada pelo cliente", () => updateDoc(doc(owner.db, "users", ownerUid, "sales", "sale-local"), { total: 1 }));
    await expectFails("outro usuário não lê venda do owner", () => getDoc(doc(intruder.db, "users", ownerUid, "sales", "sale-local")));

    await expectSucceeds("owner lista próprios produtos", async () => {
      const snapshot = await getDocs(collection(owner.db, "users", ownerUid, "products"));
      assert.equal(snapshot.size, 1);
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

    const ownerImageRef = ref(owner.storage, `users/${ownerUid}/products/product-local/image.webp`);
    await expectSucceeds("owner faz upload de imagem permitida", () => uploadString(ownerImageRef, "fake-webp-content", "raw", { contentType: "image/webp" }));
    await expectSucceeds("leitura pública de imagem permitida", async () => {
      const bytes = await getBytes(ref(anonymous.storage, `users/${ownerUid}/products/product-local/image.webp`));
      assert.ok(bytes.byteLength > 0);
    });
    await expectFails("outro usuário não envia imagem no path do owner", () => uploadString(ref(intruder.storage, `users/${ownerUid}/products/product-local/intruder.webp`), "bad", "raw", { contentType: "image/webp" }));
    await expectFails("SVG é bloqueado no Storage", () => uploadString(ref(owner.storage, `users/${ownerUid}/products/product-local/bad.svg`), "<svg />", "raw", { contentType: "image/svg+xml" }));
    await expectSucceeds("owner remove própria imagem", () => deleteObject(ownerImageRef));
    await expectFails("delete de outro usuário no path do owner é bloqueado", () => deleteDoc(doc(intruder.db, "users", ownerUid, "products", "product-local")));

    console.log("Firebase emulator integration tests passed: auth, firestore rules, storage rules and tenant isolation.");
  } finally {
    await Promise.allSettled([deleteApp(owner.app), deleteApp(intruder.app), deleteApp(anonymous.app)]);
    if (adminApp) await deleteAdminApp(adminApp);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
