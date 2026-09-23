/**
 * ADS-PRO-01D — Parser Canônico e Validador do AssetDNA
 *
 * Responsabilidade:
 * Validar rigorosamente manifestos e assets do Anúncios Pro a partir de entrada `unknown`.
 *
 * Regras Centrais:
 * - O parser NÃO é sanitizer: não faz trim(), toLowerCase() ou substituições silenciosas.
 * - Rejeita unknown keys (schema v1 rígido) em todos os níveis estruturais.
 * - Rejeita coordenadas inválidas, não finitas (NaN/Infinity) e overflows geométricos.
 * - Garante ausência de efeitos colaterais (imutabilidade do input) e determinismo absoluto.
 */

import {
  ADS_PRO_SCHEMA_VERSION,
  ASSET_CATEGORIES,
  ASSET_ENTITY_KINDS,
  ASSET_FORMATS,
  ASSET_INTENTS,
  ASSET_LUMINANCES,
  ASSET_RESOURCE_TYPES,
  ASSET_STATUSES,
  ASSET_STYLES,
  GEOMETRY_EPSILON,
  type AssetCategory,
  type AssetDNA,
  type AssetDnaParseResult,
  type AssetEntityKind,
  type AssetFormat,
  type AssetId,
  type AssetIntent,
  type AssetLibraryParseResult,
  type AssetLuminance,
  type AssetResourceReference,
  type AssetResourceType,
  type AssetStatus,
  type AssetStyle,
  type AssetValidationError,
  type NormalizedRect,
} from "./asset-dna";

/** Regex canônico para AssetId: convenção canônica do Ads Pro para estabilidade e interoperabilidade (slug alfanumérico em minúsculas com hífen ou underscore). */
const CANONICAL_ASSET_ID_REGEX = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

/** Regex canônico para versão semântica de dataset de biblioteca (ex: "1.0.0"). */
const SEMVER_LIBRARY_VERSION_REGEX = /^\d+\.\d+\.\d+$/;

/** Chaves permitidas no nível do manifesto. */
const ALLOWED_MANIFEST_KEYS: readonly string[] = [
  "schemaVersion",
  "libraryVersion",
  "assets",
];

/** Chaves permitidas no nível do AssetDNA. */
const ALLOWED_ASSET_KEYS: readonly string[] = [
  "id",
  "entityKinds",
  "targetCategories",
  "styles",
  "supportedIntents",
  "formats",
  "subjectZone",
  "textZone",
  "luminance",
  "status",
  "resource",
  "tags",
];

/** Chaves permitidas em NormalizedRect. */
const ALLOWED_RECT_KEYS: readonly string[] = ["x", "y", "width", "height"];

