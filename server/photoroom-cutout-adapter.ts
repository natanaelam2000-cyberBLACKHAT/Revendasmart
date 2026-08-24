import {
  composeProductCutoutRgba,
  type ComposeProductCutoutRgbaResult,
  type ProductCutoutMaskBuffer,
  type ProductCutoutOriginalRgbaBuffer,
} from "../shared/product-cutout";
import type { ProductImageCoordinateSpaceVersion } from "../shared/product-image-coordinate-space";
import { decodePhotoroomAlphaPng, hasPngSignature } from "./photoroom-png";

/**
 * RELEASE V1 §6.3 — adapter PhotoRoom REAL, movido de `script/product-cutout-smoke/photoroom.ts` (onde
 * nasceu como harness de dev/smoke-test) para `server/`, para ser reaproveitado pela rota real de
 * produção (`server/product-cutout-photoroom.ts`) SEM duplicar a lógica — o script de smoke continua
 * existindo e agora importa deste mesmo módulo. Comportamento idêntico ao original: nenhuma linha de
 * lógica foi alterada nesta mudança, só o local do arquivo.
 */
export const PHOTOROOM_REMOVE_BACKGROUND_ENDPOINT = "https://sdk.photoroom.com/v1/segment";
export const PHOTOROOM_TIMEOUT_MS = 60_000;
export const PHOTOROOM_MAX_CALLS_PER_RUN = 1;
export const PHOTOROOM_MAX_RETRIES = 0;

export type PhotoroomMaskHttpResponse = {
  readonly status: number;
  readonly contentType: string;
  readonly body: Uint8Array;
};

export type PhotoroomMaskRequest = {
  readonly apiKey: string;
  readonly sourceImageBytes: Uint8Array;
  readonly fileName: string;
  readonly mimeType: string;
};

export type PhotoroomMaskTransport = (request: PhotoroomMaskRequest) => Promise<PhotoroomMaskHttpResponse>;

export type NormalizePhotoroomMaskInput = {
  readonly responseBody: Uint8Array;
  readonly contentType: string;
  readonly expectedWidth: number;
  readonly expectedHeight: number;
  readonly sourceAssetId: string;
  readonly expectedSourceAssetId: string;
  readonly coordinateSpaceVersion: ProductImageCoordinateSpaceVersion;
  readonly expectedCoordinateSpaceVersion: ProductImageCoordinateSpaceVersion;
};

export type NormalizePhotoroomMaskResult =
  | { readonly accepted: true; readonly mask: ProductCutoutMaskBuffer; readonly errors: readonly [] }
  | { readonly accepted: false; readonly errors: readonly string[] };

/**
 * PRO-07F.3B-FIX §1: identidade/dimensões do SOURCE — sempre conhecidas sem decodificar um único
 * pixel (vêm do catálogo de casos, não de um decode). Usadas para validar a mask (Fase 1) mesmo
 * quando o RGBA completo do source não está disponível (ex.: source JPEG, sem decoder no Node).
 */
export type ProductCutoutSourceDimensions = {
  readonly width: number;
  readonly height: number;
  readonly sourceAssetId: string;
  readonly coordinateSpaceVersion: ProductImageCoordinateSpaceVersion;
};

export type RunPhotoroomCutoutInput = {
  readonly apiKey: string;
  readonly sourceImageBytes: Uint8Array;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sourceDimensions: ProductCutoutSourceDimensions;
  /**
   * RGBA já decodificado do SOURCE — opcional. RELEASE V1 §6.4: agora populado pelo caller via `sharp`
   * (server/product-cutout-photoroom.ts) para QUALQUER formato de origem (JPEG/PNG/WebP), não só PNG —
   * a limitação antiga ("só PNG tem decode local") era do harness de smoke-test, nunca uma limitação
   * deste adapter em si. Quando ausente, a Fase 2 (composição local) é pulada por completo.
   */
  readonly originalRgba?: ProductCutoutOriginalRgbaBuffer;
};

/** PRO-07F.3B-FIX §3: os dois estados da Fase 2, distintos do resultado da Fase 1 (provider/mask). */
export type ProductCutoutLocalCompositionStatus = "pending-source-rgba" | "accepted" | "rejected";

