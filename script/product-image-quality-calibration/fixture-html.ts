/**
 * PRO-07E.2C — construção PURA do HTML de uma fixture de calibração visual.
 *
 * Node não tem decoder/encoder de imagem embutido, e esta sprint proíbe instalar pacote novo (sharp/
 * canvas/jimp) — então não é possível repintar a foto num PNG raster sem uma dependência nova. A
 * fixture aqui embute os bytes ORIGINAIS da imagem (inalterados, só re-representados como texto
 * base64 — não é decode/encode de pixel, é o mesmo arquivo) num `<img>` posicionado via CSS absoluto
 * com os números EXATOS do `ProductTransform` (PRO-07B) — nenhuma segunda implementação de contain,
 * nenhum re-encode, nenhuma perda adicional. Abrir o arquivo .html em qualquer navegador mostra o
 * resultado geometricamente idêntico ao que um canvas real produziria.
 */

export interface ProductFixtureGeometry {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly translateX: number;
  readonly translateY: number;
}

export interface ProductFixtureLabel {
  readonly index: string;
  readonly fileName: string;
  readonly flow: "Manual" | "Premium";
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly scale: number;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Prova geométrica embutida na própria função: `targetWidth/targetHeight` vêm 1:1 do `ProductTransform`
 * recebido — nunca recalculados aqui. Não há crop (a imagem inteira é desenhada, `<img>` sem
 * `object-fit:cover`/`clip-path`) nem stretch (width/height do `<img>` usam os MESMOS dois números do
 * transform, nunca esticados para caber o canvas inteiro).
 */
export function buildProductFixtureHtml(
  geometry: ProductFixtureGeometry,
  label: ProductFixtureLabel,
  imageDataUri: string,
): string {
  const title = `${label.index} — ${label.flow} — ${escapeHtml(label.fileName)}`;
  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    `<meta charset="utf-8">`,
    `<title>${title}</title>`,
    "<style>",
    "  html,body{margin:0;padding:0;background:#f4f4f4;font-family:system-ui,sans-serif;}",
    "  .meta{padding:10px 16px;font-size:13px;color:#222;background:#ffffff;border-bottom:1px solid #dddddd;}",
    "  .meta b{font-weight:700;}",
    `  .canvas{position:relative;width:${geometry.canvasWidth}px;height:${geometry.canvasHeight}px;background:#e9e9e9;overflow:hidden;}`,
    `  .product{position:absolute;left:${geometry.translateX}px;top:${geometry.translateY}px;width:${geometry.targetWidth}px;height:${geometry.targetHeight}px;}`,
    "</style>",
    "</head>",
    "<body>",
    `<div class="meta"><b>${label.index}</b> &middot; ${escapeHtml(label.fileName)} &middot; source ${label.sourceWidth}&times;${label.sourceHeight} &middot; <b>${label.flow}</b> &middot; scale=${label.scale.toFixed(4)}</div>`,
    `<div class="canvas">`,
    `<img class="product" src="${imageDataUri}" alt="${escapeHtml(label.fileName)}">`,
    "</div>",
    "</body>",
    "</html>",
  ].join("\n");
}

/**
 * PRO-07E.2C-FIX — a fixture original (`buildProductFixtureHtml`) mostra o produto "contido" na caixa
 * do fluxo, mas isso sozinho não deixa perceber perda de nitidez por upscale: sem uma referência de
 * tamanho real ou uma ampliação, "um produto preenchendo uma caixa" parece igual em qualquer escala aos
 * olhos humanos. Esta função gera 3 painéis lado a lado, todos com dimensões CSS explícitas (nunca
 * `max-width`/`object-fit`/`transform:scale`/viewport responsivo — nenhuma segunda camada de
 * redimensionamento por cima do que já foi calculado):
 *
 *   SOURCE   — a imagem original nas dimensões REAIS decodificadas (sourceWidth×sourceHeight), 1:1.
 *   RENDERED — exatamente targetWidth×targetHeight do ProductTransform (o mesmo número já usado por
 *              buildProductFixtureHtml — nenhum recálculo).
 *   DETAIL   — uma janela fixa (DETAIL_CROP_SIZE²) recortada via `overflow:hidden` sobre a MESMA
 *              imagem já dimensionada para RENDERED, centralizada — não é uma imagem nova nem um
 *              recorte reencodado, é a mesma tag <img> com offset negativo, então zero interpolação
 *              além da que o próprio RENDERED já teria. Duas variantes lado a lado: suavização padrão
 *              do navegador (o que a aplicação real mostra) e `image-rendering:pixelated`
 *              (nearest-neighbor, sem suavização — revela blocos reais quando não há detalhe real).
 */

export const DETAIL_CROP_SIZE = 240;

/** Offset (nunca negativo) para centralizar a janela de recorte sobre a imagem já renderizada. */
export function computeDetailCropOffset(
  renderedWidth: number,
  renderedHeight: number,
  cropSize: number = DETAIL_CROP_SIZE,
): { readonly offsetX: number; readonly offsetY: number } {
  return {
    offsetX: Math.max(0, (renderedWidth - cropSize) / 2),
    offsetY: Math.max(0, (renderedHeight - cropSize) / 2),
  };
}

