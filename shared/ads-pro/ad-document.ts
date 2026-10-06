/**
 * ADS-PRO-FINAL — documento serializável do anúncio (a "fonte da verdade" do estúdio).
 *
 * O preview, a edição, as variações, o salvar e o exportar operam sobre ESTE objeto. Ele guarda decisões
 * (qual fundo, qual layout, quais textos, qual enquadramento), nunca pixels: a foto continua sendo a do
 * produto, o fundo é uma referência do manifest e o resultado visual é sempre re-derivado. Por isso o
 * anúncio escolhido segue 100% editável — só vira imagem na hora de exportar.
 *
 * Puro: sem DOM, sem Firebase.
 */
import { MARKETING_PRO_FORMAT_DIMENSIONS } from "../marketing-pro-contract";
import { MARKETING_CAMPAIGN_INTENT_IDS, type MarketingCampaignIntentId } from "../marketing-pro-creative-intelligence";
import { isMarketingProStyle, type MarketingProStyle } from "../marketing-pro-contract";
import { formatBrlFromCents, defaultSubtitle, type AdsProProductFacts } from "./ad-product-facts";
import {
  ADS_PRO_CTA_SHAPES,
  ADS_PRO_DECORATIONS,
  ADS_PRO_HIERARCHIES,
  ADS_PRO_LAYOUT_ARCHETYPES,
  ADS_PRO_PRICE_STYLES,
  ADS_PRO_SPACINGS,
  type AdsProCtaShape,
  type AdsProDecoration,
  type AdsProHierarchy,
  type AdsProIntensity,
  type AdsProLayoutArchetype,
  type AdsProPriceStyle,
  type AdsProSpacing,
  type AdsProStyleDirection,
} from "./ad-style-direction";

export const ADS_PRO_DOCUMENT_VERSION = 1 as const;

/** Mesmos formatos já existentes no Anúncio Pro (4:5 e 1:1). Story existe no contrato mas não no compositor. */
export const ADS_PRO_FORMATS = ["portrait", "square"] as const;
export type AdsProFormat = (typeof ADS_PRO_FORMATS)[number];
export const ADS_PRO_FORMAT_LABELS: Readonly<Record<AdsProFormat, string>> = Object.freeze({ portrait: "4:5 Vertical", square: "1:1 Quadrado" });

export function getAdsProCanvasSize(format: AdsProFormat): { readonly width: number; readonly height: number } {
  const { width, height } = MARKETING_PRO_FORMAT_DIMENSIONS[format];
  return { width, height };
}

export const ADS_PRO_TEXT_LIMITS = Object.freeze({
  headline: 80,
  subtitle: 80,
  kicker: 28,
  priceText: 20,
  oldPriceText: 24,
  badgeText: 14,
  ctaText: 36,
  storeName: 40,
});

export interface AdsProAdText {
  readonly headline: string;
  readonly subtitle: string;
  readonly kicker: string;
  readonly priceText: string;
  readonly oldPriceText: string;
  readonly badgeText: string;
  readonly ctaText: string;
}

export interface AdsProAdVisibility {
  readonly kicker: boolean;
  readonly subtitle: boolean;
  readonly price: boolean;
  readonly badge: boolean;
  readonly cta: boolean;
  readonly logo: boolean;
}

export interface AdsProPhotoAdjust {
  /** -0.25..0.25 (fração de 255 somada aos canais). */
  readonly brightness: number;
  /** 0.85..1.30 */
  readonly contrast: number;
  /** 0.80..1.35 */
  readonly saturation: number;
  /** 0..1 (força da máscara de nitidez). */
  readonly sharpness: number;
}

export const NEUTRAL_PHOTO_ADJUST: AdsProPhotoAdjust = Object.freeze({ brightness: 0, contrast: 1, saturation: 1, sharpness: 0 });

