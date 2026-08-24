/**
 * PRO-04 — contrato local de direção de arte Premium.
 *
 * Pipeline futura:
 * structured input -> art director -> background layer -> protected product
 * -> deterministic commercial overlay -> final renderer.
 *
 * Este módulo não chama fornecedor externo, não gera imagem, não controla plano
 * e não debita créditos. A direção de arte descreve somente decisões visuais;
 * dados comerciais permanecem sob autoridade do snapshot do RevendaSmart.
 *
 * `MarketingProFormat`, `MarketingProStyle`, `MARKETING_PRO_FIELD_LIMITS`, `isMarketingProFormat` e
 * `isMarketingProStyle` vivem em `shared/marketing-pro-contract.ts` — é o subconjunto que o backend
 * também precisa (PRO-06A). Reexportados aqui para que nenhum import existente no frontend precise
 * mudar de caminho.
 */

import {
  MARKETING_PRO_FIELD_LIMITS,
  MARKETING_PRO_FORMAT_DIMENSIONS,
  MARKETING_PRO_PRODUCT_ZONE,
  isMarketingProFormat,
  isMarketingProStyle,
  resolveMarketingProCategory,
  type MarketingProCategory,
  type MarketingProFormat,
  type MarketingProProviderArtDirection,
  type MarketingProRect,
  type MarketingProStyle,
} from "@shared/marketing-pro-contract";
import { buildMarketingProProviderArtDirection } from "@shared/marketing-pro-art-direction";

export { MARKETING_PRO_FIELD_LIMITS, MARKETING_PRO_FORMAT_DIMENSIONS, isMarketingProFormat, isMarketingProStyle, resolveMarketingProCategory };
export type { MarketingProCategory, MarketingProFormat, MarketingProProviderArtDirection, MarketingProRect, MarketingProStyle };

export type MarketingProAvailability = "available" | "unavailable" | "unknown";
export type MarketingProImageOrientation = "portrait" | "landscape" | "square" | "unknown";
export type MarketingProCtaAction = "catalog" | "whatsapp" | "contact" | "custom";

export type MarketingProGenerationState =
  | "idle"
  | "preparing"
  | "generating"
  | "compositing"
  | "ready"
  | "failed"
  | "cancelled";

export type MarketingProErrorCode =
  | "invalid_input"
  | "missing_product_image"
  | "unsupported_format"
  | "generation_failed"
  | "timeout"
  | "composition_failed";

export type MarketingProPipelineStage = "prepare" | "generate" | "consume";

export type MarketingProSafeZoneId = "store" | "productName" | "price" | "benefits" | "cta";

export interface MarketingProTextSafeZone {
  readonly id: MarketingProSafeZoneId;
  readonly rect: MarketingProRect;
  readonly purpose: string;
}

export interface MarketingProSafeZones {
  readonly store: MarketingProRect;
  readonly product: MarketingProRect;
  readonly productName: MarketingProRect;
  readonly price: MarketingProRect;
  readonly benefits: MarketingProRect;
  readonly cta: MarketingProRect;
}

export interface MarketingProFormatDefinition {
  readonly id: MarketingProFormat;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly aspectRatio: number;
  readonly safeZones: MarketingProSafeZones;
}

const FORMAT_SAFE_ZONES: Record<MarketingProFormat, MarketingProSafeZones> = {
  portrait: {
    store: { x: 0.08, y: 0.04, width: 0.84, height: 0.08 },
    product: MARKETING_PRO_PRODUCT_ZONE.portrait,
    productName: { x: 0.08, y: 0.66, width: 0.84, height: 0.08 },
    price: { x: 0.08, y: 0.76, width: 0.40, height: 0.08 },
    benefits: { x: 0.08, y: 0.86, width: 0.46, height: 0.06 },
    cta: { x: 0.58, y: 0.86, width: 0.34, height: 0.06 },
  },
  square: {
    store: { x: 0.08, y: 0.05, width: 0.84, height: 0.08 },
    product: MARKETING_PRO_PRODUCT_ZONE.square,
    productName: { x: 0.08, y: 0.63, width: 0.84, height: 0.08 },
    price: { x: 0.08, y: 0.74, width: 0.40, height: 0.08 },
    benefits: { x: 0.08, y: 0.85, width: 0.46, height: 0.06 },
    cta: { x: 0.58, y: 0.84, width: 0.34, height: 0.08 },
  },
  story: {
    store: { x: 0.08, y: 0.03, width: 0.84, height: 0.07 },
    product: MARKETING_PRO_PRODUCT_ZONE.story,
    productName: { x: 0.08, y: 0.66, width: 0.84, height: 0.08 },
    price: { x: 0.08, y: 0.76, width: 0.40, height: 0.08 },
    benefits: { x: 0.08, y: 0.86, width: 0.46, height: 0.06 },
    cta: { x: 0.58, y: 0.86, width: 0.34, height: 0.06 },
  },
};

