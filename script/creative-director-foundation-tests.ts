import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildCreativeDirection,
  evaluateConceptDiversity,
  type BuildCreativeDirectionInput,
} from "../shared/marketing-pro-creative-director";
import {
  createCampaignCreativeIntent,
  validateCreativeConceptSet,
  type ProductTruth,
  type SellerCreativeProfile,
} from "../shared/marketing-pro-creative-intelligence";
import { buildProductUnderstandingFallback } from "../shared/marketing-pro-product-understanding";

function truth(overrides: Partial<ProductTruth>): ProductTruth {
  return { productId: "p1", name: "Produto", category: "geral", ...overrides };
}

function sellerProfile(globalPreferences: SellerCreativeProfile["globalPreferences"], categoryPreferences?: SellerCreativeProfile["categoryPreferences"]): SellerCreativeProfile {
  return { version: 1, globalPreferences, categoryPreferences, confidence: 0.5, sampleCount: 5, updatedAt: "2026-08-20T00:00:00.000Z" };
}

function direction(input: Partial<BuildCreativeDirectionInput> & { readonly productTruth: ProductTruth }) {
  const { visualUnderstanding } = buildProductUnderstandingFallback({ truth: input.productTruth });
  return buildCreativeDirection({
    productTruth: input.productTruth,
    productUnderstanding: input.productUnderstanding ?? visualUnderstanding,
    sellerProfile: input.sellerProfile,
    campaignIntent: input.campaignIntent ?? createCampaignCreativeIntent("spotlight"),
  });
}

