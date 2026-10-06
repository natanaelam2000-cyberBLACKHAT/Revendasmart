/**
 * ADS-PRO-03E2 — Testes Exaustivos de Produção do Manifesto e Background Bridge
 *
 * Cobertura Completa:
 * - Validação canônica do parser formal (boundary estrito).
 * - Sincronia 1:1 com a source of truth (MARKETING_PRO_BACKGROUND_LIBRARY).
 * - Derivação dinâmica de formatos, categorias, estilos e recursos.
 * - Geometria de safe subject zone e inclusão espacial em portrait e square.
 * - Determinismo absoluto e imutabilidade de manifesto.
 * - Integração com o Matcher (42 cenários portrait, 42 square, sensory gap, matriz de intents).
 * - Resolução e renderização da bridge em portrait e square.
 * - Rejeição explícita de assets desconhecidos e formatos não suportados (zero fallback silencioso).
 * - Isolamento do pro-generic-fallback fora do manifesto.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  ADS_PRO_PRODUCTION_MANIFEST,
  ADS_PRO_SAFE_SUBJECT_ZONE,
  buildAdsProProductionManifest,
} from "../shared/ads-pro/production-manifest";
import {
  BackgroundNotFoundError,
  UnsupportedAssetFormatError,
  renderAssetBackgroundSource,
  renderMatchResultBackgroundSource,
  resolveBackgroundForAsset,
} from "../shared/ads-pro/background-bridge";
import { parseAssetLibrary } from "../shared/ads-pro/asset-parser";
import type { AssetDNA, AssetFormat } from "../shared/ads-pro/asset-dna";
import { rankAdsProAssets } from "../shared/ads-pro/asset-matcher";
import { resolveMarketingProStyleForCreativeFamily } from "../shared/marketing-pro-art-direction";
import { MARKETING_PRO_BACKGROUND_LIBRARY } from "../shared/marketing-pro-background-library";
import { MARKETING_PRO_PRODUCT_ZONE } from "../shared/marketing-pro-contract";
import { MARKETING_CAMPAIGN_INTENT_IDS } from "../shared/marketing-pro-creative-intelligence";

/** ADS-PRO-FINAL: a biblioteca = 12 fundos gerados em código + fundos estáticos aprovados na auditoria. */
const LIBRARY_SIZE = MARKETING_PRO_BACKGROUND_LIBRARY.length;
const GENERATED_ASSETS = ADS_PRO_PRODUCTION_MANIFEST.assets.filter((asset) => asset.resource.type === "generated");
const STATIC_ASSETS = ADS_PRO_PRODUCTION_MANIFEST.assets.filter((asset) => asset.resource.type === "static");

let passedTests = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    throw err;
  }
}

console.log("\n=== ADS-PRO-03E2: MANIFEST & BRIDGE TEST SUITE ===\n");

// ---------------------------------------------------------------------------
// 1. Validação Estrutural e Parser Boundary
// ---------------------------------------------------------------------------
test("Manifesto passa com sucesso pela validação formal de parseAssetLibrary", () => {
  const result = parseAssetLibrary(ADS_PRO_PRODUCTION_MANIFEST);
  assert.equal(result.ok, true, "Manifesto de produção deve ser aprovado pelo parser formal");
  if (result.ok) {
    assert.equal(result.value.schemaVersion, 1);
    assert.match(result.value.libraryVersion, /^\d+\.\d+\.\d+$/);
    assert.equal(result.value.assets.length, LIBRARY_SIZE);
  }
});

test("Manifesto possui schemaVersion 1 e libraryVersion SemVer canônica (1.0.0 sem estáticos aprovados)", () => {
  assert.equal(ADS_PRO_PRODUCTION_MANIFEST.schemaVersion, 1);
  if (STATIC_ASSETS.length === 0) assert.equal(ADS_PRO_PRODUCTION_MANIFEST.libraryVersion, "1.0.0");
  else assert.match(ADS_PRO_PRODUCTION_MANIFEST.libraryVersion, /^1\.\d+\.0$/);
});

