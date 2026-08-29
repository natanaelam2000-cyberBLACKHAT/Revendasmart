import type { Express, NextFunction, Request, Response } from "express";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { logError, logInfo, logWarn } from "./logger";
import {
  ServicesDomainError,
  assertEntityId,
  assertMoneyCents,
  assertValidServicePaymentRecord,
  assertValidServiceRefundRecord,
  assertValidServiceWorkFinancialSummary,
  createZeroServiceWorkFinancialSummary,
  normalizeServiceWorkDocument,
  type IsoUtcString,
  type ServicePaymentMethod,
  type ServicePaymentRecord,
  type ServiceWork,
  type ServiceWorkFinancialSummary,
} from "../shared/services";

type RecordPaymentResult = {
  action: "record_payment";
  workId: string;
  paymentId: string;
  amountCents: number;
  method: Exclude<ServicePaymentMethod, "provider_charge">;
  recordedAt: IsoUtcString;
  idempotentReplay: boolean;
};

type RefundPaymentResult = {
  action: "refund_payment";
  workId: string;
  paymentId: string;
  refundId: string;
  amountCents: number;
  refundedAt: IsoUtcString;
  reason?: string;
  idempotentReplay: boolean;
};

export type ServicePaymentCommandResult = RecordPaymentResult | RefundPaymentResult;

type ServicePaymentCommandAction = ServicePaymentCommandResult["action"];

type PaymentIdempotencyRecord = {
  key: string;
  tenantUid: string;
  action: ServicePaymentCommandAction;
  workId: string;
  paymentId: string;
  refundId?: string;
  amountCents: number;
  method?: Exclude<ServicePaymentMethod, "provider_charge">;
  reason?: string;
  recordedAt?: IsoUtcString;
  refundedAt?: IsoUtcString;
  createdAt: string;
};

type ManualPaymentMethod = Exclude<ServicePaymentMethod, "provider_charge">;

export class ServicePaymentCommandError extends Error {
  readonly code:
    | "UNAUTHENTICATED"
    | "NOT_FOUND"
    | "INVALID_PAYMENT_AMOUNT"
    | "INVALID_REFUND_AMOUNT"
    | "OVERPAYMENT_NOT_SUPPORTED"
    | "REFUND_EXCEEDS_PAYMENT"
    | "IDEMPOTENCY_CONFLICT"
    | "INVALID_PAYMENT_METHOD"
    | "INVALID_PAYLOAD";

  constructor(
    code: ServicePaymentCommandError["code"],
    message: string,
  ) {
    super(message);
    this.name = "ServicePaymentCommandError";
    this.code = code;
  }
}

const COMMAND_ERROR_MESSAGES = {
  UNAUTHENTICATED: "Sessão inválida. Faça login novamente.",
  NOT_FOUND: "Atendimento ou pagamento não encontrado.",
  INVALID_PAYMENT_AMOUNT: "Informe um valor de pagamento maior que zero.",
  INVALID_REFUND_AMOUNT: "Informe um valor de reembolso maior que zero.",
  OVERPAYMENT_NOT_SUPPORTED: "O valor excede o saldo disponível deste atendimento.",
  REFUND_EXCEEDS_PAYMENT: "O reembolso excede o valor ainda recebido neste pagamento.",
  IDEMPOTENCY_CONFLICT: "A mesma chave não pode ser reutilizada em outra operação.",
  INVALID_PAYMENT_METHOD: "Forma de pagamento inválida para este registro manual.",
  INVALID_PAYLOAD: "Confira os dados enviados e tente novamente.",
} as const;

function serviceWorkRef(db: Firestore, uid: string, workId: string) {
  return db.collection("users").doc(uid).collection("serviceWorks").doc(workId);
}

function servicePaymentRef(db: Firestore, uid: string, workId: string, paymentId: string) {
  return serviceWorkRef(db, uid, workId).collection("payments").doc(paymentId);
}

function serviceRefundRef(db: Firestore, uid: string, workId: string, paymentId: string, refundId: string) {
  return servicePaymentRef(db, uid, workId, paymentId).collection("refunds").doc(refundId);
}

