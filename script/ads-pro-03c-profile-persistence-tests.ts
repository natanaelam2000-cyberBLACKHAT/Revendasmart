/**
 * ADS-PRO-03C — Suíte de Testes Profunda da Persistência do Creative Profile
 *
 * Cobertura de Testes:
 * 1. Testes de Escrita (W-01 a W-10)
 * 2. Testes de Leitura e Fail-Safe (R-01 a R-09)
 * 3. Testes de Ownership e Isolamento de Tenant (O-01 a O-05)
 * 4. Testes de Proteção contra Mass Assignment e Campos Irmãos (M-01 a M-02)
 * 5. Testes de Semântica de Limpeza (Clear) (C-01 a C-03)
 * 6. Integração com o Matcher e Quiz (INT-01 a INT-05)
 *    - INT-01: preferredStyles influencia styleAffinity
 *    - INT-02: requestContext (category, intent, entityKind, format) inviolável
 *    - INT-03: Pipeline completo Quiz -> Save -> Load -> Matcher
 *    - INT-04: Hierarquia category > style preservada
 *    - INT-05: Hierarquia intent > style preservada
 */

import assert from "node:assert/strict";
import {
  clearAdsProCreativeProfile,
  getAdsProCreativeProfile,
  getAdsProCreativeProfileDocPath,
  saveAdsProCreativeProfile,
  AdsProCreativeProfileError,
  type AdsProFirestoreAdapter,
} from "../client/src/lib/ads-pro-profile-persistence";
import {
  resolveAssetMatchContext,
  type AdCreationContext,
} from "../shared/ads-pro/creative-profile";
import {
  ADS_PRO_STYLE_QUIZ_DEFINITION_V1,
  resolveCreativeProfileFromQuiz,
  type AdsProStyleQuizSubmission,
} from "../shared/ads-pro/style-quiz";
import { rankAdsProAssets } from "../shared/ads-pro/asset-matcher";
import type { AssetDNA, AssetLibraryManifest } from "../shared/ads-pro/asset-dna";

// ============================================================
// Adaptador isolado e determinístico em memória para testes unitários
// ============================================================

export class InMemoryFirestoreAdapter implements AdsProFirestoreAdapter {
  public readonly storage = new Map<string, unknown>();

  public getDoc(path: string): Promise<{ exists: boolean; data?: unknown }> {
    const data = this.storage.get(path);
    return Promise.resolve({
      exists: data !== undefined,
      data: data !== undefined ? JSON.parse(JSON.stringify(data)) : undefined,
    });
  }

  public setDoc(path: string, data: unknown): Promise<void> {
    this.storage.set(path, JSON.parse(JSON.stringify(data)));
    return Promise.resolve();
  }

  public deleteDoc(path: string): Promise<void> {
    this.storage.delete(path);
    return Promise.resolve();
  }
}

// ============================================================
// Helpers para testes do Matcher
// ============================================================

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

// ============================================================
// SUÍTE DE TESTES
// ============================================================

