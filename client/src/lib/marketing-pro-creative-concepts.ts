/**
 * PRO-12B — conecta o Creative Director local (shared/marketing-pro-creative-director.ts, PRO-12A) ao
 * fluxo real do Anúncios Pro. Este módulo só ORQUESTRA: monta os inputs reais (`ProductTruth`,
 * `ProductVisualUnderstanding`, `SellerCreativeProfile`, `CampaignCreativeIntent`) e chama
 * `buildCreativeDirection` no cliente — puro, sem I/O de rede, sem custo, sem chamada a provider de IA.
 *
 * A análise visual (Gemini ou fallback local) é decidida pelo endpoint server-only do PRO-11B
 * (`server/marketing-pro-product-understanding.ts`, não tocado aqui); este módulo nunca decide isso
 * sozinho, só consome a resposta já pronta. Se o endpoint falhar (rede, indisponibilidade), cai no
 * mesmo fallback local (`buildProductUnderstandingFallback`) que o servidor usaria — nunca bloqueia a
 * geração dos 3 conceitos por causa de um input opcional indisponível (§2 da tarefa).
 */
import { apiRequest } from "@/lib/api-client";
import { buildProductTruthFromProduct, type ProductRecordForTruth } from "@/lib/product-truth-adapter";
import { getCreativeProfile } from "@/lib/creative-profile-service";
import { buildCreativeDirection, type CreativeDirectionResult } from "@shared/marketing-pro-creative-director";
import { buildProductUnderstandingFallback } from "@shared/marketing-pro-product-understanding";
import {
  createCampaignCreativeIntent,
  type CampaignCreativeIntent,
  type MarketingCampaignIntentId,
  type ProductTruth,
  type ProductVisualUnderstanding,
  type SellerCreativeProfile,
} from "@shared/marketing-pro-creative-intelligence";

export type ProductUnderstandingSource = "gemini" | "server-fallback" | "local-fallback";

interface ProductUnderstandingApiResponse {
  readonly visualUnderstanding: ProductVisualUnderstanding;
  readonly analysisSource: "gemini" | "fallback";
}

type AuthTokenGetter = () => Promise<string | null | undefined> | string | null | undefined;

/** `fetchImpl`/`getAuthToken` seguem o mesmo seam de teste que `apiRequest` já expõe (ver
 * `client/src/lib/api-client.ts`) — em produção nunca são passados, então `apiRequest` usa o `fetch` e o
 * Firebase Auth reais do navegador. Só existem para permitir testar os 3 caminhos (gemini/fallback do
 * servidor/fallback local) sem depender de um usuário autenticado de verdade em `npm test`. */
async function resolveProductVisualUnderstanding(
  truth: ProductTruth,
  fetchImpl?: typeof fetch,
  getAuthToken?: AuthTokenGetter,
): Promise<{ readonly visualUnderstanding: ProductVisualUnderstanding; readonly source: ProductUnderstandingSource }> {
  try {
    const result = await apiRequest<ProductUnderstandingApiResponse>(
      `/api/marketing/pro/products/${encodeURIComponent(truth.productId)}/visual-understanding`,
      { method: "POST", auth: true, fetchImpl, getAuthToken },
    );
    return {
      visualUnderstanding: result.visualUnderstanding,
      source: result.analysisSource === "gemini" ? "gemini" : "server-fallback",
    };
  } catch {
    const { visualUnderstanding } = buildProductUnderstandingFallback({ truth });
    return { visualUnderstanding, source: "local-fallback" };
  }
}

async function resolveSellerProfile(getCreativeProfileImpl: () => Promise<SellerCreativeProfile | null>): Promise<SellerCreativeProfile | undefined> {
  try {
    return (await getCreativeProfileImpl()) || undefined;
  } catch {
    // Perfil indisponível -> segue sem personalização; nunca bloqueia a geração dos 3 conceitos.
    return undefined;
  }
}

export interface CreativeConceptsForProductResult {
  readonly direction: CreativeDirectionResult;
  readonly understandingSource: ProductUnderstandingSource;
  readonly visualUnderstanding: ProductVisualUnderstanding;
}

export interface BuildCreativeConceptsForProductInput {
  readonly product: ProductRecordForTruth;
  readonly campaignIntentId: MarketingCampaignIntentId;
  /** Seams de teste — nunca usados fora de `npm test`. */
  readonly fetchImpl?: typeof fetch;
  readonly getAuthToken?: AuthTokenGetter;
  readonly getCreativeProfileImpl?: () => Promise<SellerCreativeProfile | null>;
}

/** Determinístico dado o mesmo `ProductVisualUnderstanding`/`SellerCreativeProfile` resolvidos — só os
 * dois `resolve*` acima fazem I/O; `buildCreativeDirection` em si nunca chama rede nem provider. */
export async function buildCreativeConceptsForProduct(
  input: BuildCreativeConceptsForProductInput,
): Promise<CreativeConceptsForProductResult> {
  const truth = buildProductTruthFromProduct(input.product);
  const [understanding, sellerProfile] = await Promise.all([
    resolveProductVisualUnderstanding(truth, input.fetchImpl, input.getAuthToken),
    resolveSellerProfile(input.getCreativeProfileImpl || getCreativeProfile),
  ]);
  const campaignIntent: CampaignCreativeIntent = createCampaignCreativeIntent(input.campaignIntentId);
  const direction = buildCreativeDirection({
    productTruth: truth,
    productUnderstanding: understanding.visualUnderstanding,
    sellerProfile,
    campaignIntent,
  });
  return { direction, understandingSource: understanding.source, visualUnderstanding: understanding.visualUnderstanding };
}
