/**
 * RELEASE-07/07B — fronteira client-side do Google Play Billing (Android). Detecção de plataforma,
 * orquestração do fluxo de compra/restore/recovery via `google-play-billing-client.ts` (o adapter
 * único do plugin nativo), e os clients de `/api/billing/google-play/{verify,restore}`.
 */
import { getApiUrl } from "@/lib/api-config";
import { PLAY_BILLING_PACKAGE_NAME, PLAY_BILLING_PRODUCT_IDS, getPlayBillingCatalogEntry, type PlayBillingProductId, type PlayBillingPlan, type PlayBillingCycle } from "@shared/play-billing-contract";
import {
  createGooglePlayBillingClient,
  PlayBillingClientError,
  type PlayBillingProductOffer,
  type PlayBillingPurchase,
} from "@/lib/google-play-billing-client";

export { PLAY_BILLING_PACKAGE_NAME, PLAY_BILLING_PRODUCT_IDS };
export type { PlayBillingProductId, PlayBillingProductOffer };

export async function isAndroidNativeApp(): Promise<boolean> {
  const { Capacitor } = await import("@capacitor/core");
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export function getPlayBillingProduct(plan: PlayBillingPlan, cycle: PlayBillingCycle) {
  return { ...getPlayBillingCatalogEntry(plan, cycle), plan, billingCycle: cycle } as const;
}

export interface GooglePlayVerifyResult {
  readonly premiumActive: boolean;
  readonly currentPlan: "free" | "pro" | "premium";
  readonly billingCycle: PlayBillingCycle | null;
  readonly premiumExpiresAt: string | null;
  readonly autoRenew: boolean;
  readonly deduplicated: boolean;
}

export class PlayBillingError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "PlayBillingError";
    this.code = code;
  }
}

const PLAY_ACCOUNT_TOKEN_NAMESPACE = "revendasmart-google-play-account";

async function sha256Hex(input: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new PlayBillingError("CRYPTO_UNAVAILABLE");
  }
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * RELEASE-30: mesma derivação de `hashGooglePlayAccountUid` em server/google-play-billing.ts. Gerado
 * client-side e enviado à Play como `appAccountToken` no momento da compra — a Play devolve esse valor
 * na resposta autoritativa da Developer API, o que deixa o servidor recomputar e comparar contra o uid
 * já autenticado, sem nunca precisar confiar num uid vindo do client.
 */
export async function buildGooglePlayAccountToken(firebaseUid: string): Promise<string> {
  const normalizedUid = firebaseUid.trim();
  if (!normalizedUid) {
    throw new PlayBillingError("INVALID_FIREBASE_UID");
  }
  return sha256Hex(`${PLAY_ACCOUNT_TOKEN_NAMESPACE}:${normalizedUid}`);
}

/** Nunca chamado com "purchase successful" vindo só do client — o servidor reverifica tudo contra a
 * Google Play Developer API antes de conceder Premium (`server/google-play-billing.ts`). */