/**
 * Largura/altura/aspectRatio vêm de `MARKETING_PRO_FORMAT_DIMENSIONS` (shared) — a mesma fonte que o
 * quality gate do backend usa para validar a saída do provider. As safe zones de layout, específicas
 * do compositor local, continuam só aqui.
 */
export const MARKETING_PRO_FORMATS: Record<MarketingProFormat, MarketingProFormatDefinition> = {
  portrait: {
    id: "portrait",
    label: "4:5",
    ...MARKETING_PRO_FORMAT_DIMENSIONS.portrait,
    safeZones: FORMAT_SAFE_ZONES.portrait,
  },
  square: {
    id: "square",
    label: "1:1",
    ...MARKETING_PRO_FORMAT_DIMENSIONS.square,
    safeZones: FORMAT_SAFE_ZONES.square,
  },
  story: {
    id: "story",
    label: "9:16",
    ...MARKETING_PRO_FORMAT_DIMENSIONS.story,
    safeZones: FORMAT_SAFE_ZONES.story,
  },
};

export interface MarketingProStylePreset {
  readonly id: MarketingProStyle;
  readonly label: string;
  readonly description: string;
  readonly visualIntent: string;
  readonly recommendedCategories: readonly MarketingProCategory[];
}

export const MARKETING_PRO_STYLE_PRESETS: Record<MarketingProStyle, MarketingProStylePreset> = {
  luxury: {
    id: "luxury",
    label: "Luxo",
    description: "Acabamento sofisticado, contraste controlado e presenca premium.",
    visualIntent: "refined contrast with restrained highlights",
    recommendedCategories: ["beauty", "fashion", "home"],
  },
  editorial: {
    id: "editorial",
    label: "Editorial",
    description: "Composicao limpa com hierarquia de campanha e espaco respirado.",
    visualIntent: "structured editorial composition with clear hierarchy",
    recommendedCategories: ["beauty", "fashion", "electronics"],
  },
  minimal: {
    id: "minimal",
    label: "Minimalista",
    description: "Superficie simples, poucos elementos e foco no produto original.",
    visualIntent: "quiet surface and product-first composition",
    recommendedCategories: ["electronics", "home", "general"],
  },
  sensory: {
    id: "sensory",
    label: "Sensorial",
    description: "Atmosfera suave orientada a textura, cor e percepcao de produto.",
    visualIntent: "soft atmosphere with tactile color cues",
    recommendedCategories: ["beauty", "food", "home"],
  },
  modern: {
    id: "modern",
    label: "Moderno",
    description: "Geometria atual, contraste funcional e leitura rapida no mobile.",
    visualIntent: "clean geometry with energetic but controlled contrast",
    recommendedCategories: ["electronics", "fashion", "general"],
  },
};

const MARKETING_PRO_STYLE_VISUAL_INTENTS: Record<MarketingProStyle, string> = {
  luxury: "refined contrast with restrained highlights",
  editorial: "structured editorial composition with clear hierarchy",
  minimal: "quiet surface and product-first composition",
  sensory: "soft atmosphere with tactile color cues",
  modern: "clean geometry with energetic but controlled contrast",
};

export interface MarketingProImageDimensions {
  readonly width: number;
  readonly height: number;
}

