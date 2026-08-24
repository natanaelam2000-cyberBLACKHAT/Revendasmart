/**
 * RELEASE-07B — adapter único para o Google Play Billing (Android), plugin `@capgo/native-purchases`
 * (MPL-2.0, `@capacitor/core >=8.0.0`, Google Play Billing Library 8.x). Nenhuma UI importa o plugin
 * diretamente — tudo passa por este boundary, no mesmo padrão do adapter injetável server-side
 * (`server/google-play-developer-api.ts`): produção usa `NativeGooglePlayBillingClient` (dynamic
 * import, nunca carregado no bundle web), testes injetam `buildMockGooglePlayBillingClient()`.
 *
 * Plugin escolhido: `@capawesome-team/capacitor-purchases` foi avaliado primeiro (prioridade do
 * ticket), mas exige uma licença paga (Capawesome Insiders) e um registry npm privado — não é
 * instalável publicamente sem uma assinatura, o que esta tarefa não está autorizada a contratar.
 * `@capgo/native-purchases` é a alternativa livre (MPL-2.0), publicamente instalável, com API
 * equivalente (query products, purchase, getPurchases/restore, acknowledgement) e compatível com
 * Capacitor 8 + Billing Library atual.
 */
import { PLAY_BILLING_PRODUCT_IDS, PLAY_BILLING_BASE_PLAN_IDS, isKnownPlayBillingProductId, type PlayBillingProductId } from "@shared/play-billing-contract";

export type PlayBillingPurchaseState = "purchased" | "pending";

export interface PlayBillingPurchase {
  readonly productId: PlayBillingProductId;
  readonly purchaseToken: string;
  readonly orderId?: string;
  readonly purchaseState: PlayBillingPurchaseState;
  readonly isAcknowledged: boolean;
  readonly appAccountToken?: string | null;
}

export interface PlayBillingProductOffer {
  readonly productId: PlayBillingProductId;
  /** Preço já localizado/formatado pela Play — nunca um valor fixo do backend. */
  readonly formattedPrice: string;
  readonly currencyCode: string;
}

export class PlayBillingClientError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message || code);
    this.name = "PlayBillingClientError";
    this.code = code;
  }
}

export interface GooglePlayBillingClient {
  isAvailable(): Promise<boolean>;
  getPremiumProducts(): Promise<PlayBillingProductOffer[]>;
  purchase(productId: PlayBillingProductId, appAccountToken?: string): Promise<PlayBillingPurchase>;
  getCurrentPurchases(appAccountToken?: string): Promise<PlayBillingPurchase[]>;
  restorePurchases(appAccountToken?: string): Promise<PlayBillingPurchase[]>;
  /** Abre a tela nativa de gestão de assinatura da Play — é para lá que cancelamento é direcionado,
   * nunca um endpoint próprio que revoga localmente. */
  manageSubscriptions(): Promise<void>;
}

function mapPurchaseState(purchaseState: string | undefined): PlayBillingPurchaseState {
  return purchaseState === "1" ? "purchased" : "pending";
}

