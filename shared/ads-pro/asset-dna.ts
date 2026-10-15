/**
 * ADS-PRO-01E — Fundação de Dados do Anúncios Pro
 *
 * Contratos puros, serializáveis e imutáveis que definem a estrutura de dados (DNA)
 * de um asset publicitário e o manifesto canônico de biblioteca de assets.
 *
 * Princípio do AssetDNA: Descreve estritamente o ASSET em si.
 * Não descreve estado de tela, usuário, Firestore, campanha pontual ou resultado do Matcher.
 */

import type { MarketingProCategory, MarketingProStyle } from "../marketing-pro-contract";
import { MARKETING_PRO_CATEGORY_VALUES } from "../marketing-pro-contract";
import type { MarketingCampaignIntentId } from "../marketing-pro-creative-intelligence";
import { MARKETING_CAMPAIGN_INTENT_IDS } from "../marketing-pro-creative-intelligence";

/** Versão estrutural do schema de dados (muda apenas com quebra de contrato do modelo). */
export const ADS_PRO_SCHEMA_VERSION = 1 as const;
export type AdsProSchemaVersion = typeof ADS_PRO_SCHEMA_VERSION;

/** Epsilon único para validações de contorno de safe zone e coordenadas normalizadas. */
export const GEOMETRY_EPSILON = 1e-6;

/** Entidades comerciais compatíveis com o asset. Suporta produtos e serviços sem pseudoestado 'both'. */
export const ASSET_ENTITY_KINDS = ["product", "service"] as const;
export type AssetEntityKind = (typeof ASSET_ENTITY_KINDS)[number];

/**
 * Categorias canônicas do Marketing Pro (reutilizadas da fonte de verdade central do contrato).
 *
 * Semântica estrita:
 * - Representa afinidade categórica NORMALIZADA do Marketing Pro ("beauty", "electronics", "fashion", "home", "food", "general").
 * - NÃO é a string bruta de categoria do Product cadastrado (products são normalizados via resolveMarketingProCategory).
 * - Services atualmente NÃO possuem taxonomia equivalente no projeto (shared/services.ts não modela categoria).
 * - Assets voltados a Services (ou universais) utilizam array vazio `targetCategories: []` para expressar ausência de restrição.
 * - Proibido inventar categorias arbitrárias de serviços ou categorias fictícias como "universal".
 */
export const ASSET_CATEGORIES: readonly MarketingProCategory[] = MARKETING_PRO_CATEGORY_VALUES;
export type AssetCategory = MarketingProCategory;

/**
 * Estilos visuais canônicos do AssetDNA V1.
 *
 * Decisão fechada:
 * - Style e CreativeFamily NÃO são o mesmo eixo (conforme provado por resolveMarketingProStyleForCreativeFamily).
 * - AssetDNA V1 utiliza estritamente `MarketingProStyle`: "luxury", "editorial", "minimal", "sensory", "modern".
 * - Famílias frescas de campanha ("fresh-premium", "fresh-sport", "fresh-commercial") NÃO pertencem a Style.
 * - CreativeFamily fica DEFERRED para etapas futuras caso surja consumidor comprovado no AssetDNA.
 */
export const ASSET_STYLES = [
  "luxury",
  "editorial",
  "minimal",
  "sensory",
  "modern",
] as const satisfies readonly MarketingProStyle[];
export type AssetStyle = MarketingProStyle;

/**
 * Intenções comerciais de campanha.
 *
 * Decisão fechada:
 * - Deriva diretamente do contrato canônico completo `MarketingCampaignIntentId` em shared/marketing-pro-creative-intelligence.ts.
 * - Não se restringe aos 4 intents pontuais de uma tela de UI específica.
 * - `supportedIntents: []` significa universalidade (sem restrição de intenção / compatível com qualquer objetivo).
 */
export const ASSET_INTENTS: readonly MarketingCampaignIntentId[] = MARKETING_CAMPAIGN_INTENT_IDS;
export type AssetIntent = MarketingCampaignIntentId;

/**
 * Formatos de exportação canônicos auditados e suportados pelo RevendaSmart
 * (portrait 4:5, square 1:1, story 9:16).
 */
export const ASSET_FORMATS = [
  "portrait",
  "square",
  "story",
] as const;
export type AssetFormat = (typeof ASSET_FORMATS)[number];

