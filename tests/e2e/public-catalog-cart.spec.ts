/**
 * RELEASE-32 — validação real (mobile viewport, 375×812) do carrinho/WhatsApp do Catálogo Público
 * contra a aplicação REAL (server/index.ts + client Vite) apontada para o Firestore Emulator — mesmo
 * harness de tests/e2e/marketing-pro.spec.ts (orquestrado por scripts/e2e/run-account-deletion-e2e.mjs
 * via E2E_SPEC). O catálogo público não exige autenticação, então os produtos/settings são semeados
 * direto no Firestore via Admin SDK (mesmo padrão de seedPremiumPlan em marketing-pro.spec.ts) — a
 * página é usada só para o comportamento sob teste (adicionar ao carrinho, revalidar, enviar).
 */
import { expect, test, type Page } from "@playwright/test";

const emulatorMode = process.env.E2E_EMULATOR === "1";

async function admin() {
  process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
  const { initializeFirebaseAdmin, getFirebaseAdmin } = await import("../../server/firebase-admin-init");
  initializeFirebaseAdmin();
  return getFirebaseAdmin();
}

function uniqueSlug(label: string): string {
  return `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type SeedProduct = {
  id: string;
  name: string;
  salePrice: number;
  promotionalPrice?: number;
  stock: number;
};

async function seedStore(
  slug: string,
  storeSettings: { showPrice?: boolean; allowWhatsappOrders?: boolean; whatsappNumber?: string },
  products: SeedProduct[],
): Promise<{ uid: string }> {
  const admin_ = await admin();
  const db = admin_.firestore();
  const uid = `e2e-store-${slug}`;

  await db.collection("public_catalog_slugs").doc(slug).set({ ownerUid: uid });
  await db.collection("user_settings").doc(uid).set({
    storeName: `Loja ${slug}`,
    catalogSlug: slug,
    showPrice: storeSettings.showPrice ?? true,
    allowWhatsappOrders: storeSettings.allowWhatsappOrders ?? true,
    ...(storeSettings.whatsappNumber ? { whatsappNumber: storeSettings.whatsappNumber } : {}),
  });
  await Promise.all(products.map((product) => db.doc(`users/${uid}/products/${product.id}`).set({
    name: product.name,
    salePrice: product.salePrice,
    ...(product.promotionalPrice !== undefined ? { promotionalPrice: product.promotionalPrice } : {}),
    stock: product.stock,
    category: "Geral",
  })));

  return { uid };
}

async function updateProductStock(uid: string, productId: string, stock: number): Promise<void> {
  const admin_ = await admin();
  await admin_.firestore().doc(`users/${uid}/products/${productId}`).set({ stock }, { merge: true });
}

/** Substitui window.open por um coletor determinístico — nunca navega de verdade para wa.me no teste. */
async function captureWindowOpen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __openedUrls: string[] }).__openedUrls = [];
    window.open = (url?: string | URL) => {
      (window as unknown as { __openedUrls: string[] }).__openedUrls.push(String(url ?? ""));
      return null;
    };
  });
}

async function getOpenedUrls(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __openedUrls?: string[] }).__openedUrls ?? []);
}

test.describe("RELEASE-32 — Catálogo Público: carrinho/WhatsApp (mobile)", () => {
  test.skip(!emulatorMode, "Requer o ambiente emulado: E2E_SPEC=tests/e2e/public-catalog-cart.spec.ts node scripts/e2e/run-account-deletion-e2e.mjs");
  test.use({ viewport: { width: 375, height: 812 } });

  test("carrinho vazio, promoção com mesmo preço em vitrine/carrinho/WhatsApp, encoding seguro", async ({ page }) => {
    const slug = uniqueSlug("promo");
    const { uid } = await seedStore(
      slug,
      { showPrice: true, allowWhatsappOrders: true, whatsappNumber: "11987654321" },
      [{ id: "promo-item", name: "Perfume Ção Ñ", salePrice: 100, promotionalPrice: 70, stock: 5 }],
    );
    await captureWindowOpen(page);
    await page.goto(`/u/${slug}`);
    await expect(page.getByText("Perfume Ção Ñ")).toBeVisible({ timeout: 20_000 });

    // Vitrine: mostra o preço promocional (70), nunca o regular (100) como preço principal.
    await expect(page.getByText("R$ 70,00").first()).toBeVisible();

    await page.getByLabel("Adicionar Perfume Ção Ñ ao carrinho").click();
    await page.getByTestId("button-open-cart").click();
    await expect(page.getByTestId("drawer-cart")).toBeVisible();

    // P0: carrinho usa o MESMO preço promocional da vitrine, não o salePrice regular.
    await expect(page.getByTestId("text-cart-unit-price-promo-item")).toContainText("R$ 70,00");
    await expect(page.getByTestId("text-cart-subtotal-promo-item")).toContainText("R$ 70,00");
    await expect(page.getByTestId("text-cart-total")).toContainText("R$ 70,00");

    await page.getByTestId("button-send-order-whatsapp").click();
    await expect.poll(async () => (await getOpenedUrls(page)).length, { timeout: 15_000 }).toBeGreaterThan(0);
    const [openedUrl] = await getOpenedUrls(page);
    expect(openedUrl).toMatch(/^https:\/\/wa\.me\/5511987654321\?text=/);
    const decodedMessage = decodeURIComponent(openedUrl.split("?text=")[1]);
    // `toLocaleString("pt-BR", ...)` usa espaço não separável (U+00A0) entre "R$" e o valor — \s cobre
    // NBSP em regex JS, então comparar por regex evita falso negativo por causa só do tipo de espaço.
    expect(decodedMessage).toMatch(/R\$\s*70,00/);
    expect(decodedMessage).not.toMatch(/R\$\s*100,00/);
    expect(decodedMessage).not.toMatch(/costPrice/i);
    expect(decodedMessage).not.toContain(uid);

    // Envio bem-sucedido fecha o drawer (mas não esvazia o carrinho) — reabre para testar o estado vazio.
    await page.getByTestId("button-open-cart").click();
    await expect(page.getByTestId("drawer-cart")).toBeVisible();
    await page.getByTestId("cart-item-promo-item").getByText("Remover").click();
    await expect(page.getByTestId("text-cart-empty")).toBeVisible();
  });

  test("showPrice=false: preço nunca aparece em vitrine/carrinho/WhatsApp", async ({ page }) => {
    const slug = uniqueSlug("noprice2");
    await seedStore(
      slug,
      { showPrice: false, allowWhatsappOrders: true, whatsappNumber: "11987654321" },
      [{ id: "hidden-price-item", name: "Produto Sem Preço Visível", salePrice: 90, stock: 3 }],
    );
    await captureWindowOpen(page);
    await page.goto(`/u/${slug}`);
    await expect(page.getByText("Produto Sem Preço Visível")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/R\$\s*90,00/)).toHaveCount(0);

    await page.getByLabel("Adicionar Produto Sem Preço Visível ao carrinho").click();
    await page.getByTestId("button-open-cart").click();
    await expect(page.getByTestId("drawer-cart")).toBeVisible();
    await expect(page.getByTestId("text-cart-unit-price-hidden-price-item")).toHaveCount(0);
    await expect(page.getByTestId("text-cart-subtotal-hidden-price-item")).toHaveCount(0);
    await expect(page.getByTestId("text-cart-total")).toHaveCount(0);

    await page.getByTestId("button-send-order-whatsapp").click();
    await expect.poll(async () => (await getOpenedUrls(page)).length, { timeout: 15_000 }).toBeGreaterThan(0);
    const [openedUrl] = await getOpenedUrls(page);
    const decodedMessage = decodeURIComponent(openedUrl.split("?text=")[1]);
    expect(decodedMessage).not.toMatch(/R\$/);
    expect(decodedMessage).toContain("Produto Sem Preço Visível");
  });

  test("allowWhatsappOrders=false: CTA de envio nunca abre o WhatsApp", async ({ page }) => {
    const slug = uniqueSlug("noorders");
    await seedStore(
      slug,
      { showPrice: true, allowWhatsappOrders: false, whatsappNumber: "11987654321" },
      [{ id: "any-item", name: "Produto Qualquer", salePrice: 40, stock: 3 }],
    );
    await captureWindowOpen(page);
    await page.goto(`/u/${slug}`);
    await expect(page.getByText("Produto Qualquer")).toBeVisible({ timeout: 20_000 });

    await page.getByLabel("Adicionar Produto Qualquer ao carrinho").click();
    await page.getByTestId("button-open-cart").click();
    await expect(page.getByTestId("drawer-cart")).toBeVisible();

    await expect(page.getByTestId("button-send-order-whatsapp")).toHaveCount(0);
    await expect(page.getByTestId("text-whatsapp-orders-disabled")).toBeVisible();
    expect(await getOpenedUrls(page)).toHaveLength(0);
  });

  test("item stale (estoque caiu entre adicionar e enviar): não abre WhatsApp, avisa e ajusta a quantidade", async ({ page }) => {
    const slug = uniqueSlug("stale");
    const { uid } = await seedStore(
      slug,
      { showPrice: true, allowWhatsappOrders: true, whatsappNumber: "11987654321" },
      [{ id: "stale-item", name: "Produto Instável", salePrice: 60, stock: 5 }],
    );
    await captureWindowOpen(page);
    await page.goto(`/u/${slug}`);
    await expect(page.getByText("Produto Instável")).toBeVisible({ timeout: 20_000 });

    // Adiciona 3 ao carrinho enquanto o estoque real ainda é 5. O primeiro clique usa o botão "+"
    // inicial; depois do primeiro item o tile troca para o stepper (ver CatalogProductTile.tsx), então
    // os incrementos seguintes usam o rótulo "Aumentar quantidade".
    await page.getByLabel("Adicionar Produto Instável ao carrinho").click();
    const increaseButton = page.getByLabel("Aumentar quantidade de Produto Instável");
    await increaseButton.click();
    await increaseButton.click();
    await page.getByTestId("button-open-cart").click();
    await expect(page.getByTestId("drawer-cart")).toBeVisible();
    await expect(page.getByTestId("cart-item-stale-item")).toContainText("3");

    // O vendedor reduz o estoque para 1 DEPOIS que o item já está no carrinho — snapshot ficou stale.
    await updateProductStock(uid, "stale-item", 1);

    await page.getByTestId("button-send-order-whatsapp").click();
    await expect(page.getByTestId("text-cart-order-notice")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("text-cart-order-notice")).toContainText(/atualizados/);
    // Nunca abre o WhatsApp em silêncio quando o carrinho ficou stale.
    expect(await getOpenedUrls(page)).toHaveLength(0);
    // Quantidade é ajustada ao estoque atual (1), não removida silenciosamente do carrinho.
    await expect(page.getByTestId("cart-item-stale-item")).toContainText("1");
  });
});
