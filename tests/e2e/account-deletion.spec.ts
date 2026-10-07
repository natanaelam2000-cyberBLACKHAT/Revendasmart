/**
 * RELEASE-03B — E2E real do fluxo de exclusão de conta.
 *
 * Roda contra a aplicação REAL (server/index.ts servindo API + client Vite) apontada para o Firebase
 * Auth/Firestore/Storage Emulator. Não há mock do backend nos caminhos principais: a conta é criada
 * de verdade pela UI, excluída de verdade pelo endpoint real, e as verificações de sessão antiga e de
 * login usam a Auth emulada real.
 *
 * Os únicos pontos mockados são os BLOQUEIOS (§4): assinatura ativa / conexão Mercado Pago ativa /
 * falha recuperável são simulados interceptando a resposta HTTP do próprio endpoint, para exercitar a
 * UI sem nenhuma chamada real ao Mercado Pago e sem alterar o backend.
 *
 * Orquestração (emuladores + servidor + Playwright): scripts/e2e/run-account-deletion-e2e.mjs
 * (`npm run test:e2e:account-deletion`).
 */
import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import { isolateEmulatorObservability, isExpectedAdminProbe } from "./auth-emulator-observability";

const emulatorMode = process.env.E2E_EMULATOR === "1";

const CONFIRMATION = "EXCLUIR MINHA CONTA";
const PASSWORD = "LocalTestPassword!123";

