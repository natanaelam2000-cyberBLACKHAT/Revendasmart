import type { Express, NextFunction, Request, Response } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { logError, logInfo, logWarn } from "./logger";
import {
  assertValidServiceWork,
  createZeroServiceWorkFinancialSummary,
  type IsoUtcString,
  type ServiceWork,
} from "../shared/services";
import {
  assertValidQuote,
  assertValidQuoteVersion,
  isQuoteExpired,
  type Quote,
  type QuoteStatus,
  type QuoteVersion,
} from "../shared/service-quotes";

type QuoteCommandAction = "send" | "revise" | "accept" | "reject" | "cancel" | "convert";

export type QuoteCommandResult = {
  quoteId: string;
  action: QuoteCommandAction;
  resultingStatus: QuoteStatus;
  transitionedAt: IsoUtcString;
  idempotentReplay: boolean;
  currentVersionId?: string;
  currentVersionNumber?: number;
  acceptedVersionId?: string;
  convertedWorkId?: string;
};

type QuoteIdempotencyRecord = QuoteCommandResult & {
  key: string;
  tenantUid: string;
  createdAt: IsoUtcString;
};

export class ServiceQuoteCommandError extends Error {
  readonly code:
    | "UNAUTHENTICATED"
    | "INVALID_PAYLOAD"
    | "QUOTE_NOT_FOUND"
    | "INVALID_TRANSITION"
    | "STALE_QUOTE_VERSION"
    | "QUOTE_EXPIRED"
    | "IDEMPOTENCY_CONFLICT";

  constructor(code: ServiceQuoteCommandError["code"], message: string) {
    super(message);
    this.name = "ServiceQuoteCommandError";
    this.code = code;
  }
}

const COMMAND_ERROR_MESSAGES = {
  UNAUTHENTICATED: "Sessão inválida. Faça login novamente.",
  INVALID_PAYLOAD: "Confira os dados enviados e tente novamente.",
  QUOTE_NOT_FOUND: "Orçamento não encontrado.",
  INVALID_TRANSITION: "Essa transição do orçamento não é permitida.",
  STALE_QUOTE_VERSION: "A versão informada não é a versão atual do orçamento.",
  QUOTE_EXPIRED: "Esse orçamento expirou e não pode mais ser aceito.",
  IDEMPOTENCY_CONFLICT: "A mesma chave não pode ser reutilizada em outra operação.",
} as const;

function quoteRef(db: Firestore, uid: string, quoteId: string) {
  return db.collection("users").doc(uid).collection("quotes").doc(quoteId);
}

function quoteVersionRef(db: Firestore, uid: string, quoteId: string, versionId: string) {
  return db.collection("users").doc(uid).collection("quotes").doc(quoteId).collection("versions").doc(versionId);
}

function quoteIdempotencyRef(db: Firestore, uid: string, key: string) {
  return db.collection("users").doc(uid).collection("quoteCommandIdempotency").doc(key);
}

function serviceWorkRef(db: Firestore, uid: string, workId: string) {
  return db.collection("users").doc(uid).collection("serviceWorks").doc(workId);
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, fieldValue]) => typeof fieldValue !== "undefined")) as T;
}

function parseQuote(value: unknown): Quote {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ServiceQuoteCommandError("QUOTE_NOT_FOUND", "Quote inválida.");
  }
  return assertValidQuote(value as Quote);
}

function parseQuoteVersion(value: unknown): QuoteVersion {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ServiceQuoteCommandError("QUOTE_NOT_FOUND", "QuoteVersion inválida.");
  }
  return assertValidQuoteVersion(value as QuoteVersion);
}

function validateIdempotencyKey(value: unknown): string {
  const key = typeof value === "string" ? value.trim() : "";
  if (!/^[a-zA-Z0-9_-]{6,120}$/.test(key)) {
    throw new ServiceQuoteCommandError("INVALID_PAYLOAD", "idempotencyKey inválida.");
  }
  return key;
}

function validateEntityId(value: unknown, fieldName: string): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) {
    throw new ServiceQuoteCommandError("INVALID_PAYLOAD", `${fieldName} inválido.`);
  }
  return id;
}

function validateQuoteId(value: unknown): string {
  return validateEntityId(value, "quoteId");
}

