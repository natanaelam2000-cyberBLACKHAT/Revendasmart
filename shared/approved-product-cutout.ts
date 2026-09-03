/**
 * PRO-07K — contrato PERSISTIDO de um cutout já aprovado, pronto para gravar em
 * `users/{uid}/products/{productId}.approvedCutout` (Firestore). Isolado do runtime V2 (PRO-07J,
 * `shared/marketing-pro-creative-v2.ts`), que só CONSOME este shape — nunca o produz.
 *
 * Nenhum provider é chamado aqui. O write helper (`buildApprovedProductCutoutForPersistence`) só aceita
 * o resultado JÁ VALIDADO de `composeProductCutoutRgba` (shared/product-cutout.ts) — que só existe
 * quando `evaluateProductCutoutPixelGate` aceitou (zero pixel RGB divergente). Não existe caminho para
 * chamar este helper com um objeto "confio que está aprovado": o tipo do parâmetro exige a variante
 * `accepted: true`, que só `composeProductCutoutRgba` produz.
 */
import { PRODUCT_IMAGE_COORDINATE_SPACE_VERSION, type ProductImageCoordinateSpaceVersion } from "./product-image-coordinate-space";
import { PRODUCT_CUTOUT_METHODS, type ProductCutoutMethod, type ComposeProductCutoutRgbaResult } from "./product-cutout";
import { PREMIUM_CREATIVE_FAMILIES, type PremiumCreativeFamily } from "./marketing-pro-creative-v2";

export const APPROVED_PRODUCT_CUTOUT_MIME_TYPE = "image/png" as const;

/** Mesmo shape de `ProductCreativeContext` (PRO-07J) — nunca redeclarado incompatível de propósito. */
export interface ApprovedProductCutoutContext {
  readonly category?: string;
  readonly dominantColorFamily?: string;
  readonly accentColorFamily?: string;
}

/**
 * Shape fechado e serializável. Nunca contém bytes/base64/RGBA/máscara inline, nunca API key, nunca a
 * resposta bruta do provider — só metadados mínimos e referências opacas de Storage.
 */
export interface ApprovedProductCutout {
  /** Identidade do ProductAssetOriginal do qual este cutout foi gerado — usado para detectar staleness (§8). */
  readonly sourceAssetId: string;
  /** Identidade estável do próprio cutout (ex.: `product-cutout-approved:<productId>:sha256:<hash>`). */
  readonly cutoutAssetId: string;
  /** Caminho canônico no Storage — nunca o storagePath da imagem original. */
  readonly storagePath: string;
  readonly downloadUrl?: string;
  readonly width: number;
  readonly height: number;
  readonly mimeType: typeof APPROVED_PRODUCT_CUTOUT_MIME_TYPE;
  readonly coordinateSpaceVersion: ProductImageCoordinateSpaceVersion;
  /** Garantia de tipo, não booleano que pudesse ser falso — mesmo padrão de `allowCrop: false`. */
  readonly preservesOriginalPixels: true;
  readonly method: ProductCutoutMethod;
  /** Metadado mínimo (ex.: "photoroom") — nunca a resposta bruta do provider, nunca a API key. */
  readonly provider?: string;
  readonly createdAt: string;
  readonly family?: PremiumCreativeFamily;
  readonly context?: ApprovedProductCutoutContext;
}

export type ApprovedProductCutoutValidationErrorCode =
  | "invalid-source-asset-id"
  | "invalid-cutout-asset-id"
  | "invalid-storage-path"
  | "inline-storage-path-not-allowed"
  | "invalid-download-url"
  | "inline-download-url-not-allowed"
  | "invalid-dimensions"
  | "invalid-mime-type"
  | "preserves-original-pixels-not-true"
  | "invalid-coordinate-space-version"
  | "invalid-method"
  | "invalid-provider"
  | "invalid-created-at"
  | "invalid-family"
  | "invalid-context"
  | "unexpected-field";

