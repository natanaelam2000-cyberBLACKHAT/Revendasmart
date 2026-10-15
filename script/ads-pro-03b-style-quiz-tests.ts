/**
 * ADS-PRO-03B — Suíte de Testes Profunda do Quiz Visual V1 e Scoring Determinístico
 *
 * Cobertura Completa:
 * 1. Contrato da Definição do Quiz (Q-01 a Q-07)
 * 2. Validação de Submissões (S-01 a S-11)
 * 3. Avaliação, Scoring e Desempate (R-01 a R-09)
 * 4. Integração End-to-End com CreativeProfile e Matcher (E-01 a E-05)
 * 5. Auditoria Estática de Pureza e Determinismo (PUR-01 a PUR-02)
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { AssetDNA, AssetLibraryManifest } from "../shared/ads-pro/asset-dna";
import { rankAdsProAssets } from "../shared/ads-pro/asset-matcher";
import { parseAdsProCreativeProfile } from "../shared/ads-pro/creative-profile";
import {
  ADS_PRO_STYLE_QUIZ_DEFINITION_V1,
  ADS_PRO_STYLE_QUIZ_SCHEMA_VERSION,
  QUIZ_QUESTION_IDS,
  QUIZ_STYLE_TIE_BREAK_ORDER,
  evaluateStyleQuiz,
  parseAdsProStyleQuizSubmission,
  resolveCreativeProfileFromQuiz,
  resolveQuizAssetMatchContext,
  validateStyleQuizDefinition,
  type AdsProStyleQuizSubmission,
} from "../shared/ads-pro/style-quiz";
import { isMarketingProStyle } from "../shared/marketing-pro-contract";

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  for (const key of Object.keys(obj)) {
    const val = (obj as Record<string, unknown>)[key];
    if (val !== null && typeof val === "object") {
      deepFreeze(val);
    }
  }
  return Object.freeze(obj);
}

function createSyntheticAsset(partial: Partial<AssetDNA> & { id: string }): AssetDNA {
  return {
    id: partial.id,
    entityKinds: partial.entityKinds ?? ["product"],
    targetCategories: partial.targetCategories ?? [],
    styles: partial.styles ?? ["minimal"],
    supportedIntents: partial.supportedIntents ?? [],
    formats: partial.formats ?? ["portrait", "square"],
    status: partial.status ?? "active",
    resource: partial.resource ?? {
      type: "static",
      uri: `assets/${partial.id}.png`,
    },
    tags: partial.tags ?? ["synthetic"],
    luminance: partial.luminance ?? "dark",
    subjectZone: partial.subjectZone ?? { x: 0.2, y: 0.3, width: 0.6, height: 0.5 },
  };
}

function runTests() {
  console.log("=== INICIANDO SUÍTE ADS-PRO-03B (STYLE QUIZ V1) ===");
  let assertionCount = 0;

  function countAssert(fn: () => void) {
    fn();
    assertionCount += 1;
  }

  // =========================================================================
  // 1. CONTRATO DA DEFINIÇÃO DO QUIZ (Q-01 a Q-07)
  // =========================================================================
  console.log("-> 1. Contrato da Definição do Quiz (Q-01 a Q-07)");

  // Q-01: Quiz definition possui IDs únicos
  countAssert(() => {
    const errors = validateStyleQuizDefinition(ADS_PRO_STYLE_QUIZ_DEFINITION_V1);
    assert.strictEqual(errors.length, 0, "Q-01: Definição canônica deve ser válida");
  });

  // Q-02: Question IDs canônicos (exatamente 5 perguntas visuais V1)
  countAssert(() => {
    assert.strictEqual(
      ADS_PRO_STYLE_QUIZ_DEFINITION_V1.questions.length,
      5,
      "Q-02: V1 deve conter exatamente 5 decisões visuais (faixa de 4 a 6)"
    );
    const defQuestionIds = ADS_PRO_STYLE_QUIZ_DEFINITION_V1.questions.map((q) => q.id);
    assert.deepStrictEqual(
      defQuestionIds,
      [...QUIZ_QUESTION_IDS],
      "Q-02: Question IDs devem ser canônicos e corresponder a QUIZ_QUESTION_IDS"
    );
  });

  // Q-03: Option IDs únicos dentro de cada pergunta
  countAssert(() => {
    for (const q of ADS_PRO_STYLE_QUIZ_DEFINITION_V1.questions) {
      const optionIds = q.options.map((o) => o.id);
      const uniqueIds = new Set(optionIds);
      assert.strictEqual(
        uniqueIds.size,
        optionIds.length,
        `Q-03: Pergunta "${q.id}" possui IDs de opções duplicados`
      );
    }
  });

  // Q-04: Mappings usam apenas MarketingProStyle
  countAssert(() => {
    for (const q of ADS_PRO_STYLE_QUIZ_DEFINITION_V1.questions) {
      for (const o of q.options) {
        for (const award of o.awards) {
          assert.strictEqual(
            isMarketingProStyle(award.style),
            true,
            `Q-04: Estilo "${award.style}" na opção "${o.id}" deve ser um MarketingProStyle válido`
          );
        }
      }
    }
  });

  // Q-05: Nenhuma CreativeFamily / fresh-* permitida no mapping
  countAssert(() => {
    const jsonStr = JSON.stringify(ADS_PRO_STYLE_QUIZ_DEFINITION_V1);
    assert.strictEqual(
      jsonStr.includes("fresh-"),
      false,
      "Q-05: Nenhuma família sazonal fresh-* pode existir no quiz"
    );
    assert.strictEqual(
      jsonStr.includes("creativeFamily"),
      false,
      "Q-05: creativeFamily continua estritamente DEFERRED"
    );
  });

  // Q-06: Nenhuma pergunta injeta category ou intent
  countAssert(() => {
    const rawDef = ADS_PRO_STYLE_QUIZ_DEFINITION_V1 as unknown as Record<string, unknown>;
    assert.strictEqual(rawDef.category, undefined, "Q-06: Quiz não pode conter category");
    assert.strictEqual(rawDef.intent, undefined, "Q-06: Quiz não pode conter intent");
    for (const q of ADS_PRO_STYLE_QUIZ_DEFINITION_V1.questions) {
      const rawQ = q as unknown as Record<string, unknown>;
      assert.strictEqual(rawQ.category, undefined);
      assert.strictEqual(rawQ.intent, undefined);
    }
  });

  // Q-07: Definição do quiz imutável
  countAssert(() => {
    assert.strictEqual(
      Object.isFrozen(ADS_PRO_STYLE_QUIZ_DEFINITION_V1),
      true,
      "Q-07: Raiz da definição deve ser congelada"
    );
    assert.strictEqual(
      Object.isFrozen(ADS_PRO_STYLE_QUIZ_DEFINITION_V1.questions),
      true,
      "Q-07: Lista de perguntas deve ser congelada"
    );
  });

  // =========================================================================
  // 2. VALIDAÇÃO DE SUBMISSÕES (S-01 a S-11)
  // =========================================================================
  console.log("-> 2. Validação de Submissões (S-01 a S-11)");

  // S-01: Submission vazia válida (tanto [] quanto { answers: [] })
  countAssert(() => {
    const resArr = parseAdsProStyleQuizSubmission([]);
    assert.strictEqual(resArr.ok, true, "S-01: Array vazio [] deve ser válido");
    if (resArr.ok) {
      assert.deepStrictEqual(resArr.value.answers, []);
    }

    const resObj = parseAdsProStyleQuizSubmission({ answers: [] });
    assert.strictEqual(resObj.ok, true, "S-01: Objeto { answers: [] } deve ser válido");
    if (resObj.ok) {
      assert.deepStrictEqual(resObj.value.answers, []);
    }
  });

  // S-02: Submission parcial válida (ex: 2 de 5 perguntas respondidas)
  countAssert(() => {
    const input = [
      { questionId: "visual_composition", optionId: "comp_minimal" },
      { questionId: "visual_lighting", optionId: "light_dramatic" },
    ];
    const res = parseAdsProStyleQuizSubmission(input);
    assert.strictEqual(res.ok, true, "S-02: Submissão parcial deve ser aceita");
    if (res.ok) {
      assert.strictEqual(res.value.answers.length, 2);
    }
  });

  // S-03: Submission completa válida (todas as 5 perguntas)
  countAssert(() => {
    const input = {
      answers: [
        { questionId: "visual_composition", optionId: "comp_minimal" },
        { questionId: "visual_lighting", optionId: "light_dramatic" },
        { questionId: "visual_atmosphere", optionId: "atmo_prestigious" },
        { questionId: "visual_density", optionId: "density_spacious" },
        { questionId: "brand_expression", optionId: "expr_exclusive" },
      ],
    };
    const res = parseAdsProStyleQuizSubmission(input);
    assert.strictEqual(res.ok, true, "S-03: Submissão completa deve ser aceita");
    if (res.ok) {
      assert.strictEqual(res.value.answers.length, 5);
    }
  });

  // S-04: Duplicate question rejeitada com erro estruturado
  countAssert(() => {
    const input = [
      { questionId: "visual_composition", optionId: "comp_minimal" },
      { questionId: "visual_composition", optionId: "comp_editorial" },
    ];
    const res = parseAdsProStyleQuizSubmission(input);
    assert.strictEqual(res.ok, false, "S-04: Pergunta duplicada deve ser rejeitada");
    if (!res.ok) {
      assert.strictEqual(
        res.errors.some((e) => e.code === "DUPLICATE_QUESTION"),
        true
      );
    }
  });

  // S-05: Question desconhecida rejeitada
  countAssert(() => {
    const input = [{ questionId: "unknown_question_id", optionId: "comp_minimal" }];
    const res = parseAdsProStyleQuizSubmission(input);
    assert.strictEqual(res.ok, false, "S-05: Question ID desconhecida deve ser rejeitada");
    if (!res.ok) {
      assert.strictEqual(
        res.errors.some((e) => e.code === "UNKNOWN_QUESTION"),
        true
      );
    }
  });

  // S-06: Option inválida/vazia rejeitada
  countAssert(() => {
    const input = [{ questionId: "visual_composition", optionId: "" }];
    const res = parseAdsProStyleQuizSubmission(input);
    assert.strictEqual(res.ok, false, "S-06: Option vazia deve ser rejeitada");
    if (!res.ok) {
      assert.strictEqual(
        res.errors.some((e) => e.code === "INVALID_OPTION_ID"),
        true
      );
    }
  });

  // S-07: Option pertencente a outra pergunta rejeitada
  countAssert(() => {
    // light_dramatic pertence à pergunta visual_lighting, não visual_composition
    const input = [{ questionId: "visual_composition", optionId: "light_dramatic" }];
    const res = parseAdsProStyleQuizSubmission(input);
    assert.strictEqual(res.ok, false, "S-07: Option de outra pergunta deve ser rejeitada");
    if (!res.ok) {
      assert.strictEqual(
        res.errors.some((e) => e.code === "INVALID_OPTION_FOR_QUESTION"),
        true
      );
    }
  });

  // S-08: Unknown key de topo rejeitada
  countAssert(() => {
    const input = {
      answers: [],
      unknownProp: "test",
    };
    const res = parseAdsProStyleQuizSubmission(input);
    assert.strictEqual(res.ok, false, "S-08: Chave desconhecida deve ser rejeitada");
    if (!res.ok) {
      assert.strictEqual(
        res.errors.some((e) => e.code === "UNKNOWN_KEY"),
        true
      );
    }
  });

  // S-09: Score enviado pelo cliente rejeitado
  countAssert(() => {
    const input = {
      answers: [],
      score: { minimal: 10 },
    };
    const res = parseAdsProStyleQuizSubmission(input);
    assert.strictEqual(res.ok, false, "S-09: Score do cliente deve ser rejeitado");
    if (!res.ok) {
      assert.strictEqual(
        res.errors.some((e) => e.code === "UNKNOWN_KEY"),
        true
      );
    }
  });

  // S-10: preferredStyles enviado pelo cliente rejeitado
  countAssert(() => {
    const input = {
      answers: [],
      preferredStyles: ["luxury"],
    };
    const res = parseAdsProStyleQuizSubmission(input);
    assert.strictEqual(res.ok, false, "S-10: preferredStyles do cliente deve ser rejeitado");
    if (!res.ok) {
      assert.strictEqual(
        res.errors.some((e) => e.code === "UNKNOWN_KEY"),
        true
      );
    }
  });

  // S-11: Input não é mutado sob deepFreeze
  countAssert(() => {
    const frozenInput = deepFreeze([
      { questionId: "visual_composition", optionId: "comp_minimal" },
    ]);
    const res = parseAdsProStyleQuizSubmission(frozenInput);
    assert.strictEqual(res.ok, true, "S-11: Input congelado processado com sucesso");
    if (res.ok) {
      assert.notStrictEqual(res.value.answers, frozenInput);
      assert.strictEqual(Object.isFrozen(res.value), true);
    }
  });

  // =========================================================================
  // 3. AVALIAÇÃO, SCORING E DESEMPATE (R-01 a R-09)
  // =========================================================================
  console.log("-> 3. Avaliação, Scoring e Desempate (R-01 a R-09)");

  // R-01: Nenhuma resposta / submissão vazia -> preferredStyles: []
  countAssert(() => {
    const submission: AdsProStyleQuizSubmission = { answers: [] };
    const evalResult = evaluateStyleQuiz(submission);
    assert.deepStrictEqual(
      evalResult.profile.preferredStyles,
      [],
      "R-01: Sem respostas deve resultar em preferredStyles vazio"
    );
    assert.strictEqual(evalResult.profile.schemaVersion, ADS_PRO_STYLE_QUIZ_SCHEMA_VERSION);
  });

  // R-02: Estilo com maior evidência vem primeiro
  countAssert(() => {
    // comp_minimal dá +2 para minimal
    // density_spacious dá +2 para minimal (total minimal = 4)
    // light_crisp_vibrant dá +2 para modern (total modern = 2)
    const submission: AdsProStyleQuizSubmission = {
      answers: [
        { questionId: "visual_composition", optionId: "comp_minimal" },
        { questionId: "visual_density", optionId: "density_spacious" },
        { questionId: "visual_lighting", optionId: "light_crisp_vibrant" },
      ],
    };
    const evalResult = evaluateStyleQuiz(submission);
    assert.strictEqual(
      evalResult.profile.preferredStyles[0],
      "minimal",
      "R-02: minimal com 4 pontos deve ser o primeiro (primário)"
    );
    assert.strictEqual(
      evalResult.profile.preferredStyles[1],
      "modern",
      "R-02: modern com 2 pontos deve ser o segundo (secundário)"
    );
  });

  // R-03: Somente estilos com evidência positiva (> 0) aparecem no profile
  countAssert(() => {
    const submission: AdsProStyleQuizSubmission = {
      answers: [{ questionId: "visual_composition", optionId: "comp_minimal" }],
    };
    const evalResult = evaluateStyleQuiz(submission);
    assert.deepStrictEqual(
      evalResult.profile.preferredStyles,
      ["minimal"],
      "R-03: Apenas minimal recebeu pontos; outros 4 estilos não devem aparecer"
    );
    assert.strictEqual(evalResult.breakdown.styleScores.minimal, 2);
    assert.strictEqual(evalResult.breakdown.styleScores.luxury, 0);
  });

  // R-04: Sem duplicatas em preferredStyles
  countAssert(() => {
    const submission: AdsProStyleQuizSubmission = {
      answers: [
        { questionId: "visual_composition", optionId: "comp_minimal" },
        { questionId: "visual_lighting", optionId: "light_clean_balanced" },
      ],
    };
    const evalResult = evaluateStyleQuiz(submission);
    const styles = evalResult.profile.preferredStyles;
    const unique = new Set(styles);
    assert.strictEqual(unique.size, styles.length, "R-04: Não pode haver estilos duplicados");
  });

  // R-05: Empate determinístico pela ordem canônica pré-fixada
  countAssert(() => {
    // atmo_prestigious dá +2 para luxury
    // comp_dynamic dá +2 para modern
    // luxury e modern têm ambos 2 pontos
    // Pela QUIZ_STYLE_TIE_BREAK_ORDER, luxury (índice 0) precede modern (índice 4)
    const submissionLM: AdsProStyleQuizSubmission = {
      answers: [
        { questionId: "visual_atmosphere", optionId: "atmo_prestigious" },
        { questionId: "visual_composition", optionId: "comp_dynamic" },
      ],
    };
    const evalLM = evaluateStyleQuiz(submissionLM);
    assert.strictEqual(evalLM.breakdown.styleScores.luxury, 2);
    assert.strictEqual(evalLM.breakdown.styleScores.modern, 2);
    assert.strictEqual(
      evalLM.profile.preferredStyles[0],
      "luxury",
      "R-05: luxury deve vencer modern no desempate canônico pré-fixado"
    );
    assert.strictEqual(evalLM.profile.preferredStyles[1], "modern");
    assert.strictEqual(evalLM.breakdown.tieBreaksApplied.length, 1);
    assert.strictEqual(QUIZ_STYLE_TIE_BREAK_ORDER[0], "luxury");
    assert.strictEqual(QUIZ_STYLE_TIE_BREAK_ORDER[4], "modern");
  });

  // R-06: Respostas permutadas produzem estritamente o mesmo resultado
  countAssert(() => {
    const ans1 = { questionId: "visual_composition", optionId: "comp_dynamic" };
    const ans2 = { questionId: "visual_lighting", optionId: "light_dramatic" };
    const ans3 = { questionId: "visual_atmosphere", optionId: "atmo_tactile_warm" };

    const resABC = evaluateStyleQuiz({ answers: [ans1, ans2, ans3] });
    const resCBA = evaluateStyleQuiz({ answers: [ans3, ans2, ans1] });
    const resBAC = evaluateStyleQuiz({ answers: [ans2, ans1, ans3] });

    assert.deepStrictEqual(resABC.profile.preferredStyles, resCBA.profile.preferredStyles);
    assert.deepStrictEqual(resABC.profile.preferredStyles, resBAC.profile.preferredStyles);
    assert.deepStrictEqual(resABC.breakdown.styleScores, resCBA.breakdown.styleScores);
  });

  // R-07: 100 execuções idênticas (determinismo absoluto)
  countAssert(() => {
    const submission: AdsProStyleQuizSubmission = deepFreeze({
      answers: [
        { questionId: "visual_composition", optionId: "comp_minimal" },
        { questionId: "visual_lighting", optionId: "light_natural_soft" },
      ],
    });

    const firstRun = evaluateStyleQuiz(submission).profile.preferredStyles;
    for (let i = 0; i < 100; i += 1) {
      const subsequentRun = evaluateStyleQuiz(submission).profile.preferredStyles;
      assert.deepStrictEqual(subsequentRun, firstRun, `R-07: Falha de determinismo na iteração ${i}`);
    }
  });

  // R-08: Ordem final e estrutura são compatíveis com AdsProCreativeProfileV1
  countAssert(() => {
    const submission: AdsProStyleQuizSubmission = {
      answers: [{ questionId: "visual_composition", optionId: "comp_editorial" }],
    };
    const profile = resolveCreativeProfileFromQuiz(submission);
    const parseResult = parseAdsProCreativeProfile(profile);
    assert.strictEqual(
      parseResult.ok,
      true,
      "R-08: Output do quiz deve ser um AdsProCreativeProfileV1 100% válido no parser 03A"
    );
  });

  // R-09: Resultado retornado é profundamente congelado / imutável
  countAssert(() => {
    const submission: AdsProStyleQuizSubmission = {
      answers: [{ questionId: "visual_composition", optionId: "comp_minimal" }],
    };
    const evalResult = evaluateStyleQuiz(submission);
    assert.strictEqual(Object.isFrozen(evalResult), true);
    assert.strictEqual(Object.isFrozen(evalResult.profile), true);
    assert.strictEqual(Object.isFrozen(evalResult.profile.preferredStyles), true);
    assert.strictEqual(Object.isFrozen(evalResult.breakdown), true);
    assert.strictEqual(Object.isFrozen(evalResult.breakdown.styleScores), true);
  });

  // =========================================================================
  // 4. INTEGRAÇÃO END-TO-END COM CREATIVEPROFILE E MATCHER (E-01 a E-05)
  // =========================================================================
  console.log("-> 4. Integração End-to-End com CreativeProfile e Matcher (E-01 a E-05)");

  // E-01: Quiz -> Profile válido no contrato 03A
  countAssert(() => {
    const parsedSub = parseAdsProStyleQuizSubmission([
      { questionId: "visual_composition", optionId: "comp_minimal" },
      { questionId: "visual_density", optionId: "density_spacious" },
    ]);
    assert.strictEqual(parsedSub.ok, true);
    if (parsedSub.ok) {
      const profile = resolveCreativeProfileFromQuiz(parsedSub.value);
      assert.strictEqual(profile.schemaVersion, 1);
      assert.deepStrictEqual(profile.preferredStyles, ["minimal"]);
    }
  });

  // E-02: Quiz -> Profile -> Matcher: estilo primário do quiz desempata estilo no Matcher
  countAssert(() => {
    const parsedSub = parseAdsProStyleQuizSubmission([
      { questionId: "visual_composition", optionId: "comp_minimal" },
      { questionId: "visual_density", optionId: "density_spacious" }, // minimal: 4
      { questionId: "visual_lighting", optionId: "light_crisp_vibrant" }, // modern: 2
    ]);
    assert.strictEqual(parsedSub.ok, true);
    if (!parsedSub.ok) return;

    const reqCtx = {
      entityKind: "product" as const,
      format: "portrait" as const,
      category: "fashion" as const,
      intent: "promo" as const,
    };

    const matchCtx = resolveQuizAssetMatchContext(reqCtx, parsedSub.value);

    // Section 34: Validação de que quiz só altera preferredStyles, preservando todo o restante
    assert.strictEqual(matchCtx.entityKind, "product");
    assert.strictEqual(matchCtx.format, "portrait");
    assert.strictEqual(matchCtx.category, "fashion");
    assert.strictEqual(matchCtx.intent, "promo");

    const assetMinimal = createSyntheticAsset({
      id: "asset_minimal",
      targetCategories: ["fashion"],
      supportedIntents: ["promo"],
      styles: ["minimal"], // primário do quiz
    });

    const assetModern = createSyntheticAsset({
      id: "asset_modern",
      targetCategories: ["fashion"],
      supportedIntents: ["promo"],
      styles: ["modern"], // secundário do quiz
    });

    const manifest: AssetLibraryManifest = {
      schemaVersion: 1,
      libraryVersion: "1.0.0",
      assets: [assetModern, assetMinimal],
    };

    const results = rankAdsProAssets(manifest, matchCtx);
    assert.strictEqual(results.length, 2);
    assert.strictEqual(
      results[0].asset.id,
      "asset_minimal",
      "E-02: Asset com estilo primário do quiz (minimal) deve vencer o de estilo secundário (modern)"
    );
    assert.strictEqual(results[0].breakdown.styleAffinity, "primary");
    assert.strictEqual(results[1].breakdown.styleAffinity, "secondary");
  });

  // E-03: Category exact VENCE quiz primary style!
  countAssert(() => {
    const submission = {
      answers: [{ questionId: "visual_atmosphere", optionId: "atmo_prestigious" }], // luxury: 2
    };

    const matchCtx = resolveQuizAssetMatchContext(
      {
        entityKind: "product",
        format: "portrait",
        category: "fashion",
      },
      submission
    );

    const assetExactCatNoStyle = createSyntheticAsset({
      id: "asset_exact_cat",
      targetCategories: ["fashion"], // Category Exact (prioridade 0)
      styles: ["minimal"], // Style none em relação ao profile ("luxury")
    });

    const assetUnivCatQuizStyle = createSyntheticAsset({
      id: "asset_univ_cat_quiz_style",
      targetCategories: [], // Category Universal (prioridade 1)
      styles: ["luxury"], // Style primary do quiz
    });

    const manifest: AssetLibraryManifest = {
      schemaVersion: 1,
      libraryVersion: "1.0.0",
      assets: [assetUnivCatQuizStyle, assetExactCatNoStyle],
    };

    const results = rankAdsProAssets(manifest, matchCtx);
    assert.strictEqual(
      results[0].asset.id,
      "asset_exact_cat",
      "E-03: Category exact com style none DEVE vencer Category universal com style do quiz!"
    );
    assert.strictEqual(results[0].breakdown.categoryAffinity, "exact");
    assert.strictEqual(results[1].breakdown.categoryAffinity, "universal");
  });

  // E-04: Intent exact VENCE quiz primary style!
  countAssert(() => {
    const submission = {
      answers: [{ questionId: "visual_atmosphere", optionId: "atmo_prestigious" }], // luxury: 2
    };

    const matchCtx = resolveQuizAssetMatchContext(
      {
        entityKind: "product",
        format: "portrait",
        category: "fashion",
        intent: "promo",
      },
      submission
    );

    const assetExactIntentNoStyle = createSyntheticAsset({
      id: "asset_exact_intent",
      targetCategories: ["fashion"],
      supportedIntents: ["promo"], // Intent Exact (prioridade 0)
      styles: ["minimal"], // Style none
    });

    const assetUnivIntentQuizStyle = createSyntheticAsset({
      id: "asset_univ_intent_quiz_style",
      targetCategories: ["fashion"],
      supportedIntents: [], // Intent Universal (prioridade 1)
      styles: ["luxury"], // Style primary do quiz
    });

    const manifest: AssetLibraryManifest = {
      schemaVersion: 1,
      libraryVersion: "1.0.0",
      assets: [assetUnivIntentQuizStyle, assetExactIntentNoStyle],
    };

    const results = rankAdsProAssets(manifest, matchCtx);
    assert.strictEqual(
      results[0].asset.id,
      "asset_exact_intent",
      "E-04: Intent exact com style none DEVE vencer Intent universal com style do quiz!"
    );
    assert.strictEqual(results[0].breakdown.intentAffinity, "exact");
    assert.strictEqual(results[1].breakdown.intentAffinity, "universal");
  });

  // E-05: Submissão vazia -> Matcher opera sem preferência de estilo
  countAssert(() => {
    const matchCtx = resolveQuizAssetMatchContext(
      {
        entityKind: "product",
        format: "portrait",
      },
      { answers: [] }
    );

    const assetA = createSyntheticAsset({
      id: "asset_a",
      styles: ["luxury"],
    });

    const assetB = createSyntheticAsset({
      id: "asset_b",
      styles: ["minimal"],
    });

    const manifest: AssetLibraryManifest = {
      schemaVersion: 1,
      libraryVersion: "1.0.0",
      assets: [assetB, assetA],
    };

    const results = rankAdsProAssets(manifest, matchCtx);
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].breakdown.styleAffinity, "none");
    assert.strictEqual(results[1].breakdown.styleAffinity, "none");
    assert.strictEqual(results[0].asset.id, "asset_a", "E-05: Desempate por total order ASCII");
  });

  // =========================================================================
  // 5. AUDITORIA ESTÁTICA DE PUREZA E DETERMINISMO (PUR-01 a PUR-02)
  // =========================================================================
  console.log("-> 5. Auditoria Estática de Pureza e Determinismo (PUR-01 a PUR-02)");

  countAssert(() => {
    const modulePath = process.env.ADS_PRO_STYLE_QUIZ_PATH
      ? path.resolve(process.env.ADS_PRO_STYLE_QUIZ_PATH)
      : path.resolve(process.cwd(), "shared/ads-pro/style-quiz.ts");
    const content = fs.readFileSync(modulePath, "utf8");

    const executableCode = content
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*/g, "");

    const bannedTokens = [
      "Math.random",
      "Date.now",
      "new Date",
      "setTimeout",
      "setInterval",
      "fetch",
      "XMLHttpRequest",
      "localStorage",
      "sessionStorage",
      "crypto.random",
    ];

    for (const token of bannedTokens) {
      assert.strictEqual(
        executableCode.includes(token),
        false,
        `PUR-01: Violação de pureza encontrada: ${token}`
      );
    }

    // I/O proibido em imports
    for (const forbidden of [
      "fetch",
      "axios",
      "http",
      "https",
      "fs",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "firebase",
      "firestore",
      "openai",
      "gemini",
      "wouter",
      "react",
    ]) {
      const importRegex = new RegExp(`from\\s+["'].*${forbidden}.*["']`, "i");
      assert.ok(
        !importRegex.test(content),
        `PUR-01: Import proibido detectado: ${forbidden}`
      );
    }
  });

  countAssert(() => {
    assert.strictEqual(ADS_PRO_STYLE_QUIZ_SCHEMA_VERSION, 1);
  });

  console.log(`=== TODOS OS TESTES ADS-PRO-03B PASSARAM COM SUCESSO! (${assertionCount} asserções) ===`);
}

runTests();