export type PhotoroomCutoutAttemptResult = {
  readonly success: boolean;
  readonly callsMade: 0 | 1;
  readonly retries: 0;
  readonly httpStatus: number | null;
  readonly httpOutcome: string;
  readonly potentiallyBilled: boolean;
  readonly errorCode?: string;
  readonly mask?: ProductCutoutMaskBuffer;
  readonly composition?: ComposeProductCutoutRgbaResult;
  /** PRO-07F.3B-RECONCILE-DIAG §4/§6: diagnóstico seguro — nunca o corpo da resposta, só metadados. */
  readonly durationMs?: number;
  readonly contentType?: string;
  readonly bodyLength?: number;
  /**
   * PRO-07F.3B-FIX §3/§4: Fase 1 (provider/mask) vs Fase 2 (composição local), sempre presentes e
   * sempre corretos — nunca "accepted" por omissão. `providerMaskAccepted` é true assim que a mask
   * passa por todas as validações técnicas (HTTP/MIME/assinatura/dimensões/buffer/identidade),
   * independente de a Fase 2 ter rodado. `localCompositionStatus` só é "accepted" quando
   * `composeProductCutoutRgba` + Pixel Gate realmente rodaram e aceitaram — nunca inferido.
   */
  readonly providerMaskAccepted: boolean;
  readonly localCompositionStatus: ProductCutoutLocalCompositionStatus;
  /**
   * PRO-07F.3B-FIX §5: bytes PNG crus da mask, SÓ presentes quando `providerMaskAccepted` é true —
   * nunca para respostas rejeitadas (erro HTTP, MIME errado, decode falho). Existe para permitir salvar
   * `mask.png` para inspeção; nunca é logado/impresso por este módulo, só devolvido para quem chamou.
   */
  readonly rawMaskPngBytes?: Uint8Array;
};

export type PhotoroomCutoutAdapterDependencies = {
  readonly transport?: PhotoroomMaskTransport;
  readonly normalizeMask?: (input: NormalizePhotoroomMaskInput) => NormalizePhotoroomMaskResult;
  readonly compose?: typeof composeProductCutoutRgba;
};

export const defaultPhotoroomMaskTransport: PhotoroomMaskTransport = async (request) => {
  const form = new FormData();
  form.append("image_file", new Blob([request.sourceImageBytes], { type: request.mimeType }), request.fileName);
  form.append("channels", "alpha");
  form.append("format", "png");
  form.append("size", "full");
  form.append("crop", "false");
  const response = await fetch(PHOTOROOM_REMOVE_BACKGROUND_ENDPOINT, {
    method: "POST",
    headers: { "x-api-key": request.apiKey },
    body: form,
    signal: AbortSignal.timeout(PHOTOROOM_TIMEOUT_MS),
  });
  return {
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    body: new Uint8Array(await response.arrayBuffer()),
  };
};

export function normalizePhotoroomMask(input: NormalizePhotoroomMaskInput): NormalizePhotoroomMaskResult {
  const errors: string[] = [];
  if (!/^image\/png(?:;|$)/i.test(input.contentType.trim())) errors.push("invalid-response-mime");
  if (!input.sourceAssetId || input.sourceAssetId !== input.expectedSourceAssetId) errors.push("source-asset-id-mismatch");
  if (input.coordinateSpaceVersion !== input.expectedCoordinateSpaceVersion) errors.push("coordinate-space-mismatch");
  if (errors.length) return { accepted: false, errors };

  // PRO-07F.3B-RECONCILE-DIAG §4: assinatura PNG checada EXPLICITAMENTE antes de qualquer tentativa
  // de decode — nunca deixa um corpo JSON/texto/binário arbitrário chegar ao parser de chunks e ser
  // "interpretado" por acidente; falha fechada com o mesmo código já usado para decode inválido.
  if (!hasPngSignature(input.responseBody)) {
    return { accepted: false, errors: ["mask-decode-failed"] };
  }

  let decoded: ReturnType<typeof decodePhotoroomAlphaPng>;
  try {
    decoded = decodePhotoroomAlphaPng(input.responseBody);
  } catch {
    return { accepted: false, errors: ["mask-decode-failed"] };
  }
  if (decoded.width !== input.expectedWidth || decoded.height !== input.expectedHeight) {
    return { accepted: false, errors: ["mask-dimensions-mismatch"] };
  }
  if (decoded.alpha.length !== input.expectedWidth * input.expectedHeight) {
    return { accepted: false, errors: ["invalid-alpha-buffer-length"] };
  }
  return {
    accepted: true,
    mask: {
      width: decoded.width,
      height: decoded.height,
      data: decoded.alpha,
      sourceAssetId: input.sourceAssetId,
      coordinateSpaceVersion: input.coordinateSpaceVersion,
    },
    errors: [],
  };
}

