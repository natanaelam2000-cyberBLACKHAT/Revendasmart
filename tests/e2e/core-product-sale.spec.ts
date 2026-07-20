import { expect, test } from "@playwright/test";

const hasSafeEnvironment = Boolean(
  process.env.E2E_ALLOW_MUTATIONS === "1" &&
    process.env.E2E_BASE_URL &&
    process.env.E2E_TEST_EMAIL &&
    process.env.E2E_TEST_PASSWORD,
);

const testProductName = `Produto E2E ${Date.now()}`;

test.describe("Revenda Smart core flow", () => {
  test.skip(!hasSafeEnvironment, "E2E não executado: defina E2E_ALLOW_MUTATIONS=1, E2E_BASE_URL, E2E_TEST_EMAIL e E2E_TEST_PASSWORD para um ambiente seguro de teste/emulator.");

  test("login, cria produto, registra venda e confirma Home", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("input-login-email").fill(process.env.E2E_TEST_EMAIL!);
    await page.getByTestId("input-login-password").fill(process.env.E2E_TEST_PASSWORD!);
    await page.getByTestId("button-login-submit").or(page.getByRole("button", { name: /entrar/i })).click();
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 20_000 });
    await page.goto("/add-product");
    await page.getByTestId("input-product-name").fill(testProductName);
    await page.getByTestId("input-category").fill("Teste E2E");
    await page.getByLabel(/preço de custo/i).fill("10");
    await page.getByLabel(/preço de venda/i).fill("20");
    await page.getByLabel(/estoque/i).fill("3");
    await page.getByTestId("button-save-product").click();
    await page.goto("/products");
    await expect(page.getByText(testProductName)).toBeVisible({ timeout: 20_000 });
    await page.goto("/sell");
    await page.getByText(testProductName).click();
    await page.getByTestId("button-payment-cash").click();
    await page.getByTestId("button-finalize-sale").click();
    await page.goto("/");
    await expect(page.getByText(/faturamento do mês/i)).toBeVisible();
  });
});
