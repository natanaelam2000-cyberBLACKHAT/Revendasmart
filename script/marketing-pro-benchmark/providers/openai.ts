/**
 * Adapter OpenAI GPT Image — PRO-06B1 / hardening PRO-06B1.1.
 *
 * Modelo: gpt-image-2 — consultado em https://developers.openai.com/api/docs/models/gpt-image-2 em
 * 2026-08-15. O TAMANHO 1024x1280 (exatamente 4:5) é explicitamente documentado como aceito: "gpt-image-2
 * accepts any resolution in the size parameter when it satisfies the constraints" — múltiplo de 16px,
 * razão longo:curto <= 3:1, total de pixels entre 655.360 e 8.294.400. 1024x1280 cumpre as três regras
 * (1280 é múltiplo de 16; razão 1,25:1; 1.310.720 pixels). Não é uma suposição — é o comportamento
 * documentado da própria API para tamanho customizado.
 *
 * O que NÃO é documentado é o PREÇO exato para esse tamanho custom (só os 3 "popular sizes" têm preço
 * publicado) — por isso o custo usado aqui vem de pricing.ts com `confidence: "estimated"`, nunca
 * tratado como preço garantido.
 *
 * ATENÇÃO — VERIFICAR NO SMOKE (1 chamada, ver §10/§18): se a API rejeitar `size: "1024x1280"` na
 * prática (apesar de documentado), a falha deve ser registrada e este provider PARA — nenhum retry
 * pago automático tentando outro tamanho (§2/§11).
 */

import { MARKETING_PRO_BENCHMARK_PROVIDER_COST } from "../pricing";
import type { GenerateBenchmarkBackgroundInput, GenerateBenchmarkBackgroundResult, MarketingProBenchmarkProviderAdapter } from "../types";

const MODEL_ID = "gpt-image-2";
const ENDPOINT = "https://api.openai.com/v1/images/generations";
const COST = MARKETING_PRO_BENCHMARK_PROVIDER_COST.openai;

async function callOpenAi(input: GenerateBenchmarkBackgroundInput): Promise<GenerateBenchmarkBackgroundResult> {
  const started = Date.now();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { success: false, durationMs: 0, estimatedRequestCostUsd: 0, conservativeMaxRequestCostUsd: 0, actualBilledCostUsd: null, errorCode: "MISSING_CREDENTIAL", errorMessageSafe: "OPENAI_API_KEY não configurada", potentiallyBilled: false };
  }
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL_ID,
        prompt: input.promptText,
        size: `${input.requestedWidth}x${input.requestedHeight}`,
        quality: "medium",
        n: 1,
      }),
    });
    const durationMs = Date.now() - started;
    if (!response.ok) {
      return { success: false, durationMs, estimatedRequestCostUsd: 0, conservativeMaxRequestCostUsd: 0, actualBilledCostUsd: null, errorCode: `HTTP_${response.status}`, errorMessageSafe: `OpenAI respondeu HTTP ${response.status} (tamanho pedido: ${input.requestedWidth}x${input.requestedHeight})`, potentiallyBilled: false };
    }
    const json = await response.json() as any;
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64 || typeof b64 !== "string") {
      // PRO-06B2.2: 2xx com shape inesperado É potencialmente cobrável, mesmo mecanismo do Google —
      // mas este adapter nunca foi exercitado contra a API real, então mantemos aqui só a adição
      // mecânica exigida pelo tipo compartilhado; auditoria própria do risco de billing do OpenAI fica
      // para uma correção dedicada a este provider, fora do escopo desta correção cirúrgica do Google.
      return { success: false, durationMs, estimatedRequestCostUsd: 0, conservativeMaxRequestCostUsd: 0, actualBilledCostUsd: null, errorCode: "UNEXPECTED_RESPONSE_SHAPE", errorMessageSafe: "resposta sem b64_json no formato esperado — revisar adapter", potentiallyBilled: true };
    }
    const outputBytes = Buffer.from(b64, "base64");
    return {
      success: true,
      mimeType: "image/png",
      width: input.requestedWidth,
      height: input.requestedHeight,
      byteSize: outputBytes.byteLength,
      durationMs,
      estimatedRequestCostUsd: COST.estimatedRequestCostUsd,
      conservativeMaxRequestCostUsd: COST.conservativeMaxRequestCostUsd,
      actualBilledCostUsd: null,
      outputBytes,
      providerMetadataSafe: { model: MODEL_ID, quality: "medium", size: `${input.requestedWidth}x${input.requestedHeight}` },
    };
  } catch (error) {
    return { success: false, durationMs: Date.now() - started, estimatedRequestCostUsd: 0, conservativeMaxRequestCostUsd: 0, actualBilledCostUsd: null, errorCode: "NETWORK_ERROR", errorMessageSafe: error instanceof Error ? error.message : "erro desconhecido", potentiallyBilled: false };
  }
}

export function createOpenAiBenchmarkProvider(): MarketingProBenchmarkProviderAdapter {
  return { id: "openai", displayName: "OpenAI GPT Image 2", model: MODEL_ID, generateBenchmarkBackground: callOpenAi };
}

export function isOpenAiBenchmarkCredentialConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}