export interface MarketingProStoreSnapshot {
  readonly name: string;
  readonly logoUrl?: string;
  readonly primaryColor?: string;
}

export interface MarketingProProductSnapshot {
  readonly id: string;
  readonly name: string;
  readonly category?: string;
  readonly imageUrl?: string;
  readonly brand?: string;
  readonly volume?: string;
  readonly description?: string;
  readonly imageDimensions?: MarketingProImageDimensions;
}

export interface MarketingProOfferSnapshot {
  readonly currentPrice: number;
  readonly previousPrice?: number;
  readonly discountPercent?: number;
  readonly availability: MarketingProAvailability;
}

export interface MarketingProCtaSnapshot {
  readonly label: string;
  readonly action: MarketingProCtaAction;
}

export interface MarketingProInput {
  readonly store: MarketingProStoreSnapshot;
  readonly product: MarketingProProductSnapshot;
  readonly offer: MarketingProOfferSnapshot;
  readonly benefits: readonly string[];
  readonly cta: MarketingProCtaSnapshot;
  readonly format: MarketingProFormat;
  readonly style: MarketingProStyle;
}

export interface MarketingProInputDraft {
  readonly store?: { readonly name?: unknown; readonly logoUrl?: unknown; readonly primaryColor?: unknown };
  readonly product?: {
    readonly id?: unknown;
    readonly name?: unknown;
    readonly category?: unknown;
    readonly imageUrl?: unknown;
    readonly brand?: unknown;
    readonly volume?: unknown;
    readonly description?: unknown;
    readonly imageDimensions?: { readonly width?: unknown; readonly height?: unknown };
  };
  readonly offer?: {
    readonly currentPrice?: unknown;
    readonly previousPrice?: unknown;
    readonly discountPercent?: unknown;
    readonly availability?: unknown;
  };
  readonly benefits?: unknown;
  readonly cta?: { readonly label?: unknown; readonly action?: unknown };
  readonly format?: unknown;
  readonly style?: unknown;
}

export interface MarketingProProtectedProductLayer {
  readonly kind: "protected-product";
  readonly sourceImage: string | null;
  readonly originalAspectRatio: number | null;
  readonly orientation: MarketingProImageOrientation;
  readonly placement: MarketingProRect;
  readonly maxBounds: MarketingProRect;
  readonly preserveOriginal: true;
  readonly allowCrop: false;
}

export interface MarketingProBackgroundLayer {
  readonly kind: "background";
  readonly source: "deterministic-preset";
  readonly status: "not-generated";
  readonly assetRef: null;
  readonly description: string;
  readonly palette: readonly string[];
}

export interface MarketingProCommercialOverlay {
  readonly kind: "commercial-overlay";
  readonly authority: "revendasmart-data";
  readonly storeName: string;
  readonly storeLogoUrl?: string;
  readonly productName: string;
  readonly brand?: string;
  readonly volume?: string;
  readonly currentPrice: number;
  readonly currentPriceText: string;
  readonly previousPrice?: number;
  readonly discountPercent?: number;
  readonly availability: MarketingProAvailability;
  readonly benefits: readonly string[];
  readonly cta: MarketingProCtaSnapshot;
}

export interface MarketingProArtDirection {
  readonly format: MarketingProFormat;
  readonly style: MarketingProStyle;
  readonly category: MarketingProCategory;
  readonly palette: readonly string[];
  readonly lighting: string;
  /**
   * PRO-06B0.1 §10: investigado e decidido manter FORA do contrato provider-safe. Não tem nenhum
   * consumidor hoje (nem `buildMarketingProBackgroundLayer`, que monta sua própria `description` a
   * partir de `style`/`category`, lê este campo) — é write-only. Semanticamente redundante com
   * `atmosphere`/`surface`/o estilo em si, que já cobrem "como o fundo deve se comportar". Não removido
   * do tipo por ser um campo local, historicamente já preenchido, sem custo em manter; só documentado
   * para não ser reintroduzido por engano do outro lado da fronteira.
   */
  readonly background: string;
  readonly surface: string;
  readonly atmosphere: string;
  readonly productPlacement: MarketingProRect;
  readonly textSafeZones: readonly MarketingProTextSafeZone[];
}

