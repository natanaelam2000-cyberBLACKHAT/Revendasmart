/**
 * ADS-PRO-FINAL — motor de layout DETERMINÍSTICO do anúncio (documento -> geometria + textos ajustados).
 *
 * Entrada: `AdsProAdDocumentV1` + medidor de texto + cores do cenário. Saída: tudo que o renderizador precisa
 * desenhar (retângulos, linhas de texto já quebradas, cores, formas) e a lista de problemas (`issues`).
 * Não desenha nada e não usa DOM: roda em Node para prova e no navegador para preview/exportação —
 * a MESMA função, então preview e PNG exportado nunca divergem.
 *
 * Garantias por construção (provadas em `script/ads-pro-layout-tests.ts` sobre centenas de combinações):
 *  - todo texto, produto e CTA fica dentro da área segura;
 *  - nome, preço, selo, loja e produto ficam dentro do recorte central quadrado do 4:5 (grade do Instagram),
 *    mesma geometria do ADS-PRO-04 (`resolveMarketingProEssentialContentBounds`);
 *  - nenhum texto invade o produto nem outro texto;
 *  - tinta clara/escura escolhida pelo contraste REAL do cenário; scrim quando o contraste não basta.
 */
import {
  MIN_TEXT_CONTRAST,
  contrastRatio,
  ensureReadableAccent,
  mixColors,
  readableOn,
  resolveInkForBackdrop,
  type AdInkResolution,
} from "./ad-contrast";
import {
  getAdsProCanvasSize,
  resolveEffectiveArchetype,
  resolveRenderableText,
  type AdsProAdDocumentV1,
  type AdsProFormat,
} from "./ad-document";
import { fitText, type FittedText, type FontSpec, type TextMeasurer } from "./ad-text-fit";
import {
  ADS_PRO_INTENSITY_SCALE,
  ADS_PRO_STYLE_RECIPES,
  type AdsProCtaShape,
  type AdsProLayoutArchetype,
  type AdsProPriceStyle,
  type AdsProTypography,
} from "./ad-style-direction";

export interface Rect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

export type TextAlign = "left" | "center" | "right";

export interface PlacedText {
  readonly rect: Rect;
  /** x da âncora de alinhamento (borda esquerda, centro ou borda direita). */
  readonly anchorX: number;
  readonly align: TextAlign;
  readonly lines: readonly string[];
  readonly font: FontSpec;
  readonly lineHeightPx: number;
  readonly color: string;
  readonly strike?: boolean;
  readonly truncated: boolean;
}

export interface PlateShape {
  readonly kind: "pill" | "rect" | "ellipse";
  readonly rect: Rect;
  readonly radius: number;
  readonly fill: string;
}

export interface PricePlacement {
  readonly rect: Rect;
  readonly style: AdsProPriceStyle;
  readonly main: PlacedText;
  readonly old?: PlacedText;
  readonly badge?: { readonly text: PlacedText; readonly plate: PlateShape };
  readonly plate?: PlateShape;
  readonly underline?: Rect;
  readonly underlineColor?: string;
}

export interface CtaPlacement {
  readonly rect: Rect;
  readonly shape: AdsProCtaShape;
  readonly radius: number;
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth: number;
  readonly label: PlacedText;
  readonly underline?: Rect;
}

export type DecorationShape =
  | { readonly kind: "rect"; readonly rect: Rect; readonly fill: string; readonly radius: number }
  | { readonly kind: "circle"; readonly cx: number; readonly cy: number; readonly r: number; readonly fill?: string; readonly stroke?: string; readonly strokeWidth: number }
  | { readonly kind: "frame"; readonly rect: Rect; readonly stroke: string; readonly strokeWidth: number }
  | { readonly kind: "triangle"; readonly points: readonly (readonly [number, number])[]; readonly fill: string };

export type AdLayoutIssueCode =
  | "OUT_OF_SAFE_AREA"
  | "OUT_OF_ESSENTIAL_AREA"
  | "OVERLAP"
  | "TEXT_TOO_SMALL"
  | "LOW_CONTRAST"
  | "PRODUCT_TOO_SMALL"
  | "TEXT_OVERFLOW";

export interface AdLayoutIssue {
  readonly code: AdLayoutIssueCode;
  readonly target: string;
  readonly detail: string;
}

export interface AdLayout {
  readonly canvas: { readonly width: number; readonly height: number };
  readonly format: AdsProFormat;
  readonly archetype: AdsProLayoutArchetype;
  readonly safe: Rect;
  /** Conteúdo essencial (nome, preço, selo, loja, produto): recorte central quadrado do 4:5, ∩ área segura. */
  readonly essential: Rect;
  readonly ink: AdInkResolution;
  readonly accent: string;
  readonly onAccent: string;
  readonly product: { readonly rect: Rect; readonly presentation: "card" | "float"; readonly radius: number };
  readonly kicker?: PlacedText;
  readonly headline?: PlacedText;
  readonly subtitle?: PlacedText;
  readonly price?: PricePlacement;
  readonly cta?: CtaPlacement;
  readonly store?: PlacedText;
  readonly logo?: Rect;
  readonly band?: { readonly rect: Rect; readonly fill: string; readonly text: string; readonly radius: number };
  readonly scrims: readonly Rect[];
  readonly scrimColor: string;
  readonly decorations: readonly DecorationShape[];
  readonly issues: readonly AdLayoutIssue[];
  /** Fator de redução de texto aplicado para o produto caber com folga (1 = nenhum). */
  readonly textScale: number;
}

export interface AdLayoutInput {
  readonly doc: AdsProAdDocumentV1;
  readonly measure: TextMeasurer;
  readonly backdrop: { readonly colors: readonly string[]; readonly forceScrim?: boolean };
  readonly hasLogo: boolean;
}

// ---------------------------------------------------------------------------------------------
// Geometria utilitária
// ---------------------------------------------------------------------------------------------

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const bottomOf = (r: Rect): number => r.y + r.h;
const rightOf = (r: Rect): number => r.x + r.w;

export function rectsIntersect(a: Rect, b: Rect, margin = 0): boolean {
  return !(rightOf(a) <= b.x + margin || rightOf(b) <= a.x + margin || bottomOf(a) <= b.y + margin || bottomOf(b) <= a.y + margin);
}

