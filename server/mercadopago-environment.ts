export type MercadoPagoEnvironment = "production" | "sandbox";

export type MercadoPagoCredentialValidation =
  | { ok: true; environment: MercadoPagoEnvironment; mode: "empty" | "sandbox" | "production" | "unknown" }
  | { ok: false; environment: MercadoPagoEnvironment; code: "PRODUCTION_TOKEN_IN_SANDBOX" | "SANDBOX_TOKEN_IN_PRODUCTION" | "UNKNOWN_SANDBOX_TOKEN" };

export function normalizeMercadoPagoEnvironment(value: string | undefined | null): MercadoPagoEnvironment {
  return String(value ?? "production").trim().toLowerCase() === "sandbox" ? "sandbox" : "production";
}

export function isMercadoPagoSandboxAccessToken(token: string | undefined | null): boolean {
  return /^TEST-/i.test(String(token ?? "").trim());
}

export function isMercadoPagoProductionAccessToken(token: string | undefined | null): boolean {
  return /^APP_USR-/i.test(String(token ?? "").trim());
}

export function validateMercadoPagoAccessTokenForEnvironment(
  token: string | undefined | null,
  environmentValue: string | undefined | null,
): MercadoPagoCredentialValidation {
  const environment = normalizeMercadoPagoEnvironment(environmentValue);
  const normalizedToken = String(token ?? "").trim();

  if (!normalizedToken) return { ok: true, environment, mode: "empty" };

  if (environment === "sandbox") {
    if (isMercadoPagoProductionAccessToken(normalizedToken)) {
      return { ok: false, environment, code: "PRODUCTION_TOKEN_IN_SANDBOX" };
    }
    if (!isMercadoPagoSandboxAccessToken(normalizedToken)) {
      return { ok: false, environment, code: "UNKNOWN_SANDBOX_TOKEN" };
    }
    return { ok: true, environment, mode: "sandbox" };
  }

  if (isMercadoPagoSandboxAccessToken(normalizedToken)) {
    return { ok: false, environment, code: "SANDBOX_TOKEN_IN_PRODUCTION" };
  }

  return {
    ok: true,
    environment,
    mode: isMercadoPagoProductionAccessToken(normalizedToken) ? "production" : "unknown",
  };
}

export function maskMercadoPagoExternalId(value: string | number | undefined | null): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.length <= 8) return "[redacted]";
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}