test("Manifesto contém exatamente os assets da biblioteca (12 gerados + estáticos aprovados) com IDs únicos em formato canônico", () => {
  assert.equal(GENERATED_ASSETS.length, 12, "os 12 fundos gerados em código continuam sendo o seed da biblioteca");
  assert.equal(ADS_PRO_PRODUCTION_MANIFEST.assets.length, LIBRARY_SIZE);
  const seenIds = new Set<string>();
  const canonicalIdRegex = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

  for (const asset of ADS_PRO_PRODUCTION_MANIFEST.assets) {
    assert.ok(canonicalIdRegex.test(asset.id), `ID "${asset.id}" deve ser canônico`);
    assert.ok(!seenIds.has(asset.id), `ID "${asset.id}" não pode ser duplicado`);
    seenIds.add(asset.id);
  }
});

test("Todos os assets possuem status active e entityKinds estritamente ['product']", () => {
  for (const asset of ADS_PRO_PRODUCTION_MANIFEST.assets) {
    assert.equal(asset.status, "active");
    assert.deepEqual(asset.entityKinds, ["product"]);
  }
});

// ---------------------------------------------------------------------------
// 2. Source of Truth e Correspondência 1:1
// ---------------------------------------------------------------------------
test("Manifesto possui correspondência exata 1:1 com MARKETING_PRO_BACKGROUND_LIBRARY", () => {
  assert.equal(
    ADS_PRO_PRODUCTION_MANIFEST.assets.length,
    MARKETING_PRO_BACKGROUND_LIBRARY.length,
    "Quantidade de assets deve ser idêntica à biblioteca canônica"
  );

  const libraryIds = new Set(MARKETING_PRO_BACKGROUND_LIBRARY.map((bg) => bg.id));
  const manifestIds = new Set(ADS_PRO_PRODUCTION_MANIFEST.assets.map((a) => a.id));

  assert.deepEqual(manifestIds, libraryIds, "IDs do manifesto devem bater 1:1 com os da library");
});

test("Formatos de cada asset são derivados diretamente de bg.formats", () => {
  for (const bg of MARKETING_PRO_BACKGROUND_LIBRARY) {
    const asset = ADS_PRO_PRODUCTION_MANIFEST.assets.find((a) => a.id === bg.id);
    assert.ok(asset, `Asset com id "${bg.id}" deve existir`);
    assert.deepEqual(
      asset.formats,
      bg.formats,
      `Formatos do asset "${asset.id}" devem ser idênticos aos do background`
    );
  }
});

test("Categorias de cada asset são idênticas a bg.categories", () => {
  for (const bg of MARKETING_PRO_BACKGROUND_LIBRARY) {
    const asset = ADS_PRO_PRODUCTION_MANIFEST.assets.find((a) => a.id === bg.id);
    assert.ok(asset);
    assert.deepEqual(
      asset.targetCategories,
      bg.categories,
      `targetCategories do asset "${asset.id}" devem bater com bg.categories`
    );
  }
});

test("Estilos são mapeados exclusivamente por resolveMarketingProStyleForCreativeFamily sem fresh-* nem sensory", () => {
  for (const bg of MARKETING_PRO_BACKGROUND_LIBRARY) {
    const asset = ADS_PRO_PRODUCTION_MANIFEST.assets.find((a) => a.id === bg.id);
    assert.ok(asset);
    const expectedStyle = resolveMarketingProStyleForCreativeFamily(bg.family);
    assert.deepEqual(asset.styles, [expectedStyle]);
    assert.ok(!asset.styles.some((s) => s.startsWith("fresh-")), "Nenhum fresh-* deve existir em AssetDNA");
    // Seed gerado em código nunca é sensorial (gap documentado). Só um fundo ESTÁTICO classificado como
    // sensorial pela auditoria da biblioteca pode ter o estilo sensory — e sempre via bg.family, nunca forçado.
    if (bg.sourceType === "GENERATED_DETERMINISTIC") {
      assert.ok(!asset.styles.includes("sensory"), "Nenhum asset de seed deve receber sensory artificialmente");
    }
  }
});

test("Todos os assets declaram supportedIntents como array vazio (universalidade)", () => {
  for (const asset of ADS_PRO_PRODUCTION_MANIFEST.assets) {
    assert.deepEqual(asset.supportedIntents, [], `supportedIntents de "${asset.id}" deve ser []`);
  }
});

