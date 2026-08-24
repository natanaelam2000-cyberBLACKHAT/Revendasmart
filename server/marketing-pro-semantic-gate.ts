/**
 * PRO-09 §7 — gate SEMÂNTICO: o gate quantitativo (`marketing-pro-safe-zone-gate.ts`) prova "a zona do
 * produto está visualmente calma" (baixa variância/pouca borda), mas isso NÃO prova "não há um produto,
 * embalagem, garrafa, celular, mockup, texto, logo, marca, watermark, pessoa, mão ou rosto na imagem" —
 * um objeto plano e de baixo contraste passaria no gate quantitativo sem ser semanticamente aceitável.
 *
 * PRO-13: a inspeção semântica real é uma segunda chamada multimodal, isolada em
 * `marketing-pro-semantic-inspector-google.ts`. Ela recebe exclusivamente os bytes do background que o
 * provider acabou de gerar. Produto, cutout, ProductTruth, UID e dados comerciais não fazem parte da
 * assinatura, do prompt nem do payload dessa chamada.
 *
 * `server/marketing-pro-flags.ts` lê `MARKETING_PRO_SEMANTIC_GATE_READY` e mantém o provider real
 * DESLIGADO independentemente da env var enquanto isto for `false`. A flag continua default OFF; este
 * `true` apenas declara que existe uma implementação real fail-closed pronta para ser chamada.
 */
import {
  GeminiMarketingProSemanticInspector,
  MARKETING_PRO_SEMANTIC_MODEL,
  parseMarketingProSemanticCandidate,
  type MarketingProSemanticGateResult,
  type MarketingProSemanticInspector,
} from "./marketing-pro-semantic-inspector-google";
import { createHash } from "node:crypto";

export const MARKETING_PRO_SEMANTIC_GATE_READY = true;
export type { MarketingProSemanticGateRejectionCode, MarketingProSemanticGateResult } from "./marketing-pro-semantic-inspector-google";

/**
 * Analisa SOMENTE os bytes do background gerado (nunca o produto — `bytes` aqui vem sempre do output do
 * provider, nunca de um asset de produto). O inspetor é injetável para testes; em runtime usa Gemini.
 */
export async function evaluateMarketingProSemanticGate(
  bytes: Uint8Array,
  mimeType: string,
  inspector: MarketingProSemanticInspector = new GeminiMarketingProSemanticInspector(),
): Promise<MarketingProSemanticGateResult> {
  if (!MARKETING_PRO_SEMANTIC_GATE_READY) {
    return { accepted: false, rejectionCode: "SEMANTIC_GATE_UNAVAILABLE" };
  }
  return inspector.inspectBackground(bytes, mimeType);
}

export const MARKETING_PRO_SEMANTIC_CACHE_COLLECTION = "marketingProSemanticInspections";

interface SemanticCacheFirestoreLike {
  collection(path: string): { doc(id: string): {
    get(): Promise<{ exists: boolean; data(): unknown }>;
    set(data: Record<string, unknown>): Promise<unknown>;
  } };
}

/**
 * Cache global seguro por SHA-256 + versão do modelo. Persiste somente o veredito e metadados técnicos;
 * nunca persiste bytes/base64. O generationRequestId continua sendo a primeira defesa contra duplicata;
 * este cache evita uma nova inspeção quando backgrounds byte-a-byte idênticos reaparecem.
 */
export async function evaluateMarketingProSemanticGateCached(
  db: SemanticCacheFirestoreLike,
  bytes: Uint8Array,
  mimeType: string,
  inspector: MarketingProSemanticInspector = new GeminiMarketingProSemanticInspector(),
): Promise<MarketingProSemanticGateResult> {
  const hash = createHash("sha256").update(MARKETING_PRO_SEMANTIC_MODEL).update(bytes).digest("hex");
  const ref = db.collection(MARKETING_PRO_SEMANTIC_CACHE_COLLECTION).doc(hash);
  try {
    const snapshot = await ref.get();
    if (snapshot.exists) {
      const data = snapshot.data() as Record<string, unknown> | undefined;
      if (data?.model === MARKETING_PRO_SEMANTIC_MODEL && data?.mimeType === mimeType && data?.byteLength === bytes.byteLength) {
        const cached = parseMarketingProSemanticCandidate({ accepted: data.accepted, forbiddenElements: data.forbiddenElements, confidence: data.confidence });
        if (cached.accepted || cached.rejectionCode === "SEMANTIC_CONTENT_REJECTED") return cached;
      }
    }
  } catch {
    // Cache é só otimização: indisponibilidade nunca aprova conteúdo e nunca substitui a inspeção real.
  }
  const result = await evaluateMarketingProSemanticGate(bytes, mimeType, inspector);
  if (result.accepted || result.rejectionCode === "SEMANTIC_CONTENT_REJECTED") {
    try {
      await ref.set({
        model: MARKETING_PRO_SEMANTIC_MODEL,
        mimeType,
        byteLength: bytes.byteLength,
        accepted: result.accepted,
        forbiddenElements: result.accepted ? [] : (result.forbiddenElements || []),
        confidence: result.accepted ? result.confidence : 1,
        createdAt: new Date().toISOString(),
      });
    } catch {
      // Falha de escrita do cache não muda o veredito fail-closed já obtido.
    }
  }
  return result;
}