function uniqueEmail(label: string): string {
  return `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

/**
 * No ambiente emulado o Firebase Analytics tenta buscar configuração remota com a apiKey de fachada
 * (`demo-api-key`) e recebe 400; o plugin de dev `runtime-error-plugin` transforma isso num overlay
 * em tela cheia que intercepta cliques. É um artefato do ambiente de teste — não um erro da
 * aplicação, e não existe em produção (apiKey real) nem no build de produção (sem o plugin de dev).
 * Escondemos o overlay para poder interagir, mas continuamos coletando os erros de página para provar
 * que NENHUM erro além desse aparece durante o fluxo.
 */
const ANALYTICS_EMULATOR_NOISE = /config-fetch-failed|API key not valid|analytics/i;

/**
 * Ruído esperado no console durante este fluxo. Tudo aqui é consequência DELIBERADA do próprio teste
 * ou do ambiente emulado — o objetivo do allowlist é justamente manter a asserção final rigorosa para
 * qualquer erro que NÃO esteja nesta lista.
 */
const EXPECTED_CONSOLE_NOISE: Array<{ pattern: RegExp; why: string }> = [
  { pattern: ANALYTICS_EMULATOR_NOISE, why: "Analytics não funciona com a apiKey de fachada do emulador" },
  { pattern: /Failed to load resource: the server responded with a status of (400|409|500)/, why: "respostas 409/500 que o próprio teste injeta (bloqueios e falha recuperável) e 400 do Analytics/login inválido" },
  { pattern: /auth\/user-not-found/, why: "cenário K: o login da conta excluída precisa falhar" },
  // Achado pré-existente, sem relação com exclusão de conta: o atributo `pattern` do campo de e-mail
  // em client/src/pages/signup.tsx é rejeitado pelos Chromium novos (modo de regex `v`), então o
  // navegador só registra um aviso e ignora a validação nativa. Reportado, não corrigido aqui.
  { pattern: /Pattern attribute value .* is not a valid regular expression/, why: "bug pré-existente no signup, fora do escopo do RELEASE-03B" },
];

async function preparePage(page: Page, collected: string[]): Promise<void> {
  await isolateEmulatorObservability(page);
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
  page.on("pageerror", (error) => collected.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !isExpectedAdminProbe(message.location().url, message.text())) collected.push(message.text());
  });
}

/** Cria uma conta de verdade pela UI, contra o Auth Emulator. */
async function signUp(page: Page, email: string, storeName: string): Promise<string> {
  await page.goto("/signup");
  await page.getByPlaceholder("Ex: Maria Cosméticos").fill(storeName);
  await page.getByPlaceholder("seu@email.com").fill(email);
  await page.getByPlaceholder("Mínimo 6 caracteres").fill(PASSWORD);
  await page.getByRole("button", { name: /criar minha conta/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("/signup"), { timeout: 30_000 });

  // `rs:session` guarda o uid autenticado; é a chave que prefixa todo o estado local por conta.
  await expect
    .poll(async () => page.evaluate(() => window.localStorage.getItem("rs:session")), { timeout: 20_000 })
    .toBeTruthy();
  return (await page.evaluate(() => window.localStorage.getItem("rs:session")))!;
}

/** Semeia estado local atribuível ao UID, para provar depois que ele foi removido. */
async function seedLocalDataForUid(page: Page, uid: string): Promise<void> {
  await page.evaluate((ownerUid) => {
    window.localStorage.setItem(`rs:${ownerUid}:products`, JSON.stringify([{ id: "p1", name: "Produto local" }]));
    window.localStorage.setItem(`rs:${ownerUid}:sales`, JSON.stringify([{ id: "s1" }]));
  }, uid);
}

async function scopedLocalKeys(page: Page, uid: string): Promise<string[]> {
  return page.evaluate(
    (ownerUid) => Object.keys(window.localStorage).filter((key) => key.startsWith(`rs:${ownerUid}:`)),
    uid,
  );
}

async function openAccountSettings(page: Page): Promise<void> {
  await page.goto("/settings?tab=account");
  await expect(page.getByTestId("button-delete-account")).toBeVisible({ timeout: 30_000 });
}

test.describe("Exclusão de conta — fluxo completo", () => {
  test.skip(!emulatorMode, "E2E de exclusão de conta requer o ambiente emulado: use npm run test:e2e:account-deletion.");

  test("A→L: Settings leva ao fluxo, confirmação protege, exclusão desloga e não vaza para outro tenant", async ({ page, browser, request }) => {
    const pageErrors: string[] = [];
    await preparePage(page, pageErrors);

    // ---- Tenant B: criado ANTES, para provar no fim que nada dele foi tocado (L) ----
    const tenantBContext = await browser.newContext();
    const tenantBPage = await tenantBContext.newPage();
    await preparePage(tenantBPage, pageErrors);
    const tenantBEmail = uniqueEmail("tenant-b");
    const tenantBUid = await signUp(tenantBPage, tenantBEmail, "Loja Tenant B");
    await seedLocalDataForUid(tenantBPage, tenantBUid);
    expect(tenantBUid).toBeTruthy();

    // ---- Tenant A: a conta que será excluída ----
    const tenantAEmail = uniqueEmail("tenant-a");
    const tenantAUid = await signUp(page, tenantAEmail, "Loja Tenant A");
    await seedLocalDataForUid(page, tenantAUid);
    expect(tenantAUid).not.toBe(tenantBUid);

    // ===== A: usuário autenticado abre Settings =====
    await openAccountSettings(page);

    // ===== B: encontra "Excluir minha conta" =====
    const deleteEntry = page.getByTestId("button-delete-account");
    await expect(deleteEntry).toBeVisible();
    await expect(deleteEntry).toContainText(/excluir minha conta/i);

    // §5 acessibilidade: alvo de toque confortável (>= 44px) e foco visível por teclado.
    const entryBox = await deleteEntry.boundingBox();
    expect(entryBox!.height).toBeGreaterThanOrEqual(44);
    await deleteEntry.focus();
    await expect(deleteEntry).toBeFocused();

    // ===== C: navega para /account-deletion =====
    await deleteEntry.click();
    await page.waitForURL(/\/account-deletion/, { timeout: 20_000 });
    const submit = page.getByTestId("button-account-deletion-submit");
    const confirmationInput = page.getByTestId("input-account-deletion-confirmation");
    await expect(submit).toBeVisible();

    // §5: o campo tem label associado e descrição acessível.
    await expect(confirmationInput).toHaveAccessibleName(/confirmação/i);
    await expect(confirmationInput).toHaveAccessibleDescription(/frase de confirmação/i);
    const submitBox = await submit.boundingBox();
    expect(submitBox!.height).toBeGreaterThanOrEqual(44);

    // Nenhum DELETE pode partir enquanto a confirmação não estiver correta.
    let deleteRequests = 0;
    let capturedAuthorization = "";
    page.on("request", (req) => {
      if (req.method() === "DELETE" && req.url().includes("/api/account")) {
        deleteRequests += 1;
        capturedAuthorization = req.headers()["authorization"] ?? "";
      }
    });

    // ===== D: sem frase de confirmação o botão não executa =====
    await expect(submit).toBeDisabled();
    await submit.click({ force: true });
    await page.waitForTimeout(500);
    expect(deleteRequests, "D: nenhuma requisição de exclusão sem confirmação").toBe(0);

    // ===== E: frase errada não executa =====
    await confirmationInput.fill("excluir minha conta");
    await expect(submit).toBeDisabled();
    await confirmationInput.fill("EXCLUIR MINHA CONTA!");
    await expect(submit).toBeDisabled();
    await submit.click({ force: true });
    await page.waitForTimeout(500);
    expect(deleteRequests, "E: nenhuma requisição de exclusão com frase errada").toBe(0);

    // ===== §4: bloqueios e erro recuperável, com retry (respostas interceptadas, zero Mercado Pago real) =====
    await confirmationInput.fill(CONFIRMATION);
    await expect(submit).toBeDisabled();
    await page.getByLabel("Senha atual", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Senha atual", { exact: true }).fill(PASSWORD);
    await expect(submit).toBeEnabled();

    await page.route("**/api/account", async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "ACTIVE_SUBSCRIPTION", message: "Cancele a assinatura ativa antes de excluir a conta.", requestId: "e2e" } }),
      });
    });
    await page.getByLabel("Senha atual", { exact: true }).fill(PASSWORD);
    await submit.click();
    await expect(page.getByTestId("card-account-deletion-blocked")).toBeVisible();
    await expect(page.getByTestId("link-account-deletion-subscription")).toBeVisible();
    await expect(page.getByTestId("text-account-deletion-error")).toContainText(/assinatura ativa/i);
    // §5: o erro é associado ao campo (aria-describedby) e marcado como inválido.
    await expect(confirmationInput).toHaveAttribute("aria-invalid", "true");
    await expect(confirmationInput).toHaveAccessibleDescription(/assinatura ativa/i);

    await page.unroute("**/api/account");
    await page.route("**/api/account", async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "ACTIVE_MERCADOPAGO_CONNECTION", message: "Desconecte sua conta Mercado Pago antes de excluir a conta.", requestId: "e2e" } }),
      });
    });
    await page.getByLabel("Senha atual", { exact: true }).fill(PASSWORD);
    await submit.click();
    await expect(page.getByTestId("link-account-deletion-mercadopago")).toBeVisible();

    await page.unroute("**/api/account");
    await page.route("**/api/account", async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "ACCOUNT_DELETION_FAILED", message: "A exclusão não foi concluída. Tente novamente.", requestId: "e2e" } }),
      });
    });
    await page.getByLabel("Senha atual", { exact: true }).fill(PASSWORD);
    await submit.click();
    await expect(page.getByTestId("text-account-deletion-error")).toContainText(/tente novamente/i);
    // Erro recuperável vira retry explícito, sem bloquear o usuário.
    await expect(submit).toContainText(/tentar novamente/i);
    await page.getByLabel("Senha atual", { exact: true }).fill(PASSWORD);
    await expect(submit).toBeEnabled();
    await expect(page.getByTestId("card-account-deletion-blocked")).toHaveCount(0);

    // A partir daqui o backend REAL volta a responder.
    await page.unroute("**/api/account");
    const deleteRequestsBeforeRealRun = deleteRequests;

    // ===== F/G/H: confirmação exata executa, mostra carregando e conclui =====
    await page.getByLabel("Senha atual", { exact: true }).fill(PASSWORD);
    await expect(submit).toBeEnabled();
    await page.getByLabel("Senha atual", { exact: true }).fill(PASSWORD);
    await submit.click();
    await expect(submit).toHaveAttribute("aria-busy", "true");
    await expect(page.getByTestId("card-account-deletion-completed")).toBeVisible({ timeout: 60_000 });
    expect(deleteRequests, "F: a confirmação exata dispara a exclusão").toBeGreaterThan(deleteRequestsBeforeRealRun);
    expect(capturedAuthorization).toMatch(/^Bearer .+/);

    // ===== I: estado local do UID removido =====
    await expect.poll(async () => scopedLocalKeys(page, tenantAUid), { timeout: 15_000 }).toEqual([]);

    // ===== H (continuação): a sessão acabou — rota privada volta para o login =====
    await page.goto("/settings");
    await page.waitForURL(/\/login/, { timeout: 30_000 });

    // ===== J: token/sessão antiga não consegue mais operar APIs =====
    const staleToken = capturedAuthorization.replace(/^Bearer\s+/i, "");
    expect(staleToken.length).toBeGreaterThan(20);
    // A API roda numa origem própria (o client é servido pelo Vite); o fixture `request` está preso
    // à baseURL do client, então a chamada precisa ser explicitamente contra a API.
    const apiBaseUrl = process.env.E2E_API_BASE_URL;
    expect(apiBaseUrl, "E2E_API_BASE_URL precisa apontar para a API real").toBeTruthy();
    const staleApi: APIRequestContext = request;
    const staleResponse = await staleApi.get(`${apiBaseUrl}/api/plan/data/${tenantAUid}`, {
      headers: { Authorization: `Bearer ${staleToken}` },
    });
    expect([401, 403], `J: token antigo recebeu ${staleResponse.status()}`).toContain(staleResponse.status());

    // ===== K: login da conta excluída falha =====
    await page.goto("/login");
    await page.getByTestId("input-login-email").fill(tenantAEmail);
    await page.getByTestId("input-login-password").fill(PASSWORD);
    await page.getByRole("button", { name: "Entrar agora", exact: true }).click();
    await expect(page.getByTestId("text-login-error")).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/login/);

    // ===== L: tenant B permanece intacto =====
    await expect.poll(async () => scopedLocalKeys(tenantBPage, tenantBUid)).not.toEqual([]);
    await tenantBPage.goto("/settings?tab=account");
    await expect(tenantBPage.getByTestId("button-delete-account")).toBeVisible({ timeout: 30_000 });
    expect(await tenantBPage.evaluate(() => window.localStorage.getItem("rs:session"))).toBe(tenantBUid);

    // E o tenant B continua conseguindo autenticar do zero.
    const tenantBRelogin = await browser.newContext();
    const tenantBReloginPage = await tenantBRelogin.newPage();
    await preparePage(tenantBReloginPage, pageErrors);
    await tenantBReloginPage.goto("/login");
    await tenantBReloginPage.getByTestId("input-login-email").fill(tenantBEmail);
    await tenantBReloginPage.getByTestId("input-login-password").fill(PASSWORD);
    await tenantBReloginPage.getByRole("button", { name: "Entrar agora", exact: true }).click();
    await tenantBReloginPage.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30_000 });
    await tenantBRelogin.close();
    await tenantBContext.close();

    // Nenhum erro de aplicação inesperado apareceu durante o fluxo.
    const unexpectedErrors = pageErrors.filter(
      (message) => !EXPECTED_CONSOLE_NOISE.some(({ pattern }) => pattern.test(message)),
    );
    expect(unexpectedErrors, `erros inesperados na UI: ${unexpectedErrors.join(" | ")}`).toEqual([]);
  });
});
