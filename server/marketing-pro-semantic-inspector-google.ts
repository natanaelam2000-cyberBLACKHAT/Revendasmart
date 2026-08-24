/** PRO-13 — inspector real do background gerado. Nunca recebe produto, ProductTruth, UID ou PII. */
import { validateImageUploadBytes } from "../shared/image-validation";

export const MARKETING_PRO_SEMANTIC_MODEL = "gemini-3.5-flash-lite";
export const MARKETING_PRO_SEMANTIC_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const FORBIDDEN_ELEMENTS = ["product", "package", "bottle", "box", "container", "label", "text", "logo", "watermark", "person", "hand", "face", "body_part", "foreground_object"] as const;
export type MarketingProForbiddenBackgroundElement = (typeof FORBIDDEN_ELEMENTS)[number];
export type MarketingProSemanticGateRejectionCode = "SEMANTIC_GATE_UNAVAILABLE" | "SEMANTIC_CONTENT_REJECTED" | "SEMANTIC_INVALID_OUTPUT" | "SEMANTIC_TIMEOUT";
export interface MarketingProSemanticMetadata {
  readonly model: string;
  readonly httpStatus?: number;
  readonly responseBytes?: number;
  readonly candidateCount?: number;
  readonly partCounts?: readonly number[];
  readonly finishReasons?: readonly string[];
  readonly parseStage?: string;
  readonly textPreview?: string;
}
export type MarketingProSemanticGateResult =
  | { readonly accepted: true; readonly confidence: number; readonly metadata?: MarketingProSemanticMetadata }
  | { readonly accepted: false; readonly rejectionCode: MarketingProSemanticGateRejectionCode; readonly forbiddenElements?: readonly MarketingProForbiddenBackgroundElement[]; readonly metadata?: MarketingProSemanticMetadata };
export interface MarketingProSemanticInspector { inspectBackground(bytes: Uint8Array, mimeType: string): Promise<MarketingProSemanticGateResult> }
interface SemanticInspectorOptions { readonly apiKey?: string; readonly fetchImpl?: typeof fetch; readonly timeoutMs?: number }

async function readBounded(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error("response-too-large");
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error("response-too-large");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error("response-too-large"); }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

export function parseMarketingProSemanticCandidate(value: unknown): MarketingProSemanticGateResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { accepted: false, rejectionCode: "SEMANTIC_INVALID_OUTPUT" };
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 3 || !["accepted", "forbiddenElements", "confidence"].every((key) => Object.prototype.hasOwnProperty.call(record, key))) return { accepted: false, rejectionCode: "SEMANTIC_INVALID_OUTPUT" };
  if (typeof record.accepted !== "boolean" || typeof record.confidence !== "number" || !Number.isFinite(record.confidence) || record.confidence < 0 || record.confidence > 1) return { accepted: false, rejectionCode: "SEMANTIC_INVALID_OUTPUT" };
  if (!Array.isArray(record.forbiddenElements) || record.forbiddenElements.length > FORBIDDEN_ELEMENTS.length || !record.forbiddenElements.every((item) => (FORBIDDEN_ELEMENTS as readonly unknown[]).includes(item))) return { accepted: false, rejectionCode: "SEMANTIC_INVALID_OUTPUT" };
  const forbiddenElements = Array.from(new Set(record.forbiddenElements)) as MarketingProForbiddenBackgroundElement[];
  if (!record.accepted || forbiddenElements.length > 0 || record.confidence < 0.8) return { accepted: false, rejectionCode: "SEMANTIC_CONTENT_REJECTED", forbiddenElements };
  return { accepted: true, confidence: record.confidence };
}

function withSemanticMetadata(result: MarketingProSemanticGateResult, metadata: MarketingProSemanticMetadata): MarketingProSemanticGateResult {
  return { ...result, metadata };
}

function safeTextPreview(value: string): string {
  return value.replace(/\s+/g, " ").slice(0, 500);
}