export function rectContains(outer: Rect, inner: Rect, tolerance = 0.75): boolean {
  return inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance
    && rightOf(inner) <= rightOf(outer) + tolerance && bottomOf(inner) <= bottomOf(outer) + tolerance;
}

function unionOf(...rects: readonly (Rect | undefined)[]): Rect | undefined {
  const present = rects.filter((r): r is Rect => Boolean(r));
  if (present.length === 0) return undefined;
  const x = Math.min(...present.map((r) => r.x));
  const y = Math.min(...present.map((r) => r.y));
  return rect(x, y, Math.max(...present.map(rightOf)) - x, Math.max(...present.map(bottomOf)) - y);
}

function pad(r: Rect, amount: number): Rect {
  return rect(r.x - amount, r.y - amount, r.w + amount * 2, r.h + amount * 2);
}

function shift(block: PlacedText | undefined, dy: number): PlacedText | undefined {
  return block ? { ...block, rect: { ...block.rect, y: block.rect.y + dy } } : undefined;
}

// ---------------------------------------------------------------------------------------------
// Tokens numéricos (px de design, largura 1080)
// ---------------------------------------------------------------------------------------------

const SPACING_TOKENS = {
  airy: { margin: 78, gap: 22 },
  standard: { margin: 68, gap: 18 },
  compact: { margin: 58, gap: 14 },
} as const;

const CTA_HEIGHT = { sm: 60, md: 72, lg: 84 } as const;
const HIERARCHY_SCALE = {
  "product-first": { headline: 0.94, price: 0.94 },
  "name-first": { headline: 1.08, price: 0.96 },
  "price-first": { headline: 0.92, price: 1.18 },
} as const;

/** Mínimos de legibilidade (px de design). Abaixo disso o validador acusa TEXT_TOO_SMALL. */
export const AD_MIN_FONT_PX = Object.freeze({ headline: 34, subtitle: 22, kicker: 18, price: 44, oldPrice: 20, badge: 20, cta: 24, store: 18 });

/** Recorte central quadrado do 4:5 (grade do perfil): 135..1215 em 1350 — mesma geometria do ADS-PRO-04. */
function essentialBounds(format: AdsProFormat, safe: Rect, height: number, width: number): Rect {
  if (format !== "portrait") return safe;
  const cropTop = Math.max(0, (height - width) / 2);
  const top = Math.max(safe.y, cropTop + 15);
  const bottom = Math.min(bottomOf(safe), height - cropTop - 15);
  return rect(safe.x, top, safe.w, bottom - top);
}

interface Palette {
  /** preenchimento de botões/selos cheios */
  readonly fill: string;
  /** texto sobre `fill` */
  readonly onFill: string;
  /** texto/traço sobre a superfície onde o elemento fica */
  readonly ink: string;
  readonly muted: string;
  /** botão "fantasma" translúcido sobre a superfície */
  readonly ghost: string;
}

interface Ctx {
  readonly W: number;
  readonly H: number;
  readonly format: AdsProFormat;
  readonly m: number;
  readonly gap: number;
  readonly safe: Rect;
  readonly ess: Rect;
  readonly ctaH: number;
  readonly hasCta: boolean;
  readonly hasLogo: boolean;
  readonly textScale: number;
  readonly measure: TextMeasurer;
  readonly ink: AdInkResolution;
  readonly accent: string;
  readonly onAccent: string;
  readonly doc: AdsProAdDocumentV1;
  readonly text: ReturnType<typeof resolveRenderableText>;
  readonly typo: AdsProTypography;
  readonly scale: { readonly headline: number; readonly price: number; readonly decoration: number; readonly cta: number };
  readonly photoCutout: boolean;
  /** paleta sobre o cenário (padrão) */
  readonly onBackdrop: Palette;
}

function headlinePx(ctx: Ctx, extra = 1): number {
  const base = ctx.format === "portrait" ? 66 : 62;
  return base * ctx.typo.headlineScale * ctx.scale.headline * HIERARCHY_SCALE[ctx.doc.direction.hierarchy].headline * ctx.textScale * extra;
}

function pricePx(ctx: Ctx, extra = 1): number {
  const base = ctx.format === "portrait" ? 92 : 84;
  return base * ctx.typo.priceScale * ctx.scale.price * HIERARCHY_SCALE[ctx.doc.direction.hierarchy].price * ctx.textScale * extra;
}

const font = (kind: FontSpec["kind"], weight: number, px: number, opts: Partial<Pick<FontSpec, "italic" | "uppercase" | "trackingEm">> = {}): FontSpec => ({
  kind, weight, px, italic: opts.italic ?? false, uppercase: opts.uppercase ?? false, trackingEm: opts.trackingEm ?? 0,
});

function place(fitted: FittedText, f: FontSpec, x: number, y: number, align: TextAlign, color: string, extra: { strike?: boolean } = {}): PlacedText {
  const left = align === "left" ? x : align === "center" ? x - fitted.width / 2 : x - fitted.width;
  return {
    rect: rect(left, y, fitted.width, fitted.height),
    anchorX: x,
    align,
    lines: fitted.lines,
    font: { ...f, px: fitted.px },
    lineHeightPx: fitted.lineHeightPx,
    color,
    truncated: fitted.truncated,
    ...(extra.strike ? { strike: true } : {}),
  };
}

function anchorOf(box: Rect, align: TextAlign): number {
  return align === "left" ? box.x : align === "center" ? box.x + box.w / 2 : rightOf(box);
}

function fit(ctx: Ctx, text: string, f: FontSpec, maxWidth: number, maxLines: number, minPx: number, lineHeight: number): FittedText {
  return fitText(text, f, { maxWidth, maxLines, minPx, lineHeight }, ctx.measure);
}

// ---------------------------------------------------------------------------------------------
// Blocos reutilizáveis (todos posicionados em y absoluto; empilhamento de baixo para cima usa `shift`)
// ---------------------------------------------------------------------------------------------

function buildKicker(ctx: Ctx, box: Rect, y: number, align: TextAlign, color: string): PlacedText | undefined {
  if (!ctx.text.kicker) return undefined;
  const f = font("sans", 700, 24 * ctx.textScale, { uppercase: true, trackingEm: ctx.typo.kickerTracking });
  return place(fit(ctx, ctx.text.kicker, f, box.w, 1, AD_MIN_FONT_PX.kicker, 1.2), f, anchorOf(box, align), y, align, color);
}