function run(): void {
  let externalProviderCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    externalProviderCalls += 1;
    throw new Error("external calls are forbidden in Creative Director foundation tests");
  }) as typeof fetch;

  // A. Perfume fresco + seller "dark/luxury" nunca vira dark-heavy-luxury incoerente — o pool seguro de
  // famílias vem da compreensão visual (fresh/clean), luxury nunca entra mesmo sendo o gosto declarado.
  const freshPerfumeTruth = truth({ productId: "perfume-1", name: "Perfume Fresh Ocean", category: "perfume", color: "blue" });
  const darkLuxurySeller = sellerProfile({ preferredCreativeFamilies: ["luxury"], visualStyles: ["luxury"] });
  const freshResult = direction({ productTruth: freshPerfumeTruth, sellerProfile: darkLuxurySeller });
  assert.equal(freshResult.concepts.some((c) => c.concept.creativeFamily === "luxury"), false, "A: seller pedindo luxury não pode aparecer quando o produto/entendimento visual não recomenda luxury para um perfume fresco");
  assert.ok(freshResult.concepts.every((c) => c.concept.creativeFamily !== "luxury"));

  // B. Controle vermelho → anti-camuflagem: contraste alto, sem família luxury pesada escondendo o produto.
  const redControllerTruth = truth({ productId: "controller-1", name: "Controle sem fio", category: "controle", color: "red" });
  const redResult = direction({ productTruth: redControllerTruth });
  assert.equal(redResult.brief.contrastStrategy, "high", "B: produto vermelho precisa forçar contraste alto");
  assert.ok(redResult.concepts.every((c) => c.scores.contrastScore >= 0.75), "B: nenhum conceito pode ter contrastScore baixo para um produto que exige separação forte");

  // C. Produto branco → contraste adequado (nunca branco sobre branco).
  const whiteFanTruth = truth({ productId: "fan-1", name: "Ventilador", category: "eletronico", color: "white" });
  const whiteResult = direction({ productTruth: whiteFanTruth });
  assert.equal(whiteResult.brief.contrastStrategy, "high", "C: produto branco/claro precisa de separação de fundo garantida");

  // D. Produto escuro → mesma garantia de separação.
  const darkTruth = truth({ productId: "dark-1", name: "Caixa de som", category: "eletronico", color: "black" });
  const darkResult = direction({ productTruth: darkTruth });
  assert.equal(darkResult.brief.contrastStrategy, "high", "D: produto escuro também precisa de separação garantida");

  // E. Category preference vence global quando é seguro (mesmo mecanismo do buildCreativeBrief central —
  // aqui provado através do brief embutido no resultado do Creative Director).
  const categoryOverrideSeller = sellerProfile(
    { typographyPreference: "expressive", informationDensity: "high" },
    { eletronico: { typographyPreference: "clean", informationDensity: "low" } },
  );
  const categoryResult = direction({ productTruth: whiteFanTruth, sellerProfile: categoryOverrideSeller });
  assert.equal(categoryResult.brief.typographyDirection, "clean", "E: preferência de categoria precisa vencer a global quando segura");
  assert.equal(categoryResult.brief.informationDensity, "low");

  // F. Seller preference não supera commercial coherence — já provado em A (luxury nunca some das
  // restrições), reforçado aqui com um produto de alto contraste + gosto por família avoidada.
  const redSeller = sellerProfile({ preferredCreativeFamilies: ["luxury"] });
  const redWithSellerResult = direction({ productTruth: redControllerTruth, sellerProfile: redSeller });
  assert.equal(redWithSellerResult.concepts.some((c) => c.concept.creativeFamily === "luxury"), false, "F: gosto do vendedor não pode reintroduzir uma família fora da coerência comercial do produto");

  // G. Campanha "promo" aumenta ênfase de preço/promoção em relação a "spotlight", para o MESMO produto.
  const promoResult = direction({ productTruth: freshPerfumeTruth, campaignIntent: createCampaignCreativeIntent("promo") });
  const spotlightResult = direction({ productTruth: freshPerfumeTruth, campaignIntent: createCampaignCreativeIntent("spotlight") });
  const rank = { subtle: 0, standard: 1, highlight: 2 } as const;
  const promoRank = { none: 0, subtle: 1, balanced: 2, strong: 3 } as const;
  assert.ok(rank[promoResult.brief.priceTreatment] > rank[spotlightResult.brief.priceTreatment], "G: promo precisa tratar preço com mais destaque que spotlight");
  assert.ok(promoRank[promoResult.brief.promotionTreatment] > promoRank[spotlightResult.brief.promotionTreatment], "G: promo precisa tratar promoção com mais força que spotlight");

  // H. Campanha "spotlight" mantém o produto como hero (protagonismo) — igual a qualquer campanha, mas
  // aqui provado que a decisão de objetivo visual reflete o intent escolhido.
  assert.equal(spotlightResult.brief.visualObjective, "product_highlight");
  assert.equal(spotlightResult.brief.productProminence, "hero");

  // I. Os 3 conceitos são realmente distintos — diversity gate próprio + validação central.
  for (const result of [freshResult, redResult, whiteResult, darkResult, promoResult, spotlightResult]) {
    assert.equal(result.concepts.length, 3, "I: sempre exatamente 3 conceitos");
    const diversity = evaluateConceptDiversity(result.concepts.map((c) => c.concept));
    assert.equal(diversity.diverse, true, `I: conceitos precisam diferir em pelo menos 3 eixos (obteve ${diversity.minDistinctAxes})`);
    const ids = new Set(result.concepts.map((c) => c.concept.id));
    assert.equal(ids.size, 3, "I: ids únicos");
    assert.equal(validateCreativeConceptSet(result.concepts.map((c) => c.concept)).valid, true, "I: o conjunto de conceitos passa na validação do contrato central");
  }
  // Não pode ser "A=fundo azul, B=fundo roxo, C=fundo preto com o resto igual": famílias precisam variar.
  assert.equal(new Set(freshResult.concepts.map((c) => c.concept.creativeFamily)).size, 3, "I: as 3 famílias criativas precisam ser distintas entre si");

  // J/K. Nenhum claim inferido/observado vira fato — só o que está em ProductTruth.
  const claimTruth = truth({
    productId: "claim-1", name: "Hidratante Facial", category: "cosmeticos", brand: "Marca Real", volume: "50ml",
  });
  const claimResult = direction({
    productTruth: claimTruth,
    productUnderstanding: {
      version: 1, sourceImageAssetId: "asset-1",
      observed: { dominantColors: ["pink"] },
      inferred: { visualMoodCandidates: ["luxurious glow", "silky texture"], commercialToneCandidates: ["premium spa feeling"] },
      confidence: 0.7,
    },
  });
  assert.ok(claimResult.brief.allowedClaims.some((claim) => claim.field === "brand" && claim.value === "Marca Real"), "K: claim confiável do ProductTruth precisa ser preservado");
  assert.ok(claimResult.brief.allowedClaims.some((claim) => claim.field === "volume" && claim.value === "50ml"));
  assert.equal(claimResult.brief.allowedClaims.some((claim) => String(claim.value).includes("luxurious glow")), false, "J: sinal OBSERVADO nunca pode virar claim factual");
  assert.equal(claimResult.brief.allowedClaims.some((claim) => String(claim.value).includes("premium spa feeling")), false, "J: sinal INFERIDO nunca pode virar claim factual");
  assert.ok(claimResult.brief.forbiddenClaims.some((entry) => entry.includes("observed")));
  assert.ok(claimResult.brief.forbiddenClaims.some((entry) => entry.includes("inference")));

  // L. Confiança baixa usa fallback conservador — famílias seguras/neutras, nunca uma família de nicho
  // "arriscada" (ex.: sensory/fresh-sport) só porque um sinal fraco sugeriu isso.
  const lowConfidenceUnderstanding = {
    version: 1 as const, sourceImageAssetId: "asset-low",
    observed: {},
    inferred: { recommendedCreativeFamilies: ["sensory", "fresh-sport", "luxury"] as const },
    confidence: 0.1,
  };
  const lowConfidenceResult = buildCreativeDirection({
    productTruth: truth({ productId: "low-conf-1" }),
    productUnderstanding: lowConfidenceUnderstanding,
    campaignIntent: createCampaignCreativeIntent("spotlight"),
  });
  const safeFamilies = new Set(["editorial", "modern", "minimal"]);
  assert.ok(lowConfidenceResult.concepts.every((c) => safeFamilies.has(c.concept.creativeFamily)), "L: confiança baixa precisa preferir famílias seguras/neutras, ignorando recomendações específicas de baixa confiança");
  assert.ok(lowConfidenceResult.decisionTrace.some((entry) => entry.rule === "low_confidence_prefers_safe_neutral_families"));

  // M. CreativeDecisionTrace estruturado — decision/source/rule/result em toda entrada, nunca prosa livre.
  for (const entry of freshResult.decisionTrace) {
    assert.equal(typeof entry.decision, "string");
    assert.ok(["product_truth", "commercial_coherence", "campaign_objective", "seller_preferences"].includes(entry.source), `M: source precisa ser um dos 4 valores da hierarquia central, recebeu "${entry.source}"`);
    assert.equal(typeof entry.rule, "string");
    assert.equal(typeof entry.result, "string");
  }
  assert.ok(freshResult.decisionTrace.some((entry) => entry.decision === "conceptDiversityGate"));

  // N/O/P. Provider-agnostic, zero chamada externa, zero custo — checado via fetch interceptado (acima)
  // e via varredura estática do código-fonte (sem import de rede/Firebase/SDK de IA).
  const directorSource = fs.readFileSync("shared/marketing-pro-creative-director.ts", "utf8");
  const importLines = directorSource.match(/^import .*$/gm) || [];
  assert.equal(importLines.some((line) => /google|gemini|openai|firebase|server\/|client\//i.test(line)), false, "N: o Creative Director não pode depender de provider/Firebase/client/server");
  assert.equal(/\bfetch\s*\(/.test(directorSource), false, "O: nenhuma chamada de rede no Creative Director");
  assert.doesNotMatch(directorSource, /GEMINI_API_KEY|GOOGLE_API_KEY|PHOTOROOM|costMicrousd|reserveMarketingProBackgroundBudget/, "P: nenhum custo/crédito de provider é lido por este módulo");

  // Q. Produto original não é alterado — ProductTruth de entrada permanece byte-a-byte igual.
  const beforeSnapshot = JSON.stringify(freshPerfumeTruth);
  direction({ productTruth: freshPerfumeTruth, sellerProfile: darkLuxurySeller });
  assert.equal(JSON.stringify(freshPerfumeTruth), beforeSnapshot, "Q: o ProductTruth de entrada nunca pode ser mutado");

  // R. Determinismo — o MESMO input produz o MESMO resultado, sempre.
  const runA = direction({ productTruth: freshPerfumeTruth, sellerProfile: darkLuxurySeller, campaignIntent: createCampaignCreativeIntent("promo") });
  const runB = direction({ productTruth: freshPerfumeTruth, sellerProfile: darkLuxurySeller, campaignIntent: createCampaignCreativeIntent("promo") });
  assert.equal(JSON.stringify(runA), JSON.stringify(runB), "R: mesmo input precisa produzir o mesmo output, sempre — nenhuma aleatoriedade");

  globalThis.fetch = originalFetch;
  assert.equal(externalProviderCalls, 0, "zero chamadas externas em toda a suíte");

  console.log("Creative Director Foundation: 18 invariants (A-R) passed; external provider calls=0; paid calls=0.");
}

run();
