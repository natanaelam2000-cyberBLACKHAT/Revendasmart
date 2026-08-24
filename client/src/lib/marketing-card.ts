import { buildMarketingAdVisualModel, normalizeMarketingAdConfig, type MarketingAdConfig, type MarketingAdInput } from "@/lib/marketing-ad";
import { ART_ELEVATION, ART_FONT_FAMILY, ART_LAYOUT, ART_SIZE, getArtAttributeTextWidth, getArtAttributeTextX, getArtBadgeFontSize, getArtBadgeLabel, getArtBadgeWidth, getArtCtaFontSize, getArtHeadlineFontSize, getArtInkColor, getArtPhotoInnerBox, getArtPriceFontSize, getArtReadableAccent, toArtPx } from "@/lib/marketing-art-layout";
import { MARKETING_IMAGE_ERROR_MESSAGE, MarketingImageResolutionError, collectMarketingImageCandidates, resolveMarketingImageCandidates, type ResolvedMarketingImage } from "@/lib/marketing-image";
import { MarketingProductPreservationError, assertPreparedMarketingProductImage, getMarketingProductRenderGeometry, type PreparedMarketingProductImage } from "@/lib/marketing-product-preservation";

const S = ART_SIZE;
const FONT = ART_FONT_FAMILY;
export const MARKETING_CARD_IMAGE_ERROR_MESSAGE = MARKETING_IMAGE_ERROR_MESSAGE;
export const MARKETING_CARD_RENDER_ERROR_MESSAGE = "Não foi possível finalizar o PNG do card. Tente novamente.";

export class MarketingCardImageError extends Error {
  readonly code = "marketing-image-decode-failed";

  constructor() {
    super(MARKETING_CARD_IMAGE_ERROR_MESSAGE);
    this.name = "MarketingCardImageError";
  }
}

export class MarketingCardRenderError extends Error {
  readonly code: "canvas-context" | "canvas-encode";

  constructor(code: "canvas-context" | "canvas-encode", cause?: unknown) {
    super(MARKETING_CARD_RENDER_ERROR_MESSAGE, { cause });
    this.name = "MarketingCardRenderError";
    this.code = code;
  }
}

const loadImg = (src: string) => new Promise<HTMLImageElement | null>((resolve) => {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = src;
});

async function loadOptionalVisualAsset(src: string) {
  if (!src) return null;
  try {
    const resolved = await resolveMarketingImageCandidates([src]);
    return resolved ? loadImg(resolved.safeSrc) : null;
  } catch {
    return null;
  }
}

async function resolveProductImage(config: MarketingAdConfig, options: CreateMarketingCardOptions) {
  // A lista de candidatas precisa ser a COMPLETA — a mesma que o app usa para resolver —, incluindo a
  // foto guardada localmente sob `imageId`. Enquanto a validação usava só os campos síncronos, um
  // produto cuja única imagem vinha do IndexedDB caía em dois erros: sem candidatas o card saía sem
  // foto, e com candidatas a imagem já resolvida era REJEITADA por não constar na lista curta.
  //
  // A proteção contra imagem de outro produto continua exatamente igual: o que muda é a lista ficar
  // completa, não a checagem afrouxar. Nenhuma URL arbitrária passa a ser aceita — a candidata tem
  // de sair deste mesmo config.
  const candidates = await collectMarketingImageCandidates(config);
  const preservationRequired = Object.prototype.hasOwnProperty.call(options, "preparedProductImage");
  if (!candidates.length) {
    if (options.preparedProductImage) throw new MarketingProductPreservationError();
    return null;
  }
  let supplied = options.resolvedProductImage;
  let prepared: PreparedMarketingProductImage | null = null;
  if (preservationRequired) {
    if (!options.preparedProductImage) throw new MarketingProductPreservationError();
    prepared = assertPreparedMarketingProductImage({
      expectedProductId: config.productId,
      prepared: options.preparedProductImage,
      resolvedImage: options.preparedProductImage.resolvedImage,
    });
    supplied = prepared.resolvedImage;
  }
  if (supplied && !candidates.includes(supplied.sourceUrl)) throw new MarketingImageResolutionError(candidates.length);
  const resolved = supplied || await resolveMarketingImageCandidates(candidates);
  if (!resolved) throw new MarketingImageResolutionError(candidates.length);
  const image = await loadImg(resolved.safeSrc);
  if (!image) throw new MarketingCardImageError();
  if (prepared && (image.naturalWidth !== prepared.asset.width || image.naturalHeight !== prepared.asset.height)) {
    throw new MarketingProductPreservationError();
  }
  return { image, resolved, prepared };
}