export const PHOTO_ADJUST_LIMITS = Object.freeze({
  brightness: { min: -0.25, max: 0.25 },
  contrast: { min: 0.85, max: 1.3 },
  saturation: { min: 0.8, max: 1.35 },
  sharpness: { min: 0, max: 1 },
});

export const PHOTO_FRAMING_LIMITS = Object.freeze({ zoom: { min: 1, max: 3 }, offset: { min: -1, max: 1 } });

export interface AdsProPhotoState {
  /** "original" = foto do produto (com ajustes opcionais); "cutout" = produto recortado (sem fundo). */
  readonly mode: "original" | "cutout";
  readonly zoom: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly adjust: AdsProPhotoAdjust;
}

export interface AdsProDocumentDirection {
  readonly style: MarketingProStyle;
  readonly intent: MarketingCampaignIntentId;
  readonly intensity: AdsProIntensity;
  readonly archetype: AdsProLayoutArchetype;
  readonly hierarchy: AdsProHierarchy;
  readonly spacing: AdsProSpacing;
  readonly ctaShape: AdsProCtaShape;
  readonly decoration: AdsProDecoration;
  readonly priceStyle: AdsProPriceStyle;
}

export interface AdsProDocumentBackground {
  readonly id: string;
  readonly version: number;
  readonly family: string;
  readonly source: "GENERATED_DETERMINISTIC" | "STATIC_ASSET";
}

export interface AdsProAdDocumentV1 {
  readonly v: typeof ADS_PRO_DOCUMENT_VERSION;
  readonly productId: string;
  readonly format: AdsProFormat;
  /** "A" | "B" | "C" … — identidade da variação de origem (só informativa). */
  readonly variationId: string;
  readonly direction: AdsProDocumentDirection;
  readonly background: AdsProDocumentBackground;
  readonly photo: AdsProPhotoState;
  readonly text: AdsProAdText;
  readonly show: AdsProAdVisibility;
  readonly brand: { readonly storeName: string; readonly accent?: string };
}

// ---------------------------------------------------------------------------------------------
// Sanitização de texto
// ---------------------------------------------------------------------------------------------

/** Durante a digitação: remove controles e limita o tamanho — NÃO apara espaços (senão "duas palavras" não digita). */
export function sanitizeAdTextInput(value: string, maxLength: number): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, maxLength);
}

