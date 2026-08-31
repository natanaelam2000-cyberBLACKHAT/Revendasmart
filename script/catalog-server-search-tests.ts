import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import express from "express";
import { FieldPath } from "firebase-admin/firestore";
import { initializeFirebaseAdmin, getFirebaseAdmin } from "../server/firebase-admin-init";
import { registerCatalogSearchRoutes } from "../server/catalog-search";
import { buildProductCreatePayload } from "../client/src/lib/product-payload";
import {
  MAX_PRODUCT_SEARCH_TOKENS,
  buildProductSearchBackfillPatch,
  buildProductSearchFields,
  buildProductServerSearchPlan,
  canUseCatalogServerSearch,
  normalizeProductBarcode,
  normalizeProductSearchText,
} from "../client/src/lib/product-search";

const PROJECT_ID = "demo-revendasmart";

function requireLocalEmulators() {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  assert.notEqual(process.env.GOOGLE_CLOUD_PROJECT, "revenda-smart");
  process.env.FIREBASE_PROJECT_ID = PROJECT_ID;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function productDoc(input: {
  id: string;
  name: string;
  brand?: string;
  category?: string;
  barcode?: string;
  productType?: string;
  stock?: number;
}) {
  return {
    id: input.id,
    name: input.name,
    brand: input.brand ?? "",
    origin: "Nacional",
    category: input.category ?? "",
    costPrice: 100,
    salePrice: 200,
    stock: input.stock ?? 1,
    barcode: input.barcode ?? "",
    description: `${input.name} descrição`,
    imageUrl: "",
    storagePath: "",
    extras: {},
    isFeatured: false,
    isOnSale: false,
    discountPercent: 0,
    productType: input.productType ?? "Cosméticos",
    gender: "unisex",
    ...buildProductSearchFields(input),
  };
}

async function seedProducts() {
  initializeFirebaseAdmin();
  const db = getFirebaseAdmin().firestore();
  const batch = db.batch();
  const tenantA = "tenant-search-a";
  const tenantB = "tenant-search-b";

  const docsA = [
    productDoc({ id: "a-malbec-gold", name: "Malbec Gold", brand: "O Boticário", category: "Perfumes", barcode: "7891230000011" }),
    productDoc({ id: "a-carolina-212", name: "212 VIP Rosé", brand: "Carolina Herrera", category: "Perfumes", barcode: "7891230000012" }),
    productDoc({ id: "a-creme", name: "Creme Corporal", brand: "Nativa SPA", category: "Cuidados", barcode: "7891230000013" }),
    productDoc({ id: "a-perfume-extra", name: "Perfume Floral", brand: "Marca A", category: "Perfumes", barcode: "7891230000014" }),
  ];
  for (let index = 0; index < 35; index += 1) {
    docsA.push(productDoc({
      id: `a-list-${index.toString().padStart(2, "0")}`,
      name: `Produto Lista ${index.toString().padStart(2, "0")}`,
      brand: "Marca Lista",
      category: index % 2 === 0 ? "Perfumes" : "Cuidados",
      barcode: `77999123${index.toString().padStart(4, "0")}`,
      stock: (index % 5) + 1,
    }));
  }
  const legacyA = {
    id: "a-legacy",
    name: "Legacy sem índice",
    brand: "Marca Legacy",
    origin: "Nacional",
    category: "Perfumes",
    costPrice: 50,
    salePrice: 90,
    stock: 3,
    barcode: "7891230099999",
    description: "Legado",
    imageUrl: "",
    storagePath: "",
    extras: {},
    isFeatured: false,
    isOnSale: false,
    discountPercent: 0,
    productType: "Cosméticos",
    gender: "unisex",
  };
  const docsB = [
    productDoc({ id: "b-malbec-gold", name: "Malbec Gold", brand: "Outra Marca", category: "Perfumes", barcode: "7891230000011" }),
    productDoc({ id: "b-carolina-212", name: "212 VIP Men", brand: "Carolina Herrera", category: "Perfumes", barcode: "7891230000099" }),
  ];

  for (const doc of docsA) {
    batch.set(db.doc(`users/${tenantA}/products/${doc.id}`), doc);
  }
  batch.set(db.doc(`users/${tenantA}/products/${legacyA.id}`), legacyA);
  for (const doc of docsB) {
    batch.set(db.doc(`users/${tenantB}/products/${doc.id}`), doc);
  }
  await batch.commit();

  return { tenantA, tenantB, db };
}

async function run() {
  requireLocalEmulators();
  const { tenantA, tenantB, db } = await seedProducts();

  const app = express();
  app.use(express.json());
  registerCatalogSearchRoutes(app, (req, res, next) => {
    const uid = req.header("x-test-uid");
    if (!uid) return res.status(401).json({ code: "UNAUTHENTICATED" });
    (req as typeof req & { firebaseUid?: string }).firebaseUid = uid;
    next();
  });
  const server = createServer(app);
  const baseUrl = await listen(server);

  const search = async (uid: string | null, params: Record<string, string> = {}) => {
    const url = new URL("/api/catalog/products", baseUrl);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await fetch(url, { headers: uid ? { "x-test-uid": uid } : {} });
    const body = await response.json().catch(() => ({}));
    return { response, body };
  };

  try {
    assert.equal(normalizeProductSearchText("Malbec Gold"), "malbec gold");
    assert.equal(normalizeProductSearchText("Loja São João"), "loja sao joao");
    assert.equal(normalizeProductBarcode(" 789-123  "), "789123");
    assert.ok(canUseCatalogServerSearch("ab"));
    assert.equal(buildProductServerSearchPlan({ term: "m", serverSearchEnabled: true }).kind, "term_too_short");
    assert.equal(buildProductServerSearchPlan({ term: "mal", serverSearchEnabled: true }).kind, "name_prefix");
    assert.equal(buildProductServerSearchPlan({ term: "malbec", serverSearchEnabled: true }).kind, "token");
    assert.equal(buildProductServerSearchPlan({ term: "carolina herrera", serverSearchEnabled: true }).kind, "token");
    const fields = buildProductSearchFields({
      name: "Perfume Águas de Verão",
      brand: "Natura",
      category: "Perfumes",
      barcode: "0012345678905",
      productType: "Cosméticos",
    });
    assert.ok(fields.searchTokens.length <= MAX_PRODUCT_SEARCH_TOKENS);
    assert.ok(fields.searchTokens.includes("perfume"));
    assert.ok(fields.searchTokens.includes("natura"));
    assert.equal(buildProductSearchBackfillPatch({
      name: "Legacy sem índice",
      brand: "Marca Legacy",
      category: "Perfumes",
      barcode: "7891230099999",
      productType: "Cosméticos",
    })?.nameNormalized, "legacy sem indice");
    const payload = buildProductCreatePayload({
      formData: {
        name: "Malbec Gold",
        brand: "O Boticário",
        origin: "Nacional",
        category: "Perfumes",
        costPrice: 10,
        salePrice: 20,
        stock: 1,
        barcode: "001234",
        description: "desc",
        imageUrl: "",
        storagePath: "",
        extras: {},
        isFeatured: false,
        isOnSale: false,
        discountPercent: 0,
        productType: "Cosméticos",
        gender: "unisex",
      },
      productName: "Malbec Gold",
      normalizedBrand: "O Boticário",
      category: "Perfumes",
      costPrice: 10,
      salePrice: 20,
      stock: 1,
      imageUrl: "",
      storagePath: "",
      activeNicho: "Cosméticos",
    });
    assert.equal(payload.nameNormalized, "malbec gold");
    assert.equal(payload.categoryNormalized, "perfumes");
    assert.equal(payload.barcodeNormalized, "001234");

    const unauthenticated = await search(null);
    assert.equal(unauthenticated.response.status, 401);

    const list = await search(tenantA);
    assert.equal(list.response.status, 200);
    assert.equal(list.body.limit, 30);
    assert.equal(list.body.items.length, 30);
    assert.equal(list.body.hasMore, true);
    assert.ok(typeof list.body.nextCursor === "string" && list.body.nextCursor.length > 0);
    assert.ok(list.body.items.some((product: any) => product.id === "a-legacy"), "legacy precisa continuar listável sem índice");

    const limited = await search(tenantA, { limit: "99999" });
    assert.equal(limited.response.status, 200);
    assert.equal(limited.body.limit, 50);
    assert.ok(limited.body.items.length <= 50);

    const page2 = await search(tenantA, { cursor: list.body.nextCursor, limit: "30" });
    assert.equal(page2.response.status, 200);
    assert.ok(page2.body.items.length > 0);
    assert.equal(page2.body.items.some((product: any) => list.body.items.some((seen: any) => seen.id === product.id)), false);

    const byName = await search(tenantA, { q: "mal" });
    assert.equal(byName.response.status, 200);
    assert.ok(byName.body.items.some((product: any) => product.id === "a-malbec-gold"));
    assert.equal(byName.body.items.some((product: any) => product.id === "b-malbec-gold"), false);

    const byToken = await search(tenantA, { q: "carolina" });
    assert.equal(byToken.response.status, 200);
    assert.deepEqual(byToken.body.items.map((product: any) => product.id), ["a-carolina-212"]);

    const byBarcode = await search(tenantA, { q: "7891230000011" });
    assert.equal(byBarcode.response.status, 200);
    assert.deepEqual(byBarcode.body.items.map((product: any) => product.id), ["a-malbec-gold"]);

    const byCategory = await search(tenantA, { category: "Perfumes" });
    assert.equal(byCategory.response.status, 200);
    assert.ok(byCategory.body.items.every((product: any) => product.category === "Perfumes"));

    const byQueryAndCategory = await search(tenantA, { q: "malbec", category: "Perfumes" });
    assert.equal(byQueryAndCategory.response.status, 200);
    assert.deepEqual(byQueryAndCategory.body.items.map((product: any) => product.id), ["a-malbec-gold"]);

    const noResults = await search(tenantA, { q: "inexistente-total" });
    assert.equal(noResults.response.status, 200);
    assert.deepEqual(noResults.body.items, []);
    assert.equal(noResults.body.hasMore, false);

    const tenantBIsolation = await search(tenantB, { q: "7891230000011" });
    assert.equal(tenantBIsolation.response.status, 200);
    assert.deepEqual(tenantBIsolation.body.items.map((product: any) => product.id), ["b-malbec-gold"]);

    const sameNameIsolation = await search(tenantA, { q: "malbec" });
    assert.equal(sameNameIsolation.body.items.every((product: any) => String(product.id).startsWith("a-")), true);

    const documentIds = (await db.collection("users").doc(tenantA).collection("products").orderBy(FieldPath.documentId()).get()).docs.map((doc) => doc.id);
    assert.ok(documentIds.includes("a-legacy"));

    console.log("Catalog server search tests passed.");
  } finally {
    await close(server);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
