import type { Page } from "@playwright/test";

/** Firebase does not emulate observability. Isolate only those services for the demo project. */
export async function isolateEmulatorObservability(page: Page): Promise<void> {
  page.on("requestfailed", request => {
    const url = new URL(request.url());
    console.log(`AUTH_E2E_REQUEST_FAILED ${url.origin}${url.pathname} ${request.failure()?.errorText}`);
  });
  await page.route("https://firebaseinstallations.googleapis.com/**", async route => {
    if (!route.request().url().includes("demo-revendasmart")) throw new Error("Unexpected production installation request");
    const body = route.request().postDataJSON() as { fid?: string };
    const authToken = { token: "demo-observability-only", expiresIn: "604800s" };
    await route.fulfill({ status: 200, json: route.request().url().includes("authTokens:generate") ? authToken : { fid: body.fid, refreshToken: "demo-observability-only", authToken } });
  });
  await page.route("https://firebaseremoteconfig.googleapis.com/**", async route => {
    if (!route.request().url().includes("demo-revendasmart")) throw new Error("Unexpected production Remote Config request");
    await route.fulfill({ status: 200, json: { state: "NO_CHANGE", entries: {} } });
  });
  await page.route("https://firebase.googleapis.com/**", async route => {
    if (!decodeURIComponent(route.request().url()).includes("demo-revendasmart")) throw new Error("Unexpected production Analytics config request");
    await route.fulfill({ status: 400, json: { error: { message: "API key not valid for demo Analytics" } } });
  });
  await page.route("https://www.google-analytics.com/**", route => route.fulfill({ status: 204 }));
  await page.route("https://firebaselogging-pa.googleapis.com/**", route => route.fulfill({ status: 200, json: { nextRequestWaitMillis: 86400000 } }));
  // Remote fonts/illustrations are visual dependencies, not part of the Auth assertion.
  await page.route("https://fonts.googleapis.com/**", route => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await page.route("https://images.unsplash.com/**", route => route.fulfill({ status: 200, contentType: "image/gif", body: Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64") }));
}

/** A regular user's expected admin probe is unrelated to login success or deletion authorization. */
export function isExpectedAdminProbe(url: string, message: string): boolean {
  return /\/api\/admin\/status(?:\?|$)/.test(url) && /status of 403/.test(message);
}

/** The canonical base already nests <a> in Products. Report separately; do not change that front. */
export function isKnownProductAnchorWarning(pageUrl: string, message: string): boolean {
  if (!/\/products(?:\?|$)/.test(pageUrl)) return false;
  return (message.startsWith("In HTML, %s cannot be a descendant of <%s>.") && message.includes("<a> a")) ||
    (message.startsWith("<%s> cannot contain a nested %s.") && message.endsWith("a <a>"));
}