test("Tags são propagadas estritamente se presentes no background", () => {
  for (const bg of MARKETING_PRO_BACKGROUND_LIBRARY) {
    const asset = ADS_PRO_PRODUCTION_MANIFEST.assets.find((a) => a.id === bg.id);
    assert.ok(asset);
    if (bg.tags && bg.tags.length > 0) {
      assert.deepEqual(asset.tags, bg.tags);
    } else {
      assert.equal(asset.tags, undefined);
    }
  }
});

// ---------------------------------------------------------------------------
// 3. Geometria de Safe Subject Zone
// ---------------------------------------------------------------------------
test("Todos os assets utilizam exatamente a ADS_PRO_SAFE_SUBJECT_ZONE", () => {
  const expectedZone = { x: 0.10, y: 0.17, width: 0.80, height: 0.42 };
  assert.deepEqual(ADS_PRO_SAFE_SUBJECT_ZONE, expectedZone);

  for (const asset of ADS_PRO_PRODUCTION_MANIFEST.assets) {
    assert.deepEqual(
      asset.subjectZone,
      expectedZone,
      `subjectZone de "${asset.id}" deve ser a safe zone comum`
    );
  }
});

test("Safe Subject Zone está geometricamente contida em MARKETING_PRO_PRODUCT_ZONE.portrait e square", () => {
  const safe = ADS_PRO_SAFE_SUBJECT_ZONE;
  const portrait = MARKETING_PRO_PRODUCT_ZONE.portrait;
  const square = MARKETING_PRO_PRODUCT_ZONE.square;

  // Inclusão em portrait
  assert.ok(safe.x >= portrait.x, "safe.x deve ser >= portrait.x");
  assert.ok(safe.y >= portrait.y, "safe.y deve ser >= portrait.y");
  assert.ok(safe.x + safe.width <= portrait.x + portrait.width + 1e-6, "safe right deve caber em portrait");
  assert.ok(safe.y + safe.height <= portrait.y + portrait.height + 1e-6, "safe bottom deve caber em portrait");

  // Inclusão / coincidência em square
  assert.ok(safe.x >= square.x - 1e-6 && safe.x <= square.x + 1e-6, "safe.x deve coincidir com square.x");
  assert.ok(safe.y >= square.y - 1e-6 && safe.y <= square.y + 1e-6, "safe.y deve coincidir com square.y");
  assert.ok(
    Math.abs(safe.width - square.width) < 1e-6,
    "safe.width deve coincidir com square.width"
  );
  assert.ok(
    Math.abs(safe.height - square.height) < 1e-6,
    "safe.height deve coincidir com square.height"
  );
});

// ---------------------------------------------------------------------------
// 4. Recursos e Consistência de URI
// ---------------------------------------------------------------------------
test("Assets gerados possuem resource 'generated' e URI 'generated:<id>'; estáticos apontam para o WebP aprovado", () => {
  for (const asset of STATIC_ASSETS) {
    assert.match(asset.resource.uri, /^\/ads-pro\/backgrounds\/[a-z0-9-]+\.webp$/, `estático "${asset.id}" precisa apontar para o WebP otimizado publicado`);
  }
  for (const asset of GENERATED_ASSETS) {
    assert.equal(asset.resource.type, "generated");
    assert.equal(
      asset.resource.uri,
      `generated:${asset.id}`,
      `URI de recurso de "${asset.id}" deve ser "generated:${asset.id}"`
    );
  }
});

// ---------------------------------------------------------------------------
// 5. Imutabilidade e Determinismo
// ---------------------------------------------------------------------------
test("buildAdsProProductionManifest é 100% determinístico e retorna objetos congelados", () => {
  const run1 = buildAdsProProductionManifest();
  const run2 = buildAdsProProductionManifest();

  assert.deepEqual(run1, run2, "Duas execuções de buildAdsProProductionManifest devem ser idênticas");

  const json1 = JSON.stringify(run1);
  const json2 = JSON.stringify(run2);
  assert.equal(json1, json2, "Serializações JSON devem ser estritamente iguais");

  const hash1 = crypto.createHash("sha256").update(json1).digest("hex");
  const hash2 = crypto.createHash("sha256").update(json2).digest("hex");
  assert.equal(hash1, hash2, "Hashes SHA-256 devem ser perfeitamente idênticos");

  // Imutabilidade
  assert.ok(Object.isFrozen(ADS_PRO_PRODUCTION_MANIFEST), "Manifesto deve estar congelado");
  assert.ok(Object.isFrozen(ADS_PRO_PRODUCTION_MANIFEST.assets), "Array de assets deve estar congelado");
  for (const asset of ADS_PRO_PRODUCTION_MANIFEST.assets) {
    assert.ok(Object.isFrozen(asset), `Asset "${asset.id}" deve estar congelado`);
  }
});

