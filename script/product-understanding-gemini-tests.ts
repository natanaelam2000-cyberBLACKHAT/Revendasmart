import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ProductTruth, ProductVisualUnderstanding } from "../shared/marketing-pro-creative-intelligence";
import { parseProductVisualUnderstandingOutput, type ProductVisualAnalyzer } from "../shared/marketing-pro-product-understanding";
import { resolveMarketingProEntitlement } from "../server/marketing-pro";
import { GeminiProductVisualAnalyzer, GeminiProductVisualAnalyzerError } from "../server/marketing-pro-product-visual-analyzer-google";
import { resolveOwnedProductImageSource, resolveProductUnderstanding, type ProductUnderstandingCacheRecord } from "../server/marketing-pro-product-understanding";
import { generateProductTestPng } from "../tests/e2e/support/png";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const png = generateProductTestPng(12, 12, [210, 20, 35]);
const truth: ProductTruth = {
  productId: "product-1",
  name: "Produto confidencial",
  category: "cosméticos",
  color: "vermelho",
  salePrice: 199.9,
  description: "descrição não deve sair",
  imageAsset: { imageId: "asset-a", storagePath: "users/user-a/products/product-1/derived-upload.png" },
};
const visual = (assetId: string): ProductVisualUnderstanding => ({
  version: 1,
  sourceImageAssetId: assetId,
  observed: { dominantColors: ["red"], perceivedBrightness: "balanced", visualComplexity: "low" },
  inferred: {
    contrastNeeds: ["separation"],
    recommendedBackgroundContrast: "soft",
    visualMoodCandidates: ["clean"],
    commercialToneCandidates: ["premium"],
    recommendedCreativeFamilies: ["editorial"],
    avoidCreativeFamilies: [],
    recommendedEnvironmentHints: ["monochrome red studio"],
    avoidEnvironmentHints: [],
  },
  confidence: 0.82,
});

