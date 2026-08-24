/**
 * PRO-08/PRO-09 — provider REAL de background: Google Gemini 3.1 Flash Image ("Nano Banana 2").
 *
 * Implementa `MarketingImageProvider` (server/marketing-pro-provider.ts) — o único ponto de contato
 * entre o backend e este fornecedor. O input (`MarketingProBackgroundInput` =
 * `MarketingProProviderArtDirection`) já é, por CONSTRUÇÃO DE TIPO (`AssertNoForbiddenProviderFields`
 * em shared/marketing-pro-contract.ts), incapaz de carregar produto/preço/CTA/loja/imagem do produto —
 * este arquivo nunca precisa (e nunca consegue) enviar esses dados ao provider.
 *
 * Endpoint/parsing REST portados de `script/marketing-pro-benchmark/providers/google.ts` (mesmo contrato
 * já confirmado por smoke real naquele benchmark) — deliberadamente NÃO importados de lá: `script/` é um
 * sandbox Node-only que nunca deve virar dependência de runtime do servidor.
 *
 * PRO-13: a API atual aceita somente `image/jpeg` para este modelo. O JPEG recebido passa primeiro pelo
 * binary gate e depois é transcodificado server-side para PNG opaco com `sharp`; o PNG canônico passa
 * novamente pelo binary gate antes de seguir aos gates de safe-zone/semântica e à persistência. A
 * transcodificação afeta somente o background gerado — nunca produto/cutout.
 *
 * PRO-09 §4: timeout agora cancela o `fetch` de verdade via `AbortController` (antes só um
 * `Promise.race` no nível da rota, que nunca abortava a requisição em voo — a chamada HTTP continuava
 * rodando e podendo ser cobrada mesmo depois do timeout "vencer" do lado do cliente). Depois do abort,
 * o resultado é tratado como `potentiallyBilled` pelo call site (server/marketing-pro.ts) — nunca como
 * "sem custo", porque o request já foi despachado.
 */
import type {
  MarketingProAtmosphereId,
  MarketingProLightingId,
  MarketingProSurfaceId,
} from "../shared/marketing-pro-contract";
import { validateMarketingProProviderImageBinary, validateMarketingProProviderResponseSize } from "./marketing-pro-image-binary-gate";
import { logWarn } from "./logger";
import sharp from "sharp";
import type {
  MarketingImageProvider,
  MarketingProBackgroundInput,
  MarketingProBackgroundResult,
} from "./marketing-pro-provider";

const MODEL_ID = "gemini-3.1-flash-image";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
/** MIME atualmente aceito pelo Interactions API; o retorno é canonizado para PNG antes dos gates. */
const REQUEST_MIME_TYPE = "image/jpeg";
const MAX_SAFE_ERROR_MESSAGE_LENGTH = 300;
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

function resolveApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
}

export function isGoogleMarketingProCredentialConfigured(): boolean {
  return Boolean(resolveApiKey());
}

const LIGHTING_PHRASE: Record<MarketingProLightingId, string> = {
  soft: "soft diffused lighting",
  dramatic: "dramatic directional lighting with deep shadows",
  studio: "clean studio lighting",
  cinematic: "cinematic rim lighting",
  natural: "natural daylight",
};

const SURFACE_PHRASE: Record<MarketingProSurfaceId, string> = {
  clean: "clean plain surface",
  reflective: "reflective glossy surface",
  matte: "matte textured surface",
  textured: "richly textured surface",
  pedestal: "minimal pedestal surface",
};

const ATMOSPHERE_PHRASE: Record<MarketingProAtmosphereId, string> = {
  refined: "refined and elegant atmosphere",
  structured: "structured and orderly atmosphere",
  quiet: "quiet and calm atmosphere",
  tactile: "tactile and warm atmosphere",
  energetic: "energetic and vibrant atmosphere",
};

const CREATIVE_FAMILY_PHRASE: Record<NonNullable<MarketingProBackgroundInput["creativeFamily"]>, string> = {
  luxury: "restrained luxury with generous negative space",
  editorial: "asymmetric premium editorial staging",
  modern: "clean geometric contemporary staging",
  minimal: "minimal staging with extensive negative space",
  sensory: "subtle tactile and organic atmosphere",
  "fresh-premium": "bright fresh premium atmosphere with airy translucent accents",
  "fresh-sport": "fresh energetic atmosphere with controlled motion cues",
  "fresh-commercial": "bright commercial atmosphere with clear visual hierarchy",
};

const ASPECT_RATIO_BY_FORMAT: Record<MarketingProBackgroundInput["format"], string> = {
  portrait: "4:5",
  square: "1:1",
  story: "9:16",
};

