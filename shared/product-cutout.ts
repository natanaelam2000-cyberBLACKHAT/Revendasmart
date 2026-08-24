/**
 * PRO-07F.2B — contrato local para representar e validar um ProductCutout (produto com fundo
 * removido), SEM implementar remoção de fundo real: nenhum provider, nenhuma IA, nenhuma máscara
 * gerada nesta sprint. Este módulo só define a forma de um cutout candidato, valida seus metadados
 * contra o ProductAssetOriginal (PRO-07B) que o originou, e valida — a nível de PIXEL — que um cutout
 * candidato preserva os pixels originais do produto.
 *
 * Fluxo desta sprint: ProductAssetOriginal -> ProductCutoutCandidate -> Pixel Preservation Validation
 * -> aceito | rejeitado. A escolha de QUEM gera a máscara (heurística local, API especializada, modelo
 * multimodal) fica para uma sprint futura — aqui só o contrato e os dois gates existem.
 */

import { PRODUCT_IMAGE_COORDINATE_SPACE_VERSION, type ProductImageCoordinateSpaceVersion } from "./product-image-coordinate-space";
import type { ProductAssetOriginal } from "./product-image-preservation";

/** §2: valores de máscara — canal único de 8 bits por pixel, mesma convenção de um canal alpha. */
export const PRODUCT_CUTOUT_MASK_BACKGROUND_VALUE = 0;
export const PRODUCT_CUTOUT_MASK_FOREGROUND_VALUE = 255;

export const PRODUCT_CUTOUT_METHODS = ["local-heuristic", "specialized-api", "multimodal-model"] as const;
export type ProductCutoutMethod = (typeof PRODUCT_CUTOUT_METHODS)[number];

/**
 * Cutout candidato — ainda não validado. `maskRef` é referência opaca (ex.: storagePath), nunca
 * bytes/base64.
 *
 * §2 — contrato da máscara referenciada por `maskRef` (não verificado por este tipo, verificado pelos
 * gates abaixo quando aplicável): usa o MESMO coordinate space do source; tem exatamente
 * sourceWidth × sourceHeight — nunca recortada para uma bounding box menor, nunca redimensionada; um
 * canal de 8 bits por pixel, onde PRODUCT_CUTOUT_MASK_BACKGROUND_VALUE (0) = fundo e
 * PRODUCT_CUTOUT_MASK_FOREGROUND_VALUE (255) = produto; valores intermediários (1-254) são permitidos
 * e representam antialias/matting na borda — ver evaluateProductCutoutPixelGate (§7) para a regra de
 * preservação de RGB nessa faixa.
 */
export interface ProductCutoutCandidate {
  readonly sourceAssetId: string;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly coordinateSpaceVersion: ProductImageCoordinateSpaceVersion;
  readonly maskRef: string;
  readonly maskWidth: number;
  readonly maskHeight: number;
  readonly method: ProductCutoutMethod;
  readonly modelVersion?: string;
  readonly confidence?: number;
  /** Garantia de tipo, não um booleano que pudesse ser falso — mesmo padrão de `allowCrop: false` (PRO-07B). */
  readonly preservesOriginalPixels: true;
}

function isFinitePositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

// ---------------------------------------------------------------------------------------------
// §3: gate de METADADOS — valida o candidato contra o ProductAssetOriginal, nunca lê pixels.
// ---------------------------------------------------------------------------------------------

export type ProductCutoutValidationErrorCode =
  | "invalid-source-asset-id"
  | "source-asset-id-mismatch"
  | "invalid-source-width"
  | "invalid-source-height"
  | "source-dimensions-mismatch"
  | "invalid-mask-width"
  | "invalid-mask-height"
  | "mask-dimensions-mismatch"
  | "invalid-coordinate-space-version"
  | "coordinate-space-mismatch"
  | "preserves-original-pixels-not-true"
  | "invalid-confidence"
  | "invalid-method"
  | "invalid-mask-ref"
  | "inline-mask-not-allowed";

export interface ProductCutoutValidationError {
  readonly code: ProductCutoutValidationErrorCode;
  readonly field: string;
  readonly message: string;
}

export interface ProductCutoutGateInput {
  readonly asset: ProductAssetOriginal;
  readonly candidate: ProductCutoutCandidate;
}

export type ProductCutoutGateResult =
  | { readonly accepted: true; readonly errors: readonly [] }
  | { readonly accepted: false; readonly errors: readonly ProductCutoutValidationError[] };