function paymentIdempotencyRef(db: Firestore, uid: string, key: string) {
  return db.collection("users").doc(uid).collection("servicePaymentCommandIdempotency").doc(key);
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, fieldValue]) => typeof fieldValue !== "undefined")) as T;
}

function generateEntityId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseServiceWork(value: unknown): ServiceWork {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ServicePaymentCommandError("NOT_FOUND", "ServiceWork inválido.");
  }
  return normalizeServiceWorkDocument(value as ServiceWork);
}

function parsePayment(value: unknown): ServicePaymentRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ServicePaymentCommandError("NOT_FOUND", "Payment inválido.");
  }
  return assertValidServicePaymentRecord(value as ServicePaymentRecord);
}

function validateIdempotencyKey(value: unknown): string {
  const key = typeof value === "string" ? value.trim() : "";
  if (!/^[a-zA-Z0-9_-]{6,120}$/.test(key)) {
    throw new ServicePaymentCommandError("INVALID_PAYLOAD", "idempotencyKey inválida.");
  }
  return key;
}

function validateRouteEntityId(value: unknown, fieldName: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  try {
    return assertEntityId(text, fieldName);
  } catch {
    throw new ServicePaymentCommandError("INVALID_PAYLOAD", `${fieldName} inválido.`);
  }
}

function validateManualPaymentMethod(value: unknown): ManualPaymentMethod {
  if (value === "cash" || value === "pix" || value === "card" || value === "manual") {
    return value;
  }
  throw new ServicePaymentCommandError("INVALID_PAYMENT_METHOD", "payment.method inválido.");
}

function validatePaymentAmount(value: unknown): number {
  let amountCents = 0;
  try {
    amountCents = assertMoneyCents(Number(value), "amountCents");
  } catch {
    throw new ServicePaymentCommandError("INVALID_PAYMENT_AMOUNT", "amountCents deve ser > 0.");
  }
  if (amountCents <= 0) {
    throw new ServicePaymentCommandError("INVALID_PAYMENT_AMOUNT", "amountCents deve ser > 0.");
  }
  return amountCents;
}

function validateRefundAmount(value: unknown): number {
  let amountCents = 0;
  try {
    amountCents = assertMoneyCents(Number(value), "amountCents");
  } catch {
    throw new ServicePaymentCommandError("INVALID_REFUND_AMOUNT", "amountCents deve ser > 0.");
  }
  if (amountCents <= 0) {
    throw new ServicePaymentCommandError("INVALID_REFUND_AMOUNT", "amountCents deve ser > 0.");
  }
  return amountCents;
}

function normalizeRefundReason(value: unknown): string | undefined {
  if (typeof value === "undefined" || value === null) return undefined;
  if (typeof value !== "string") {
    throw new ServicePaymentCommandError("INVALID_PAYLOAD", "reason inválida.");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > 280) {
    throw new ServicePaymentCommandError("INVALID_PAYLOAD", "reason longa demais.");
  }
  return trimmed;
}

function normalizeSummary(summary: ServiceWorkFinancialSummary | undefined): ServiceWorkFinancialSummary {
  return assertValidServiceWorkFinancialSummary(summary ?? createZeroServiceWorkFinancialSummary());
}

function ensureReplayCompatible(
  existing: Partial<PaymentIdempotencyRecord>,
  expected: Omit<PaymentIdempotencyRecord, "createdAt">,
): ServicePaymentCommandResult {
  if (
    existing.key !== expected.key
    || existing.tenantUid !== expected.tenantUid
    || existing.action !== expected.action
    || existing.workId !== expected.workId
    || existing.paymentId !== expected.paymentId
    || existing.refundId !== expected.refundId
    || existing.amountCents !== expected.amountCents
    || existing.method !== expected.method
    || existing.reason !== expected.reason
  ) {
    throw new ServicePaymentCommandError("IDEMPOTENCY_CONFLICT", "idempotencyKey já usada em outra operação.");
  }

  if (existing.action === "record_payment" && typeof existing.recordedAt === "string") {
    return {
      action: "record_payment",
      workId: expected.workId,
      paymentId: expected.paymentId,
      amountCents: expected.amountCents,
      method: expected.method as ManualPaymentMethod,
      recordedAt: existing.recordedAt,
      idempotentReplay: true,
    };
  }

  if (existing.action === "refund_payment" && typeof existing.refundedAt === "string" && typeof existing.refundId === "string") {
    return {
      action: "refund_payment",
      workId: expected.workId,
      paymentId: expected.paymentId,
      refundId: existing.refundId,
      amountCents: expected.amountCents,
      refundedAt: existing.refundedAt,
      ...(typeof existing.reason === "string" ? { reason: existing.reason } : {}),
      idempotentReplay: true,
    };
  }

  throw new ServicePaymentCommandError("IDEMPOTENCY_CONFLICT", "Registro de idempotência incompleto.");
}