const font = (ctx: CanvasRenderingContext2D, size: number, weight = 900) => { ctx.font = `${weight} ${size}px ${FONT}`; };
function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string, strokeWidth = 3) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = strokeWidth; ctx.stroke(); }
}
function fit(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const ratio = Math.min(w / img.naturalWidth, h / img.naturalHeight), iw = img.naturalWidth * ratio, ih = img.naturalHeight * ratio;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}
/**
 * PRO-06: o `break` antigo saía do loop assim que a linha `max`-1 fechava, ANTES de processar a
 * palavra que tinha acabado de virar o início da última linha — então qualquer palavra depois dela
 * (mesmo cabendo perfeitamente na última linha) era descartada em silêncio, sem reticências. Isso
 * divergia do preview DOM (MarketingAdCanvas.tsx), que usa CSS e nunca perde palavra nenhuma dentro
 * do espaço disponível. Corrigido processando TODAS as palavras e só limitando a QUANTIDADE de linhas
 * no final — `fitFontForLines`, que já existia, continua responsável por diminuir a fonte até o texto
 * inteiro caber, então esse `slice` final só age quando não há tamanho de fonte razoável que resolva.
 */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, w: number, max = 2) {
  const words = text.split(/\s+/).filter(Boolean), lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= w) line = next;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, max);
}
function drawWrapped(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, lh: number, max = 2) {
  wrapLines(ctx, text, w, max).forEach((row, i) => ctx.fillText(row, x, y + i * lh));
}
function fitFontForLines(ctx: CanvasRenderingContext2D, text: string, w: number, maxLines: number, startSize: number, minSize: number) {
  for (let size = startSize; size >= minSize; size -= 2) {
    font(ctx, size, 900);
    const lines = wrapLines(ctx, text, w, maxLines);
    if (lines.join(" ").length >= text.replace(/\s+/g, " ").trim().length - 2) return { size, lines };
  }
  font(ctx, minSize, 900);
  return { size: minSize, lines: wrapLines(ctx, text, w, maxLines) };
}
/**
 * Ícone circular do atributo.
 *
 * CAUSA DA SOBREPOSIÇÃO CORRIGIDA AQUI: a função centraliza o glifo dentro do círculo e, antes,
 * DEIXAVA `textAlign="center"`/`textBaseline="middle"` no contexto. A linha seguinte desenhava o
 * texto do atributo sem reconfigurar nada, então "Pronta entrega" (197px) saía centrado em x=120 —
 * ou seja, começando em x=21 — e passava por cima do próprio ícone, que ocupa 60..102.
 *
 * O contexto 2D é estado global do desenho: quem muda, devolve.
 */
function circleIcon(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, fill: string, radius: number) {
  const previousAlign = ctx.textAlign, previousBaseline = ctx.textBaseline;
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
  ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; font(ctx, Math.round(radius * 1.05), 900); ctx.fillText(text, x, y + 1);
  ctx.textAlign = previousAlign; ctx.textBaseline = previousBaseline;
}

export type CreateMarketingCardOptions = {
  resolvedProductImage?: ResolvedMarketingImage | null;
  preparedProductImage?: PreparedMarketingProductImage | null;
};

