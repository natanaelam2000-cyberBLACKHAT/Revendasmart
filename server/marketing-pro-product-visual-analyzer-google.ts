/** PRO-11B — analyzer multimodal Gemini server-only. Sem retry e sem qualquer dado de cliente. */
import { validateImageUploadBytes, DEFAULT_IMAGE_UPLOAD_LIMITS } from "../shared/image-validation";
import {
  parseProductVisualUnderstandingOutput,
  type ProductVisualAnalysisInput,
  type ProductVisualAnalyzer,
} from "../shared/marketing-pro-product-understanding";
import type { ProductVisualUnderstanding } from "../shared/marketing-pro-creative-intelligence";

export const GEMINI_PRODUCT_VISUAL_MODEL = "gemini-3.5-flash-lite";
export const GEMINI_PRODUCT_VISUAL_ANALYZER_VERSION = "gemini-product-visual-v1";
export const GEMINI_PRODUCT_VISUAL_MAX_RESPONSE_BYTES = 256 * 1024;
export const GEMINI_PRODUCT_VISUAL_DEFAULT_TIMEOUT_MS = 15_000;

const CREATIVE_FAMILIES = ["luxury", "editorial", "modern", "minimal", "sensory", "fresh-premium", "fresh-sport", "fresh-commercial"];
const STRING_ARRAY = { type: "array", maxItems: 12, items: { type: "string", maxLength: 120 } } as const;