export interface MarketingProComposition {
  readonly format: MarketingProFormat;
  readonly artDirection: MarketingProArtDirection;
  readonly backgroundLayer: MarketingProBackgroundLayer;
  readonly protectedProductLayer: MarketingProProtectedProductLayer;
  readonly commercialOverlay: MarketingProCommercialOverlay;
}

export interface MarketingProError {
  readonly code: MarketingProErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export interface MarketingProGenerationStatus {
  readonly state: MarketingProGenerationState;
  readonly error?: MarketingProError;
}

export type MarketingProPreparationResult =
  | { readonly state: "ready"; readonly input: MarketingProInput; readonly composition: MarketingProComposition }
  | { readonly state: "failed"; readonly error: MarketingProError };

const MARKETING_PRO_PRICE_LIMIT = 1_000_000_000;
const MARKETING_PRO_PERCENT_LIMIT = 100;
const MARKETING_PRO_CURRENCY = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function stripUnsafeCharacters(value: string): string {
  return Array.from(value).filter((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return !(
      codePoint <= 0x1f
      || (codePoint >= 0x7f && codePoint <= 0x9f)
      || (codePoint >= 0x200b && codePoint <= 0x200d)
      || codePoint === 0xfeff
    );
  }).join("");
}

export function sanitizeMarketingProText(value: unknown, fallback = "", maxLength = 120): string {
  const raw = typeof value === "string" || typeof value === "number" ? String(value) : fallback;
  const limit = Math.max(1, Math.floor(maxLength));
  const sanitized = stripUnsafeCharacters(raw)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit)
    .trim();
  return sanitized || fallback;
}

export function sanitizeMarketingProUrl(value: unknown, maxLength = MARKETING_PRO_FIELD_LIMITS.imageUrl): string | undefined {
  const candidate = sanitizeMarketingProText(value, "", maxLength);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function sanitizeMarketingProColor(value: unknown): string | undefined {
  const color = sanitizeMarketingProText(value, "", MARKETING_PRO_FIELD_LIMITS.color);
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : undefined;
}

export function normalizeMarketingProPrice(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 && value <= MARKETING_PRO_PRICE_LIMIT
      ? Math.round(value * 100) / 100
      : null;
  }
  if (typeof value !== "string") return null;
  const raw = value.trim().replace(/R\$|\s/gi, "");
  if (!raw) return null;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const parsed = Number.parseFloat(normalized.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= MARKETING_PRO_PRICE_LIMIT
    ? Math.round(parsed * 100) / 100
    : null;
}

function normalizeMarketingProPercent(value: unknown): number | undefined {
  const numeric = normalizeMarketingProPrice(typeof value === "string" ? value.replace("%", "") : value);
  return numeric !== null && numeric <= MARKETING_PRO_PERCENT_LIMIT ? numeric : undefined;
}

function normalizeAvailability(value: unknown): MarketingProAvailability {
  return value === "available" || value === "unavailable" || value === "unknown" ? value : "unknown";
}

export function resolveMarketingProFormat(value: unknown): MarketingProFormat {
  return isMarketingProFormat(value) ? value : "portrait";
}

export function resolveMarketingProStyle(value: unknown): MarketingProStyle {
  return isMarketingProStyle(value) ? value : "editorial";
}

function resolveCtaAction(value: unknown): MarketingProCtaAction {
  return value === "catalog" || value === "whatsapp" || value === "contact" || value === "custom" ? value : "custom";
}

function normalizeImageDimensions(value: unknown): MarketingProImageDimensions | undefined {
  const record = asRecord(value);
  const width = Number(record.width);
  const height = Number(record.height);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : undefined;
}

export function sanitizeMarketingProBenefits(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const benefit of value) {
    const clean = sanitizeMarketingProText(benefit, "", MARKETING_PRO_FIELD_LIMITS.benefit);
    if (clean) unique.add(clean);
    if (unique.size === 3) break;
  }
  return Array.from(unique);
}

