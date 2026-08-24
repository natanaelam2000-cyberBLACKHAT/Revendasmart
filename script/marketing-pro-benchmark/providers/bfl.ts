/**
 * Adapter Black Forest Labs FLUX.2 [pro] — PRO-06B1 / hardening PRO-06B1.1 / PRO-06B1.2.
 *
 * Modelo: FLUX.2 [pro] — consultado em https://docs.bfl.ml/quick_start/pricing e
 * https://api.bfl.ai/openapi.json em 2026-08-15. Endpoint aceita `width`/`height` em pixels
 * diretamente, então pedimos exatamente 1080x1350 (não precisa de dimensão alternativa). Autenticação
 * via header `x-key`.
 *
 * PREÇO (PRO-06B1.2): a doc oficial da BFL confirma pricing baseado em resolução e "from $0.03" para
 * este tier, mas não publica fórmula/tabela textual estável para 1080x1350 — só a calculadora
 * interativa oficial (bfl.ai/pricing) dá o número exato. Nenhuma fórmula de terceiro é usada aqui para
 * preencher essa lacuna: `COST.estimatedRequestCostUsd` (ver pricing.ts) é `null`, e
 * `COST.conservativeMaxRequestCostUsd` (US$0.05) é um teto interno de segurança, não um preço oficial.
 *
 * API é ASSÍNCRONA: o POST devolve um `id` + `polling_url`; é preciso consultar `/v1/get_result`
 * (aqui via a própria `polling_url` devolvida) até `status === "Ready"`, e então baixar a imagem pela
 * URL assinada em `result.sample`.
 *
 * ATENÇÃO — VERIFICAR NO SMOKE (1 chamada, ver §10/§18): confirmar o formato exato de `result` na
 * resposta "Ready" (campo `sample` vs outro nome) contra a API viva. Se falhar, registrar e parar este
 * provider — nenhum retry pago automático (§11).
 */

import { MARKETING_PRO_BENCHMARK_PROVIDER_COST } from "../pricing";
import type { GenerateBenchmarkBackgroundInput, GenerateBenchmarkBackgroundResult, MarketingProBenchmarkProviderAdapter } from "../types";

const MODEL_ID = "flux-2-pro";
const SUBMIT_ENDPOINT = "https://api.bfl.ai/v1/flux-2-pro";
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 60_000;
const COST = MARKETING_PRO_BENCHMARK_PROVIDER_COST.bfl;

async function pollForResult(pollingUrl: string, apiKey: string): Promise<{ ready: true; sampleUrl: string } | { ready: false; errorMessageSafe: string }> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await fetch(pollingUrl, { headers: { "x-key": apiKey } });
    if (!response.ok) return { ready: false, errorMessageSafe: `polling HTTP ${response.status}` };
    const json = await response.json() as any;
    if (json.status === "Ready" && json.result?.sample) return { ready: true, sampleUrl: json.result.sample };
    if (json.status === "Error" || json.status === "Content Moderated" || json.status === "Request Moderated") {
      return { ready: false, errorMessageSafe: `status do provider: ${json.status}` };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return { ready: false, errorMessageSafe: "timeout aguardando resultado (60s)" };
}

async function callBfl(input: GenerateBenchmarkBackgroundInput): Promise<GenerateBenchmarkBackgroundResult> {
  const started = Date.now();
  const apiKey = process.env.BFL_API_KEY;
  if (!apiKey) {
    return { success: false, durationMs: 0, estimatedRequestCostUsd: 0, conservativeMaxRequestCostUsd: 0, actualBilledCostUsd: null, errorCode: "MISSING_CREDENTIAL", errorMessageSafe: "BFL_API_KEY não configurada", potentiallyBilled: false };
  }
  try {
    const submitResponse = await fetch(SUBMIT_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-key": apiKey },
      body: JSON.stringify({ prompt: input.promptText, width: input.requestedWidth, height: input.requestedHeight, output_format: "png" }),
    });
    if (!submitResponse.ok) {
      // Submit recusado (HTTP não-2xx): nenhuma tarefa foi criada — não cobrável.
      return { success: false, durationMs: Date.now() - started, estimatedRequestCostUsd: 0, conservativeMaxRequestCostUsd: 0, actualBilledCostUsd: null, errorCode: `HTTP_${submitResponse.status}`, errorMessageSafe: `BFL respondeu HTTP ${submitResponse.status} no submit`, potentiallyBilled: false };
    }
    const submitJson = await submitResponse.json() as any;
    const pollingUrl = submitJson?.polling_url;
    if (!pollingUrl || typeof pollingUrl !== "string") {
      // PRO-06B2.2: submit voltou 2xx (a tarefa pode ter sido criada/cobrada) mas sem o campo esperado
      // — mesmo princípio do Google, não auditado a fundo para BFL (fora do escopo desta correção).
      return { success: false, durationMs: Date.now() - started, estimatedRequestCostUsd: 0, conservativeMaxRequestCostUsd: 0, actualBilledCostUsd: null, errorCode: "UNEXPECTED_RESPONSE_SHAPE", errorMessageSafe: "submit sem polling_url — revisar adapter", potentiallyBilled: true };
    }
    const polled = await pollForResult(pollingUrl, apiKey);
    const durationMs = Date.now() - started;
    if (!polled.ready) {
      // Submit já foi aceito (task criada) antes deste ponto — falha só no polling ainda é posterior
      // a uma submissão potencialmente cobrável.
      return { success: false, durationMs, estimatedRequestCostUsd: 0, conservativeMaxRequestCostUsd: 0, actualBilledCostUsd: null, errorCode: "POLL_FAILED", errorMessageSafe: polled.errorMessageSafe, potentiallyBilled: true };
    }
    const imageResponse = await fetch(polled.sampleUrl);
    if (!imageResponse.ok) {
      // O próprio BFL confirmou status "Ready" (geração concluída) antes deste ponto — é o caso mais
      // claro de "provavelmente cobrado", mesmo sem confirmação oficial de billing.
      return { success: false, durationMs, estimatedRequestCostUsd: 0, conservativeMaxRequestCostUsd: 0, actualBilledCostUsd: null, errorCode: "DOWNLOAD_FAILED", errorMessageSafe: `download da imagem falhou: HTTP ${imageResponse.status}`, potentiallyBilled: true };
    }
    const outputBytes = Buffer.from(await imageResponse.arrayBuffer());
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
      providerMetadataSafe: { model: MODEL_ID },
    };
  } catch (error) {
    // Diferente de Google/OpenAI (1 único fetch no try): aqui o try cobre 3 chamadas sequenciais
    // (submit -> poll -> download) — uma exceção pode acontecer DEPOIS de um submit já aceito/cobrável.
    // Marcado como potencialmente cobrado por segurança financeira, já que não dá para distinguir em
    // qual das 3 chamadas a exceção ocorreu a partir daqui.
    return { success: false, durationMs: Date.now() - started, estimatedRequestCostUsd: 0, conservativeMaxRequestCostUsd: 0, actualBilledCostUsd: null, errorCode: "NETWORK_ERROR", errorMessageSafe: error instanceof Error ? error.message : "erro desconhecido", potentiallyBilled: true };
  }
}

export function createBflBenchmarkProvider(): MarketingProBenchmarkProviderAdapter {
  return { id: "bfl", displayName: "Black Forest Labs FLUX.2 [pro]", model: MODEL_ID, generateBenchmarkBackground: callBfl };
}

export function isBflBenchmarkCredentialConfigured(): boolean {
  return Boolean(process.env.BFL_API_KEY);
}