export interface ProductComparisonFixtureInput {
  readonly index: string;
  readonly fileName: string;
  readonly flow: "Manual" | "Premium";
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly scale: number;
  readonly imageDataUri: string;
}

function detailPanel(kind: "suave" | "pixelated", input: ProductComparisonFixtureInput, offset: { offsetX: number; offsetY: number }): string {
  const imageRendering = kind === "pixelated" ? "image-rendering:pixelated;" : "";
  return [
    `<div class="detailBox">`,
    `<div class="detailLabel">DETAIL — ${kind === "pixelated" ? "nearest-neighbor (sem suavização)" : "interpolação padrão do navegador"}</div>`,
    `<div class="detailWindow"><img class="detailImg" style="left:${-offset.offsetX}px;top:${-offset.offsetY}px;width:${input.targetWidth}px;height:${input.targetHeight}px;${imageRendering}" src="${input.imageDataUri}" alt="detalhe ${kind}"></div>`,
    "</div>",
  ].join("\n");
}

export function buildProductComparisonFixtureHtml(input: ProductComparisonFixtureInput): string {
  const title = `${input.index} — ${input.flow} — COMPARE — ${escapeHtml(input.fileName)}`;
  const offset = computeDetailCropOffset(input.targetWidth, input.targetHeight);
  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    `<meta charset="utf-8">`,
    // width=device-width apenas evita o auto-zoom de encaixe que alguns navegadores móveis aplicam
    // por padrão a páginas sem viewport declarado — NÃO substitui conferir o zoom em 100% (ver régua).
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${title}</title>`,
    "<style>",
    "  html,body{margin:0;padding:0;background:#f4f4f4;font-family:system-ui,sans-serif;}",
    "  .meta{padding:10px 16px;font-size:13px;color:#222;background:#ffffff;border-bottom:1px solid #dddddd;}",
    "  .meta b{font-weight:700;}",
    "  .ruler{display:flex;align-items:center;gap:8px;padding:6px 16px;font-size:11px;color:#555;background:#fffbe6;border-bottom:1px solid #f0e2a0;}",
    "  .rulerBar{width:100px;height:14px;background:repeating-linear-gradient(90deg,#333 0 1px,transparent 1px 10px);border:1px solid #333;}",
    "  .row{display:flex;align-items:flex-start;gap:16px;padding:16px;overflow:auto;}",
    "  .panel{flex:0 0 auto;}",
    "  .panelLabel{font-size:12px;font-weight:700;margin-bottom:6px;color:#333;}",
    // Cada painel é uma JANELA rolável (overflow:auto) de altura limitada — a IMAGEM dentro nunca é
    // redimensionada pela janela; ela mantém width/height explícitos em px, sempre.
    "  .scrollBox{max-height:70vh;overflow:auto;border:1px solid #ccc;background:#e9e9e9;}",
    `  .sourceImg{display:block;width:${input.sourceWidth}px;height:${input.sourceHeight}px;}`,
    `  .renderedImg{display:block;width:${input.targetWidth}px;height:${input.targetHeight}px;}`,
    `  .detailWindow{position:relative;width:${DETAIL_CROP_SIZE}px;height:${DETAIL_CROP_SIZE}px;overflow:hidden;border:1px solid #ccc;background:#e9e9e9;}`,
    "  .detailImg{position:absolute;}",
    "  .detailBox{margin-bottom:10px;}",
    "  .detailLabel{font-size:11px;color:#555;margin-bottom:4px;}",
    "</style>",
    "</head>",
    "<body>",
    `<div class="meta"><b>${input.index}</b> &middot; ${escapeHtml(input.fileName)} &middot; source ${input.sourceWidth}&times;${input.sourceHeight} &middot; <b>${input.flow}</b> &middot; rendered ${Math.round(input.targetWidth)}&times;${Math.round(input.targetHeight)} &middot; scale=${input.scale.toFixed(4)}</div>`,
    `<div class="ruler"><div class="rulerBar"></div><span>régua de 100px — confira que isto mede ~100px reais na tela (Ctrl/Cmd+0 para zoom 100%) antes de avaliar nitidez</span></div>`,
    `<div class="row">`,
    `<div class="panel"><div class="panelLabel">SOURCE 100% (${input.sourceWidth}&times;${input.sourceHeight})</div><div class="scrollBox"><img class="sourceImg" src="${input.imageDataUri}" alt="source"></div></div>`,
    `<div class="panel"><div class="panelLabel">RENDERED (${Math.round(input.targetWidth)}&times;${Math.round(input.targetHeight)}, scale=${input.scale.toFixed(3)})</div><div class="scrollBox"><img class="renderedImg" src="${input.imageDataUri}" alt="rendered"></div></div>`,
    `<div class="panel"><div class="panelLabel">DETAIL CROP (janela ${DETAIL_CROP_SIZE}&times;${DETAIL_CROP_SIZE}, 1:1 sobre o RENDERED)</div>${detailPanel("suave", input, offset)}${detailPanel("pixelated", input, offset)}</div>`,
    "</div>",
    "</body>",
    "</html>",
  ].join("\n");
}
