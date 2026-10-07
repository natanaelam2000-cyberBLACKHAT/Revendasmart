import { expect, test } from "@playwright/test";
import { isolateEmulatorObservability } from "./auth-emulator-observability";

const PASSWORD = "AuthFinalLocal!123";
const project = "demo-revendasmart";
test.skip(process.env.E2E_EMULATOR !== "1", "Requires the isolated local Firebase emulators.");

test("verification, private recovery, persistent session and logout use real Firebase Auth", async ({ page, request }) => {
  await isolateEmulatorObservability(page);
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const remove = () => document.querySelectorAll("vite-error-overlay").forEach(node => node.remove());
    document.addEventListener("DOMContentLoaded", () => {
      remove(); new MutationObserver(remove).observe(document.documentElement, { childList: true, subtree: true });
    }, { once: true });
  });
  const email = `auth-final-${Date.now()}@example.test`;
  await page.goto("/signup");
  await page.getByPlaceholder("Ex: Maria Cosméticos").fill("Auth Final");
  await page.getByPlaceholder("seu@email.com").fill(email);
  await page.getByPlaceholder("Mínimo 6 caracteres").fill(PASSWORD);
  await page.getByRole("button", { name: /criar minha conta/i }).click();
  await page.waitForURL(/\/onboarding/);
  const uid = await page.evaluate(() => localStorage.getItem("rs:session"));
  expect(uid).toBeTruthy();
  await page.goto("/settings?tab=account");
  const security = page.getByRole("region", { name: "Segurança da conta" });
  await expect(security).toBeVisible();
  await expect(security.getByText("Seu e-mail ainda não foi verificado.", { exact: true })).toBeVisible();
  const outbox = await request.get(`http://127.0.0.1:9099/emulator/v1/projects/${project}/oobCodes`);
  const codes = (await outbox.json()).oobCodes;
  const verification = codes.find((code: { email: string; requestType: string }) => code.email === email && code.requestType === "VERIFY_EMAIL");
  expect(verification).toBeTruthy();
  const verified = await request.post("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-api-key", { data: { oobCode: verification.oobCode } });
  expect(verified.ok()).toBeTruthy();
  await security.getByRole("button", { name: "Já verifiquei meu e-mail" }).click();
  await expect(security.getByText("E-mail verificado", { exact: true })).toBeVisible();
  await page.reload();
  await expect(security.getByText("E-mail verificado", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("rs:session"))).toBe(uid);
  await page.goto("/settings");
  await page.getByText(/^Sair$/).click();
  await page.waitForURL(/\/login/);
  await page.goto("/settings");
  await page.waitForURL(/\/login/);

  await page.getByTestId("input-login-email").fill(email);
  await page.getByTestId("button-forgot-password").click();
  const knownMessage = await page.getByTestId("text-login-success").textContent();
  await page.getByTestId("input-login-email").fill(`missing-${Date.now()}@example.test`);
  await page.getByTestId("button-forgot-password").click();
  await expect(page.getByTestId("text-login-success")).toHaveText(knownMessage!);
  await page.getByTestId("input-login-email").fill(email);
  await page.getByTestId("input-login-password").fill("wrong-password");
  await page.getByRole("button", { name: "Entrar agora", exact: true }).click();
  await expect(page.getByTestId("text-login-error")).toContainText("E-mail ou senha incorretos");
  await page.getByTestId("input-login-password").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar agora", exact: true }).click();
  await page.waitForURL(url => !url.pathname.includes("/login"));
  await page.goto("/settings?tab=account");
  await expect(security.getByText("E-mail verificado", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("rs:session"))).toBe(uid);
  expect(pageErrors.filter(message => !/config-fetch-failed|API key not valid|analytics/i.test(message))).toEqual([]);
});