function productZoneHintPhrase(input: MarketingProBackgroundInput): string {
  const hints = input.visualProductHints;
  if (!hints) return "Leave the central reserved region empty — clean, calm negative space.";
  const silhouette = hints.silhouette === "wide-horizontal"
    ? "a wide horizontal light-colored item"
    : hints.silhouette === "tall-vertical"
      ? "a tall vertical item"
      : hints.silhouette === "compact-square"
        ? "a compact square item"
        : "an irregular item";
  const contrast = hints.contrast === "high" || hints.brightness === "light" || hints.brightness === "very_light"
    ? "with strong separation from light product edges"
    : "with clear product separation";
  const heroZone = hints.heroZoneContrast === "darker-than-product"
    ? "Keep the reserved hero area visually calm and darker/neutral compared with the light-colored item that will be composited later."
    : hints.heroZoneContrast === "lighter-than-product"
      ? "Keep the reserved hero area visually calm and lighter/neutral compared with the dark-colored item that will be composited later."
      : "Keep the reserved hero area visually calm with clear neutral separation for the item that will be composited later.";
  const hueSeparation = hints.avoidSimilarHue ? "Avoid filling the hero area with a hue too similar to the item's accent color." : "";
  return `Leave the central reserved region empty for ${silhouette}, ${contrast}; ${heroZone} ${hueSeparation} Include a coherent support surface and contact-shadow area.`;
}

/**
 * PRO-09 §8 — prompt endurecido. Removida qualquer linguagem que soe "product photography"/"finished
 * advertisement" (um modelo de imagem treinado em fotografia de produto tende a preencher o centro
 * "vazio" com um objeto plausível se o prompt ainda cheira a anúncio pronto). Preferido "empty
 * photographic environment" — deixa claro que o pedido é um CENÁRIO, não uma peça publicitária.
 * Lista de restrições negativas ampliada item a item conforme a tarefa. O prompt NÃO substitui
 * validação (§8, último parágrafo) — é só a primeira linha de defesa; os gates quantitativo e semântico
 * (inspeção multimodal real do PRO-13, só sobre o background) continuam sendo a autoridade.
 */
export function buildMarketingProBackgroundPrompt(input: MarketingProBackgroundInput): string {
  const paletteText = input.palette.length > 0 ? input.palette.join(", ") : "neutral tones";
  const conceptDirection = input.creativeFamily ? CREATIVE_FAMILY_PHRASE[input.creativeFamily] : `${input.style} art direction`;
  return [
    `Empty photographic environment only, for a ${input.category} product category, ${conceptDirection}.`,
    `${LIGHTING_PHRASE[input.lighting]}, ${SURFACE_PHRASE[input.surface]}, ${ATMOSPHERE_PHRASE[input.atmosphere]}.`,
    `Color palette: ${paletteText}.`,
    `Background and surface only. ${productZoneHintPhrase(input)}`,
    "Negative constraints: no products, no packages, no bottles, no boxes, no containers, no labels.",
    "No text, no letters, no numbers, no logos, no brands, no watermarks.",
    "No humans, no hands, no faces.",
    "No foreground objects, no mockups, no finished advertisements.",
  ].join(" ");
}

interface GoogleInteractionsImageBlock {
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

/** Mesmo parser confirmado no benchmark (PRO-06B2.2): steps[type=model_output].content[] → último bloco de imagem. */
function findImageBlockInSteps(json: unknown): GoogleInteractionsImageBlock | undefined {
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

async function extractSafeErrorInfo(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown; status?: unknown; message?: unknown } };
    const parts = [body?.error?.status, body?.error?.code, body?.error?.message].filter((v) => v !== undefined && v !== null);
    const message = parts.length ? parts.join(" - ") : `HTTP ${response.status} (sem corpo de erro reconhecível)`;
    return message.length > MAX_SAFE_ERROR_MESSAGE_LENGTH ? `${message.slice(0, MAX_SAFE_ERROR_MESSAGE_LENGTH)}…` : message;
  } catch {
    return `HTTP ${response.status} (corpo de erro não é JSON)`;
  }
}