export interface ApprovedProductCutoutValidationError {
  readonly code: ApprovedProductCutoutValidationErrorCode;
  readonly field: string;
  readonly message: string;
}

export type ApprovedProductCutoutValidationResult =
  | { readonly accepted: true; readonly errors: readonly [] }
  | { readonly accepted: false; readonly errors: readonly ApprovedProductCutoutValidationError[] };

function isFinitePositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function isInlineReference(value: string): boolean {
  return /^data:/i.test(value.trim());
}

/**
 * Mesmo espírito do gate de metadados de `shared/product-cutout.ts`: fail-closed, nunca lança, nunca
 * corrige o candidato — só reporta. Espelha as mesmas restrições impostas em `firestore.rules`
 * (isValidApprovedProductCutout) para que o client rejeite localmente o que as Rules rejeitariam.
 */
export function validateApprovedProductCutoutShape(value: unknown): ApprovedProductCutoutValidationResult {
  const errors: ApprovedProductCutoutValidationError[] = [];
  if (!value || typeof value !== "object") {
    return { accepted: false, errors: [{ code: "invalid-source-asset-id", field: "root", message: "approvedCutout precisa ser um objeto" }] };
  }
  const cutout = value as Record<string, unknown>;

  const allowedRootKeys = new Set([
    "sourceAssetId", "cutoutAssetId", "storagePath", "downloadUrl", "width", "height", "mimeType",
    "coordinateSpaceVersion", "preservesOriginalPixels", "method", "provider", "createdAt", "family", "context",
  ]);
  for (const key of Object.keys(cutout)) {
    if (!allowedRootKeys.has(key)) {
      errors.push({ code: "unexpected-field", field: key, message: `campo não permitido em approvedCutout: ${key}` });
    }
  }

  const sourceAssetId = cutout.sourceAssetId;
  if (typeof sourceAssetId !== "string" || !sourceAssetId.trim() || sourceAssetId.length > 512) {
    errors.push({ code: "invalid-source-asset-id", field: "sourceAssetId", message: "sourceAssetId precisa ser uma string não vazia (máx. 512)" });
  }

  const cutoutAssetId = cutout.cutoutAssetId;
  if (typeof cutoutAssetId !== "string" || !cutoutAssetId.trim() || cutoutAssetId.length > 512) {
    errors.push({ code: "invalid-cutout-asset-id", field: "cutoutAssetId", message: "cutoutAssetId precisa ser uma string não vazia (máx. 512)" });
  }

  const storagePath = cutout.storagePath;
  if (typeof storagePath !== "string" || !storagePath.trim() || storagePath.length > 1000) {
    errors.push({ code: "invalid-storage-path", field: "storagePath", message: "storagePath precisa ser uma string não vazia (máx. 1000)" });
  } else if (isInlineReference(storagePath)) {
    errors.push({ code: "inline-storage-path-not-allowed", field: "storagePath", message: "storagePath não pode ser uma referência inline (data:/base64)" });
  }

  if (cutout.downloadUrl !== undefined) {
    const downloadUrl = cutout.downloadUrl;
    if (typeof downloadUrl !== "string" || downloadUrl.length > 2048) {
      errors.push({ code: "invalid-download-url", field: "downloadUrl", message: "downloadUrl, se presente, precisa ser string (máx. 2048)" });
    } else if (isInlineReference(downloadUrl)) {
      errors.push({ code: "inline-download-url-not-allowed", field: "downloadUrl", message: "downloadUrl não pode ser uma referência inline (data:/base64)" });
    }
  }

  if (!isFinitePositiveInt(cutout.width) || (cutout.width as number) > 20000) {
    errors.push({ code: "invalid-dimensions", field: "width", message: "width precisa ser um inteiro finito entre 1 e 20000" });
  }
  if (!isFinitePositiveInt(cutout.height) || (cutout.height as number) > 20000) {
    errors.push({ code: "invalid-dimensions", field: "height", message: "height precisa ser um inteiro finito entre 1 e 20000" });
  }

  if (cutout.mimeType !== APPROVED_PRODUCT_CUTOUT_MIME_TYPE) {
    errors.push({ code: "invalid-mime-type", field: "mimeType", message: `mimeType precisa ser exatamente "${APPROVED_PRODUCT_CUTOUT_MIME_TYPE}"` });
  }

  if (cutout.preservesOriginalPixels !== true) {
    errors.push({ code: "preserves-original-pixels-not-true", field: "preservesOriginalPixels", message: "preservesOriginalPixels precisa ser exatamente true" });
  }

  if (cutout.coordinateSpaceVersion !== PRODUCT_IMAGE_COORDINATE_SPACE_VERSION) {
    errors.push({ code: "invalid-coordinate-space-version", field: "coordinateSpaceVersion", message: `coordinateSpaceVersion precisa ser "${PRODUCT_IMAGE_COORDINATE_SPACE_VERSION}"` });
  }

  if (!(PRODUCT_CUTOUT_METHODS as readonly string[]).includes(cutout.method as string)) {
    errors.push({ code: "invalid-method", field: "method", message: `method precisa ser um de: ${PRODUCT_CUTOUT_METHODS.join(", ")}` });
  }

  if (cutout.provider !== undefined && (typeof cutout.provider !== "string" || cutout.provider.length > 60)) {
    errors.push({ code: "invalid-provider", field: "provider", message: "provider, se presente, precisa ser string curta (máx. 60)" });
  }

  if (typeof cutout.createdAt !== "string" || !cutout.createdAt.trim() || cutout.createdAt.length > 40) {
    errors.push({ code: "invalid-created-at", field: "createdAt", message: "createdAt precisa ser uma string ISO não vazia (máx. 40)" });
  }

  if (cutout.family !== undefined && !(PREMIUM_CREATIVE_FAMILIES as readonly string[]).includes(cutout.family as string)) {
    errors.push({ code: "invalid-family", field: "family", message: `family, se presente, precisa ser um de: ${PREMIUM_CREATIVE_FAMILIES.join(", ")}` });
  }

  if (cutout.context !== undefined) {
    if (!cutout.context || typeof cutout.context !== "object" || Array.isArray(cutout.context)) {
      errors.push({ code: "invalid-context", field: "context", message: "context, se presente, precisa ser um objeto" });
    } else {
      const allowedKeys = new Set(["category", "dominantColorFamily", "accentColorFamily"]);
      for (const key of Object.keys(cutout.context as object)) {
        if (!allowedKeys.has(key)) {
          errors.push({ code: "invalid-context", field: `context.${key}`, message: `campo não permitido em context: ${key}` });
        }
      }
    }
  }

  return errors.length === 0 ? { accepted: true, errors: [] } : { accepted: false, errors };
}

