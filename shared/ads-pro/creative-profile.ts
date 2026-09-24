/**
 * ADS-PRO-03A — Creative Profile V1 do Anúncios Pro
 *
 * Contrato puro e imutável que representa as preferências visuais persistentes
 * do negócio/lojista através de campanhas no RevendaSmart.
 *
 * Princípios Centrais:
 * - Separação Conceitual: Preferências visuais perenes (CreativeProfile) vs. Contexto efêmero de criação (requestContext).
 * - Escopo Mínimo V1: Contém exclusivamente schemaVersion e preferredStyles (MarketingProStyle).
 * - CreativeFamily DEFERRED: Não inclui creativeFamily ou famílias sazonais ("fresh-*").
 * - Sem PII / Sem Timestamps: Ownership e metadados de banco pertencem à camada de persistência externa.
 * - Pureza e Zero I/O: Não acessa filesystem, rede, banco ou browser APIs.
 */

import {
  isMarketingProStyle,
  type MarketingProStyle,
} from "../marketing-pro-contract";
import type {
  AssetCategory,
  AssetEntityKind,
  AssetFormat,
  AssetIntent,
} from "./asset-dna";
import type { AssetMatchContext } from "./asset-matcher";

/** Versão estrutural única do schema do Creative Profile V1. */
export const ADS_PRO_CREATIVE_PROFILE_SCHEMA_VERSION = 1 as const;
export type AdsProCreativeProfileSchemaVersion = typeof ADS_PRO_CREATIVE_PROFILE_SCHEMA_VERSION;

/**
 * Perfil criativo puro V1 com preferências visuais persistentes.
 */
export interface AdsProCreativeProfileV1 {
  /** Versão estrutural do schema (sempre 1). */
  readonly schemaVersion: AdsProCreativeProfileSchemaVersion;
  /**
   * Lista ordenada de preferências de estilo visual (MarketingProStyle).
   * O primeiro estilo ([0]) possui prioridade PRIMÁRIA.
   * Os estilos subsequentes ([1..n]) possuem prioridade SECUNDÁRIA.
   * Array vazio ([]) representa ausência de preferência definida (estritamente válido).
   */
  readonly preferredStyles: readonly MarketingProStyle[];
}

/** Chaves permitidas no objeto de entrada do CreativeProfile V1. */
const ALLOWED_PROFILE_KEYS: readonly string[] = [
  "schemaVersion",
  "preferredStyles",
];

