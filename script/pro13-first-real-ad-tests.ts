/** PRO-13 — gates A–T da primeira arte profissional real. Sem rede e sem chamadas pagas. */
import assert from "node:assert/strict";
import fs from "node:fs";
import sharp from "sharp";
import { PLANS } from "../shared/monetization";
import { buildMarketingProBackgroundSpecFromConceptSelection } from "../shared/marketing-pro-art-direction";
import { buildProductUnderstandingFallback } from "../shared/marketing-pro-product-understanding";
import type { CreativeConcept, ProductTruth } from "../shared/marketing-pro-creative-intelligence";
import { buildMarketingProBackgroundPrompt, createGoogleMarketingProBackgroundProvider } from "../server/marketing-pro-provider-google";
import { GeminiMarketingProSemanticInspector, parseMarketingProSemanticCandidate } from "../server/marketing-pro-semantic-inspector-google";
import { evaluateMarketingProSemanticGateCached } from "../server/marketing-pro-semantic-gate";
import { decideMarketingProGenerationOutcome, resolveMarketingProEntitlement, validateMarketingProGenerateInput } from "../server/marketing-pro";
import { MARKETING_PRO_OPERATION_CONSERVATIVE_COST_USD } from "../server/marketing-pro-cost-guard";
import { buildMarketingProProfessionalAdLayout } from "../client/src/lib/marketing-pro-real-background-composer";

const read = (path: string) => fs.readFileSync(path, "utf8");
const route = read("server/marketing-pro.ts");
const provider = read("server/marketing-pro-provider-google.ts");
const inspector = read("server/marketing-pro-semantic-inspector-google.ts");
const panel = read("client/src/components/marketing/ProAdGenerationPanel.tsx");
const section = read("client/src/components/marketing/CreativeConceptsSection.tsx");
const compositor = read("client/src/lib/marketing-pro-real-background-composer.ts");

const truth: ProductTruth = { productId: "p1", name: "Produto real", salePrice: 100, promotionalPrice: 80, category: "beauty", color: "azul" };
const understanding = buildProductUnderstandingFallback({ truth }).visualUnderstanding;
const spec = buildMarketingProBackgroundSpecFromConceptSelection({ creativeConceptId: "concept:1", creativeFamily: "fresh-premium", category: "beauty", format: "square", productUnderstanding: understanding });
const prompt = buildMarketingProBackgroundPrompt(spec);

