/**
 * ADS-PRO-03A — Suíte de Testes Profunda do Creative Profile V1 e Resolução para o Matcher
 *
 * Cobertura Completa:
 * 1. Validação de Perfis Válidos (P-01 a P-05)
 * 2. Rejeição Estrita de Perfis Inválidos e Contratos Excedentes (P-06 a P-19)
 * 3. Resolução Pura do Contexto de Match (R-01 a R-11)
 * 4. Integração End-to-End com o Matcher Lexicográfico (INT-01 a INT-05)
 * 5. Auditoria de Pureza e Determinismo Estrito (PUR-01 a PUR-02)
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { AssetDNA, AssetLibraryManifest } from "../shared/ads-pro/asset-dna";
import { rankAdsProAssets } from "../shared/ads-pro/asset-matcher";
import {
  ADS_PRO_CREATIVE_PROFILE_SCHEMA_VERSION,
  type AdCreationContext,
  type AdsProCreativeProfileV1,
  parseAdsProCreativeProfile,
  resolveAssetMatchContext,
} from "../shared/ads-pro/creative-profile";

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
  console.log("=== INICIANDO SUÍTE ADS-PRO-03A (CREATIVE PROFILE V1) ===");
  let assertionCount = 0;

  function countAssert(fn: () => void) {
    fn();
    assertionCount += 1;
  }

  // =========================================================================
  // 1. VALIDAÇÃO DE PERFIS VÁLIDOS (P-01 a P-05)
  // =========================================================================
  console.log("-> 1. Validação de Perfis Válidos (P-01 a P-05)");

  // P-01: Perfil mínimo com preferredStyles vazio ([])
  countAssert(() => {
    const input = {
      schemaVersion: 1,
      preferredStyles: [],
    };
    const res = parseAdsProCreativeProfile(input);
    assert.strictEqual(res.ok, true, "P-01: Perfil mínimo com [] deve ser aceito");
    if (res.ok) {
      assert.strictEqual(res.value.schemaVersion, 1);
      assert.deepStrictEqual(res.value.preferredStyles, []);
      assert.strictEqual(Object.isFrozen(res.value), true, "P-01: Retorno deve ser imutável");
      assert.strictEqual(Object.isFrozen(res.value.preferredStyles), true);
    }
  });

  // P-02: Perfil válido com 1 estilo ("minimal")
  countAssert(() => {
    const input = {
      schemaVersion: 1,
      preferredStyles: ["minimal"],
    };
    const res = parseAdsProCreativeProfile(input);
    assert.strictEqual(res.ok, true, "P-02: Perfil com 1 estilo deve ser aceito");
    if (res.ok) {
      assert.strictEqual(res.value.schemaVersion, 1);
      assert.deepStrictEqual(res.value.preferredStyles, ["minimal"]);
    }
  });

  // P-03: Perfil válido com todos os 5 MarketingProStyle
  countAssert(() => {
    const input = {
      schemaVersion: 1,
      preferredStyles: ["luxury", "editorial", "minimal", "sensory", "modern"],
    };
    const res = parseAdsProCreativeProfile(input);
    assert.strictEqual(res.ok, true, "P-03: Perfil com todos os 5 estilos deve ser aceito");
    if (res.ok) {
      assert.strictEqual(res.value.schemaVersion, 1);
      assert.deepStrictEqual(res.value.preferredStyles, [
        "luxury",
        "editorial",
        "minimal",
        "sensory",
        "modern",
      ]);
    }
  });

  // P-04: Preservação estrita da ordem dos estilos (primário vs secundários)
  countAssert(() => {
    const input = {
      schemaVersion: 1,
      preferredStyles: ["sensory", "luxury", "minimal"],
    };
    const res = parseAdsProCreativeProfile(input);
    assert.strictEqual(res.ok, true, "P-04: Ordem dos estilos deve ser preservada");
    if (res.ok) {
      assert.strictEqual(res.value.preferredStyles[0], "sensory");
      assert.strictEqual(res.value.preferredStyles[1], "luxury");
      assert.strictEqual(res.value.preferredStyles[2], "minimal");
    }
  });

  // P-05: Imutabilidade do input com deepFreeze (não muta nem lança erro sob freeze)
  countAssert(() => {
    const input = deepFreeze({
      schemaVersion: 1,
      preferredStyles: ["modern", "minimal"],
    });
    const res = parseAdsProCreativeProfile(input);
    assert.strictEqual(res.ok, true, "P-05: Input congelado deve ser processado normalmente");
    if (res.ok) {
      assert.deepStrictEqual(res.value.preferredStyles, ["modern", "minimal"]);
      assert.notStrictEqual(res.value, input, "P-05: Retorno deve ser nova instância");
    }
  });

  // =========================================================================
  // 2. REJEIÇÃO ESTRITA DE ENTRADAS INVÁLIDAS (P-06 a P-19)
  // =========================================================================
  console.log("-> 2. Rejeição Estrita de Entradas Inválidas (P-06 a P-19)");

  // P-06: Entrada null
  countAssert(() => {
    const res = parseAdsProCreativeProfile(null);
    assert.strictEqual(res.ok, false, "P-06: null deve ser rejeitado");
    if (!res.ok) {
      assert.strictEqual(res.errors[0].code, "NOT_AN_OBJECT");
    }
  });

  // P-07: Entrada array ou primitivo
  countAssert(() => {
    const resArr = parseAdsProCreativeProfile([]);
    assert.strictEqual(resArr.ok, false, "P-07: Array deve ser rejeitado");
    if (!resArr.ok) {
      assert.strictEqual(resArr.errors[0].code, "NOT_AN_OBJECT");
    }

    const resStr = parseAdsProCreativeProfile("invalid");
    assert.strictEqual(resStr.ok, false, "P-07: String deve ser rejeitada");
    if (!resStr.ok) {
      assert.strictEqual(resStr.errors[0].code, "NOT_AN_OBJECT");
    }
  });

  // P-08: schemaVersion ausente
  countAssert(() => {
    const res = parseAdsProCreativeProfile({ preferredStyles: ["minimal"] });
    assert.strictEqual(res.ok, false, "P-08: schemaVersion ausente deve ser rejeitado");
    if (!res.ok) {
      assert.strictEqual(res.errors.some((e) => e.code === "MISSING_SCHEMA_VERSION"), true);
    }
  });

  // P-09: schemaVersion incompatível (2, 0, "1", null, 1.5)
  countAssert(() => {
    for (const badVersion of [2, 0, "1", null, 1.5, -1]) {
      const res = parseAdsProCreativeProfile({
        schemaVersion: badVersion,
        preferredStyles: ["minimal"],
      });
      assert.strictEqual(
        res.ok,
        false,
        `P-09: schemaVersion ${String(badVersion)} deve ser incompatível`
      );
      if (!res.ok) {
        assert.strictEqual(res.errors.some((e) => e.code === "SCHEMA_INCOMPATIBLE"), true);
      }
    }
  });

  // P-10: preferredStyles ausente
  countAssert(() => {
    const res = parseAdsProCreativeProfile({ schemaVersion: 1 });
    assert.strictEqual(res.ok, false, "P-10: preferredStyles ausente deve ser rejeitado");
    if (!res.ok) {
      assert.strictEqual(res.errors.some((e) => e.code === "MISSING_PREFERRED_STYLES"), true);
    }
  });

  // P-11: preferredStyles não é array (string, objeto, número)
  countAssert(() => {
    for (const badStyles of ["minimal", { 0: "minimal" }, 123, null]) {
      const res = parseAdsProCreativeProfile({
        schemaVersion: 1,
        preferredStyles: badStyles,
      });
      assert.strictEqual(
        res.ok,
        false,
        `P-11: preferredStyles ${String(badStyles)} deve ser rejeitado`
      );
      if (!res.ok) {
        assert.strictEqual(res.errors.some((e) => e.code === "INVALID_PREFERRED_STYLES"), true);
      }
    }
  });

  // P-12: Estilo desconhecido ("futuristic", "cyberpunk", "")
  countAssert(() => {
    const res = parseAdsProCreativeProfile({
      schemaVersion: 1,
      preferredStyles: ["minimal", "futuristic"],
    });
    assert.strictEqual(res.ok, false, "P-12: Estilo desconhecido deve ser rejeitado");
    if (!res.ok) {
      assert.strictEqual(res.errors.some((e) => e.code === "INVALID_STYLE"), true);
    }
  });

  // P-13: "fresh-premium" ou CreativeFamily rejeitado como estilo (CreativeFamily != Style)
  countAssert(() => {
    const res = parseAdsProCreativeProfile({
      schemaVersion: 1,
      preferredStyles: ["fresh-premium"],
    });
    assert.strictEqual(res.ok, false, "P-13: fresh-premium NÃO é um MarketingProStyle");
    if (!res.ok) {
      assert.strictEqual(res.errors.some((e) => e.code === "INVALID_STYLE"), true);
    }
  });

  // P-14: Estilo duplicado em preferredStyles
  countAssert(() => {
    const res = parseAdsProCreativeProfile({
      schemaVersion: 1,
      preferredStyles: ["minimal", "modern", "minimal"],
    });
    assert.strictEqual(res.ok, false, "P-14: Estilo duplicado deve ser rejeitado");
    if (!res.ok) {
      assert.strictEqual(res.errors.some((e) => e.code === "DUPLICATE_STYLE"), true);
    }
  });

  // P-15: Chave desconhecida no topo do objeto
  countAssert(() => {
    const res = parseAdsProCreativeProfile({
      schemaVersion: 1,
      preferredStyles: ["minimal"],
      unknownKey: "value",
    });
    assert.strictEqual(res.ok, false, "P-15: Chave desconhecida deve ser rejeitada");
    if (!res.ok) {
      assert.strictEqual(res.errors.some((e) => e.code === "UNKNOWN_KEY"), true);
    }
  });

  // P-16: Chave creativeFamily no topo do perfil (CreativeFamily DEFERRED)
  countAssert(() => {
    const res = parseAdsProCreativeProfile({
      schemaVersion: 1,
      preferredStyles: ["minimal"],
      creativeFamily: "fresh-premium",
    });
    assert.strictEqual(res.ok, false, "P-16: creativeFamily DEVE ser rejeitado em V1");
    if (!res.ok) {
      assert.strictEqual(res.errors.some((e) => e.code === "UNKNOWN_KEY"), true);
    }
  });

  // P-17: Rejeição de PII (userId, email, phone, name)
  countAssert(() => {
    const res = parseAdsProCreativeProfile({
      schemaVersion: 1,
      preferredStyles: [],
      userId: "usr_123",
      email: "loja@test.com",
    });
    assert.strictEqual(res.ok, false, "P-17: Campos PII devem ser rejeitados");
    if (!res.ok) {
      assert.strictEqual(res.errors.some((e) => e.code === "UNKNOWN_KEY"), true);
    }
  });

  // P-18: Rejeição de timestamps (createdAt, updatedAt)
  countAssert(() => {
    const res = parseAdsProCreativeProfile({
      schemaVersion: 1,
      preferredStyles: [],
      createdAt: 1711234567890,
    });
    assert.strictEqual(res.ok, false, "P-18: Timestamps devem ser rejeitados");
    if (!res.ok) {
      assert.strictEqual(res.errors.some((e) => e.code === "UNKNOWN_KEY"), true);
    }
  });

  // P-19: Rejeição de dados de campanha efêmera no profile (category, intent, format, entityKind)
  countAssert(() => {
    const res = parseAdsProCreativeProfile({
      schemaVersion: 1,
      preferredStyles: [],
      category: "calcados",
      intent: "oferta",
    });
    assert.strictEqual(res.ok, false, "P-19: Contexto efêmero deve ser rejeitado no perfil");
    if (!res.ok) {
      assert.strictEqual(res.errors.some((e) => e.code === "UNKNOWN_KEY"), true);
    }
  });

  // =========================================================================
  // 3. RESOLUÇÃO PURA DO CONTEXTO DE MATCH (R-01 a R-11)
  // =========================================================================
  console.log("-> 3. Resolução Pura do Contexto de Match (R-01 a R-11)");

  const baseCreationContext: AdCreationContext = {
    entityKind: "product",
    format: "portrait",
    category: "fashion",
    intent: "promo",
  };

  // R-01: entityKind preservado
  countAssert(() => {
    const ctx = resolveAssetMatchContext({ entityKind: "service", format: "square" });
    assert.strictEqual(ctx.entityKind, "service", "R-01: entityKind deve ser preservado");
  });

  // R-02: format preservado
  countAssert(() => {
    const ctx = resolveAssetMatchContext({ entityKind: "product", format: "story" });
    assert.strictEqual(ctx.format, "story", "R-02: format deve ser preservado");
  });

  // R-03: category preservada quando presente, omitida quando undefined
  countAssert(() => {
    const ctxWith = resolveAssetMatchContext(baseCreationContext);
    assert.strictEqual(ctxWith.category, "fashion", "R-03: category deve ser preservada");

    const ctxWithout = resolveAssetMatchContext({ entityKind: "product", format: "portrait" });
    assert.strictEqual(ctxWithout.category, undefined, "R-03: category undefined preservada");
  });

  // R-04: intent preservada quando presente, omitida quando undefined
  countAssert(() => {
    const ctxWith = resolveAssetMatchContext(baseCreationContext);
    assert.strictEqual(ctxWith.intent, "promo", "R-04: intent deve ser preservada");

    const ctxWithout = resolveAssetMatchContext({ entityKind: "product", format: "portrait" });
    assert.strictEqual(ctxWithout.intent, undefined, "R-04: intent undefined preservada");
  });

  // R-05: profile preferredStyles injetado
  countAssert(() => {
    const profile: AdsProCreativeProfileV1 = {
      schemaVersion: 1,
      preferredStyles: ["minimal", "luxury"],
    };
    const ctx = resolveAssetMatchContext(baseCreationContext, profile);
    assert.deepStrictEqual(ctx.preferredStyles, ["minimal", "luxury"]);
  });

  // R-06: Ordem do profile preservada: preferredStyles[0] primário, subsequentes secundários
  countAssert(() => {
    const profile: AdsProCreativeProfileV1 = {
      schemaVersion: 1,
      preferredStyles: ["sensory", "modern", "minimal"],
    };
    const ctx = resolveAssetMatchContext(baseCreationContext, profile);
    assert.ok(ctx.preferredStyles);
    assert.strictEqual(ctx.preferredStyles[0], "sensory");
    assert.strictEqual(ctx.preferredStyles[1], "modern");
    assert.strictEqual(ctx.preferredStyles[2], "minimal");
  });

  // R-07: profile ausente (undefined) resulta em preferredStyles vazio ([])
  countAssert(() => {
    const ctx = resolveAssetMatchContext(baseCreationContext, undefined);
    assert.deepStrictEqual(ctx.preferredStyles, [], "R-07: profile undefined -> preferredStyles []");
  });

  // R-08: profile com preferredStyles vazio resulta em preferredStyles vazio ([])
  countAssert(() => {
    const profile: AdsProCreativeProfileV1 = {
      schemaVersion: 1,
      preferredStyles: [],
    };
    const ctx = resolveAssetMatchContext(baseCreationContext, profile);
    assert.deepStrictEqual(ctx.preferredStyles, [], "R-08: profile [] -> preferredStyles []");
  });

  // R-09: Profile NÃO consegue sobrescrever nem alterar category
  countAssert(() => {
    const profileMalicioso = {
      schemaVersion: 1,
      preferredStyles: ["minimal"],
      category: "home", // tentativa de injeção
    } as unknown as AdsProCreativeProfileV1;

    const ctx = resolveAssetMatchContext(baseCreationContext, profileMalicioso);
    assert.strictEqual(ctx.category, "fashion", "R-09: Profile não pode alterar category");
  });

  // R-10: Profile NÃO consegue sobrescrever nem alterar intent
  countAssert(() => {
    const profileMalicioso = {
      schemaVersion: 1,
      preferredStyles: ["minimal"],
      intent: "spotlight", // tentativa de injeção
    } as unknown as AdsProCreativeProfileV1;

    const ctx = resolveAssetMatchContext(baseCreationContext, profileMalicioso);
    assert.strictEqual(ctx.intent, "promo", "R-10: Profile não pode alterar intent");
  });

  // R-11: Imutabilidade com deepFreeze no requestContext e profile
  countAssert(() => {
    const frozenReq = deepFreeze({ ...baseCreationContext });
    const frozenProf = deepFreeze<AdsProCreativeProfileV1>({
      schemaVersion: 1,
      preferredStyles: ["luxury"],
    });

    const ctx = resolveAssetMatchContext(frozenReq, frozenProf);
    assert.strictEqual(Object.isFrozen(ctx), true, "R-11: ctx deve ser congelado");
    assert.strictEqual(Object.isFrozen(ctx.preferredStyles), true);
    assert.ok(ctx.preferredStyles);
    assert.strictEqual(ctx.preferredStyles[0], "luxury");
  });

  // =========================================================================
  // 4. INTEGRAÇÃO END-TO-END COM O MATCHER (INT-01 a INT-05)
  // =========================================================================
  console.log("-> 4. Integração End-to-End com o Matcher (INT-01 a INT-05)");

  // INT-01: Perfil ordenado faz estilo primário vencer secundário no Matcher
  countAssert(() => {
    const profile: AdsProCreativeProfileV1 = {
      schemaVersion: 1,
      preferredStyles: ["minimal", "modern"],
    };
    const matchCtx = resolveAssetMatchContext(
      {
        entityKind: "product",
        format: "portrait",
        category: "fashion",
        intent: "promo",
      },
      profile
    );

    const assetMinimal = createSyntheticAsset({
      id: "asset_minimal",
      targetCategories: ["fashion"],
      supportedIntents: ["promo"],
      styles: ["minimal"], // match primário com profile[0]
    });

    const assetModern = createSyntheticAsset({
      id: "asset_modern",
      targetCategories: ["fashion"],
      supportedIntents: ["promo"],
      styles: ["modern"], // match secundário com profile[1]
    });

    const manifest: AssetLibraryManifest = {
      schemaVersion: 1,
      libraryVersion: "1.0.0",
      assets: [assetModern, assetMinimal],
    };

    const result = rankAdsProAssets(manifest, matchCtx);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(
      result[0].asset.id,
      "asset_minimal",
      "INT-01: Estilo primário do perfil (minimal) deve vencer estilo secundário (modern)"
    );
    assert.strictEqual(result[0].breakdown.styleAffinity, "primary");
    assert.strictEqual(result[1].breakdown.styleAffinity, "secondary");
  });

  // INT-02: PRESERVAÇÃO DA HIERARQUIA: Category exact + Style none VENCE Category universal + Style primary!
  countAssert(() => {
    const profile: AdsProCreativeProfileV1 = {
      schemaVersion: 1,
      preferredStyles: ["luxury"],
    };
    const matchCtx = resolveAssetMatchContext(
      {
        entityKind: "product",
        format: "portrait",
        category: "fashion",
      },
      profile
    );

    const assetExactCatNoStyle = createSyntheticAsset({
      id: "asset_exact_cat",
      targetCategories: ["fashion"], // Category Exact (prioridade 0)
      styles: ["minimal"], // Style none em relação ao profile ("luxury")
    });

    const assetUniversalCatPrimaryStyle = createSyntheticAsset({
      id: "asset_univ_cat_primary_style",
      targetCategories: [], // Category Universal (prioridade 1)
      styles: ["luxury"], // Style Primary em relação ao profile ("luxury")
    });

    const manifest: AssetLibraryManifest = {
      schemaVersion: 1,
      libraryVersion: "1.0.0",
      assets: [assetUniversalCatPrimaryStyle, assetExactCatNoStyle],
    };

    const result = rankAdsProAssets(manifest, matchCtx);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(
      result[0].asset.id,
      "asset_exact_cat",
      "INT-02: Category exact com style none DEVE vencer Category universal com style primary!"
    );
    assert.strictEqual(result[0].breakdown.categoryAffinity, "exact");
    assert.strictEqual(result[0].breakdown.styleAffinity, "none");
    assert.strictEqual(result[1].breakdown.categoryAffinity, "universal");
    assert.strictEqual(result[1].breakdown.styleAffinity, "primary");
  });

  // INT-03: PRESERVAÇÃO DA HIERARQUIA: Intent exact + Style none VENCE Intent universal + Style primary!
  countAssert(() => {
    const profile: AdsProCreativeProfileV1 = {
      schemaVersion: 1,
      preferredStyles: ["luxury"],
    };
    const matchCtx = resolveAssetMatchContext(
      {
        entityKind: "product",
        format: "portrait",
        category: "fashion",
        intent: "promo",
      },
      profile
    );

    const assetExactIntentNoStyle = createSyntheticAsset({
      id: "asset_exact_intent",
      targetCategories: ["fashion"], // Category Exact
      supportedIntents: ["promo"], // Intent Exact (prioridade 0)
      styles: ["minimal"], // Style none
    });

    const assetUniversalIntentPrimaryStyle = createSyntheticAsset({
      id: "asset_univ_intent_primary_style",
      targetCategories: ["fashion"], // Category Exact
      supportedIntents: [], // Intent Universal (prioridade 1)
      styles: ["luxury"], // Style Primary
    });

    const manifest: AssetLibraryManifest = {
      schemaVersion: 1,
      libraryVersion: "1.0.0",
      assets: [assetUniversalIntentPrimaryStyle, assetExactIntentNoStyle],
    };

    const result = rankAdsProAssets(manifest, matchCtx);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(
      result[0].asset.id,
      "asset_exact_intent",
      "INT-03: Intent exact com style none DEVE vencer Intent universal com style primary!"
    );
    assert.strictEqual(result[0].breakdown.intentAffinity, "exact");
    assert.strictEqual(result[0].breakdown.styleAffinity, "none");
    assert.strictEqual(result[1].breakdown.intentAffinity, "universal");
    assert.strictEqual(result[1].breakdown.styleAffinity, "primary");
  });

  // INT-04: Sem profile (ou profile []) -> todos assets style none, desempata por total order
  countAssert(() => {
    const matchCtx = resolveAssetMatchContext({
      entityKind: "product",
      format: "portrait",
    });

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

    const result = rankAdsProAssets(manifest, matchCtx);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].breakdown.styleAffinity, "none");
    assert.strictEqual(result[1].breakdown.styleAffinity, "none");
    assert.strictEqual(result[0].asset.id, "asset_a", "INT-04: Desempate ASCII quando styleAffinity é none");
  });

  // INT-05: Determinismo absoluto em 100 execuções com inputs congelados
  countAssert(() => {
    const profile: AdsProCreativeProfileV1 = deepFreeze({
      schemaVersion: 1,
      preferredStyles: ["minimal", "luxury"],
    });
    const matchCtx = resolveAssetMatchContext(
      deepFreeze({
        entityKind: "product",
        format: "portrait",
        category: "fashion",
        intent: "promo",
      }),
      profile
    );

    const asset1 = deepFreeze(
      createSyntheticAsset({
        id: "asset_1",
        targetCategories: ["fashion"],
        supportedIntents: ["promo"],
        styles: ["minimal"],
      })
    );
    const asset2 = deepFreeze(
      createSyntheticAsset({
        id: "asset_2",
        targetCategories: ["fashion"],
        supportedIntents: ["promo"],
        styles: ["luxury"],
      })
    );

    const manifest: AssetLibraryManifest = deepFreeze({
      schemaVersion: 1,
      libraryVersion: "1.0.0",
      assets: [asset2, asset1],
    });

    const firstRun = rankAdsProAssets(manifest, matchCtx).map((r) => r.asset.id);
    for (let i = 0; i < 100; i += 1) {
      const subsequentRun = rankAdsProAssets(manifest, matchCtx).map((r) => r.asset.id);
      assert.deepStrictEqual(subsequentRun, firstRun, `INT-05: Falha de determinismo na iteração ${i}`);
    }
  });

  // =========================================================================
  // 5. AUDITORIA DE PUREZA E STATIC CHECKS (PUR-01 a PUR-02)
  // =========================================================================
  console.log("-> 5. Auditoria de Pureza e Static Checks (PUR-01 a PUR-02)");

  countAssert(() => {
    const profilePath = process.env.ADS_PRO_CREATIVE_PROFILE_PATH
      ? path.resolve(process.env.ADS_PRO_CREATIVE_PROFILE_PATH)
      : path.resolve(process.cwd(), "shared/ads-pro/creative-profile.ts");
    const content = fs.readFileSync(profilePath, "utf8");

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
    assert.strictEqual(ADS_PRO_CREATIVE_PROFILE_SCHEMA_VERSION, 1);
  });

  console.log(`\n=== SUÍTE ADS-PRO-03A CONCLUÍDA COM SUCESSO (${assertionCount} asserções) ===`);
}

runTests();