function buildHeadline(ctx: Ctx, box: Rect, y: number, align: TextAlign, color: string, maxLines: number, extraScale = 1): PlacedText | undefined {
  if (!ctx.text.headline) return undefined;
  const t = ctx.typo;
  const f = font(t.headlineFont, t.headlineWeight, headlinePx(ctx, extraScale), { italic: t.headlineItalic, uppercase: t.headlineUppercase, trackingEm: t.headlineTracking });
  return place(fit(ctx, ctx.text.headline, f, box.w, maxLines, AD_MIN_FONT_PX.headline, 1.1), f, anchorOf(box, align), y, align, color);
}

function buildSubtitle(ctx: Ctx, box: Rect, y: number, align: TextAlign, color: string, maxLines: number): PlacedText | undefined {
  if (!ctx.text.subtitle) return undefined;
  const f = font("sans", 500, 30 * ctx.textScale, { italic: ctx.typo.subtitleItalic });
  return place(fit(ctx, ctx.text.subtitle, f, box.w, maxLines, AD_MIN_FONT_PX.subtitle, 1.25), f, anchorOf(box, align), y, align, color);
}

function buildStore(ctx: Ctx, box: Rect, y: number, align: TextAlign): PlacedText {
  const f = font("sans", 700, 22, { uppercase: true, trackingEm: 0.12 });
  return place(fit(ctx, ctx.doc.brand.storeName || "Minha loja", f, box.w, 1, AD_MIN_FONT_PX.store, 1.2), f, anchorOf(box, align), y, align, ctx.ink.muted);
}

interface PriceOptions {
  readonly maxWidth: number;
  readonly align: TextAlign;
  readonly anchorX: number;
  /** A base do bloco termina exatamente aqui (o bloco cresce para cima). */
  readonly bottom: number;
  readonly style: AdsProPriceStyle;
  readonly palette: Palette;
}

/**
 * Mede o bloco de preço e o posiciona com a base em `options.bottom`. Composição: uma linha opcional acima
 * (preço antigo riscado + selo de desconto) e o preço em destaque. O selo vai ao lado do preço quando cabe;
 * senão divide a linha de cima com o preço antigo — o bloco fica sempre compacto.
 */
function buildPrice(ctx: Ctx, options: PriceOptions): PricePlacement | undefined {
  if (!ctx.text.priceText) return undefined;
  const t = ctx.typo;
  const { palette } = options;
  const style = options.style === "burst" ? "stamp" : options.style;
  const hasPlate = style === "badge" || style === "stamp";
  const padX = style === "badge" ? 30 : 26;
  const padY = style === "badge" ? 14 : 12;

  const mainFont = font(t.priceFont, t.priceWeight, pricePx(ctx));
  const mainFit = fit(ctx, ctx.text.priceText, mainFont, options.maxWidth - (hasPlate ? padX * 2 : 0), 1, AD_MIN_FONT_PX.price, 1.05);
  const plateW = hasPlate ? mainFit.width + padX * 2 : mainFit.width;
  const plateH = hasPlate ? mainFit.height + padY * 2 : mainFit.height;
  const underlineH = style === "underline" ? 8 : 0;
  const underlineGap = style === "underline" ? 6 : 0;

  const oldFont = font("sans", 500, 30 * ctx.textScale);
  const oldFit = ctx.text.oldPriceText ? fit(ctx, ctx.text.oldPriceText, oldFont, options.maxWidth, 1, AD_MIN_FONT_PX.oldPrice, 1.1) : undefined;
  const badgeFont = font("sans", 800, 26 * ctx.textScale, { uppercase: true, trackingEm: 0.04 });
  const badgeFit = ctx.text.badgeText ? fit(ctx, ctx.text.badgeText, badgeFont, options.maxWidth * 0.5, 1, AD_MIN_FONT_PX.badge, 1.1) : undefined;
  const bw = badgeFit ? badgeFit.width + 36 : 0;
  const bh = badgeFit ? badgeFit.height + 16 : 0;
  const rowGap = 16;

  const beside = Boolean(badgeFit) && options.align !== "center" && plateW + 14 + bw <= options.maxWidth;
  const row1Badge = Boolean(badgeFit) && !beside;
  const oldW = oldFit?.width ?? 0;
  const sideBySide = row1Badge && oldFit ? oldW + rowGap + bw <= options.maxWidth : true;
  const row1Items = [oldFit ? "old" : "", row1Badge ? "badge" : ""].filter(Boolean);
  const row1H = row1Items.length === 0 ? 0
    : sideBySide ? Math.max(oldFit?.height ?? 0, row1Badge ? bh : 0)
    : (oldFit?.height ?? 0) + 8 + bh;
  const row1W = row1Items.length === 0 ? 0
    : sideBySide ? oldW + (oldFit && row1Badge ? rowGap : 0) + (row1Badge ? bw : 0)
    : Math.max(oldW, bw);
  const rowToMain = row1H > 0 ? 8 : 0;

  const blockW = Math.max(plateW, row1W, beside ? plateW + 14 + bw : 0);
  const blockH = row1H + rowToMain + plateH + underlineGap + underlineH;
  const top = options.bottom - blockH;
  const leftOf = (width: number) => options.align === "left" ? options.anchorX : options.align === "center" ? options.anchorX - width / 2 : options.anchorX - width;

  const blockLeft = leftOf(blockW);
  const mainRowW = beside ? plateW + 14 + bw : plateW;
  const mainRowLeft = options.align === "left" ? blockLeft : options.align === "center" ? blockLeft + (blockW - mainRowW) / 2 : blockLeft + blockW - mainRowW;
  const plateLeft = beside && options.align === "right" ? mainRowLeft + bw + 14 : mainRowLeft;
  const plateRect = rect(plateLeft, top + row1H + rowToMain, plateW, plateH);
  const main = place(mainFit, mainFont, hasPlate ? plateRect.x + padX : plateRect.x, plateRect.y + (hasPlate ? padY : 0), "left", hasPlate ? palette.onFill : palette.ink);
  const plate: PlateShape | undefined = hasPlate
    ? { kind: style === "badge" ? "pill" : "rect", rect: plateRect, radius: style === "badge" ? plateH / 2 : 10, fill: palette.fill }
    : undefined;
  const underline = style === "underline" ? rect(plateRect.x, bottomOf(plateRect) + underlineGap, plateRect.w, underlineH) : undefined;

  // Selo sobre uma placa de mesma cor ficaria invisível: inverte quando o preço já é uma placa cheia.
  const invert = hasPlate;
  const badgeFill = invert ? palette.onFill : palette.fill;
  const badgeInk = invert ? palette.fill : palette.onFill;
  const makeBadge = (bx: number, by: number): PricePlacement["badge"] => badgeFit
    ? { plate: { kind: "pill", rect: rect(bx, by, bw, bh), radius: bh / 2, fill: badgeFill }, text: place(badgeFit, badgeFont, bx + 18, by + 8, "left", badgeInk) }
    : undefined;

  let old: PlacedText | undefined;
  let badge: PricePlacement["badge"];
  if (beside) {
    const bx = options.align === "right" ? mainRowLeft : mainRowLeft + plateW + 14;
    badge = makeBadge(bx, plateRect.y + (plateRect.h - bh) / 2);
  }
  if (row1H > 0) {
    const row1Left = options.align === "left" ? blockLeft : options.align === "center" ? blockLeft + (blockW - row1W) / 2 : blockLeft + blockW - row1W;
    if (sideBySide) {
      let cursor = row1Left;
      if (oldFit) {
        old = place(oldFit, oldFont, cursor, top + (row1H - oldFit.height) / 2, "left", palette.muted, { strike: true });
        cursor += oldW + rowGap;
      }
      if (row1Badge) badge = makeBadge(cursor, top + (row1H - bh) / 2);
    } else {
      if (oldFit) old = place(oldFit, oldFont, row1Left, top, "left", palette.muted, { strike: true });
      if (row1Badge) badge = makeBadge(row1Left, top + (oldFit?.height ?? 0) + 8);
    }
  }

  return {
    rect: unionOf(old?.rect, plate?.rect ?? main.rect, underline, badge?.plate.rect) as Rect,
    style,
    main,
    ...(old ? { old } : {}),
    ...(badge ? { badge } : {}),
    ...(plate ? { plate } : {}),
    ...(underline ? { underline, underlineColor: palette.fill } : {}),
  };
}