/**
 * PRO-09 §4: quando o timeout dispara, `AbortController.abort()` cancela o `fetch` de verdade (o
 * runtime do Node fecha o socket) — diferente do PRO-08, onde só existia um `Promise.race` no nível da
 * rota que nunca tocava a requisição em voo. Uma vez que o `fetch` foi disparado, QUALQUER falha
 * daqui pra frente (timeout incluso) é tratada pelo call site (`server/marketing-pro.ts`) como
 * `potentiallyBilled` — nunca como "sem custo" — porque o request já pode ter sido processado pelo
 * provider (§9 da tarefa). A credencial ausente é o único caminho que nunca chega a disparar o
 * `fetch`; na prática esse caminho é inatingível em produção porque `server/routes.ts` só injeta este
 * provider quando `isGoogleMarketingProCredentialConfigured()` já confirmou a credencial — mantido
 * aqui como defesa em profundidade, não como o caminho esperado.
 */
async function generateBackground(input: MarketingProBackgroundInput, timeoutMs: number): Promise<MarketingProBackgroundResult> {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    return { status: "failed", errorCode: "GENERATION_FAILED" };
  }
  const promptText = buildMarketingProBackgroundPrompt(input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        model: MODEL_ID,
        input: promptText,
        response_format: { type: "image", mime_type: REQUEST_MIME_TYPE, aspect_ratio: ASPECT_RATIO_BY_FORMAT[input.format], image_size: "1K" },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorMessageSafe = await extractSafeErrorInfo(response);
      logWarn("marketing_pro.google_provider_http_error", { status: response.status, errorMessageSafe });
      return { status: "failed", errorCode: "GENERATION_FAILED" };
    }
    const rawBuffer = await response.arrayBuffer();
    if (!validateMarketingProProviderResponseSize(rawBuffer.byteLength)) {
      logWarn("marketing_pro.google_provider_response_too_large", { byteLength: rawBuffer.byteLength });
      return { status: "failed", errorCode: "GENERATION_FAILED" };
    }
    let json: unknown;
    try {
      json = JSON.parse(Buffer.from(rawBuffer).toString("utf8"));
    } catch {
      logWarn("marketing_pro.google_provider_invalid_json", {});
      return { status: "failed", errorCode: "GENERATION_FAILED" };
    }
    const imageBlock = findImageBlockInSteps(json);
    if (!imageBlock) {
      logWarn("marketing_pro.google_provider_unexpected_response_shape", {});
      return { status: "failed", errorCode: "GENERATION_FAILED" };
    }

    // PRO-09 §2/§3: validação binária COMPLETA — MIME allowlist, base64 estrito, magic bytes, truncamento,
    // dimensões/aspect ratio/pixel count/alpha. Fail closed em qualquer falha, nunca "assume jpeg".
    const binaryResult = validateMarketingProProviderImageBinary({ base64: imageBlock.data, declaredMimeType: imageBlock.mime_type, format: input.format });
    if (!binaryResult.accepted) {
      logWarn("marketing_pro.google_provider_binary_gate_rejected", { rejectionCode: binaryResult.rejectionCode });
      return { status: "failed", errorCode: "GENERATION_FAILED" };
    }

    const providerBytes = Buffer.from(imageBlock.data, "base64");
    let outputBytes = providerBytes;
    if (binaryResult.format === "image/jpeg") {
      try {
        outputBytes = await sharp(providerBytes, { failOn: "error", limitInputPixels: 25_000_000 })
          .png({ compressionLevel: 9, palette: false })
          .toBuffer();
      } catch {
        logWarn("marketing_pro.google_provider_transcode_failed", {});
        return { status: "failed", errorCode: "GENERATION_FAILED" };
      }
    }
    const canonicalResult = validateMarketingProProviderImageBinary({
      base64: outputBytes.toString("base64"),
      declaredMimeType: "image/png",
      format: input.format,
    });
    if (!canonicalResult.accepted) {
      logWarn("marketing_pro.google_provider_canonical_png_rejected", { rejectionCode: canonicalResult.rejectionCode });
      return { status: "failed", errorCode: "GENERATION_FAILED" };
    }
    return {
      status: "ready",
      output: { mimeType: canonicalResult.format, width: canonicalResult.width, height: canonicalResult.height, byteSize: canonicalResult.byteSize },
      asset: { mimeType: canonicalResult.format, bytes: outputBytes },
    };
  } catch (error) {
    const wasAborted = controller.signal.aborted;
    logWarn("marketing_pro.google_provider_network_error", { error: error instanceof Error ? error.message : "unknown", wasAborted });
    return { status: "failed", errorCode: wasAborted ? "GENERATION_TIMEOUT" : "GENERATION_FAILED" };
  } finally {
    clearTimeout(timer);
  }
}

export function createGoogleMarketingProBackgroundProvider(timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS): MarketingImageProvider {
  return {
    id: "google",
    model: MODEL_ID,
    generateBackground: (input: MarketingProBackgroundInput) => generateBackground(input, timeoutMs),
  };
}