// ---------------------------------------------------------------------------
// 6. Integração Real com o Matcher (rankAdsProAssets)
// ---------------------------------------------------------------------------
const categories = [
  "beauty",
  "electronics",
  "fashion",
  "home",
  "food",
  "general",
  undefined,
] as const;

const stylesList = [
  ["luxury"],
  ["editorial"],
  ["modern"],
  ["minimal"],
  ["sensory"],
  [],
] as const;

test("Cobertura total de 42 cenários em formato portrait sem nenhum array vazio", () => {
  let count = 0;
  for (const cat of categories) {
    for (const st of stylesList) {
      count++;
      const results = rankAdsProAssets(ADS_PRO_PRODUCTION_MANIFEST, {
        entityKind: "product",
        format: "portrait",
        category: cat,
        preferredStyles: st,
      });
      assert.ok(
        results.length > 0,
        `Resultado não pode ser vazio para portrait, cat=${cat}, styles=${JSON.stringify(st)}`
      );
      assert.equal(results.length, LIBRARY_SIZE, "Todos os backgrounds da biblioteca devem ser elegíveis em portrait");
    }
  }
  assert.equal(count, 42);
});

test("Cobertura total de 42 cenários em formato square sem nenhum array vazio", () => {
  let count = 0;
  for (const cat of categories) {
    for (const st of stylesList) {
      count++;
      const results = rankAdsProAssets(ADS_PRO_PRODUCTION_MANIFEST, {
        entityKind: "product",
        format: "square",
        category: cat,
        preferredStyles: st,
      });
      assert.ok(
        results.length > 0,
        `Resultado não pode ser vazio para square, cat=${cat}, styles=${JSON.stringify(st)}`
      );
      assert.equal(results.length, LIBRARY_SIZE, "Todos os backgrounds da biblioteca devem ser elegíveis em square");
    }
  }
  assert.equal(count, 42);
});

test("Sensory gap: preferredStyles = ['sensory'] pontua como styleAffinity 'none' mantendo ranking completo", () => {
  const results = rankAdsProAssets(ADS_PRO_PRODUCTION_MANIFEST, {
    entityKind: "product",
    format: "portrait",
    category: "beauty",
    preferredStyles: ["sensory"],
  });

  assert.equal(results.length, LIBRARY_SIZE);
  for (const r of results) {
    if (r.asset.styles.includes("sensory")) {
      // Fundo estático aprovado na auditoria e classificado como sensorial: aí SIM há match primário.
      assert.equal(r.breakdown.styleAffinity, "primary", `"${r.asset.id}" é sensorial e deve ganhar match`);
      continue;
    }
    assert.equal(
      r.breakdown.styleAffinity,
      "none",
      `Nenhum asset de seed deve ganhar style match para sensory ("${r.asset.id}")`
    );
    assert.deepEqual(r.breakdown.matchedStyles, []);
  }

  // Desempate prioriza matches de categoria
  assert.equal(results[0].breakdown.categoryAffinity, "exact");
});

