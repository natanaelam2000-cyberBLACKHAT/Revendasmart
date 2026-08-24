/**
 * RELEASE-CHECKOUT-02 §2 — resumo visual do pedido para identificação rápida pelo vendedor no
 * WhatsApp. Composição 100% determinística e local: miniatura real de cada produto + nome + qtd +
 * subtotal + total + forma de pagamento + loja. Sem IA, sem provider, sem alterar nenhuma imagem —
 * cada foto é desenhada em "contain" (nunca cortada/distorcida), a mesma técnica já usada em
 * marketing-card.ts para compor cards de anúncio.
 *
 * Falha ao carregar uma imagem (ausente ou quebrada) nunca derruba o resumo inteiro — vira um
 * placeholder "Sem imagem" só naquele item, e o resumo continua sendo gerado normalmente.
 */

export interface OrderVisualSummaryItem {
  name: string;
  quantity: number;
  /** Já formatado (ex.: "R$ 70,00") — omitido quando `showPrice` está desligado na loja. */
  subtotalLabel?: string;
  imageUrl?: string;
}

export interface OrderVisualSummaryInput {
  storeName: string;
  items: readonly OrderVisualSummaryItem[];
  /** Omitido quando `showPrice` está desligado na loja. */
  totalLabel?: string;
  paymentMethodLabel: string;
}

export const ORDER_VISUAL_SUMMARY_WIDTH = 800;
export const ORDER_VISUAL_SUMMARY_HEADER_HEIGHT = 96;
export const ORDER_VISUAL_SUMMARY_ROW_HEIGHT = 140;
export const ORDER_VISUAL_SUMMARY_FOOTER_HEIGHT = 140;
const PADDING = 32;
const THUMB_SIZE = 100;

export interface OrderVisualSummaryLayout {
  width: number;
  height: number;
  headerHeight: number;
  rowHeight: number;
  footerHeight: number;
}

/** Pura — sem canvas, testável em Node. A altura escala linearmente com o número de itens. */
export function computeOrderVisualSummaryLayout(itemCount: number): OrderVisualSummaryLayout {
  const clampedCount = Math.max(0, Math.floor(itemCount) || 0);
  return {
    width: ORDER_VISUAL_SUMMARY_WIDTH,
    height: ORDER_VISUAL_SUMMARY_HEADER_HEIGHT + clampedCount * ORDER_VISUAL_SUMMARY_ROW_HEIGHT + ORDER_VISUAL_SUMMARY_FOOTER_HEIGHT,
    headerHeight: ORDER_VISUAL_SUMMARY_HEADER_HEIGHT,
    rowHeight: ORDER_VISUAL_SUMMARY_ROW_HEIGHT,
    footerHeight: ORDER_VISUAL_SUMMARY_FOOTER_HEIGHT,
  };
}

export type OrderVisualSummaryImageLoader = (src: string) => Promise<HTMLImageElement | null>;

/** `crossOrigin="anonymous"` — mesma técnica de `loadImg` em marketing-card.ts. Nunca lança: imagem
 * ausente ou quebrada resolve para `null`, tratado como "Sem imagem" pelo desenho, não como erro fatal. */
function defaultLoadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function fitContain(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const ratio = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const iw = img.naturalWidth * ratio;
  const ih = img.naturalHeight * ratio;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

/** Trunca por LARGURA REAL medida (não por contagem de caracteres) — nome longo (§G) nunca vaza da
 * coluna nem fica ambíguo sem reticências. `ctx.font` precisa já estar setado com a fonte do nome. */
function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "…";
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = text.slice(0, mid).trimEnd() + ellipsis;
    if (ctx.measureText(candidate).width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return text.slice(0, low).trimEnd() + ellipsis;
}

export class OrderVisualSummaryRenderError extends Error {
  constructor(cause?: unknown) {
    super("Não foi possível gerar a imagem do resumo do pedido.", { cause });
    this.name = "OrderVisualSummaryRenderError";
  }
}

export async function renderOrderVisualSummary(
  input: OrderVisualSummaryInput,
  loadImage: OrderVisualSummaryImageLoader = defaultLoadImage,
): Promise<Blob> {
  const layout = computeOrderVisualSummaryLayout(input.items.length);
  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new OrderVisualSummaryRenderError("canvas-context");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, layout.width, layout.height);

  ctx.fillStyle = "#0f172a";
  ctx.font = "900 28px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText((input.storeName || "Pedido").slice(0, 40), PADDING, 44);
  ctx.fillStyle = "#64748b";
  ctx.font = "700 16px sans-serif";
  ctx.fillText("Resumo do pedido", PADDING, 70);

  // Carrega todas as imagens em paralelo — uma falha isolada não bloqueia as demais nem o resumo.
  const images = await Promise.all(
    input.items.map((item) => (item.imageUrl ? loadImage(item.imageUrl) : Promise.resolve(null))),
  );

  let y = layout.headerHeight;
  input.items.forEach((item, index) => {
    const rowTop = y;
    const thumbY = rowTop + (layout.rowHeight - THUMB_SIZE) / 2;
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 2;
    ctx.strokeRect(PADDING, thumbY, THUMB_SIZE, THUMB_SIZE);

    const img = images[index];
    if (img) {
      fitContain(ctx, img, PADDING, thumbY, THUMB_SIZE, THUMB_SIZE);
    } else {
      ctx.fillStyle = "#f1f5f9";
      ctx.fillRect(PADDING, thumbY, THUMB_SIZE, THUMB_SIZE);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "700 12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Sem imagem", PADDING + THUMB_SIZE / 2, thumbY + THUMB_SIZE / 2);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }

    const textX = PADDING + THUMB_SIZE + 24;
    const textMaxWidth = layout.width - textX - PADDING;
    ctx.fillStyle = "#0f172a";
    ctx.font = "800 20px sans-serif";
    ctx.fillText(truncateToWidth(ctx, item.name, textMaxWidth), textX, rowTop + layout.rowHeight / 2 - 10);
    ctx.fillStyle = "#475569";
    ctx.font = "700 16px sans-serif";
    const detail = item.subtotalLabel ? `Qtd: ${item.quantity} · Subtotal: ${item.subtotalLabel}` : `Qtd: ${item.quantity}`;
    ctx.fillText(detail, textX, rowTop + layout.rowHeight / 2 + 18);

    y += layout.rowHeight;
    ctx.strokeStyle = "#f1f5f9";
    ctx.beginPath();
    ctx.moveTo(PADDING, y);
    ctx.lineTo(layout.width - PADDING, y);
    ctx.stroke();
  });

  ctx.fillStyle = "#0f172a";
  ctx.font = "700 18px sans-serif";
  ctx.fillText(`Forma de pagamento: ${input.paymentMethodLabel}`, PADDING, y + 36);
  if (input.totalLabel) {
    ctx.font = "900 28px sans-serif";
    ctx.fillText(`Total: ${input.totalLabel}`, PADDING, y + 76);
  }
  ctx.fillStyle = "#94a3b8";
  ctx.font = "700 13px sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("Criado com Revenda Smart", layout.width - PADDING, layout.height - 16);

  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new OrderVisualSummaryRenderError("canvas-encode"))), "image/png", 0.92);
    } catch (error) {
      reject(new OrderVisualSummaryRenderError(error));
    }
  });
}