function extractSemanticTextFromEnvelope(envelope: unknown): { text?: string; metadata: Omit<MarketingProSemanticMetadata, "model"> } {
  const candidates = (envelope as { candidates?: unknown })?.candidates;
  if (!Array.isArray(candidates) || candidates.length !== 1) return { metadata: { parseStage: "candidate-shape", candidateCount: Array.isArray(candidates) ? candidates.length : 0 } };
  const candidate = candidates[0] as { content?: { parts?: unknown }; finishReason?: unknown };
  const parts = candidate?.content?.parts;
  if (!Array.isArray(parts)) return { metadata: { parseStage: "parts-shape", candidateCount: 1, partCounts: [0], finishReasons: typeof candidate?.finishReason === "string" ? [candidate.finishReason] : [] } };
  const textParts = parts
    .map((part) => (typeof (part as { text?: unknown })?.text === "string" ? (part as { text: string }).text : null))
    .filter((text): text is string => text !== null);
  const metadata = {
    parseStage: textParts.length === 1 ? "text-extracted" : "text-parts-shape",
    candidateCount: 1,
    partCounts: [parts.length],
    finishReasons: typeof candidate?.finishReason === "string" ? [candidate.finishReason] : [],
    ...(textParts[0] ? { textPreview: safeTextPreview(textParts[0]) } : {}),
  };
  return textParts.length === 1 ? { text: textParts[0], metadata } : { metadata };
}

export function parseMarketingProSemanticEnvelope(envelope: unknown, baseMetadata: MarketingProSemanticMetadata = { model: MARKETING_PRO_SEMANTIC_MODEL }): MarketingProSemanticGateResult {
  const extracted = extractSemanticTextFromEnvelope(envelope);
  const metadata = { ...baseMetadata, ...extracted.metadata };
  if (!extracted.text) return { accepted: false, rejectionCode: "SEMANTIC_INVALID_OUTPUT", metadata };
  try {
    const parsed = JSON.parse(extracted.text);
    return withSemanticMetadata(parseMarketingProSemanticCandidate(parsed), metadata);
  } catch {
    return { accepted: false, rejectionCode: "SEMANTIC_INVALID_OUTPUT", metadata: { ...metadata, parseStage: "candidate-json-parse" } };
  }
}

export class GeminiMarketingProSemanticInspector implements MarketingProSemanticInspector {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  constructor(options: SemanticInspectorOptions = {}) {
    this.apiKey = options.apiKey?.trim() || process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || "";
    this.fetchImpl = options.fetchImpl || fetch;
    this.timeoutMs = options.timeoutMs || MARKETING_PRO_SEMANTIC_TIMEOUT_MS;
  }
  async inspectBackground(bytes: Uint8Array, mimeType: string): Promise<MarketingProSemanticGateResult> {
    if (!this.apiKey) return { accepted: false, rejectionCode: "SEMANTIC_GATE_UNAVAILABLE", metadata: { model: MARKETING_PRO_SEMANTIC_MODEL, parseStage: "missing-api-key" } };
    const image = validateImageUploadBytes(bytes, mimeType);
    if (!image.accepted) return { accepted: false, rejectionCode: "SEMANTIC_INVALID_OUTPUT", metadata: { model: MARKETING_PRO_SEMANTIC_MODEL, parseStage: "invalid-image" } };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${MARKETING_PRO_SEMANTIC_MODEL}:generateContent`, {
        method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey }, signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [
            { text: "Inspect this AI-generated advertising background only. Reject if it contains any product, package, bottle, perfume bottle, phone, mockup, box, container, label, readable text, logo, brand, watermark, person, hand, face, body part, or dominant foreground object. Empty surfaces, abstract decoration and environmental materials are allowed. If uncertain, set accepted=false. Return JSON only." },
            { inlineData: { mimeType: image.format, data: Buffer.from(bytes).toString("base64") } },
          ] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: { type: "object", additionalProperties: false, required: ["accepted", "forbiddenElements", "confidence"], properties: {
              accepted: { type: "boolean" },
              forbiddenElements: { type: "array", maxItems: FORBIDDEN_ELEMENTS.length, items: { type: "string", enum: FORBIDDEN_ELEMENTS } },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            } },
            maxOutputTokens: 256, thinkingConfig: { thinkingLevel: "minimal" },
          },
        }),
      });
      if (!response.ok) return { accepted: false, rejectionCode: "SEMANTIC_GATE_UNAVAILABLE", metadata: { model: MARKETING_PRO_SEMANTIC_MODEL, httpStatus: response.status, parseStage: "http-not-ok" } };
      const responseBytes = await readBounded(response);
      const envelope = JSON.parse(Buffer.from(responseBytes).toString("utf8")) as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> };
      return parseMarketingProSemanticEnvelope(envelope, { model: MARKETING_PRO_SEMANTIC_MODEL, httpStatus: response.status, responseBytes: responseBytes.byteLength });
    } catch {
      return { accepted: false, rejectionCode: controller.signal.aborted ? "SEMANTIC_TIMEOUT" : "SEMANTIC_INVALID_OUTPUT", metadata: { model: MARKETING_PRO_SEMANTIC_MODEL, parseStage: controller.signal.aborted ? "timeout" : "exception" } };
    } finally { clearTimeout(timer); }
  }
}