function issue(code: ProductCutoutValidationErrorCode, field: string, message: string): ProductCutoutValidationError {
  return { code, field, message };
}

/**
 * §3: valida os METADADOS de um cutout candidato contra o ProductAssetOriginal que o originou. Nunca
 * decodifica/lê pixels — isso é `evaluateProductCutoutPixelGate`, abaixo. Fail-closed: qualquer
 * inconsistência é reportada em `errors`, nunca lança, nunca tenta corrigir o candidato (§10).
 */
export function evaluateProductCutoutGate(input: ProductCutoutGateInput): ProductCutoutGateResult {
  const errors: ProductCutoutValidationError[] = [];
  const { asset, candidate } = input;

  // A) sourceAssetId precisa bater com o asset esperado.
  if (!String(candidate.sourceAssetId || "").trim()) {
    errors.push(issue("invalid-source-asset-id", "candidate.sourceAssetId", "sourceAssetId é obrigatório"));
  } else if (candidate.sourceAssetId !== asset.assetId) {
    errors.push(issue("source-asset-id-mismatch", "candidate.sourceAssetId", "sourceAssetId precisa corresponder ao ProductAssetOriginal.assetId"));
  }

  // B) sourceWidth/sourceHeight precisam bater com o asset.
  if (!isFinitePositiveInt(candidate.sourceWidth)) {
    errors.push(issue("invalid-source-width", "candidate.sourceWidth", "sourceWidth precisa ser um inteiro finito maior que zero"));
  }
  if (!isFinitePositiveInt(candidate.sourceHeight)) {
    errors.push(issue("invalid-source-height", "candidate.sourceHeight", "sourceHeight precisa ser um inteiro finito maior que zero"));
  }
  if (
    isFinitePositiveInt(candidate.sourceWidth) && isFinitePositiveInt(candidate.sourceHeight)
    && (candidate.sourceWidth !== asset.width || candidate.sourceHeight !== asset.height)
  ) {
    errors.push(issue("source-dimensions-mismatch", "candidate.sourceWidth", "sourceWidth/sourceHeight precisam bater exatamente com o ProductAssetOriginal"));
  }

  // C) maskWidth/maskHeight precisam bater EXATAMENTE com sourceWidth/sourceHeight — a máscara nunca é
  // recortada para uma bounding box menor nem redimensionada (§2).
  if (!isFinitePositiveInt(candidate.maskWidth)) {
    errors.push(issue("invalid-mask-width", "candidate.maskWidth", "maskWidth precisa ser um inteiro finito maior que zero"));
  }
  if (!isFinitePositiveInt(candidate.maskHeight)) {
    errors.push(issue("invalid-mask-height", "candidate.maskHeight", "maskHeight precisa ser um inteiro finito maior que zero"));
  }
  if (
    isFinitePositiveInt(candidate.maskWidth) && isFinitePositiveInt(candidate.maskHeight)
    && (candidate.maskWidth !== candidate.sourceWidth || candidate.maskHeight !== candidate.sourceHeight)
  ) {
    errors.push(issue("mask-dimensions-mismatch", "candidate.maskWidth", "a máscara precisa ter exatamente sourceWidth × sourceHeight — nunca recortada, nunca redimensionada"));
  }

  // D) coordinateSpaceVersion precisa ser a canônica atual e, quando o asset já declara uma versão,
  // precisa concordar com ela — mesmo tratamento aditivo/fail-closed do PRO-07F.2A: asset sem o campo
  // não bloqueia, mas uma versão DECLARADA e divergente é recusada.
  if (candidate.coordinateSpaceVersion !== PRODUCT_IMAGE_COORDINATE_SPACE_VERSION) {
    errors.push(issue("invalid-coordinate-space-version", "candidate.coordinateSpaceVersion", `coordinateSpaceVersion precisa ser "${PRODUCT_IMAGE_COORDINATE_SPACE_VERSION}"`));
  } else if (asset.coordinateSpaceVersion !== undefined && asset.coordinateSpaceVersion !== candidate.coordinateSpaceVersion) {
    errors.push(issue("coordinate-space-mismatch", "candidate.coordinateSpaceVersion", "coordinateSpaceVersion diverge do ProductAssetOriginal"));
  }

  // E) preservesOriginalPixels precisa ser literalmente true — não apenas truthy.
  if (candidate.preservesOriginalPixels !== true) {
    errors.push(issue("preserves-original-pixels-not-true", "candidate.preservesOriginalPixels", "preservesOriginalPixels precisa ser exatamente true"));
  }

  // F) confidence, se presente, precisa ser finito e estar em [0,1].
  if (candidate.confidence !== undefined) {
    const confidence = candidate.confidence;
    if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      errors.push(issue("invalid-confidence", "candidate.confidence", "confidence, se presente, precisa ser finito e estar entre 0 e 1"));
    }
  }

  // G) method precisa ser um dos valores permitidos.
  if (!(PRODUCT_CUTOUT_METHODS as readonly string[]).includes(candidate.method)) {
    errors.push(issue("invalid-method", "candidate.method", `method precisa ser um de: ${PRODUCT_CUTOUT_METHODS.join(", ")}`));
  }

  // H/I) maskRef não pode ser vazio nem uma referência inline (data:/base64).
  const maskRef = String(candidate.maskRef || "").trim();
  if (!maskRef) {
    errors.push(issue("invalid-mask-ref", "candidate.maskRef", "maskRef é obrigatório"));
  } else if (/^data:/i.test(maskRef)) {
    errors.push(issue("inline-mask-not-allowed", "candidate.maskRef", "maskRef não pode ser uma referência inline (data:/base64) — precisa ser uma referência opaca"));
  }

  return errors.length === 0 ? { accepted: true, errors: [] } : { accepted: false, errors };
}