/** Para render/salvar/exportar: apara e colapsa espaços repetidos. */
export function normalizeAdText(value: string, maxLength: number): string {
  return sanitizeAdTextInput(value, maxLength * 2).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function clampPhotoAdjust(adjust: Partial<AdsProPhotoAdjust>): AdsProPhotoAdjust {
  return {
    brightness: round(clamp(adjust.brightness ?? 0, PHOTO_ADJUST_LIMITS.brightness.min, PHOTO_ADJUST_LIMITS.brightness.max)),
    contrast: round(clamp(adjust.contrast ?? 1, PHOTO_ADJUST_LIMITS.contrast.min, PHOTO_ADJUST_LIMITS.contrast.max)),
    saturation: round(clamp(adjust.saturation ?? 1, PHOTO_ADJUST_LIMITS.saturation.min, PHOTO_ADJUST_LIMITS.saturation.max)),
    sharpness: round(clamp(adjust.sharpness ?? 0, PHOTO_ADJUST_LIMITS.sharpness.min, PHOTO_ADJUST_LIMITS.sharpness.max)),
  };
}

export function isNeutralPhotoAdjust(adjust: AdsProPhotoAdjust): boolean {
  return adjust.brightness === 0 && adjust.contrast === 1 && adjust.saturation === 1 && adjust.sharpness === 0;
}

export function clampPhotoFraming(photo: Pick<AdsProPhotoState, "zoom" | "offsetX" | "offsetY">): Pick<AdsProPhotoState, "zoom" | "offsetX" | "offsetY"> {
  return {
    zoom: round(clamp(photo.zoom, PHOTO_FRAMING_LIMITS.zoom.min, PHOTO_FRAMING_LIMITS.zoom.max)),
    offsetX: round(clamp(photo.offsetX, PHOTO_FRAMING_LIMITS.offset.min, PHOTO_FRAMING_LIMITS.offset.max)),
    offsetY: round(clamp(photo.offsetY, PHOTO_FRAMING_LIMITS.offset.min, PHOTO_FRAMING_LIMITS.offset.max)),
  };
}

// ---------------------------------------------------------------------------------------------
// Textos padrão — SEMPRE derivados de dados reais
// ---------------------------------------------------------------------------------------------

/** Limite de estoque abaixo do qual "últimas unidades" é uma afirmação verdadeira. */
export const ADS_PRO_LOW_STOCK_THRESHOLD = 5;

export function defaultAdText(facts: AdsProProductFacts, intent: MarketingCampaignIntentId): AdsProAdText {
  const price = facts.price;
  const lowStock = facts.stock !== null && facts.stock > 0 && facts.stock <= ADS_PRO_LOW_STOCK_THRESHOLD;
  let kicker = "";
  if (intent === "new") kicker = "NOVIDADE";
  else if (intent === "promo" && price?.hasPromotion) kicker = "OFERTA";
  else if (intent === "last" && lowStock) kicker = "ÚLTIMAS UNIDADES";
  else if (facts.brand) kicker = facts.brand.toUpperCase();

  let ctaText = "Ver no catálogo";
  if (intent === "promo") ctaText = "Aproveite agora";
  else if (intent === "last") ctaText = "Garanta o seu";
  else if (intent === "new") ctaText = "Conheça agora";

  // Quando a marca já aparece no kicker, o subtítulo evita repeti-la: usa o volume ou um trecho da descrição real.
  const brandShownInKicker = Boolean(facts.brand) && kicker === facts.brand?.toUpperCase();
  const subtitleSource = brandShownInKicker ? facts.volume ?? descriptionSnippet(facts) : defaultSubtitle(facts);

  return {
    headline: normalizeAdText(facts.name, ADS_PRO_TEXT_LIMITS.headline),
    subtitle: normalizeAdText(subtitleSource, ADS_PRO_TEXT_LIMITS.subtitle),
    kicker: normalizeAdText(kicker, ADS_PRO_TEXT_LIMITS.kicker),
    priceText: price ? formatBrlFromCents(price.effectiveCents) : "",
    oldPriceText: price?.hasPromotion ? `de ${formatBrlFromCents(price.regularCents)}` : "",
    badgeText: price?.hasPromotion && price.discountPercent !== null && price.discountPercent > 0 ? `${price.discountPercent}% OFF` : "",
    ctaText,
  };
}

function descriptionSnippet(facts: AdsProProductFacts): string {
  return defaultSubtitle({ ...facts, brand: undefined, volume: undefined });
}

export function defaultAdVisibility(text: AdsProAdText, facts: AdsProProductFacts): AdsProAdVisibility {
  return {
    kicker: text.kicker.length > 0,
    subtitle: text.subtitle.length > 0,
    price: facts.price !== null,
    badge: text.badgeText.length > 0,
    cta: true,
    logo: true,
  };
}

// ---------------------------------------------------------------------------------------------
// Construção
// ---------------------------------------------------------------------------------------------

export interface CreateAdsProDocumentInput {
  readonly facts: AdsProProductFacts;
  readonly direction: AdsProStyleDirection;
  readonly archetype: AdsProLayoutArchetype;
  readonly decoration?: AdsProDecoration;
  readonly format: AdsProFormat;
  readonly background: AdsProDocumentBackground;
  readonly variationId: string;
  readonly storeName: string;
  readonly accent?: string;
  readonly photoMode?: AdsProPhotoState["mode"];
  readonly photoAdjust?: AdsProPhotoAdjust;
}

export function createAdsProDocument(input: CreateAdsProDocumentInput): AdsProAdDocumentV1 {
  const text = defaultAdText(input.facts, input.direction.intent);
  return {
    v: ADS_PRO_DOCUMENT_VERSION,
    productId: input.facts.productId,
    format: input.format,
    variationId: input.variationId,
    direction: {
      style: input.direction.primaryStyle,
      intent: input.direction.intent,
      intensity: input.direction.intensity,
      archetype: input.archetype,
      hierarchy: input.direction.hierarchy,
      spacing: input.direction.spacing,
      ctaShape: input.direction.cta.shape,
      decoration: input.decoration ?? input.direction.decorations[0] ?? "none",
      priceStyle: input.direction.priceStyle,
    },
    background: { ...input.background },
    photo: {
      mode: input.photoMode ?? "original",
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      adjust: input.photoAdjust ?? NEUTRAL_PHOTO_ADJUST,
    },
    text,
    show: defaultAdVisibility(text, input.facts),
    brand: { storeName: normalizeAdText(input.storeName, ADS_PRO_TEXT_LIMITS.storeName) || "Minha loja", ...(input.accent ? { accent: input.accent } : {}) },
  };
}

// ---------------------------------------------------------------------------------------------
// Edições puras (nunca mutam; nenhuma delas toca rede, quota ou storage)
// ---------------------------------------------------------------------------------------------

export function withText(doc: AdsProAdDocumentV1, patch: Partial<AdsProAdText>): AdsProAdDocumentV1 {
  const next: Record<string, string> = { ...doc.text };
  for (const key of Object.keys(patch) as (keyof AdsProAdText)[]) {
    const value = patch[key];
    if (typeof value === "string") next[key] = sanitizeAdTextInput(value, ADS_PRO_TEXT_LIMITS[key]);
  }
  return { ...doc, text: next as unknown as AdsProAdText };
}

export function withVisibility(doc: AdsProAdDocumentV1, patch: Partial<AdsProAdVisibility>): AdsProAdDocumentV1 {
  return { ...doc, show: { ...doc.show, ...patch } };
}

export function withBackground(doc: AdsProAdDocumentV1, background: AdsProDocumentBackground): AdsProAdDocumentV1 {
  return { ...doc, background: { ...background } };
}

export function withArchetype(doc: AdsProAdDocumentV1, archetype: AdsProLayoutArchetype): AdsProAdDocumentV1 {
  return { ...doc, direction: { ...doc.direction, archetype } };
}

export function withIntensity(doc: AdsProAdDocumentV1, intensity: AdsProIntensity): AdsProAdDocumentV1 {
  return { ...doc, direction: { ...doc.direction, intensity } };
}

export function withFormat(doc: AdsProAdDocumentV1, format: AdsProFormat): AdsProAdDocumentV1 {
  return { ...doc, format };
}

export function withPhoto(doc: AdsProAdDocumentV1, patch: Omit<Partial<AdsProPhotoState>, "adjust"> & { readonly adjust?: Partial<AdsProPhotoAdjust> }): AdsProAdDocumentV1 {
  const framing = clampPhotoFraming({
    zoom: patch.zoom ?? doc.photo.zoom,
    offsetX: patch.offsetX ?? doc.photo.offsetX,
    offsetY: patch.offsetY ?? doc.photo.offsetY,
  });
  return {
    ...doc,
    photo: {
      mode: patch.mode ?? doc.photo.mode,
      ...framing,
      adjust: patch.adjust ? clampPhotoAdjust({ ...doc.photo.adjust, ...patch.adjust }) : doc.photo.adjust,
    },
  };
}

/** Texto já normalizado (aparado) e com os campos escondidos zerados: é o que o layout/exportação enxergam. */
export function resolveRenderableText(doc: AdsProAdDocumentV1): AdsProAdText & { readonly hasPrice: boolean } {
  const text: AdsProAdText = {
    headline: normalizeAdText(doc.text.headline, ADS_PRO_TEXT_LIMITS.headline),
    subtitle: doc.show.subtitle ? normalizeAdText(doc.text.subtitle, ADS_PRO_TEXT_LIMITS.subtitle) : "",
    kicker: doc.show.kicker ? normalizeAdText(doc.text.kicker, ADS_PRO_TEXT_LIMITS.kicker) : "",
    priceText: doc.show.price ? normalizeAdText(doc.text.priceText, ADS_PRO_TEXT_LIMITS.priceText) : "",
    oldPriceText: doc.show.price ? normalizeAdText(doc.text.oldPriceText, ADS_PRO_TEXT_LIMITS.oldPriceText) : "",
    badgeText: doc.show.price && doc.show.badge ? normalizeAdText(doc.text.badgeText, ADS_PRO_TEXT_LIMITS.badgeText) : "",
    ctaText: doc.show.cta ? normalizeAdText(doc.text.ctaText, ADS_PRO_TEXT_LIMITS.ctaText) : "",
  };
  return { ...text, hasPrice: text.priceText.length > 0 };
}

/** "price-burst" sem preço não faz sentido: cai deterministicamente para a vitrine. */
export function resolveEffectiveArchetype(doc: AdsProAdDocumentV1): AdsProLayoutArchetype {
  if (doc.direction.archetype === "price-burst" && resolveRenderableText(doc).priceText.length === 0) return "hero-center";
  return doc.direction.archetype;
}

// ---------------------------------------------------------------------------------------------
// (De)serialização estrita — o documento volta do histórico como `unknown`
// ---------------------------------------------------------------------------------------------

export const ADS_PRO_DOCUMENT_MAX_SERIALIZED_LENGTH = 3600;

export function serializeAdsProDocument(doc: AdsProAdDocumentV1): string {
  return JSON.stringify(doc);
}

export type AdsProDocumentParseResult =
  | { readonly ok: true; readonly doc: AdsProAdDocumentV1 }
  | { readonly ok: false; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function readText(source: Record<string, unknown>, key: keyof AdsProAdText): string {
  const value = source[key];
  return typeof value === "string" ? sanitizeAdTextInput(value, ADS_PRO_TEXT_LIMITS[key]) : "";
}

function readBool(source: Record<string, unknown>, key: string, fallback: boolean): boolean {
  return typeof source[key] === "boolean" ? (source[key] as boolean) : fallback;
}

function readNumber(source: Record<string, unknown>, key: string, fallback: number): number {
  return typeof source[key] === "number" && Number.isFinite(source[key]) ? (source[key] as number) : fallback;
}

export function parseAdsProDocument(raw: unknown): AdsProDocumentParseResult {
  let value = raw;
  if (typeof raw === "string") {
    if (raw.length > ADS_PRO_DOCUMENT_MAX_SERIALIZED_LENGTH) return { ok: false, reason: "too-large" };
    try { value = JSON.parse(raw); } catch { return { ok: false, reason: "invalid-json" }; }
  }
  if (!isRecord(value)) return { ok: false, reason: "not-an-object" };
  if (value.v !== ADS_PRO_DOCUMENT_VERSION) return { ok: false, reason: "unsupported-version" };
  if (typeof value.productId !== "string" || value.productId.length === 0 || value.productId.length > 128) return { ok: false, reason: "invalid-product-id" };
  const format = oneOf(value.format, ADS_PRO_FORMATS);
  if (!format) return { ok: false, reason: "invalid-format" };

  const direction = value.direction;
  if (!isRecord(direction)) return { ok: false, reason: "invalid-direction" };
  const style = isMarketingProStyle(direction.style) ? direction.style : null;
  const intent = oneOf(direction.intent, MARKETING_CAMPAIGN_INTENT_IDS);
  const archetype = oneOf(direction.archetype, ADS_PRO_LAYOUT_ARCHETYPES);
  const hierarchy = oneOf(direction.hierarchy, ADS_PRO_HIERARCHIES);
  const spacing = oneOf(direction.spacing, ADS_PRO_SPACINGS);
  const ctaShape = oneOf(direction.ctaShape, ADS_PRO_CTA_SHAPES);
  const decoration = oneOf(direction.decoration, ADS_PRO_DECORATIONS);
  const priceStyle = oneOf(direction.priceStyle, ADS_PRO_PRICE_STYLES);
  const intensity = direction.intensity === 1 || direction.intensity === 2 || direction.intensity === 3 ? direction.intensity : null;
  if (!style || !intent || !archetype || !hierarchy || !spacing || !ctaShape || !decoration || !priceStyle || !intensity) return { ok: false, reason: "invalid-direction" };

  const background = value.background;
  if (!isRecord(background) || typeof background.id !== "string" || !/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(background.id) || background.id.length > 120) return { ok: false, reason: "invalid-background" };
  const source = oneOf(background.source, ["GENERATED_DETERMINISTIC", "STATIC_ASSET"] as const);
  if (!source) return { ok: false, reason: "invalid-background" };

  const photo = isRecord(value.photo) ? value.photo : {};
  const adjust = isRecord(photo.adjust) ? photo.adjust : {};
  const text = isRecord(value.text) ? value.text : {};
  const show = isRecord(value.show) ? value.show : {};
  const brand = isRecord(value.brand) ? value.brand : {};
  const accent = typeof brand.accent === "string" && /^#[0-9a-f]{6}$/i.test(brand.accent) ? brand.accent.toUpperCase() : undefined;

  const doc: AdsProAdDocumentV1 = {
    v: ADS_PRO_DOCUMENT_VERSION,
    productId: value.productId,
    format,
    variationId: typeof value.variationId === "string" ? value.variationId.slice(0, 8) : "A",
    direction: { style, intent, intensity, archetype, hierarchy, spacing, ctaShape, decoration, priceStyle },
    background: {
      id: background.id,
      version: Number.isInteger(background.version) && (background.version as number) > 0 ? (background.version as number) : 1,
      family: typeof background.family === "string" ? background.family.slice(0, 40) : style,
      source,
    },
    photo: {
      mode: photo.mode === "cutout" ? "cutout" : "original",
      ...clampPhotoFraming({ zoom: readNumber(photo, "zoom", 1), offsetX: readNumber(photo, "offsetX", 0), offsetY: readNumber(photo, "offsetY", 0) }),
      adjust: clampPhotoAdjust({
        brightness: readNumber(adjust, "brightness", 0),
        contrast: readNumber(adjust, "contrast", 1),
        saturation: readNumber(adjust, "saturation", 1),
        sharpness: readNumber(adjust, "sharpness", 0),
      }),
    },
    text: {
      headline: readText(text, "headline"),
      subtitle: readText(text, "subtitle"),
      kicker: readText(text, "kicker"),
      priceText: readText(text, "priceText"),
      oldPriceText: readText(text, "oldPriceText"),
      badgeText: readText(text, "badgeText"),
      ctaText: readText(text, "ctaText"),
    },
    show: {
      kicker: readBool(show, "kicker", true),
      subtitle: readBool(show, "subtitle", true),
      price: readBool(show, "price", true),
      badge: readBool(show, "badge", true),
      cta: readBool(show, "cta", true),
      logo: readBool(show, "logo", true),
    },
    brand: { storeName: normalizeAdText(typeof brand.storeName === "string" ? brand.storeName : "", ADS_PRO_TEXT_LIMITS.storeName) || "Minha loja", ...(accent ? { accent } : {}) },
  };
  if (serializeAdsProDocument(doc).length > ADS_PRO_DOCUMENT_MAX_SERIALIZED_LENGTH) return { ok: false, reason: "too-large" };
  return { ok: true, doc };
}