export async function verifyGooglePlayPurchase(input: {
  readonly productId: PlayBillingProductId;
  readonly basePlanId: string;
  readonly purchaseToken: string;
  readonly token: string;
}): Promise<GooglePlayVerifyResult> {
  const response = await fetch(getApiUrl("/api/billing/google-play/verify"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.token}` },
    body: JSON.stringify({ productId: input.productId, basePlanId: input.basePlanId, purchaseToken: input.purchaseToken, packageName: PLAY_BILLING_PACKAGE_NAME }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new PlayBillingError(body?.error || `HTTP_${response.status}`);
  }
  return body as GooglePlayVerifyResult;
}

/** Usado em reinstalação/troca de device/limpeza de dados: reenvia todas as compras que o Play Billing
 * Library reportar via `queryPurchases()` no device atual, sem depender de nenhum estado local salvo. */
export async function restoreGooglePlayPurchases(input: {
  readonly purchases: ReadonlyArray<{ readonly productId: PlayBillingProductId; readonly basePlanId: string; readonly purchaseToken: string }>;
  readonly token: string;
}): Promise<ReadonlyArray<{ readonly status: number } & Partial<GooglePlayVerifyResult>>> {
  const response = await fetch(getApiUrl("/api/billing/google-play/restore"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.token}` },
    body: JSON.stringify({
      purchases: input.purchases.map((p) => ({ productId: p.productId, basePlanId: p.basePlanId, purchaseToken: p.purchaseToken, packageName: PLAY_BILLING_PACKAGE_NAME })),
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new PlayBillingError(body?.error || `HTTP_${response.status}`);
  }
  return body.results;
}

/** Produtos + preço localizado direto da Play — nunca um valor fixo do backend. Lista vazia quando
 * billing está indisponível OU quando a Play ainda não tem produtos reais cadastrados (PLAY_CONSOLE_PENDING). */
export async function getAndroidPremiumOffers(): Promise<PlayBillingProductOffer[]> {
  return (await getAndroidPlayOffers()).filter((offer) => offer.plan === "premium");
}

export async function getAndroidPlayOffers(): Promise<PlayBillingProductOffer[]> {
  const client = createGooglePlayBillingClient();
  const available = await client.isAvailable().catch(() => false);
  if (!available) return [];
  try {
    return await client.getProducts();
  } catch {
    return [];
  }
}

export type PlayPurchaseFlowResult =
  | { readonly kind: "activated"; readonly premiumExpiresAt: string | null }
  | { readonly kind: "pending" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "product_unavailable" }
  | { readonly kind: "error"; readonly message: string };

/**
 * Fluxo obrigatório (§6): compra nativa → purchaseToken → POST /verify → backend decide → refetch.
 * NUNCA `purchase local success → setPremium(true)`: mesmo quando o purchaseState já é "purchased",
 * o retorno "activated" só acontece se o servidor confirmar `premiumActive === true`.
 */
export async function purchasePremiumViaGooglePlay(input: {
  readonly interval: "monthly" | "yearly";
  readonly token: string;
  readonly firebaseUid: string;
}): Promise<PlayPurchaseFlowResult> {
  return purchasePlanViaGooglePlay({ ...input, plan: "premium" });
}

export async function purchasePlanViaGooglePlay(input: {
  readonly plan: PlayBillingPlan;
  readonly interval: "monthly" | "yearly";
  readonly token: string;
  readonly firebaseUid: string;
}): Promise<PlayPurchaseFlowResult> {
  const client = createGooglePlayBillingClient();
  const available = await client.isAvailable().catch(() => false);
  if (!available) return { kind: "error", message: "Google Play Billing indisponível neste dispositivo." };

  const cycle: PlayBillingCycle = input.interval === "yearly" ? "annual" : "monthly";
  const catalogEntry = getPlayBillingProduct(input.plan, cycle);
  const appAccountToken = await buildGooglePlayAccountToken(input.firebaseUid);
  let purchase: PlayBillingPurchase;
  try {
    purchase = await client.purchase(catalogEntry.productId, catalogEntry.basePlanId, appAccountToken);
  } catch (err) {
    if (err instanceof PlayBillingClientError) {
      if (err.code === "PURCHASE_CANCELLED") return { kind: "cancelled" };
      if (err.code === "PRODUCT_UNAVAILABLE") return { kind: "product_unavailable" };
      return { kind: "error", message: err.message };
    }
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }

  try {
    const result = await verifyGooglePlayPurchase({ productId: purchase.productId, basePlanId: purchase.basePlanId, purchaseToken: purchase.purchaseToken, token: input.token });
    // §7: mesmo com purchaseState "purchased" no device, o servidor é quem decide — pending/expirado
    // no lado do Google (ex.: pagamento em processamento) nunca ativa Premium aqui.
    if (!result.premiumActive) return { kind: "pending" };
    return { kind: "activated", premiumExpiresAt: result.premiumExpiresAt };
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * §9 process-kill/resume recovery: abrir/retomar o app reconsulta as compras correntes do device e
 * revalida cada uma contra o servidor — cobre "compra aprovada + app morto antes do /verify" sem
 * exigir uma nova compra. Melhor esforço: falhas silenciosas aqui não bloqueiam a UI, a próxima
 * abertura do app tenta de novo.
 */
export async function recoverPendingGooglePlayPurchases(token: string, firebaseUid: string): Promise<void> {
  const client = createGooglePlayBillingClient();
  const available = await client.isAvailable().catch(() => false);
  if (!available) return;
  const appAccountToken = await buildGooglePlayAccountToken(firebaseUid);
  let purchases: PlayBillingPurchase[];
  try {
    purchases = await client.getCurrentPurchases(appAccountToken);
  } catch {
    return;
  }
  for (const purchase of purchases) {
    try {
      await verifyGooglePlayPurchase({ productId: purchase.productId, basePlanId: purchase.basePlanId, purchaseToken: purchase.purchaseToken, token });
    } catch {
      /* melhor esforço — a próxima abertura do app tenta de novo */
    }
  }
}

/** §10 restore: idempotente (o backend já dedupe por hash do token) — pode ser chamado quantas vezes
 * o usuário quiser sem duplicar entitlement nem quota. */
export async function restoreAndroidPurchases(
  token: string,
  firebaseUid: string,
): Promise<ReadonlyArray<{ readonly status: number } & Partial<GooglePlayVerifyResult>>> {
  const client = createGooglePlayBillingClient();
  const appAccountToken = await buildGooglePlayAccountToken(firebaseUid);
  const purchases = await client.restorePurchases(appAccountToken);
  if (purchases.length === 0) return [];
  return restoreGooglePlayPurchases({
    purchases: purchases.map((p) => ({ productId: p.productId, basePlanId: p.basePlanId, purchaseToken: p.purchaseToken })),
    token,
  });
}

/** Cancelamento no Android nunca é local: sempre a tela nativa de gestão de assinatura da Play — o
 * entitlement continua até o período pago expirar, decidido só pelo servidor via reverificação/RTDN. */
export async function openAndroidSubscriptionManagement(): Promise<void> {
  const client = createGooglePlayBillingClient();
  await client.manageSubscriptions();
}
