/**
 * PRO-05 — validação final do runtime real de Anúncios Pro (Free × Premium), contra a aplicação REAL
 * (server/index.ts + client Vite) apontada para o Firebase Auth/Firestore Emulator — mesmo harness já
 * usado por account-deletion.spec.ts / signup-pattern.spec.ts.
 *
 * Orquestração: scripts/e2e/run-account-deletion-e2e.mjs, com E2E_SPEC apontando para este arquivo
 * (o mesmo truque que scripts/e2e/run-signup-pattern-e2e.mjs já usa) — nenhum orquestrador novo criado.
 *
 * O plano Premium/histórico Pro são semeados diretamente no Firestore Emulator via Firebase Admin SDK
 * (mesmo padrão de script/subscription-cancel-tests.ts) — a UI é usada só para o comportamento sob
 * teste (seleção de template, deep link, reabertura de histórico), nunca para reconstruir estado que
 * já tem um caminho de escrita direto e mais confiável.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { decodePng, generateProductOnPlainBackgroundPng, generateProductTestPng, regionLuminanceStdDev } from "./support/png";

const emulatorMode = process.env.E2E_EMULATOR === "1";
const PASSWORD = "LocalTestPassword!123";

function uniqueEmail(label: string): string {
  return `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

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

/** Cria uma conta de verdade pela UI, contra o Auth Emulator (mesmo helper do RELEASE-03B). */
async function signUp(page: Page, email: string, storeName: string): Promise<string> {
  await page.goto("/signup");
  await page.getByPlaceholder("Ex: Maria Cosméticos").fill(storeName);
  await page.getByPlaceholder("seu@email.com").fill(email);
  await page.getByPlaceholder("Mínimo 6 caracteres").fill(PASSWORD);
  await page.getByRole("button", { name: /criar minha conta/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("/signup"), { timeout: 30_000 });
  await expect
    .poll(async () => page.evaluate(() => window.localStorage.getItem("rs:session")), { timeout: 20_000 })
    .toBeTruthy();
  return (await page.evaluate(() => window.localStorage.getItem("rs:session")))!;
}

async function createProduct(page: Page, name: string): Promise<void> {
  await page.goto("/add-product");
  await page.getByTestId("input-product-name").fill(name);
  await page.getByTestId("input-category").selectOption({ index: 1 });
  // Os rótulos de preço/estoque em add-product.tsx não têm associação programática (sem
  // `htmlFor`/`id`), então getByLabel não os resolve — achado pré-existente, fora do escopo desta
  // tarefa. Usa os data-testid, que existem e já são o padrão do resto deste formulário.
  await page.getByTestId("input-cost-price").fill("10");
  await page.getByTestId("input-sale-price").fill("30");
  await page.getByTestId("input-stock").fill("5");
  await page.getByTestId("button-save-product").click();
  // O salvamento é assíncrono (upload/Firestore) e só navega sozinho depois de confirmar sucesso
  // (setTimeout de 1.5s em add-product.tsx); navegar manualmente antes disso cancelaria a gravação
  // em voo. Espera o redirecionamento real em vez de forçar `goto`.
  await page.waitForURL(/\/products/, { timeout: 20_000 });
  await expect(page.getByText(name)).toBeVisible({ timeout: 20_000 });
}

/** Grava premiumActive/currentPlan diretamente no Firestore Emulator — mesmo padrão dos scripts admin. */
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

/** Grava um anúncio de histórico com um template Pro, sem passar pela UI de criação (o comportamento
 * sob teste é a REABERTURA, não a criação). */
async function seedProHistoryEntry(uid: string, entryId: string, templateId: string, note: string): Promise<void> {
  process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
  const { initializeFirebaseAdmin, getFirebaseAdmin } = await import("../../server/firebase-admin-init");
  initializeFirebaseAdmin();
  const admin = getFirebaseAdmin();
  await admin.firestore().collection("users").doc(uid).collection("marketingHistory").doc(entryId).set({
    action: "generated",
    productId: "produto-inexistente-e2e",
    productName: "Produto Pro Antigo",
    generatedText: "",
    template: templateId,
    templateId,
    themeId: "brand",
    price: "199.9",
    headline: "Anúncio antigo Premium",
    note,
    ctaText: "Chamar no WhatsApp",
    storeName: "Loja Teste",
    primaryColor: "#ec4899",
    showBrand: true,
    showVolume: true,
    showStockStatus: true,
    showWhatsAppCta: true,
    backgroundStyle: "soft-gradient",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAtISO: new Date().toISOString(),
  });
}

/**
 * PRO-06: cria um produto com uma foto REAL (upload via input[type=file], mesmo caminho de
 * compressão/avaliação de qualidade que o usuário real percorre) — necessário porque produtos vivem
 * em IndexedDB local (client/src/lib/mock-data.ts), não em Firestore, então não dá para semear via
 * Admin SDK como o resto deste arquivo faz para plano/histórico.
 */
async function createProductWithImage(
  page: Page,
  options: { name: string; price: number; imageBuffer: Buffer; onSale?: boolean; discountPercent?: number },
): Promise<void> {
  await page.goto("/add-product");
  await page.getByTestId("input-product-name").fill(options.name);
  await page.getByTestId("input-category").selectOption({ index: 1 });
  await page.getByTestId("input-cost-price").fill("10");
  await page.getByTestId("input-sale-price").fill(String(options.price));
  await page.getByTestId("input-stock").fill("5");
  await page.locator("#gallery-upload").setInputFiles({
    name: "produto-e2e.png",
    mimeType: "image/png",
    buffer: options.imageBuffer,
  });
  // A compressão/avaliação de qualidade da imagem é assíncrona; espera o preview REAL do produto
  // aparecer antes de seguir (alt="Prévia do produto", ver add-product.tsx) — um seletor genérico de
  // <img> pegaria qualquer ícone da página (ex.: avatar da loja) e passaria antes da foto existir,
  // fazendo o produto ser salvo sem imagem.
  await expect(page.getByAltText("Prévia do produto")).toBeVisible({ timeout: 20_000 });
  if (options.onSale) {
    await page.getByTestId("toggle-on-sale").check();
    await page.getByTestId("input-discount-percent").fill(String(options.discountPercent ?? 20));
  }
  await page.getByTestId("button-save-product").click();
  await page.waitForURL(/\/products/, { timeout: 20_000 });
  await expect(page.getByText(options.name)).toBeVisible({ timeout: 20_000 });
}

/**
 * PRO-06: server/uploads.ts `buildPublicDownloadUrl` sempre aponta para
 * `https://firebasestorage.googleapis.com/...` (produção) — correto lá, porque as Storage Rules
 * liberam leitura pública para esses paths. Mas neste E2E o arquivo foi gravado no Storage EMULATOR
 * (porta 9199, ver firebase.json), não na nuvem real, então a URL pública real é inalcançável aqui.
 * Isto é uma lacuna do AMBIENTE de teste, não um bug do app (mesma classe de workaround que
 * scripts/e2e/run-account-deletion-e2e.mjs já documenta para o Vite) — por isso o roteamento é feito
 * inteiramente no lado do teste, reescrevendo a chamada para o emulador local, que serve a MESMA API
 * REST (`/v0/b/{bucket}/o/{path}?alt=media`) na porta local.
 */
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

async function selectProductInMarketing(page: Page, name: string): Promise<void> {
  await page.goto("/marketing");
  await expect(page.getByTestId("marketing-template-selector")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("marketing-product-selector").locator("select").first().selectOption({ label: name });
}

async function selectTemplateAndWaitReady(page: Page, templateId: string, label: string): Promise<void> {
  await page.getByTestId(`button-marketing-template-${templateId}`).click();
  await expect(page.getByTestId(`button-marketing-template-${templateId}`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("marketing-ad-canvas").getByText(label)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("button-download-ad-image")).toBeEnabled({ timeout: 20_000 });
}

const FREE_TEMPLATE_IDS = ["spotlight", "promo", "last", "new", "bestseller", "kit", "catalog", "whatsapp", "delivery", "preorder"];
const PRO_TEMPLATE_IDS = ["premium_spotlight", "elegant_offer", "luxury", "minimal_pro", "promo_impact"];
const PRO_TEMPLATE_LABELS: Record<string, string> = {
  premium_spotlight: "DESTAQUE PREMIUM",
  elegant_offer: "OFERTA ELEGANTE",
  luxury: "LUXO",
  minimal_pro: "MINIMALISTA PRO",
  promo_impact: "PROMO IMPACTO",
};

test.describe("PRO-05 — Anúncios Pro, runtime real Free × Premium", () => {
  test.skip(!emulatorMode, "Requer o ambiente emulado: E2E_SPEC=tests/e2e/marketing-pro.spec.ts node scripts/e2e/run-account-deletion-e2e.mjs");

  test("Matriz Free: 10 templates livres, 5 Pro bloqueados, deep link e histórico não burlam o plano", async ({ page }) => {
    await preparePage(page);
    const email = uniqueEmail("marketing-free");
    const uid = await signUp(page, email, "Loja Free E2E");

    // ===== editor abre normalmente =====
    await page.goto("/marketing");
    await expect(page.getByTestId("marketing-template-selector")).toBeVisible({ timeout: 20_000 });

    // ===== 10 Free utilizáveis, 5 Pro claramente bloqueados =====
    for (const id of FREE_TEMPLATE_IDS) {
      const button = page.getByTestId(`button-marketing-template-${id}`);
      await expect(button, `Free: ${id} deveria estar disponível`).not.toHaveAttribute("aria-disabled", "true");
    }
    for (const id of PRO_TEMPLATE_IDS) {
      const button = page.getByTestId(`button-marketing-template-${id}`);
      await expect(button, `Free: ${id} deveria estar bloqueado`).toHaveAttribute("aria-disabled", "true");
      await expect(button.getByText("PRO", { exact: true }), `Free: ${id} precisa mostrar o selo PRO`).toBeVisible();
    }

    // ===== clicar em Pro NÃO ativa o template + CTA de upgrade leva para /subscribe =====
    // `force: true`: o Playwright trata aria-disabled="true" como não-acionável para clique sintético
    // (é exatamente essa semântica de acessibilidade que a UI declara), mas um clique de mouse REAL
    // não é bloqueado por aria-disabled (só o atributo disabled nativo bloquearia) — o botão não tem
    // disabled nativo de propósito, porque quem intercepta o clique é o próprio onClick (locked ?
    // onLockedTemplateTap : onTemplateChange), não o navegador. force replica o clique real do usuário;
    // o mesmo padrão já usado em tests/e2e/account-deletion.spec.ts para o botão desabilitado de lá.
    await page.getByTestId("button-marketing-template-luxury").click({ force: true });
    await page.waitForURL(/\/subscribe/, { timeout: 10_000 });
    await expect(page.getByTestId(`button-marketing-template-luxury`)).toHaveCount(0); // saímos da página

    // ===== deep link manual Pro não burla o bloqueio =====
    await page.goto("/marketing?template=premium_spotlight");
    await expect(page.getByTestId("marketing-template-selector")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("button-marketing-template-promo")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("button-marketing-template-premium_spotlight")).toHaveAttribute("aria-pressed", "false");

    // ===== histórico Pro reaberto em Free faz fallback seguro sem perder os outros dados =====
    await seedProHistoryEntry(uid, "e2e-pro-history-free", "premium_spotlight", "Nota preservada e2e");
    await page.goto("/marketing");
    await page.getByTestId("tab-marketing-history").click();
    await expect(page.getByTestId("marketing-history-card-e2e-pro-history-free")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("button-history-menu-e2e-pro-history-free").click();
    await page.getByRole("menuitem", { name: /editar/i }).click();

    // aviso discreto de downgrade (mensagem única — ver PRO-05: dois notifyInfo síncronos faziam o
    // React descartar o primeiro, então o aviso nunca aparecia; corrigido para uma única chamada)
    await expect(page.getByText(/exigia Premium/i)).toBeVisible({ timeout: 10_000 });
    // fallback: o template ativo no editor é Free (promo), nunca o Pro salvo
    await expect(page.getByTestId("button-marketing-template-promo")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("button-marketing-template-premium_spotlight")).toHaveAttribute("aria-pressed", "false");
    // outros dados do anúncio continuam preenchidos — nada foi perdido pelo fallback de template
    await expect(page.getByLabel("Nota curta")).toHaveValue("Nota preservada e2e");
  });

  test("Matriz Premium: os 5 Pro ficam selecionáveis, mudam visual de verdade, deep link abre e histórico reabre no mesmo template", async ({ page }) => {
    await preparePage(page);
    const email = uniqueEmail("marketing-premium");
    const uid = await signUp(page, email, "Loja Premium E2E");
    await seedPremiumPlan(uid);
    await createProduct(page, "Produto Premium E2E");

    // Sessão fresca: PlanProvider só busca o plano na troca de auth state / novo mount — recarregar
    // garante que o `activePlan` já reflita o premiumActive semeado acima.
    await page.reload();
    await page.goto("/marketing");
    await expect(page.getByTestId("marketing-template-selector")).toBeVisible({ timeout: 20_000 });
    // getByLabel("Produto") é ambíguo: a busca de texto ("Pesquisar produto") e o <select> de produto
    // (rótulo sem `for`/`id`, cujo nome acessível vira "Produto" + a opção atual concatenados) batem
    // na mesma busca por substring. O seletor de produto é o PRIMEIRO <select> dentro da seção.
    await page.getByTestId("marketing-product-selector").locator("select").first().selectOption({ label: "Produto Premium E2E" });

    // ===== nenhum Pro aparece bloqueado =====
    for (const id of PRO_TEMPLATE_IDS) {
      const button = page.getByTestId(`button-marketing-template-${id}`);
      await expect(button, `Premium: ${id} não pode estar bloqueado`).not.toHaveAttribute("aria-disabled", "true");
      await expect(button.getByText("PRO", { exact: true }), `Premium: ${id} não pode mostrar o selo de bloqueio`).toHaveCount(0);
    }

    // ===== cada um dos 5 templates Pro é selecionável e muda o visual de verdade =====
    const canvas = page.getByTestId("marketing-ad-canvas");
    for (const id of PRO_TEMPLATE_IDS) {
      await page.getByTestId(`button-marketing-template-${id}`).click();
      await expect(page.getByTestId(`button-marketing-template-${id}`)).toHaveAttribute("aria-pressed", "true");
      await expect(canvas.getByText(PRO_TEMPLATE_LABELS[id]), `Premium: preview não mudou para ${id}`).toBeVisible({ timeout: 10_000 });
    }

    // ===== deep link Pro abre corretamente em Premium =====
    await page.goto("/marketing?template=luxury");
    await expect(page.getByTestId("button-marketing-template-luxury")).toHaveAttribute("aria-pressed", "true");

    // ===== histórico Pro reabre no MESMO template (sem fallback, plano ainda Premium) =====
    await seedProHistoryEntry(uid, "e2e-pro-history-premium", "minimal_pro", "Nota Premium e2e");
    await page.goto("/marketing");
    await page.getByTestId("tab-marketing-history").click();
    await expect(page.getByTestId("marketing-history-card-e2e-pro-history-premium")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("button-history-menu-e2e-pro-history-premium").click();
    await page.getByRole("menuitem", { name: /editar/i }).click();
    await expect(page.getByText(/exigia Premium/i)).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByTestId("button-marketing-template-minimal_pro")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Nota curta")).toHaveValue("Nota Premium e2e");
  });
});

test.describe("PRO-06 — fechamento prático: render real dos 5 templates Pro + export PNG real", () => {
  test.skip(!emulatorMode, "Requer o ambiente emulado: E2E_SPEC=tests/e2e/marketing-pro.spec.ts node scripts/e2e/run-account-deletion-e2e.mjs");

  const outDir = join(tmpdir(), "revendasmart-e2e-pro06");
  mkdirSync(outDir, { recursive: true });

  // Cinco recortes visuais pedidos pela tarefa: perfume vertical, produto baixo/largo, quadrado,
  // claro e escuro. Cor sólida com faixa de contraste central (ver support/png.ts) — o que importa
  // aqui é a GEOMETRIA (proporção) e o CONTRASTE (para detectar "canvas vazio"), não fotorrealismo.
  const IMAGE_CASES = {
    A_perfumeVertical: generateProductTestPng(360, 900, [180, 60, 140]),
    B_baixoLargo: generateProductTestPng(900, 320, [40, 120, 90]),
    C_quadrado: generateProductTestPng(640, 640, [60, 90, 200]),
    D_claro: generateProductTestPng(600, 700, [235, 230, 220]),
    E_escuro: generateProductTestPng(600, 700, [25, 25, 30]),
  };

  test("Matriz visual: 5 templates Pro renderizados com imagens/nomes/preços distintos", async ({ page }) => {
    await preparePage(page);
    await routeStorageEmulatorDownloads(page);
    const email = uniqueEmail("marketing-pro06-matrix");
    const uid = await signUp(page, email, "Loja PRO-06 Matriz");
    await seedPremiumPlan(uid);

    const matrix: Array<{ templateId: string; label: string; name: string; price: number; image: Buffer; onSale?: boolean }> = [
      { templateId: "premium_spotlight", label: PRO_TEMPLATE_LABELS.premium_spotlight, name: "Perfume Essencial", price: 89.9, image: IMAGE_CASES.A_perfumeVertical },
      { templateId: "elegant_offer", label: PRO_TEMPLATE_LABELS.elegant_offer, name: "Kit Organizador de Gavetas Multiuso Premium Reforçado", price: 129.9, image: IMAGE_CASES.B_baixoLargo, onSale: true },
      { templateId: "luxury", label: PRO_TEMPLATE_LABELS.luxury, name: "Bolsa Quadrada", price: 249.9, image: IMAGE_CASES.C_quadrado },
      { templateId: "minimal_pro", label: PRO_TEMPLATE_LABELS.minimal_pro, name: "Creme Hidratante Facial Antissinais de Longa Duração", price: 59.9, image: IMAGE_CASES.D_claro, onSale: true },
      { templateId: "promo_impact", label: PRO_TEMPLATE_LABELS.promo_impact, name: "Caixa Escura", price: 39.9, image: IMAGE_CASES.E_escuro },
    ];

    for (const item of matrix) {
      await createProductWithImage(page, { name: item.name, price: item.price, imageBuffer: item.image, onSale: item.onSale });
      await selectProductInMarketing(page, item.name);
      await selectTemplateAndWaitReady(page, item.templateId, item.label);

      const canvas = page.getByTestId("marketing-ad-canvas");
      await expect(canvas, `${item.templateId}: preço não apareceu no preview`).toContainText(/\d/);
      const screenshotPath = join(outDir, `preview-${item.templateId}.png`);
      await canvas.screenshot({ path: screenshotPath });
      console.log(`[PRO-06] preview salvo: ${item.templateId} -> ${screenshotPath}`);
    }
  });

  test("Export PNG real: download, decodifica, 1080x1080, produto preservado (premium_spotlight, luxury, minimal_pro)", async ({ page }) => {
    await preparePage(page);
    await routeStorageEmulatorDownloads(page);
    const email = uniqueEmail("marketing-pro06-export");
    const uid = await signUp(page, email, "Loja PRO-06 Export");
    await seedPremiumPlan(uid);

    const cases: Array<{ templateId: string; label: string; name: string; price: number; image: Buffer }> = [
      { templateId: "premium_spotlight", label: PRO_TEMPLATE_LABELS.premium_spotlight, name: "Perfume Export A", price: 79.9, image: IMAGE_CASES.A_perfumeVertical },
      { templateId: "luxury", label: PRO_TEMPLATE_LABELS.luxury, name: "Bolsa Export B", price: 199.9, image: IMAGE_CASES.C_quadrado },
      { templateId: "minimal_pro", label: PRO_TEMPLATE_LABELS.minimal_pro, name: "Creme Export C Nome Bem Comprido Para Testar Quebra", price: 45.9, image: IMAGE_CASES.D_claro },
    ];

    for (const item of cases) {
      await createProductWithImage(page, { name: item.name, price: item.price, imageBuffer: item.image });
      await selectProductInMarketing(page, item.name);
      await selectTemplateAndWaitReady(page, item.templateId, item.label);

      // Screenshot do preview DOM (MarketingAdCanvas.tsx) ANTES do download, para a comparação
      // preview × PNG exportado (renderizadores diferentes: DOM ao vivo vs. Canvas2D no export).
      const previewPath = join(outDir, `preview-before-export-${item.templateId}.png`);
      await page.getByTestId("marketing-ad-canvas").screenshot({ path: previewPath });

      const downloadPromise = page.waitForEvent("download", { timeout: 20_000 });
      await page.getByTestId("button-download-ad-image").click();
      const download = await downloadPromise;
      const pngPath = join(outDir, `export-${item.templateId}.png`);
      await download.saveAs(pngPath);
      await expect(page.getByText(/Card salvo em/i)).toBeVisible({ timeout: 15_000 });

      const buffer = readFileSync(pngPath);
      const png = decodePng(buffer);

      expect(png.width, `${item.templateId}: largura do PNG exportado`).toBe(1080);
      expect(png.height, `${item.templateId}: altura do PNG exportado`).toBe(1080);
      expect(buffer.length, `${item.templateId}: PNG exportado não pode ser vazio`).toBeGreaterThan(1000);

      // "Não é canvas vazio": a imagem inteira tem variação de luminância real (produto + textos +
      // fundo não uniforme). Um canvas em branco/travado teria stddev ~0.
      const wholeImageStdDev = regionLuminanceStdDev(png, 0, 0, png.width, png.height);
      expect(wholeImageStdDev, `${item.templateId}: PNG exportado parece um canvas vazio/uniforme`).toBeGreaterThan(5);

      // Região central (onde a foto do produto fica, em todos os 5 templates Pro por geometria
      // compartilhada de marketing-art-layout.ts): também precisa ter variação — prova que a foto do
      // produto (com a faixa de contraste sintética) realmente foi desenhada, não substituída por um
      // placeholder liso.
      const centerStdDev = regionLuminanceStdDev(png, Math.round(png.width * 0.25), Math.round(png.height * 0.2), Math.round(png.width * 0.75), Math.round(png.height * 0.65));
      expect(centerStdDev, `${item.templateId}: região central (produto) parece vazia — imagem pode não ter sido preservada`).toBeGreaterThan(3);

      console.log(`[PRO-06] export validado: ${item.templateId} -> ${pngPath} (${png.width}x${png.height}, stdDevTotal=${wholeImageStdDev.toFixed(1)}, stdDevCentro=${centerStdDev.toFixed(1)})`);
    }
  });
});

test.describe("PRO-07 — Remover fundo real (método local-heuristic)", () => {
  test.skip(!emulatorMode, "Requer o ambiente emulado: E2E_SPEC=tests/e2e/marketing-pro.spec.ts node scripts/e2e/run-account-deletion-e2e.mjs");

  test("Premium: gera cutout real, salva, e o Composer V2 fica disponível para o mesmo produto", async ({ page }) => {
    await preparePage(page);
    await routeStorageEmulatorDownloads(page);
    const email = uniqueEmail("marketing-pro07-cutout");
    const uid = await signUp(page, email, "Loja PRO-07 Cutout");
    await seedPremiumPlan(uid);

    const plainBackgroundImage = generateProductOnPlainBackgroundPng(300, 0.18, [30, 110, 90]);
    await createProductWithImage(page, { name: "Produto Fundo Liso PRO-07", price: 59.9, imageBuffer: plainBackgroundImage });

    await page.goto("/marketing");
    await page.reload();
    await page.getByTestId("tab-marketing-pro").click();
    await expect(page.getByTestId("marketing-pro-panel")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("marketing-pro-cutout-tool")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("marketing-pro-preview-product").selectOption({ label: "Produto Fundo Liso PRO-07" });

    // A: botão real, não texto "Em desenvolvimento" — clique de verdade dispara o processamento local.
    await page.getByTestId("button-cutout-generate").click();
    await expect(page.getByTestId("img-cutout-preview")).toBeVisible({ timeout: 20_000 });

    // C: clique duplo não deveria gerar dois pedidos concorrentes — o botão de salvar já reflete o
    // guard de double-click no handler (verificado estruturalmente em smoke-tests.ts); aqui confirmamos
    // que um único clique é suficiente para completar o fluxo real.
    await page.getByTestId("button-cutout-save").click();
    await expect(page.getByTestId("text-cutout-saved")).toBeVisible({ timeout: 20_000 });

    // K/L (parcial): o mesmo produto, sem reload, já expõe approvedCutout para o Composer V2 — a
    // infraestrutura de "Trocar fundo" (PRO-07K/07J, já existente) passa a ter um cutout real para
    // consumir. A seção só renderiza com a flag de remote config marketing_pro_creative_v2_enabled
    // ligada (default OFF) — aqui confirmamos que o dado ficou pronto checando o Firestore diretamente.
    process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
    const { initializeFirebaseAdmin, getFirebaseAdmin } = await import("../../server/firebase-admin-init");
    initializeFirebaseAdmin();
    const admin = getFirebaseAdmin();
    const productsSnapshot = await admin.firestore().collection("users").doc(uid).collection("products").get();
    const productDoc = productsSnapshot.docs.find((doc) => doc.data().name === "Produto Fundo Liso PRO-07");
    expect(productDoc, "produto criado deveria existir no Firestore").toBeTruthy();
    const approvedCutout = productDoc?.data().approvedCutout;
    expect(approvedCutout, "approvedCutout precisa ter sido persistido no produto").toBeTruthy();
    expect(approvedCutout.mimeType).toBe("image/png");
    expect(approvedCutout.preservesOriginalPixels).toBe(true);
    expect(approvedCutout.method).toBe("local-heuristic");
    expect(String(approvedCutout.storagePath)).toContain(`users/${uid}/product-cutouts/`);
  });
});