export interface BuildApprovedProductCutoutInput {
  /** Resultado JÁ ACEITO de `composeProductCutoutRgba` — nunca um objeto construído à mão. */
  readonly composed: Extract<ComposeProductCutoutRgbaResult, { readonly accepted: true }>;
  readonly sourceAssetId: string;
  readonly cutoutAssetId: string;
  readonly storagePath: string;
  readonly downloadUrl?: string;
  readonly method: ProductCutoutMethod;
  readonly provider?: string;
  readonly family?: PremiumCreativeFamily;
  readonly context?: ApprovedProductCutoutContext;
  readonly now?: () => Date;
}

/**
 * §6: único caminho para produzir um `ApprovedProductCutout` persistível. Exige o resultado TYPED e
 * ACEITO de `composeProductCutoutRgba` (que só existe depois que `evaluateProductCutoutPixelGate`
 * aceitou — zero pixel RGB divergente) — nenhum caller pode "declarar" um cutout aprovado sem ter
 * passado pelo gate de verdade. width/height vêm do próprio buffer validado, nunca de um valor solto
 * informado pelo caller.
 */
export function buildApprovedProductCutoutForPersistence(input: BuildApprovedProductCutoutInput): ApprovedProductCutout {
  if (input.composed.accepted !== true || input.composed.pixelGate.accepted !== true) {
    throw new Error("buildApprovedProductCutoutForPersistence exige um ComposeProductCutoutRgbaResult aceito (Pixel Preservation Gate aprovado)");
  }
  const nowFn = input.now ?? (() => new Date());
  const cutout: ApprovedProductCutout = {
    sourceAssetId: input.sourceAssetId,
    cutoutAssetId: input.cutoutAssetId,
    storagePath: input.storagePath,
    ...(input.downloadUrl ? { downloadUrl: input.downloadUrl } : {}),
    width: input.composed.cutout.width,
    height: input.composed.cutout.height,
    mimeType: APPROVED_PRODUCT_CUTOUT_MIME_TYPE,
    coordinateSpaceVersion: PRODUCT_IMAGE_COORDINATE_SPACE_VERSION,
    preservesOriginalPixels: true,
    method: input.method,
    ...(input.provider ? { provider: input.provider } : {}),
    createdAt: nowFn().toISOString(),
    ...(input.family ? { family: input.family } : {}),
    ...(input.context ? { context: input.context } : {}),
  };
  const validation = validateApprovedProductCutoutShape(cutout);
  if (!validation.accepted) {
    throw new Error(`ApprovedProductCutout construído é inválido — isso não deveria acontecer: ${validation.errors.map((error) => error.code).join(", ")}`);
  }
  return cutout;
}