function ensureReplayCompatible(
  existing: Partial<QuoteIdempotencyRecord>,
  action: QuoteCommandAction,
  quoteId: string,
  uid: string,
): QuoteCommandResult {
  if (existing.action !== action || existing.quoteId !== quoteId || existing.tenantUid !== uid) {
    throw new ServiceQuoteCommandError("IDEMPOTENCY_CONFLICT", "idempotencyKey já usada em outra operação.");
  }
  if (
    typeof existing.resultingStatus !== "string"
    || typeof existing.transitionedAt !== "string"
  ) {
    throw new ServiceQuoteCommandError("INVALID_PAYLOAD", "Idempotency record inválida.");
  }
  return {
    quoteId,
    action,
    resultingStatus: existing.resultingStatus,
    transitionedAt: existing.transitionedAt,
    idempotentReplay: true,
    ...(typeof existing.currentVersionId === "string" ? { currentVersionId: existing.currentVersionId } : {}),
    ...(typeof existing.currentVersionNumber === "number" ? { currentVersionNumber: existing.currentVersionNumber } : {}),
    ...(typeof existing.acceptedVersionId === "string" ? { acceptedVersionId: existing.acceptedVersionId } : {}),
    ...(typeof existing.convertedWorkId === "string" ? { convertedWorkId: existing.convertedWorkId } : {}),
  };
}

function createQuoteCommandResult(
  quoteId: string,
  action: QuoteCommandAction,
  resultingStatus: QuoteStatus,
  transitionedAt: IsoUtcString,
  extras: Partial<Omit<QuoteCommandResult, "quoteId" | "action" | "resultingStatus" | "transitionedAt" | "idempotentReplay">> = {},
): QuoteCommandResult {
  return {
    quoteId,
    action,
    resultingStatus,
    transitionedAt,
    idempotentReplay: false,
    ...extras,
  };
}

function createQuoteIdempotencyRecord(
  uid: string,
  key: string,
  result: QuoteCommandResult,
): QuoteIdempotencyRecord {
  return {
    key,
    tenantUid: uid,
    createdAt: result.transitionedAt,
    ...result,
  };
}

function assertDraftSendable(quote: Quote, now: IsoUtcString): void {
  if (quote.status !== "draft") {
    throw new ServiceQuoteCommandError("INVALID_TRANSITION", "Apenas drafts podem ser enviados.");
  }
  if (quote.draftValidUntil && Date.parse(quote.draftValidUntil) <= Date.parse(now)) {
    throw new ServiceQuoteCommandError("INVALID_PAYLOAD", "draftValidUntil deve estar no futuro no momento do envio.");
  }
}

function buildVersionId(versionNumber: number): string {
  return `version-${versionNumber}`;
}

function buildQuoteWorkId(quoteId: string): string {
  return `quote-work-${quoteId}`;
}

export async function sendQuoteCommand(db: Firestore, uid: string, quoteId: string, idempotencyKey: string): Promise<QuoteCommandResult> {
  return await db.runTransaction(async (tx) => {
    const quoteDocumentRef = quoteRef(db, uid, quoteId);
    const idemDocumentRef = quoteIdempotencyRef(db, uid, idempotencyKey);
    const idemSnapshot = await tx.get(idemDocumentRef);

    if (idemSnapshot.exists) {
      return ensureReplayCompatible(idemSnapshot.data() as Partial<QuoteIdempotencyRecord>, "send", quoteId, uid);
    }

    const quoteSnapshot = await tx.get(quoteDocumentRef);
    if (!quoteSnapshot.exists) {
      throw new ServiceQuoteCommandError("QUOTE_NOT_FOUND", "Quote não encontrada.");
    }

    const currentQuote = parseQuote(quoteSnapshot.data());
    const timestamp = new Date().toISOString();
    assertDraftSendable(currentQuote, timestamp);

    const nextVersionNumber = (currentQuote.currentVersionNumber ?? 0) + 1;
    const versionId = buildVersionId(nextVersionNumber);
    const version: QuoteVersion = assertValidQuoteVersion({
      id: versionId,
      tenantUid: uid,
      quoteId,
      versionNumber: nextVersionNumber,
      customerId: currentQuote.customerId,
      items: currentQuote.draftItems,
      totals: currentQuote.draftTotals,
      customerMessage: currentQuote.draftCustomerMessage,
      validUntil: currentQuote.draftValidUntil,
      createdAt: timestamp,
      sentAt: timestamp,
    });
    const nextQuote: Quote = assertValidQuote({
      ...currentQuote,
      status: "sent",
      currentVersionId: version.id,
      currentVersionNumber: version.versionNumber,
      lastSentAt: timestamp,
      updatedAt: timestamp,
    });
    const result = createQuoteCommandResult(quoteId, "send", "sent", timestamp, {
      currentVersionId: version.id,
      currentVersionNumber: version.versionNumber,
    });

    tx.create(quoteVersionRef(db, uid, quoteId, versionId), omitUndefined(version as unknown as Record<string, unknown>));
    tx.set(quoteDocumentRef, omitUndefined(nextQuote as unknown as Record<string, unknown>));
    tx.create(idemDocumentRef, createQuoteIdempotencyRecord(uid, idempotencyKey, result));
    return result;
  });
}

