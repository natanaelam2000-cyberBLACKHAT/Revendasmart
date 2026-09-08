import { expect, test, type Page } from "@playwright/test";
import { initializeFirebaseAdmin } from "../../server/firebase-admin-init";
import { randomUUID } from "node:crypto";

test.skip(process.env.RC_PRICING_TEST_PROVIDER !== "true", "Requires local recording provider and Firebase emulators");
test.beforeAll(() => {
  expect(process.env.FIREBASE_PROJECT_ID).toBe("demo-revendasmart");
  expect(process.env.FIRESTORE_EMULATOR_HOST).toBe("127.0.0.1:8080");
});
const password = "LocalTestPassword!123";
const blockExternalNetwork = async (page: Page) => {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (["localhost", "127.0.0.1"].includes(url.hostname)) return route.continue();
    if (url.hostname === "firebaseinstallations.googleapis.com") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          fid: "cRCPricingLocalInstallation01",
          refreshToken: "local-refresh-token",
          authToken: { token: "local-installation-token", expiresIn: "604800s" },
        }),
      });
    }
    return route.abort();
  });
};

const captureSubscriptionCreate = async (page: Page) => {
  let captured: { request: unknown; status: number; body: string } | undefined;
  await page.route("**/api/subscriptions/create", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    captured = { request: route.request().postDataJSON(), status: response.status(), body };
    await route.fulfill({ response, body });
  });
  return () => captured;
};

for (const plan of ["pro", "premium"] as const) for (const cycle of ["monthly", "annual"] as const) {
  test(`${plan} ${cycle}: real authenticated UI, canonical payload and persisted test contract`, async ({ page }) => {
    const admin = initializeFirebaseAdmin();
    const email = `pricing-${randomUUID()}@example.test`;
    const user = await admin.auth().createUser({ email, password });
    await admin.firestore().doc(`user_settings/${user.uid}`).set({ storeName: "Pricing Test", onboarding_completed: true });
    await admin.firestore().doc(`users/${user.uid}/planData/main`).set({ currentPlan: "free", premiumActive: false, trialStatus: "expired" });
    await blockExternalNetwork(page);
    await page.goto("/login");
    await page.getByTestId("input-login-email").fill(email);
    await page.getByTestId("input-login-password").fill(password);
    await page.getByRole("button", { name: /entrar agora|entrar/i }).click();
    await page.waitForURL((url) => !url.pathname.includes("/login"));
    await page.goto("/plans");
    await expect(page.getByTestId("card-plan-free")).toContainText("R$ 0");
    await page.getByTestId(`button-cycle-${cycle}`).click();
    const expectedCents = plan === "pro" ? (cycle === "annual" ? 29900 : 2990) : (cycle === "annual" ? 49900 : 4990);
    const card = page.getByTestId(`card-plan-${plan}`);
    await expect(card).toContainText("Preço de lançamento");
    await expect(card).toContainText((expectedCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
    await expect(page.locator("body")).not.toContainText("19,90");
    await page.getByTestId(`button-subscribe-plan-${plan}`).click();
    await page.screenshot({ path: `.tmp/rc-pricing-${plan}-${cycle}.png`, fullPage: true });
    const getCreateResponse = await captureSubscriptionCreate(page);
    await page.getByTestId(`button-confirm-purchase-${plan}`).click();
    await expect.poll(() => getCreateResponse()?.status).toBe(200);
    const captured = getCreateResponse();
    expect(captured?.request).toMatchObject({ plan, billingCycle: cycle, expectedPricingVersion: "v2", expectedOfferId: "launch" });
    const result = JSON.parse(captured!.body);
    expect(result).toMatchObject({ plan, billingCycle: cycle, priceCents: expectedCents, offerId: "launch" });
    const contract = (await admin.firestore().doc(`users/${user.uid}/subscriptionContracts/${result.subscriptionId}`).get()).data();
    expect(contract).toMatchObject({ plan, billingCycle: cycle, subscribedPriceCents: expectedCents, offerId: "launch" });
  });
}

test("legacy Premium keeps access and management, no reprice CTA", async ({ page }) => {
  const admin = initializeFirebaseAdmin();
  const email = `legacy-${randomUUID()}@example.test`;
  const user = await admin.auth().createUser({ email, password });
  await admin.firestore().doc(`user_settings/${user.uid}`).set({ storeName: "Legacy Test", onboarding_completed: true });
  const ref = admin.firestore().doc(`users/${user.uid}/planData/main`);
  await ref.set({ currentPlan: "premium", premiumActive: true, premiumSource: "subscription", subscriptionStatus: "authorized", subscriptionId: "legitimate-old-sub", billingProvider: "mercado_pago", subscribedPriceCents: 1990 });
  await blockExternalNetwork(page);
  await page.goto("/login");
  await page.getByTestId("input-login-email").fill(email);
  await page.getByTestId("input-login-password").fill(password);
  await page.getByRole("button", { name: /entrar agora|entrar/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"));
  await page.goto("/plans");
  await expect(page.getByTestId("badge-current-plan-premium")).toContainText("contrato atual permanece preservado");
  await expect(page.getByTestId("button-subscribe-plan-pro")).toHaveCount(0);
  await page.getByTestId("link-manage-subscription-footer").click();
  await expect(page.getByTestId("button-show-cancel")).toBeVisible();
  await page.getByTestId("button-show-cancel").click();
  await expect(page.getByTestId("confirm-cancel-dialog")).toBeVisible();
  await page.screenshot({ path: ".tmp/rc-pricing-legacy-management.png", fullPage: true });
  expect((await ref.get()).data()?.subscribedPriceCents).toBe(1990);
  expect((await ref.get()).data()?.subscriptionStatus).toBe("authorized");
});
