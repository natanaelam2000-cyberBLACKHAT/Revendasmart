/**
 * ADS-PRO-02B — Suíte de Testes Profunda do Matcher Lexicográfico
 *
 * Cobertura Completa:
 * 1. Hard Filters e Elegibilidade (M-01 a M-11)
 * 2. Afinidade Categórica Semântica (CAT-01 a CAT-08) e Ordenação Categórica
 * 3. Afinidade de Intenção Comercial (exact, universal, neutral)
 * 4. Afinidade de Estilo Visual (primary, secondary, none, deduplicação ordenada de preferências)
 * 5. Prova Crítica da Hierarquia Lexicográfica (Intent exact vence Intent universal + Style primary)
 * 6. matchedStyles.length NÃO influencia ranking (AssetId desempata)
 * 7. Desempate Estrito por Total Order (AssetId ASCII canônico)
 * 8. Todas as 6 Permutações para 3 Assets (ABC, ACB, BAC, BCA, CAB, CBA)
 * 9. Determinismo Estrito em 100 Execuções
 * 10. Imutabilidade com deepFreeze (manifest, assets, context, arrays)
 * 11. Casos de Retorno Vazio
 * 12. Auditoria Estática de Pureza (Zero Randomness e Zero I/O)
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type {
  AssetDNA,
  AssetLibraryManifest,
} from "../shared/ads-pro/asset-dna";
import {
  evaluateAsset,
  isAssetEligible,
  rankAdsProAssets,
  resolveCategoryAffinity,
  resolveIntentAffinity,
  resolveStyleAffinity,
  type AssetMatchContext,
} from "../shared/ads-pro/asset-matcher";
import { parseAssetLibrary } from "../shared/ads-pro/asset-parser";

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

/** Helper para criar AssetDNA sintético válido para testes do Matcher. */
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
  console.log("=== INICIANDO SUÍTE ADS-PRO-02B (MATCHER LEXICOGRÁFICO) ===");
  let assertionCount = 0;

  function countAssert(fn: () => void) {
    fn();
    assertionCount += 1;
  }

  // =========================================================================
  // 1. HARD FILTERS E ELEGIBILIDADE (M-01 a M-11)
  // =========================================================================
  console.log("-> 1. Testando Hard Filters e Elegibilidade (M-01 a M-11)");

  const baseProductContext: AssetMatchContext = {
    entityKind: "product",
    format: "portrait",
  };

  const baseServiceContext: AssetMatchContext = {
    entityKind: "service",
    format: "square",
  };

  // M-01: Asset active é elegível
  countAssert(() => {
    const a = createSyntheticAsset({ id: "m01", status: "active" });
    assert.strictEqual(isAssetEligible(a, baseProductContext), true, "M-01: asset ativo deve ser elegível");
  });

  // M-02: Asset deprecated é terminantemente inelegível
  countAssert(() => {
    const a = createSyntheticAsset({ id: "m02", status: "deprecated" });
    assert.strictEqual(isAssetEligible(a, baseProductContext), false, "M-02: asset deprecated deve ser excluído");
  });

  // M-03: Asset com entityKinds=['product'] é elegível para product context
  countAssert(() => {
    const a = createSyntheticAsset({ id: "m03", entityKinds: ["product"] });
    assert.strictEqual(isAssetEligible(a, baseProductContext), true, "M-03: product asset deve ser elegível para product");
  });

  // M-04: Asset com entityKinds=['product'] é inelegível para service context
  countAssert(() => {
    const a = createSyntheticAsset({ id: "m04", entityKinds: ["product"] });
    assert.strictEqual(isAssetEligible(a, baseServiceContext), false, "M-04: product-only asset com service context deve ser excluído");
  });

  // M-05: Asset com entityKinds=['service'] é elegível para service context
  countAssert(() => {
    const a = createSyntheticAsset({ id: "m05", entityKinds: ["service"], formats: ["square"] });
    assert.strictEqual(isAssetEligible(a, baseServiceContext), true, "M-05: service asset deve ser elegível para service");
  });

  // M-06: Asset com entityKinds=['product', 'service'] é elegível para ambos
  countAssert(() => {
    const a = createSyntheticAsset({ id: "m06", entityKinds: ["product", "service"], formats: ["portrait", "square"] });
    assert.strictEqual(isAssetEligible(a, baseProductContext), true, "M-06a: multimodal asset deve ser elegível para product");
    assert.strictEqual(isAssetEligible(a, baseServiceContext), true, "M-06b: multimodal asset deve ser elegível para service");
  });

  // M-07: Formato compatível é aceito
  countAssert(() => {
    const a = createSyntheticAsset({ id: "m07", formats: ["portrait"] });
    assert.strictEqual(isAssetEligible(a, { entityKind: "product", format: "portrait" }), true);
  });

  // M-08: Formato incompatível é excluído
  countAssert(() => {
    const a = createSyntheticAsset({ id: "m08", formats: ["portrait"] });
    assert.strictEqual(isAssetEligible(a, { entityKind: "product", format: "square" }), false, "M-08: formato incompatível é excluído");
  });

  // M-09: Asset multi-formato é aceito no formato requisitado
  countAssert(() => {
    const a = createSyntheticAsset({ id: "m09", formats: ["portrait", "square"] });
    assert.strictEqual(isAssetEligible(a, { entityKind: "product", format: "square" }), true);
  });

  // M-10: Asset universal (supportedIntents: []) aceita qualquer contexto de intent
  countAssert(() => {
    const a = createSyntheticAsset({ id: "m10", supportedIntents: [] });
    assert.strictEqual(isAssetEligible(a, { entityKind: "product", format: "portrait", intent: "spotlight" }), true);
    assert.strictEqual(isAssetEligible(a, { entityKind: "product", format: "portrait", intent: "delivery" }), true);
  });

  // M-11: Asset com intents específicos aceita o intent correto e rejeita o incorreto
  countAssert(() => {
    const a = createSyntheticAsset({ id: "m11", supportedIntents: ["spotlight", "bestseller"] });
    assert.strictEqual(isAssetEligible(a, { entityKind: "product", format: "portrait", intent: "spotlight" }), true);
    assert.strictEqual(isAssetEligible(a, { entityKind: "product", format: "portrait", intent: "delivery" }), false, "M-11: intent incompatível é excluído");
  });

  // =========================================================================
  // 2. AFINIDADE CATEGÓRICA SEMÂNTICA (CAT-01 a CAT-08)
  // =========================================================================
  console.log("-> 2. Testando Afinidade Categórica Semântica (CAT-01 a CAT-08)");

  // CAT-01: category beauty + asset beauty -> exact
  countAssert(() => {
    const a = createSyntheticAsset({ id: "cat01", targetCategories: ["beauty"] });
    const ctx: AssetMatchContext = { entityKind: "product", format: "portrait", category: "beauty" };
    assert.strictEqual(resolveCategoryAffinity(a, ctx), "exact", "CAT-01: deve ser exact");
  });

  // CAT-02: category beauty + asset [] -> universal
  countAssert(() => {
    const a = createSyntheticAsset({ id: "cat02", targetCategories: [] });
    const ctx: AssetMatchContext = { entityKind: "product", format: "portrait", category: "beauty" };
    assert.strictEqual(resolveCategoryAffinity(a, ctx), "universal", "CAT-02: deve ser universal");
  });

  // CAT-03: category beauty + asset fashion -> mismatch
  countAssert(() => {
    const a = createSyntheticAsset({ id: "cat03", targetCategories: ["fashion"] });
    const ctx: AssetMatchContext = { entityKind: "product", format: "portrait", category: "beauty" };
    assert.strictEqual(resolveCategoryAffinity(a, ctx), "mismatch", "CAT-03: deve ser mismatch");
  });

  // CAT-04: category undefined + asset [] -> universal
  countAssert(() => {
    const a = createSyntheticAsset({ id: "cat04", targetCategories: [] });
    const ctx: AssetMatchContext = { entityKind: "product", format: "portrait", category: undefined };
    assert.strictEqual(resolveCategoryAffinity(a, ctx), "universal", "CAT-04: deve ser universal");
  });

  // CAT-05: category undefined + asset beauty -> neutral
  countAssert(() => {
    const a = createSyntheticAsset({ id: "cat05", targetCategories: ["beauty"] });
    const ctx: AssetMatchContext = { entityKind: "product", format: "portrait", category: undefined };
    assert.strictEqual(resolveCategoryAffinity(a, ctx), "neutral", "CAT-05: deve ser neutral");
  });

  // CAT-06: service + category undefined + asset [] -> universal
  countAssert(() => {
    const a = createSyntheticAsset({ id: "cat06", entityKinds: ["service"], formats: ["square"], targetCategories: [] });
    const ctx: AssetMatchContext = { entityKind: "service", format: "square", category: undefined };
    assert.strictEqual(resolveCategoryAffinity(a, ctx), "universal", "CAT-06: service universal deve ser universal");
  });

  // CAT-07: service + category undefined + asset beauty -> neutral
  countAssert(() => {
    const a = createSyntheticAsset({ id: "cat07", entityKinds: ["service"], formats: ["square"], targetCategories: ["beauty"] });
    const ctx: AssetMatchContext = { entityKind: "service", format: "square", category: undefined };
    assert.strictEqual(resolveCategoryAffinity(a, ctx), "neutral", "CAT-07: service com targetCategories deve ser neutral");
  });

  // CAT-08: product + category undefined + asset beauty -> neutral
  countAssert(() => {
    const a = createSyntheticAsset({ id: "cat08", entityKinds: ["product"], formats: ["portrait"], targetCategories: ["beauty"] });
    const ctx: AssetMatchContext = { entityKind: "product", format: "portrait", category: undefined };
    assert.strictEqual(resolveCategoryAffinity(a, ctx), "neutral", "CAT-08: product sem categoria deve ser neutral");
  });

  // Ordenação categórica com categoria definida: exact > universal > mismatch
  countAssert(() => {
    const assetExact = createSyntheticAsset({ id: "cat-exact", targetCategories: ["beauty"] });
    const assetUniv = createSyntheticAsset({ id: "cat-univ", targetCategories: [] });
    const assetMismatch = createSyntheticAsset({ id: "cat-mismatch", targetCategories: ["fashion"] });

    const manifest: AssetLibraryManifest = {
      schemaVersion: 1,
      libraryVersion: "1.0.0",
      assets: [assetMismatch, assetUniv, assetExact],
    };
    const ctx: AssetMatchContext = { entityKind: "product", format: "portrait", category: "beauty" };
    const ranked = rankAdsProAssets(manifest, ctx);

    assert.strictEqual(ranked.length, 3);
    assert.strictEqual(ranked[0].asset.id, "cat-exact");
    assert.strictEqual(ranked[0].breakdown.categoryAffinity, "exact");
    assert.strictEqual(ranked[1].asset.id, "cat-univ");
    assert.strictEqual(ranked[1].breakdown.categoryAffinity, "universal");
    assert.strictEqual(ranked[2].asset.id, "cat-mismatch");
    assert.strictEqual(ranked[2].breakdown.categoryAffinity, "mismatch");
  });

  // Ordenação categórica com categoria NÃO definida: universal > neutral
  countAssert(() => {
    const assetUniv = createSyntheticAsset({ id: "cat-u", targetCategories: [] });
    const assetNeutral = createSyntheticAsset({ id: "cat-n", targetCategories: ["beauty"] });

    const manifest: AssetLibraryManifest = {
      schemaVersion: 1,
      libraryVersion: "1.0.0",
      assets: [assetNeutral, assetUniv],
    };
    const ctx: AssetMatchContext = { entityKind: "product", format: "portrait", category: undefined };
    const ranked = rankAdsProAssets(manifest, ctx);

    assert.strictEqual(ranked.length, 2);
    assert.strictEqual(ranked[0].asset.id, "cat-u");
    assert.strictEqual(ranked[0].breakdown.categoryAffinity, "universal");
    assert.strictEqual(ranked[1].asset.id, "cat-n");
    assert.strictEqual(ranked[1].breakdown.categoryAffinity, "neutral");
  });

  // =========================================================================
  // 3. AFINIDADE DE INTENÇÃO COMERCIAL
  // =========================================================================
  console.log("-> 3. Testando Afinidade de Intenção Comercial");

  countAssert(() => {
    const assetExact = createSyntheticAsset({ id: "int-exact", supportedIntents: ["spotlight"] });
    const assetUniv = createSyntheticAsset({ id: "int-univ", supportedIntents: [] });
    const assetIneligible = createSyntheticAsset({ id: "int-ineligible", supportedIntents: ["delivery"] });

    const ctxWithIntent: AssetMatchContext = { entityKind: "product", format: "portrait", intent: "spotlight" };
    assert.strictEqual(resolveIntentAffinity(assetExact, ctxWithIntent), "exact");
    assert.strictEqual(resolveIntentAffinity(assetUniv, ctxWithIntent), "universal");
    assert.strictEqual(
      resolveIntentAffinity(assetIneligible, ctxWithIntent),
      "mismatch",
      "Asset com intent incompatível NÃO pode ser descrito como universal em chamada direta"
    );

    const evalIneligible = evaluateAsset(assetIneligible, ctxWithIntent);
    assert.strictEqual(
      evalIneligible.breakdown.intentAffinity,
      "mismatch",
      "evaluateAsset direto NÃO pode descrever asset com intent incompatível como universal"
    );

    const ctxWithoutIntent: AssetMatchContext = { entityKind: "product", format: "portrait", intent: undefined };
    assert.strictEqual(resolveIntentAffinity(assetExact, ctxWithoutIntent), "neutral");
    assert.strictEqual(resolveIntentAffinity(assetUniv, ctxWithoutIntent), "neutral");
    assert.strictEqual(resolveIntentAffinity(assetIneligible, ctxWithoutIntent), "neutral");
  });

  // =========================================================================
  // 4. AFINIDADE DE ESTILO VISUAL E PREFERÊNCIAS ORDENADAS DEDUPLICADAS
  // =========================================================================
  console.log("-> 4. Testando Afinidade de Estilo e Deduplicação Ordenada");

  countAssert(() => {
    const assetModern = createSyntheticAsset({ id: "st-mod", styles: ["modern"] });
    const assetMinimal = createSyntheticAsset({ id: "st-min", styles: ["minimal"] });
    const assetLuxury = createSyntheticAsset({ id: "st-lux", styles: ["luxury"] });

    // Preferências: modern (primário), minimal (secundário)
    const ctx: AssetMatchContext = {
      entityKind: "product",
      format: "portrait",
      preferredStyles: ["modern", "minimal"],
    };

    const resMod = resolveStyleAffinity(assetModern, ctx);
    assert.strictEqual(resMod.styleAffinity, "primary");
    assert.deepEqual(resMod.matchedStyles, ["modern"]);

    const resMin = resolveStyleAffinity(assetMinimal, ctx);
    assert.strictEqual(resMin.styleAffinity, "secondary");
    assert.deepEqual(resMin.matchedStyles, ["minimal"]);

    const resLux = resolveStyleAffinity(assetLuxury, ctx);
    assert.strictEqual(resLux.styleAffinity, "none");
    assert.deepEqual(resLux.matchedStyles, []);
  });

  // Deduplicação ordenada de preferredStyles sem mutar o contexto
  countAssert(() => {
    const ctxWithDuplicates: AssetMatchContext = {
      entityKind: "product",
      format: "portrait",
      preferredStyles: ["modern", "modern", "minimal"],
    };

    const assetModern = createSyntheticAsset({ id: "d-mod", styles: ["modern"] });
    const assetMinimal = createSyntheticAsset({ id: "d-min", styles: ["minimal"] });

    const resMod = resolveStyleAffinity(assetModern, ctxWithDuplicates);
    const resMin = resolveStyleAffinity(assetMinimal, ctxWithDuplicates);

    // modern continua sendo primary
    assert.strictEqual(resMod.styleAffinity, "primary");
    // minimal continua sendo secondary
    assert.strictEqual(resMin.styleAffinity, "secondary");

    // Garante que o contexto não foi mutado
    assert.deepEqual(ctxWithDuplicates.preferredStyles, ["modern", "modern", "minimal"]);
  });

  // Ordenação por styleAffinity quando category e intent são equivalentes
  countAssert(() => {
    // Asset Z tem estilo primary, mas ID alfabeticamente posterior ("z-primary")
    // Asset A tem estilo secondary, mas ID alfabeticamente anterior ("a-secondary")
    const assetZPrimary = createSyntheticAsset({ id: "z-primary", styles: ["luxury"] });
    const assetASecondary = createSyntheticAsset({ id: "a-secondary", styles: ["minimal"] });

    const manifest: AssetLibraryManifest = {
      schemaVersion: 1,
      libraryVersion: "1.0.0",
      assets: [assetASecondary, assetZPrimary],
    };

    const ctx: AssetMatchContext = {
      entityKind: "product",
      format: "portrait",
      preferredStyles: ["luxury", "minimal"],
    };

    const ranked = rankAdsProAssets(manifest, ctx);
    assert.strictEqual(ranked.length, 2);
    // style primary DEVE superar style secondary, superando a ordem alfabética do ID
    assert.strictEqual(ranked[0].asset.id, "z-primary", "Style primary deve vencer Style secondary no ranking");
    assert.strictEqual(ranked[0].breakdown.styleAffinity, "primary");
    assert.strictEqual(ranked[1].asset.id, "a-secondary");
    assert.strictEqual(ranked[1].breakdown.styleAffinity, "secondary");
  });

  // =========================================================================
  // 5. TESTE CRÍTICO — HIERARQUIA LEXICOGRÁFICA REAL (Intent vence Style)
  // =========================================================================
  console.log("-> 5. Testando Hierarquia Lexicográfica Real (Intent exact vence Style primary)");

  countAssert(() => {
    // Mesma afinidade de categoria (universal para ambos)
    // Asset A: intent exact, style none
    const assetA = createSyntheticAsset({
      id: "asset-a-intent-exact",
      targetCategories: [],
      supportedIntents: ["spotlight"],
      styles: ["editorial"],
    });

    // Asset B: intent universal, style primary + múltiplos matchedStyles
    const assetB = createSyntheticAsset({
      id: "asset-b-style-primary",
      targetCategories: [],
      supportedIntents: [],
      styles: ["luxury", "modern", "minimal", "sensory"],
    });

    const manifest: AssetLibraryManifest = {
      schemaVersion: 1,
      libraryVersion: "1.0.0",
      // Entrada propositalmente com B antes de A
      assets: [assetB, assetA],
    };

    const ctx: AssetMatchContext = {
      entityKind: "product",
      format: "portrait",
      intent: "spotlight",
      preferredStyles: ["luxury", "modern", "minimal"],
    };

    const ranked = rankAdsProAssets(manifest, ctx);

    assert.strictEqual(ranked.length, 2);
    // Asset A PRECISA vencer porque Intent exact > Intent universal na ordem lexicográfica
    assert.strictEqual(ranked[0].asset.id, "asset-a-intent-exact", "Intent exact DEVE vencer Style primary");
    assert.strictEqual(ranked[0].breakdown.intentAffinity, "exact");
    assert.strictEqual(ranked[0].breakdown.styleAffinity, "none");

    assert.strictEqual(ranked[1].asset.id, "asset-b-style-primary");
    assert.strictEqual(ranked[1].breakdown.intentAffinity, "universal");
    assert.strictEqual(ranked[1].breakdown.styleAffinity, "primary");
  });

  // =========================================================================
  // 6. matchedStyles.length NÃO INFLUENCIA RANKING
  // =========================================================================
  console.log("-> 6. Testando que matchedStyles.length NÃO influencia o ranking");

  countAssert(() => {
    // Dois assets com mesma categoryAffinity, mesma intentAffinity e mesmo styleAffinity ('secondary')
    // Asset Zulu: 4 estilos combinando (matchedStyles = 4)
    // Asset Alpha: 1 estilo combinando (matchedStyles = 1)
    const assetZulu = createSyntheticAsset({
      id: "zulu-asset",
      targetCategories: [],
      supportedIntents: [],
      styles: ["modern", "minimal", "sensory", "luxury"],
    });

    const assetAlpha = createSyntheticAsset({
      id: "alpha-asset",
      targetCategories: [],
      supportedIntents: [],
      styles: ["modern"],
    });

    const manifest: AssetLibraryManifest = {
      schemaVersion: 1,
      libraryVersion: "1.0.0",
      assets: [assetZulu, assetAlpha],
    };

    const ctx: AssetMatchContext = {
      entityKind: "product",
      format: "portrait",
      // primary é editorial (nenhum tem). modern, minimal, sensory, luxury são secondary
      preferredStyles: ["editorial", "modern", "minimal", "sensory", "luxury"],
    };

    const ranked = rankAdsProAssets(manifest, ctx);

    assert.strictEqual(ranked.length, 2);
    // matchedStyles.length NÃO decide! Ambas têm styleAffinity="secondary".
    // Desempate DEVE ser por AssetId ASCII: 'alpha-asset' vem antes de 'zulu-asset'
    assert.strictEqual(ranked[0].asset.id, "alpha-asset", "AssetId ASCII deve desempatar, e não matchedStyles count");
    assert.strictEqual(ranked[0].breakdown.matchedStyles.length, 1);
    assert.strictEqual(ranked[1].asset.id, "zulu-asset");
    assert.strictEqual(ranked[1].breakdown.matchedStyles.length, 4);
  });

  // =========================================================================
  // 7. DESEMPATE ESTRITO POR TOTAL ORDER (AssetId ASCII)
  // =========================================================================
  console.log("-> 7. Testando Desempate por AssetId ASCII");

  countAssert(() => {
    const assetZ = createSyntheticAsset({ id: "z-id", targetCategories: [], styles: ["minimal"] });
    const assetA = createSyntheticAsset({ id: "a-id", targetCategories: [], styles: ["minimal"] });
    const assetM = createSyntheticAsset({ id: "m-id", targetCategories: [], styles: ["minimal"] });

    const manifest: AssetLibraryManifest = {
      schemaVersion: 1,
      libraryVersion: "1.0.0",
      assets: [assetZ, assetM, assetA],
    };

    const ctx: AssetMatchContext = { entityKind: "product", format: "portrait" };
    const ranked = rankAdsProAssets(manifest, ctx);

    assert.strictEqual(ranked[0].asset.id, "a-id");
    assert.strictEqual(ranked[1].asset.id, "m-id");
    assert.strictEqual(ranked[2].asset.id, "z-id");
  });

  // =========================================================================
  // 8. TODAS AS 6 PERMUTAÇÕES EXPLÍCITAS PARA 3 ASSETS
  // =========================================================================
  console.log("-> 8. Testando Todas as 6 Permutações para 3 Assets (ABC, ACB, BAC, BCA, CAB, CBA)");

  countAssert(() => {
    const assetA = createSyntheticAsset({ id: "asset-1-exact", targetCategories: ["beauty"], styles: ["luxury"] });
    const assetB = createSyntheticAsset({ id: "asset-2-univ", targetCategories: [], styles: ["minimal"] });
    const assetC = createSyntheticAsset({ id: "asset-3-neutral", targetCategories: ["fashion"], styles: ["modern"] });

    const ctx: AssetMatchContext = {
      entityKind: "product",
      format: "portrait",
      category: "beauty",
    };

    const permutations: AssetDNA[][] = [
      [assetA, assetB, assetC], // ABC
      [assetA, assetC, assetB], // ACB
      [assetB, assetA, assetC], // BAC
      [assetB, assetC, assetA], // BCA
      [assetC, assetA, assetB], // CAB
      [assetC, assetB, assetA], // CBA
    ];

    const expectedOrder = ["asset-1-exact", "asset-2-univ", "asset-3-neutral"];

    for (let p = 0; p < permutations.length; p += 1) {
      const manifest: AssetLibraryManifest = {
        schemaVersion: 1,
        libraryVersion: "1.0.0",
        assets: permutations[p],
      };
      const ranked = rankAdsProAssets(manifest, ctx);
      const actualOrder = ranked.map((r) => r.asset.id);
      assert.deepEqual(actualOrder, expectedOrder, `Permutação ${p + 1}/6 falhou na independência da ordem`);
    }
  });

  // =========================================================================
  // 9. DETERMINISMO ESTRITO EM 100 EXECUÇÕES
  // =========================================================================
  console.log("-> 9. Testando Determinismo Estrito em 100 Execuções");

  countAssert(() => {
    const assets: AssetDNA[] = [
      createSyntheticAsset({ id: "p01", targetCategories: ["beauty"], supportedIntents: ["spotlight"] }),
      createSyntheticAsset({ id: "p02", targetCategories: [], supportedIntents: ["spotlight"] }),
      createSyntheticAsset({ id: "p03", targetCategories: ["beauty"], supportedIntents: [] }),
      createSyntheticAsset({ id: "p04", targetCategories: [], supportedIntents: [] }),
    ];

    const manifest: AssetLibraryManifest = {
      schemaVersion: 1,
      libraryVersion: "1.0.0",
      assets,
    };

    const ctx: AssetMatchContext = {
      entityKind: "product",
      format: "portrait",
      category: "beauty",
      intent: "spotlight",
    };

    const referenceResult = rankAdsProAssets(manifest, ctx);
    const referenceIds = referenceResult.map((r) => r.asset.id);

    for (let i = 0; i < 100; i += 1) {
      const runResult = rankAdsProAssets(manifest, ctx);
      const runIds = runResult.map((r) => r.asset.id);
      assert.deepEqual(runIds, referenceIds, `Execução ${i + 1}/100 divergiu do resultado canônico`);
    }
  });

  // =========================================================================
  // 10. IMUTABILIDADE ESTRITA COM DEEPFREEZE
  // =========================================================================
  console.log("-> 10. Testando Imutabilidade Estrita com deepFreeze");

  countAssert(() => {
    const frozenAssets = deepFreeze([
      createSyntheticAsset({ id: "f-01", targetCategories: ["beauty"], styles: ["luxury"] }),
      createSyntheticAsset({ id: "f-02", targetCategories: [], styles: ["minimal"] }),
    ]);

    const frozenManifest = deepFreeze<AssetLibraryManifest>({
      schemaVersion: 1,
      libraryVersion: "1.0.0",
      assets: frozenAssets,
    });

    const frozenContext = deepFreeze<AssetMatchContext>({
      entityKind: "product",
      format: "portrait",
      category: "beauty",
      preferredStyles: ["luxury", "minimal"],
    });

    assert.doesNotThrow(() => {
      const ranked = rankAdsProAssets(frozenManifest, frozenContext);
      assert.strictEqual(ranked.length, 2);
    }, "Matcher não pode lançar erro ao processar objetos congelados");
  });

  // =========================================================================
  // 11. CASOS DE RETORNO VAZIO
  // =========================================================================
  console.log("-> 11. Testando Casos de Retorno Vazio");

  countAssert(() => {
    const emptyManifest: AssetLibraryManifest = { schemaVersion: 1, libraryVersion: "1.0.0", assets: [] };
    const ctx: AssetMatchContext = { entityKind: "product", format: "portrait" };
    assert.deepEqual(rankAdsProAssets(emptyManifest, ctx), []);

    const allDeprecated: AssetLibraryManifest = {
      schemaVersion: 1,
      libraryVersion: "1.0.0",
      assets: [createSyntheticAsset({ id: "dep1", status: "deprecated" })],
    };
    assert.deepEqual(rankAdsProAssets(allDeprecated, ctx), []);

    const wrongFormat: AssetLibraryManifest = {
      schemaVersion: 1,
      libraryVersion: "1.0.0",
      assets: [createSyntheticAsset({ id: "wf1", formats: ["square"] })],
    };
    assert.deepEqual(rankAdsProAssets(wrongFormat, ctx), []);
  });

  // =========================================================================
  // 12. AUDITORIA ESTÁTICA DE ZERO RANDOMNESS E ZERO I/O
  // =========================================================================
  console.log("-> 12. Auditoria Estática de Pureza (Zero Randomness e Zero I/O)");

  countAssert(() => {
    const matcherPath = process.env.ADS_PRO_MATCHER_PATH
      ? path.resolve(process.env.ADS_PRO_MATCHER_PATH)
      : path.resolve(process.cwd(), "shared/ads-pro/asset-matcher.ts");
    const matcherSource = fs.readFileSync(matcherPath, "utf8");

    // Remover comentários para inspecionar tokens do código executável
    const executableCode = matcherSource
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*/g, "");

    // Randomness proibida no código executável
    assert.ok(!executableCode.includes("Math.random"), "Math.random é estritamente proibido");
    assert.ok(!executableCode.includes("Date.now"), "Date.now é estritamente proibido");
    assert.ok(!executableCode.includes("new Date"), "new Date é estritamente proibido");
    assert.ok(!executableCode.includes("crypto.random"), "crypto.random é estritamente proibido");
    assert.ok(!executableCode.includes("performance.now"), "performance.now é estritamente proibido");

    // I/O proibido
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
        !importRegex.test(matcherSource),
        `Import proibido detectado no matcher: ${forbidden}`
      );
    }
  });

  // =========================================================================
  // 13. VALIDAÇÃO DE REJEIÇÃO DE IDS DUPLICADOS NO PARSER (CAMADA DE ENTRADA)
  // =========================================================================
  console.log("-> 13. Testando Rejeição de IDs Duplicados no Parser");

  countAssert(() => {
    const rawAsset = {
      id: "duplicate-asset-id",
      entityKinds: ["product"],
      targetCategories: ["beauty"],
      styles: ["luxury"],
      supportedIntents: ["spotlight"],
      formats: ["portrait"],
      status: "active",
      resource: { type: "static", uri: "assets/dupe.png" },
      subjectZone: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    };

    const duplicateManifest = {
      schemaVersion: 1,
      libraryVersion: "1.0.0",
      assets: [rawAsset, { ...rawAsset }],
    };

    const parseResult = parseAssetLibrary(duplicateManifest);
    assert.strictEqual(parseResult.ok, false, "Manifesto com IDs duplicados deve ser rejeitado");
    if (!parseResult.ok) {
      const dupeError = parseResult.errors.find((e) => e.code === "DUPLICATE_ID");
      assert.ok(dupeError, "Deve conter erro estruturado com code DUPLICATE_ID");
      assert.strictEqual(dupeError?.path, "$.assets[1].id");
    }
  });

  console.log(`=== TODOS OS TESTES ADS-PRO-02B PASSARAM COM SUCESSO! (${assertionCount} asserções/casos) ===`);
}

runTests();