export async function beginQuoteRevisionCommand(
  db: Firestore,
  uid: string,
  quoteId: string,
  expectedVersionId: string,
  idempotencyKey: string,
): Promise<QuoteCommandResult> {
  return await db.runTransaction(async (tx) => {
    const quoteDocumentRef = quoteRef(db, uid, quoteId);
    const idemDocumentRef = quoteIdempotencyRef(db, uid, idempotencyKey);
    const idemSnapshot = await tx.get(idemDocumentRef);

    if (idemSnapshot.exists) {
      return ensureReplayCompatible(idemSnapshot.data() as Partial<QuoteIdempotencyRecord>, "revise", quoteId, uid);
    }

    const quoteSnapshot = await tx.get(quoteDocumentRef);
    if (!quoteSnapshot.exists) {
      throw new ServiceQuoteCommandError("QUOTE_NOT_FOUND", "Quote não encontrada.");
    }

    const currentQuote = parseQuote(quoteSnapshot.data());
    if (currentQuote.status !== "sent") {
      throw new ServiceQuoteCommandError("INVALID_TRANSITION", "Apenas quotes enviadas podem entrar em revisão.");
    }
    if (currentQuote.currentVersionId !== expectedVersionId) {
      throw new ServiceQuoteCommandError("STALE_QUOTE_VERSION", "Versão atual não confere para revisão.");
    }

    const timestamp = new Date().toISOString();
    const nextQuote: Quote = assertValidQuote({
      ...currentQuote,
      status: "draft",
      updatedAt: timestamp,
    });
    const result = createQuoteCommandResult(quoteId, "revise", "draft", timestamp, {
      currentVersionId: currentQuote.currentVersionId,
      currentVersionNumber: currentQuote.currentVersionNumber,
    });

    tx.set(quoteDocumentRef, omitUndefined(nextQuote as unknown as Record<string, unknown>));
    tx.create(idemDocumentRef, createQuoteIdempotencyRecord(uid, idempotencyKey, result));
    return result;
  });
}

async function resolveCurrentVersion(
  tx: FirebaseFirestore.Transaction,
  db: Firestore,
  uid: string,
  quoteId: string,
  versionId: string,
): Promise<QuoteVersion> {
  const snapshot = await tx.get(quoteVersionRef(db, uid, quoteId, versionId));
  if (!snapshot.exists) {
    throw new ServiceQuoteCommandError("STALE_QUOTE_VERSION", "Versão atual não encontrada.");
  }
  return parseQuoteVersion(snapshot.data());
}

