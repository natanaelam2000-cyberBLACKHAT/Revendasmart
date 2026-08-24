import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const productionRoutingMode = process.env.E2E_PRODUCTION_ROUTING === "1";
const baseUrl = new URL(process.env.E2E_BASE_URL ?? "http://127.0.0.1:4177");

test.skip(!productionRoutingMode, "Use npm run test:production-routing para testar o bundle de produção.");
test.use({ serviceWorkers: "block" });

function expectIndexHtml(body: string): void {
  expect(body).toContain('<div id="root"></div>');
  expect(body).toContain("/assets/");
}

async function expectMarkdown(request: APIRequestContext, path: string, heading: RegExp): Promise<void> {
  const response = await request.get(path);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^text\/markdown\b/i);
  expect(await response.text()).toMatch(heading);
}

async function blockExternalRequests(page: Page): Promise<void> {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === baseUrl.origin) {
      await route.continue();
      return;
    }
    await route.abort("blockedbyclient");
  });
}

test.describe("Production bundle routing", () => {
  test("HTTP: SPA, APIs, Markdown and assets stay isolated", async ({ request }) => {
    const root = await request.get("/", { headers: { accept: "text/html" } });
    expect(root.status()).toBe(200);
    expect(root.headers()["content-type"]).toMatch(/^text\/html\b/i);
    const indexHtml = await root.text();
    expectIndexHtml(indexHtml);

    for (const path of ["/account-deletion", "/account-deletion?source=play", "/settings/profile"]) {
      const response = await request.get(path, { headers: { accept: "text/html" } });
      expect(response.status(), path).toBe(200);
      expect(response.headers()["content-type"], path).toMatch(/^text\/html\b/i);
      expectIndexHtml(await response.text());
    }

    const head = await request.head("/account-deletion", { headers: { accept: "text/html" } });
    expect(head.status()).toBe(200);
    expect(head.headers()["content-type"]).toMatch(/^text\/html\b/i);

    await expectMarkdown(request, "/privacy-policy.md", /^# Política de Privacidade — RevendaSmart/m);
    await expectMarkdown(request, "/terms-of-service.md", /^# Termos de Serviço — RevendaSmart/m);
    await expectMarkdown(request, "/api/legal/privacy-policy", /^# Política de Privacidade — RevendaSmart/m);
    await expectMarkdown(request, "/api/legal/terms-of-service", /^# Termos de Serviço — RevendaSmart/m);

    const health = await request.get("/api/health");
    expect(health.status()).toBe(200);
    expect(health.headers()["content-type"]).toMatch(/^application\/json\b/i);
    expect(await health.json()).toMatchObject({ status: "ok" });

    for (const path of ["/api/inexistente", "/api/account", "/api/billing/inexistente"]) {
      const response = await request.get(path, { headers: { accept: "text/html,application/json" } });
      expect(response.status(), path).toBe(404);
      expect(response.headers()["content-type"], path).toMatch(/^application\/json\b/i);
      expect(await response.text(), path).not.toContain('<div id="root"></div>');
    }

    for (const [method, path] of [["DELETE", "/api/account"], ["POST", "/api/billing/google-play/verify"]] as const) {
      const response = await request.fetch(path, { method, headers: { accept: "text/html,application/json" } });
      expect(response.status(), `${method} ${path}`).toBe(401);
      expect(response.headers()["content-type"], `${method} ${path}`).toMatch(/^application\/json\b/i);
      expect(await response.text(), `${method} ${path}`).not.toContain('<div id="root"></div>');
    }

    const assetPath = indexHtml.match(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/)?.[1];
    expect(assetPath, "index.html precisa referenciar ao menos um asset versionado").toBeTruthy();
    const asset = await request.get(assetPath!);
    expect(asset.status()).toBe(200);
    expect(asset.headers()["content-type"]).not.toMatch(/^text\/html\b/i);

    const missingAsset = await request.get("/assets/missing.js", { headers: { accept: "text/html" } });
    expect(missingAsset.status()).toBe(404);
    expect(await missingAsset.text()).not.toContain('<div id="root"></div>');

    const jsonNavigation = await request.get("/account-deletion", { headers: { accept: "application/json" } });
    expect(jsonNavigation.status()).toBe(404);
    expect(await jsonNavigation.text()).not.toContain('<div id="root"></div>');

    const postNavigation = await request.post("/account-deletion", { headers: { accept: "text/html" } });
    expect(postNavigation.status()).toBe(404);
    expect(await postNavigation.text()).not.toContain('<div id="root"></div>');
  });

  test("browser: account deletion renders publicly and survives direct refresh", async ({ page }) => {
    await blockExternalRequests(page);

    const response = await page.goto("/account-deletion?source=play", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Exclusão de conta e dados" })).toBeVisible();
    await expect(page.getByText("revendasmart.suporte@gmail.com")).toBeVisible();
    await expect(page.getByText("404 Page Not Found")).toHaveCount(0);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Exclusão de conta e dados" })).toBeVisible();
    await expect(page.getByText("404 Page Not Found")).toHaveCount(0);
  });

  test("browser: settings/profile is not a route alias and follows the private auth boundary", async ({ page }) => {
    await blockExternalRequests(page);

    const response = await page.goto("/settings/profile", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await page.waitForURL(/\/login$/, { timeout: 20_000 });
    await expect(page.getByText("404 Page Not Found")).toHaveCount(0);
  });
});
