/**
 * ADS-PRO-01E — Suíte de Testes Profunda da Fundação de Dados do Anúncios Pro
 *
 * Valida:
 * - VALID-01 (fixture completa com todos os campos canônicos)
 * - VALID-02 (fixture mínima com o menor asset válido aceitável)
 * - 40+ casos inválidos estritos (manifesto, schema, versão, IDs, arrays, zonas, coordenadas, overflow)
 * - Não-lançamento de exceções para qualquer entrada desconhecida (fail-safe com ok: false)
 * - Imutabilidade estrita do input (deep freeze e deep equal pós-execução)
 * - Determinismo absoluto sob múltiplas execuções
 */

import assert from "node:assert/strict";
import {
  ADS_PRO_SCHEMA_VERSION,
  type AssetLibraryManifest,
} from "../shared/ads-pro/asset-dna";
import { parseAssetLibrary } from "../shared/ads-pro/asset-parser";

/** Fixture completa com todos os campos preenchidos de forma canônica. */
const VALID_01_MANIFEST: AssetLibraryManifest = {
  schemaVersion: ADS_PRO_SCHEMA_VERSION,
  libraryVersion: "1.0.0",
  assets: [
    {
      id: "pro-luxury-pedestal",
      entityKinds: ["product", "service"],
      targetCategories: ["beauty", "fashion"],
      styles: ["luxury", "editorial"],
      supportedIntents: ["spotlight", "bestseller", "delivery"],
      formats: ["portrait", "square", "story"],
      subjectZone: { x: 0.1, y: 0.15, width: 0.8, height: 0.5 },
      textZone: { x: 0.1, y: 0.7, width: 0.8, height: 0.2 },
      luminance: "dark",
      status: "active",
      resource: {
        type: "static",
        uri: "assets/ads-pro/pro-luxury-pedestal.webp",
      },
      tags: ["studio", "premium", "pedestal"],
    },
    {
      id: "pro-minimal-clean",
      entityKinds: ["service"],
      targetCategories: [], // Universal
      styles: ["minimal", "modern"],
      supportedIntents: [], // Universal
      formats: ["square", "portrait"],
      subjectZone: { x: 0.05, y: 0.05, width: 0.9, height: 0.6 },
      luminance: "light",
      status: "deprecated",
      resource: {
        type: "generated",
        uri: "generated:clean-canvas-v1",
      },
      tags: ["clean", "minimal"],
    },
  ],
};

/** Menor asset e manifesto legitimamente aceitos. */
const VALID_02_MANIFEST: AssetLibraryManifest = {
  schemaVersion: 1,
  libraryVersion: "0.0.1",
  assets: [
    {
      id: "min-asset",
      entityKinds: ["product"],
      targetCategories: [],
      styles: ["modern"],
      supportedIntents: [],
      formats: ["square"],
      subjectZone: { x: 0, y: 0, width: 1, height: 1 },
      status: "active",
      resource: {
        type: "generated",
        uri: "generated:default",
      },
    },
  ],
};

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

function expectError(
  input: unknown,
  expectedCode: string,
  expectedPath?: string,
  testLabel?: string
): void {
  const result = parseAssetLibrary(input);
  if (result.ok) {
    assert.fail(`[${testLabel ?? expectedCode}] esperava falha com erro, mas resultou em ok: true`);
  }
  const matchingError = result.errors.find(
    (e) => e.code === expectedCode && (!expectedPath || e.path === expectedPath)
  );
  assert.ok(
    matchingError,
    `[${testLabel ?? expectedCode}] erro com code="${expectedCode}" e path="${expectedPath ?? '*'}" não encontrado. Erros retornados: ${JSON.stringify(result.errors)}`
  );
}