export async function acceptQuoteCommand(
  db: Firestore,
  uid: string,
  quoteId: string,
  versionId: string,
  idempotencyKey: string,
): Promise<QuoteCommandResult> {
  return await db.runTransaction(async (tx) => {
    const quoteDocumentRef = quoteRef(db, uid, quoteId);
    const idemDocumentRef = quoteIdempotencyRef(db, uid, idempotencyKey);
    const idemSnapshot = await tx.get(idemDocumentRef);

    if (idemSnapshot.exists) {
      return ensureReplayCompatible(idemSnapshot.data() as Partial<QuoteIdempotencyRecord>, "accept", quoteId, uid);
    }

    const quoteSnapshot = await tx.get(quoteDocumentRef);
    if (!quoteSnapshot.exists) throw new ServiceQuoteCommandError("QUOTE_NOT_FOUND", "Quote não encontrada.");
    const currentQuote = parseQuote(quoteSnapshot.data());
    if (currentQuote.status !== "sent") throw new ServiceQuoteCommandError("INVALID_TRANSITION", "Apenas quotes enviadas podem ser aceitas.");
    if (currentQuote.currentVersionId !== versionId) throw new ServiceQuoteCommandError("STALE_QUOTE_VERSION", "Só a versão atual pode ser aceita.");

    const currentVersion = await resolveCurrentVersion(tx, db, uid, quoteId, versionId);
    const timestamp = new Date().toISOString();
    if (isQuoteExpired(currentVersion.validUntil, timestamp)) {
      throw new ServiceQuoteCommandError("QUOTE_EXPIRED", "A quote expirou.");
    }

    const nextQuote: Quote = assertValidQuote({
      ...currentQuote,
      status: "accepted",
      acceptedVersionId: versionId,
      acceptedAt: timestamp,
      updatedAt: timestamp,
    });
    const result = createQuoteCommandResult(quoteId, "accept", "accepted", timestamp, {
      currentVersionId: currentQuote.currentVersionId,
      currentVersionNumber: currentQuote.currentVersionNumber,
      acceptedVersionId: versionId,
    });
    tx.set(quoteDocumentRef, omitUndefined(nextQuote as unknown as Record<string, unknown>));
    tx.create(idemDocumentRef, createQuoteIdempotencyRecord(uid, idempotencyKey, result));
    return result;
  });
}

export async function rejectQuoteCommand(
  db: Firestore,
  uid: string,
  quoteId: string,
  versionId: string,
  idempotencyKey: string,
): Promise<QuoteCommandResult> {
  return await db.runTransaction(async (tx) => {
    const quoteDocumentRef = quoteRef(db, uid, quoteId);
    const idemDocumentRef = quoteIdempotencyRef(db, uid, idempotencyKey);
    const idemSnapshot = await tx.get(idemDocumentRef);

    if (idemSnapshot.exists) {
      return ensureReplayCompatible(idemSnapshot.data() as Partial<QuoteIdempotencyRecord>, "reject", quoteId, uid);
    }

    const quoteSnapshot = await tx.get(quoteDocumentRef);
    if (!quoteSnapshot.exists) throw new ServiceQuoteCommandError("QUOTE_NOT_FOUND", "Quote não encontrada.");
    const currentQuote = parseQuote(quoteSnapshot.data());
    if (currentQuote.status !== "sent") throw new ServiceQuoteCommandError("INVALID_TRANSITION", "Apenas quotes enviadas podem ser rejeitadas.");
    if (currentQuote.currentVersionId !== versionId) throw new ServiceQuoteCommandError("STALE_QUOTE_VERSION", "Só a versão atual pode ser rejeitada.");

    await resolveCurrentVersion(tx, db, uid, quoteId, versionId);
    const timestamp = new Date().toISOString();
    const nextQuote: Quote = assertValidQuote({
      ...currentQuote,
      status: "rejected",
      rejectedAt: timestamp,
      updatedAt: timestamp,
    });
    const result = createQuoteCommandResult(quoteId, "reject", "rejected", timestamp, {
      currentVersionId: currentQuote.currentVersionId,
      currentVersionNumber: currentQuote.currentVersionNumber,
    });
    tx.set(quoteDocumentRef, omitUndefined(nextQuote as unknown as Record<string, unknown>));
    tx.create(idemDocumentRef, createQuoteIdempotencyRecord(uid, idempotencyKey, result));
    return result;
  });
}