/**
 * Reduz dados externos ao snapshot mínimo usado pelo PRO. O texto continua sendo dado comercial;
 * esta função não o interpreta como instrução nem o envia a nenhum serviço.
 */
export function sanitizeMarketingProInput(draft: MarketingProInputDraft): MarketingProInput {
  const store = asRecord(draft.store);
  const product = asRecord(draft.product);
  const offer = asRecord(draft.offer);
  const cta = asRecord(draft.cta);
  const currentPrice = normalizeMarketingProPrice(offer.currentPrice) ?? 0;
  const previousPrice = normalizeMarketingProPrice(offer.previousPrice);

  return {
    store: {
      name: sanitizeMarketingProText(store.name, "", MARKETING_PRO_FIELD_LIMITS.storeName),
      logoUrl: sanitizeMarketingProUrl(store.logoUrl),
      primaryColor: sanitizeMarketingProColor(store.primaryColor),
    },
    product: {
      id: sanitizeMarketingProText(product.id, "", MARKETING_PRO_FIELD_LIMITS.productId),
      name: sanitizeMarketingProText(product.name, "", MARKETING_PRO_FIELD_LIMITS.productName),
      category: sanitizeMarketingProText(product.category, "", MARKETING_PRO_FIELD_LIMITS.category) || undefined,
      imageUrl: sanitizeMarketingProUrl(product.imageUrl),
      brand: sanitizeMarketingProText(product.brand, "", MARKETING_PRO_FIELD_LIMITS.brand) || undefined,
      volume: sanitizeMarketingProText(product.volume, "", MARKETING_PRO_FIELD_LIMITS.volume) || undefined,
      description: sanitizeMarketingProText(product.description, "", MARKETING_PRO_FIELD_LIMITS.description) || undefined,
      imageDimensions: normalizeImageDimensions(product.imageDimensions),
    },
    offer: {
      currentPrice,
      previousPrice: previousPrice === null ? undefined : previousPrice,
      discountPercent: normalizeMarketingProPercent(offer.discountPercent),
      availability: normalizeAvailability(offer.availability),
    },
    benefits: sanitizeMarketingProBenefits(draft.benefits),
    cta: {
      label: sanitizeMarketingProText(cta.label, "", MARKETING_PRO_FIELD_LIMITS.ctaLabel),
      action: resolveCtaAction(cta.action),
    },
    format: resolveMarketingProFormat(draft.format),
    style: resolveMarketingProStyle(draft.style),
  };
}

export interface MarketingProValidationResult {
  readonly valid: boolean;
  readonly issues: readonly string[];
}

export function validateMarketingProInput(input: MarketingProInput): MarketingProValidationResult {
  const issues: string[] = [];
  if (!input.store.name) issues.push("store.name");
  if (!input.product.id) issues.push("product.id");
  if (!input.product.name) issues.push("product.name");
  if (!Number.isFinite(input.offer.currentPrice) || input.offer.currentPrice < 0) issues.push("offer.currentPrice");
  if (!input.cta.label) issues.push("cta.label");
  if (!isMarketingProFormat(input.format)) issues.push("format");
  if (!isMarketingProStyle(input.style)) issues.push("style");
  if (input.benefits.length > 3) issues.push("benefits.limit");
  return { valid: issues.length === 0, issues };
}


export function resolveMarketingProImageGeometry(dimensions?: MarketingProImageDimensions): {
  readonly aspectRatio: number | null;
  readonly orientation: MarketingProImageOrientation;
} {
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    return { aspectRatio: null, orientation: "unknown" };
  }
  const aspectRatio = dimensions.width / dimensions.height;
  const orientation = Math.abs(aspectRatio - 1) < 0.02
    ? "square"
    : aspectRatio > 1
      ? "landscape"
      : "portrait";
  return { aspectRatio, orientation };
}

function getCategoryAccent(category: MarketingProCategory): string {
  return {
    beauty: "#c026d3",
    electronics: "#2563eb",
    fashion: "#db2777",
    home: "#0f766e",
    food: "#ea580c",
    general: "#6d5dfc",
  }[category];
}