function runTests(): void {
  console.log("=== INICIANDO SUÍTE ADS-PRO-01E ===");

  // 1. VALID-01: Fixture Completa
  {
    console.log("-> Testando VALID-01: Fixture completa válida");
    const result = parseAssetLibrary(VALID_01_MANIFEST);
    assert.equal(result.ok, true, "VALID-01 deve ser aceita pelo parser");
    if (result.ok) {
      assert.equal(result.value.schemaVersion, 1);
      assert.equal(result.value.libraryVersion, "1.0.0");
      assert.equal(result.value.assets.length, 2);
      assert.equal(result.value.assets[0].id, "pro-luxury-pedestal");
      assert.deepEqual(result.value.assets[0].entityKinds, ["product", "service"]);
      assert.deepEqual(result.value.assets[0].targetCategories, ["beauty", "fashion"]);
      assert.deepEqual(result.value.assets[0].styles, ["luxury", "editorial"]);
      assert.deepEqual(result.value.assets[0].supportedIntents, ["spotlight", "bestseller", "delivery"]);
      assert.deepEqual(result.value.assets[0].formats, ["portrait", "square", "story"]);
      assert.equal(result.value.assets[0].luminance, "dark");
      assert.equal(result.value.assets[0].status, "active");
      assert.deepEqual(result.value.assets[0].tags, ["studio", "premium", "pedestal"]);
    }
  }

  // 2. VALID-02: Fixture Mínima
  {
    console.log("-> Testando VALID-02: Fixture mínima válida");
    const result = parseAssetLibrary(VALID_02_MANIFEST);
    assert.equal(result.ok, true, "VALID-02 deve ser aceita pelo parser");
    if (result.ok) {
      assert.equal(result.value.assets.length, 1);
      const asset = result.value.assets[0];
      assert.equal(asset.id, "min-asset");
      assert.deepEqual(asset.targetCategories, [], "targetCategories vazio representa asset universal");
      assert.deepEqual(asset.supportedIntents, [], "supportedIntents vazio representa asset universal");
      assert.equal(asset.textZone, undefined, "textZone é opcional");
      assert.equal(asset.luminance, undefined, "luminance é opcional");
      assert.equal(asset.tags, undefined, "tags é opcional");
    }
  }

  // Helper para gerar clone de asset base para testes inválidos
  const baseAsset = () => structuredClone(VALID_02_MANIFEST.assets[0]);
  const baseManifest = (assetMutator?: (a: Record<string, unknown>) => void) => {
    const asset = baseAsset();
    if (assetMutator) assetMutator(asset as unknown as Record<string, unknown>);
    return {
      schemaVersion: 1,
      libraryVersion: "1.0.0",
      assets: [asset],
    };
  };

  // 3. Manifest inválido
  console.log("-> Testando erros estruturais de manifesto");
  expectError(null, "NOT_AN_OBJECT", "$", "manifest null");
  expectError([], "NOT_AN_OBJECT", "$", "manifest array");
  expectError("manifest-string", "NOT_AN_OBJECT", "$", "manifest primitive string");
  expectError(42, "NOT_AN_OBJECT", "$", "manifest primitive number");
  expectError(true, "NOT_AN_OBJECT", "$", "manifest primitive boolean");
  expectError({ ...VALID_02_MANIFEST, unknownTopLevel: "extra" }, "UNKNOWN_KEY", "$.unknownTopLevel", "manifest unknown key");
  expectError({ ...VALID_02_MANIFEST, schemaVersion: 2 }, "SCHEMA_INCOMPATIBLE", "$.schemaVersion", "schema incompatível");
  expectError({ ...VALID_02_MANIFEST, schemaVersion: "1" }, "SCHEMA_INCOMPATIBLE", "$.schemaVersion", "schema version string");
  expectError({ ...VALID_02_MANIFEST, libraryVersion: "1.0" }, "INVALID_LIBRARY_VERSION", "$.libraryVersion", "semver incompleto");
  expectError({ ...VALID_02_MANIFEST, libraryVersion: "v1.0.0" }, "INVALID_LIBRARY_VERSION", "$.libraryVersion", "semver com prefixo v");
  expectError({ ...VALID_02_MANIFEST, libraryVersion: 123 }, "INVALID_LIBRARY_VERSION", "$.libraryVersion", "libraryVersion numérica");
  expectError({ ...VALID_02_MANIFEST, libraryVersion: "" }, "INVALID_LIBRARY_VERSION", "$.libraryVersion", "libraryVersion vazia");
  expectError({ ...VALID_02_MANIFEST, assets: null }, "ASSETS_NOT_ARRAY", "$.assets", "assets null");
  expectError({ ...VALID_02_MANIFEST, assets: {} }, "ASSETS_NOT_ARRAY", "$.assets", "assets objeto");

  // 4. Asset não objeto e Unknown Keys
  console.log("-> Testando asset não objeto e chaves desconhecidas");
  expectError({ schemaVersion: 1, libraryVersion: "1.0.0", assets: [null] }, "NOT_AN_OBJECT", "$.assets[0]", "asset null");
  expectError({ schemaVersion: 1, libraryVersion: "1.0.0", assets: ["not-an-object"] }, "NOT_AN_OBJECT", "$.assets[0]", "asset string");
  expectError(baseManifest((a) => { a.subjetZone = { x: 0, y: 0, width: 1, height: 1 }; delete a.subjectZone; }), "UNKNOWN_KEY", "$.assets[0].subjetZone", "typo subjetZone");
  expectError(baseManifest((a) => { a.extraProperty = 123; }), "UNKNOWN_KEY", "$.assets[0].extraProperty", "asset extra property");

  // 5. Identificadores (ID)
  console.log("-> Testando regras estritas de ID");
  expectError(baseManifest((a) => { a.id = ""; }), "EMPTY_ID", "$.assets[0].id", "id vazio");
  expectError(baseManifest((a) => { a.id = 123; }), "INVALID_ID", "$.assets[0].id", "id não-string");
  expectError(baseManifest((a) => { a.id = "ID-MAIUSCULO"; }), "NON_CANONICAL_ID", "$.assets[0].id", "id maiúsculo");
  expectError(baseManifest((a) => { a.id = " id-com-espaco"; }), "NON_CANONICAL_ID", "$.assets[0].id", "id com espaço inicial");
  expectError(baseManifest((a) => { a.id = "id com espaco"; }), "NON_CANONICAL_ID", "$.assets[0].id", "id com espaço interno");
  expectError(baseManifest((a) => { a.id = "id@invalido"; }), "NON_CANONICAL_ID", "$.assets[0].id", "id com caractere especial");
  expectError({
    schemaVersion: 1,
    libraryVersion: "1.0.0",
    assets: [
      { ...baseAsset(), id: "dupe-id" },
      { ...baseAsset(), id: "dupe-id" },
    ],
  }, "DUPLICATE_ID", "$.assets[1].id", "id duplicado");

  // 6. Entity Kinds
  console.log("-> Testando entityKinds");
  expectError(baseManifest((a) => { a.entityKinds = []; }), "EMPTY_ENTITY_KINDS", "$.assets[0].entityKinds", "entityKinds vazio");
  expectError(baseManifest((a) => { a.entityKinds = "product"; }), "INVALID_ENTITY_KINDS", "$.assets[0].entityKinds", "entityKinds string");
  expectError(baseManifest((a) => { a.entityKinds = ["both"]; }), "INVALID_ENTITY_KIND", "$.assets[0].entityKinds[0]", "entityKind pseudoestado both");
  expectError(baseManifest((a) => { a.entityKinds = ["invalidKind"]; }), "INVALID_ENTITY_KIND", "$.assets[0].entityKinds[0]", "entityKind inválido");
  expectError(baseManifest((a) => { a.entityKinds = ["product", "product"]; }), "DUPLICATE_ENTITY_KIND", "$.assets[0].entityKinds[1]", "entityKind duplicado");

  // 7. Categories
  console.log("-> Testando targetCategories");
  expectError(baseManifest((a) => { a.targetCategories = "beauty"; }), "INVALID_CATEGORIES", "$.assets[0].targetCategories", "categories string");
  expectError(baseManifest((a) => { a.targetCategories = ["cosmetics"]; }), "INVALID_CATEGORY", "$.assets[0].targetCategories[0]", "categoria arbitrária cosmetics");
  expectError(baseManifest((a) => { a.targetCategories = ["universal"]; }), "INVALID_CATEGORY", "$.assets[0].targetCategories[0]", "categoria fake universal");
  expectError(baseManifest((a) => { a.targetCategories = ["beauty", "beauty"]; }), "DUPLICATE_CATEGORY", "$.assets[0].targetCategories[1]", "categoria duplicada");

  // 8. Styles
  console.log("-> Testando styles");
  expectError(baseManifest((a) => { a.styles = []; }), "EMPTY_STYLES", "$.assets[0].styles", "styles vazio");
  expectError(baseManifest((a) => { a.styles = "luxury"; }), "INVALID_STYLES", "$.assets[0].styles", "styles string");
  expectError(baseManifest((a) => { a.styles = ["cyberpunk"]; }), "INVALID_STYLE", "$.assets[0].styles[0]", "style desconhecido cyberpunk");
  expectError(baseManifest((a) => { a.styles = ["fresh-premium"]; }), "INVALID_STYLE", "$.assets[0].styles[0]", "CreativeFamily fresh-premium rejeitado como style");
  expectError(baseManifest((a) => { a.styles = ["fresh-sport"]; }), "INVALID_STYLE", "$.assets[0].styles[0]", "CreativeFamily fresh-sport rejeitado como style");
  expectError(baseManifest((a) => { a.styles = ["fresh-commercial"]; }), "INVALID_STYLE", "$.assets[0].styles[0]", "CreativeFamily fresh-commercial rejeitado como style");
  expectError(baseManifest((a) => { a.styles = ["LUXURY"]; }), "INVALID_STYLE", "$.assets[0].styles[0]", "style não canônico maiúsculo");
  expectError(baseManifest((a) => { a.styles = [" luxury "]; }), "INVALID_STYLE", "$.assets[0].styles[0]", "style com espaços");
  expectError(baseManifest((a) => { a.styles = ["luxury", "luxury"]; }), "DUPLICATE_STYLE", "$.assets[0].styles[1]", "style duplicado");

  // Prova positiva de styles canônicos aceitos
  {
    const parseLuxury = parseAssetLibrary(baseManifest((a) => { a.styles = ["luxury", "minimal"]; }));
    assert.equal(parseLuxury.ok, true, "styles luxury e minimal devem ser aceitos");
  }

  // 9. Intents
  console.log("-> Testando supportedIntents");
  expectError(baseManifest((a) => { a.supportedIntents = "promo"; }), "INVALID_INTENTS", "$.assets[0].supportedIntents", "intents string");
  expectError(baseManifest((a) => { a.supportedIntents = ["awareness"]; }), "INVALID_INTENT", "$.assets[0].supportedIntents[0]", "intent desconhecido/inventado awareness");
  expectError(baseManifest((a) => { a.supportedIntents = ["growth_hacking"]; }), "INVALID_INTENT", "$.assets[0].supportedIntents[0]", "intent desconhecido/inventado growth_hacking");
  expectError(baseManifest((a) => { a.supportedIntents = ["spotlight", "spotlight"]; }), "DUPLICATE_INTENT", "$.assets[0].supportedIntents[1]", "intent duplicado spotlight");
  expectError(baseManifest((a) => { a.supportedIntents = ["bestseller", "bestseller"]; }), "DUPLICATE_INTENT", "$.assets[0].supportedIntents[1]", "intent duplicado bestseller");

  // Prova positiva de múltiplos intents canônicos do MarketingCampaignIntentId além dos 4 antigos
  {
    const parseCanonicalIntents = parseAssetLibrary(baseManifest((a) => {
      a.supportedIntents = ["spotlight", "bestseller", "delivery", "whatsapp", "preorder", "kit", "catalog", "premium_spotlight", "elegant_offer", "promo_impact"];
    }));
    assert.equal(parseCanonicalIntents.ok, true, "MarketingCampaignIntentId canônicos adicionais devem ser aceitos");
  }

  // 10. Formats
  console.log("-> Testando formats");
  expectError(baseManifest((a) => { a.formats = []; }), "EMPTY_FORMATS", "$.assets[0].formats", "formats vazio");
  expectError(baseManifest((a) => { a.formats = "square"; }), "INVALID_FORMATS", "$.assets[0].formats", "formats string");
  expectError(baseManifest((a) => { a.formats = ["feed_square"]; }), "INVALID_FORMAT", "$.assets[0].formats[0]", "formato não canônico feed_square");
  expectError(baseManifest((a) => { a.formats = ["billboard"]; }), "INVALID_FORMAT", "$.assets[0].formats[0]", "formato billboard");
  expectError(baseManifest((a) => { a.formats = ["square", "square"]; }), "DUPLICATE_FORMAT", "$.assets[0].formats[1]", "formato duplicado");

  // 11. Status
  console.log("-> Testando status");
  expectError(baseManifest((a) => { a.status = "archived"; }), "INVALID_STATUS", "$.assets[0].status", "status archived");
  expectError(baseManifest((a) => { a.status = "ACTIVE"; }), "INVALID_STATUS", "$.assets[0].status", "status maiúsculo");
  expectError(baseManifest((a) => { a.status = "draft"; }), "INVALID_STATUS", "$.assets[0].status", "status draft");

  // 12. Resource
  console.log("-> Testando resource");
  expectError(baseManifest((a) => { delete a.resource; }), "MISSING_RESOURCE", "$.assets[0].resource", "resource ausente");
  expectError(baseManifest((a) => { a.resource = "uri-only"; }), "INVALID_RESOURCE", "$.assets[0].resource", "resource string");
  expectError(baseManifest((a) => { a.resource = { type: "unknown", uri: "uri" }; }), "INVALID_RESOURCE_TYPE", "$.assets[0].resource.type", "resource type desconhecido");
  expectError(baseManifest((a) => { a.resource = { type: "static", uri: "" }; }), "INVALID_RESOURCE_URI", "$.assets[0].resource.uri", "resource uri vazia");
  expectError(baseManifest((a) => { a.resource = { type: "static", uri: "  uri-com-espacos  " }; }), "INVALID_RESOURCE_URI", "$.assets[0].resource.uri", "resource uri não canônica");
  expectError(baseManifest((a) => { a.resource = { type: "static", uri: "path", checksum: "123" }; }), "UNKNOWN_KEY", "$.assets[0].resource.checksum", "resource unknown key");

  // 13. Tags
  console.log("-> Testando tags");
  expectError(baseManifest((a) => { a.tags = "tag"; }), "INVALID_TAGS", "$.assets[0].tags", "tags string");
  expectError(baseManifest((a) => { a.tags = [123]; }), "INVALID_TAGS", "$.assets[0].tags[0]", "tag número");
  expectError(baseManifest((a) => { a.tags = [""]; }), "EMPTY_TAG", "$.assets[0].tags[0]", "tag vazia");
  expectError(baseManifest((a) => { a.tags = ["TagMaiuscula"]; }), "NON_CANONICAL_TAG", "$.assets[0].tags[0]", "tag com maiúscula");
  expectError(baseManifest((a) => { a.tags = [" tag "]; }), "NON_CANONICAL_TAG", "$.assets[0].tags[0]", "tag com espaço");
  expectError(baseManifest((a) => { a.tags = ["tag1", "tag1"]; }), "DUPLICATE_TAG", "$.assets[0].tags[1]", "tag duplicada");

  // 14. Luminance
  console.log("-> Testando luminance");
  expectError(baseManifest((a) => { a.luminance = "neon"; }), "INVALID_LUMINANCE", "$.assets[0].luminance", "luminance neon");
  expectError(baseManifest((a) => { a.luminance = "DARK"; }), "INVALID_LUMINANCE", "$.assets[0].luminance", "luminance maiúscula");

  // 15. Safe Zones e Geometria Estrita (subjectZone e textZone)
  console.log("-> Testando safe zones e geometria normalizada");
  expectError(baseManifest((a) => { delete a.subjectZone; }), "MISSING_SUBJECT_ZONE", "$.assets[0].subjectZone", "subjectZone ausente");
  expectError(baseManifest((a) => { a.subjectZone = "rect"; }), "INVALID_ZONE", "$.assets[0].subjectZone", "subjectZone string");
  expectError(baseManifest((a) => { a.subjectZone = { x: 0, y: 0, width: 1, height: 1, z: 0 }; }), "UNKNOWN_KEY", "$.assets[0].subjectZone.z", "subjectZone unknown key");
  expectError(baseManifest((a) => { a.subjectZone = { x: 0, y: 0, width: 0, height: 1 }; }), "ZERO_OR_NEGATIVE_WIDTH", "$.assets[0].subjectZone.width", "width 0");
  expectError(baseManifest((a) => { a.subjectZone = { x: 0, y: 0, width: -0.1, height: 1 }; }), "ZERO_OR_NEGATIVE_WIDTH", "$.assets[0].subjectZone.width", "width negativa");
  expectError(baseManifest((a) => { a.subjectZone = { x: 0, y: 0, width: 1, height: 0 }; }), "ZERO_OR_NEGATIVE_HEIGHT", "$.assets[0].subjectZone.height", "height 0");
  expectError(baseManifest((a) => { a.subjectZone = { x: 0, y: 0, width: 1, height: -0.5 }; }), "ZERO_OR_NEGATIVE_HEIGHT", "$.assets[0].subjectZone.height", "height negativa");
  expectError(baseManifest((a) => { a.subjectZone = { x: -0.01, y: 0, width: 0.5, height: 0.5 }; }), "NEGATIVE_X", "$.assets[0].subjectZone.x", "x negativo");
  expectError(baseManifest((a) => { a.subjectZone = { x: 0, y: -0.05, width: 0.5, height: 0.5 }; }), "NEGATIVE_Y", "$.assets[0].subjectZone.y", "y negativo");
  expectError(baseManifest((a) => { a.subjectZone = { x: Number.NaN, y: 0, width: 0.5, height: 0.5 }; }), "NON_FINITE_COORDINATE", "$.assets[0].subjectZone.x", "x NaN");
  expectError(baseManifest((a) => { a.subjectZone = { x: 0, y: Number.POSITIVE_INFINITY, width: 0.5, height: 0.5 }; }), "NON_FINITE_COORDINATE", "$.assets[0].subjectZone.y", "y Infinity");
  expectError(baseManifest((a) => { a.subjectZone = { x: 0, y: 0, width: Number.NEGATIVE_INFINITY, height: 0.5 }; }), "NON_FINITE_COORDINATE", "$.assets[0].subjectZone.width", "width -Infinity");
  expectError(baseManifest((a) => { a.subjectZone = { x: 0.6, y: 0, width: 0.45, height: 0.5 }; }), "OVERFLOW_X", "$.assets[0].subjectZone", "overflow X");
  expectError(baseManifest((a) => { a.subjectZone = { x: 0, y: 0.7, width: 0.5, height: 0.35 }; }), "OVERFLOW_Y", "$.assets[0].subjectZone", "overflow Y");

  // textZone com erro
  expectError(baseManifest((a) => { a.textZone = { x: 0, y: 0, width: 0, height: 0.2 }; }), "ZERO_OR_NEGATIVE_WIDTH", "$.assets[0].textZone.width", "textZone width 0");
  expectError(baseManifest((a) => { a.textZone = { x: 0.5, y: 0.5, width: 0.6, height: 0.2 }; }), "OVERFLOW_X", "$.assets[0].textZone", "textZone overflow X");

  // 16. Teste de não lançamento (fail-safe com ok: false para qualquer tipo de entrada inesperada)
  console.log("-> Testando robustez contra crashes (fail-safe)");
  const strangeInputs = [
    undefined,
    null,
    12345,
    "string aleatória",
    true,
    false,
    Symbol("sym"),
    () => {},
    BigInt(100),
    [],
    [1, 2, 3],
    {},
    { a: 1, b: null, c: [undefined] },
    { schemaVersion: 1, libraryVersion: "1.0.0", assets: [{}] },
  ];

  for (const strange of strangeInputs) {
    let result: ReturnType<typeof parseAssetLibrary> | undefined;
    assert.doesNotThrow(() => {
      result = parseAssetLibrary(strange);
    }, `Parser não pode lançar exceção para input: ${String(strange)}`);
    assert.equal(result?.ok, false, "Input inesperado deve resultar em ok: false");
    assert.ok(result && !result.ok && result.errors.length > 0, "Input inesperado deve retornar array de erros estruturados");
  }

  // 17. Teste de Imutabilidade do Input
  console.log("-> Testando imutabilidade estrita do input");
  {
    const cloneForMutationTest = structuredClone(VALID_01_MANIFEST);
    deepFreeze(cloneForMutationTest);

    let parseResult: ReturnType<typeof parseAssetLibrary> | undefined;
    assert.doesNotThrow(() => {
      parseResult = parseAssetLibrary(cloneForMutationTest);
    }, "Parser não pode quebrar ao processar objeto congelado (deep-freeze)");
    assert.equal(parseResult?.ok, true);

    const nonFrozenClone = structuredClone(VALID_01_MANIFEST);
    const snapshotBefore = JSON.stringify(nonFrozenClone);
    parseAssetLibrary(nonFrozenClone);
    const snapshotAfter = JSON.stringify(nonFrozenClone);
    assert.equal(snapshotBefore, snapshotAfter, "Parser não pode mutar propriedades do input");
  }

  // 18. Teste de Determinismo
  console.log("-> Testando determinismo sob múltiplas invocações");
  {
    const firstRun = parseAssetLibrary(VALID_01_MANIFEST);
    for (let i = 0; i < 20; i += 1) {
      const subsequentRun = parseAssetLibrary(VALID_01_MANIFEST);
      assert.deepEqual(firstRun, subsequentRun, `Execução ${i + 1} divergiu da primeira`);
    }

    const invalidInput = { schemaVersion: 99, libraryVersion: "err", assets: [] };
    const firstInvalidRun = parseAssetLibrary(invalidInput);
    for (let i = 0; i < 20; i += 1) {
      const subsequentInvalidRun = parseAssetLibrary(invalidInput);
      assert.deepEqual(firstInvalidRun, subsequentInvalidRun, `Execução inválida ${i + 1} divergiu`);
    }
  }

  console.log("=== TODOS OS TESTES PASSARAM COM SUCESSO! ===");
}

runTests();
