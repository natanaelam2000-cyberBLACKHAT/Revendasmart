/**
 * RELEASE-06 — quota de upload server-owned, transacional, com idempotência natural via hash de
 * conteúdo. Não é billing: só um teto anti-abuso simples (bytes acumulados + uploads por janela).
 *
 * Firestore paths:
 *   users/{uid}/uploadQuota/main                — contador server-owned (nunca gravável pelo cliente
 *                                                  diretamente — só por este módulo, com Admin SDK)
 *   users/{uid}/uploadReceipts/{sha256(bytes)}   — marcador de upload já processado; a MESMA requisição
 *                                                  (mesmo conteúdo) reenviada nunca duplica quota nem
 *                                                  regrava o Storage — devolve o resultado já existente.
 */
import * as crypto from "crypto";
import { getFirebaseAdmin } from "./firebase-admin-init";

export const UPLOAD_QUOTA_WINDOW_MS = 60 * 60 * 1000; // 1 hora
export const UPLOAD_QUOTA_MAX_UPLOADS_PER_WINDOW = 200;
export const UPLOAD_QUOTA_MAX_TOTAL_BYTES = 200 * 1024 * 1024; // 200MB acumulados por usuário

function now(): string {
  return new Date().toISOString();
}

export function contentHashOf(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

/**
 * A chave de idempotência precisa incluir `kind`+`targetId`, nunca só o hash do conteúdo — os MESMOS
 * bytes enviados para propósitos diferentes (ex.: a mesma imagem como cutout de um produto E como logo
 * da loja) são dois uploads genuinamente distintos, cada um com seu próprio storagePath; hashear só o
 * conteúdo faria o segundo ser tratado como "duplicata" do primeiro e devolver o path ERRADO.
 */
export function uploadReceiptKey(kind: string, targetId: string | null, contentHash: string): string {
  return crypto.createHash("sha256").update(`${kind}:${targetId ?? ""}:${contentHash}`).digest("hex");
}

interface UploadQuotaState {
  readonly bytesUsed: number;
  readonly uploadCount: number;
  readonly windowStartAt: string;
  readonly updatedAt: string;
}

interface UploadReceipt {
  readonly storagePath: string;
  readonly downloadUrl: string;
  readonly byteSize: number;
  readonly format: string;
  readonly width: number;
  readonly height: number;
  readonly createdAt: string;
}

export type ReserveUploadQuotaResult =
  | { readonly status: "duplicate"; readonly receipt: UploadReceipt }
  | { readonly status: "reserved" }
  | { readonly status: "rate_limited" }
  | { readonly status: "storage_limit_exceeded" };

function getUploadQuotaRef(uid: string) {
  return getFirebaseAdmin().firestore().collection("users").doc(uid).collection("uploadQuota").doc("main");
}

function getUploadReceiptRef(uid: string, receiptKey: string) {
  return getFirebaseAdmin().firestore().collection("users").doc(uid).collection("uploadReceipts").doc(receiptKey);
}

/**
 * Transação única: checa idempotência (receipt já existe pra este hash → devolve o resultado antigo,
 * nunca reprocessa) e, se for genuinamente novo, checa os dois limites (janela de tempo + bytes
 * acumulados) e já reserva a quota atomicamente. O caller só grava no Storage DEPOIS de "reserved" —
 * se a gravação falhar, `releaseUploadQuotaReservation` desfaz a reserva (compensação, não rollback
 * de banco — o Storage write acontece fora desta transação, então não há transação distribuída real).
 */
export async function reserveUploadQuota(uid: string, receiptKey: string, byteSize: number): Promise<ReserveUploadQuotaResult> {
  const db = getFirebaseAdmin().firestore();
  const quotaRef = getUploadQuotaRef(uid);
  const receiptRef = getUploadReceiptRef(uid, receiptKey);

  return db.runTransaction(async (transaction) => {
    const receiptDoc = await transaction.get(receiptRef);
    if (receiptDoc.exists) {
      return { status: "duplicate", receipt: receiptDoc.data() as UploadReceipt };
    }

    const quotaDoc = await transaction.get(quotaRef);
    const current: UploadQuotaState = quotaDoc.exists
      ? (quotaDoc.data() as UploadQuotaState)
      : { bytesUsed: 0, uploadCount: 0, windowStartAt: now(), updatedAt: now() };

    const windowExpired = Date.now() - new Date(current.windowStartAt).getTime() > UPLOAD_QUOTA_WINDOW_MS;
    const uploadCountInWindow = windowExpired ? 0 : current.uploadCount;
    const windowStartAt = windowExpired ? now() : current.windowStartAt;
    const bytesUsed = windowExpired ? 0 : current.bytesUsed;

    if (uploadCountInWindow >= UPLOAD_QUOTA_MAX_UPLOADS_PER_WINDOW) {
      return { status: "rate_limited" };
    }
    if (bytesUsed + byteSize > UPLOAD_QUOTA_MAX_TOTAL_BYTES) {
      return { status: "storage_limit_exceeded" };
    }

    transaction.set(quotaRef, {
      bytesUsed: bytesUsed + byteSize,
      uploadCount: uploadCountInWindow + 1,
      windowStartAt,
      updatedAt: now(),
    });

    return { status: "reserved" };
  });
}

/** Chamado quando a gravação real no Storage/Firestore falha DEPOIS da reserva — desfaz o consumo de
 * quota (melhor esforço; nunca lança, o chamador já está no caminho de erro). */
export async function releaseUploadQuotaReservation(uid: string, byteSize: number): Promise<void> {
  try {
    const db = getFirebaseAdmin().firestore();
    const quotaRef = getUploadQuotaRef(uid);
    await db.runTransaction(async (transaction) => {
      const quotaDoc = await transaction.get(quotaRef);
      if (!quotaDoc.exists) return;
      const current = quotaDoc.data() as UploadQuotaState;
      transaction.set(quotaRef, {
        bytesUsed: Math.max(0, current.bytesUsed - byteSize),
        uploadCount: Math.max(0, current.uploadCount - 1),
        windowStartAt: current.windowStartAt,
        updatedAt: now(),
      });
    });
  } catch {
    // best-effort — a quota fica um pouco mais conservadora do que o real, nunca menos.
  }
}

/** Grava o marcador de idempotência DEPOIS que o Storage write real teve sucesso. */
export async function recordUploadReceipt(uid: string, receiptKey: string, receipt: UploadReceipt): Promise<void> {
  await getUploadReceiptRef(uid, receiptKey).set(receipt);
}

export async function getUploadQuotaState(uid: string): Promise<UploadQuotaState | null> {
  const doc = await getUploadQuotaRef(uid).get();
  return doc.exists ? (doc.data() as UploadQuotaState) : null;
}