export const GEMINI_PRODUCT_VISUAL_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["observed", "inferred", "confidence"],
  properties: {
    observed: {
      type: "object", additionalProperties: false,
      properties: {
        dominantColors: STRING_ARRAY,
        secondaryColors: STRING_ARRAY,
        perceivedBrightness: { type: "string", enum: ["very_dark", "dark", "balanced", "light", "very_light"] },
        visualWeight: { type: "string", enum: ["light", "balanced", "heavy"] },
        productShape: { type: "string", maxLength: 120 },
        productOrientation: { type: "string", enum: ["portrait", "landscape", "square", "irregular"] },
        visualComplexity: { type: "string", enum: ["low", "medium", "high"] },
      },
    },
    inferred: {
      type: "object", additionalProperties: false,
      properties: {
        contrastNeeds: STRING_ARRAY,
        recommendedBackgroundContrast: { type: "string", enum: ["soft", "medium", "high"] },
        visualMoodCandidates: STRING_ARRAY,
        commercialToneCandidates: STRING_ARRAY,
        recommendedCreativeFamilies: { type: "array", maxItems: 8, items: { type: "string", enum: CREATIVE_FAMILIES } },
        avoidCreativeFamilies: { type: "array", maxItems: 8, items: { type: "string", enum: CREATIVE_FAMILIES } },
        recommendedEnvironmentHints: STRING_ARRAY,
        avoidEnvironmentHints: STRING_ARRAY,
      },
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

export class GeminiProductVisualAnalyzerError extends Error {
  constructor(readonly code: "INVALID_IMAGE" | "NOT_CONFIGURED" | "TIMEOUT" | "PROVIDER_ERROR" | "OUTPUT_TOO_LARGE" | "INVALID_OUTPUT", message: string) {
    super(message);
    this.name = "GeminiProductVisualAnalyzerError";
  }
}

interface GeminiProductVisualAnalyzerOptions {
  readonly apiKey?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

function responseText(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const candidates = (body as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length !== 1) return null;
  const parts = (candidates[0] as { content?: { parts?: unknown } })?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const textParts = parts.map((part) => (part && typeof part === "object" ? (part as { text?: unknown }).text : undefined));
  if (textParts.length !== 1 || typeof textParts[0] !== "string") return null;
  return textParts[0];
}

async function readBoundedResponse(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > GEMINI_PRODUCT_VISUAL_MAX_RESPONSE_BYTES) {
    throw new GeminiProductVisualAnalyzerError("OUTPUT_TOO_LARGE", "Gemini response exceeded limit");
  }
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > GEMINI_PRODUCT_VISUAL_MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new GeminiProductVisualAnalyzerError("OUTPUT_TOO_LARGE", "Gemini response exceeded limit");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export class GeminiProductVisualAnalyzer implements ProductVisualAnalyzer {
  readonly id = GEMINI_PRODUCT_VISUAL_ANALYZER_VERSION;
  readonly provider = "google";
  readonly model = GEMINI_PRODUCT_VISUAL_MODEL;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: GeminiProductVisualAnalyzerOptions = {}) {
    this.apiKey = options.apiKey?.trim() || process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || "";
    this.fetchImpl = options.fetchImpl || fetch;
    this.timeoutMs = options.timeoutMs || GEMINI_PRODUCT_VISUAL_DEFAULT_TIMEOUT_MS;
  }

  async analyzeProductVisual(input: ProductVisualAnalysisInput): Promise<ProductVisualUnderstanding> {
    if (!this.apiKey) throw new GeminiProductVisualAnalyzerError("NOT_CONFIGURED", "Gemini credential is not configured");
    const image = validateImageUploadBytes(input.image.bytes, input.image.mimeType, DEFAULT_IMAGE_UPLOAD_LIMITS);
    if (!image.accepted) throw new GeminiProductVisualAnalyzerError("INVALID_IMAGE", `Rejected image: ${image.reason}`);

    const trustedHints = [
      input.trustedContext.category ? `registered category: ${input.trustedContext.category.slice(0, 120)}` : "",
      input.trustedContext.color ? `registered color: ${input.trustedContext.color.slice(0, 80)}` : "",
    ].filter(Boolean).join("\n");
    const prompt = [
      "Analyze this product only for advertising art direction.",
      "",
      "Do not invent:",
      "- product specifications",
      "- ingredients",
      "- fragrance notes",
      "- technical capabilities",
      "- certifications",
      "- materials",
      "- claims",
      "- performance characteristics",
      "",
      "Anything not visually observable or present in trusted input must not be treated as fact.",
      "Observed = visible image signals only. Inferred = probabilistic visual direction only.",
      "Return only JSON matching the supplied schema. Keep every list short and every phrase concise.",
      trustedHints,
    ].filter(Boolean).join("\n");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ parts: [
              { text: prompt },
              { inlineData: { mimeType: image.format, data: Buffer.from(input.image.bytes).toString("base64") } },
            ] }],
            generationConfig: {
              responseMimeType: "application/json",
              responseJsonSchema: GEMINI_PRODUCT_VISUAL_RESPONSE_SCHEMA,
              maxOutputTokens: 1_024,
              thinkingConfig: { thinkingLevel: "minimal" },
            },
          }),
        },
      );
      if (!response.ok) throw new GeminiProductVisualAnalyzerError("PROVIDER_ERROR", `Gemini HTTP ${response.status}`);
      const bytes = await readBoundedResponse(response);
      let body: unknown;
      try { body = JSON.parse(Buffer.from(bytes).toString("utf8")); }
      catch { throw new GeminiProductVisualAnalyzerError("INVALID_OUTPUT", "Gemini response was not JSON"); }
      const text = responseText(body);
      if (!text || Buffer.byteLength(text, "utf8") > GEMINI_PRODUCT_VISUAL_MAX_RESPONSE_BYTES) {
        throw new GeminiProductVisualAnalyzerError("INVALID_OUTPUT", "Gemini candidate output was missing or too large");
      }
      let raw: unknown;
      try { raw = JSON.parse(text); }
      catch { throw new GeminiProductVisualAnalyzerError("INVALID_OUTPUT", "Gemini candidate was not JSON"); }
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new GeminiProductVisualAnalyzerError("INVALID_OUTPUT", "Gemini candidate was not an object");
      const candidate = raw as Record<string, unknown>;
      if (Object.keys(candidate).length !== 3 || !["observed", "inferred", "confidence"].every((key) => Object.prototype.hasOwnProperty.call(candidate, key))) {
        throw new GeminiProductVisualAnalyzerError("INVALID_OUTPUT", "Gemini candidate contained unknown or missing root fields");
      }
      const result = {
        observed: candidate.observed,
        inferred: candidate.inferred,
        confidence: candidate.confidence,
        version: 1,
        sourceImageAssetId: input.image.assetId,
      };
      const parsed = parseProductVisualUnderstandingOutput(result);
      if (!parsed.accepted) throw new GeminiProductVisualAnalyzerError("INVALID_OUTPUT", parsed.errors.join(", "));
      return parsed.value;
    } catch (error) {
      if (error instanceof GeminiProductVisualAnalyzerError) throw error;
      if (controller.signal.aborted) throw new GeminiProductVisualAnalyzerError("TIMEOUT", "Gemini request timed out");
      throw new GeminiProductVisualAnalyzerError("PROVIDER_ERROR", error instanceof Error ? error.message : "Gemini request failed");
    } finally {
      clearTimeout(timer);
    }
  }
}

export function isGeminiProductVisualCredentialConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim());
}
