/**
 * Adapter Google Gemini (Nano Banana) — PRO-06B1 / correção PRO-06B2.1 / correção PRO-06B2.2.
 *
 * Modelo: gemini-3.1-flash-image ("Nano Banana 2"), resolução 1K — consultado em
 * https://ai.google.dev/gemini-api/docs/pricing e https://ai.google.dev/gemini-api/docs/image-generation
 * em 2026-08-15. Preço documentado: US$0.067/imagem em 1K. `aspect_ratio: "4:5"` + `image_size: "1K"`
 * resolve para a resolução NATIVA do modelo (ex.: 928×1152), não necessariamente 1080×1350 — o formato
 * comercial alvo do RevendaSmart é um passo de composição POSTERIOR, não algo que o provider garanta.
 *
 * Interactions API REST — contrato confirmado (PRO-06B2.1: endpoint/headers/model/response_format já
 * batiam; `mime_type` corrigido de png para jpeg).
 *
 * PARSER (PRO-06B2.2, correção da causa raiz real): o terceiro smoke real (HTTP 2xx, ~9,8s de duração —
 * sinal forte de que o modelo rodou de verdade) falhou porque o parser anterior procurava um campo
 * "model_output" dentro de cada step. A doc oficial confirma que "model_output" é, na verdade, o VALOR
 * da propriedade "type" do step, e a imagem mora numa lista "content" dentro desse step:
 *   steps[] → step com type igual a "model_output" → lista content[] → {type: "image", mime_type, data}
 * Steps de outro tipo (ex.: "user_input") são ignorados por construção — nunca é preciso reconhecer
 * todos os tipos possíveis, só o único que interessa. Se houver mais de um bloco de imagem (múltiplos
 * steps do tipo model_output, ou múltiplos blocos dentro de um), usa o ÚLTIMO encontrado —
 * determinístico, resultado final do turn. A convenience property de imagem que o SDK expõe (fora da
 * lista "steps" crua) e o shape inteiramente diferente da outra API do Gemini (generateContent, com sua
 * própria árvore aninhada até um campo de imagem em base64) NUNCA são lidos por este parser.
 *
 * DIMENSÃO REAL (PRO-06B2.2): antes, a dimensão devolvida era sempre `input.requestedWidth/Height`
 * ecoada de volta — nunca a dimensão real da imagem. Isso tornava inútil qualquer auditoria de "o
 * quality gate aceitaria a resolução nativa do Gemini", porque o gate nunca veria o número real. Agora
 * lê a dimensão de verdade dos bytes JPEG retornados (image-dimensions.ts). Se não for possível ler
 * (bytes corrompidos/formato inesperado), a chamada é tratada como falha — nunca inventa uma dimensão.
 */

import { checkMarketingProBenchmarkCredentials } from "../env";
import { readImagePixelDimensions } from "../image-dimensions";
import { MARKETING_PRO_BENCHMARK_PROVIDER_COST } from "../pricing";
import type { GenerateBenchmarkBackgroundInput, GenerateBenchmarkBackgroundResult, MarketingProBenchmarkProviderAdapter } from "../types";

const COST = MARKETING_PRO_BENCHMARK_PROVIDER_COST.google;

const MODEL_ID = "gemini-3.1-flash-image";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const REQUEST_MIME_TYPE = "image/jpeg";
const MAX_SAFE_ERROR_MESSAGE_LENGTH = 300;

function resolveApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
}

export interface GoogleInteractionsImageBlock {
  readonly type: "image";
  readonly mime_type: string;
  readonly data: string;
}

interface GoogleInteractionsModelOutputStep {
  readonly type: "model_output";
  readonly content?: unknown;
}

function isImageBlock(value: unknown): value is GoogleInteractionsImageBlock {
  return (
    typeof value === "object" && value !== null
    && (value as Record<string, unknown>).type === "image"
    && typeof (value as Record<string, unknown>).mime_type === "string"
    && typeof (value as Record<string, unknown>).data === "string"
    && (value as Record<string, unknown>).data !== ""
  );
}

function isModelOutputStep(value: unknown): value is GoogleInteractionsModelOutputStep {
  return typeof value === "object" && value !== null && (value as Record<string, unknown>).type === "model_output";
}

/**
 * Contrato REST confirmado: lista "steps" → steps cujo type é "model_output" → lista "content" dentro
 * desse step → bloco de imagem. Usa o ÚLTIMO bloco de imagem encontrado entre todos os steps desse tipo
 * (determinístico). Não reconhece nenhum outro caminho de leitura — nem o antigo campo mal interpretado,
 * nem a convenience property do SDK, nem o shape da outra API (generateContent).
 */
export function findImageBlockInSteps(json: unknown): GoogleInteractionsImageBlock | undefined {
  const steps = (json as { steps?: unknown })?.steps;
  if (!Array.isArray(steps)) return undefined;
  let found: GoogleInteractionsImageBlock | undefined;
  for (const step of steps) {
    if (!isModelOutputStep(step)) continue;
    const content = step.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (isImageBlock(block)) found = block;
    }
  }
  return found;
}

/**
 * Diagnóstico seguro de erro HTTP (§7): lê código/status/mensagem que o PRÓPRIO Google devolve
 * descrevendo o que deu errado na nossa requisição — nunca a API key, nunca headers enviados, nunca o
 * prompt completo. Truncado por segurança/legibilidade, não porque o conteúdo seja sensível.
 */