/** Chaves permitidas em AssetResourceReference. */
const ALLOWED_RESOURCE_KEYS: readonly string[] = ["type", "uri"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkUnknownKeys(
  obj: Record<string, unknown>,
  allowedKeys: readonly string[],
  basePath: string,
  errors: AssetValidationError[]
): void {
  const allowedSet = new Set(allowedKeys);
  for (const key of Object.keys(obj)) {
    if (!allowedSet.has(key)) {
      errors.push({
        code: "UNKNOWN_KEY",
        path: `${basePath}.${key}`,
        message: `Chave não reconhecida "${key}" em ${basePath}`,
      });
    }
  }
}

function validateRect(
  input: unknown,
  basePath: string,
  errors: AssetValidationError[]
): NormalizedRect | null {
  if (!isPlainObject(input)) {
    errors.push({
      code: "INVALID_ZONE",
      path: basePath,
      message: `Zona em ${basePath} precisa ser um objeto válido`,
    });
    return null;
  }

  checkUnknownKeys(input, ALLOWED_RECT_KEYS, basePath, errors);

  const { x, y, width, height } = input;
  let hasCoordError = false;

  for (const [coordName, val] of [
    ["x", x],
    ["y", y],
    ["width", width],
    ["height", height],
  ] as const) {
    if (typeof val !== "number" || !Number.isFinite(val) || Number.isNaN(val)) {
      errors.push({
        code: "NON_FINITE_COORDINATE",
        path: `${basePath}.${coordName}`,
        message: `Coordenada ${coordName} em ${basePath} precisa ser número finito (NaN e Infinity proibidos)`,
      });
      hasCoordError = true;
    }
  }

  if (hasCoordError) {
    return null;
  }

  const numX = x as number;
  const numY = y as number;
  const numW = width as number;
  const numH = height as number;

  if (numX < 0) {
    errors.push({
      code: "NEGATIVE_X",
      path: `${basePath}.x`,
      message: `Coordenada x (${numX}) não pode ser negativa`,
    });
  }

  if (numY < 0) {
    errors.push({
      code: "NEGATIVE_Y",
      path: `${basePath}.y`,
      message: `Coordenada y (${numY}) não pode ser negativa`,
    });
  }

  if (numW <= 0) {
    errors.push({
      code: "ZERO_OR_NEGATIVE_WIDTH",
      path: `${basePath}.width`,
      message: `Largura (${numW}) precisa ser estritamente maior que zero`,
    });
  }

  if (numH <= 0) {
    errors.push({
      code: "ZERO_OR_NEGATIVE_HEIGHT",
      path: `${basePath}.height`,
      message: `Altura (${numH}) precisa ser estritamente maior que zero`,
    });
  }

  if (numX + numW > 1 + GEOMETRY_EPSILON) {
    errors.push({
      code: "OVERFLOW_X",
      path: basePath,
      message: `Extensão horizontal (x: ${numX} + width: ${numW} = ${numX + numW}) ultrapassa limite do canvas (1.0)`,
    });
  }

  if (numY + numH > 1 + GEOMETRY_EPSILON) {
    errors.push({
      code: "OVERFLOW_Y",
      path: basePath,
      message: `Extensão vertical (y: ${numY} + height: ${numH} = ${numY + numH}) ultrapassa limite do canvas (1.0)`,
    });
  }

  return { x: numX, y: numY, width: numW, height: numH };
}

function validateResource(
  input: unknown,
  basePath: string,
  errors: AssetValidationError[]
): AssetResourceReference | null {
  if (input === undefined) {
    errors.push({
      code: "MISSING_RESOURCE",
      path: basePath,
      message: `Referência de recurso obrigatória ausente em ${basePath}`,
    });
    return null;
  }

  if (!isPlainObject(input)) {
    errors.push({
      code: "INVALID_RESOURCE",
      path: basePath,
      message: `Recurso em ${basePath} precisa ser um objeto`,
    });
    return null;
  }

  checkUnknownKeys(input, ALLOWED_RESOURCE_KEYS, basePath, errors);

  const { type, uri } = input;
  let valid = true;

  if (typeof type !== "string" || !(ASSET_RESOURCE_TYPES as readonly string[]).includes(type)) {
    errors.push({
      code: "INVALID_RESOURCE_TYPE",
      path: `${basePath}.type`,
      message: `Tipo de recurso "${String(type)}" inválido em ${basePath}`,
    });
    valid = false;
  }

  if (typeof uri !== "string" || uri.length === 0 || uri.trim() !== uri) {
    errors.push({
      code: "INVALID_RESOURCE_URI",
      path: `${basePath}.uri`,
      message: `URI de recurso precisa ser string canônica não-vazia sem espaços nas extremidades`,
    });
    valid = false;
  }

  if (!valid) return null;
  return {
    type: type as AssetResourceType,
    uri: uri as string,
  };
}

function validateCanonicalId(
  input: unknown,
  basePath: string,
  seenIds: Set<string>,
  errors: AssetValidationError[]
): AssetId | null {
  if (typeof input !== "string") {
    errors.push({
      code: "INVALID_ID",
      path: basePath,
      message: `Identificador em ${basePath} precisa ser string`,
    });
    return null;
  }

  if (input.length === 0) {
    errors.push({
      code: "EMPTY_ID",
      path: basePath,
      message: `Identificador em ${basePath} não pode ser vazio`,
    });
    return null;
  }

  if (!CANONICAL_ASSET_ID_REGEX.test(input)) {
    errors.push({
      code: "NON_CANONICAL_ID",
      path: basePath,
      message: `Identificador "${input}" não é canônico (deve ser slug em minúsculas com hífen/underscore)`,
    });
    return null;
  }

  if (seenIds.has(input)) {
    errors.push({
      code: "DUPLICATE_ID",
      path: basePath,
      message: `Identificador duplicado "${input}" em ${basePath}`,
    });
    return null;
  }

  seenIds.add(input);
  return input;
}

function validateArrayValues<T extends string>(
  input: unknown,
  allowedValues: readonly T[],
  config: {
    basePath: string;
    itemCode: string;
    duplicateCode: string;
    invalidArrayCode: string;
    emptyCode?: string;
    allowEmpty: boolean;
  },
  errors: AssetValidationError[]
): readonly T[] | null {
  if (!Array.isArray(input)) {
    errors.push({
      code: config.invalidArrayCode,
      path: config.basePath,
      message: `Campo ${config.basePath} precisa ser um array`,
    });
    return null;
  }

  if (!config.allowEmpty && input.length === 0) {
    errors.push({
      code: config.emptyCode ?? config.invalidArrayCode,
      path: config.basePath,
      message: `Campo ${config.basePath} não pode ser vazio`,
    });
    return null;
  }

  const allowedSet = new Set<string>(allowedValues);
  const seen = new Set<string>();
  const result: T[] = [];

  for (let i = 0; i < input.length; i += 1) {
    const item = input[i];
    const itemPath = `${config.basePath}[${i}]`;

    if (typeof item !== "string" || !allowedSet.has(item)) {
      errors.push({
        code: config.itemCode,
        path: itemPath,
        message: `Valor "${String(item)}" inválido em ${itemPath}`,
      });
      continue;
    }

    if (seen.has(item)) {
      errors.push({
        code: config.duplicateCode,
        path: itemPath,
        message: `Valor duplicado "${item}" em ${itemPath}`,
      });
      continue;
    }

    seen.add(item);
    result.push(item as T);
  }

  return result;
}

function validateTags(
  input: unknown,
  basePath: string,
  errors: AssetValidationError[]
): readonly string[] | undefined {
  if (input === undefined) return undefined;

  if (!Array.isArray(input)) {
    errors.push({
      code: "INVALID_TAGS",
      path: basePath,
      message: `Tags em ${basePath} precisam ser array`,
    });
    return undefined;
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (let i = 0; i < input.length; i += 1) {
    const tag = input[i];
    const tagPath = `${basePath}[${i}]`;

    if (typeof tag !== "string") {
      errors.push({
        code: "INVALID_TAGS",
        path: tagPath,
        message: `Tag em ${tagPath} precisa ser string`,
      });
      continue;
    }

    if (tag.length === 0) {
      errors.push({
        code: "EMPTY_TAG",
        path: tagPath,
        message: `Tag em ${tagPath} não pode ser vazia`,
      });
      continue;
    }

    if (tag.trim() !== tag || tag.toLowerCase() !== tag) {
      errors.push({
        code: "NON_CANONICAL_TAG",
        path: tagPath,
        message: `Tag "${tag}" não é canônica (deve estar em minúsculas e sem espaços nas extremidades)`,
      });
      continue;
    }

    if (seen.has(tag)) {
      errors.push({
        code: "DUPLICATE_TAG",
        path: tagPath,
        message: `Tag duplicada "${tag}" em ${tagPath}`,
      });
      continue;
    }

    seen.add(tag);
    result.push(tag);
  }

  return result;
}

/**
 * Valida e converte um objeto cru em AssetDNA.
 */
export function parseAssetDna(
  input: unknown,
  basePath = "$.asset",
  seenIds: Set<string> = new Set()
): AssetDnaParseResult {
  const errors: AssetValidationError[] = [];

  if (!isPlainObject(input)) {
    errors.push({
      code: "NOT_AN_OBJECT",
      path: basePath,
      message: `Asset em ${basePath} precisa ser um objeto`,
    });
    return { ok: false, errors };
  }

  checkUnknownKeys(input, ALLOWED_ASSET_KEYS, basePath, errors);

  const id = validateCanonicalId(input.id, `${basePath}.id`, seenIds, errors);

  const entityKinds = validateArrayValues<AssetEntityKind>(
    input.entityKinds,
    ASSET_ENTITY_KINDS,
    {
      basePath: `${basePath}.entityKinds`,
      invalidArrayCode: "INVALID_ENTITY_KINDS",
      emptyCode: "EMPTY_ENTITY_KINDS",
      itemCode: "INVALID_ENTITY_KIND",
      duplicateCode: "DUPLICATE_ENTITY_KIND",
      allowEmpty: false,
    },
    errors
  );

  const targetCategories = validateArrayValues<AssetCategory>(
    input.targetCategories,
    ASSET_CATEGORIES,
    {
      basePath: `${basePath}.targetCategories`,
      invalidArrayCode: "INVALID_CATEGORIES",
      itemCode: "INVALID_CATEGORY",
      duplicateCode: "DUPLICATE_CATEGORY",
      allowEmpty: true,
    },
    errors
  );

  const styles = validateArrayValues<AssetStyle>(
    input.styles,
    ASSET_STYLES,
    {
      basePath: `${basePath}.styles`,
      invalidArrayCode: "INVALID_STYLES",
      emptyCode: "EMPTY_STYLES",
      itemCode: "INVALID_STYLE",
      duplicateCode: "DUPLICATE_STYLE",
      allowEmpty: false,
    },
    errors
  );

  const supportedIntents = validateArrayValues<AssetIntent>(
    input.supportedIntents,
    ASSET_INTENTS,
    {
      basePath: `${basePath}.supportedIntents`,
      invalidArrayCode: "INVALID_INTENTS",
      itemCode: "INVALID_INTENT",
      duplicateCode: "DUPLICATE_INTENT",
      allowEmpty: true,
    },
    errors
  );

  const formats = validateArrayValues<AssetFormat>(
    input.formats,
    ASSET_FORMATS,
    {
      basePath: `${basePath}.formats`,
      invalidArrayCode: "INVALID_FORMATS",
      emptyCode: "EMPTY_FORMATS",
      itemCode: "INVALID_FORMAT",
      duplicateCode: "DUPLICATE_FORMAT",
      allowEmpty: false,
    },
    errors
  );

  let subjectZone: NormalizedRect | null = null;
  if (!("subjectZone" in input) || input.subjectZone === undefined) {
    errors.push({
      code: "MISSING_SUBJECT_ZONE",
      path: `${basePath}.subjectZone`,
      message: `subjectZone obrigatória ausente em ${basePath}`,
    });
  } else {
    subjectZone = validateRect(input.subjectZone, `${basePath}.subjectZone`, errors);
  }

  let textZone: NormalizedRect | undefined;
  if ("textZone" in input && input.textZone !== undefined) {
    const parsedTextZone = validateRect(input.textZone, `${basePath}.textZone`, errors);
    if (parsedTextZone) textZone = parsedTextZone;
  }

  let luminance: AssetLuminance | undefined;
  if ("luminance" in input && input.luminance !== undefined) {
    if (
      typeof input.luminance !== "string" ||
      !(ASSET_LUMINANCES as readonly string[]).includes(input.luminance)
    ) {
      errors.push({
        code: "INVALID_LUMINANCE",
        path: `${basePath}.luminance`,
        message: `Luminância "${String(input.luminance)}" inválida em ${basePath}. Valores aceitos: dark, light`,
      });
    } else {
      luminance = input.luminance as AssetLuminance;
    }
  }

  let status: AssetStatus | null = null;
  if (
    typeof input.status !== "string" ||
    !(ASSET_STATUSES as readonly string[]).includes(input.status)
  ) {
    errors.push({
      code: "INVALID_STATUS",
      path: `${basePath}.status`,
      message: `Status "${String(input.status)}" inválido em ${basePath}. Valores aceitos: active, deprecated`,
    });
  } else {
    status = input.status as AssetStatus;
  }

  const resource = validateResource(input.resource, `${basePath}.resource`, errors);
  const tags = validateTags(input.tags, `${basePath}.tags`, errors);

  if (
    errors.length > 0 ||
    !id ||
    !entityKinds ||
    !targetCategories ||
    !styles ||
    !supportedIntents ||
    !formats ||
    !subjectZone ||
    !status ||
    !resource
  ) {
    return { ok: false, errors };
  }

  const value: AssetDNA = {
    id,
    entityKinds,
    targetCategories,
    styles,
    supportedIntents,
    formats,
    subjectZone,
    ...(textZone ? { textZone } : {}),
    ...(luminance ? { luminance } : {}),
    status,
    resource,
    ...(tags ? { tags } : {}),
  };

  return { ok: true, value };
}

/**
 * Ponto de entrada canônico para validação e tipagem de biblioteca de assets.
 */
export function parseAssetLibrary(input: unknown): AssetLibraryParseResult {
  const errors: AssetValidationError[] = [];

  if (!isPlainObject(input)) {
    return {
      ok: false,
      errors: [
        {
          code: "NOT_AN_OBJECT",
          path: "$",
          message: "Manifesto precisa ser um objeto não-nulo e não-array",
        },
      ],
    };
  }

  checkUnknownKeys(input, ALLOWED_MANIFEST_KEYS, "$", errors);

  if (input.schemaVersion !== ADS_PRO_SCHEMA_VERSION) {
    errors.push({
      code: "SCHEMA_INCOMPATIBLE",
      path: "$.schemaVersion",
      message: `Versão de schema "${String(input.schemaVersion)}" incompatível. Esperado: ${ADS_PRO_SCHEMA_VERSION}`,
    });
  }

  if (
    typeof input.libraryVersion !== "string" ||
    !SEMVER_LIBRARY_VERSION_REGEX.test(input.libraryVersion)
  ) {
    errors.push({
      code: "INVALID_LIBRARY_VERSION",
      path: "$.libraryVersion",
      message: `libraryVersion "${String(input.libraryVersion)}" inválida. Deve seguir versionamento semântico (ex: "1.0.0")`,
    });
  }

  if (!Array.isArray(input.assets)) {
    errors.push({
      code: "ASSETS_NOT_ARRAY",
      path: "$.assets",
      message: "Propriedade assets precisa ser um array",
    });
    return { ok: false, errors };
  }

  const seenIds = new Set<string>();
  const parsedAssets: AssetDNA[] = [];

  for (let i = 0; i < input.assets.length; i += 1) {
    const rawAsset = input.assets[i];
    const assetPath = `$.assets[${i}]`;

    const parsed = parseAssetDna(rawAsset, assetPath, seenIds);
    if (!parsed.ok) {
      errors.push(...parsed.errors);
    } else {
      parsedAssets.push(parsed.value);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      schemaVersion: ADS_PRO_SCHEMA_VERSION,
      libraryVersion: input.libraryVersion as string,
      assets: parsedAssets,
    },
  };
}
