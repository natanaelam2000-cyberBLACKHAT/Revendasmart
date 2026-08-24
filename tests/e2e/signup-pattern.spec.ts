import { expect, test } from "@playwright/test";

const LEGACY_INVALID_PATTERN = "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}";
const PASSWORD = "LocalTestPassword!123";

// Usa o Chrome estável já instalado; evita depender do headless shell opcional do Playwright.
test.use({ channel: "chrome", video: "off" });

test.describe("Signup — validação nativa de e-mail", () => {
  test("pattern compila no modo v e preserva a regra anterior", async ({ page }) => {
    await page.goto("/signup");
    const email = page.getByPlaceholder("seu@email.com");

    const legacyCompilation = await page.evaluate((pattern) => {
      try {
        new RegExp(pattern, "v");
        return { accepted: true, name: "" };
      } catch (error) {
        return { accepted: false, name: error instanceof Error ? error.name : "unknown" };
      }
    }, LEGACY_INVALID_PATTERN);
    expect(legacyCompilation).toEqual({ accepted: false, name: "SyntaxError" });

    const currentPattern = await email.getAttribute("pattern");
    expect(currentPattern).toBeTruthy();
    expect(await page.evaluate((pattern) => {
      try { new RegExp(pattern!, "v"); return true; } catch { return false; }
    }, currentPattern)).toBe(true);

    await email.fill("user@example.com");
    expect(await email.evaluate((input: HTMLInputElement) => ({
      valid: input.validity.valid,
      patternMismatch: input.validity.patternMismatch,
      message: input.validationMessage,
    }))).toEqual({ valid: true, patternMismatch: false, message: "" });

    await email.fill("user@example");
    const invalidState = await email.evaluate((input: HTMLInputElement) => ({
      valid: input.validity.valid,
      typeMismatch: input.validity.typeMismatch,
      patternMismatch: input.validity.patternMismatch,
      message: input.validationMessage,
    }));
    expect(invalidState.valid).toBe(false);
    expect(invalidState.typeMismatch).toBe(false);
    expect(invalidState.patternMismatch).toBe(true);
    expect(invalidState.message).not.toBe("");

    await page.getByPlaceholder(/Maria Cosméticos/i).fill("Loja Pattern Test");
    await page.getByPlaceholder(/Mínimo 6 caracteres/i).fill(PASSWORD);
    await page.getByRole("button", { name: /criar minha conta/i }).click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(email).toBeFocused();
  });

  test("submit válido continua criando conta e login continua funcionando", async ({ page }) => {
    test.skip(process.env.E2E_EMULATOR !== "1", "Requer Firebase Auth Emulator.");
    const email = `e2e-signup-pattern-${Date.now()}@example.test`;
    await page.goto("/signup");
    await page.getByPlaceholder(/Maria Cosméticos/i).fill("Loja Pattern Submit");
    await page.getByPlaceholder("seu@email.com").fill(email);
    await page.getByPlaceholder(/Mínimo 6 caracteres/i).fill(PASSWORD);
    await page.getByRole("button", { name: /criar minha conta/i }).click();
    await page.waitForURL((url) => !url.pathname.includes("/signup"), { timeout: 30_000 });

    await page.goto("/login");
    await page.getByPlaceholder("E-mail").fill(email);
    await page.getByPlaceholder("Senha").fill(PASSWORD);
    await page.getByRole("button", { name: /entrar agora/i }).click();
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30_000 });
  });
});
