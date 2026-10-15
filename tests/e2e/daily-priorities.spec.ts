import { expect, test } from "@playwright/test";
import { initializeFirebaseAdmin } from "../../server/firebase-admin-init";
import { buildOpportunityMessage, buildWhatsAppUrl } from "../../client/src/lib/opportunity-messages";

test("daily priorities reuse ranking, commercial actions and lifecycle at 375px", async ({ page, context }) => {
  test.setTimeout(120_000);
  expect(process.env.FIRESTORE_EMULATOR_HOST).toBe("127.0.0.1:8080");
  process.env.FIREBASE_PROJECT_ID = "demo-revendasmart";
  const admin = initializeFirebaseAdmin();
  const db = admin.firestore();
  const email = `daily-${Date.now()}@example.test`;
  const { uid } = await admin.auth().createUser({ email, password: "LocalTestPassword!123" });
  const owner = db.collection("users").doc(uid);
  await db.collection("user_settings").doc(uid).set({ userId: uid, storeName: "Loja Prioridades QA", onboarding_completed: true, businessType: "products", businessTypes: ["products"] });
  await owner.collection("planData").doc("main").set({ currentPlan: "premium", premiumActive: true, premiumExpiresAt: null, premiumSource: "manual", premiumStartedAt: new Date().toISOString() });
  for (const [id, days] of [["one", 150], ["two", 140], ["three", 130]] as const) {
    await owner.collection("clients").doc(id).set({ id, name: `Cliente Diário ${id}`, phone: "11987654321", lastPurchaseAt: new Date(Date.now()-days*86400000).toISOString() });
  }
  await owner.collection("products").doc("stalled").set({ id: "stalled", name: "Produto Diário", stock: 8, price: 10, costPrice: 5, lastSoldDate: new Date(Date.now()-90*86400000).toISOString() });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  // Analytics has no real apiKey in demo mode; only its dev overlay is hidden.
  await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style"); style.textContent = "vite-error-overlay { display:none !important }"; document.head.append(style);
  }));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // Validate the WhatsApp URL without sending a message or leaving the local QA environment.
  await context.route("https://wa.me/**", route => route.fulfill({ body: "WhatsApp URL verified by local test", contentType: "text/plain" }));
  await page.setViewportSize({ width: 375, height: 812 });
  let initialReads = 0;
  page.on("request", request => { if (request.url().endsWith("/api/opportunities") && request.method() === "GET") initialReads++; });
  const responsePromise = page.waitForResponse(response => response.url().endsWith("/api/opportunities") && response.status() === 200);
  await page.goto("/login");
  await page.getByRole("textbox", { name: "E-mail", exact: true }).fill(email);
  await page.locator('input[type="password"]').fill("LocalTestPassword!123");
  await page.getByRole("button", { name: "Entrar agora", exact: true }).click();
  const authoritative = (await (await responsePromise).json()).opportunities;
  const section = page.getByTestId("today-priorities");
  const cards = section.locator('[data-testid^="card-opportunity-"]');
  await expect(cards).toHaveCount(3);
  expect(await cards.evaluateAll(elements => elements.map(element => element.getAttribute("data-testid"))))
    .toEqual(authoritative.slice(0,3).map((item: {id: string}) => `card-opportunity-${item.id}`));
  const actions = owner.collection("opportunity_actions");
  expect(initialReads).toBe(1);
  expect((await actions.get()).size).toBe(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: ".tmp/daily-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: ".tmp/daily-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });

  const first = authoritative[0];
  const firstCard = section.getByTestId(`card-opportunity-${first.id}`);
  const popupPromise = page.waitForEvent("popup");
  await firstCard.getByRole("button", { name: "Abrir WhatsApp" }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  expect(popup.url()).toBe(buildWhatsAppUrl("5511987654321", buildOpportunityMessage(first)!));
  await popup.close();
  expect(initialReads).toBe(1);
  expect((await actions.get()).size).toBe(0);
  await firstCard.getByRole("button", { name: "Copiar", exact: true }).click();
  await expect(firstCard.getByRole("button", { name: "Copiado!", exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(buildOpportunityMessage(first));
  expect(initialReads).toBe(1);
  expect((await actions.get()).size).toBe(0);
  await firstCard.getByRole("button", { name: "Marcar como feito" }).click();
  await expect(firstCard).toHaveCount(0);
  await expect(cards).toHaveCount(3);
  const acted = (await actions.doc(first.fingerprint).get()).data()!;
  expect(acted.status).toBe("acted"); expect(acted.outcome).toBeUndefined();

  await section.getByRole("button", { name: "Criar anúncio", exact: true }).click();
  await page.waitForURL(/\/edit-product\/stalled/);
  expect((await actions.get()).size).toBe(1);
  await page.goto("/");
  await expect(cards).toHaveCount(3);
  const secondId = authoritative[1].id;
  await section.getByTestId(`card-opportunity-${secondId}`).getByRole("button", { name: "Dispensar", exact: true }).click();
  await expect(section.getByTestId(`card-opportunity-${secondId}`)).toHaveCount(0);
  await section.getByRole("link", { name: "Ver todas as oportunidades" }).click();
  await page.getByTestId("tab-opportunities-history").click();
  await expect(page.getByText("Feito — aguardando resultado", { exact: true })).toBeVisible();
  await expect(page.getByText("Dispensada", { exact: true })).toBeVisible();
  await page.goto("/");
  await expect(cards).toHaveCount(2);
  for (let remaining=2; remaining>0; remaining--) {
    await section.getByRole("button", { name: "Dispensar", exact: true }).first().click();
    await expect(cards).toHaveCount(remaining-1);
  }
  await expect(page.getByTestId("today-priorities-empty")).toBeVisible();
  await page.screenshot({ path: ".tmp/daily-empty-mobile.png", fullPage: true });
  await page.reload();
  await expect(page.getByTestId("today-priorities-empty")).toBeVisible();
  expect((await actions.get()).size).toBe(4);

  await owner.collection("planData").doc("main").set({ currentPlan: "free", premiumActive: false, trialStatus: "expired", trialEndsAt: "2020-01-01T00:00:00.000Z" });
  const premiumRequests: string[] = [];
  page.on("request", request => { if (request.url().includes("/api/opportunities")) premiumRequests.push(request.url()); });
  await page.reload();
  await expect(page.getByTestId("button-dashboard-opportunities")).toBeVisible();
  await expect(section).toHaveCount(0);
  expect(premiumRequests).toEqual([]);
  await expect(page.getByText("Cliente Diário one", { exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: ".tmp/daily-free-mobile.png", fullPage: true });
  expect(errors.filter(error => !/config-fetch-failed|API key not valid|analytics/i.test(error))).toEqual([]);
});
