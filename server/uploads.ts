/**
 * RELEASE-06 — endpoint server-side de upload de imagem, com validação real de conteúdo (magic bytes +
 * dimensões, `shared/image-validation.ts`) e quota server-owned (`server/upload-quota.ts`).
 *
 * Por que um endpoint novo, em vez de só reforçar Storage Rules: Firebase Storage Security Rules só
 * enxergam metadata do request (tamanho, `contentType` DECLARADO) — nunca os bytes reais do arquivo,
 * nunca a dimensão real, nunca um contador acumulado entre requests. A única fronteira capaz de provar
 * "isto é realmente uma imagem válida, deste tamanho, e este usuário ainda tem quota" é o servidor.
 *
 * Endpoints:
 *   POST   /api/uploads/product/:productId   → imagem derivada do produto (o mesmo asset que hoje ia
 *                                               direto do client para o Storage via uploadBytes)
 *   POST   /api/uploads/logo                 → logo da loja
 *   POST   /api/uploads/cutout/:productId    → approved cutout (PNG-only) — infraestrutura pronta para
 *                                               quando o pipeline real de cutout (PRO-07K) ganhar um
 *                                               writer; nenhum caller de produção usa esta rota ainda.
 *   DELETE /api/uploads/:kind[/:targetId]    → RELEASE-18: única forma de apagar um asset destes paths
 *                                               agora que storage.rules nega write/delete direto do
 *                                               client (ver `cleanupUploadedProductImages` em
 *                                               add-product.tsx — rollback de upload quando o Firestore
 *                                               write subsequente falha). `storagePath` no body precisa
 *                                               bater EXATAMENTE com um path que `storagePathFor` teria
 *                                               produzido para o `uid` autenticado — nunca aceita um path
 *                                               arbitrário, mesmo dentro do próprio namespace do usuário.
 *
 * Corpo da requisição (POST): bytes crus da imagem (Content-Type = o MIME declarado). Sem multipart, sem
 * nova dependência — `express.raw()` já cobre isso.
 */
import type { Express, NextFunction, Request, Response } from "express";
import express from "express";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { logError, logInfo, logWarn } from "./logger";
import {
  validateImageUploadBytes,
  DEFAULT_IMAGE_UPLOAD_LIMITS,
  CUTOUT_UPLOAD_LIMITS,
  IMAGE_UPLOAD_MAX_BYTES,
} from "../shared/image-validation";
import { reserveUploadQuota, releaseUploadQuotaReservation, recordUploadReceipt, contentHashOf, uploadReceiptKey } from "./upload-quota";

function uploadInfo(message: string, details?: Record<string, unknown>): void {
  logInfo("uploads.log", { message, details });
}
function uploadWarn(message: string, details?: Record<string, unknown>): void {
  logWarn("uploads.log", { message, details });
}
function uploadError(message: string, errorMsg: string, details?: Record<string, unknown>): void {
  logError("uploads.log", errorMsg, { message, details });
}

type UploadKind = "product" | "logo" | "cutout" | "campaign-prize";

function isUploadKind(value: unknown): value is UploadKind {
  return value === "product" || value === "logo" || value === "cutout" || value === "campaign-prize";
}