function getTextSafeZones(format: MarketingProFormat): MarketingProTextSafeZone[] {
  const zones = MARKETING_PRO_FORMATS[format].safeZones;
  return [
    { id: "store", rect: zones.store, purpose: "store identity" },
    { id: "productName", rect: zones.productName, purpose: "product name" },
    { id: "price", rect: zones.price, purpose: "commercial price" },
    { id: "benefits", rect: zones.benefits, purpose: "verified benefits" },
    { id: "cta", rect: zones.cta, purpose: "commercial call to action" },
  ];
}

/**
 * Art Director local: devolve apenas metadados visuais determinísticos. Não é um cliente de IA e
 * não recebe autoridade sobre o overlay comercial.
 */
export function buildMarketingProArtDirection(input: MarketingProInput): MarketingProArtDirection {
  const category = resolveMarketingProCategory(input.product.category);
  const accent = input.store.primaryColor || getCategoryAccent(category);
  const palette = Array.from(new Set([accent, getCategoryAccent(category), "#f8fafc"]));
  return {
    format: input.format,
    style: input.style,
    category,
    palette,
    lighting: MARKETING_PRO_STYLE_VISUAL_INTENTS[input.style],
    background: `${input.style} background direction`,
    surface: category === "food" ? "warm tactile surface" : "soft matte surface",
    atmosphere: `${MARKETING_PRO_STYLE_VISUAL_INTENTS[input.style]} for ${category}`,
    productPlacement: MARKETING_PRO_FORMATS[input.format].safeZones.product,
    textSafeZones: getTextSafeZones(input.format),
  };
}

/**
 * Reduz `MarketingProArtDirection` (comercial completa, só client) ao subconjunto seguro para o
 * provider — PRO-06B0.1 §11. Antes, esta função copiava `direction.lighting`/`surface`/`atmosphere`
 * (texto livre, potencialmente contaminável por um call site futuro) direto para o payload do
 * provider. Agora delega inteiramente a `buildMarketingProProviderArtDirection`
 * (shared/marketing-pro-art-direction.ts) — a mesma função central que o backend e o benchmark usam —
 * passando só category/style/format e a primeira cor da palette local como candidato de
 * `primaryColor`. Nenhum campo de texto livre do lado comercial atravessa mais para o provider.
 */
export function toMarketingProProviderArtDirection(direction: MarketingProArtDirection): MarketingProProviderArtDirection {
  return buildMarketingProProviderArtDirection({
    category: direction.category,
    style: direction.style,
    format: direction.format,
    primaryColor: direction.palette[0],
  });
}

export function buildMarketingProProtectedProductLayer(input: MarketingProInput): MarketingProProtectedProductLayer {
  const geometry = resolveMarketingProImageGeometry(input.product.imageDimensions);
  const productBounds = MARKETING_PRO_FORMATS[input.format].safeZones.product;
  return {
    kind: "protected-product",
    sourceImage: input.product.imageUrl || null,
    originalAspectRatio: geometry.aspectRatio,
    orientation: geometry.orientation,
    placement: productBounds,
    maxBounds: productBounds,
    preserveOriginal: true,
    allowCrop: false,
  };
}

export function buildMarketingProBackgroundLayer(input: MarketingProInput, artDirection = buildMarketingProArtDirection(input)): MarketingProBackgroundLayer {
  return {
    kind: "background",
    source: "deterministic-preset",
    status: "not-generated",
    assetRef: null,
    description: `${artDirection.style} ${artDirection.category} ambient direction`,
    palette: artDirection.palette,
  };
}

function formatMarketingProPrice(value: number): string {
  return MARKETING_PRO_CURRENCY.format(value).replace(/\u00a0/g, " ");
}

export function buildMarketingProCommercialOverlay(input: MarketingProInput): MarketingProCommercialOverlay {
  return {
    kind: "commercial-overlay",
    authority: "revendasmart-data",
    storeName: input.store.name,
    storeLogoUrl: input.store.logoUrl,
    productName: input.product.name,
    brand: input.product.brand,
    volume: input.product.volume,
    currentPrice: input.offer.currentPrice,
    currentPriceText: formatMarketingProPrice(input.offer.currentPrice),
    previousPrice: input.offer.previousPrice,
    discountPercent: input.offer.discountPercent,
    availability: input.offer.availability,
    benefits: input.benefits,
    cta: input.cta,
  };
}