async function extractSafeErrorInfo(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: { code?: unknown; status?: unknown; message?: unknown } };
    const parts = [body?.error?.status, body?.error?.code, body?.error?.message].filter((v) => v !== undefined && v !== null);
    const message = parts.length ? parts.join(" - ") : `HTTP ${response.status} (sem corpo de erro reconhecível)`;
    return message.length > MAX_SAFE_ERROR_MESSAGE_LENGTH ? `${message.slice(0, MAX_SAFE_ERROR_MESSAGE_LENGTH)}…` : message;
  } catch {
    return `HTTP ${response.status} (corpo de erro não é JSON)`;
  }
}

async function callGoogle(input: GenerateBenchmarkBackgroundInput): Promise<GenerateBenchmarkBackgroundResult> {
  const started = Date.now();
  const apiKey = resolveApiKey();
  if (!apiKey) {
    // Nunca chegou a sair um request — não há como ter sido cobrado.
    return { success: false, durationMs: 0, estimatedRequestCostUsd: 0, conservativeMaxRequestCostUsd: 0, actualBilledCostUsd: null, errorCode: "MISSING_CREDENTIAL", errorMessageSafe: "GEMINI_API_KEY/GOOGLE_API_KEY não configurada", potentiallyBilled: false };
  }
  // PRO-06B2.9 (P1): registra se um HTTP 2xx já foi confirmado, para que uma exceção lançada DEPOIS
  // disso (ex.: `response.json()` em corpo malformado) não caia no mesmo balde de "nunca saiu request"
  // que uma falha de rede genuína. Um 2xx confirmado significa que o provider já processou a
  // requisição — a partir daqui, qualquer falha local é pós-provider, não pré-provider.
  let receivedOkHttpResponse = false;
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        model: MODEL_ID,
        input: input.promptText,
        response_format: { type: "image", mime_type: REQUEST_MIME_TYPE, aspect_ratio: "4:5", image_size: "1K" },
      }),
    });
    const durationMs = Date.now() - started;
    if (!response.ok) {
      // HTTP não-2xx: presume-se recusado ANTES de qualquer inferência (não cobrado). Não é garantia
      // absoluta do provider, mas é a leitura padrão de uma resposta de erro HTTP.
      const errorMessageSafe = await extractSafeErrorInfo(response);
      return { success: false, durationMs, estimatedRequestCostUsd: 0, conservativeMaxRequestCostUsd: 0, actualBilledCostUsd: null, errorCode: `HTTP_${response.status}`, errorMessageSafe, potentiallyBilled: false };
    }
    receivedOkHttpResponse = true;
    const json = await response.json() as unknown;
    const imageBlock = findImageBlockInSteps(json);
    if (!imageBlock) {
      // PRO-06B2.2 (P1): chegou a responder 2xx — o request FOI processado pelo provider e pode ter
      // consumido inferência paga, mesmo sem produzir uma imagem usável aqui. `potentiallyBilled: true`
      // é o que diz ao orquestrador para NÃO tratar esta reserva como se nunca tivesse acontecido.
      return { success: false, durationMs, estimatedRequestCostUsd: 0, conservativeMaxRequestCostUsd: 0, actualBilledCostUsd: null, errorCode: "UNEXPECTED_RESPONSE_SHAPE", errorMessageSafe: "resposta 2xx sem bloco de imagem em steps[type=model_output].content[] — revisar parser", potentiallyBilled: true };
    }
    const outputBytes = Buffer.from(imageBlock.data, "base64");
    const dimensions = readImagePixelDimensions(outputBytes, imageBlock.mime_type);
    if (!dimensions) {
      // Mesmo raciocínio: 2xx + bloco de imagem presente, mas os bytes não puderam ser lidos como
      // imagem válida — ainda assim uma resposta processada, possivelmente cobrada.
      return { success: false, durationMs, estimatedRequestCostUsd: 0, conservativeMaxRequestCostUsd: 0, actualBilledCostUsd: null, errorCode: "UNEXPECTED_RESPONSE_SHAPE", errorMessageSafe: "bloco de imagem presente mas bytes não reconhecidos como JPEG/PNG válido — revisar parser", potentiallyBilled: true };
    }
    return {
      success: true,
      mimeType: imageBlock.mime_type,
      width: dimensions.width,
      height: dimensions.height,
      byteSize: outputBytes.byteLength,
      durationMs,
      estimatedRequestCostUsd: COST.estimatedRequestCostUsd,
      conservativeMaxRequestCostUsd: COST.conservativeMaxRequestCostUsd,
      actualBilledCostUsd: null,
      outputBytes,
      providerMetadataSafe: { model: MODEL_ID, resolutionBucket: "1K", requestedWidth: input.requestedWidth, requestedHeight: input.requestedHeight },
    };
  } catch (error) {
    // PRO-06B2.9: se um 2xx já tinha sido confirmado (ex.: `response.json()` lançou por corpo
    // malformado), isto é falha local PÓS-provider, não erro de rede — `potentiallyBilled: true`, com
    // um errorCode distinto de "sem request nenhum saiu" para não confundir os dois diagnósticos.
    return {
      success: false,
      durationMs: Date.now() - started,
      estimatedRequestCostUsd: 0,
      conservativeMaxRequestCostUsd: 0,
      actualBilledCostUsd: null,
      errorCode: receivedOkHttpResponse ? "INVALID_RESPONSE_BODY" : "NETWORK_ERROR",
      errorMessageSafe: error instanceof Error ? error.message : "erro desconhecido",
      potentiallyBilled: receivedOkHttpResponse,
    };
  }
}

export function createGoogleBenchmarkProvider(): MarketingProBenchmarkProviderAdapter {
  return { id: "google", displayName: "Google Gemini (Nano Banana 2)", model: MODEL_ID, generateBenchmarkBackground: callGoogle };
}

export function isGoogleBenchmarkCredentialConfigured(): boolean {
  return checkMarketingProBenchmarkCredentials().find((c) => c.provider === "google")?.configured ?? false;
}