// ---------------------------------------------------------------------------------------------
// §4-§8: gate de PIXELS — opera sobre buffers já decodificados/injetados (nenhum decoder novo, §8).
// ---------------------------------------------------------------------------------------------

/** §4/§8: buffer RGBA já decodificado — 4 bytes por pixel (R,G,B,A), sem nenhuma leitura de arquivo aqui. */
export interface ProductCutoutRgbaBuffer {
  readonly data: Uint8ClampedArray | Uint8Array;
  readonly width: number;
  readonly height: number;
}

/** §2/§4: buffer da máscara — 1 byte por pixel (0=fundo, 255=produto, intermediário=antialias/matting). */
export interface ProductCutoutMaskBuffer {
  readonly data: Uint8ClampedArray | Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly coordinateSpaceVersion: ProductImageCoordinateSpaceVersion;
  readonly sourceAssetId: string;
}

/** RGBA canônico do asset original ao qual a máscara declara pertencer. */
export interface ProductCutoutOriginalRgbaBuffer extends ProductCutoutRgbaBuffer {
  readonly coordinateSpaceVersion: ProductImageCoordinateSpaceVersion;
  readonly sourceAssetId: string;
}

/**
 * Boundary deliberadamente genérica. Um adapter futuro normaliza seu resultado para um buffer de
 * máscara canônico; o composer nunca conhece provider, formato remoto ou credenciais.
 */
export type NormalizeProductCutoutProviderMask<TProviderResult = unknown> = (
  providerResult: TProviderResult,
) => ProductCutoutMaskBuffer;

export type ProductCutoutPixelGateErrorCode = "invalid-dimensions" | "dimensions-mismatch" | "buffer-size-mismatch" | "rgb-mismatch";

export interface ProductCutoutPixelGateError {
  readonly code: ProductCutoutPixelGateErrorCode;
  readonly message: string;
  readonly pixelIndex?: number;
}

export interface ProductCutoutPixelGateInput {
  readonly original: ProductCutoutRgbaBuffer;
  readonly cutout: ProductCutoutRgbaBuffer;
  readonly mask: ProductCutoutMaskBuffer;
  readonly width: number;
  readonly height: number;
}

export type ProductCutoutPixelGateResult =
  | { readonly accepted: true; readonly errors: readonly [] }
  | { readonly accepted: false; readonly errors: readonly ProductCutoutPixelGateError[] };

/**
 * §3-§7: valida, pixel a pixel, que um cutout candidato preserva os pixels RGB originais do produto.
 *
 * Regra P0 adotada (§7 — "a garantia mais forte"): CUTOUT = ORIGINAL RGB + NOVO ALPHA. Para TODO pixel
 * da imagem — dentro ou fora do produto, independente do valor da máscara — cutout.R/G/B precisam ser
 * IDÊNTICOS a original.R/G/B; só o canal alpha pode divergir. Nenhuma tolerância perceptual, nenhuma
 * comparação "quase igual": 1 byte de RGB diferente já rejeita (§9 item S — a preferência P0 é
 * rejeitar também mudanças de RGB fora do produto, não só dentro dele).
 *
 * `mask` participa da validação ESTRUTURAL (dimensões precisam bater com width/height — nunca
 * recortada, nunca redimensionada, §2), mas o VALOR de cada pixel da máscara não influencia a regra de
 * RGB acima: ela é global, não condicionada a "isto é produto ou fundo". Isso é intencional — mantém o
 * gate simples e fecha por completo o risco de inpainting/redesenho em qualquer região da imagem,
 * incluindo o fundo (§5: fundo pode ficar transparente, mas nunca ganhar pixels RGB novos).
 *
 * Rejeita no PRIMEIRO pixel divergente (fail-closed, §10) — nunca continua comparando para "corrigir"
 * ou relatar todas as divergências: 1 pixel diferente já é suficiente para recusar o cutout inteiro.
 */