export async function createMarketingCard(payload: MarketingAdInput, options: CreateMarketingCardOptions = {}): Promise<Blob> {
  const normalizedConfig = normalizeMarketingAdConfig(payload);
  const [logo, productResult, signatureLogo] = await Promise.all([
    loadOptionalVisualAsset(normalizedConfig.storeLogoUrl || ""),
    resolveProductImage(normalizedConfig, options),
    loadOptionalVisualAsset("/logo-revenda-smart-symbol.png"),
  ]);
  const resolvedProductImage = productResult?.resolved || null;
  const product = productResult?.image || null;
  const model = buildMarketingAdVisualModel(normalizedConfig, { resolvedImageSrc: resolvedProductImage?.safeSrc || "" });
  const { config, theme, features, ctaText, description, badgeText, template } = model;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new MarketingCardRenderError("canvas-context");

  const L = ART_LAYOUT;
  const px = (fraction: number) => toArtPx(fraction, S);
  /** Medição real do renderizador — é o que as regras de ajuste do layout consomem. */
  const measureArtText = (text: string, fontSize: number) => { font(ctx, fontSize, 900); return ctx.measureText(text).width; };

  const grad = ctx.createLinearGradient(0, 0, S, S);
  grad.addColorStop(0, "#ffffff"); grad.addColorStop(.55, "#f8fbff"); grad.addColorStop(1, "#eaf3ff");
  ctx.fillStyle = grad; ctx.fillRect(0, 0, S, S);
  ctx.globalAlpha = .14; ctx.fillStyle = "#2563eb"; ctx.beginPath(); ctx.arc(905, 540, 348, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;

  const cardInset = px(L.card.inset);
  const cardSide = S - cardInset * 2;
  ctx.shadowColor = "rgba(15,23,42,.13)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 16;
  rect(ctx, cardInset, cardInset, cardSide, cardSide, px(L.card.radius), "rgba(255,255,255,.96)", "rgba(226,232,240,.92)");
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

  // --- Cabecalho ---
  const logoBox = px(L.header.logo.size), logoX = px(L.header.logo.x), logoY = px(L.header.logo.y), logoPad = px(L.header.logo.imageInset);
  rect(ctx, logoX, logoY, logoBox, logoBox, px(L.header.logo.radius), "#fff", theme.ring);
  if (logo) fit(ctx, logo, logoX + logoPad, logoY + logoPad, logoBox - logoPad * 2, logoBox - logoPad * 2);
  else { ctx.fillStyle = theme.accent; font(ctx, px(34 / 1080)); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText((config.storeName || "M").slice(0, 1).toUpperCase(), logoX + logoBox / 2, logoY + logoBox / 2); }
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = "#0f172a"; font(ctx, px(L.header.storeName.fontSize));
  drawWrapped(ctx, config.storeName, px(L.header.storeName.x), px(L.header.storeName.y), px(L.header.storeName.width), px(34 / 1080), 1);
  ctx.fillStyle = "#64748b"; font(ctx, px(L.header.storeTag.fontSize), 900); ctx.fillText("LOJA OFICIAL", px(L.header.storeTag.x), px(L.header.storeTag.y));
  // O selo é dimensionado PELO TEXTO e ancorado na borda direita do card. Fixar a largura fazia o
  // rótulo do template vazar da pílula (ver ART_LAYOUT.header.badge).
  const bd = L.header.badge;
  const badgeLabel = getArtBadgeLabel(badgeText);
  const badgeFontSize = getArtBadgeFontSize(badgeLabel, measureArtText, S);
  font(ctx, badgeFontSize);
  const badgeW = getArtBadgeWidth(ctx.measureText(badgeLabel).width, S);
  const badgeH = px(bd.height), badgeX = px(bd.rightX) - badgeW, badgeY = px(bd.centerY) - badgeH / 2;
  // Sombra discreta só sob a cápsula: é o que separa o selo do card branco sem virar efeito pesado.
  ctx.shadowColor = ART_ELEVATION.badge.color; ctx.shadowBlur = px(ART_ELEVATION.badge.blur); ctx.shadowOffsetY = px(ART_ELEVATION.badge.offsetY);
  // PRO-04: badgeVariant "outline" (templates Pro) troca o preenchimento sólido por um selo vazado —
  // mesma caixa/posição/tamanho medidos pelo texto, só a pintura muda. "solid" é o visual de sempre.
  const badgeInk = template.badgeVariant === "outline" ? theme.accent : getArtInkColor(theme.accent);
  if (template.badgeVariant === "outline") rect(ctx, badgeX, badgeY, badgeW, badgeH, px(bd.radius), "rgba(255,255,255,.92)", theme.accent, 4);
  else rect(ctx, badgeX, badgeY, badgeW, badgeH, px(bd.radius), theme.accent);
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.fillStyle = badgeInk; font(ctx, badgeFontSize); ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(badgeLabel, badgeX + badgeW / 2, px(bd.centerY));

  // --- Coluna de texto ---
  const textX = px(L.text.x), textW = px(L.text.width);
  // A chamada do template ganhou corpo e é ajustada à coluna: antes, rótulos longos perdiam palavras
  // porque o desenho descartava o que não coubesse na única linha disponível.
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  const headlineInk = getArtReadableAccent(theme.accent);
  ctx.fillStyle = headlineInk;
  font(ctx, getArtHeadlineFontSize(config.headline, measureArtText, S), 900);
  ctx.fillText(config.headline, textX, px(L.text.headline.y));
  // Traço curto de destaque: ocupa a folga vertical entre a chamada e o nome, sem tirar largura do
  // texto — que já está no limite da coluna.
  const bar = L.text.headline.accentBar;
  rect(ctx, textX, px(L.text.headline.y) + px(bar.offsetY), px(bar.width), px(bar.height), px(bar.radius), headlineInk);
  ctx.fillStyle = "#0f172a";
  const nameStart = config.productName.length > L.text.name.longNameLength ? px(L.text.name.fontSizeLong) : px(L.text.name.fontSizeMax);
  const fittedTitle = fitFontForLines(ctx, config.productName, textW, L.text.name.maxLines, nameStart, px(L.text.name.fontSizeMin));
  font(ctx, fittedTitle.size, 900);
  const nameLine = px(L.text.name.lineHeight);
  fittedTitle.lines.forEach((row, i) => ctx.fillText(row, textX, px(L.text.name.y) + i * nameLine));
  let nextY = px(L.text.name.y) + fittedTitle.lines.length * nameLine + px(L.text.description.gap);
  if (description) {
    ctx.fillStyle = "#475569"; font(ctx, px(L.text.description.fontSize), 700);
    drawWrapped(ctx, description, textX + 2, nextY, textW - 6, px(L.text.description.lineHeight), L.text.description.maxLines);
    nextY += px(L.text.description.blockHeight);
  }
  // O preço encolhe só o necessário para caber na coluna, medindo a largura REAL com measureText.
  // O valor formatado nunca é alterado — muda o corpo da fonte, não o número.
  ctx.fillStyle = "#0f172a";
  const priceFontSize = getArtPriceFontSize(config.priceText, measureArtText, S);
  font(ctx, priceFontSize, 900);
  const priceBaselineY = nextY + px(L.text.price.offsetY);
  // PRO-04: priceVariant "highlight" (alguns templates Pro) desenha uma pílula suave ATRÁS do preço,
  // dimensionada pelo mesmo measureText que já decide o corpo da fonte — nunca um tamanho fixo que
  // pudesse cortar um preço maior. "standard" não desenha nada aqui (visual de sempre).
  if (template.priceVariant === "highlight") {
    const priceWidth = ctx.measureText(config.priceText).width;
    const padX = px(16 / 1080), padTop = priceFontSize * 0.74, padBottom = priceFontSize * 0.2;
    rect(ctx, textX - padX, priceBaselineY - padTop, priceWidth + padX * 2, padTop + padBottom, px(18 / 1080), `${theme.accent}22`);
    ctx.fillStyle = "#0f172a";
  }
  ctx.fillText(config.priceText, textX, priceBaselineY);

  let rowY = nextY + px(L.text.attributes.offsetY);
  const attr = L.text.attributes;
  // O texto começa depois do ícone POR CONSTRUÇÃO (iconX + iconRadius + gap), não por um segundo
  // número escrito à mão que pudesse divergir.
  const attrTextX = px(getArtAttributeTextX()), attrTextW = px(getArtAttributeTextWidth());
  for (const feature of features) {
    circleIcon(ctx, px(attr.iconX), rowY - 8, feature.icon, feature.highlight ? "#22c55e" : "#2563eb", px(attr.iconRadius));
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#1e293b"; font(ctx, px(attr.fontSize), 800);
    drawWrapped(ctx, feature.text, attrTextX, rowY, attrTextW, px(28 / 1080), 1);
    rowY += px(attr.rowHeight);
  }

  if (ctaText) {
    const ctaY = px(L.text.cta.y), ctaH = px(L.text.cta.height);
    // A cor sai do tema (theme.cta), não de um literal repetido aqui e no CSS, e a tinta é escolhida
    // pelo contraste do próprio fundo.
    ctx.shadowColor = ART_ELEVATION.cta.color; ctx.shadowBlur = px(ART_ELEVATION.cta.blur); ctx.shadowOffsetY = px(ART_ELEVATION.cta.offsetY);
    rect(ctx, textX, ctaY, textW, ctaH, px(L.text.cta.radius), theme.cta);
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.fillStyle = getArtInkColor(theme.cta); font(ctx, getArtCtaFontSize(ctaText, measureArtText, S));
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(ctaText, textX + textW / 2, ctaY + ctaH / 2);
  }

  // --- Foto do produto ---
  const ph = L.photo;
  const photoX = px(ph.x), photoY = px(ph.y), photoW = px(ph.width), photoH = px(ph.height);
  // PRO-04: frameVariant "accent-frame" (alguns templates Pro) troca a borda neutra por um contorno
  // na cor de destaque com glow externo suave — MESMA caixa/posição/tamanho da foto (a geometria
  // aprovada abaixo não muda um pixel; só a moldura ao redor dela). "plain" é o visual de sempre.
  if (template.frameVariant === "accent-frame") {
    ctx.shadowColor = `${theme.accent}55`; ctx.shadowBlur = px(30 / 1080); ctx.shadowOffsetY = 0;
    rect(ctx, photoX, photoY, photoW, photoH, px(ph.radius), "rgba(255,255,255,.72)", theme.accent, 5);
    ctx.shadowBlur = 0;
  } else {
    rect(ctx, photoX, photoY, photoW, photoH, px(ph.radius), "rgba(255,255,255,.72)", "rgba(37,99,235,.18)");
  }
  // A caixa acima é a APROVADA e não muda. O que cresceu foi só a área útil dentro dela: o produto
  // continua em `contain`, sem corte e sem distorção — apenas com menos branco em volta.
  const inner = getArtPhotoInnerBox();
  if (product && productResult?.prepared) {
    const prepared = assertPreparedMarketingProductImage({
      expectedProductId: config.productId,
      prepared: productResult.prepared,
      resolvedImage: resolvedProductImage,
    });
    const geometry = getMarketingProductRenderGeometry(prepared);
    ctx.drawImage(product, geometry.x, geometry.y, geometry.width, geometry.height);
  }
  else if (product) fit(ctx, product, px(inner.x), px(inner.y), px(inner.width), px(inner.height));
  else { ctx.fillStyle = "#e0ecff"; ctx.beginPath(); ctx.arc(photoX + photoW / 2, photoY + photoH / 2, px(116 / 1080), 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#2563eb"; font(ctx, px(28 / 1080)); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("Produto sem imagem", photoX + photoW / 2, photoY + photoH / 2 + 4); }

  // --- Assinatura ---
  const sig = L.signature;
  ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillStyle = "#94a3b8"; font(ctx, px(sig.fontSize), 900);
  ctx.fillText("Criado com Revenda Smart", px(sig.textRightX), px(sig.y));
  if (signatureLogo) fit(ctx, signatureLogo, px(sig.logoX), px(sig.logoY), px(sig.logoSize), px(sig.logoSize));

  return canvasToPngBlob(canvas);
}

export function canvasToPngBlob(canvas: Pick<HTMLCanvasElement, "toBlob">): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new MarketingCardRenderError("canvas-encode")), "image/png", 0.95);
    } catch (error) {
      reject(new MarketingCardRenderError("canvas-encode", error));
    }
  });
}
