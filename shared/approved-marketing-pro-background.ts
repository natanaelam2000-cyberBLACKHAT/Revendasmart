/**
 * PRO-08 — contrato PERSISTIDO de um background gerado pelo provider real, pronto para gravar em
 * `users/{uid}/marketingProGenerations/{generationId}.background` (Firestore). Mesmo espírito de
 * `shared/approved-product-cutout.ts` (PRO-07K): shape fechado, serializável, nunca carrega bytes/
 * base64/resposta bruta do provider — só metadados mínimos e uma referência opaca de Storage.
 *
 * Nunca sobrescreve `product.imageUrl` nem qualquer campo do documento do produto — este contrato só
 * mora dentro do documento de GERAÇÃO (que já é escopado por uid+generationId), nunca no catálogo.
 */
export const MARKETING_PRO_BACKGROUND_ASSET_MIME_TYPES = ["image/jpeg", "image/png"] as const;
export type MarketingProBackgroundAssetMimeType = (typeof MARKETING_PRO_BACKGROUND_ASSET_MIME_TYPES)[number];

/**
 * Shape fechado. `sourceAssetId` é OPCIONAL: a geração do background em si não depende de um
 * approvedCutout existir (só a COMPOSIÇÃO local, client-side, depende — ver §9 da tarefa) — quando o
 * client já tinha um cutout aprovado no momento da geração, o id é registrado aqui só para auditoria.
 */
export interface MarketingProBackgroundAsset {
  /** Igual ao `generationId`/`generationRequestId` do documento pai — nunca um id novo e desalinhado. */
  readonly operationId: string;
  readonly generationRequestId: string;
  /** Identificador curto do provider (ex.: "google") — nunca a resposta bruta, nunca a API key. */
  readonly provider: string;
  readonly model: string;
  readonly style: string;
  readonly format: string;
  readonly createdAt: string;
  readonly sourceProductId: string;
  readonly sourceAssetId?: string;
  /** Caminho canônico no Storage — nunca o storagePath da imagem original do produto. */
  readonly backgroundAssetPath: string;
  readonly backgroundDownloadUrl?: string;
  readonly width: number;
  readonly height: number;
  readonly mimeType: MarketingProBackgroundAssetMimeType;
  /** Referência ao ledger de custo (`server/marketing-pro-cost-guard.ts`) — quanto foi reservado para esta chamada. */
  readonly costReservationUsd: number;
}

export type MarketingProBackgroundAssetValidationErrorCode =
  | "invalid-operation-id"
  | "invalid-generation-request-id"
  | "invalid-provider"
  | "invalid-model"
  | "invalid-style"
  | "invalid-format"
  | "invalid-created-at"
  | "invalid-source-product-id"
  | "invalid-source-asset-id"
  | "invalid-background-asset-path"
  | "inline-background-asset-path-not-allowed"
  | "invalid-background-download-url"
  | "inline-background-download-url-not-allowed"
  | "invalid-dimensions"
  | "invalid-mime-type"
  | "invalid-cost-reservation"
  | "unexpected-field";

export interface MarketingProBackgroundAssetValidationError {
  readonly code: MarketingProBackgroundAssetValidationErrorCode;
  readonly field: string;
  readonly message: string;
}

export type MarketingProBackgroundAssetValidationResult =
  | { readonly accepted: true; readonly errors: readonly [] }
  | { readonly accepted: false; readonly errors: readonly MarketingProBackgroundAssetValidationError[] };

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isInlineReference(value: string): boolean {
  return /^data:/i.test(value.trim());
}

function isFinitePositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

const ALLOWED_ROOT_KEYS = new Set([
  "operationId", "generationRequestId", "provider", "model", "style", "format", "createdAt",
  "sourceProductId", "sourceAssetId", "backgroundAssetPath", "backgroundDownloadUrl", "width", "height",
  "mimeType", "costReservationUsd",
]);