function geminiResponse(candidate: unknown): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(candidate) }] } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function main(): Promise<void> {
  let calls = 0;
  const analyzer: ProductVisualAnalyzer & { readonly model: string } = {
    id: "mock-v1",
    model: "mock-multimodal-cheap",
    async analyzeProductVisual(input) { calls += 1; return visual(input.image.assetId); },
  };
  const loadImage = async () => ({ bytes: png, mimeType: "image/png" });
  const sourceA = { assetId: "asset-a", storagePath: truth.imageAsset!.storagePath! };

  // A — a mesma autoridade server-side nega Free antes da rota/provider.
  assert.equal(resolveMarketingProEntitlement({ currentPlan: "free" } as any).allowed, false);
  assert.equal(calls, 0);

  // B — flag OFF não toca cache, Storage ou provider.
  const off = await resolveProductUnderstanding({ enabled: false, truth, source: sourceA, analyzer, loadImage: async () => { throw new Error("must not load"); } });
  assert.equal(off.analysisSource, "fallback");
  assert.equal(calls, 0);

  // C/D/E — chamada única, cache hit, asset novo gera chamada nova.
  const cache = new Map<string, ProductUnderstandingCacheRecord>();
  const runtime = (source: typeof sourceA) => ({
    enabled: true, truth, source, analyzer, loadImage,
    readCache: async (key: string) => cache.get(key) || null,
    writeCache: async (key: string, value: ProductUnderstandingCacheRecord) => { cache.set(key, value); },
  });
  const first = await resolveProductUnderstanding(runtime(sourceA));
  assert.equal(first.analysisSource, "gemini");
  assert.equal(first.metadata.cached, false);
  assert.equal(calls, 1);
  const second = await resolveProductUnderstanding(runtime(sourceA));
  assert.equal(second.metadata.cached, true);
  assert.equal(calls, 1);
  await resolveProductUnderstanding(runtime({ ...sourceA, assetId: "asset-b" }));
  assert.equal(calls, 2);
  const changedBytes = generateProductTestPng(12, 12, [20, 60, 210]);
  await resolveProductUnderstanding({ ...runtime(sourceA), loadImage: async () => ({ bytes: changedBytes, mimeType: "image/png" }) });
  assert.equal(calls, 3);
  const callsBeforeCoalesced = calls;
  const coalesced = await resolveProductUnderstanding({ enabled: true, truth, source: sourceA, analyzer, loadImage, reserveAnalysis: async () => false });
  assert.equal(coalesced.analysisSource, "fallback");
  assert.equal(calls, callsBeforeCoalesced);

  // F/G — ProductTruth é imutável e o output não tem fatos/claims.
  const truthSnapshot = JSON.stringify(truth);
  await resolveProductUnderstanding(runtime(sourceA));
  assert.equal(JSON.stringify(truth), truthSnapshot);
  assert.equal("truth" in first.visualUnderstanding, false);
  assert.equal("allowedClaims" in first.visualUnderstanding, false);

  // H/I — parser canônico fail-closed.
  assert.equal(parseProductVisualUnderstandingOutput({ ...visual("asset-a"), extra: true }).accepted, false);
  assert.equal(parseProductVisualUnderstandingOutput({ ...visual("asset-a"), confidence: 1.1 }).accepted, false);

  // J — recomendação vermelha é removida; regra local exige contraste alto e registra avoid.
  assert.equal(first.visualUnderstanding.inferred.recommendedBackgroundContrast, "high");
  assert.equal(first.visualUnderstanding.inferred.recommendedEnvironmentHints?.some((hint) => /red|vermelh/i.test(hint)), false);
  assert.equal(first.visualUnderstanding.inferred.avoidEnvironmentHints?.includes("monochrome red background close to product color"), true);

  // K — falha do provider cai no fallback.
  const failing: ProductVisualAnalyzer = { id: "fail-v1", async analyzeProductVisual() { throw new Error("provider down"); } };
  const failed = await resolveProductUnderstanding({ enabled: true, truth, source: sourceA, analyzer: failing, loadImage });
  assert.equal(failed.analysisSource, "fallback");

  // L — só paths canônicos do mesmo tenant/produto.
  assert.ok(resolveOwnedProductImageSource("user-a", "product-1", truth));
  assert.equal(resolveOwnedProductImageSource("user-b", "product-1", truth), null);
  assert.equal(resolveOwnedProductImageSource("user-a", "product-2", truth), null);

  // M/N + boundary real mockado: chave só em header; nenhum identificador/preço/PII no body.
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const strictAnalyzer = new GeminiProductVisualAnalyzer({
    apiKey: "server-secret",
    fetchImpl: async (url, init) => {
      requestUrl = String(url); requestInit = init;
      const raw = visual("asset-a");
      return geminiResponse({ observed: raw.observed, inferred: raw.inferred, confidence: raw.confidence });
    },
  });
  await strictAnalyzer.analyzeProductVisual({ image: { assetId: "asset-a", mimeType: "image/png", bytes: png }, trustedContext: { category: truth.category, color: truth.color } });
  assert.equal(requestUrl.includes("server-secret"), false);
  assert.equal(new Headers(requestInit!.headers).get("x-goog-api-key"), "server-secret");
  const requestBody = String(requestInit!.body);
  for (const forbidden of [truth.productId, truth.name, String(truth.salePrice), truth.description!, "user-a"]) assert.equal(requestBody.includes(forbidden), false);
  const clientFiles = fs.readdirSync(path.join(root, "client", "src"), { recursive: true }).filter((entry) => String(entry).endsWith(".ts") || String(entry).endsWith(".tsx"));
  for (const entry of clientFiles) {
    const source = fs.readFileSync(path.join(root, "client", "src", String(entry)), "utf8");
    assert.doesNotMatch(source, /marketing-pro-product-visual-analyzer-google|generativelanguage\.googleapis\.com/);
  }

  // H adicional no adapter: root extra não pode sobrescrever assetId local.
  const extraAnalyzer = new GeminiProductVisualAnalyzer({ apiKey: "x", fetchImpl: async () => geminiResponse({ observed: {}, inferred: {}, confidence: 0.5, sourceImageAssetId: "attacker" }) });
  await assert.rejects(() => extraAnalyzer.analyzeProductVisual({ image: { assetId: "asset-a", mimeType: "image/png", bytes: png }, trustedContext: {} }), GeminiProductVisualAnalyzerError);

  // O — AbortController encerra a única tentativa; orquestrador retorna fallback.
  let timeoutCalls = 0;
  const timeoutAnalyzer = new GeminiProductVisualAnalyzer({
    apiKey: "x", timeoutMs: 5,
    fetchImpl: async (_url, init) => {
      timeoutCalls += 1;
      return await new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
    },
  });
  const timedOut = await resolveProductUnderstanding({ enabled: true, truth, source: sourceA, analyzer: timeoutAnalyzer, loadImage });
  assert.equal(timedOut.analysisSource, "fallback");
  assert.equal(timeoutCalls, 1);

  console.log("PRO-11B tests A-O: PASS");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
