/**
 * ADS-PRO-FINAL — prova de runtime do estúdio contra o app real (API de produção + Vite + emuladores).
 *
 * Fluxo percorrido de verdade num celular 360×740 (e conferido num desktop): produto → foto → melhorar foto →
 * remover fundo (opcional, local) → estilo/objetivo → 3+ opções → comparar → trocar fundo → editar → salvar
 * (idempotente) → baixar PNG (dimensões reais) → compartilhar (nativo simulado + fallback honesto) → reabrir.
 * Nenhuma chamada paga: o teste falha se qualquer endpoint de geração/PhotoRoom for tocado.
 *
 * Rodar: npm run test:e2e:ads-pro-final   (sobe os emuladores e o app sozinho)
 * Provas visuais: .tmp/ads-pro-final-proof/ (fora do Git).
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { decodePng, generateProductOnPlainBackgroundPng, regionLuminanceStdDev } from "./support/png";

const emulatorMode = process.env.E2E_EMULATOR === "1";
const PASSWORD = "LocalTestPassword!123";
const ADMIN_EMAIL = "natanaelam2000@gmail.com";
const proofDir = join(process.cwd(), ".tmp", "ads-pro-final-proof");
mkdirSync(proofDir, { recursive: true });

const PRODUCT_NAME = "Perfume Luna Intense ADS-PRO-FINAL";
const NO_PHOTO_PRODUCT_NAME = "Produto Sem Foto ADS-PRO-FINAL";
const MOBILE = { width: 360, height: 740 } as const;
const DESKTOP = { width: 1280, height: 900 } as const;

async function preparePage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const removeOverlays = () => {
      for (const overlay of Array.from(document.querySelectorAll("vite-error-overlay"))) overlay.remove();
    };
    const observe = () => {
      removeOverlays();
      new MutationObserver(removeOverlays).observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.documentElement) observe();
    else document.addEventListener("DOMContentLoaded", observe, { once: true });
  });
}

async function routeStorageEmulatorDownloads(page: Page): Promise<void> {
  await page.route("https://firebasestorage.googleapis.com/v0/b/**", async (route) => {
    const original = new URL(route.request().url());
    const local = `http://127.0.0.1:9199${original.pathname}${original.search}`;
    try {
      const response = await route.fetch({ url: local });
      await route.fulfill({ response });
    } catch {
      await route.continue();
    }
  });
}

async function signUpAdmin(page: Page): Promise<string> {
  await page.goto("/signup");
  await page.getByPlaceholder("Ex: Maria Cosméticos").fill("Loja ADS-PRO-FINAL");
  await page.getByPlaceholder("seu@email.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Mínimo 6 caracteres").fill(PASSWORD);
  await page.getByRole("button", { name: /criar minha conta/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("/signup"), { timeout: 30_000 });
  await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("rs:session")), { timeout: 20_000 }).toBeTruthy();
  return (await page.evaluate(() => window.localStorage.getItem("rs:session") || "")) as string;
}

async function seedPremiumPlan(uid: string): Promise<void> {
  process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
  const { initializeFirebaseAdmin, getFirebaseAdmin } = await import("../../server/firebase-admin-init");
  initializeFirebaseAdmin();
  const admin = getFirebaseAdmin();
  await admin.firestore().collection("users").doc(uid).collection("planData").doc("main").set(
    { currentPlan: "premium", premiumActive: true, premiumSource: "manual", premiumExpiresAt: null },
    { merge: true },
  );
}

async function readHistory(uid: string): Promise<Array<Record<string, unknown> & { id: string }>> {
  process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
  const { initializeFirebaseAdmin, getFirebaseAdmin } = await import("../../server/firebase-admin-init");
  initializeFirebaseAdmin();
  const snapshot = await getFirebaseAdmin().firestore().collection("users").doc(uid).collection("marketingHistory").get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }));
}

async function createProduct(page: Page, options: { name: string; price: string; stock: string; image?: Buffer; discountPercent?: string }): Promise<void> {
  await page.goto("/add-product");
  await page.getByTestId("input-product-name").fill(options.name);
  await page.getByTestId("input-category").selectOption({ index: 1 });
  await page.getByTestId("input-cost-price").fill("100");
  await page.getByTestId("input-sale-price").fill(options.price);
  await page.getByTestId("input-stock").fill(options.stock);
  if (options.discountPercent) {
    await page.getByTestId("toggle-on-sale").check();
    await page.getByTestId("input-discount-percent").fill(options.discountPercent);
  }
  if (options.image) {
    await page.locator("#gallery-upload").setInputFiles({ name: "produto-ads-pro-final.png", mimeType: "image/png", buffer: options.image });
    await expect(page.getByAltText("Prévia do produto")).toBeVisible({ timeout: 20_000 });
  }
  await page.getByTestId("button-save-product").click();
  await page.waitForURL(/\/products/, { timeout: 20_000 });
  await expect(page.getByText(options.name)).toBeVisible({ timeout: 20_000 });
}

async function openStudio(page: Page): Promise<void> {
  await page.goto("/marketing");
  await page.reload();
  await page.getByTestId("tab-marketing-pro").click();
  await expect(page.getByTestId("marketing-pro-panel")).toHaveAttribute("data-pro-ads-state", "entitled", { timeout: 20_000 });
  // Premium sem Perfil Criativo (fluxo antigo) abre o onboarding sozinho — comportamento já existente do produto.
  const onboardingSkip = page.getByTestId("button-creative-profile-skip");
  if (await onboardingSkip.waitFor({ state: "visible", timeout: 8_000 }).then(() => true).catch(() => false)) {
    await onboardingSkip.click();
    await expect(page.getByTestId("creative-profile-onboarding")).toBeHidden({ timeout: 10_000 });
  }
  await expect(page.getByTestId("ads-pro-studio")).toBeVisible({ timeout: 30_000 });
}

async function waitForRender(page: Page): Promise<void> {
  const canvas = page.getByTestId("studio-canvas");
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await expect(canvas).toHaveAttribute("data-render-width", /\d+/, { timeout: 20_000 });
}

async function canvasAttr(page: Page, name: string): Promise<string> {
  return (await page.getByTestId("studio-canvas").getAttribute(name)) ?? "";
}

async function pngOfDownload(page: Page, trigger: () => Promise<void>, name: string) {
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await trigger();
  const download = await downloadPromise;
  const path = join(proofDir, name);
  await download.saveAs(path);
  return { path, png: decodePng(readFileSync(path)), suggested: download.suggestedFilename() };
}

/** Pixels "vivos": um PNG exportado não pode ser um canvas vazio/uniforme. */
function distinctColorRatio(png: ReturnType<typeof decodePng>): number {
  const seen = new Set<number>();
  const step = Math.max(1, Math.floor((png.width * png.height) / 20000));
  for (let i = 0; i < png.width * png.height; i += step) {
    const o = i * 4;
    seen.add(((png.pixels[o] >> 3) << 10) | ((png.pixels[o + 1] >> 3) << 5) | (png.pixels[o + 2] >> 3));
  }
  return seen.size;
}