class NativeGooglePlayBillingClient implements GooglePlayBillingClient {
  private async loadPlugin() {
    const mod = await import("@capgo/native-purchases");
    return { NativePurchases: mod.NativePurchases, PURCHASE_TYPE: mod.PURCHASE_TYPE };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { NativePurchases } = await this.loadPlugin();
      const { isBillingSupported } = await NativePurchases.isBillingSupported();
      return isBillingSupported;
    } catch {
      return false;
    }
  }

  async getPremiumProducts(): Promise<PlayBillingProductOffer[]> {
    const { NativePurchases, PURCHASE_TYPE } = await this.loadPlugin();
    const { products } = await NativePurchases.getProducts({
      productIdentifiers: Object.values(PLAY_BILLING_PRODUCT_IDS),
      productType: PURCHASE_TYPE.SUBS,
    });
    // Nomenclatura do plugin para assinaturas Android é invertida do que se espera: `identifier` é o
    // BASE PLAN id, `planIdentifier` é o product id de verdade (`offerDetails.getBasePlanId()` vs
    // `productDetails.getProductId()`). Usar `identifier` aqui seria o bug clássico dessa integração.
    return products
      .filter((p) => isKnownPlayBillingProductId(p.planIdentifier))
      .map((p) => ({
        productId: p.planIdentifier as PlayBillingProductId,
        formattedPrice: p.priceString,
        currencyCode: p.currencyCode,
      }));
  }

  async purchase(productId: PlayBillingProductId, appAccountToken?: string): Promise<PlayBillingPurchase> {
    const { NativePurchases, PURCHASE_TYPE } = await this.loadPlugin();
    let transaction;
    try {
      transaction = await NativePurchases.purchaseProduct({
        productIdentifier: productId,
        planIdentifier: PLAY_BILLING_BASE_PLAN_IDS[productId],
        productType: PURCHASE_TYPE.SUBS,
        ...(appAccountToken ? { appAccountToken } : {}),
        // Ack automático e imediato evita o reembolso de 3 dias do Google mesmo que o /verify demore
        // ou fique temporariamente indisponível — mas o ENTITLEMENT em si nunca depende deste ack,
        // só do /verify server-side (ver server/google-play-billing.ts).
        autoAcknowledgePurchases: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/cancel/i.test(message)) {
        throw new PlayBillingClientError("PURCHASE_CANCELLED", message);
      }
      throw new PlayBillingClientError("PURCHASE_FAILED", message);
    }
    if (!transaction.purchaseToken || !transaction.productIdentifier) {
      throw new PlayBillingClientError("PURCHASE_FAILED", "Transação sem purchaseToken/productIdentifier.");
    }
    return {
      productId: transaction.productIdentifier as PlayBillingProductId,
      purchaseToken: transaction.purchaseToken,
      orderId: transaction.orderId,
      purchaseState: mapPurchaseState(transaction.purchaseState),
      isAcknowledged: Boolean(transaction.isAcknowledged),
      appAccountToken: typeof transaction.appAccountToken === "string" ? transaction.appAccountToken : null,
    };
  }

  async getCurrentPurchases(appAccountToken?: string): Promise<PlayBillingPurchase[]> {
    const { NativePurchases, PURCHASE_TYPE } = await this.loadPlugin();
    const { purchases } = await NativePurchases.getPurchases({
      productType: PURCHASE_TYPE.SUBS,
      ...(appAccountToken ? { appAccountToken } : {}),
    });
    return purchases
      .filter((t) => t.purchaseToken && isKnownPlayBillingProductId(t.productIdentifier))
      .map((t) => ({
        productId: t.productIdentifier as PlayBillingProductId,
        purchaseToken: t.purchaseToken as string,
        orderId: t.orderId,
        purchaseState: mapPurchaseState(t.purchaseState),
        isAcknowledged: Boolean(t.isAcknowledged),
        appAccountToken: typeof t.appAccountToken === "string" ? t.appAccountToken : null,
      }));
  }

  async restorePurchases(appAccountToken?: string): Promise<PlayBillingPurchase[]> {
    // A Google Play não tem um fluxo de "restore" separado como o da Apple StoreKit — getPurchases()
    // já devolve tudo que a conta Play atualmente logada possui, sem nenhuma ação nativa extra.
    return this.getCurrentPurchases(appAccountToken);
  }

  async manageSubscriptions(): Promise<void> {
    const { NativePurchases } = await this.loadPlugin();
    await NativePurchases.manageSubscriptions();
  }
}

let overrideClient: GooglePlayBillingClient | null = null;

/** Só para testes — nunca usado em runtime real. */
export function setGooglePlayBillingClientForTests(client: GooglePlayBillingClient | null): void {
  overrideClient = client;
}

export function createGooglePlayBillingClient(): GooglePlayBillingClient {
  if (overrideClient) return overrideClient;
  return new NativeGooglePlayBillingClient();
}

/**
 * §15 — mocks determinísticos para testar sem Play Console: nunca usados em runtime real
 * (`createGooglePlayBillingClient()` só devolve isto se um teste chamar `setGooglePlayBillingClientForTests`).
 */
export interface MockPlayBillingScenario {
  readonly available?: boolean;
  readonly products?: PlayBillingProductOffer[];
  readonly purchases?: PlayBillingPurchase[];
  readonly purchaseResult?: PlayBillingPurchase | PlayBillingClientError;
}

export function buildMockGooglePlayBillingClient(scenario: MockPlayBillingScenario): GooglePlayBillingClient {
  return {
    async isAvailable() {
      return scenario.available ?? true;
    },
    async getPremiumProducts() {
      return scenario.products ?? [];
    },
    async purchase(productId) {
      if (scenario.purchaseResult instanceof PlayBillingClientError) throw scenario.purchaseResult;
      if (scenario.purchaseResult) return scenario.purchaseResult;
      throw new PlayBillingClientError("PRODUCT_UNAVAILABLE", `Nenhum resultado de compra mockado para ${productId}`);
    },
    async getCurrentPurchases() {
      return scenario.purchases ?? [];
    },
    async restorePurchases() {
      return scenario.purchases ?? [];
    },
    async manageSubscriptions() {
      /* no-op no mock */
    },
  };
}