function createIdempotencyRecord(
  uid: string,
  key: string,
  result: ServicePaymentCommandResult,
): PaymentIdempotencyRecord {
  const base = {
    key,
    tenantUid: uid,
    action: result.action,
    workId: result.workId,
    paymentId: result.paymentId,
    amountCents: result.amountCents,
    createdAt: result.action === "record_payment" ? result.recordedAt : result.refundedAt,
  } satisfies Omit<PaymentIdempotencyRecord, "refundId" | "method" | "reason" | "recordedAt" | "refundedAt">;

  if (result.action === "record_payment") {
    return {
      ...base,
      method: result.method,
      recordedAt: result.recordedAt,
    };
  }

  return {
    ...base,
    refundId: result.refundId,
    ...(typeof result.reason === "string" ? { reason: result.reason } : {}),
    refundedAt: result.refundedAt,
  };
}

function buildPaymentResult(
  workId: string,
  paymentId: string,
  amountCents: number,
  method: ManualPaymentMethod,
  recordedAt: IsoUtcString,
  idempotentReplay: boolean,
): RecordPaymentResult {
  return { action: "record_payment", workId, paymentId, amountCents, method, recordedAt, idempotentReplay };
}

function buildRefundResult(
  workId: string,
  paymentId: string,
  refundId: string,
  amountCents: number,
  refundedAt: IsoUtcString,
  reason: string | undefined,
  idempotentReplay: boolean,
): RefundPaymentResult {
  return {
    action: "refund_payment",
    workId,
    paymentId,
    refundId,
    amountCents,
    refundedAt,
    ...(reason ? { reason } : {}),
    idempotentReplay,
  };
}

export async function recordServicePaymentCommand(
  db: Firestore,
  uid: string,
  workId: string,
  amountCents: number,
  method: ManualPaymentMethod,
  idempotencyKey: string,
): Promise<RecordPaymentResult> {
  return await db.runTransaction(async (tx) => {
    const idemDocumentRef = paymentIdempotencyRef(db, uid, idempotencyKey);
    const idemSnapshot = await tx.get(idemDocumentRef);

    if (idemSnapshot.exists) {
      const existing = idemSnapshot.data() as Partial<PaymentIdempotencyRecord>;
      const paymentId = typeof existing.paymentId === "string" ? existing.paymentId : "";
      return ensureReplayCompatible(existing, {
        key: idempotencyKey,
        tenantUid: uid,
        action: "record_payment",
        workId,
        paymentId,
        amountCents,
        method,
      }) as RecordPaymentResult;
    }

    const workDocumentRef = serviceWorkRef(db, uid, workId);
    const workSnapshot = await tx.get(workDocumentRef);
    if (!workSnapshot.exists) {
      throw new ServicePaymentCommandError("NOT_FOUND", "ServiceWork não encontrado.");
    }
    const currentWork = parseServiceWork(workSnapshot.data());
    const currentSummary = normalizeSummary(currentWork.financialSummary);
    const balanceCents = currentWork.totals.contractedTotalCents - currentSummary.netReceivedCents;
    if (amountCents > balanceCents) {
      throw new ServicePaymentCommandError("OVERPAYMENT_NOT_SUPPORTED", "Pagamento excede o saldo.");
    }

    const timestamp = new Date().toISOString();
    const paymentId = generateEntityId("payment");
    const payment = assertValidServicePaymentRecord({
      id: paymentId,
      tenantUid: uid,
      workId,
      amountCents,
      method,
      recordedAt: timestamp,
      refundedTotalCents: 0,
      idempotencyKey,
    });
    const nextSummary = normalizeSummary({
      grossReceivedCents: currentSummary.grossReceivedCents + amountCents,
      refundedTotalCents: currentSummary.refundedTotalCents,
      netReceivedCents: currentSummary.netReceivedCents + amountCents,
    });

    if (nextSummary.netReceivedCents > currentWork.totals.contractedTotalCents) {
      throw new ServicePaymentCommandError("OVERPAYMENT_NOT_SUPPORTED", "Pagamento excede o total contratado.");
    }

    const result = buildPaymentResult(workId, paymentId, amountCents, method, timestamp, false);
    tx.create(servicePaymentRef(db, uid, workId, paymentId), omitUndefined(payment as unknown as Record<string, unknown>));
    tx.update(workDocumentRef, {
      financialSummary: nextSummary,
    });
    tx.create(idemDocumentRef, createIdempotencyRecord(uid, idempotencyKey, result));
    return result;
  });
}