/**
 * §8: um cutout persistido fica STALE quando o `sourceAssetId` não bate mais com o asset ATUAL do
 * produto (ex.: a foto original foi trocada). Fail-closed: staleness nunca é ignorada silenciosamente.
 */
export function isApprovedProductCutoutStale(cutout: Pick<ApprovedProductCutout, "sourceAssetId">, currentSourceAssetId: string): boolean {
  return cutout.sourceAssetId !== currentSourceAssetId;
}

/**
 * PLAN-IMPL-05 §9/§12/§36 — decide se uma NOVA preparação profissional (PhotoRoom) pode ser evitada: só
 * quando já existe um cutout aprovado, gerado PELO PROVIDER (`method: "specialized-api"` — nunca o
 * recorte local-heuristic gratuito, que nunca consumiu cota e por isso nunca "conta" como preparação já
 * paga) e ainda não-stale para a foto ATUAL (`isApprovedProductCutoutStale` acima). Pura, sem I/O — o
 * chamador (server/product-cutout-photoroom.ts) decide sozinho o que fazer com o resultado (nunca chama
 * o provider nem reserva cota quando isto devolve `true`).
 */
export function shouldReuseExistingProductCutout(cutout: Pick<ApprovedProductCutout, "sourceAssetId" | "method"> | undefined | null, currentSourceAssetId: string): boolean {
  return Boolean(cutout) && cutout!.method === "specialized-api" && !isApprovedProductCutoutStale(cutout!, currentSourceAssetId);
}

/**
 * Caminho canônico e único (v1) do cutout derivado — nunca o storagePath da imagem original.
 * Deliberadamente FORA de `users/{uid}/products/**`: Storage Rules avaliam TODOS os `match` que
 * casam com um path e permitem a operação se QUALQUER UM permitir (união, não "o mais específico
 * vence") — um path aninhado dentro de `products/**` herdaria a regra genérica (que aceita
 * jpeg/png/webp) mesmo com uma regra mais restrita e mais específica também declarada. Um path irmão
 * dedicado evita esse acúmulo por completo.
 */
export function buildApprovedProductCutoutStoragePath(uid: string, productId: string): string {
  return `users/${uid}/product-cutouts/${productId}/cutout-v1.png`;
}