export function evaluateProductCutoutPixelGate(input: ProductCutoutPixelGateInput): ProductCutoutPixelGateResult {
  const { original, cutout, mask, width, height } = input;

  if (!isFinitePositiveInt(width) || !isFinitePositiveInt(height)) {
    return { accepted: false, errors: [{ code: "invalid-dimensions", message: "width/height precisam ser inteiros finitos maiores que zero" }] };
  }

  const dimensionErrors: ProductCutoutPixelGateError[] = [];
  for (const [label, buffer] of [["original", original], ["cutout", cutout], ["mask", mask]] as const) {
    if (buffer.width !== width || buffer.height !== height) {
      dimensionErrors.push({ code: "dimensions-mismatch", message: `${label}.width/height precisam bater exatamente com width/height informados` });
    }
  }
  if (dimensionErrors.length > 0) return { accepted: false, errors: dimensionErrors };

  const pixelCount = width * height;
  const expectedRgbaLength = pixelCount * 4;
  const sizeErrors: ProductCutoutPixelGateError[] = [];
  if (original.data.length !== expectedRgbaLength) sizeErrors.push({ code: "buffer-size-mismatch", message: `original.data precisa ter exatamente ${expectedRgbaLength} bytes (RGBA)` });
  if (cutout.data.length !== expectedRgbaLength) sizeErrors.push({ code: "buffer-size-mismatch", message: `cutout.data precisa ter exatamente ${expectedRgbaLength} bytes (RGBA)` });
  if (mask.data.length !== pixelCount) sizeErrors.push({ code: "buffer-size-mismatch", message: `mask.data precisa ter exatamente ${pixelCount} bytes (1 canal por pixel)` });
  if (sizeErrors.length > 0) return { accepted: false, errors: sizeErrors };

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const offset = pixelIndex * 4;
    if (
      original.data[offset] !== cutout.data[offset]
      || original.data[offset + 1] !== cutout.data[offset + 1]
      || original.data[offset + 2] !== cutout.data[offset + 2]
    ) {
      return {
        accepted: false,
        errors: [{
          code: "rgb-mismatch",
          message: `pixel ${pixelIndex}: RGB do cutout diverge do original — só o canal alpha pode mudar`,
          pixelIndex,
        }],
      };
    }
  }

  return { accepted: true, errors: [] };
}

// ---------------------------------------------------------------------------------------------
// PRO-07F.3A: composer local puro — ORIGINAL RGB + MASK ALPHA, seguido obrigatoriamente do Pixel Gate.
// ---------------------------------------------------------------------------------------------

export type ProductCutoutComposerErrorCode =
  | "invalid-dimensions"
  | "dimensions-mismatch"
  | "buffer-size-mismatch"
  | "invalid-source-asset-id"
  | "source-asset-id-mismatch"
  | "invalid-coordinate-space-version"
  | "coordinate-space-mismatch"
  | "pixel-gate-rejected";

export interface ProductCutoutComposerError {
  readonly code: ProductCutoutComposerErrorCode;
  readonly field: string;
  readonly message: string;
  readonly pixelGateErrors?: readonly ProductCutoutPixelGateError[];
}

export interface ComposeProductCutoutRgbaInput {
  readonly originalRgba: ProductCutoutOriginalRgbaBuffer;
  readonly mask: ProductCutoutMaskBuffer;
  readonly width: number;
  readonly height: number;
}

export type ComposeProductCutoutRgbaResult =
  | {
      readonly accepted: true;
      readonly rgba: Uint8ClampedArray;
      readonly cutout: ProductCutoutRgbaBuffer;
      readonly pixelGate: Extract<ProductCutoutPixelGateResult, { readonly accepted: true }>;
      readonly errors: readonly [];
    }
  | {
      readonly accepted: false;
      readonly errors: readonly ProductCutoutComposerError[];
    };

