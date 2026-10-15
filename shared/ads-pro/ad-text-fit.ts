/**
 * ADS-PRO-FINAL — tipografia e ajuste de texto do compositor.
 *
 * O texto NUNCA pode vazar da caixa nem ficar cortado: `fitText` reduz o corpo até o mínimo legível, quebra
 * em linhas e, se ainda assim não couber, trunca a última linha com reticências. A medição é injetada
 * (`TextMeasurer`): no navegador vem do canvas real (`ctx.measureText`), nos testes de um estimador
 * determinístico conservador. O mesmo algoritmo roda nos dois, então a prova em Node vale para o navegador.
 */
import type { AdsProFontKind } from "./ad-style-direction";

export interface FontSpec {
  readonly kind: AdsProFontKind;
  readonly weight: number;
  readonly italic: boolean;
  readonly px: number;
  readonly uppercase: boolean;
  /** Espaçamento entre letras, em em. */
  readonly trackingEm: number;
}

export type TextMeasurer = (text: string, font: FontSpec) => number;

/** Só fontes do sistema (sem webfont): medição síncrona e idêntica entre preview e exportação. */
export const AD_FONT_STACKS: Readonly<Record<AdsProFontKind, string>> = Object.freeze({
  serif: 'Georgia, "Times New Roman", "Noto Serif", serif',
  sans: '"Helvetica Neue", Arial, "Noto Sans", Roboto, sans-serif',
  display: '"Arial Black", "Helvetica Neue", Arial, "Noto Sans", Roboto, sans-serif',
});

export function fontCss(font: FontSpec): string {
  return `${font.italic ? "italic " : ""}${font.weight} ${Math.round(font.px * 100) / 100}px ${AD_FONT_STACKS[font.kind]}`;
}

export function applyFontCase(text: string, font: Pick<FontSpec, "uppercase">): string {
  return font.uppercase ? text.toLocaleUpperCase("pt-BR") : text;
}

const NARROW = new Set("iljtfI.,:;'|!()[]/ ".split(""));
const WIDE = new Set("mwMW@%&".split(""));

/**
 * Estimador determinístico (sem DOM) de largura de texto — propositalmente CONSERVADOR (superestima) para
 * que um layout que passa nos testes também caiba com a fonte real do aparelho.
 */
export function createEstimateMeasurer(): TextMeasurer {
  return (text, font) => {
    const family = font.kind === "serif" ? 1.0 : font.kind === "display" ? 1.1 : 1.02;
    const weight = font.weight >= 800 ? 1.1 : font.weight >= 600 ? 1.05 : font.weight <= 400 ? 0.98 : 1;
    let units = 0;
    for (const char of applyFontCase(text, font)) {
      if (NARROW.has(char)) units += 0.34;
      else if (WIDE.has(char)) units += 0.92;
      else if (char >= "0" && char <= "9") units += 0.6;
      else if (char === char.toUpperCase() && char !== char.toLowerCase()) units += 0.72;
      else units += 0.56;
    }
    const tracking = Math.max(0, text.length - 1) * font.trackingEm;
    return (units * family * weight * (font.italic ? 1.02 : 1) + tracking) * font.px;
  };
}

export interface FittedText {
  readonly lines: readonly string[];
  readonly px: number;
  readonly lineHeightPx: number;
  readonly width: number;
  readonly height: number;
  readonly truncated: boolean;
}

export interface FitTextOptions {
  readonly maxWidth: number;
  readonly maxLines: number;
  readonly minPx: number;
  /** Razão entrelinha/corpo. */
  readonly lineHeight: number;
  /** Altura máxima do bloco (opcional): força reduzir o corpo antes de truncar. */
  readonly maxHeight?: number;
}

function breakLongWord(word: string, font: FontSpec, maxWidth: number, measure: TextMeasurer): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const char of word) {
    if (current && measure(current + char, font) > maxWidth) {
      pieces.push(current);
      current = char;
    } else current += char;
  }
  if (current) pieces.push(current);
  return pieces;
}

function wrap(text: string, font: FontSpec, maxWidth: number, measure: TextMeasurer): string[] {
  const words = text.split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const rawWord of words) {
    const parts = measure(rawWord, font) > maxWidth ? breakLongWord(rawWord, font, maxWidth, measure) : [rawWord];
    for (const word of parts) {
      const candidate = current ? `${current} ${word}` : word;
      if (!current || measure(candidate, font) <= maxWidth) current = candidate;
      else { lines.push(current); current = word; }
    }
  }
  if (current) lines.push(current);
  return lines;
}

function ellipsize(line: string, font: FontSpec, maxWidth: number, measure: TextMeasurer): string {
  let text = line.trimEnd();
  while (text.length > 1 && measure(`${text}…`, font) > maxWidth) text = text.slice(0, -1).trimEnd();
  return `${text}…`;
}

/**
 * Cabe `text` em `maxWidth` x (`maxLines` linhas): tenta do corpo pedido até `minPx`; se nenhum corpo
 * couber, trunca com reticências no corpo mínimo. Nunca devolve uma linha mais larga que `maxWidth`.
 */
export function fitText(text: string, font: FontSpec, options: FitTextOptions, measure: TextMeasurer): FittedText {
  // A caixa alta é aplicada ANTES de medir/quebrar: as linhas devolvidas são exatamente o que será desenhado.
  const clean = applyFontCase(text.replace(/\s+/g, " ").trim(), font);
  if (!clean) return { lines: [], px: font.px, lineHeightPx: font.px * options.lineHeight, width: 0, height: 0, truncated: false };
  const minPx = Math.min(options.minPx, font.px);
  const measureLine = (line: string, px: number) => measure(line, { ...font, px });
  const build = (px: number): { lines: string[]; fits: boolean } => {
    const sized = { ...font, px };
    const lines = wrap(clean, sized, options.maxWidth, measure);
    const heightOk = options.maxHeight === undefined || lines.length * px * options.lineHeight <= options.maxHeight + 0.5;
    return { lines, fits: lines.length <= options.maxLines && heightOk };
  };

  let px = font.px;
  while (px >= minPx) {
    const attempt = build(px);
    if (attempt.fits) return finalize(attempt.lines, px, false);
    px = Math.floor(px * 0.96 * 100) / 100;
    if (px < minPx && px + 0.5 > minPx) px = minPx;
  }
  const sized = { ...font, px: minPx };
  const lines = wrap(clean, sized, options.maxWidth, measure);
  const maxLinesByHeight = options.maxHeight === undefined ? options.maxLines : Math.max(1, Math.floor(options.maxHeight / (minPx * options.lineHeight)));
  const allowed = Math.max(1, Math.min(options.maxLines, maxLinesByHeight));
  const kept = lines.slice(0, allowed);
  const rest = lines.slice(allowed).join(" ");
  const last = rest ? `${kept[kept.length - 1]} ${rest}` : kept[kept.length - 1];
  kept[kept.length - 1] = ellipsize(last, sized, options.maxWidth, measure);
  return finalize(kept, minPx, true);

  function finalize(finalLines: string[], finalPx: number, truncated: boolean): FittedText {
    const lineHeightPx = finalPx * options.lineHeight;
    return {
      lines: finalLines,
      px: finalPx,
      lineHeightPx,
      width: Math.max(...finalLines.map((line) => measureLine(line, finalPx))),
      height: finalLines.length * lineHeightPx,
      truncated,
    };
  }
}