export async function runAllPersistenceTests(adapterFactory = () => new InMemoryFirestoreAdapter()) {
  console.log("=== INICIANDO SUÍTE ADS-PRO-03C PERSISTÊNCIA ===");

  const adapter = adapterFactory();
  const uidA = "tenant-lojista-alpha";

  // ==========================================================
  // SEÇÃO 1: TESTES DE ESCRITA (W-01 a W-10)
  // ==========================================================
  console.log("\n--- 1. TESTES DE ESCRITA (W-01 a W-10) ---");

  // W-01: salvar []
  {
    const saved = await saveAdsProCreativeProfile(
      { schemaVersion: 1, preferredStyles: [] },
      { adapter, uid: uidA }
    );
    assert.equal(saved.schemaVersion, 1);
    assert.deepEqual(saved.preferredStyles, []);
    const stored = (await adapter.getDoc(getAdsProCreativeProfileDocPath(uidA))).data;
    assert.deepEqual(stored, { schemaVersion: 1, preferredStyles: [] });
    console.log("PASS W-01: salvar preferredStyles vazio []");
  }

  // W-02: salvar um style
  {
    const saved = await saveAdsProCreativeProfile(
      { schemaVersion: 1, preferredStyles: ["modern"] },
      { adapter, uid: uidA }
    );
    assert.equal(saved.schemaVersion, 1);
    assert.deepEqual(saved.preferredStyles, ["modern"]);
    const stored = (await adapter.getDoc(getAdsProCreativeProfileDocPath(uidA))).data;
    assert.deepEqual(stored, { schemaVersion: 1, preferredStyles: ["modern"] });
    console.log("PASS W-02: salvar um único style");
  }

  // W-03: salvar vários styles em ordem estrita
  {
    const styles = ["luxury", "minimal", "editorial", "sensory", "modern"] as const;
    const saved = await saveAdsProCreativeProfile(
      { schemaVersion: 1, preferredStyles: styles },
      { adapter, uid: uidA }
    );
    assert.deepEqual(saved.preferredStyles, styles);
    const stored = (await adapter.getDoc(getAdsProCreativeProfileDocPath(uidA))).data as any;
    assert.deepEqual(stored.preferredStyles, styles);
    console.log("PASS W-03: salvar múltiplos styles preservando ordem");
  }

  // W-04: duplicate rejeitado antes da escrita
  {
    await assert.rejects(
      async () => {
        await saveAdsProCreativeProfile(
          { schemaVersion: 1, preferredStyles: ["modern", "minimal", "modern"] },
          { adapter, uid: uidA }
        );
      },
      (err: any) => {
        assert.equal(err instanceof AdsProCreativeProfileError, true);
        assert.equal(err.code, "ADS_PRO_CREATIVE_PROFILE_INVALID");
        return true;
      }
    );
    console.log("PASS W-04: duplicate styles rejeitados antes do write");
  }

  // W-05: style inválido rejeitado
  {
    await assert.rejects(
      async () => {
        await saveAdsProCreativeProfile(
          { schemaVersion: 1, preferredStyles: ["not-a-real-style"] },
          { adapter, uid: uidA }
        );
      },
      (err: any) => {
        assert.equal(err instanceof AdsProCreativeProfileError, true);
        assert.equal(err.code, "ADS_PRO_CREATIVE_PROFILE_INVALID");
        return true;
      }
    );
    console.log("PASS W-05: style inválido rejeitado");
  }

  // W-06: fresh-* rejeitado (famílias legadas do PRO-10B)
  {
    for (const legacy of ["fresh-premium", "fresh-sport", "fresh-commercial"]) {
      await assert.rejects(
        async () => {
          await saveAdsProCreativeProfile(
            { schemaVersion: 1, preferredStyles: [legacy] },
            { adapter, uid: uidA }
          );
        },
        (err: any) => {
          assert.equal(err.code, "ADS_PRO_CREATIVE_PROFILE_INVALID");
          return true;
        }
      );
    }
    console.log("PASS W-06: estilos sazonais legados fresh-* rejeitados");
  }

  // W-07: unknown key rejeitada
  {
    await assert.rejects(
      async () => {
        await saveAdsProCreativeProfile(
          { schemaVersion: 1, preferredStyles: ["modern"], extraKey: "injected" },
          { adapter, uid: uidA }
        );
      },
      (err: any) => {
        assert.equal(err.code, "ADS_PRO_CREATIVE_PROFILE_INVALID");
        return true;
      }
    );
    console.log("PASS W-07: chave desconhecida rejeitada");
  }

  // W-08: schemaVersion incompatível rejeitado
  {
    for (const badVersion of [0, 2, 99, "1", null, undefined]) {
      await assert.rejects(
        async () => {
          await saveAdsProCreativeProfile(
            { schemaVersion: badVersion, preferredStyles: ["modern"] },
            { adapter, uid: uidA }
          );
        },
        (err: any) => {
          assert.equal(err.code, "ADS_PRO_CREATIVE_PROFILE_INVALID");
          return true;
        }
      );
    }
    console.log("PASS W-08: schemaVersion incompatível rejeitado");
  }

  // W-09: PII extra rejeitada
  {
    const piiPayloads = [
      { schemaVersion: 1, preferredStyles: ["modern"], email: "admin@loja.com" },
      { schemaVersion: 1, preferredStyles: ["modern"], name: "Dono da Loja" },
      { schemaVersion: 1, preferredStyles: ["modern"], phone: "+5511999999999" },
      { schemaVersion: 1, preferredStyles: ["modern"], displayName: "Loja Teste" },
    ];
    for (const payload of piiPayloads) {
      await assert.rejects(
        async () => {
          await saveAdsProCreativeProfile(payload, { adapter, uid: uidA });
        },
        (err: any) => {
          assert.equal(err.code, "ADS_PRO_CREATIVE_PROFILE_INVALID");
          return true;
        }
      );
    }
    console.log("PASS W-09: PII e campos pessoais rejeitados");
  }

  // W-10: mesmo profile salvo novamente é idempotente
  {
    const profile = { schemaVersion: 1, preferredStyles: ["minimal", "editorial"] };
    await saveAdsProCreativeProfile(profile, { adapter, uid: uidA });
    const snap1 = (await adapter.getDoc(getAdsProCreativeProfileDocPath(uidA))).data;

    await saveAdsProCreativeProfile(profile, { adapter, uid: uidA });
    const snap2 = (await adapter.getDoc(getAdsProCreativeProfileDocPath(uidA))).data;

    assert.deepEqual(snap1, snap2);
    console.log("PASS W-10: escrita estritamente idempotente");
  }

  // ==========================================================
  // SEÇÃO 2: TESTES DE LEITURA (R-01 a R-09)
  // ==========================================================
  console.log("\n--- 2. TESTES DE LEITURA (R-01 a R-09) ---");

  const uidMissing = "tenant-sem-perfil";

  // R-01: documento ausente retorna null (sem fallback artificial)
  {
    const loaded = await getAdsProCreativeProfile({ adapter, uid: uidMissing });
    assert.equal(loaded, null);
    console.log("PASS R-01: documento ausente retorna null");
  }

  // R-02: documento válido vazio
  {
    const uidEmpty = "tenant-vazio";
    await adapter.setDoc(getAdsProCreativeProfileDocPath(uidEmpty), {
      schemaVersion: 1,
      preferredStyles: [],
    });
    const loaded = await getAdsProCreativeProfile({ adapter, uid: uidEmpty });
    assert.notEqual(loaded, null);
    assert.equal(loaded!.schemaVersion, 1);
    assert.deepEqual(loaded!.preferredStyles, []);
    console.log("PASS R-02: documento válido vazio lido corretamente");
  }

  // R-03: documento válido com styles
  {
    const uidValid = "tenant-com-styles";
    await adapter.setDoc(getAdsProCreativeProfileDocPath(uidValid), {
      schemaVersion: 1,
      preferredStyles: ["sensory", "minimal"],
    });
    const loaded = await getAdsProCreativeProfile({ adapter, uid: uidValid });
    assert.notEqual(loaded, null);
    assert.deepEqual(loaded!.preferredStyles, ["sensory", "minimal"]);
    console.log("PASS R-03: documento válido com styles lido corretamente");
  }

  // R-04: ordem estritamente preservada
  {
    const uidOrder = "tenant-order";
    const ordered = ["modern", "luxury", "editorial"] as const;
    await adapter.setDoc(getAdsProCreativeProfileDocPath(uidOrder), {
      schemaVersion: 1,
      preferredStyles: ordered,
    });
    const loaded = await getAdsProCreativeProfile({ adapter, uid: uidOrder });
    assert.equal(loaded!.preferredStyles[0], "modern");
    assert.equal(loaded!.preferredStyles[1], "luxury");
    assert.equal(loaded!.preferredStyles[2], "editorial");
    console.log("PASS R-04: ordem primária e secundária preservada na leitura");
  }

  // R-05: documento corrompido lança ADS_PRO_CREATIVE_PROFILE_INVALID
  {
    const uidCorrupt = "tenant-corrompido";
    await adapter.setDoc(getAdsProCreativeProfileDocPath(uidCorrupt), {
      schemaVersion: 1,
      preferredStyles: "not-an-array",
    });
    await assert.rejects(
      async () => {
        await getAdsProCreativeProfile({ adapter, uid: uidCorrupt });
      },
      (err: any) => {
        assert.equal(err instanceof AdsProCreativeProfileError, true);
        assert.equal(err.code, "ADS_PRO_CREATIVE_PROFILE_INVALID");
        return true;
      }
    );
    console.log("PASS R-05: documento corrompido lança erro tipado");
  }

  // R-06: schema desconhecido (ex: versão 2)
  {
    const uidUnknownSchema = "tenant-schema-2";
    await adapter.setDoc(getAdsProCreativeProfileDocPath(uidUnknownSchema), {
      schemaVersion: 2,
      preferredStyles: ["minimal"],
    });
    await assert.rejects(
      async () => {
        await getAdsProCreativeProfile({ adapter, uid: uidUnknownSchema });
      },
      (err: any) => {
        assert.equal(err.code, "ADS_PRO_CREATIVE_PROFILE_INVALID");
        return true;
      }
    );
    console.log("PASS R-06: schemaVersion desconhecido lança erro tipado");
  }

  // R-07: unknown field persistido no banco
  {
    const uidExtra = "tenant-banco-sujo";
    await adapter.setDoc(getAdsProCreativeProfileDocPath(uidExtra), {
      schemaVersion: 1,
      preferredStyles: ["minimal"],
      hackedField: true,
    });
    await assert.rejects(
      async () => {
        await getAdsProCreativeProfile({ adapter, uid: uidExtra });
      },
      (err: any) => {
        assert.equal(err.code, "ADS_PRO_CREATIVE_PROFILE_INVALID");
        return true;
      }
    );
    console.log("PASS R-07: campo desconhecido persistido rejeitado na leitura");
  }

  // R-08: style legado fresh-* persistido
  {
    const uidLegacy = "tenant-legacy-db";
    await adapter.setDoc(getAdsProCreativeProfileDocPath(uidLegacy), {
      schemaVersion: 1,
      preferredStyles: ["fresh-commercial"],
    });
    await assert.rejects(
      async () => {
        await getAdsProCreativeProfile({ adapter, uid: uidLegacy });
      },
      (err: any) => {
        assert.equal(err.code, "ADS_PRO_CREATIVE_PROFILE_INVALID");
        return true;
      }
    );
    console.log("PASS R-08: estilo legado fresh-* rejeitado na leitura");
  }

  // R-09: input Firestore não mutado e objeto retornado é congelado
  {
    const uidFreeze = "tenant-freeze";
    const rawStored = {
      schemaVersion: 1,
      preferredStyles: ["minimal", "modern"],
    };
    await adapter.setDoc(getAdsProCreativeProfileDocPath(uidFreeze), rawStored);
    const loaded = await getAdsProCreativeProfile({ adapter, uid: uidFreeze });

    assert.equal(Object.isFrozen(loaded), true);
    assert.equal(Object.isFrozen(loaded!.preferredStyles), true);
    assert.throws(() => {
      (loaded as any).preferredStyles = [];
    });
    console.log("PASS R-09: imutabilidade e deep freeze do objeto retornado");
  }

  // ==========================================================
  // SEÇÃO 3: TESTES DE OWNERSHIP E ISOLAMENTO (O-01 a O-05)
  // ==========================================================
  console.log("\n--- 3. TESTES DE OWNERSHIP E ISOLAMENTO (O-01 a O-05) ---");

  const userAlpha = "user-alpha";
  const userBeta = "user-beta";

  // O-01 / O-02: usuário A lê e grava seu próprio profile
  {
    await saveAdsProCreativeProfile(
      { schemaVersion: 1, preferredStyles: ["luxury"] },
      { adapter, uid: userAlpha }
    );
    const profileA = await getAdsProCreativeProfile({ adapter, uid: userAlpha });
    assert.deepEqual(profileA!.preferredStyles, ["luxury"]);
    console.log("PASS O-01 / O-02: usuário Alpha lê e grava seu próprio profile");
  }

  // O-03 / O-04: isolamento de path entre tenants
  {
    await saveAdsProCreativeProfile(
      { schemaVersion: 1, preferredStyles: ["editorial"] },
      { adapter, uid: userBeta }
    );
    const profileA = await getAdsProCreativeProfile({ adapter, uid: userAlpha });
    const profileB = await getAdsProCreativeProfile({ adapter, uid: userBeta });

    assert.deepEqual(profileA!.preferredStyles, ["luxury"]);
    assert.deepEqual(profileB!.preferredStyles, ["editorial"]);
    assert.notEqual(
      getAdsProCreativeProfileDocPath(userAlpha),
      getAdsProCreativeProfileDocPath(userBeta)
    );
    console.log("PASS O-03 / O-04: isolamento estrito de paths entre tenants");
  }

  // O-05: unauthenticated bloqueado
  {
    await assert.rejects(
      async () => {
        await getAdsProCreativeProfile({ adapter, uid: "" });
      },
      (err: any) => {
        assert.equal(err instanceof AdsProCreativeProfileError, true);
        assert.equal(err.code, "UNAUTHENTICATED");
        return true;
      }
    );
    await assert.rejects(
      async () => {
        await saveAdsProCreativeProfile(
          { schemaVersion: 1, preferredStyles: [] },
          { adapter, uid: "   " }
        );
      },
      (err: any) => {
        assert.equal(err.code, "UNAUTHENTICATED");
        return true;
      }
    );
    console.log("PASS O-05: chamadas unauthenticated bloqueadas fail-closed");
  }

  // ==========================================================
  // SEÇÃO 4: MASS ASSIGNMENT E CAMPOS IRMÃOS (M-01 a M-02)
  // ==========================================================
  console.log("\n--- 4. MASS ASSIGNMENT E CAMPOS IRMÃOS (M-01 a M-02) ---");

  // M-01: tentativa de mass assignment é rejeitada pelo validador antes de tocar o banco
  {
    const attackerPayload = {
      schemaVersion: 1,
      preferredStyles: ["minimal"],
      uid: "hacked-uid",
      ownerId: "hacked-owner",
      email: "leak@test.com",
      category: "electronics",
      intent: "clearance",
      quizAnswers: { Q1: "A" },
      score: { minimal: 100 },
      creativeFamily: "luxury",
      createdAt: "2020-01-01",
      metadata: { admin: true },
    };
    await assert.rejects(
      async () => {
        await saveAdsProCreativeProfile(attackerPayload, { adapter, uid: userAlpha });
      },
      (err: any) => {
        assert.equal(err.code, "ADS_PRO_CREATIVE_PROFILE_INVALID");
        return true;
      }
    );
    console.log("PASS M-01: tentativa de mass assignment bloqueada pelo parser");
  }

  // M-02: salvar CreativeProfile não afeta user_settings ou campos irmãos
  {
    const userSettingsPath = `user_settings/${userAlpha}`;
    await adapter.setDoc(userSettingsPath, {
      storeName: "Minha Loja Alpha",
      catalogSlug: "loja-alpha",
      businessMode: "products",
      onboarding_completed: true,
    });

    // Salva Creative Profile
    await saveAdsProCreativeProfile(
      { schemaVersion: 1, preferredStyles: ["modern"] },
      { adapter, uid: userAlpha }
    );

    // Verifica que user_settings permanece 100% intacto
    const userSettingsSnap = await adapter.getDoc(userSettingsPath);
    const userSettings = userSettingsSnap.data as any;
    assert.equal(userSettings.storeName, "Minha Loja Alpha");
    assert.equal(userSettings.catalogSlug, "loja-alpha");
    assert.equal(userSettings.businessMode, "products");
    assert.equal(userSettings.onboarding_completed, true);
    assert.equal(userSettings.preferredStyles, undefined);
    console.log("PASS M-02: campos irmãos em user_settings e outras coleções 100% preservados");
  }

  // ==========================================================
  // SEÇÃO 5: CLEAR PROFILE (C-01 a C-03)
  // ==========================================================
  console.log("\n--- 5. CLEAR PROFILE (C-01 a C-03) ---");

  const uidClear = "tenant-clear-test";

  // C-01: clearAdsProCreativeProfile remove documento
  {
    await saveAdsProCreativeProfile(
      { schemaVersion: 1, preferredStyles: ["luxury", "modern"] },
      { adapter, uid: uidClear }
    );
    const before = await getAdsProCreativeProfile({ adapter, uid: uidClear });
    assert.notEqual(before, null);

    await clearAdsProCreativeProfile({ adapter, uid: uidClear });
    const after = await getAdsProCreativeProfile({ adapter, uid: uidClear });
    assert.equal(after, null);
    console.log("PASS C-01: clearAdsProCreativeProfile remove documento e subsequente leitura retorna null");
  }

  // C-02: distinção semântica entre ausente (null) e explicitamente vazio ([])
  {
    // 1. Salvar explicitamente vazio
    await saveAdsProCreativeProfile(
      { schemaVersion: 1, preferredStyles: [] },
      { adapter, uid: uidClear }
    );
    const explicitEmpty = await getAdsProCreativeProfile({ adapter, uid: uidClear });
    assert.notEqual(explicitEmpty, null);
    assert.deepEqual(explicitEmpty!.preferredStyles, []);

    // 2. Clear (apagar)
    await clearAdsProCreativeProfile({ adapter, uid: uidClear });
    const absent = await getAdsProCreativeProfile({ adapter, uid: uidClear });
    assert.equal(absent, null);
    console.log("PASS C-02: distinção entre explicitamente neutro ([]) e ausente (null) comprovada");
  }

  // C-03: resolveAssetMatchContext aceita ambos sem inventar fallback defaults
  {
    const requestContext: AdCreationContext = {
      entityKind: "product",
      format: "portrait",
      category: "beauty",
      intent: "brand",
    };

    const ctxNull = resolveAssetMatchContext(requestContext, undefined);
    assert.deepEqual(ctxNull.preferredStyles, []);

    const ctxEmpty = resolveAssetMatchContext(requestContext, {
      schemaVersion: 1,
      preferredStyles: [],
    });
    assert.deepEqual(ctxEmpty.preferredStyles, []);
    console.log("PASS C-03: resolveAssetMatchContext preserva neutralidade sem fallback default");
  }

  // ==========================================================
  // SEÇÃO 6: INTEGRAÇÃO COM MATCHER E QUIZ (INT-01 a INT-05)
  // ==========================================================
  console.log("\n--- 6. INTEGRAÇÃO COM MATCHER E QUIZ (INT-01 a INT-05) ---");

  const uidPipeline = "tenant-pipeline-e2e";

  // INT-01: preferredStyles persistido realmente influencia styleAffinity no Matcher
  {
    await saveAdsProCreativeProfile(
      { schemaVersion: 1, preferredStyles: ["luxury"] },
      { adapter, uid: uidPipeline }
    );
    const loadedProfile = await getAdsProCreativeProfile({ adapter, uid: uidPipeline });

    const requestContext: AdCreationContext = {
      entityKind: "product",
      format: "portrait",
      category: "beauty",
    };
    const matchContext = resolveAssetMatchContext(requestContext, loadedProfile ?? undefined);

    const assetLuxury = createSyntheticAsset({
      id: "asset-luxury",
      styles: ["luxury"],
      targetCategories: ["beauty"],
    });
    const assetMinimal = createSyntheticAsset({
      id: "asset-minimal",
      styles: ["minimal"],
      targetCategories: ["beauty"],
    });

    const manifest: AssetLibraryManifest = {
      schemaVersion: 1,
      libraryVersion: "1.0.0",
      assets: [assetMinimal, assetLuxury],
    };

    const matchResult = rankAdsProAssets(manifest, matchContext);
    assert.equal(matchResult.length, 2);
    assert.equal(matchResult[0].asset.id, "asset-luxury");
    assert.equal(matchResult[0].breakdown.styleAffinity, "primary");
    assert.equal(matchResult[1].breakdown.styleAffinity, "none");
    console.log("PASS INT-01: preferredStyles persistido influencia diretamente styleAffinity no Matcher");
  }

  // INT-02: roundtrip de persistência NÃO altera category, intent, entityKind ou format
  {
    await saveAdsProCreativeProfile(
      { schemaVersion: 1, preferredStyles: ["modern", "minimal"] },
      { adapter, uid: uidPipeline }
    );
    const loadedProfile = await getAdsProCreativeProfile({ adapter, uid: uidPipeline });

    const campaignContext: AdCreationContext = {
      entityKind: "product",
      format: "square",
      category: "electronics",
      intent: "launch",
    };

    const resolvedContext = resolveAssetMatchContext(campaignContext, loadedProfile ?? undefined);
    assert.equal(resolvedContext.entityKind, "product");
    assert.equal(resolvedContext.format, "square");
    assert.equal(resolvedContext.category, "electronics");
    assert.equal(resolvedContext.intent, "launch");
    assert.deepEqual(resolvedContext.preferredStyles, ["modern", "minimal"]);
    console.log("PASS INT-02: roundtrip não contamina parâmetros comerciais efêmeros");
  }

  // INT-03: Pipeline completo Quiz -> Save -> Load -> Matcher
  {
    const uidQuizUser = "user-quiz-flow";
    // Submissão canônica de quiz
    const submission: AdsProStyleQuizSubmission = {
      answers: [
        { questionId: "visual_composition", optionId: "comp_minimal" },
        { questionId: "visual_lighting", optionId: "light_clean_balanced" },
        { questionId: "visual_atmosphere", optionId: "atmo_curated" },
        { questionId: "visual_density", optionId: "density_spacious" },
        { questionId: "brand_expression", optionId: "expr_essential" },
      ],
    };

    // 1. Resolução pura do quiz
    const quizProfile = resolveCreativeProfileFromQuiz(
      submission,
      ADS_PRO_STYLE_QUIZ_DEFINITION_V1
    );
    assert.equal(quizProfile.schemaVersion, 1);
    assert.equal(quizProfile.preferredStyles[0], "minimal");

    // 2. Persistência autoritativa
    await saveAdsProCreativeProfile(quizProfile, { adapter, uid: uidQuizUser });

    // 3. Leitura autoritativa
    const loadedFromDb = await getAdsProCreativeProfile({ adapter, uid: uidQuizUser });
    assert.notEqual(loadedFromDb, null);
    assert.deepEqual(loadedFromDb!.preferredStyles, quizProfile.preferredStyles);

    // 4. Matcher
    const context = resolveAssetMatchContext(
      { entityKind: "product", format: "portrait" },
      loadedFromDb ?? undefined
    );

    const minimalAsset = createSyntheticAsset({ id: "bg-min", styles: ["minimal"] });
    const modernAsset = createSyntheticAsset({ id: "bg-mod", styles: ["modern"] });
    const manifest: AssetLibraryManifest = {
      schemaVersion: 1,
      libraryVersion: "1.0.0",
      assets: [modernAsset, minimalAsset],
    };

    const result = rankAdsProAssets(manifest, context);
    assert.equal(result[0].asset.id, "bg-min");
    assert.equal(result[0].breakdown.styleAffinity, "primary");
    console.log("PASS INT-03: pipeline completo Quiz -> Save -> Load -> Matcher verificado");
  }

  // INT-04: Category exact continua vencendo style primary
  {
    await saveAdsProCreativeProfile(
      { schemaVersion: 1, preferredStyles: ["luxury"] },
      { adapter, uid: uidPipeline }
    );
    const loadedProfile = await getAdsProCreativeProfile({ adapter, uid: uidPipeline });

    const matchContext = resolveAssetMatchContext(
      { entityKind: "product", format: "portrait", category: "fashion" },
      loadedProfile ?? undefined
    );

    // Asset A: categoria exata "fashion", style "minimal" (style mismatch)
    const assetA = createSyntheticAsset({
      id: "asset-exact-category",
      targetCategories: ["fashion"],
      styles: ["minimal"],
    });
    // Asset B: categoria universal [], style "luxury" (style primary)
    const assetB = createSyntheticAsset({
      id: "asset-style-primary-only",
      targetCategories: [],
      styles: ["luxury"],
    });

    const manifest: AssetLibraryManifest = {
      schemaVersion: 1,
      libraryVersion: "1.0.0",
      assets: [assetB, assetA],
    };

    const result = rankAdsProAssets(manifest, matchContext);
    assert.equal(result[0].asset.id, "asset-exact-category");
    assert.equal(result[0].breakdown.categoryAffinity, "exact");
    assert.equal(result[1].asset.id, "asset-style-primary-only");
    assert.equal(result[1].breakdown.categoryAffinity, "universal");
    console.log("PASS INT-04: hierarquia category > style estritamente preservada");
  }

  // INT-05: Intent exact continua vencendo style primary
  {
    await saveAdsProCreativeProfile(
      { schemaVersion: 1, preferredStyles: ["luxury"] },
      { adapter, uid: uidPipeline }
    );
    const loadedProfile = await getAdsProCreativeProfile({ adapter, uid: uidPipeline });

    const matchContext = resolveAssetMatchContext(
      { entityKind: "product", format: "portrait", intent: "clearance" },
      loadedProfile ?? undefined
    );

    // Asset A: intent exato "clearance", style "minimal"
    const assetA = createSyntheticAsset({
      id: "asset-exact-intent",
      supportedIntents: ["clearance"],
      styles: ["minimal"],
    });
    // Asset B: intent universal [], style "luxury"
    const assetB = createSyntheticAsset({
      id: "asset-intent-universal-style-primary",
      supportedIntents: [],
      styles: ["luxury"],
    });

    const manifest: AssetLibraryManifest = {
      schemaVersion: 1,
      libraryVersion: "1.0.0",
      assets: [assetB, assetA],
    };

    const result = rankAdsProAssets(manifest, matchContext);
    assert.equal(result[0].asset.id, "asset-exact-intent");
    assert.equal(result[0].breakdown.intentAffinity, "exact");
    assert.equal(result[1].asset.id, "asset-intent-universal-style-primary");
    assert.equal(result[1].breakdown.intentAffinity, "universal");
    console.log("PASS INT-05: hierarquia intent > style estritamente preservada");
  }

  console.log("\n==================================================");
  console.log("TODOS OS 33 TESTES DE PERSISTÊNCIA PASSARAM COM SUCESSO!");
  console.log("==================================================");
}

// Execução direta via CLI
if (process.argv[1]?.endsWith("ads-pro-03c-profile-persistence-tests.ts")) {
  runAllPersistenceTests().catch((err) => {
    console.error("FALHA NA EXECUÇÃO DOS TESTES:", err);
    process.exit(1);
  });
}
