import { expect, test, type Page } from "@playwright/test";

const emulatorMode = process.env.E2E_EMULATOR === "1";
const PASSWORD = "LocalTestPassword!123";
const ANALYTICS_EMULATOR_NOISE = /config-fetch-failed|API key not valid|analytics/i;

const EXPECTED_CONSOLE_NOISE: Array<{ pattern: RegExp; why: string }> = [
  { pattern: ANALYTICS_EMULATOR_NOISE, why: "Analytics não funciona com a apiKey de fachada do emulador" },
  { pattern: /Failed to load resource: the server responded with a status of 400/, why: "400 esperado do Analytics em ambiente emulado" },
];

function uniqueEmail(label: string): string {
  return `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

async function preparePage(page: Page, collected: string[]): Promise<void> {
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
    if (message.type() === "error") collected.push(message.text());
  });
}

async function signUp(page: Page, email: string, storeName: string): Promise<string> {
  await page.goto("/signup");
  await page.getByPlaceholder("Ex: Maria Cosméticos").fill(storeName);
  await page.getByPlaceholder("seu@email.com").fill(email);
  await page.getByPlaceholder("Mínimo 6 caracteres").fill(PASSWORD);
  await page.getByRole("button", { name: /criar minha conta/i }).click();
  await page.waitForURL(/\/onboarding/, { timeout: 30_000 });

  await expect
    .poll(async () => page.evaluate(() => window.localStorage.getItem("rs:session")), { timeout: 20_000 })
    .toBeTruthy();
  return (await page.evaluate(() => window.localStorage.getItem("rs:session")))!;
}

async function completeOnboarding(page: Page): Promise<void> {
  const nextButton = page.getByTestId("button-concluir-onboarding");
  await expect(nextButton).toBeVisible({ timeout: 30_000 });

  for (let i = 0; i < 16; i += 1) {
    const label = (await nextButton.textContent())?.trim() ?? "";
    await nextButton.click();
    if (/meu painel/i.test(label)) break;
  }

  await page.waitForURL("/", { timeout: 30_000 });
  await expect(page.getByText(/visão geral/i)).toBeVisible({ timeout: 30_000 });
}

async function createFirstProduct(page: Page, productName: string): Promise<void> {
  await page.goto("/add-product");
  await page.getByTestId("input-product-name").fill(productName);
  await page.getByTestId("input-cost-price").fill("10");
  await page.getByTestId("input-sale-price").fill("20");
  await page.getByTestId("input-stock").fill("3");
  await page.getByTestId("button-save-product").click();
  await page.waitForURL("/products", { timeout: 30_000 });
  await expect(page.getByText(productName)).toBeVisible({ timeout: 30_000 });
}

async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("input-login-email").fill(email);
  await page.getByTestId("input-login-password").fill(PASSWORD);
  await page.getByRole("button", { name: /entrar agora|entrar/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30_000 });
}

test.describe("Primeira execução V1 — signup, onboarding, logout e relogin", () => {
  test.skip(!emulatorMode, "Este E2E requer o ambiente emulado: use npm run test:e2e:auth-first-run.");

  test("novo usuário conclui onboarding, cria produto, faz logout real e reloga no tenant correto", async ({ page }) => {
    const pageErrors: string[] = [];
    await preparePage(page, pageErrors);

    const email = uniqueEmail("auth-first-run");
    const storeName = "Loja E2E Primeira Execução";
    const productName = `Produto E2E ${Date.now()}`;

    const uid = await signUp(page, email, storeName);
    expect(uid).toBeTruthy();

    await completeOnboarding(page);
    await createFirstProduct(page, productName);

    await page.goto("/settings?tab=account");
    await page.getByText(/^Sair$/).click();
    await page.waitForURL(/\/login/, { timeout: 30_000 });

    await page.goto("/");
    await page.waitForURL(/\/login/, { timeout: 30_000 });

    await login(page, email);
    await expect(page).not.toHaveURL(/\/onboarding/);

    await page.goto("/products");
    await expect(page.getByText(productName)).toBeVisible({ timeout: 30_000 });

    const currentSession = await page.evaluate(() => window.localStorage.getItem("rs:session"));
    expect(currentSession).toBe(uid);

    const unexpectedErrors = pageErrors.filter(
      (message) => !EXPECTED_CONSOLE_NOISE.some(({ pattern }) => pattern.test(message)),
    );
    expect(unexpectedErrors, `erros inesperados na UI: ${unexpectedErrors.join(" | ")}`).toEqual([]);
  });
});