function composerIssue(
  code: ProductCutoutComposerErrorCode,
  field: string,
  message: string,
): ProductCutoutComposerError {
  return { code, field, message };
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isSafeInteger(value) && value > 0;
}

/**
 * Compõe um cutout canônico sem alterar os inputs e sem qualquer transformação de cor:
 * output.RGB = original.RGB e output.A = mask[pixel]. Não redimensiona, recorta, interpola ou
 * premultiplica. Rejeições normais são estruturadas; nenhuma tentativa de corrigir o input é feita.
 */
export function composeProductCutoutRgba(input: ComposeProductCutoutRgbaInput): ComposeProductCutoutRgbaResult {
  const { originalRgba, mask, width, height } = input;
  const errors: ProductCutoutComposerError[] = [];

  if (!isPositiveSafeInteger(width) || !isPositiveSafeInteger(height)) {
    errors.push(composerIssue("invalid-dimensions", "width/height", "width/height precisam ser inteiros finitos, seguros e maiores que zero"));
    return { accepted: false, errors };
  }

  if (originalRgba.width !== width || originalRgba.height !== height) {
    errors.push(composerIssue("dimensions-mismatch", "originalRgba.width/height", "o RGBA original precisa usar exatamente width × height"));
  }
  if (mask.width !== width || mask.height !== height) {
    errors.push(composerIssue("dimensions-mismatch", "mask.width/height", "a máscara precisa usar exatamente o coordinate space width × height do original"));
  }

  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount)) {
    errors.push(composerIssue("invalid-dimensions", "width/height", "width × height excede o limite inteiro seguro"));
  } else {
    if (originalRgba.data.length !== pixelCount * 4) {
      errors.push(composerIssue("buffer-size-mismatch", "originalRgba.data", `originalRgba.data precisa ter exatamente ${pixelCount * 4} bytes`));
    }
    if (mask.data.length !== pixelCount) {
      errors.push(composerIssue("buffer-size-mismatch", "mask.data", `mask.data precisa ter exatamente ${pixelCount} bytes`));
    }
  }

  const sourceAssetId = String(originalRgba.sourceAssetId || "").trim();
  const maskSourceAssetId = String(mask.sourceAssetId || "").trim();
  if (!sourceAssetId || !maskSourceAssetId) {
    errors.push(composerIssue("invalid-source-asset-id", "sourceAssetId", "originalRgba e mask precisam declarar sourceAssetId não vazio"));
  } else if (sourceAssetId !== maskSourceAssetId) {
    errors.push(composerIssue("source-asset-id-mismatch", "mask.sourceAssetId", "a máscara precisa pertencer exatamente ao asset original"));
  }

  if (originalRgba.coordinateSpaceVersion !== mask.coordinateSpaceVersion) {
    errors.push(composerIssue("coordinate-space-mismatch", "mask.coordinateSpaceVersion", "coordinateSpaceVersion da máscara diverge do original"));
  }
  if (
    originalRgba.coordinateSpaceVersion !== PRODUCT_IMAGE_COORDINATE_SPACE_VERSION
    || mask.coordinateSpaceVersion !== PRODUCT_IMAGE_COORDINATE_SPACE_VERSION
  ) {
    errors.push(composerIssue("invalid-coordinate-space-version", "coordinateSpaceVersion", `original e máscara precisam usar "${PRODUCT_IMAGE_COORDINATE_SPACE_VERSION}"`));
  }

  if (errors.length > 0) return { accepted: false, errors };

  const rgba = new Uint8ClampedArray(pixelCount * 4);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const offset = pixelIndex * 4;
    rgba[offset] = originalRgba.data[offset];
    rgba[offset + 1] = originalRgba.data[offset + 1];
    rgba[offset + 2] = originalRgba.data[offset + 2];
    rgba[offset + 3] = mask.data[pixelIndex];
  }

  const cutout: ProductCutoutRgbaBuffer = { data: rgba, width, height };
  const pixelGate = evaluateProductCutoutPixelGate({ original: originalRgba, cutout, mask, width, height });
  if (!pixelGate.accepted) {
    return {
      accepted: false,
      errors: [{
        code: "pixel-gate-rejected",
        field: "cutout",
        message: "o cutout composto foi rejeitado pelo Pixel Preservation Gate",
        pixelGateErrors: pixelGate.errors,
      }],
    };
  }

  return { accepted: true, rgba, cutout, pixelGate, errors: [] };
}