export async function refundServicePaymentCommand(
  db: Firestore,
  uid: string,
  workId: string,
  paymentId: string,
  amountCents: number,
  reason: string | undefined,
  idempotencyKey: string,
): Promise<RefundPaymentResult> {
  return await db.runTransaction(async (tx: Transaction) => {
    const idemDocumentRef = paymentIdempotencyRef(db, uid, idempotencyKey);
    const idemSnapshot = await tx.get(idemDocumentRef);

    if (idemSnapshot.exists) {
      const existing = idemSnapshot.data() as Partial<PaymentIdempotencyRecord>;
      return ensureReplayCompatible(existing, {
        key: idempotencyKey,
        tenantUid: uid,
        action: "refund_payment",
        workId,
        paymentId,
        refundId: typeof existing.refundId === "string" ? existing.refundId : "",
        amountCents,
        reason,
      }) as RefundPaymentResult;
    }

    const workDocumentRef = serviceWorkRef(db, uid, workId);
    const paymentDocumentRef = servicePaymentRef(db, uid, workId, paymentId);
    const [workSnapshot, paymentSnapshot] = await Promise.all([
      tx.get(workDocumentRef),
      tx.get(paymentDocumentRef),
    ]);

    if (!workSnapshot.exists || !paymentSnapshot.exists) {
      throw new ServicePaymentCommandError("NOT_FOUND", "ServiceWork ou Payment não encontrado.");
    }

    const currentWork = parseServiceWork(workSnapshot.data());
    const currentSummary = normalizeSummary(currentWork.financialSummary);
    const currentPayment = parsePayment(paymentSnapshot.data());

    if (currentPayment.tenantUid !== uid || currentPayment.workId !== workId) {
      throw new ServicePaymentCommandError("NOT_FOUND", "Payment não pertence ao atendimento.");
    }

    const newPaymentRefundedTotal = currentPayment.refundedTotalCents + amountCents;
    if (newPaymentRefundedTotal > currentPayment.amountCents) {
      throw new ServicePaymentCommandError("REFUND_EXCEEDS_PAYMENT", "Refund excede payment.");
    }

    const timestamp = new Date().toISOString();
    const refundId = generateEntityId("refund");
    const refundRecord = assertValidServiceRefundRecord({
      id: refundId,
      tenantUid: uid,
      workId,
      paymentId,
      amountCents,
      ...(reason ? { reason } : {}),
      refundedAt: timestamp,
      idempotencyKey,
    });
    const updatedPayment = assertValidServicePaymentRecord({
      ...currentPayment,
      refundedTotalCents: newPaymentRefundedTotal,
    });
    const nextSummary = normalizeSummary({
      grossReceivedCents: currentSummary.grossReceivedCents,
      refundedTotalCents: currentSummary.refundedTotalCents + amountCents,
      netReceivedCents: currentSummary.netReceivedCents - amountCents,
    });

    const result = buildRefundResult(workId, paymentId, refundId, amountCents, timestamp, reason, false);
    tx.create(serviceRefundRef(db, uid, workId, paymentId, refundId), omitUndefined(refundRecord as unknown as Record<string, unknown>));
    tx.update(paymentDocumentRef, { refundedTotalCents: updatedPayment.refundedTotalCents });
    tx.update(workDocumentRef, { financialSummary: nextSummary });
    tx.create(idemDocumentRef, createIdempotencyRecord(uid, idempotencyKey, result));
    return result;
  });
}