export async function runPhotoroomCutoutAdapter(
  input: RunPhotoroomCutoutInput,
  dependencies: PhotoroomCutoutAdapterDependencies = {},
  now: () => number = Date.now,
): Promise<PhotoroomCutoutAttemptResult> {
  if (!input.apiKey.trim()) {
    return { success: false, providerMaskAccepted: false, localCompositionStatus: "rejected", callsMade: 0, retries: 0, httpStatus: null, httpOutcome: "not-called", potentiallyBilled: false, errorCode: "PHOTOROOM_API_KEY_MISSING" };
  }

  const startedAt = now();
  const transport = dependencies.transport || defaultPhotoroomMaskTransport;
  let response: PhotoroomMaskHttpResponse;
  try {
    // §6: os bytes do SOURCE (JPEG/PNG/WebP conforme o caso) vão para o provider EXATAMENTE como
    // lidos — nenhuma conversão/decodificação acontece antes do envio.
    response = await transport({
      apiKey: input.apiKey,
      sourceImageBytes: input.sourceImageBytes,
      fileName: input.fileName,
      mimeType: input.mimeType,
    });
  } catch {
    return { success: false, providerMaskAccepted: false, localCompositionStatus: "rejected", callsMade: 1, retries: 0, httpStatus: null, httpOutcome: "network-error", potentiallyBilled: true, errorCode: "NETWORK_ERROR", durationMs: now() - startedAt };
  }
  const durationMs = now() - startedAt;
  // §4: diagnóstico seguro para qualquer branch abaixo — nunca o corpo, só metadados (status já vem
  // em httpStatus/httpOutcome; contentType/bodyLength completam o quadro sem expor conteúdo).
  const safeDiagnostics = { durationMs, contentType: response.contentType, bodyLength: response.body.length };

  if (response.status < 200 || response.status >= 300) {
    const errorCode = response.status === 429 ? "HTTP_429" : response.status >= 400 && response.status < 500 ? "HTTP_4XX" : "HTTP_ERROR";
    return { success: false, providerMaskAccepted: false, localCompositionStatus: "rejected", callsMade: 1, retries: 0, httpStatus: response.status, httpOutcome: `http-${response.status}`, potentiallyBilled: false, errorCode, ...safeDiagnostics };
  }

  // Fase 1 — PROVIDER/MASK: dimensões/identidade vêm de sourceDimensions, nunca de um decode do
  // source — a mask é validada tecnicamente (HTTP já garantido 2xx acima; MIME/assinatura/dimensões/
  // alpha-buffer/identidade dentro de normalizePhotoroomMask) independente de haver RGBA local.
  const normalize = dependencies.normalizeMask || normalizePhotoroomMask;
  const normalized = normalize({
    responseBody: response.body,
    contentType: response.contentType,
    expectedWidth: input.sourceDimensions.width,
    expectedHeight: input.sourceDimensions.height,
    sourceAssetId: input.sourceDimensions.sourceAssetId,
    expectedSourceAssetId: input.sourceDimensions.sourceAssetId,
    coordinateSpaceVersion: input.sourceDimensions.coordinateSpaceVersion,
    expectedCoordinateSpaceVersion: input.sourceDimensions.coordinateSpaceVersion,
  });
  if (!normalized.accepted) {
    return { success: false, providerMaskAccepted: false, localCompositionStatus: "rejected", callsMade: 1, retries: 0, httpStatus: response.status, httpOutcome: "http-2xx-invalid-mask", potentiallyBilled: true, errorCode: normalized.errors[0] || "INVALID_MASK", ...safeDiagnostics };
  }

  // Fase 2 — COMPOSIÇÃO LOCAL: só roda quando existe RGBA original de verdade. Sem isso, a mask real
  // (validada e aceita) fica disponível para inspeção/composição futura no browser, mas o Pixel Gate
  // NUNCA é chamado e o resultado NUNCA é marcado como aceito — sem garantia falsa (§4).
  if (!input.originalRgba) {
    return { success: false, providerMaskAccepted: true, localCompositionStatus: "pending-source-rgba", callsMade: 1, retries: 0, httpStatus: response.status, httpOutcome: "http-2xx-mask-accepted-composition-pending", potentiallyBilled: true, mask: normalized.mask, rawMaskPngBytes: response.body, ...safeDiagnostics };
  }

  const compose = dependencies.compose || composeProductCutoutRgba;
  const composition = compose({
    originalRgba: input.originalRgba,
    mask: normalized.mask,
    width: input.originalRgba.width,
    height: input.originalRgba.height,
  });
  if (!composition.accepted) {
    return { success: false, providerMaskAccepted: true, localCompositionStatus: "rejected", callsMade: 1, retries: 0, httpStatus: response.status, httpOutcome: "http-2xx-pixel-gate-rejected", potentiallyBilled: true, errorCode: "PIXEL_GATE_REJECTED", mask: normalized.mask, composition, rawMaskPngBytes: response.body, ...safeDiagnostics };
  }

  return { success: true, providerMaskAccepted: true, localCompositionStatus: "accepted", callsMade: 1, retries: 0, httpStatus: response.status, httpOutcome: "http-2xx", potentiallyBilled: true, mask: normalized.mask, composition, rawMaskPngBytes: response.body, ...safeDiagnostics };
}