export function buildMarketingProComposition(input: MarketingProInput): MarketingProComposition {
  const artDirection = buildMarketingProArtDirection(input);
  return {
    format: input.format,
    artDirection,
    backgroundLayer: buildMarketingProBackgroundLayer(input, artDirection),
    protectedProductLayer: buildMarketingProProtectedProductLayer(input),
    commercialOverlay: buildMarketingProCommercialOverlay(input),
  };
}

const REQUIRED_INPUT_FIELDS = ["store.name", "product.id", "product.name", "offer.currentPrice", "cta.label"] as const;

export function createMarketingProError(code: MarketingProErrorCode): MarketingProError {
  const messages: Record<MarketingProErrorCode, string> = {
    invalid_input: "Confira os dados do anuncio e tente novamente.",
    missing_product_image: "Adicione uma imagem valida do produto para continuar.",
    unsupported_format: "Este formato ainda nao esta disponivel.",
    generation_failed: "Nao foi possivel preparar a direcao visual.",
    timeout: "A preparacao demorou mais que o esperado. Tente novamente.",
    composition_failed: "Nao foi possivel montar a composicao do anuncio.",
  };
  return {
    code,
    message: messages[code],
    retryable: code === "generation_failed" || code === "timeout" || code === "composition_failed",
  };
}

export function getMarketingProErrorMessage(code: MarketingProErrorCode): string {
  return createMarketingProError(code).message;
}

export function prepareMarketingProInput(draft: MarketingProInputDraft): MarketingProPreparationResult {
  const input = sanitizeMarketingProInput(draft);
  const rawOffer = asRecord(draft.offer);
  const rawFormat = draft.format;
  const validation = validateMarketingProInput(input);

  if (REQUIRED_INPUT_FIELDS.some((field) => validation.issues.includes(field))) {
    return { state: "failed", error: createMarketingProError("invalid_input") };
  }
  if (rawOffer.currentPrice === undefined || normalizeMarketingProPrice(rawOffer.currentPrice) === null) {
    return { state: "failed", error: createMarketingProError("invalid_input") };
  }
  if (rawFormat !== undefined && !isMarketingProFormat(rawFormat)) {
    return { state: "failed", error: createMarketingProError("unsupported_format") };
  }
  if (!input.product.imageUrl) {
    return { state: "failed", error: createMarketingProError("missing_product_image") };
  }
  return { state: "ready", input, composition: buildMarketingProComposition(input) };
}

export const MARKETING_PRO_PIPELINE_STAGES: readonly MarketingProPipelineStage[] = ["prepare", "generate", "consume"];

export const MARKETING_PRO_CREDIT_POLICY = {
  prepare: "no-charge",
  generate: "server-authoritative",
  consume: "server-authoritative",
  frontendCanDebit: false,
} as const;

const STATE_TRANSITIONS: Record<MarketingProGenerationState, readonly MarketingProGenerationState[]> = {
  idle: ["preparing"],
  preparing: ["generating", "failed", "cancelled"],
  generating: ["compositing", "failed", "cancelled"],
  compositing: ["ready", "failed", "cancelled"],
  ready: ["preparing"],
  failed: ["preparing"],
  cancelled: ["preparing"],
};

export function createMarketingProGenerationStatus(state: MarketingProGenerationState = "idle"): MarketingProGenerationStatus {
  return { state };
}

export function canTransitionMarketingProState(
  from: MarketingProGenerationState,
  to: MarketingProGenerationState,
): boolean {
  return STATE_TRANSITIONS[from].includes(to);
}

export function transitionMarketingProGenerationState(
  current: MarketingProGenerationStatus,
  next: MarketingProGenerationState,
  error?: MarketingProError,
): MarketingProGenerationStatus | null {
  if (!canTransitionMarketingProState(current.state, next)) return null;
  if (next === "failed" && !error) return null;
  return next === "failed" ? { state: next, error } : { state: next };
}