/** Só alfanumérico/traço/underscore — nunca aceita `/`, `..` ou qualquer separador de path. */
function sanitizeTargetId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200 || !/^[A-Za-z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

function extensionFor(format: string): string {
  if (format === "image/png") return "png";
  if (format === "image/webp") return "webp";
  return "jpg";
}

/**
 * §7 Path ownership: `uid` SEMPRE vem de `req.firebaseUid` (nunca do body/query/param) — por
 * construção, ninguém consegue gravar fora do próprio namespace `users/{uid}/...`, não importa o que
 * `targetId` contenha (já sanitizado acima para nunca ter `/`).
 */
function storagePathFor(uid: string, kind: UploadKind, targetId: string | null, format: string): string {
  const ext = extensionFor(format);
  if (kind === "logo") return `users/${uid}/branding/store-logo.${ext}`;
  if (kind === "cutout") return `users/${uid}/product-cutouts/${targetId}/cutout-v1.png`;
  if (kind === "campaign-prize") return `users/${uid}/promotional-campaigns/${targetId}/prize.${ext}`;
  return `users/${uid}/products/${targetId}/derived-upload.${ext}`;
}

/** URL pública no MESMO formato que `getDownloadURL()` do client SDK produz — funciona sem token porque
 * storage.rules já concede leitura pública (`allow read: if true`) para estes paths; a Rule é quem
 * autoriza, o token é só um mecanismo alternativo, não obrigatório quando a Rule já permite. */
function buildPublicDownloadUrl(bucketName: string, storagePath: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media`;
}

const UPLOAD_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const UPLOAD_RATE_LIMIT_MAX = 20;
const uploadRateLimitMap = new Map<string, { count: number; resetAt: number }>();

function uploadRateLimit(req: Request, res: Response, next: NextFunction): void {
  const uid = (req as any).firebaseUid as string | undefined;
  const key = uid ?? req.ip ?? "unknown";
  const nowMs = Date.now();
  const current = uploadRateLimitMap.get(key);
  if (!current || nowMs > current.resetAt) {
    uploadRateLimitMap.set(key, { count: 1, resetAt: nowMs + UPLOAD_RATE_LIMIT_WINDOW_MS });
    return next();
  }
  if (current.count >= UPLOAD_RATE_LIMIT_MAX) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((current.resetAt - nowMs) / 1000))));
    res.status(429).json({ error: "RATE_LIMITED" });
    return;
  }
  current.count += 1;
  next();
}

async function handleUpload(req: Request, res: Response) {
  const uid = (req as any).firebaseUid as string;
  const kindParam = req.params.kind;

  if (!isUploadKind(kindParam)) {
    return res.status(400).json({ error: "INVALID_UPLOAD_KIND" });
  }
  const kind = kindParam;

  const targetId = kind === "logo" ? null : sanitizeTargetId(req.params.targetId);
  if (kind !== "logo" && !targetId) {
    return res.status(400).json({ error: "INVALID_TARGET_ID" });
  }

  const bytes = req.body as Buffer;
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    return res.status(400).json({ error: "EMPTY_BODY" });
  }

  const declaredMimeType = String(req.headers["content-type"] || "").split(";")[0].trim();
  const limits = kind === "cutout" ? CUTOUT_UPLOAD_LIMITS : DEFAULT_IMAGE_UPLOAD_LIMITS;
  const validation = validateImageUploadBytes(bytes, declaredMimeType, limits);

  if (!validation.accepted) {
    uploadWarn("upload_rejected", { kind, reason: validation.reason });
    return res.status(400).json({ error: "UPLOAD_REJECTED", reason: validation.reason });
  }
  // §3 approvedCutout é PNG-only por contrato (shared/approved-product-cutout.ts, PRO-07K) — o
  // mime-mismatch acima já pega a maioria dos casos, mas reforça explicitamente aqui.
  if (kind === "cutout" && validation.format !== "image/png") {
    uploadWarn("upload_rejected", { kind, reason: "cutout-must-be-png" });
    return res.status(400).json({ error: "UPLOAD_REJECTED", reason: "cutout-must-be-png" });
  }

  const receiptKey = uploadReceiptKey(kind, targetId, contentHashOf(bytes));

  let quotaResult;
  try {
    quotaResult = await reserveUploadQuota(uid, receiptKey, bytes.length);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    uploadError("quota_reservation_failed", msg);
    return res.status(500).json({ error: "UPLOAD_FAILED" });
  }

  if (quotaResult.status === "duplicate") {
    uploadInfo("upload_deduplicated", { kind });
    const receipt = quotaResult.receipt;
    return res.json({ storagePath: receipt.storagePath, downloadUrl: receipt.downloadUrl, width: receipt.width, height: receipt.height, deduplicated: true });
  }
  if (quotaResult.status === "rate_limited" || quotaResult.status === "storage_limit_exceeded") {
    uploadWarn("upload_rejected", { kind, reason: quotaResult.status });
    return res.status(429).json({ error: "UPLOAD_QUOTA_EXCEEDED", reason: quotaResult.status });
  }

  // quotaResult.status === "reserved" — segue para a gravação real.
  const admin = getFirebaseAdmin();
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET?.trim();
  const bucket = admin.storage().bucket(bucketName || undefined);
  const storagePath = storagePathFor(uid, kind, targetId, validation.format);

  try {
    await bucket.file(storagePath).save(bytes, {
      contentType: validation.format,
      metadata: { cacheControl: "public, max-age=31536000, immutable" },
      resumable: false,
    });

    const downloadUrl = buildPublicDownloadUrl(bucket.name, storagePath);
    await recordUploadReceipt(uid, receiptKey, {
      storagePath,
      downloadUrl,
      byteSize: validation.byteSize,
      format: validation.format,
      width: validation.width,
      height: validation.height,
      createdAt: new Date().toISOString(),
    });

    uploadInfo("upload_accepted", { kind, format: validation.format, width: validation.width, height: validation.height });
    return res.json({ storagePath, downloadUrl, width: validation.width, height: validation.height, deduplicated: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    uploadError("storage_write_failed", msg, { kind });
    await releaseUploadQuotaReservation(uid, bytes.length);
    return res.status(500).json({ error: "UPLOAD_FAILED" });
  }
}

const UPLOAD_FORMATS_BY_KIND: Record<UploadKind, readonly string[]> = {
  product: ["image/jpeg", "image/png", "image/webp"],
  logo: ["image/jpeg", "image/png", "image/webp"],
  cutout: ["image/png"],
  "campaign-prize": ["image/jpeg", "image/png", "image/webp"],
};

/** RELEASE-18 §7: só permite apagar um path que `storagePathFor` teria produzido para o PRÓPRIO uid
 * autenticado — nunca um path arbitrário só porque começa com `users/{uid}/`. */
function isOwnedUploadStoragePath(uid: string, kind: UploadKind, targetId: string | null, storagePath: string): boolean {
  return UPLOAD_FORMATS_BY_KIND[kind].some((format) => storagePathFor(uid, kind, targetId, format) === storagePath);
}

async function handleDelete(req: Request, res: Response) {
  const uid = (req as any).firebaseUid as string;
  const kindParam = req.params.kind;

  if (!isUploadKind(kindParam)) {
    return res.status(400).json({ error: "INVALID_UPLOAD_KIND" });
  }
  const kind = kindParam;

  const targetId = kind === "logo" ? null : sanitizeTargetId(req.params.targetId);
  if (kind !== "logo" && !targetId) {
    return res.status(400).json({ error: "INVALID_TARGET_ID" });
  }

  const storagePath = typeof (req.body as { storagePath?: unknown })?.storagePath === "string"
    ? (req.body as { storagePath: string }).storagePath
    : "";
  if (!storagePath || !isOwnedUploadStoragePath(uid, kind, targetId, storagePath)) {
    return res.status(400).json({ error: "INVALID_STORAGE_PATH" });
  }

  try {
    const admin = getFirebaseAdmin();
    const bucketName = process.env.FIREBASE_STORAGE_BUCKET?.trim();
    const bucket = admin.storage().bucket(bucketName || undefined);
    await bucket.file(storagePath).delete({ ignoreNotFound: true });
    uploadInfo("upload_deleted", { kind });
    return res.json({ deleted: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    uploadError("storage_delete_failed", msg, { kind });
    return res.status(500).json({ error: "DELETE_FAILED" });
  }
}

export function registerUploadRoutes(app: Express, requireAuth: (req: Request, res: Response, next: NextFunction) => void): void {
  const rawBodyParser = express.raw({ type: () => true, limit: `${Math.ceil(IMAGE_UPLOAD_MAX_BYTES / (1024 * 1024)) + 1}mb` });
  // Express 5 (path-to-regexp v8) não aceita mais o sufixo `?` de parâmetro opcional — duas rotas
  // explícitas (com e sem :targetId) apontando para o mesmo handler, em vez de uma rota só.
  // `express.raw({ limit })` rejeita corpos grandes antes mesmo de chegar em handleUpload — sem este
  // handler de erro (4 argumentos = assinatura de error handler no Express), o cliente receberia um
  // 413 em texto puro em vez do MESMO formato JSON `{error, reason}` de qualquer outra rejeição de
  // upload (H: acima do limite de bytes).
  const handleRawBodyTooLarge = (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err && typeof err === "object" && (err as { type?: string }).type === "entity.too.large") {
      return res.status(400).json({ error: "UPLOAD_REJECTED", reason: "too-large" });
    }
    next(err);
  };

  app.post("/api/uploads/:kind", requireAuth, uploadRateLimit, rawBodyParser, handleUpload, handleRawBodyTooLarge);
  app.post("/api/uploads/:kind/:targetId", requireAuth, uploadRateLimit, rawBodyParser, handleUpload, handleRawBodyTooLarge);
  // DELETE bodies são JSON pequenos (`{ storagePath }`) — o `express.json()` global (server/index.ts) já
  // cobre isso, sem precisar do parser de bytes crus acima.
  app.delete("/api/uploads/:kind", requireAuth, uploadRateLimit, handleDelete);
  app.delete("/api/uploads/:kind/:targetId", requireAuth, uploadRateLimit, handleDelete);
  app.use("/api/uploads", handleRawBodyTooLarge);
  uploadInfo("Routes registered: /api/uploads/{product,logo,cutout} (POST + DELETE)");
}
