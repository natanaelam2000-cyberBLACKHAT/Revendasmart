/**
 * PRO-07 — implementação real do método "local-heuristic" já previsto (mas nunca implementado) em
 * `shared/product-cutout.ts` (`PRODUCT_CUTOUT_METHODS`). Nenhuma IA, nenhum provider externo, nenhuma
 * chamada de rede: remoção de fundo por flood-fill a partir das bordas da imagem, restrita a fundos
 * razoavelmente uniformes (o caso comum de foto de produto tirada sobre mesa/fundo liso).
 *
 * Puro — recebe/devolve buffers RGBA já decodificados, nunca lê arquivo, nunca toca DOM/Canvas. Isso é
 * o que permite testar sem browser (script/smoke-tests.ts) e é o mesmo padrão de
 * `shared/product-cutout.ts` (buffers injetados, nunca decoder próprio).
 */
import { PRODUCT_CUTOUT_MASK_BACKGROUND_VALUE, PRODUCT_CUTOUT_MASK_FOREGROUND_VALUE } from "@shared/product-cutout";

export interface LocalHeuristicRgbaBuffer {
  readonly data: Uint8ClampedArray | Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface LocalHeuristicOptions {
  /** Um canal é "fundo" quando >= este valor E os 3 canais estão próximos entre si (baixa saturação). */
  readonly whiteThreshold?: number;
  /** Diferença máxima entre canais para considerar o pixel "neutro" (evita comer cores claras do produto). */
  readonly maxChannelSpread?: number;
  /** Se o fundo detectado cobrir menos que esta fração da borda da imagem, a heurística falha (§ fallback). */
  readonly minBorderBackgroundFraction?: number;
}

export type LocalHeuristicResult =
  | { readonly ok: true; readonly mask: Uint8Array }
  | { readonly ok: false; readonly reason: "background-not-detected" | "invalid-dimensions" };

const DEFAULTS: Required<LocalHeuristicOptions> = {
  whiteThreshold: 235,
  maxChannelSpread: 18,
  minBorderBackgroundFraction: 0.6,
};

function isNearNeutralLight(r: number, g: number, b: number, whiteThreshold: number, maxChannelSpread: number): boolean {
  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  return min >= whiteThreshold && max - min <= maxChannelSpread;
}

/**
 * Remove fundo por flood-fill a partir das 4 bordas — nunca apaga "branco" que esteja isolado dentro do
 * produto (ex.: um rótulo branco), porque só regiões CONECTADAS à borda entram no flood-fill.
 *
 * Fail-closed: se as bordas da imagem não forem majoritariamente um fundo uniforme (produto fotografado
 * já colado na borda, fundo texturizado/complexo, foto mal enquadrada), devolve `ok:false` em vez de
 * produzir um recorte ruim — quem chama decide o fallback (§2 da tarefa: "fallback se remoção falhar").
 */
export function removeBackgroundLocalHeuristic(
  source: LocalHeuristicRgbaBuffer,
  options: LocalHeuristicOptions = {},
): LocalHeuristicResult {
  const { whiteThreshold, maxChannelSpread, minBorderBackgroundFraction } = { ...DEFAULTS, ...options };
  const { width, height, data } = source;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return { ok: false, reason: "invalid-dimensions" };
  }

  const isBackgroundColor = (idx: number): boolean => {
    const o = idx * 4;
    return isNearNeutralLight(data[o], data[o + 1], data[o + 2], whiteThreshold, maxChannelSpread);
  };

  // Checagem de plausibilidade ANTES do flood-fill: se a borda da imagem não é majoritariamente clara,
  // não há "fundo uniforme" para remover — falha cedo, sem gastar o flood-fill inteiro.
  let borderPixels = 0;
  let borderBackgroundPixels = 0;
  for (let x = 0; x < width; x += 1) {
    borderPixels += 2;
    if (isBackgroundColor(x)) borderBackgroundPixels += 1;
    if (isBackgroundColor((height - 1) * width + x)) borderBackgroundPixels += 1;
  }
  for (let y = 0; y < height; y += 1) {
    borderPixels += 2;
    if (isBackgroundColor(y * width)) borderBackgroundPixels += 1;
    if (isBackgroundColor(y * width + width - 1)) borderBackgroundPixels += 1;
  }
  if (borderPixels === 0 || borderBackgroundPixels / borderPixels < minBorderBackgroundFraction) {
    return { ok: false, reason: "background-not-detected" };
  }

  const visited = new Uint8Array(width * height);
  const isBackground = new Uint8Array(width * height);
  const stack: number[] = [];
  for (let x = 0; x < width; x += 1) {
    stack.push(x);
    stack.push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    stack.push(y * width);
    stack.push(y * width + width - 1);
  }
  while (stack.length > 0) {
    const idx = stack.pop() as number;
    if (visited[idx]) continue;
    visited[idx] = 1;
    if (!isBackgroundColor(idx)) continue;
    isBackground[idx] = 1;
    const x = idx % width;
    const y = (idx - x) / width;
    if (x > 0) stack.push(idx - 1);
    if (x < width - 1) stack.push(idx + 1);
    if (y > 0) stack.push(idx - width);
    if (y < height - 1) stack.push(idx + width);
  }

  // Máscara: 255 = produto (mantém), 0 = fundo (transparente). Convenção de
  // shared/product-cutout.ts (PRODUCT_CUTOUT_MASK_FOREGROUND_VALUE / _BACKGROUND_VALUE).
  const mask = new Uint8Array(width * height);
  for (let idx = 0; idx < width * height; idx += 1) {
    mask[idx] = isBackground[idx] ? PRODUCT_CUTOUT_MASK_BACKGROUND_VALUE : PRODUCT_CUTOUT_MASK_FOREGROUND_VALUE;
  }
  return { ok: true, mask };
}