export async function cancelQuoteCommand(db: Firestore, uid: string, quoteId: string, idempotencyKey: string): Promise<QuoteCommandResult> {
  return await db.runTransaction(async (tx) => {
    const quoteDocumentRef = quoteRef(db, uid, quoteId);
    const idemDocumentRef = quoteIdempotencyRef(db, uid, idempotencyKey);
    const idemSnapshot = await tx.get(idemDocumentRef);

    if (idemSnapshot.exists) {
      return ensureReplayCompatible(idemSnapshot.data() as Partial<QuoteIdempotencyRecord>, "cancel", quoteId, uid);
    }

    const quoteSnapshot = await tx.get(quoteDocumentRef);
    if (!quoteSnapshot.exists) throw new ServiceQuoteCommandError("QUOTE_NOT_FOUND", "Quote não encontrada.");
    const currentQuote = parseQuote(quoteSnapshot.data());
    if (!["draft", "sent"].includes(currentQuote.status)) {
      throw new ServiceQuoteCommandError("INVALID_TRANSITION", "Apenas quotes draft ou sent podem ser canceladas.");
    }

    const timestamp = new Date().toISOString();
    const nextQuote: Quote = assertValidQuote({
      ...currentQuote,
      status: "cancelled",
      cancelledAt: timestamp,
      updatedAt: timestamp,
    });
    const result = createQuoteCommandResult(quoteId, "cancel", "cancelled", timestamp, {
      ...(currentQuote.currentVersionId ? { currentVersionId: currentQuote.currentVersionId } : {}),
      ...(typeof currentQuote.currentVersionNumber === "number" ? { currentVersionNumber: currentQuote.currentVersionNumber } : {}),
    });
    tx.set(quoteDocumentRef, omitUndefined(nextQuote as unknown as Record<string, unknown>));
    tx.create(idemDocumentRef, createQuoteIdempotencyRecord(uid, idempotencyKey, result));
    return result;
  });
}

