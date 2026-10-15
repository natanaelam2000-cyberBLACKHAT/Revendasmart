/**
 * RC-P0-SECURITY-02A — operator verification script for rotated Mercado Pago credentials.
 *
 * SAFETY CONTRACT:
 * - Never reads or prints any env var VALUE — only presence (YES/NO).
 * - Default mode is a pure config/presence check — makes ZERO network calls.
 * - --provider-check adds exactly ONE real network call: GET https://api.mercadopago.com/users/me
 *   with the central access token as a Bearer header. This is Mercado Pago's own official
 *   "who am I" identity endpoint (the same one server/mercadopago-connections.ts already calls in
 *   production, fetchMPAccountInfo()) — read-only, no side effects, cannot create a charge/PIX/
 *   subscription/payment, cannot modify a webhook, cannot revoke anything. Only the HTTP status
 *   and a boolean "looks like an authenticated account" signal are printed — never the response
 *   body (which can carry the account owner's email/name).
 * - Exits non-zero on any FAIL so it's safe to use as a pass/fail gate in a shell script.
 *
 * Usage:
 *   npx tsx script/security-verify-mercadopago.ts
 *   npx tsx script/security-verify-mercadopago.ts --provider-check
 */
const PROVIDER_CHECK = process.argv.includes("--provider-check");

function reportEnvPresence(): Record<string, boolean> {
  const required = [
    "MERCADOPAGO_ACCESS_TOKEN",
    "MERCADOPAGO_CLIENT_ID",
    "MERCADOPAGO_CLIENT_SECRET",
    "MERCADOPAGO_TOKEN_ENCRYPTION_KEY",
  ];
  const presence: Record<string, boolean> = {};
  for (const name of required) {
    presence[name] = Boolean(process.env[name]?.trim());
    console.log(`  ${name}: ${presence[name] ? "present" : "MISSING"}`);
  }
  return presence;
}

async function runProviderCheck(): Promise<"PASS" | "FAIL"> {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    console.log("MP_PROVIDER_READ_ONLY_CHECK_AVAILABLE = NO (MERCADOPAGO_ACCESS_TOKEN not set)");
    return "FAIL";
  }
  try {
    // Mirrors server/mercadopago-connections.ts's own fetchMPAccountInfo() call exactly — the
    // real, documented, read-only Mercado Pago identity endpoint. No payment/PIX/subscription/
    // webhook endpoint is ever called by this script.
    const resp = await fetch("https://api.mercadopago.com/users/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // Deliberately never read/print resp.json() — it can carry the account owner's email/name.
    // The HTTP status alone is enough to prove the token authenticates.
    console.log(`MP_PROVIDER_READ_ONLY_CHECK_AVAILABLE = YES`);
    console.log(`MP_ACCESS_TOKEN_RUNTIME_VERIFIED = ${resp.ok ? "PASS" : "FAIL"} (HTTP ${resp.status})`);
    return resp.ok ? "PASS" : "FAIL";
  } catch (error) {
    console.error("[MP_PROVIDER_CHECK] network error (message only, no credential material):", error instanceof Error ? error.message : String(error));
    return "FAIL";
  }
}

async function main() {
  console.log("== Mercado Pago credential verification ==");
  console.log("(env var VALUES are never read or printed by this script — presence only)\n");

  const presence = reportEnvPresence();
  console.log(`\nMP_ACCESS_TOKEN_PRESENT = ${presence.MERCADOPAGO_ACCESS_TOKEN ? "YES" : "NO"}`);
  console.log(`MP_CLIENT_ID_PRESENT = ${presence.MERCADOPAGO_CLIENT_ID ? "YES" : "NO"}`);
  console.log(`MP_CLIENT_SECRET_PRESENT = ${presence.MERCADOPAGO_CLIENT_SECRET ? "YES" : "NO"}`);
  console.log(`MP_TOKEN_ENCRYPTION_KEY_PRESENT = ${presence.MERCADOPAGO_TOKEN_ENCRYPTION_KEY ? "YES" : "NO"}`);

  if (!PROVIDER_CHECK) {
    console.log("\n(--provider-check not passed: no network call was made — config presence only)");
    if (!Object.values(presence).every(Boolean)) process.exitCode = 1;
    return;
  }

  const result = await runProviderCheck();
  if (result !== "PASS" || !Object.values(presence).every(Boolean)) process.exitCode = 1;
}

main();
