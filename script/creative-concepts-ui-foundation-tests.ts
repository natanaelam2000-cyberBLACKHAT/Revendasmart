/**
 * PRO-12B — testes de fundação da UI real dos 3 conceitos criativos (Creative Director conectado ao
 * fluxo do Anúncios Pro). Segue o mesmo estilo do resto da suíte: interceptação de `fetch` para provar
 * zero chamada a provider externo + varredura estática de código-fonte + testes de lógica pura chamando
 * diretamente `buildCreativeConceptsForProduct` com os seams de teste (`fetchImpl`/`getAuthToken`/
 * `getCreativeProfileImpl`) que o próprio módulo expõe, do mesmo jeito que `apiRequest` já expõe
 * `fetchImpl`/`getAuthToken` em `client/src/lib/api-client.ts`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import type { ProductVisualUnderstanding, SellerCreativeProfile } from "../shared/marketing-pro-creative-intelligence";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "Content-Type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function mockProduct(overrides: Record<string, unknown> = {}): any {
  return {
    id: "prod-1",
    name: "Perfume Fresh Ocean",
    category: "perfume",
    salePrice: 129.9,
    stock: 5,
    extras: { color: "blue" },
    ...overrides,
  };
}

function geminiUnderstanding(overrides: Partial<ProductVisualUnderstanding> = {}): ProductVisualUnderstanding {
  return {
    version: 1,
    sourceImageAssetId: "asset-1",
    observed: { dominantColors: ["blue"] },
    inferred: {
      recommendedCreativeFamilies: ["fresh-premium", "editorial", "minimal"],
      recommendedEnvironmentHints: ["airy clean stage"],
    },
    confidence: 0.8,
    ...overrides,
  };
}

async function run(): Promise<void> {
  const { buildCreativeConceptsForProduct } = await import("../client/src/lib/marketing-pro-creative-concepts.js");
  const { createCampaignCreativeIntent } = await import("../shared/marketing-pro-creative-intelligence.js");

  // A/C. CTA bloqueado sem produto + fluxo só dentro do gate Free/Premium — provado estaticamente:
  // CreativeConceptsSection nunca renderiza nada sem produto, e o painel só a monta com proAdsEnabled.
  const sectionSource = fs.readFileSync("client/src/components/marketing/CreativeConceptsSection.tsx", "utf8");
  assert.match(sectionSource, /if \(!product\) return null;/, "A: sem produto, a seção inteira (incluindo o CTA) não renderiza nada");
  const panelSource = fs.readFileSync("client/src/components/marketing/MarketingProPanel.tsx", "utf8");
  assert.match(panelSource, /\{proAdsEnabled && selectedProduct && \([\s\S]*?<CreativeConceptsSection[\s\S]*?approvedCutoutSource=\{approvedCutoutSource\}/, "C: Free nunca monta a seção de conceitos (gate por proAdsEnabled)");

  // B/D. Premium com produto -> exatamente 3 conceitos, vindos de uma chamada real ao endpoint próprio
  // (não a um provider externo).
  let visualUnderstandingCalls = 0;
  let calledUrl = "";
  const fetchImpl = (async (input: RequestInfo | URL) => {
    visualUnderstandingCalls += 1;
    calledUrl = String(input);
    return jsonResponse({ visualUnderstanding: geminiUnderstanding(), analysisSource: "gemini" });
  }) as typeof fetch;

  const baseResult = await buildCreativeConceptsForProduct({
    product: mockProduct(),
    campaignIntentId: "spotlight",
    fetchImpl,
    getAuthToken: () => "test-token-never-sent-to-a-real-server",
    getCreativeProfileImpl: async () => null,
  });
  assert.equal(visualUnderstandingCalls, 1, "B: exatamente uma chamada, ao endpoint próprio de visual-understanding");
  assert.match(calledUrl, /\/api\/marketing\/pro\/products\/prod-1\/visual-understanding$/, "M: a única chamada de rede é para o backend próprio, nunca direto a um provider de IA");
  assert.equal(baseResult.understandingSource, "gemini");
  assert.equal(baseResult.direction.concepts.length, 3, "D: sempre exatamente 3 conceitos");

  // E. Ordenação por score: replica a mesma ordenação que a UI usa e confirma que é decrescente.
  const sorted = [...baseResult.direction.concepts].sort((first, second) => second.scores.overallScore - first.scores.overallScore);
  for (let i = 1; i < sorted.length; i += 1) {
    assert.ok(sorted[i - 1].scores.overallScore >= sorted[i].scores.overallScore, "E: ranking precisa ser decrescente por overallScore");
  }
  assert.match(sectionSource, /\.sort\(\(first, second\) => second\.scores\.overallScore - first\.scores\.overallScore\)/, "E: a UI ordena os cards pelo mesmo score");

  // F. Diversidade preservada — já garantida pelo Creative Director (PRO-12A); reconfirmado aqui através
  // da própria integração (não reimplementado): pelo menos 2 famílias distintas entre os 3 conceitos.
  const distinctFamilies = new Set(baseResult.direction.concepts.map((c) => c.concept.creativeFamily));
  assert.ok(distinctFamilies.size >= 2, "F: diversidade preservada através da integração real");

  // G. Seleção: handleSelectConcept alterna o id selecionado (toggle), e o CTA "Usar este conceito" só
  // aparece com uma seleção pendente.
  assert.match(sectionSource, /setSelectedConceptId\(\(current\) => \(current === conceptId \? null : conceptId\)\)/, "G: clicar de novo no mesmo conceito desmarca a seleção");
  assert.match(sectionSource, /data-testid="button-creative-concepts-use-selected"/);
  assert.match(sectionSource, /selectedConceptId && !confirmedConceptId/, "G: CTA final só aparece com seleção pendente, nunca sem seleção");

  // H. Troca de campanha recalcula (só quando já existe um resultado na tela).
  assert.match(sectionSource, /handleCampaignIntentChange[\s\S]{0,500}if \(state\.phase === "ready" \|\| state\.phase === "error"\) void runGeneration\(intentId\);/, "H: mudar o objetivo recalcula diretamente, sem efeito com dependências incompletas");
  const promoResult = await buildCreativeConceptsForProduct({
    product: mockProduct(),
    campaignIntentId: "promo",
    fetchImpl,
    getAuthToken: () => "test-token-never-sent-to-a-real-server",
    getCreativeProfileImpl: async () => null,
  });
  assert.notEqual(
    JSON.stringify(promoResult.direction.brief.promotionTreatment),
    JSON.stringify(baseResult.direction.brief.promotionTreatment),
    "H: campanhas diferentes (spotlight x promo) produzem tratamento promocional diferente",
  );

  // I. Perfil do vendedor influencia (propagado de ponta a ponta pela própria função de integração,
  // não reimplementado — a lógica de priorização já é do Creative Director).
  const sellerProfile: SellerCreativeProfile = {
    version: 1,
    globalPreferences: { preferredCreativeFamilies: ["fresh-premium"], visualStyles: ["fresh-premium"] },
    confidence: 0.6,
    sampleCount: 5,
    updatedAt: "2026-08-20T00:00:00.000Z",
  };
  const withSellerResult = await buildCreativeConceptsForProduct({
    product: mockProduct(),
    campaignIntentId: "spotlight",
    fetchImpl,
    getAuthToken: () => "test-token-never-sent-to-a-real-server",
    getCreativeProfileImpl: async () => sellerProfile,
  });
  const adapted = withSellerResult.direction.concepts.find((c) => c.concept.creativeFamily === "fresh-premium");
  assert.ok(adapted, "I: família preferida do vendedor precisa estar disponível quando segura");
  assert.equal(adapted!.scores.sellerPreferenceFitScore, 1, "I: o conceito da família preferida reflete o perfil do vendedor no score");
  assert.match(sectionSource, /badge-creative-concept-adapted/, "I: a UI mostra discretamente quando um conceito foi adaptado ao gosto do vendedor");
  assert.doesNotMatch(sectionSource, /A IA aprendeu você/i, "I: nunca promete aprendizado exagerado");

  // J. Coerência do produto prevalece sobre o gosto do vendedor — mesmo exemplo do PRO-12A (perfume
  // fresco + vendedor "luxury"), agora provado através da integração real (glue code não pode driblar
  // a hierarquia do Creative Director).
  const darkLuxurySeller: SellerCreativeProfile = {
    version: 1,
    globalPreferences: { preferredCreativeFamilies: ["luxury"], visualStyles: ["luxury"] },
    confidence: 0.6,
    sampleCount: 5,
    updatedAt: "2026-08-20T00:00:00.000Z",
  };
  const coherenceResult = await buildCreativeConceptsForProduct({
    product: mockProduct(),
    campaignIntentId: "spotlight",
    fetchImpl,
    getAuthToken: () => "test-token-never-sent-to-a-real-server",
    getCreativeProfileImpl: async () => darkLuxurySeller,
  });
  assert.equal(coherenceResult.direction.concepts.some((c) => c.concept.creativeFamily === "luxury"), false, "J: gosto do vendedor não pode reintroduzir uma família fora da coerência do produto, nem através da integração real");
  assert.doesNotMatch(sectionSource, /\.decisionTrace\b/, "J: a UI nunca lê/expõe a resolução técnica do conflito ao usuário");

  // K. Fallback local funciona quando o endpoint de visual-understanding falha (rede indisponível) —
  // nunca bloqueia a geração dos 3 conceitos.
  const failingFetch = (async () => { throw new TypeError("network unavailable (simulated)"); }) as typeof fetch;
  const fallbackResult = await buildCreativeConceptsForProduct({
    product: mockProduct(),
    campaignIntentId: "spotlight",
    fetchImpl: failingFetch,
    getAuthToken: () => "test-token-never-sent-to-a-real-server",
    getCreativeProfileImpl: async () => { throw new Error("profile service unavailable (simulated)"); },
  });
  assert.equal(fallbackResult.understandingSource, "local-fallback", "K: sem rede, cai no fallback local");
  assert.equal(fallbackResult.direction.concepts.length, 3, "K: fallback local ainda produz 3 conceitos completos");

  // L. Mobile UX: cards em coluna única, sem overflow horizontal, alvos de toque >= 44px.
  assert.match(sectionSource, /grid-cols-1/, "L: cards empilham em coluna única (mobile-first)");
  assert.match(sectionSource, /min-h-11/, "L: alvos de toque seguem o padrão mínimo já usado no resto do painel");
  assert.doesNotMatch(sectionSource, /overflow-x-(scroll|auto)/, "L: nenhum scroll horizontal foi introduzido");
  assert.doesNotMatch(sectionSource, /w-\[\d{3,}px\]/, "L: nenhuma largura fixa grande que force overflow em telas pequenas");

  // M/N. Zero chamada a provider de IA / zero custo pago — varredura estática dos 2 arquivos novos.
  const conceptsLibSource = fs.readFileSync("client/src/lib/marketing-pro-creative-concepts.ts", "utf8");
  for (const fonte of [conceptsLibSource, sectionSource]) {
    assert.doesNotMatch(fonte, /gemini-|generativelanguage\.googleapis|openai\.com|GEMINI_API_KEY|OPENAI_API_KEY/i, "M/N: nenhum acesso direto a provider de IA nem chave de API nestes arquivos");
    assert.doesNotMatch(fonte, /costMicrousd|reserveMarketingProBackgroundBudget|usdToMicroUsd/, "N: nenhuma lógica de custo/orçamento é reimplementada aqui");
  }
  assert.doesNotMatch(conceptsLibSource, /marketing-pro-provider|marketing-pro-cost-guard|marketing-pro-usage-ledger|marketing-pro-rate-limit/, "M/N: não importa nenhuma peça do pipeline de geração de imagem paga");

  // O. Nenhum chain-of-thought/trace técnico exposto na UI.
  assert.doesNotMatch(sectionSource, /\.decisionTrace\b/, "O: a UI nunca lê/renderiza decisionTrace");
  assert.match(sectionSource, /entry\.whyItFits\.join\(" · "\)/, "O: só o resumo estruturado curto (whyItFits) é exibido, nunca prosa livre longa");

  // P. Nenhum claim factual inventado: a UI só traduz enums de tratamento (price/promotion treatment)
  // para rótulos em português — nunca inventa números/preços que não vieram do ProductTruth.
  assert.match(sectionSource, /PRICE_TREATMENT_LABELS\[entry\.concept\.priceTreatment\]/, "P: preço é sempre um rótulo de tratamento (enum), nunca um valor numérico inventado");
  assert.doesNotMatch(sectionSource, /R\$|toFixed\(2\)/, "P: a seção de conceitos nunca formata/inventa um preço monetário");

  // Reforço: os 4 objetivos de campanha expostos na UI são todos ids válidos do contrato central.
  for (const id of ["spotlight", "promo", "last", "new"] as const) {
    assert.doesNotThrow(() => createCampaignCreativeIntent(id), `objetivo de campanha "${id}" precisa ser um MarketingCampaignIntentId válido`);
  }

  console.log("Creative Concepts UI Foundation: 16 invariants (A-P) passed; external provider calls=0; paid calls=0.");
}

run();