test("Matriz de intenções: todas as 15 intents canônicas pontuam como 'universal' sem hard-filtering", () => {
  assert.equal(MARKETING_CAMPAIGN_INTENT_IDS.length, 15);

  for (const intent of MARKETING_CAMPAIGN_INTENT_IDS) {
    const results = rankAdsProAssets(ADS_PRO_PRODUCTION_MANIFEST, {
      entityKind: "product",
      format: "portrait",
      intent,
    });
    assert.equal(results.length, LIBRARY_SIZE, `Nenhum asset deve ser filtrado por intent=${intent}`);
    for (const r of results) {
      assert.equal(
        r.breakdown.intentAffinity,
        "universal",
        `intentAffinity deve ser 'universal' para intent=${intent}`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 7. Background Bridge (Resolução e Renderização)
// ---------------------------------------------------------------------------
test("resolveBackgroundForAsset localiza o background correspondente para todos os assets da biblioteca", () => {
  for (const asset of ADS_PRO_PRODUCTION_MANIFEST.assets) {
    const bg = resolveBackgroundForAsset(asset);
    assert.equal(bg.id, asset.id);
  }
});

test("renderAssetBackgroundSource renderiza Data URI SVG válido para todos os assets gerados em portrait", () => {
  for (const asset of GENERATED_ASSETS) {
    const src = renderAssetBackgroundSource(asset, "portrait");
    assert.ok(typeof src === "string" && src.length > 0);
    assert.ok(src.startsWith("data:image/svg+xml;charset=utf-8,"));
  }
});

test("renderAssetBackgroundSource renderiza Data URI SVG válido para todos os assets gerados em square", () => {
  for (const asset of GENERATED_ASSETS) {
    const src = renderAssetBackgroundSource(asset, "square");
    assert.ok(typeof src === "string" && src.length > 0);
    assert.ok(src.startsWith("data:image/svg+xml;charset=utf-8,"));
  }
});

test("renderMatchResultBackgroundSource renderiza com sucesso a partir do resultado do Matcher", () => {
  const results = rankAdsProAssets(ADS_PRO_PRODUCTION_MANIFEST, {
    entityKind: "product",
    format: "square",
    category: "fashion",
    preferredStyles: ["luxury"],
  });

  const topResult = results[0];
  const src = renderMatchResultBackgroundSource(topResult, "square");
  assert.ok(typeof src === "string" && src.length > 0);
  // Gerado vira Data URI SVG; estático aprovado vira a URL do WebP otimizado publicado (nunca o acervo bruto).
  if (topResult.asset.resource.type === "generated") assert.ok(src.startsWith("data:image/svg+xml;charset=utf-8,"));
  else assert.match(src, /^\/ads-pro\/backgrounds\/[a-z0-9-]+\.webp$/);
});

test("resolveBackgroundForAsset e renderAssetBackgroundSource lançam BackgroundNotFoundError para ID desconhecido", () => {
  const fakeAsset: AssetDNA = {
    id: "unknown-nonexistent-background",
    entityKinds: ["product"],
    targetCategories: ["beauty"],
    styles: ["luxury"],
    supportedIntents: [],
    formats: ["portrait", "square"],
    subjectZone: ADS_PRO_SAFE_SUBJECT_ZONE,
    status: "active",
    resource: { type: "generated", uri: "generated:unknown-nonexistent-background" },
  };

  assert.throws(
    () => resolveBackgroundForAsset(fakeAsset),
    (err: unknown) => err instanceof BackgroundNotFoundError
  );

  assert.throws(
    () => renderAssetBackgroundSource(fakeAsset, "portrait"),
    (err: unknown) => err instanceof BackgroundNotFoundError
  );
});

test("renderAssetBackgroundSource lança UnsupportedAssetFormatError se formato não for suportado pelo asset", () => {
  const assetOnlyPortrait: AssetDNA = {
    id: "luxury-onyx-spotlight",
    entityKinds: ["product"],
    targetCategories: ["beauty"],
    styles: ["luxury"],
    supportedIntents: [],
    formats: ["portrait"],
    subjectZone: ADS_PRO_SAFE_SUBJECT_ZONE,
    status: "active",
    resource: { type: "generated", uri: "generated:luxury-onyx-spotlight" },
  };

  assert.throws(
    () => renderAssetBackgroundSource(assetOnlyPortrait, "story" as AssetFormat),
    (err: unknown) => err instanceof UnsupportedAssetFormatError
  );
});

// ---------------------------------------------------------------------------
// 8. Isolamento do Fallback
// ---------------------------------------------------------------------------
test("pro-generic-fallback não está presente em ADS_PRO_PRODUCTION_MANIFEST.assets", () => {
  const fallbackAsset = ADS_PRO_PRODUCTION_MANIFEST.assets.find(
    (a) => a.id === "pro-generic-fallback" || a.id.includes("fallback")
  );
  assert.equal(
    fallbackAsset,
    undefined,
    "Fallback procedural não pode estar presente no manifesto de produção"
  );
});

console.log(`\nAll ${passedTests} ADS-PRO-03E2 tests passed successfully!\n`);