interface CtaOptions {
  readonly maxWidth: number;
  readonly align: TextAlign;
  readonly anchorX: number;
  readonly y: number;
  readonly forceBar?: boolean;
  readonly palette: Palette;
}

function buildCta(ctx: Ctx, options: CtaOptions): CtaPlacement | undefined {
  if (!ctx.text.ctaText) return undefined;
  const { palette } = options;
  const shape: AdsProCtaShape = options.forceBar ? "bar" : ctx.doc.direction.ctaShape;
  const upper = ADS_PRO_STYLE_RECIPES[ctx.doc.direction.style].cta.uppercase;
  const h = ctx.ctaH;
  const label = shape === "link" ? `${ctx.text.ctaText} →` : ctx.text.ctaText;
  const f = font("sans", shape === "outline" || shape === "link" ? 700 : 800, 32 * ctx.scale.cta * ctx.textScale, { uppercase: upper, trackingEm: upper ? 0.08 : 0.01 });
  const padX = shape === "bar" ? 28 : 38;
  const fitted = fit(ctx, label, f, options.maxWidth - padX * 2, 1, AD_MIN_FONT_PX.cta, 1);
  const w = shape === "bar" ? options.maxWidth : shape === "link" ? fitted.width : Math.min(options.maxWidth, Math.max(fitted.width + padX * 2, h * 2.4));
  const x = shape === "bar"
    ? options.anchorX - (options.align === "left" ? 0 : options.align === "center" ? options.maxWidth / 2 : options.maxWidth)
    : options.align === "left" ? options.anchorX : options.align === "center" ? options.anchorX - w / 2 : options.anchorX - w;
  const box = rect(x, options.y, w, shape === "link" ? fitted.height + 10 : h);
  const filled = shape === "pill" || shape === "bar";
  const textColor = filled ? palette.onFill : palette.ink;
  const text = place(fitted, f, shape === "link" ? box.x : box.x + w / 2, shape === "link" ? box.y : box.y + (h - fitted.height) / 2, shape === "link" ? "left" : "center", textColor);
  return {
    rect: box,
    shape,
    radius: shape === "outline" ? 8 : shape === "bar" ? 16 : h / 2,
    ...(filled ? { fill: palette.fill } : shape === "soft" ? { fill: palette.ghost } : {}),
    ...(shape === "outline" ? { stroke: palette.ink } : {}),
    strokeWidth: shape === "outline" ? 3 : 0,
    label: text,
    ...(shape === "link" ? { underline: rect(box.x, box.y + fitted.height + 4, fitted.width, 3) } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Arquétipos
// ---------------------------------------------------------------------------------------------

interface ArchetypeResult {
  readonly product: Rect;
  readonly store?: PlacedText;
  readonly logo?: Rect;
  readonly kicker?: PlacedText;
  readonly headline?: PlacedText;
  readonly subtitle?: PlacedText;
  readonly price?: PricePlacement;
  readonly cta?: CtaPlacement;
  readonly band?: AdLayout["band"];
  readonly textGroups: readonly Rect[];
  readonly decorationAnchor: { readonly align: TextAlign; readonly headlineTop: number };
}

function ctaTopOf(ctx: Ctx): number {
  return ctx.H - ctx.m - ctx.ctaH;
}

/** Base do conteúdo essencial: acima do CTA (quando existe) e dentro do recorte central no 4:5. */
function essentialBottom(ctx: Ctx): number {
  const limit = bottomOf(ctx.ess);
  if (!ctx.hasCta) return limit;
  return Math.min(limit, ctaTopOf(ctx) - (ctx.format === "portrait" ? ctx.gap : ctx.gap * 1.6));
}

function logoRect(ctx: Ctx, y: number): Rect | undefined {
  if (!ctx.hasLogo || !ctx.doc.show.logo) return undefined;
  return rect(rightOf(ctx.safe) - 56, y - 10, 56, 56);
}

function groups(...rects: readonly (Rect | undefined)[]): Rect[] {
  const merged = unionOf(...rects);
  return merged ? [merged] : [];
}

function heroCenter(ctx: Ctx): ArchetypeResult {
  const { safe, gap } = ctx;
  const cx = safe.x + safe.w / 2;
  let y = ctx.ess.y;
  const logo = logoRect(ctx, y);
  const store = buildStore(ctx, rect(safe.x + (logo ? 70 : 0), y, safe.w - (logo ? 140 : 0), 36), y, "center");
  y += 36 + gap;

  const textBox = rect(safe.x + safe.w * 0.04, 0, safe.w * 0.92, 0);
  const kicker = buildKicker(ctx, textBox, y, "center", ctx.onBackdrop.muted);
  if (kicker) y += kicker.rect.h + gap * 0.5;
  const headline = buildHeadline(ctx, textBox, y, "center", ctx.onBackdrop.ink, 2);
  if (headline) y += headline.rect.h + gap * 0.5;
  const subtitle = buildSubtitle(ctx, rect(safe.x + safe.w * 0.08, 0, safe.w * 0.84, 0), y, "center", ctx.onBackdrop.muted, 1);
  if (subtitle) y += subtitle.rect.h;

  const bottom = essentialBottom(ctx);
  const price = buildPrice(ctx, { maxWidth: safe.w * 0.9, align: "center", anchorX: cx, bottom, style: ctx.doc.direction.priceStyle, palette: ctx.onBackdrop });
  const productTop = y + gap * 1.2;
  const productBottom = (price ? price.rect.y : bottom) - gap * 1.2;
  return {
    product: rect(safe.x + safe.w * 0.05, productTop, safe.w * 0.9, Math.max(0, productBottom - productTop)),
    store, logo, kicker, headline, subtitle, price,
    cta: buildCta(ctx, { maxWidth: safe.w * 0.8, align: "center", anchorX: cx, y: ctaTopOf(ctx), palette: ctx.onBackdrop }),
    textGroups: [...groups(kicker?.rect, headline?.rect, subtitle?.rect), ...groups(price?.rect)],
    decorationAnchor: { align: "center", headlineTop: kicker?.rect.y ?? headline?.rect.y ?? ctx.ess.y },
  };
}

function splitSide(ctx: Ctx): ArchetypeResult {
  const { safe, gap } = ctx;
  const colGap = 28;
  const leftW = Math.round(safe.w * 0.47);
  const rightX = safe.x + leftW + colGap;
  let y = ctx.ess.y;
  const logo = logoRect(ctx, y);
  const store = buildStore(ctx, rect(safe.x, y, leftW, 36), y, "left");
  const columnTop = y + 36 + gap * 1.4;
  y = columnTop;

  const leftBox = rect(safe.x, 0, leftW, 0);
  const kicker = buildKicker(ctx, leftBox, y, "left", ctx.onBackdrop.muted);
  if (kicker) y += kicker.rect.h + gap * 0.5;
  const headline = buildHeadline(ctx, leftBox, y, "left", ctx.onBackdrop.ink, 4);
  if (headline) y += headline.rect.h + gap * 0.6;
  const subtitle = buildSubtitle(ctx, leftBox, y, "left", ctx.onBackdrop.muted, 3);

  const bottom = essentialBottom(ctx);
  const price = buildPrice(ctx, { maxWidth: leftW, align: "left", anchorX: safe.x, bottom, style: ctx.doc.direction.priceStyle, palette: ctx.onBackdrop });
  const productBottom = ctx.format === "portrait" ? bottomOf(ctx.ess) : bottomOf(safe);
  return {
    product: rect(rightX, columnTop, rightOf(safe) - rightX, Math.max(0, productBottom - columnTop)),
    store, logo, kicker, headline, subtitle, price,
    cta: buildCta(ctx, { maxWidth: leftW, align: "left", anchorX: safe.x, y: ctaTopOf(ctx), palette: ctx.onBackdrop }),
    textGroups: [...groups(kicker?.rect, headline?.rect, subtitle?.rect), ...groups(price?.rect)],
    decorationAnchor: { align: "left", headlineTop: kicker?.rect.y ?? headline?.rect.y ?? ctx.ess.y },
  };
}

function posterTop(ctx: Ctx): ArchetypeResult {
  const { safe, gap } = ctx;
  let y = ctx.ess.y;
  const logo = logoRect(ctx, y);
  const store = buildStore(ctx, rect(safe.x, y, safe.w - (logo ? 70 : 0), 36), y, "left");
  y += 36 + gap;

  const kicker = buildKicker(ctx, rect(safe.x, 0, safe.w, 0), y, "left", ctx.onBackdrop.muted);
  if (kicker) y += kicker.rect.h + gap * 0.5;
  const headline = buildHeadline(ctx, rect(safe.x, 0, safe.w, 0), y, "left", ctx.onBackdrop.ink, ctx.format === "portrait" ? 3 : 2, 1.18);
  if (headline) y += headline.rect.h + gap * 0.5;
  const subtitle = buildSubtitle(ctx, rect(safe.x, 0, safe.w * 0.8, 0), y, "left", ctx.onBackdrop.muted, 2);
  if (subtitle) y += subtitle.rect.h;

  const bottom = essentialBottom(ctx);
  const price = buildPrice(ctx, { maxWidth: safe.w * 0.62, align: "right", anchorX: rightOf(safe), bottom, style: ctx.doc.direction.priceStyle, palette: ctx.onBackdrop });
  const productTop = y + gap;
  const productBottom = (price ? price.rect.y : bottom) - gap;
  return {
    product: rect(safe.x + safe.w * 0.14, productTop, safe.w * 0.86, Math.max(0, productBottom - productTop)),
    store, logo, kicker, headline, subtitle, price,
    cta: buildCta(ctx, { maxWidth: safe.w * 0.56, align: "left", anchorX: safe.x, y: ctaTopOf(ctx), palette: ctx.onBackdrop }),
    textGroups: [...groups(kicker?.rect, headline?.rect, subtitle?.rect), ...groups(price?.rect)],
    decorationAnchor: { align: "left", headlineTop: kicker?.rect.y ?? headline?.rect.y ?? ctx.ess.y },
  };
}

function bandBottom(ctx: Ctx): ArchetypeResult {
  const { safe, gap } = ctx;
  const neutral = ctx.doc.direction.intensity === 1;
  const fill = neutral ? (ctx.ink.backdrop === "dark" ? "#0B0F14" : "#FFFFFF") : ctx.accent;
  const text = neutral ? readableOn(fill) : ctx.onAccent;
  const muted = neutral ? (text === "#111827" ? "#4B5563" : "#D1D5DB") : mixColors(text, fill, 0.16);
  // Sobre a faixa, o "preenchimento" dos botões/selos é o inverso da faixa (nunca igual a ela).
  const palette: Palette = { fill: text, onFill: fill, ink: text, muted, ghost: text === "#FFFFFF" ? "rgba(255,255,255,0.18)" : "rgba(17,24,39,0.10)" };

  let y = ctx.ess.y;
  const logo = logoRect(ctx, y);
  const store = buildStore(ctx, rect(safe.x, y, safe.w - (logo ? 70 : 0), 36), y, "left");
  y += 36 + gap;
  const topEnd = y;

  const leftW = Math.round(safe.w * 0.56);
  const rightW = safe.w - leftW - 24;
  const bottom = essentialBottom(ctx);
  const price = buildPrice(ctx, { maxWidth: rightW, align: "right", anchorX: rightOf(safe), bottom, style: ctx.doc.direction.priceStyle === "underline" ? "underline" : "plain", palette });

  // Grupo de texto: construído a partir de y=0 e depois deslocado para terminar em `bottom`.
  const leftBox = rect(safe.x, 0, leftW, 0);
  let gy = 0;
  const kicker0 = buildKicker(ctx, leftBox, gy, "left", palette.muted);
  if (kicker0) gy += kicker0.rect.h + gap * 0.4;
  const headline0 = buildHeadline(ctx, leftBox, gy, "left", palette.ink, 3, 0.92);
  if (headline0) gy += headline0.rect.h + gap * 0.4;
  const subtitle0 = buildSubtitle(ctx, leftBox, gy, "left", palette.muted, 2);
  if (subtitle0) gy += subtitle0.rect.h;
  const groupH = gy > 0 && !subtitle0 ? gy - gap * 0.4 : gy;
  const dy = bottom - groupH;
  const kicker = shift(kicker0, dy);
  const headline = shift(headline0, dy);
  const subtitle = shift(subtitle0, dy);

  const contentTop = Math.min(dy, price?.rect.y ?? dy);
  const bandTop = contentTop - gap * 1.6;
  return {
    product: rect(safe.x + safe.w * 0.04, topEnd, safe.w * 0.92, Math.max(0, bandTop - gap - topEnd)),
    store, logo, kicker, headline, subtitle, price,
    cta: buildCta(ctx, { maxWidth: safe.w, align: "left", anchorX: safe.x, y: ctaTopOf(ctx), palette }),
    band: { rect: rect(0, bandTop, ctx.W, ctx.H - bandTop), fill, text, radius: 40 },
    textGroups: [],
    decorationAnchor: { align: "left", headlineTop: bandTop },
  };
}

function priceBurst(ctx: Ctx): ArchetypeResult {
  const { safe, gap } = ctx;
  let y = ctx.ess.y;
  const logo = logoRect(ctx, y);
  const store = buildStore(ctx, rect(safe.x, y, safe.w - (logo ? 70 : 0), 36), y, "left");
  y += 36 + gap;
  const textBox = rect(safe.x, 0, safe.w * 0.68, 0);
  const kicker = buildKicker(ctx, textBox, y, "left", ctx.onBackdrop.muted);
  if (kicker) y += kicker.rect.h + gap * 0.5;
  const headline = buildHeadline(ctx, textBox, y, "left", ctx.onBackdrop.ink, 2);
  if (headline) y += headline.rect.h + gap * 0.5;
  const subtitle = buildSubtitle(ctx, textBox, y, "left", ctx.onBackdrop.muted, 1);
  if (subtitle) y += subtitle.rect.h;

  const bottom = essentialBottom(ctx);
  const productTop = y + gap;
  const product = rect(safe.x, productTop, safe.w, Math.max(0, bottom - productTop));

  // Selo grande de preço sobre o canto superior direito do produto (sobreposição intencional). Elipse mais
  // larga que alta: comporta preços longos ("R$ 1.299,90") sem reduzir a fonte abaixo do mínimo legível.
  const bw = Math.min(safe.w * 0.5, 440);
  const bh = Math.min(bw * 0.8, product.h * 0.7);
  const cx = rightOf(safe) - bw / 2;
  const cy = Math.min(product.y + bh / 2 + 6, bottom - bh / 2);
  const burstRect = rect(cx - bw / 2, cy - bh / 2, bw, bh);
  const inner = bw * 0.76;
  const mainFont = font(ctx.typo.priceFont, ctx.typo.priceWeight, pricePx(ctx, 0.85));
  const mainFit = fit(ctx, ctx.text.priceText, mainFont, inner, 1, AD_MIN_FONT_PX.price, 1.05);
  const oldFont = font("sans", 700, 26 * ctx.textScale);
  const oldFit = ctx.text.oldPriceText ? fit(ctx, ctx.text.oldPriceText, oldFont, inner, 1, AD_MIN_FONT_PX.oldPrice, 1.1) : undefined;
  const badgeFont = font("sans", 800, 28 * ctx.textScale, { uppercase: true, trackingEm: 0.04 });
  const badgeFit = ctx.text.badgeText ? fit(ctx, ctx.text.badgeText, badgeFont, inner, 1, AD_MIN_FONT_PX.badge, 1.1) : undefined;
  const stackH = (oldFit ? oldFit.height + 4 : 0) + mainFit.height + (badgeFit ? badgeFit.height + 4 : 0);
  let sy = cy - stackH / 2;
  const old = oldFit ? place(oldFit, oldFont, cx, sy, "center", ctx.onAccent, { strike: true }) : undefined;
  if (oldFit) sy += oldFit.height + 4;
  const main = place(mainFit, mainFont, cx, sy, "center", ctx.onAccent);
  sy += mainFit.height + 4;
  const badgeText = badgeFit ? place(badgeFit, badgeFont, cx, sy, "center", ctx.onAccent) : undefined;
  const price: PricePlacement = {
    rect: burstRect,
    style: "burst",
    main,
    ...(old ? { old } : {}),
    ...(badgeText ? { badge: { text: badgeText, plate: { kind: "pill" as const, rect: badgeText.rect, radius: 0, fill: "rgba(0,0,0,0)" } } } : {}),
    plate: { kind: "ellipse", rect: burstRect, radius: bh / 2, fill: ctx.accent },
  };
  return {
    product,
    store, logo, kicker, headline, subtitle, price,
    cta: buildCta(ctx, { maxWidth: safe.w, align: "left", anchorX: safe.x, y: ctaTopOf(ctx), forceBar: true, palette: ctx.onBackdrop }),
    textGroups: groups(kicker?.rect, headline?.rect, subtitle?.rect),
    decorationAnchor: { align: "left", headlineTop: kicker?.rect.y ?? headline?.rect.y ?? ctx.ess.y },
  };
}

const ARCHETYPE_BUILDERS: Readonly<Record<AdsProLayoutArchetype, (ctx: Ctx) => ArchetypeResult>> = {
  "hero-center": heroCenter,
  "split-side": splitSide,
  "poster-top": posterTop,
  "band-bottom": bandBottom,
  "price-burst": priceBurst,
};

// ---------------------------------------------------------------------------------------------
// Decorações
// ---------------------------------------------------------------------------------------------

function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const n = parseInt(match[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.round(alpha * 1000) / 1000})`;
}

function buildDecorations(ctx: Ctx, anchor: ArchetypeResult["decorationAnchor"]): DecorationShape[] {
  const k = ctx.scale.decoration;
  const { W, H, accent } = ctx;
  switch (ctx.doc.direction.decoration) {
    case "line":
      return anchor.align === "center"
        ? [{ kind: "rect", rect: rect(W / 2 - 60, Math.max(24, anchor.headlineTop - 26), 120, 8), fill: withAlpha(accent, Math.min(1, 0.9 * k)), radius: 4 }]
        : [{ kind: "rect", rect: rect(Math.max(24, ctx.safe.x - 34), anchor.headlineTop, 10, 150), fill: withAlpha(accent, Math.min(1, 0.9 * k)), radius: 5 }];
    case "frame":
      return [{ kind: "frame", rect: rect(36, 36, W - 72, H - 72), stroke: withAlpha(ctx.ink.ink, Math.min(0.5, 0.2 * k)), strokeWidth: 3 }];
    case "circle":
      return [
        { kind: "circle", cx: W - 90, cy: ctx.ess.y + 150, r: W * 0.3, fill: withAlpha(accent, Math.min(0.4, 0.12 * k)), strokeWidth: 0 },
        { kind: "circle", cx: W - 90, cy: ctx.ess.y + 150, r: W * 0.3, stroke: withAlpha(accent, Math.min(0.7, 0.3 * k)), strokeWidth: 10 },
      ];
    case "corner": {
      const size = W * 0.2 * Math.min(1.3, k);
      return anchor.align === "left"
        ? [{ kind: "triangle", points: [[W, H], [W - size, H], [W, H - size]], fill: withAlpha(accent, Math.min(0.95, 0.85 * k)) }]
        : [{ kind: "triangle", points: [[0, H], [size, H], [0, H - size]], fill: withAlpha(accent, Math.min(0.95, 0.85 * k)) }];
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------------------------

/** Problemas que tornam o anúncio inaceitável (TEXT_OVERFLOW = texto truncado com reticências é só aviso). */
export function isCriticalIssue(issue: AdLayoutIssue): boolean {
  return issue.code !== "TEXT_OVERFLOW";
}

export function validateAdLayout(layout: Omit<AdLayout, "issues">): AdLayoutIssue[] {
  const issues: AdLayoutIssue[] = [];
  const W = layout.canvas.width;
  const H = layout.canvas.height;
  const isBurst = layout.archetype === "price-burst";

  const textItems: readonly { readonly name: string; readonly block: PlacedText | undefined; readonly min: number; readonly essential: boolean }[] = [
    { name: "kicker", block: layout.kicker, min: AD_MIN_FONT_PX.kicker, essential: true },
    { name: "headline", block: layout.headline, min: AD_MIN_FONT_PX.headline, essential: true },
    { name: "subtitle", block: layout.subtitle, min: AD_MIN_FONT_PX.subtitle, essential: true },
    { name: "price", block: layout.price?.main, min: AD_MIN_FONT_PX.price, essential: true },
    { name: "oldPrice", block: layout.price?.old, min: AD_MIN_FONT_PX.oldPrice, essential: true },
    { name: "badge", block: layout.price?.badge?.text, min: AD_MIN_FONT_PX.badge, essential: true },
    { name: "cta", block: layout.cta?.label, min: AD_MIN_FONT_PX.cta, essential: false },
    { name: "store", block: layout.store, min: AD_MIN_FONT_PX.store, essential: true },
  ];
  for (const item of textItems) {
    const block = item.block;
    if (!block || block.lines.length === 0) continue;
    if (block.font.px + 0.01 < item.min) issues.push({ code: "TEXT_TOO_SMALL", target: item.name, detail: `${block.font.px.toFixed(1)}px < ${item.min}px` });
    if (!rectContains(layout.safe, block.rect)) issues.push({ code: "OUT_OF_SAFE_AREA", target: item.name, detail: JSON.stringify(block.rect) });
    else if (item.essential && !rectContains(layout.essential, block.rect)) issues.push({ code: "OUT_OF_ESSENTIAL_AREA", target: item.name, detail: JSON.stringify(block.rect) });
    if (block.truncated) issues.push({ code: "TEXT_OVERFLOW", target: item.name, detail: "texto truncado com reticências" });
  }

  for (const shape of [{ name: "pricePlate", r: layout.price?.plate?.rect }, { name: "badgePlate", r: isBurst ? undefined : layout.price?.badge?.plate.rect }]) {
    if (shape.r && !rectContains(layout.essential, shape.r)) issues.push({ code: "OUT_OF_ESSENTIAL_AREA", target: shape.name, detail: JSON.stringify(shape.r) });
  }
  if (layout.cta && !rectContains(layout.safe, layout.cta.rect)) issues.push({ code: "OUT_OF_SAFE_AREA", target: "cta", detail: JSON.stringify(layout.cta.rect) });
  if (layout.logo && !rectContains(rect(0, 0, W, H), layout.logo)) issues.push({ code: "OUT_OF_SAFE_AREA", target: "logo", detail: JSON.stringify(layout.logo) });
  if (!rectContains(layout.essential, layout.product.rect)) issues.push({ code: "OUT_OF_ESSENTIAL_AREA", target: "product", detail: JSON.stringify(layout.product.rect) });
  if (layout.product.rect.h < H * 0.3 || layout.product.rect.w < W * 0.3) {
    issues.push({ code: "PRODUCT_TOO_SMALL", target: "product", detail: `${Math.round(layout.product.rect.w)}x${Math.round(layout.product.rect.h)}` });
  }

  // Sobreposições proibidas: texto x texto, texto x produto, texto x logo. (Selo sobre o produto e decoração são intencionais.)
  const solids: { readonly name: string; readonly r: Rect }[] = [];
  const push = (name: string, block: PlacedText | undefined) => { if (block && block.lines.length > 0) solids.push({ name, r: block.rect }); };
  push("kicker", layout.kicker); push("headline", layout.headline); push("subtitle", layout.subtitle); push("store", layout.store);
  if (layout.price && !isBurst) solids.push({ name: "price", r: layout.price.rect });
  if (layout.cta) solids.push({ name: "cta", r: layout.cta.rect });
  for (let i = 0; i < solids.length; i += 1) {
    for (let j = i + 1; j < solids.length; j += 1) {
      if (rectsIntersect(solids[i].r, solids[j].r, 1)) issues.push({ code: "OVERLAP", target: `${solids[i].name}/${solids[j].name}`, detail: "blocos sobrepostos" });
    }
    if (rectsIntersect(solids[i].r, layout.product.rect, 1)) issues.push({ code: "OVERLAP", target: `${solids[i].name}/product`, detail: "elemento invade o produto" });
    if (layout.logo && solids[i].name !== "cta" && rectsIntersect(solids[i].r, layout.logo, 1)) issues.push({ code: "OVERLAP", target: `${solids[i].name}/logo`, detail: "texto sobre o logo" });
  }
  if (layout.band && rectsIntersect(layout.band.rect, layout.product.rect, 1)) issues.push({ code: "OVERLAP", target: "band/product", detail: "a faixa invade o produto" });
  if (layout.band) {
    const ratio = contrastRatio(layout.band.text, layout.band.fill);
    if (ratio < MIN_TEXT_CONTRAST) issues.push({ code: "LOW_CONTRAST", target: "band", detail: `contraste ${ratio.toFixed(2)}` });
  } else if (layout.ink.scrimNeeded && layout.scrims.length === 0) {
    issues.push({ code: "LOW_CONTRAST", target: "text", detail: `contraste ${layout.ink.minContrast.toFixed(2)} sem scrim` });
  }
  return issues;
}

// ---------------------------------------------------------------------------------------------
// API principal
// ---------------------------------------------------------------------------------------------

const TEXT_SCALE_STEPS = [1, 0.92, 0.85, 0.78] as const;

function layoutAttempt(input: AdLayoutInput, textScale: number): AdLayout {
  const { doc } = input;
  const canvas = getAdsProCanvasSize(doc.format);
  const tokens = SPACING_TOKENS[doc.direction.spacing];
  const safe = rect(tokens.margin, tokens.margin, canvas.width - tokens.margin * 2, canvas.height - tokens.margin * 2);
  const ink = resolveInkForBackdrop(input.backdrop.colors);
  const recipe = ADS_PRO_STYLE_RECIPES[doc.direction.style];
  const accent = ensureReadableAccent(doc.brand.accent ?? recipe.accent);
  const onAccent = readableOn(accent);
  const text = resolveRenderableText(doc);
  const ghost = ink.backdrop === "dark" ? "rgba(255,255,255,0.16)" : "rgba(17,24,39,0.09)";
  const ctx: Ctx = {
    W: canvas.width, H: canvas.height, format: doc.format, m: tokens.margin, gap: tokens.gap, safe,
    ess: essentialBounds(doc.format, safe, canvas.height, canvas.width),
    ctaH: CTA_HEIGHT[doc.direction.intent === "promo" || doc.direction.intent === "last" ? "lg" : recipe.cta.size],
    hasCta: text.ctaText.length > 0,
    hasLogo: input.hasLogo,
    textScale,
    measure: input.measure,
    ink, accent, onAccent, doc, text,
    typo: recipe.typography,
    scale: ADS_PRO_INTENSITY_SCALE[doc.direction.intensity],
    photoCutout: doc.photo.mode === "cutout",
    onBackdrop: { fill: accent, onFill: onAccent, ink: ink.ink, muted: ink.muted, ghost },
  };

  const archetype = resolveEffectiveArchetype(doc);
  const result = ARCHETYPE_BUILDERS[archetype](ctx);
  const needsScrim = (ink.scrimNeeded || input.backdrop.forceScrim === true) && !result.band;
  const base: Omit<AdLayout, "issues"> = {
    canvas,
    format: doc.format,
    archetype,
    safe,
    essential: ctx.ess,
    ink,
    accent,
    onAccent,
    product: { rect: result.product, presentation: ctx.photoCutout ? "float" : "card", radius: 30 },
    ...(result.kicker ? { kicker: result.kicker } : {}),
    ...(result.headline ? { headline: result.headline } : {}),
    ...(result.subtitle ? { subtitle: result.subtitle } : {}),
    ...(result.price ? { price: result.price } : {}),
    ...(result.cta ? { cta: result.cta } : {}),
    ...(result.store ? { store: result.store } : {}),
    ...(result.logo ? { logo: result.logo } : {}),
    ...(result.band ? { band: result.band } : {}),
    scrims: needsScrim ? result.textGroups.map((group) => pad(group, 22)) : [],
    scrimColor: ink.backdrop === "dark" ? `rgba(6,8,12,${ink.scrimNeeded ? 0.62 : 0.42})` : `rgba(255,255,255,${ink.scrimNeeded ? 0.7 : 0.5})`,
    decorations: buildDecorations(ctx, result.decorationAnchor),
    textScale,
  };
  return { ...base, issues: validateAdLayout(base) };
}

function criticalCount(layout: AdLayout): number {
  return layout.issues.filter(isCriticalIssue).length;
}

/**
 * Calcula o layout. Tenta o texto em escala cheia e, se houver problema crítico (produto pequeno demais,
 * sobreposição…), reduz o texto em passos (até 78%) — o produto é a estrela, mas o texto nunca fica
 * ilegível (mínimos em AD_MIN_FONT_PX). Sempre devolve o melhor resultado encontrado.
 */
export function computeAdLayout(input: AdLayoutInput): AdLayout {
  let best: AdLayout | undefined;
  for (const step of TEXT_SCALE_STEPS) {
    const attempt = layoutAttempt(input, step);
    if (criticalCount(attempt) === 0) return attempt;
    if (!best
      || criticalCount(attempt) < criticalCount(best)
      || (criticalCount(attempt) === criticalCount(best) && attempt.product.rect.w * attempt.product.rect.h > best.product.rect.w * best.product.rect.h)) {
      best = attempt;
    }
  }
  return best as AdLayout;
}