test.describe("ADS-PRO-FINAL — estúdio de anúncios (runtime)", () => {
  test.skip(!emulatorMode, "Requer o ambiente emulado: npm run test:e2e:ads-pro-final");

  test("F1-F21: produto → foto → recorte → estilo → opções → fundo → edição → salvar → exportar → compartilhar → reabrir (celular + desktop, sem chamada paga)", async ({ page }) => {
    test.setTimeout(300_000);
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const apiCalls: string[] = [];
    const isKnownFirebaseBootNoise = (message: string) =>
      /analytics\/config-fetch-failed|installations\/request-failed|API key not valid|Failed to load resource: the server responded with a status of 400/i.test(message)
      || /event:\s*unhandled_rejection|"event":\s*"unhandled_rejection"/.test(message);
    const isKnownProductsPageNestedAnchorWarning = (message: string) => /<a>/.test(message) && /cannot be a descendant of|cannot contain a nested/i.test(message);
    const isKnownUnrelatedNoise = (message: string) => isKnownFirebaseBootNoise(message) || isKnownProductsPageNestedAnchorWarning(message);
    page.on("console", (message) => {
      if (message.type() === "error" && !isKnownUnrelatedNoise(message.text())) consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => {
      if (!isKnownUnrelatedNoise(error.message)) pageErrors.push(error.message);
    });
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/")) apiCalls.push(`${request.method()} ${url.pathname}`);
    });

    await page.setViewportSize(MOBILE);
    await preparePage(page);
    await routeStorageEmulatorDownloads(page);
    const uid = await signUpAdmin(page);
    await seedPremiumPlan(uid);
    await createProduct(page, {
      name: PRODUCT_NAME,
      price: "299.90",
      stock: "3",
      discountPercent: "20",
      image: generateProductOnPlainBackgroundPng(900, 0.16, [240, 240, 235]),
    });
    await createProduct(page, { name: NO_PHOTO_PRODUCT_NAME, price: "49.90", stock: "10" });
    await seedPremiumPlan(uid);
    // Daqui para frente NENHUMA chamada de geração/PhotoRoom pode acontecer.
    apiCalls.length = 0;

    await openStudio(page);
    await page.getByTestId("studio-product-select").selectOption({ label: PRODUCT_NAME });
    await expect(page.getByTestId("ads-pro-studio")).toHaveAttribute("data-photo-status", "ready", { timeout: 30_000 });
    await waitForRender(page);

    // ---- F1: três opções realmente diferentes, já na abertura --------------------------------
    await page.getByTestId("studio-tab-options").click();
    const variationButtons = page.locator('[data-testid^="studio-variation-"]:not([data-testid^="studio-variation-canvas-"])');
    await expect(variationButtons).toHaveCount(3);
    const signatures = await variationButtons.evaluateAll((nodes) => nodes.map((node) => `${node.getAttribute("data-variation-style")}|${node.getAttribute("data-variation-archetype")}|${node.getAttribute("data-variation-background")}`));
    expect(new Set(signatures).size, `as 3 opções precisam diferir (${signatures.join(" / ")})`).toBe(3);
    for (const id of ["A", "B", "C"]) await expect(page.getByTestId(`studio-variation-canvas-${id}`)).toHaveAttribute("data-render-width", /\d+/, { timeout: 15_000 });
    await page.screenshot({ path: join(proofDir, "01-mobile-options.png"), fullPage: false });

    // ---- F2: melhorar foto (local) + comparar com a original -------------------------------
    await page.getByTestId("studio-tab-photo").click();
    await page.getByTestId("studio-photo-enhance").click();
    await expect(page.getByTestId("studio-photo-enhance-message")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("studio-photo-compare-original").click();
    await expect(page.getByTestId("studio-showing-original")).toBeVisible();
    await page.getByTestId("studio-photo-compare-original").click();
    await expect(page.getByTestId("studio-showing-original")).toBeHidden();
    await page.screenshot({ path: join(proofDir, "02-mobile-photo.png") });

    // ---- F3: remover fundo (opcional, local) -----------------------------------------------
    await page.getByTestId("studio-photo-mode-cutout").click();
    await expect.poll(async () => page.getByTestId("studio-photo-mode-cutout").getAttribute("aria-pressed"), { timeout: 30_000 }).toBe("true");
    await page.screenshot({ path: join(proofDir, "03-mobile-cutout.png") });
    await page.getByTestId("studio-photo-mode-original").click();
    await expect(page.getByTestId("studio-photo-mode-original")).toHaveAttribute("aria-pressed", "true");

    // ---- F4a: o QUIZ de estilo (perfil) muda de verdade as opções geradas ---------------------------------
    await page.getByTestId("studio-tab-style").click();
    await expect(page.getByTestId("studio-step-style")).toBeVisible();
    await expect(page.getByTestId("studio-style-summary")).toHaveAttribute("data-style-origin", "category-default");
    const defaultStyle = (await page.getByTestId("studio-style-summary").getAttribute("data-resolved-style")) ?? "";
    // Escolhe o caminho do quiz que leva a um estilo DIFERENTE do sugerido pela categoria (prova que o perfil manda).
    const profileStyle = defaultStyle === "editorial" ? "modern" : "editorial";
    const quizPath = profileStyle === "editorial"
      ? ["comp_editorial", "light_clean_balanced", "atmo_curated", "density_structured", "expr_editorial"]
      : ["comp_dynamic", "light_crisp_vibrant", "atmo_contemporary", "density_focused", "expr_progressive"];
    await page.getByTestId("button-ads-pro-define-style").click();
    await expect(page.getByTestId("ads-pro-style-quiz-dialog")).toBeVisible({ timeout: 15_000 });
    for (const optionId of quizPath) {
      await page.getByTestId(`button-ads-pro-quiz-option-${optionId}`).click();
      await page.getByTestId("button-ads-pro-quiz-next").click();
    }
    await page.getByTestId("button-ads-pro-quiz-save").click();
    await expect(page.getByTestId("ads-pro-style-quiz-dialog")).toBeHidden({ timeout: 20_000 });
    await expect(page.getByTestId("studio-style-summary")).toHaveAttribute("data-style-origin", "profile", { timeout: 20_000 });
    await expect(page.getByTestId("studio-style-summary")).toHaveAttribute("data-resolved-style", profileStyle);
    await expect.poll(() => canvasAttr(page, "data-style"), { message: "o anúncio em edição passou a usar o estilo do perfil" }).toBe(profileStyle);
    await page.getByTestId("studio-tab-options").click();
    await expect(page.getByTestId("studio-variation-A")).toHaveAttribute("data-variation-style", profileStyle);
    await page.screenshot({ path: join(proofDir, "03b-mobile-profile-options.png") });
    await page.getByTestId("studio-tab-style").click();

    // ---- F4: estilo e objetivo mudam o anúncio ---------------------------------------------
    await page.getByTestId("studio-style-luxury").click();
    await expect(page.getByTestId("studio-style-summary")).toHaveAttribute("data-resolved-style", "luxury");
    await expect.poll(() => canvasAttr(page, "data-style")).toBe("luxury");
    const luxuryArchetype = await canvasAttr(page, "data-archetype");
    await page.getByTestId("studio-style-modern").click();
    await expect.poll(() => canvasAttr(page, "data-style")).toBe("modern");
    await page.getByTestId("studio-intent-promo").click();
    await page.screenshot({ path: join(proofDir, "04-mobile-style.png") });
    expect(luxuryArchetype.length).toBeGreaterThan(0);

    // ---- F5: comparar (diálogo) e escolher a opção C -----------------------------------------
    await page.getByTestId("studio-tab-options").click();
    await page.getByTestId("studio-compare-open").click();
    await expect(page.getByTestId("studio-compare-dialog")).toBeVisible();
    await expect(page.getByTestId("studio-compare-canvas-C")).toHaveAttribute("data-render-width", /\d+/, { timeout: 15_000 });
    await page.screenshot({ path: join(proofDir, "05-mobile-compare.png") });
    await page.getByTestId("studio-compare-use-C").click();
    await expect(page.getByTestId("studio-compare-dialog")).toBeHidden();
    await expect(page.getByTestId("ads-pro-studio")).toHaveAttribute("data-variation-id", "C");
    // "Outras opções" é grátis e gira as escolhas sem tocar em quota
    await page.getByTestId("studio-more-options").click();
    await expect(variationButtons).toHaveCount(3);

    // ---- F6: trocar o fundo (grátis, instantâneo) --------------------------------------------
    await page.getByTestId("studio-tab-background").click();
    const backgroundButtons = page.locator('[data-testid^="studio-background-"]');
    await expect(backgroundButtons.first()).toBeVisible();
    const before = await canvasAttr(page, "data-background-id");
    const target = backgroundButtons.filter({ hasNot: page.locator(`[data-background-id="${before}"]`) });
    const targetId = await backgroundButtons.evaluateAll((nodes, current) => nodes.map((n) => n.getAttribute("data-background-id")).find((id) => id && id !== current) ?? "", before);
    expect(targetId).not.toBe("");
    await page.locator(`[data-testid="studio-background-${targetId}"]`).click();
    await expect.poll(() => canvasAttr(page, "data-background-id")).toBe(targetId);
    expect(await target.count()).toBeGreaterThan(0);
    await page.screenshot({ path: join(proofDir, "06-mobile-background.png") });

    // ---- F7: editar textos; preço nunca é inventado nem editável ---------------------------------
    await page.getByTestId("studio-tab-edit").click();
    await page.getByTestId("studio-text-headline").fill("Luna Intense — edição limitada");
    await expect(page.getByTestId("studio-price-readonly")).toContainText("R$");
    await expect(page.getByTestId("studio-price-readonly")).not.toContainText("299,90 299,90");
    await page.getByTestId("studio-archetype-hero-center").click();
    await page.getByTestId("studio-undo").click();
    await waitForRender(page);
    await page.screenshot({ path: join(proofDir, "07-mobile-edit.png") });
    await page.getByTestId("studio-text-headline").fill("Luna Intense — edição limitada");

    // ---- F8: layout do celular: sem rolagem horizontal, alvos de toque >= 44px, prévia visível ----
    const layout = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      tabHeights: Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="studio-tab-"]')).map((el) => Math.round(el.getBoundingClientRect().height)),
      frameHeight: Math.round(document.querySelector<HTMLElement>('[data-testid="studio-preview-frame"]')?.getBoundingClientRect().height ?? -1),
      innerHeight: window.innerHeight,
    }));
    expect(layout.scrollWidth, "sem rolagem horizontal no celular").toBeLessThanOrEqual(layout.innerWidth);
    for (const height of layout.tabHeights) expect(height).toBeGreaterThanOrEqual(44);
    expect(layout.tabHeights).toHaveLength(6);
    expect(layout.frameHeight, "o bloco fixo (prévia + abas) deixa área útil para os controles").toBeLessThanOrEqual(layout.innerHeight * 0.45);
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(250);
    const stuck = await page.evaluate(() => Math.round(document.querySelector<HTMLElement>('[data-testid="studio-preview-frame"]')?.getBoundingClientRect().top ?? -1));
    expect(stuck, "a prévia fica visível (fixa) enquanto os controles rolam").toBeGreaterThanOrEqual(0);
    expect(stuck).toBeLessThan(200);
    await page.evaluate(() => window.scrollTo(0, 0));

    // ---- F8b: celular pequeno (320×568): sem rolagem lateral, 6 abas ainda tocáveis, prévia fixa --------------------
    await page.setViewportSize({ width: 320, height: 568 });
    await page.waitForTimeout(300);
    const small = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      tabWidths: Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="studio-tab-"]')).map((el) => Math.round(el.getBoundingClientRect().width)),
    }));
    expect(small.scrollWidth, "320px: sem rolagem horizontal").toBeLessThanOrEqual(small.innerWidth);
    for (const width of small.tabWidths) expect(width, "320px: abas largas o bastante para o toque").toBeGreaterThanOrEqual(40);
    await page.screenshot({ path: join(proofDir, "07b-mobile-320.png") });
    await page.setViewportSize(MOBILE);
    await page.waitForTimeout(200);

    // ---- F9: salvar é idempotente (duas vezes = UM registro) --------------------------------------
    await page.getByTestId("studio-tab-save").click();
    await expect(page.getByTestId("studio-export-summary")).toContainText("1080×1350");
    await page.getByTestId("studio-save").click();
    await expect(page.getByTestId("studio-feedback-save")).toContainText(/Anúncio salvo|Imagem salva|histórico/i, { timeout: 30_000 });
    await expect(page.getByTestId("studio-save-state")).toHaveAttribute("data-unsaved", "false");
    await page.getByTestId("studio-save").click();
    await expect(page.getByTestId("studio-feedback-save")).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await readHistory(uid)).filter((entry) => entry.mode === "pro").length, { timeout: 15_000 }).toBe(1);
    const history = (await readHistory(uid)).filter((entry) => entry.mode === "pro");
    expect(history[0].proDocument, "o documento editável foi guardado (reabrir e continuar)").toBeTruthy();
    expect(String(history[0].imageUrl)).toMatch(/^https?:\/\//);
    expect((history[0].proBackground as { backgroundId?: string }).backgroundId).toBe(targetId);
    await page.screenshot({ path: join(proofDir, "08-mobile-saved.png") });

    // ---- F10: exportar PNG 4:5 e 1:1 com as dimensões reais ----------------------------------------
    const portrait = await pngOfDownload(page, () => page.getByTestId("studio-download").click(), "export-portrait-1080x1350.png");
    expect(portrait.png.width).toBe(1080);
    expect(portrait.png.height).toBe(1350);
    expect(distinctColorRatio(portrait.png), "o PNG exportado tem conteúdo (não é vazio)").toBeGreaterThan(60);
    expect(regionLuminanceStdDev(portrait.png, 0, 0, portrait.png.width, portrait.png.height), "o PNG exportado não é uniforme").toBeGreaterThan(8);
    await expect(page.getByTestId("studio-feedback-download")).toBeVisible();

    await page.getByTestId("studio-tab-style").click();
    await page.getByTestId("studio-format-square").click();
    await expect.poll(() => canvasAttr(page, "data-format")).toBe("square");
    await page.getByTestId("studio-tab-save").click();
    await expect(page.getByTestId("studio-export-summary")).toContainText("1080×1080");
    const square = await pngOfDownload(page, () => page.getByTestId("studio-download").click(), "export-square-1080x1080.png");
    expect(square.png.width).toBe(1080);
    expect(square.png.height).toBe(1080);

    // ---- F11: compartilhar — fallback honesto (navegador sem Web Share de arquivos) ----------------
    await page.getByTestId("studio-share").click();
    await expect(page.getByTestId("studio-feedback-share")).toContainText(/Baixamos o PNG|Compartilhamento aberto/i, { timeout: 30_000 });

    // ---- F12: compartilhar — Web Share com arquivo (simulado) -------------------------------------
    await page.evaluate(() => {
      const shared: Array<{ title?: string; text?: string; files: Array<{ name: string; type: string; size: number }> }> = [];
      (window as unknown as { __shared: typeof shared }).__shared = shared;
      Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data: { title?: string; text?: string; files?: File[] }) => {
          shared.push({ title: data.title, text: data.text, files: (data.files ?? []).map((file) => ({ name: file.name, type: file.type, size: file.size })) });
        },
      });
    });
    await page.getByTestId("studio-share").click();
    await expect(page.getByTestId("studio-feedback-share")).toContainText("Compartilhamento aberto", { timeout: 30_000 });
    const shared = await page.evaluate(() => (window as unknown as { __shared: Array<{ files: Array<{ type: string; size: number }> }> }).__shared);
    expect(shared).toHaveLength(1);
    expect(shared[0].files[0].type).toBe("image/png");
    expect(shared[0].files[0].size).toBeGreaterThan(5_000);

    // ---- F13: cancelar o seletor NÃO é erro ---------------------------------------------------------
    await page.evaluate(() => {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async () => { throw new DOMException("cancelado", "AbortError"); },
      });
    });
    await page.getByTestId("studio-share").click();
    await expect(page.getByTestId("studio-feedback-share")).toContainText("cancelado", { timeout: 15_000 });

    // ---- F14: reabrir o projeto salvo (recarrega a página) -----------------------------------------
    await page.reload();
    await page.getByTestId("tab-marketing-pro").click();
    await expect(page.getByTestId("ads-pro-studio")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("studio-tab-save").click();
    const reopen = page.locator('[data-testid^="studio-open-project-"]').first();
    await expect(reopen).toBeVisible({ timeout: 30_000 });
    await reopen.click();
    await expect(page.getByTestId("ads-pro-studio")).toHaveAttribute("data-variation-id", "saved", { timeout: 20_000 });
    await expect(page.getByTestId("studio-tab-edit")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("studio-text-headline")).toHaveValue("Luna Intense — edição limitada");
    await waitForRender(page);
    await expect.poll(() => canvasAttr(page, "data-background-id")).toBe(targetId);
    await page.screenshot({ path: join(proofDir, "09-mobile-reopened.png") });

    // ---- F15: desktop: duas colunas, prévia ao lado dos controles ------------------------------------
    await page.setViewportSize(DESKTOP);
    await page.waitForTimeout(400);
    const desktop = await page.evaluate(() => {
      const frame = document.querySelector<HTMLElement>('[data-testid="studio-preview-frame"]')?.getBoundingClientRect();
      const panels = document.querySelector<HTMLElement>('[data-testid="studio-panels"]')?.getBoundingClientRect();
      return { frameRight: Math.round(frame?.right ?? 0), panelsLeft: Math.round(panels?.left ?? 0), scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth };
    });
    expect(desktop.panelsLeft, "no desktop os controles ficam À DIREITA da prévia").toBeGreaterThanOrEqual(desktop.frameRight - 4);
    expect(desktop.scrollWidth).toBeLessThanOrEqual(desktop.innerWidth);
    await page.screenshot({ path: join(proofDir, "10-desktop-studio.png") });
    await page.getByTestId("studio-tab-options").click();
    await page.screenshot({ path: join(proofDir, "11-desktop-options.png") });

    // ---- F21: produto SEM foto — o estúdio avisa, bloqueia a exportação e não quebra ---------------------
    await page.setViewportSize(MOBILE);
    await page.getByTestId("studio-tab-photo").click();
    await page.getByTestId("studio-product-select").selectOption({ label: NO_PHOTO_PRODUCT_NAME });
    await expect(page.getByTestId("ads-pro-studio")).toHaveAttribute("data-photo-status", "no-image", { timeout: 30_000 });
    await expect(page.getByTestId("studio-photo-missing")).toBeVisible();
    await waitForRender(page);
    await page.getByTestId("studio-tab-save").click();
    await expect(page.getByTestId("studio-export-blocked")).toBeVisible();
    await expect(page.getByTestId("studio-save")).toBeDisabled();
    await expect(page.getByTestId("studio-download")).toBeDisabled();
    await expect(page.getByTestId("studio-share")).toBeDisabled();
    await page.screenshot({ path: join(proofDir, "12-mobile-no-photo.png") });

    // ---- F16: nada pago foi tocado e o console ficou limpo ----------------------------------------------
    const forbidden = apiCalls.filter((call) => /POST \/api\/marketing\/pro\/generate|photoroom-cutout|\/api\/ads-pro\/preparation-quota\/.*(reserve|complete)/i.test(call));
    expect(forbidden, `chamadas pagas inesperadas: ${forbidden.join(", ")}`).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