/** Fail-closed, nunca lança, nunca corrige o candidato — só reporta (mesmo padrão de approved-product-cutout.ts). */
export function validateMarketingProBackgroundAssetShape(value: unknown): MarketingProBackgroundAssetValidationResult {
  if (!value || typeof value !== "object") {
    return { accepted: false, errors: [{ code: "invalid-operation-id", field: "root", message: "background precisa ser um objeto" }] };
  }
  const asset = value as Record<string, unknown>;
  const errors: MarketingProBackgroundAssetValidationError[] = [];

  for (const key of Object.keys(asset)) {
    if (!ALLOWED_ROOT_KEYS.has(key)) {
      errors.push({ code: "unexpected-field", field: key, message: `campo não permitido em background: ${key}` });
    }
  }

  if (!isNonEmptyString(asset.operationId, 80)) errors.push({ code: "invalid-operation-id", field: "operationId", message: "operationId precisa ser string não vazia (máx. 80)" });
  if (!isNonEmptyString(asset.generationRequestId, 80)) errors.push({ code: "invalid-generation-request-id", field: "generationRequestId", message: "generationRequestId precisa ser string não vazia (máx. 80)" });
  if (asset.operationId !== asset.generationRequestId) errors.push({ code: "invalid-generation-request-id", field: "generationRequestId", message: "generationRequestId precisa ser idêntico a operationId" });
  if (!isNonEmptyString(asset.provider, 60)) errors.push({ code: "invalid-provider", field: "provider", message: "provider precisa ser string não vazia (máx. 60)" });
  if (!isNonEmptyString(asset.model, 120)) errors.push({ code: "invalid-model", field: "model", message: "model precisa ser string não vazia (máx. 120)" });
  if (!isNonEmptyString(asset.style, 40)) errors.push({ code: "invalid-style", field: "style", message: "style precisa ser string não vazia (máx. 40)" });
  if (!isNonEmptyString(asset.format, 40)) errors.push({ code: "invalid-format", field: "format", message: "format precisa ser string não vazia (máx. 40)" });
  if (!isNonEmptyString(asset.createdAt, 40)) errors.push({ code: "invalid-created-at", field: "createdAt", message: "createdAt precisa ser string ISO não vazia (máx. 40)" });
  if (!isNonEmptyString(asset.sourceProductId, 80)) errors.push({ code: "invalid-source-product-id", field: "sourceProductId", message: "sourceProductId precisa ser string não vazia (máx. 80)" });

  if (asset.sourceAssetId !== undefined && !isNonEmptyString(asset.sourceAssetId, 512)) {
    errors.push({ code: "invalid-source-asset-id", field: "sourceAssetId", message: "sourceAssetId, se presente, precisa ser string não vazia (máx. 512)" });
  }

  const backgroundAssetPath = asset.backgroundAssetPath;
  if (!isNonEmptyString(backgroundAssetPath, 1000)) {
    errors.push({ code: "invalid-background-asset-path", field: "backgroundAssetPath", message: "backgroundAssetPath precisa ser string não vazia (máx. 1000)" });
  } else if (isInlineReference(backgroundAssetPath)) {
    errors.push({ code: "inline-background-asset-path-not-allowed", field: "backgroundAssetPath", message: "backgroundAssetPath não pode ser uma referência inline (data:/base64)" });
  }

  if (asset.backgroundDownloadUrl !== undefined) {
    const url = asset.backgroundDownloadUrl;
    if (typeof url !== "string" || url.length > 2048) {
      errors.push({ code: "invalid-background-download-url", field: "backgroundDownloadUrl", message: "backgroundDownloadUrl, se presente, precisa ser string (máx. 2048)" });
    } else if (isInlineReference(url)) {
      errors.push({ code: "inline-background-download-url-not-allowed", field: "backgroundDownloadUrl", message: "backgroundDownloadUrl não pode ser uma referência inline (data:/base64)" });
    }
  }

  if (!isFinitePositiveInt(asset.width) || (asset.width as number) > 20000) errors.push({ code: "invalid-dimensions", field: "width", message: "width precisa ser inteiro finito entre 1 e 20000" });
  if (!isFinitePositiveInt(asset.height) || (asset.height as number) > 20000) errors.push({ code: "invalid-dimensions", field: "height", message: "height precisa ser inteiro finito entre 1 e 20000" });

  if (!MARKETING_PRO_BACKGROUND_ASSET_MIME_TYPES.includes(asset.mimeType as MarketingProBackgroundAssetMimeType)) {
    errors.push({ code: "invalid-mime-type", field: "mimeType", message: `mimeType precisa ser um de: ${MARKETING_PRO_BACKGROUND_ASSET_MIME_TYPES.join(", ")}` });
  }

  if (typeof asset.costReservationUsd !== "number" || !Number.isFinite(asset.costReservationUsd) || asset.costReservationUsd <= 0) {
    errors.push({ code: "invalid-cost-reservation", field: "costReservationUsd", message: "costReservationUsd precisa ser número finito positivo" });
  }

  return errors.length === 0 ? { accepted: true, errors: [] } : { accepted: false, errors };
}

/**
 * Caminho canônico do background derivado — deliberadamente FORA de `users/{uid}/products/**` (mesmo
 * raciocínio de `buildApprovedProductCutoutStoragePath`: Storage Rules avaliam por união de todos os
 * `match` que casam com o path, então um path irmão dedicado evita herdar uma regra mais larga).
 * Escopado por `generationId`, não por `productId`: cada geração é um asset independente — nada aqui é
 * sobrescrito por uma geração seguinte do mesmo produto.
 */
export function buildMarketingProBackgroundStoragePath(uid: string, generationId: string, extension: "jpg" | "png"): string {
  return `users/${uid}/marketing-pro-backgrounds/${generationId}/background-v1.${extension}`;
}
