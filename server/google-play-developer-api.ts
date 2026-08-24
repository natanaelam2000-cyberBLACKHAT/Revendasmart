/**
 * RELEASE-15 — fronteira para a Google Play Developer API (subscriptionsv2.get /
 * purchases.subscriptions.acknowledge). Injetável de propósito: `RuntimeGooglePlayDeveloperApiClient` é
 * a implementação real (ADC/service account via `google-auth-library`), mas só é usada quando
 * `isGooglePlayDeveloperApiConfigured()` é true. Sem credencial configurada,
 * `createGooglePlayDeveloperApiClient()` devolve `UnconfiguredGooglePlayDeveloperApiClient`, que FALHA
 * EXPLICITAMENTE ("not configured") em vez de tentar uma chamada real — nunca finge sucesso, nunca
 * inventa dado. `server/google-play-billing.ts` (o consumidor) não precisa saber qual dos dois está
 * ativo; testes injetam um terceiro client mockado via `setGooglePlayDeveloperApiClientForTests()`.
 */
import { GoogleAuth } from "google-auth-library";
import type { GooglePlaySubscriptionPurchase, GooglePlaySubscriptionState } from "../shared/play-billing-contract";

export interface GooglePlayDeveloperApiClient {
  getSubscriptionPurchase(input: {
    readonly packageName: string;
    readonly productId: string;
    readonly purchaseToken: string;
  }): Promise<GooglePlaySubscriptionPurchase>;

  acknowledgeSubscriptionPurchase(input: {
    readonly packageName: string;
    readonly productId: string;
    readonly purchaseToken: string;
  }): Promise<void>;
}

export class GooglePlayDeveloperApiNotConfiguredError extends Error {
  constructor(message = "Google Play Developer API não está configurada nesta instância (credencial de service account ausente). Nenhuma chamada real foi feita.") {
    super(message);
    this.name = "GooglePlayDeveloperApiNotConfiguredError";
  }
}

/**
 * Usado por `createGooglePlayDeveloperApiClient()` quando `isGooglePlayDeveloperApiConfigured()` é
 * false. Lança sempre, nunca silenciosamente finge sucesso — é o fail-closed estrutural exigido sem
 * credenciais (nenhuma chamada de rede é sequer tentada).
 */
class UnconfiguredGooglePlayDeveloperApiClient implements GooglePlayDeveloperApiClient {
  async getSubscriptionPurchase(): Promise<GooglePlaySubscriptionPurchase> {
    throw new GooglePlayDeveloperApiNotConfiguredError();
  }
  async acknowledgeSubscriptionPurchase(): Promise<void> {
    throw new GooglePlayDeveloperApiNotConfiguredError();
  }
}

export class GooglePlayDeveloperApiMalformedResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GooglePlayDeveloperApiMalformedResponseError";
  }
}

export class GooglePlayDeveloperApiRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GooglePlayDeveloperApiRequestError";
    this.status = status;
  }
}

const GOOGLE_ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const GOOGLE_ANDROID_PUBLISHER_BASE_URL = "https://androidpublisher.googleapis.com/androidpublisher/v3";

interface GooglePlayApiTransportRequest {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly body?: unknown;
}

interface GooglePlayApiTransportResponse {
  readonly status: number;
  readonly json: unknown;
}

interface RawGooglePlaySubscriptionLineItem {
  readonly productId?: unknown;
  readonly expiryTime?: unknown;
  readonly latestSuccessfulOrderId?: unknown;
  readonly autoRenewingPlan?: {
    readonly autoRenewEnabled?: unknown;
  } | null;
  readonly offerDetails?: {
    readonly basePlanId?: unknown;
  } | null;
}

interface RawGooglePlaySubscriptionPurchaseV2 {
  readonly subscriptionState?: unknown;
  readonly acknowledgementState?: unknown;
  readonly lineItems?: unknown;
  readonly latestOrderId?: unknown;
  readonly externalAccountIdentifiers?: {
    readonly obfuscatedExternalAccountId?: unknown;
  } | null;
}

export type GooglePlayDeveloperApiTransport = (
  request: GooglePlayApiTransportRequest,
) => Promise<GooglePlayApiTransportResponse>;

function parseServiceAccountJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("JSON deve ser um objeto");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new GooglePlayDeveloperApiNotConfiguredError(
      `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON inválido: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function createGooglePlayAuth(): GoogleAuth {
  const rawJson = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.trim() ?? "";
  if (rawJson) {
    return new GoogleAuth({
      credentials: parseServiceAccountJson(rawJson),
      scopes: [GOOGLE_ANDROID_PUBLISHER_SCOPE],
    });
  }
  return new GoogleAuth({ scopes: [GOOGLE_ANDROID_PUBLISHER_SCOPE] });
}

function isMissingCredentialMessage(message: string): boolean {
  return /default credentials|could not load.*credentials|service account|credential|json/i.test(message);
}

function extractGoogleApiErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const errorObj = (payload as { error?: unknown }).error;
  if (!errorObj || typeof errorObj !== "object") return null;
  const message = (errorObj as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message.trim() : null;
}

async function defaultGooglePlayDeveloperApiTransport(
  auth: GoogleAuth,
  request: GooglePlayApiTransportRequest,
): Promise<GooglePlayApiTransportResponse> {
  let accessToken: string | null | undefined;
  try {
    accessToken = await auth.getAccessToken();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isMissingCredentialMessage(message)) {
      throw new GooglePlayDeveloperApiNotConfiguredError(
        "Credenciais Google Play ausentes. Configure ADC no ambiente ou GOOGLE_PLAY_SERVICE_ACCOUNT_JSON.",
      );
    }
    throw new GooglePlayDeveloperApiRequestError(503, `Falha ao obter access token da Google Play Developer API: ${message}`);
  }

  if (!accessToken) {
    throw new GooglePlayDeveloperApiNotConfiguredError(
      "Credenciais Google Play ausentes. Configure ADC no ambiente ou GOOGLE_PLAY_SERVICE_ACCOUNT_JSON.",
    );
  }

  const response = await fetch(request.url, {
    method: request.method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
  });

  const rawText = await response.text();
  let parsedJson: unknown = null;
  if (rawText.trim()) {
    try {
      parsedJson = JSON.parse(rawText);
    } catch {
      throw new GooglePlayDeveloperApiMalformedResponseError("Resposta não-JSON da Google Play Developer API.");
    }
  }

  if (!response.ok) {
    const errorMessage = extractGoogleApiErrorMessage(parsedJson) ?? `HTTP ${response.status}`;
    throw new GooglePlayDeveloperApiRequestError(response.status, errorMessage);
  }

  return { status: response.status, json: parsedJson };
}

function parseGooglePlaySubscriptionState(value: unknown): GooglePlaySubscriptionState {
  if (value === "SUBSCRIPTION_STATE_UNSPECIFIED"
    || value === "SUBSCRIPTION_STATE_ACTIVE"
    || value === "SUBSCRIPTION_STATE_CANCELED"
    || value === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"
    || value === "SUBSCRIPTION_STATE_ON_HOLD"
    || value === "SUBSCRIPTION_STATE_PAUSED"
    || value === "SUBSCRIPTION_STATE_EXPIRED"
    || value === "SUBSCRIPTION_STATE_PENDING"
    || value === "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED") {
    return value;
  }
  throw new GooglePlayDeveloperApiMalformedResponseError(`subscriptionState inválido: ${String(value)}`);
}

function parseAcknowledgementState(value: unknown): "ACKNOWLEDGEMENT_STATE_PENDING" | "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED" {
  if (value === "ACKNOWLEDGEMENT_STATE_PENDING" || value === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED") {
    return value;
  }
  throw new GooglePlayDeveloperApiMalformedResponseError(`acknowledgementState inválido: ${String(value)}`);
}

function parseExpiryTimeMillis(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new GooglePlayDeveloperApiMalformedResponseError("expiryTime inválido na resposta da Google Play.");
  }
  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) {
    throw new GooglePlayDeveloperApiMalformedResponseError(`expiryTime inválido: ${value}`);
  }
  return parsedMs;
}

function pickPrimaryLineItem(lineItems: RawGooglePlaySubscriptionLineItem[]): RawGooglePlaySubscriptionLineItem {
  if (lineItems.length === 0) {
    throw new GooglePlayDeveloperApiMalformedResponseError("subscriptionsv2.get retornou lineItems vazio.");
  }
  return [...lineItems].sort((left, right) => {
    const leftExpiry = parseExpiryTimeMillis(left.expiryTime) ?? -1;
    const rightExpiry = parseExpiryTimeMillis(right.expiryTime) ?? -1;
    return rightExpiry - leftExpiry;
  })[0];
}

export function normalizeGooglePlaySubscriptionPurchase(payload: unknown): GooglePlaySubscriptionPurchase {
  if (!payload || typeof payload !== "object") {
    throw new GooglePlayDeveloperApiMalformedResponseError("Resposta da Google Play Developer API não é um objeto.");
  }
  const response = payload as RawGooglePlaySubscriptionPurchaseV2;
  const lineItems = Array.isArray(response.lineItems)
    ? response.lineItems.filter((item): item is RawGooglePlaySubscriptionLineItem => !!item && typeof item === "object")
    : [];
  const primaryLineItem = pickPrimaryLineItem(lineItems);
  if (typeof primaryLineItem.productId !== "string" || !primaryLineItem.productId.trim()) {
    throw new GooglePlayDeveloperApiMalformedResponseError("lineItems[0].productId ausente ou inválido.");
  }

  const latestOrderId = typeof primaryLineItem.latestSuccessfulOrderId === "string"
    ? primaryLineItem.latestSuccessfulOrderId
    : typeof response.latestOrderId === "string"
      ? response.latestOrderId
      : undefined;

  return {
    subscriptionState: parseGooglePlaySubscriptionState(response.subscriptionState),
    lineItemProductId: primaryLineItem.productId,
    lineItemBasePlanId: typeof primaryLineItem.offerDetails?.basePlanId === "string"
      ? primaryLineItem.offerDetails.basePlanId
      : undefined,
    expiryTimeMillis: parseExpiryTimeMillis(primaryLineItem.expiryTime),
    autoRenewing: primaryLineItem.autoRenewingPlan?.autoRenewEnabled === true,
    acknowledgementState: parseAcknowledgementState(response.acknowledgementState),
    obfuscatedExternalAccountId: typeof response.externalAccountIdentifiers?.obfuscatedExternalAccountId === "string"
      ? response.externalAccountIdentifiers.obfuscatedExternalAccountId
      : undefined,
    orderId: latestOrderId,
  };
}

class RuntimeGooglePlayDeveloperApiClient implements GooglePlayDeveloperApiClient {
  constructor(
    private readonly auth: GoogleAuth,
    private readonly transport: GooglePlayDeveloperApiTransport = (request) => defaultGooglePlayDeveloperApiTransport(auth, request),
    private readonly normalizePurchase: (payload: unknown) => GooglePlaySubscriptionPurchase = normalizeGooglePlaySubscriptionPurchase,
  ) {}

  async getSubscriptionPurchase(input: {
    readonly packageName: string;
    readonly productId: string;
    readonly purchaseToken: string;
  }): Promise<GooglePlaySubscriptionPurchase> {
    const response = await this.transport({
      method: "GET",
      url: `${GOOGLE_ANDROID_PUBLISHER_BASE_URL}/applications/${encodeURIComponent(input.packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(input.purchaseToken)}`,
    });
    return this.normalizePurchase(response.json);
  }

  async acknowledgeSubscriptionPurchase(input: {
    readonly packageName: string;
    readonly productId: string;
    readonly purchaseToken: string;
  }): Promise<void> {
    await this.transport({
      method: "POST",
      url: `${GOOGLE_ANDROID_PUBLISHER_BASE_URL}/applications/${encodeURIComponent(input.packageName)}/purchases/subscriptions/${encodeURIComponent(input.productId)}/tokens/${encodeURIComponent(input.purchaseToken)}:acknowledge`,
      body: {},
    });
  }
}

let overrideClient: GooglePlayDeveloperApiClient | null = null;

/** Só para testes — injeta um client mockado (nunca real) no lugar do adapter "not configured". */
export function setGooglePlayDeveloperApiClientForTests(client: GooglePlayDeveloperApiClient | null): void {
  overrideClient = client;
}

export function isGooglePlayDeveloperApiConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.trim()
      || process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()
      || process.env.K_SERVICE?.trim(),
  );
}

export function createGooglePlayDeveloperApiClient(): GooglePlayDeveloperApiClient {
  if (overrideClient) return overrideClient;
  // Fail-closed estrutural: sem nenhuma credencial configurada, nem tentamos montar o client real —
  // devolvemos um adapter que sempre lança, sem depender do GoogleAuth falhar na primeira chamada.
  if (!isGooglePlayDeveloperApiConfigured()) return new UnconfiguredGooglePlayDeveloperApiClient();
  return new RuntimeGooglePlayDeveloperApiClient(createGooglePlayAuth());
}