function sendServicePaymentCommandError(
  res: Response,
  status: number,
  code: keyof typeof COMMAND_ERROR_MESSAGES,
): void {
  res.status(status).json({ code, message: COMMAND_ERROR_MESSAGES[code] });
}

function statusForError(code: ServicePaymentCommandError["code"]): number {
  if (code === "UNAUTHENTICATED") return 401;
  if (code === "NOT_FOUND") return 404;
  if (code === "IDEMPOTENCY_CONFLICT") return 409;
  return 400;
}

export function registerServicePaymentRoutes(
  app: Express,
  requireAuth: (req: Request, res: Response, next: NextFunction) => void,
): void {
  app.post("/api/services/works/:workId/payments", requireAuth, async (req, res) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!uid) {
      sendServicePaymentCommandError(res, 401, "UNAUTHENTICATED");
      return;
    }

    try {
      const workId = validateRouteEntityId(req.params.workId, "workId");
      const amountCents = validatePaymentAmount(req.body?.amountCents);
      const method = validateManualPaymentMethod(req.body?.method);
      const idempotencyKey = validateIdempotencyKey(req.body?.idempotencyKey);
      const result = await recordServicePaymentCommand(getFirebaseAdmin().firestore(), uid, workId, amountCents, method, idempotencyKey);
      logInfo("service_payment.record", { requestId: req.requestId, workId, paymentId: result.paymentId, idempotent: result.idempotentReplay });
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServicePaymentCommandError) {
        logWarn("service_payment.record_rejected", { requestId: req.requestId, workId: req.params.workId, code: error.code });
        sendServicePaymentCommandError(res, statusForError(error.code), error.code);
        return;
      }
      if (error instanceof ServicesDomainError && error.code === "OVERPAYMENT_NOT_SUPPORTED") {
        sendServicePaymentCommandError(res, 400, "OVERPAYMENT_NOT_SUPPORTED");
        return;
      }
      logError("service_payment.record_failed", error, { requestId: req.requestId, workId: req.params.workId });
      res.status(500).json({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível registrar o pagamento agora." });
    }
  });

  app.post("/api/services/works/:workId/payments/:paymentId/refunds", requireAuth, async (req, res) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!uid) {
      sendServicePaymentCommandError(res, 401, "UNAUTHENTICATED");
      return;
    }

    try {
      const workId = validateRouteEntityId(req.params.workId, "workId");
      const paymentId = validateRouteEntityId(req.params.paymentId, "paymentId");
      const amountCents = validateRefundAmount(req.body?.amountCents);
      const reason = normalizeRefundReason(req.body?.reason);
      const idempotencyKey = validateIdempotencyKey(req.body?.idempotencyKey);
      const result = await refundServicePaymentCommand(getFirebaseAdmin().firestore(), uid, workId, paymentId, amountCents, reason, idempotencyKey);
      logInfo("service_payment.refund", { requestId: req.requestId, workId, paymentId, refundId: result.refundId, idempotent: result.idempotentReplay });
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServicePaymentCommandError) {
        logWarn("service_payment.refund_rejected", { requestId: req.requestId, workId: req.params.workId, paymentId: req.params.paymentId, code: error.code });
        sendServicePaymentCommandError(res, statusForError(error.code), error.code);
        return;
      }
      if (error instanceof ServicesDomainError && error.code === "REFUND_EXCEEDS_PAYMENT") {
        sendServicePaymentCommandError(res, 400, "REFUND_EXCEEDS_PAYMENT");
        return;
      }
      logError("service_payment.refund_failed", error, { requestId: req.requestId, workId: req.params.workId, paymentId: req.params.paymentId });
      res.status(500).json({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível registrar o reembolso agora." });
    }
  });
}
