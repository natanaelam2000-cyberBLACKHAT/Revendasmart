/**
 * ADS-PRO-FINAL — contraste e legibilidade determinísticos (WCAG 2.x) para o compositor do Ads Pro.
 *
 * O compositor antigo desenhava SEMPRE texto em #111827, o que apagava nome e preço sobre os fundos
 * escuros da biblioteca (luxury-onyx, modern-teal…). Aqui a cor da tinta é DECIDIDA a partir das cores
 * reais do fundo: escolhe-se entre tinta escura e clara a que maximiza o PIOR contraste contra todas as
 * cores amostradas do cenário; se nem a melhor chega ao mínimo AA, o layout aplica um scrim atrás do texto.
 *
 * Puro: sem DOM, sem I/O, sem aleatoriedade.
 */

export interface Rgb { readonly r: number; readonly g: number; readonly b: number }

/** AA para texto normal. */
export const MIN_TEXT_CONTRAST = 4.5;
/** AA para texto grande (>= 24px regular / 18.66px bold). */
export const MIN_LARGE_TEXT_CONTRAST = 3;

export const AD_INK_DARK: string = "#111827";
export const AD_INK_LIGHT: string = "#FFFFFF";

export function parseHexColor(value: string): Rgb | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const hex = match[1].length === 3 ? match[1].split("").map((c) => c + c).join("") : match[1];
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
}

function channelToHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

export function rgbToHex(rgb: Rgb): string {
  return `#${channelToHex(rgb.r)}${channelToHex(rgb.g)}${channelToHex(rgb.b)}`.toUpperCase();
}

function linearChannel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * linearChannel(rgb.r) + 0.7152 * linearChannel(rgb.g) + 0.0722 * linearChannel(rgb.b);
}

/** Razão de contraste WCAG entre duas cores hex. Entrada inválida => 1 (pior caso), nunca lança. */
export function contrastRatio(foreground: string, background: string): number {
  const fg = parseHexColor(foreground);
  const bg = parseHexColor(background);
  if (!fg || !bg) return 1;
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function mixColors(a: string, b: string, weightOfB: number): string {
  const ca = parseHexColor(a);
  const cb = parseHexColor(b);
  if (!ca || !cb) return a;
  const t = Math.max(0, Math.min(1, weightOfB));
  return rgbToHex({ r: ca.r + (cb.r - ca.r) * t, g: ca.g + (cb.g - ca.g) * t, b: ca.b + (cb.b - ca.b) * t });
}

/** Cor de texto sobre uma superfície sólida (ex.: preço dentro de um selo colorido). */
export function readableOn(background: string): string {
  return contrastRatio(AD_INK_DARK, background) >= contrastRatio(AD_INK_LIGHT, background) ? AD_INK_DARK : AD_INK_LIGHT;
}

/**
 * Garante que o texto sobre uma cor de acento (botão, selo, faixa) seja legível: se nem a melhor tinta
 * (clara/escura) chega a AA, escurece/clareia o acento aos poucos até chegar. Determinístico.
 */
export function ensureReadableAccent(accent: string, minRatio: number = MIN_TEXT_CONTRAST): string {
  if (!parseHexColor(accent)) return accent;
  const darkenInstead = contrastRatio(AD_INK_LIGHT, accent) >= contrastRatio(AD_INK_DARK, accent);
  let current = rgbToHex(parseHexColor(accent) as Rgb);
  for (let step = 0; step < 14; step += 1) {
    if (contrastRatio(readableOn(current), current) >= minRatio) return current;
    current = mixColors(current, darkenInstead ? "#000000" : "#FFFFFF", 0.08);
  }
  return current;
}

export interface AdInkResolution {
  /** Texto principal (nome, preço). */
  readonly ink: string;
  /** Texto secundário (marca, subtítulo) — sempre >= 4.5:1 contra o pior ponto do fundo. */
  readonly muted: string;
  /** Pior contraste de `ink` contra as cores amostradas do fundo. */
  readonly minContrast: number;
  /** true => nem a melhor tinta chega a AA: o layout precisa de um scrim atrás dos textos. */
  readonly scrimNeeded: boolean;
  /** "dark" => fundo escuro (tinta clara). */
  readonly backdrop: "dark" | "light";
}

function worstContrast(ink: string, backdrop: readonly string[]): number {
  let worst = Number.POSITIVE_INFINITY;
  for (const color of backdrop) worst = Math.min(worst, contrastRatio(ink, color));
  return worst;
}

/**
 * Decide a tinta a partir das cores amostradas do cenário (stops do gradiente, quadrantes da foto…).
 * Determinístico: em empate, prefere a tinta escura.
 */
export function resolveInkForBackdrop(backdropColors: readonly string[]): AdInkResolution {
  const colors = backdropColors.filter((color) => parseHexColor(color) !== null);
  if (colors.length === 0) {
    return { ink: AD_INK_DARK, muted: "#4B5563", minContrast: contrastRatio(AD_INK_DARK, "#FFFFFF"), scrimNeeded: false, backdrop: "light" };
  }
  const dark = worstContrast(AD_INK_DARK, colors);
  const light = worstContrast(AD_INK_LIGHT, colors);
  const useLight = light > dark;
  const ink = useLight ? AD_INK_LIGHT : AD_INK_DARK;
  const minContrast = useLight ? light : dark;
  // Secundário: aproxima a tinta do fundo para hierarquia, mas nunca abaixo de AA contra o pior ponto.
  const average = colors.reduce<Rgb>((acc, color) => {
    const rgb = parseHexColor(color) as Rgb;
    return { r: acc.r + rgb.r / colors.length, g: acc.g + rgb.g / colors.length, b: acc.b + rgb.b / colors.length };
  }, { r: 0, g: 0, b: 0 });
  let muted = ink;
  for (const weight of [0.34, 0.26, 0.18, 0.1]) {
    const candidate = mixColors(ink, rgbToHex(average), weight);
    if (worstContrast(candidate, colors) >= MIN_TEXT_CONTRAST) { muted = candidate; break; }
  }
  return { ink, muted, minContrast, scrimNeeded: minContrast < MIN_TEXT_CONTRAST, backdrop: useLight ? "dark" : "light" };
}

export interface GradientStopLike { readonly offset: number; readonly color: string }

/** Cores do cenário gerado: stops + o mesmo stop levemente tingido pela vinheta (pior caso de borda). */
export function backdropColorsOfGenerated(spec: {
  readonly stops: readonly GradientStopLike[];
  readonly vignette?: { readonly color: string; readonly opacity: number };
}): string[] {
  const colors = spec.stops.map((stop) => stop.color);
  if (spec.vignette) for (const stop of spec.stops) colors.push(mixColors(stop.color, spec.vignette.color, spec.vignette.opacity));
  return colors;
}

/** Luminância "dark" | "light" do cenário, para o AssetDNA (`luminance`). */
export function classifyBackdropLuminance(backdropColors: readonly string[]): "dark" | "light" {
  return resolveInkForBackdrop(backdropColors).backdrop;
}