// A. Free não chama provider: entitlement server-side nega antes do handler.
assert.deepEqual(resolveMarketingProEntitlement(null), { allowed: false, plan: PLANS.FREE });
assert.match(route, /requireAuth, requireProAdsEntitlement, async/);
// B. Premium sem produto/cutout não gera e não cria reserva presa no budget/ledger.
assert.match(route, /validateApprovedProductCutoutShape\(productData\.approvedCutout\)/);
assert.ok(
  route.indexOf("PRODUCT_NOT_FOUND") < route.indexOf("buildMarketingProUsageReservationWrite({"),
  "produto ausente precisa falhar antes de reservar budget/usage",
);
assert.ok(
  route.indexOf("validateApprovedProductCutoutShape(productData.approvedCutout)") < route.indexOf("buildMarketingProUsageReservationWrite({"),
  "cutout ausente precisa falhar antes de reservar budget/usage",
);
// C. Conceito não selecionado não monta o painel nem chama geração.
assert.match(section, /readyResult && confirmedConceptId/);
assert.match(panel, /creativeConceptId: concept\.concept\.id/);
// D. Clique duplo não duplica operação.
assert.match(panel, /busyRef\.current/);
// E/F. Provider recebe uma spec fechada, sem bytes/URLs/dados comerciais.
assert.equal(spec.creativeFamily, "fresh-premium");
for (const forbidden of ["Produto real", "100", "80", "imageUrl", "cutout", "description", "telefone", "uid"]) assert.equal(prompt.includes(forbidden), false, `payload vazou ${forbidden}`);
assert.doesNotMatch(provider, /inlineData|approvedCutout|ProductTruth/);
assert.match(provider, /const REQUEST_MIME_TYPE = "image\/jpeg"/);
assert.match(provider, /sharp\(providerBytes/);
// G. Rejeição semântica é fail closed antes da persistência.
assert.deepEqual(parseMarketingProSemanticCandidate({ accepted: false, forbiddenElements: ["product"], confidence: 0.99 }), { accepted: false, rejectionCode: "SEMANTIC_CONTENT_REJECTED", forbiddenElements: ["product"] });
assert.deepEqual(parseMarketingProSemanticCandidate({ accepted: true, forbiddenElements: [], confidence: 1, extra: "fail" }), { accepted: false, rejectionCode: "SEMANTIC_INVALID_OUTPUT" });
assert.ok(route.indexOf("evaluateMarketingProSemanticGateCached(") < route.indexOf("persistMarketingProBackgroundAsset({"));
// H/I/J. Só background aprovado chega ao compositor; cutout é desenhado uma vez, sem filtros/pixel writes.
assert.match(panel, /dto\.status !== "ready" \|\| !dto\.background/);
// ADS-PRO-02 refatorou a chamada inline para uma const reaproveitada pelos dois modos (ai/library); o
// valor continua vindo só de approvedCutoutSource, nunca inventado.
assert.match(panel, /const cutoutImageSrc = approvedCutoutSource\.downloadUrl \|\| approvedCutoutSource\.storagePath;/);
const cutoutDraw = compositor.slice(compositor.indexOf("function drawContainedImage"), compositor.indexOf("function formatTruthPrice"));
assert.equal((cutoutDraw.match(/ctx\.drawImage\(/g) || []).length, 1);
assert.doesNotMatch(cutoutDraw, /filter|getImageData|putImageData|globalAlpha/);
// K/L. Arte recebe ProductTruth; promoção só existe quando preço promocional é real e menor.
assert.match(panel, /buildProductTruthFromProduct\(product\)/);
assert.match(compositor, /truth\.promotionalPrice > 0 && truth\.promotionalPrice < truth\.salePrice/);
// M/N. Família e conceito controlam layouts diferentes.
const concept = (family: CreativeConcept["creativeFamily"]): Pick<CreativeConcept, "creativeFamily"> => ({ creativeFamily: family });
assert.notDeepEqual(buildMarketingProProfessionalAdLayout(concept("luxury")), buildMarketingProProfessionalAdLayout(concept("modern")));
assert.notDeepEqual(buildMarketingProProfessionalAdLayout(concept("minimal")), buildMarketingProProfessionalAdLayout(concept("fresh-commercial")));
// O/P. Preview real continua gerando PNG canônico a partir das dimensões do formato.
assert.match(panel, /data-testid="img-pro-ad-preview"/);
assert.match(compositor, /const dimensions = MARKETING_PRO_FORMAT_DIMENSIONS\[input\.format\];/);
assert.match(compositor, /canvas\.width = dimensions\.width; canvas\.height = dimensions\.height/);
assert.match(panel, /canvasToPngBlob/);
// Q/R. Produto/original não são escritos; falha conserva lastReady.
assert.doesNotMatch(route, /productData\.(imageUrl|imageId|approvedCutout)\s*=/);
assert.match(panel, /lastReady/);
// S. Mesmo generationRequestId retorna o documento existente sem outra chamada.
assert.equal(decideMarketingProGenerationOutcome({ generationId: "same-id", status: "ready", style: "minimal", format: "square", productId: "p1", attemptCount: 1, createdAt: {} as never, updatedAt: {} as never }).action, "return-existing");
// T. Uma geração + uma inspeção por operação; retry é manual e ganha ID novo.
assert.equal((route.match(/runProviderWithTimeout\(provider/g) || []).length, 1);
assert.equal((route.match(/evaluateMarketingProSemanticGateCached\(db, result\.asset\.bytes/g) || []).length, 1);
assert.match(panel, /createMarketingProGenerationRequestId\(\)/);
assert.equal(MARKETING_PRO_OPERATION_CONSERVATIVE_COST_USD, 0.068);

// Compatibilidade real do adapter: Interactions recebe image/jpeg e o backend entrega PNG canônico.
const providerJpeg = await sharp({
  create: { width: 800, height: 800, channels: 3, background: { r: 28, g: 35, b: 52 } },
}).jpeg({ quality: 90 }).toBuffer();
const originalFetch = globalThis.fetch;
const originalGeminiKey = process.env.GEMINI_API_KEY;
let generationPayload: Record<string, unknown> | undefined;
try {
  process.env.GEMINI_API_KEY = "test-only";
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    generationPayload = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/jpeg", data: providerJpeg.toString("base64") }] }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const generated = await createGoogleMarketingProBackgroundProvider().generateBackground(spec);
  assert.equal(generated.status, "ready");
  if (generated.status === "ready") {
    assert.equal(generated.asset.mimeType, "image/png");
    assert.equal(generated.output.mimeType, "image/png");
    assert.deepEqual(Array.from(generated.asset.bytes.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  }
  assert.equal(((generationPayload?.response_format as Record<string, unknown>)?.mime_type), "image/jpeg");
} finally {
  globalThis.fetch = originalFetch;
  if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalGeminiKey;
}

// Autorização de privacidade do inspetor: apenas bytes inline do background, sem contexto comercial.
assert.match(inspector, /inspectBackground\(bytes: Uint8Array, mimeType: string\)/);
const inspectorCodeOnly = inspector.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
assert.doesNotMatch(inspectorCodeOnly, /approvedCutout|ProductTruth|productId|uid|salePrice|seller/);
assert.match(inspector, /responseSchema/);
assert.doesNotMatch(inspector, /responseJsonSchema/);

// Payload multimodal real com fetch simulado: um único inlineData contém exatamente o background.
const backgroundBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
let inspectedPayload: Record<string, unknown> | undefined;
const semanticInspector = new GeminiMarketingProSemanticInspector({
  apiKey: "test-only",
  fetchImpl: (async (_url: RequestInfo | URL, init?: RequestInit) => {
    inspectedPayload = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ accepted: true, forbiddenElements: [], confidence: 0.99 }) }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch,
});
assert.equal((await semanticInspector.inspectBackground(backgroundBytes, "image/png")).accepted, true);
const inspectedJson = JSON.stringify(inspectedPayload);
assert.ok(inspectedJson.includes(backgroundBytes.toString("base64")));
for (const forbidden of ["approvedCutout", "ProductTruth", "productId", "salePrice", "sellerName", "uid"]) assert.equal(inspectedJson.includes(forbidden), false);

// Mesmo hash/model reutiliza o veredito e não faz uma segunda inspeção.
let cachedDoc: Record<string, unknown> | undefined;
let semanticCalls = 0;
const cacheDb = { collection: () => ({ doc: () => ({
  get: async () => ({ exists: Boolean(cachedDoc), data: () => cachedDoc }),
  set: async (data: Record<string, unknown>) => { cachedDoc = data; },
}) }) };
const countingInspector = { inspectBackground: async () => { semanticCalls += 1; return { accepted: true as const, confidence: 0.98 }; } };
assert.equal((await evaluateMarketingProSemanticGateCached(cacheDb, backgroundBytes, "image/png", countingInspector)).accepted, true);
assert.equal((await evaluateMarketingProSemanticGateCached(cacheDb, backgroundBytes, "image/png", countingInspector)).accepted, true);
assert.equal(semanticCalls, 1, "cache por hash/model impede inspeção duplicada");

// Input arbitrário/família inválida falham antes de qualquer provider.
assert.equal(validateMarketingProGenerateInput({ generationRequestId: "request-ok", productId: "p1", style: undefined, format: "square", creativeConceptId: "bad prompt !", creativeFamily: "luxury" }).valid, false);

console.log("PRO-13 First Real Professional Ad: 20 gates (A-T) passed; zero network/provider calls.");