export async function convertAcceptedQuoteToWorkCommand(
  db: Firestore,
  uid: string,
  quoteId: string,
  idempotencyKey: string,
): Promise<QuoteCommandResult> {
  return await db.runTransaction(async (tx) => {
    const quoteDocumentRef = quoteRef(db, uid, quoteId);
    const idemDocumentRef = quoteIdempotencyRef(db, uid, idempotencyKey);
    const idemSnapshot = await tx.get(idemDocumentRef);

    if (idemSnapshot.exists) {
      return ensureReplayCompatible(idemSnapshot.data() as Partial<QuoteIdempotencyRecord>, "convert", quoteId, uid);
    }

    const quoteSnapshot = await tx.get(quoteDocumentRef);
    if (!quoteSnapshot.exists) throw new ServiceQuoteCommandError("QUOTE_NOT_FOUND", "Quote não encontrada.");
    const currentQuote = parseQuote(quoteSnapshot.data());

    if (currentQuote.convertedWorkId) {
      const result = createQuoteCommandResult(quoteId, "convert", currentQuote.status, currentQuote.updatedAt, {
        currentVersionId: currentQuote.currentVersionId,
        currentVersionNumber: currentQuote.currentVersionNumber,
        acceptedVersionId: currentQuote.acceptedVersionId,
        convertedWorkId: currentQuote.convertedWorkId,
      });
      tx.create(idemDocumentRef, createQuoteIdempotencyRecord(uid, idempotencyKey, result));
      return result;
    }

    if (currentQuote.status !== "accepted" || !currentQuote.acceptedVersionId) {
      throw new ServiceQuoteCommandError("INVALID_TRANSITION", "Apenas quotes aceitas podem ser convertidas.");
    }

    const acceptedVersion = await resolveCurrentVersion(tx, db, uid, quoteId, currentQuote.acceptedVersionId);
    const timestamp = new Date().toISOString();
    const workId = buildQuoteWorkId(quoteId);
    const work: ServiceWork = assertValidServiceWork({
      id: workId,
      tenantUid: uid,
      status: "planned",
      origin: "quote",
      customerId: acceptedVersion.customerId,
      sourceQuoteId: quoteId,
      sourceQuoteVersionId: acceptedVersion.id,
      items: acceptedVersion.items,
      totals: acceptedVersion.totals,
      financialSummary: createZeroServiceWorkFinancialSummary(),
      cost: { kind: "unknown" },
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const nextQuote: Quote = assertValidQuote({
      ...currentQuote,
      convertedWorkId: work.id,
      updatedAt: timestamp,
    });
    const result = createQuoteCommandResult(quoteId, "convert", "accepted", timestamp, {
      currentVersionId: currentQuote.currentVersionId,
      currentVersionNumber: currentQuote.currentVersionNumber,
      acceptedVersionId: currentQuote.acceptedVersionId,
      convertedWorkId: work.id,
    });

    tx.create(serviceWorkRef(db, uid, workId), omitUndefined(work as unknown as Record<string, unknown>));
    tx.set(quoteDocumentRef, omitUndefined(nextQuote as unknown as Record<string, unknown>));
    tx.create(idemDocumentRef, createQuoteIdempotencyRecord(uid, idempotencyKey, result));
    return result;
  });
}

function sendServiceQuoteCommandError(
  res: Response,
  status: number,
  code: keyof typeof COMMAND_ERROR_MESSAGES,
): void {
  res.status(status).json({ code, message: COMMAND_ERROR_MESSAGES[code] });
}

function statusForQuoteCommandError(code: ServiceQuoteCommandError["code"]): number {
  if (code === "QUOTE_NOT_FOUND") return 404;
  if (code === "IDEMPOTENCY_CONFLICT") return 409;
  if (code === "INVALID_TRANSITION" || code === "STALE_QUOTE_VERSION" || code === "QUOTE_EXPIRED") return 409;
  if (code === "UNAUTHENTICATED") return 401;
  return 400;
}

async function handleQuoteCommand(
  req: Request,
  res: Response,
  action: QuoteCommandAction,
  executor: (db: Firestore, uid: string, quoteId: string, req: Request) => Promise<QuoteCommandResult>,
): Promise<void> {
  const uid = (req as Request & { firebaseUid?: string }).firebaseUid;
  if (!uid) {
    sendServiceQuoteCommandError(res, 401, "UNAUTHENTICATED");
    return;
  }

  const quoteId = validateQuoteId(req.params.quoteId);

  try {
    const db = getFirebaseAdmin().firestore();
    const result = await executor(db, uid, quoteId, req);
    logInfo(`service_quote.${action}`, { requestId: req.requestId, quoteId, idempotent: result.idempotentReplay });
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof ServiceQuoteCommandError) {
      logWarn(`service_quote.${action}_rejected`, { requestId: req.requestId, quoteId, code: error.code });
      sendServiceQuoteCommandError(res, statusForQuoteCommandError(error.code), error.code);
      return;
    }
    logError(`service_quote.${action}_failed`, error, { requestId: req.requestId, quoteId });
    res.status(500).json({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível atualizar o orçamento agora." });
  }
}

export function registerServiceQuoteRoutes(
  app: Express,
  requireAuth: (req: Request, res: Response, next: NextFunction) => void,
): void {
  app.post("/api/services/quotes/:quoteId/send", requireAuth, async (req, res) => {
    await handleQuoteCommand(req, res, "send", async (db, uid, quoteId, currentReq) =>
      await sendQuoteCommand(db, uid, quoteId, validateIdempotencyKey(currentReq.body?.idempotencyKey)));
  });

  app.post("/api/services/quotes/:quoteId/revise", requireAuth, async (req, res) => {
    await handleQuoteCommand(req, res, "revise", async (db, uid, quoteId, currentReq) =>
      await beginQuoteRevisionCommand(
        db,
        uid,
        quoteId,
        validateEntityId(currentReq.body?.expectedVersionId, "expectedVersionId"),
        validateIdempotencyKey(currentReq.body?.idempotencyKey),
      ));
  });

  app.post("/api/services/quotes/:quoteId/accept", requireAuth, async (req, res) => {
    await handleQuoteCommand(req, res, "accept", async (db, uid, quoteId, currentReq) =>
      await acceptQuoteCommand(
        db,
        uid,
        quoteId,
        validateEntityId(currentReq.body?.versionId, "versionId"),
        validateIdempotencyKey(currentReq.body?.idempotencyKey),
      ));
  });

  app.post("/api/services/quotes/:quoteId/reject", requireAuth, async (req, res) => {
    await handleQuoteCommand(req, res, "reject", async (db, uid, quoteId, currentReq) =>
      await rejectQuoteCommand(
        db,
        uid,
        quoteId,
        validateEntityId(currentReq.body?.versionId, "versionId"),
        validateIdempotencyKey(currentReq.body?.idempotencyKey),
      ));
  });

  app.post("/api/services/quotes/:quoteId/cancel", requireAuth, async (req, res) => {
    await handleQuoteCommand(req, res, "cancel", async (db, uid, quoteId, currentReq) =>
      await cancelQuoteCommand(db, uid, quoteId, validateIdempotencyKey(currentReq.body?.idempotencyKey)));
  });

  app.post("/api/services/quotes/:quoteId/convert", requireAuth, async (req, res) => {
    await handleQuoteCommand(req, res, "convert", async (db, uid, quoteId, currentReq) =>
      await convertAcceptedQuoteToWorkCommand(db, uid, quoteId, validateIdempotencyKey(currentReq.body?.idempotencyKey)));
  });
}