/** Erro estruturado de validação do Creative Profile. */
export interface CreativeProfileValidationError {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

/** Resultado tipado do parser de entrada do Creative Profile. */
export type AdsProCreativeProfileParseResult =
  | { readonly ok: true; readonly value: AdsProCreativeProfileV1 }
  | { readonly ok: false; readonly errors: readonly CreativeProfileValidationError[] };

/**
 * Contexto comercial efêmero de criação de anúncio (parâmetros da geração atual).
 * Não deve ser salvo no Creative Profile permanente.
 */
export interface AdCreationContext {
  /** Tipo de entidade anunciada (produto ou serviço). */
  readonly entityKind: AssetEntityKind;
  /** Formato de tela do anúncio (ex: portrait, square, story). */
  readonly format: AssetFormat;
  /** Categoria normalizada de catálogo (opcional, aplicável a produtos). */
  readonly category?: AssetCategory;
  /** Intenção comercial da campanha atual (opcional). */
  readonly intent?: AssetIntent;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parser seguro e fail-safe para validar Creative Profile a partir de boundary desconhecido (unknown).
 *
 * Regras estritas:
 * 1. Não lança exceções para nenhuma entrada inválida.
 * 2. Rejeita objetos com chaves desconhecidas (ex: creativeFamily, luminance, etc.).
 * 3. Exige schemaVersion === 1.
 * 4. Exige preferredStyles como array (vazio é válido).
 * 5. Rejeita estilos que não pertençam a MarketingProStyle (ex: fresh-premium, desconhecidos).
 * 6. Rejeita duplicatas em preferredStyles (o perfil canônico deve nascer limpo).
 * 7. Preserva estritamente a ordem de entrada.
 * 8. Nunca muta o input original.
 */
export function parseAdsProCreativeProfile(input: unknown): AdsProCreativeProfileParseResult {
  const errors: CreativeProfileValidationError[] = [];

  if (!isPlainObject(input)) {
    return {
      ok: false,
      errors: [
        {
          code: "NOT_AN_OBJECT",
          path: "$",
          message: "Creative Profile precisa ser um objeto não-nulo e não-array",
        },
      ],
    };
  }

  // Verificação de chaves desconhecidas
  const allowedSet = new Set(ALLOWED_PROFILE_KEYS);
  for (const key of Object.keys(input)) {
    if (!allowedSet.has(key)) {
      errors.push({
        code: "UNKNOWN_KEY",
        path: `$.${key}`,
        message: `Chave não reconhecida "${key}" em Creative Profile V1`,
      });
    }
  }

  // Validação de schemaVersion
  if (input.schemaVersion === undefined) {
    errors.push({
      code: "MISSING_SCHEMA_VERSION",
      path: "$.schemaVersion",
      message: "Propriedade schemaVersion é obrigatória",
    });
  } else if (input.schemaVersion !== ADS_PRO_CREATIVE_PROFILE_SCHEMA_VERSION) {
    errors.push({
      code: "SCHEMA_INCOMPATIBLE",
      path: "$.schemaVersion",
      message: `schemaVersion "${String(input.schemaVersion)}" incompatível. Esperado: ${ADS_PRO_CREATIVE_PROFILE_SCHEMA_VERSION}`,
    });
  }

  // Validação de preferredStyles
  let validatedStyles: MarketingProStyle[] = [];

  if (input.preferredStyles === undefined) {
    errors.push({
      code: "MISSING_PREFERRED_STYLES",
      path: "$.preferredStyles",
      message: "Propriedade preferredStyles é obrigatória",
    });
  } else if (!Array.isArray(input.preferredStyles)) {
    errors.push({
      code: "INVALID_PREFERRED_STYLES",
      path: "$.preferredStyles",
      message: "Propriedade preferredStyles precisa ser um array",
    });
  } else {
    const seen = new Set<string>();
    const stylesResult: MarketingProStyle[] = [];

    for (let i = 0; i < input.preferredStyles.length; i += 1) {
      const item = input.preferredStyles[i];
      const itemPath = `$.preferredStyles[${i}]`;

      if (typeof item !== "string" || !isMarketingProStyle(item)) {
        errors.push({
          code: "INVALID_STYLE",
          path: itemPath,
          message: `Estilo visual "${String(item)}" inválido em ${itemPath}`,
        });
        continue;
      }

      if (seen.has(item)) {
        errors.push({
          code: "DUPLICATE_STYLE",
          path: itemPath,
          message: `Estilo visual duplicado "${item}" em ${itemPath}`,
        });
        continue;
      }

      seen.add(item);
      stylesResult.push(item);
    }

    validatedStyles = stylesResult;
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const value: AdsProCreativeProfileV1 = Object.freeze({
    schemaVersion: ADS_PRO_CREATIVE_PROFILE_SCHEMA_VERSION,
    preferredStyles: Object.freeze(validatedStyles),
  });

  return {
    ok: true,
    value,
  };
}

/**
 * Função de integração pura entre o Creative Profile e o Matcher.
 *
 * Constrói o AssetMatchContext garantindo que:
 * 1. Os dados da campanha atual (requestContext: entityKind, format, category, intent) sejam preservados.
 * 2. O profile contribua EXCLUSIVAMENTE com preferredStyles.
 * 3. O profile NÃO consiga sobrescrever entityKind, format, category ou intent.
 * 4. A ausência de profile ou profile com preferredStyles: [] resulte em preferredStyles: [].
 * 5. A ordem de prioridades visuais do profile ([0] = primary, [1..n] = secondary) seja estritamente preservada.
 */
export function resolveAssetMatchContext(
  requestContext: AdCreationContext,
  profile?: AdsProCreativeProfileV1
): AssetMatchContext {
  const preferredStyles = profile?.preferredStyles
    ? Object.freeze([...profile.preferredStyles])
    : Object.freeze([]);

  return Object.freeze({
    entityKind: requestContext.entityKind,
    format: requestContext.format,
    ...(requestContext.category !== undefined ? { category: requestContext.category } : {}),
    ...(requestContext.intent !== undefined ? { intent: requestContext.intent } : {}),
    preferredStyles,
  });
}