/** Ciclo de vida não-destrutivo do asset. */
export const ASSET_STATUSES = [
  "active",
  "deprecated",
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/**
 * Luminância aparente do cenário para decisão de contraste de tipografia no compositor.
 *
 * Semântica estrita:
 * - Quando presente, aceita exclusivamente "dark" ou "light".
 * - Quando ausente, significa "luminância não especificada".
 * - Ausência NÃO significa "light", "dark" ou "auto".
 * - Nenhum Matcher ou consumidor deve assumir fallback silencioso.
 */
export const ASSET_LUMINANCES = [
  "dark",
  "light",
] as const;
export type AssetLuminance = (typeof ASSET_LUMINANCES)[number];

/**
 * Tipo de proveniência do recurso visual.
 *
 * Semântica estrita:
 * - "static": imagem estática curada servida localmente.
 * - "generated": cenário determinístico gerado em código (SVG).
 * - "remote": capacidade de contrato reservada; não possui consumidor V1 comprovado e não realiza I/O nesta camada.
 */
export const ASSET_RESOURCE_TYPES = [
  "static",
  "generated",
  "remote",
] as const;
export type AssetResourceType = (typeof ASSET_RESOURCE_TYPES)[number];

/**
 * Identificador canônico estável do asset (ex: "pro-luxury-pedestal").
 *
 * Justificativa estrita da convenção:
 * - CONVENÇÃO CANÔNICA DO ADS PRO para garantir estabilidade e interoperabilidade determinística.
 * - Independe de filesystem, filename ou resource path.
 */
export type AssetId = string;

/**
 * Região retangular com coordenadas normalizadas no intervalo [0, 1].
 */
export interface NormalizedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Referência mínima desacoplada ao recurso binário ou determinístico real.
 * Não faz I/O nem resolve URLs nesta camada de fundação.
 */
export interface AssetResourceReference {
  readonly type: AssetResourceType;
  readonly uri: string;
}

/**
 * DNA canônico de um Asset do Anúncios Pro.
 */
export interface AssetDNA {
  /** Identificador único, estável e canônico do asset. */
  readonly id: AssetId;
  /** Compatibilidade com entidades do ecossistema (product e/ou service). */
  readonly entityKinds: readonly AssetEntityKind[];
  /**
   * Categorias de afinidade normalizadas. Array vazio (`[]`) representa universalidade
   * (nenhuma restrição de nicho/categoria).
   */
  readonly targetCategories: readonly AssetCategory[];
  /** Estilos visuais expressos pelo asset (restritos a MarketingProStyle). */
  readonly styles: readonly AssetStyle[];
  /**
   * Intenções de campanha com afinidade (MarketingCampaignIntentId). Array vazio (`[]`) representa
   * universalidade (compatível com qualquer objetivo comercial).
   */
  readonly supportedIntents: readonly AssetIntent[];
  /** Formatos de tela/aspect ratio para os quais o asset é válido. */
  readonly formats: readonly AssetFormat[];
  /** Região reservada para o elemento principal (produto ou serviço). */
  readonly subjectZone: NormalizedRect;
  /** Região opcional reservada ou segura para texto/chamada comercial. */
  readonly textZone?: NormalizedRect;
  /** Luminância opcional do cenário. Ausente = não especificada. */
  readonly luminance?: AssetLuminance;
  /** Estado de ciclo de vida (ativo ou depreciado). */
  readonly status: AssetStatus;
  /** Referência desacoplada ao recurso que provê a mídia/cenário. */
  readonly resource: AssetResourceReference;
  /** Tags descritivas opcionais em formato canônico. */
  readonly tags?: readonly string[];
}

/**
 * Manifesto canônico de um pacote ou catálogo de assets.
 */
export interface AssetLibraryManifest {
  /** Versão do schema estrutural (sempre ADS_PRO_SCHEMA_VERSION = 1). */
  readonly schemaVersion: AdsProSchemaVersion;
  /**
   * Versão semântica do conjunto de dados/conteúdo da biblioteca (ex: "1.0.0").
   * Decisão arquitetural da biblioteca para rastreabilidade de catálogo.
   */
  readonly libraryVersion: string;
  /** Lista de assets auditados e parseados. */
  readonly assets: readonly AssetDNA[];
}

/** Erro estruturado de validação com código padronizado e caminho JSONPath-like. */
export interface AssetValidationError {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

/** Resultado tipado discriminado do parser de um único asset. */
export type AssetDnaParseResult =
  | { readonly ok: true; readonly value: AssetDNA }
  | { readonly ok: false; readonly errors: readonly AssetValidationError[] };

/** Resultado tipado discriminado do parser de biblioteca. */
export type AssetLibraryParseResult =
  | { readonly ok: true; readonly value: AssetLibraryManifest }
  | { readonly ok: false; readonly errors: readonly AssetValidationError[] };
