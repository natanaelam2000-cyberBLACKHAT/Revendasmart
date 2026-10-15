import { test, expect, type Page } from "@playwright/test";

async function mockCampaign(page: Page, deny = false) {
  const mine: number[] = [];
  await page.route("**/api/public/sorteios/recovery**", async (route) => {
    if (route.request().method() === "POST") {
      const { numbers } = route.request().postDataJSON();
      if (deny) return route.fulfill({ json: { ok: false, denyReason: "EXCEEDS_AVAILABLE_ENTRIES" } });
      mine.push(...numbers);
      return route.fulfill({ json: { ok: true, claimedNumbers: numbers } });
    }
    return route.fulfill({ json: {
      campaign: { title: "Sorteio de recuperação", description: "Escolha seus números", prizeName: "Prêmio", prizeImageUrl: null, startsAt: "2026-01-01T00:00:00Z", endsAt: "2027-01-01T00:00:00Z", numberStart: 1, numberEnd: 10 },
      claimable: true, entriesAuthorized: 3, entriesClaimed: mine.length, entriesAvailable: 3 - mine.length, myNumbers: mine,
      numbers: Array.from({ length: 10 }, (_, i) => ({ number: i + 1, status: mine.includes(i + 1) ? "claimed" : "available" })),
    } });
  });
}

test("partial confirmation, reopening, and fixed light mode on a dark device", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await mockCampaign(page);
  await page.goto("/sorteio/recovery?t=test-token");
  await expect(page.getByRole("heading", { name: "Sorteio de recuperação" })).toBeVisible();
  const lightColor = await page.getByRole("heading").evaluate(el => getComputedStyle(el).color);
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await expect(page.getByRole("heading")).toHaveCSS("color", lightColor);
  // The full-height container holding the campaign heading is the public page root.
  // Other elements (including document-level theme controls) may also set color-scheme.
  const campaignRoot = page.locator("div.min-h-screen").filter({
    has: page.getByRole("heading", { name: "Sorteio de recuperação", exact: true }),
  });
  await expect(campaignRoot).toHaveCount(1);
  await expect(campaignRoot).toHaveCSS("color-scheme", "light");
  await page.getByTestId("button-number-1").click();
  await page.getByTestId("button-confirm-numbers").click();
  await expect(page.getByText("Autorizados: 3 · Escolhidos: 1 · Restantes: 2")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Autorizados: 3 · Escolhidos: 1 · Restantes: 2")).toBeVisible();
  await expect(page.getByTestId("button-number-1")).toBeDisabled();
  await page.getByTestId("button-number-2").click();
  await page.getByTestId("button-number-3").click();
  await expect(page.getByTestId("button-number-4")).toBeDisabled();
  await page.getByTestId("button-confirm-numbers").click();
  await expect(page.getByText("Autorizados: 3 · Escolhidos: 3 · Restantes: 0")).toBeVisible();
  await expect(page.getByTestId("button-number-4")).toBeDisabled();
});

test("server limit denial remains visible after refreshing the selection", async ({ page }) => {
  await mockCampaign(page, true);
  await page.goto("/sorteio/recovery?t=test-token");
  await page.getByTestId("button-number-1").click();
  await page.getByTestId("button-confirm-numbers").click();
  await expect(page.getByRole("alert")).toContainText("quantidade restante autorizada");
  await expect(page.getByTestId("button-number-1")).toHaveAttribute("aria-pressed", "false");
});

test("missing campaign shows a readable error", async ({ page }) => {
  await page.route("**/api/public/sorteios/missing**", route => route.fulfill({ status: 404, json: { code: "CAMPAIGN_NOT_FOUND", message: "Sorteio não encontrado." } }));
  await page.goto("/sorteio/missing?t=test-token");
  await expect(page.getByText("Este sorteio não foi encontrado ou o link não é mais válido.")).toBeVisible();
});


test("configured public URL survives a local browser origin and is passed exactly to copy/share", async ({ page }) => {
  await mockCampaign(page);
  await page.goto("/sorteio/recovery?t=test-token");
  await expect(page.getByRole("heading", { name: "Sorteio de recuperação" })).toBeVisible();
  const result = await page.evaluate(async () => {
    // Exercise the real browser module and VITE_PUBLIC_APP_URL from the dedicated test server.
    const modulePath = "/src/lib/sorteios-link.ts";
    const { buildSorteioPublicUrl, copySorteioLink, shareSorteioLink } = await import(modulePath);
    const url = buildSorteioPublicUrl("/sorteio/recovery?t=test-token");
    const copies: string[] = [];
    const shares: { url: string; title: string; text: string }[] = [];
    const actions = {
      isNative: async () => true,
      nativeShare: async (request: { url: string; title: string; text: string }) => { shares.push(request); },
      copy: async (value: string) => { copies.push(value); },
    };
    await copySorteioLink(url, actions);
    const outcome = await shareSorteioLink(url, actions);
    return { url, copies, shares, outcome };
  });
  const expected = "https://sorteios.example.test/sorteio/recovery?t=test-token";
  expect(result.url).toBe(expected);
  expect(result.url).not.toContain("localhost");
  expect(result.url).not.toContain("127.0.0.1");
  expect(result.copies).toEqual([expected]);
  expect(result.shares).toEqual([{ title: "Sorteio Promocional", text: "Escolha seus números no sorteio:", url: expected }]);
  expect(result.outcome).toBe("shared");
});
