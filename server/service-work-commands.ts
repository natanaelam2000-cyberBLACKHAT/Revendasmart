import type { Express, NextFunction, Request, Response } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { logError, logInfo, logWarn } from "./logger";
import {
  ServicesDomainError,
  assertValidServiceWork,
  assertValidServiceWorkTransition,
  normalizeServiceWorkDocument,
  type ServiceWork,
  type IsoUtcString,
  type ServiceWorkStatus,
} from "../shared/services";

type ServiceWorkCommandAction = "start" | "complete" | "cancel";

export type ServiceWorkCommandResult = {
  workId: string;
  action: ServiceWorkCommandAction;
  resultingStatus: ServiceWorkStatus;
  transitionedAt: IsoUtcString;
  idempotentReplay: boolean;
};

type IdempotencyRecord = {
  key: string;
  action: ServiceWorkCommandAction;
  workId: string;
  tenantUid: string;
  createdAt: string;
  resultingStatus: ServiceWorkStatus;
  transitionedAt: IsoUtcString;
};

export class ServiceWorkCommandError extends Error {
  readonly code: "UNAUTHENTICATED" | "INVALID_PAYLOAD" | "WORK_NOT_FOUND" | "INVALID_TRANSITION" | "IDEMPOTENCY_CONFLICT";

  constructor(
    code: "UNAUTHENTICATED" | "INVALID_PAYLOAD" | "WORK_NOT_FOUND" | "INVALID_TRANSITION" | "IDEMPOTENCY_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "ServiceWorkCommandError";
    this.code = code;
  }
}

const COMMAND_ERROR_MESSAGES = {
  UNAUTHENTICATED: "Sessão inválida. Faça login novamente.",
  INVALID_PAYLOAD: "Confira os dados enviados e tente novamente.",
  WORK_NOT_FOUND: "Atendimento não encontrado.",
  INVALID_TRANSITION: "Essa transição do atendimento não é permitida.",
  IDEMPOTENCY_CONFLICT: "A mesma chave não pode ser reutilizada em outra operação.",
} as const;

function serviceWorkRef(db: Firestore, uid: string, workId: string) {
  return db.collection("users").doc(uid).collection("serviceWorks").doc(workId);
}

function idempotencyRef(db: Firestore, uid: string, key: string) {
  return db.collection("users").doc(uid).collection("serviceCommandIdempotency").doc(key);
}

function parseServiceWork(value: unknown): ServiceWork {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ServiceWorkCommandError("WORK_NOT_FOUND", "ServiceWork inválido.");
  }
  return normalizeServiceWorkDocument(value as ServiceWork);
}

function validateIdempotencyKey(value: unknown): string {
  const key = typeof value === "string" ? value.trim() : "";
  if (!/^[a-zA-Z0-9_-]{6,120}$/.test(key)) {
    throw new ServiceWorkCommandError("INVALID_PAYLOAD", "idempotencyKey inválida.");
  }
  return key;
}

function nextStatusFor(action: ServiceWorkCommandAction): ServiceWorkStatus {
  if (action === "start") return "in_progress";
  if (action === "complete") return "completed";
  return "cancelled";
}

function applyTransition(work: ServiceWork, action: ServiceWorkCommandAction, timestamp: string): ServiceWork {
  const nextStatus = assertValidServiceWorkTransition(work.status, nextStatusFor(action));
  const candidate: ServiceWork = {
    ...work,
    status: nextStatus,
    updatedAt: timestamp,
    ...(action === "start"
      ? { startedAt: timestamp }
      : action === "complete"
        ? { completedAt: timestamp }
        : { cancelledAt: timestamp }),
  };
  return assertValidServiceWork(candidate);
}

function transitionedAtFor(work: ServiceWork, action: ServiceWorkCommandAction): IsoUtcString {
  const value = action === "start"
    ? work.startedAt
    : action === "complete"
      ? work.completedAt
      : work.cancelledAt;

  if (!value) {
    throw new ServiceWorkCommandError("WORK_NOT_FOUND", "Timestamp da transição não encontrado.");
  }

  return value;
}

async function runServiceWorkCommand(
  db: Firestore,
  uid: string,
  workId: string,
  action: ServiceWorkCommandAction,
  idempotencyKey: string,
): Promise<ServiceWorkCommandResult> {
  return await db.runTransaction(async (tx) => {
    const workDocumentRef = serviceWorkRef(db, uid, workId);
    const idemDocumentRef = idempotencyRef(db, uid, idempotencyKey);
    const idemSnapshot = await tx.get(idemDocumentRef);

    if (idemSnapshot.exists) {
      const existing = idemSnapshot.data() as Partial<IdempotencyRecord>;
      if (existing.action !== action || existing.workId !== workId || existing.tenantUid !== uid) {
        throw new ServiceWorkCommandError("IDEMPOTENCY_CONFLICT", "idempotencyKey já usada em outra operação.");
      }
      if (
        typeof existing.resultingStatus === "string"
        && typeof existing.transitionedAt === "string"
      ) {
        return {
          workId,
          action,
          resultingStatus: existing.resultingStatus,
          transitionedAt: existing.transitionedAt,
          idempotentReplay: true,
        };
      }

      const workSnapshot = await tx.get(workDocumentRef);
      if (!workSnapshot.exists) {
        throw new ServiceWorkCommandError("WORK_NOT_FOUND", "ServiceWork não encontrado.");
      }
      const work = parseServiceWork(workSnapshot.data());
      return {
        workId,
        action,
        resultingStatus: existing.resultingStatus ?? nextStatusFor(action),
        transitionedAt: transitionedAtFor(work, action),
        idempotentReplay: true,
      };
    }

    const workSnapshot = await tx.get(workDocumentRef);
    if (!workSnapshot.exists) {
      throw new ServiceWorkCommandError("WORK_NOT_FOUND", "ServiceWork não encontrado.");
    }

    const currentWork = parseServiceWork(workSnapshot.data());
    const timestamp = new Date().toISOString();
    const nextWork = applyTransition(currentWork, action, timestamp);
    const idempotencyRecord: IdempotencyRecord = {
      key: idempotencyKey,
      action,
      workId,
      tenantUid: uid,
      createdAt: timestamp,
      resultingStatus: nextWork.status,
      transitionedAt: transitionedAtFor(nextWork, action),
    };

    tx.set(workDocumentRef, nextWork);
    tx.create(idemDocumentRef, idempotencyRecord);
    return {
      workId,
      action,
      resultingStatus: nextWork.status,
      transitionedAt: idempotencyRecord.transitionedAt,
      idempotentReplay: false,
    };
  });
}

export async function startServiceWorkCommand(db: Firestore, uid: string, workId: string, idempotencyKey: string) {
  return await runServiceWorkCommand(db, uid, workId, "start", idempotencyKey);
}

export async function completeServiceWorkCommand(db: Firestore, uid: string, workId: string, idempotencyKey: string) {
  return await runServiceWorkCommand(db, uid, workId, "complete", idempotencyKey);
}

export async function cancelServiceWorkCommand(db: Firestore, uid: string, workId: string, idempotencyKey: string) {
  return await runServiceWorkCommand(db, uid, workId, "cancel", idempotencyKey);
}

function sendServiceWorkCommandError(res: Response, status: number, code: keyof typeof COMMAND_ERROR_MESSAGES): void {
  res.status(status).json({ code, message: COMMAND_ERROR_MESSAGES[code] });
}

async function handleServiceWorkCommand(
  req: Request,
  res: Response,
  action: ServiceWorkCommandAction,
  executor: (db: Firestore, uid: string, workId: string, idempotencyKey: string) => Promise<ServiceWorkCommandResult>,
): Promise<void> {
  const uid = (req as Request & { firebaseUid?: string }).firebaseUid;
  if (!uid) {
    sendServiceWorkCommandError(res, 401, "UNAUTHENTICATED");
    return;
  }

  const workId = typeof req.params.workId === "string" ? req.params.workId.trim() : "";
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(workId)) {
    sendServiceWorkCommandError(res, 400, "INVALID_PAYLOAD");
    return;
  }

  try {
    const idempotencyKey = validateIdempotencyKey(req.body?.idempotencyKey);
    const db = getFirebaseAdmin().firestore();
    const result = await executor(db, uid, workId, idempotencyKey);
    logInfo(`service_work.${action}`, { requestId: req.requestId, workId, idempotent: result.idempotentReplay });
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof ServiceWorkCommandError) {
      const status = error.code === "WORK_NOT_FOUND"
        ? 404
        : error.code === "IDEMPOTENCY_CONFLICT"
          ? 409
          : error.code === "UNAUTHENTICATED"
            ? 401
            : 400;
      logWarn(`service_work.${action}_rejected`, { requestId: req.requestId, workId, code: error.code });
      sendServiceWorkCommandError(res, status, error.code);
      return;
    }
    if (error instanceof ServicesDomainError && error.code === "INVALID_SERVICE_WORK_TRANSITION") {
      logWarn(`service_work.${action}_invalid_transition`, { requestId: req.requestId, workId });
      sendServiceWorkCommandError(res, 409, "INVALID_TRANSITION");
      return;
    }
    logError(`service_work.${action}_failed`, error, { requestId: req.requestId, workId });
    res.status(500).json({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível atualizar o atendimento agora." });
  }
}

export function registerServiceWorkRoutes(
  app: Express,
  requireAuth: (req: Request, res: Response, next: NextFunction) => void,
): void {
  app.post("/api/services/works/:workId/start", requireAuth, async (req: Request, res: Response) => {
    await handleServiceWorkCommand(req, res, "start", startServiceWorkCommand);
  });
  app.post("/api/services/works/:workId/complete", requireAuth, async (req: Request, res: Response) => {
    await handleServiceWorkCommand(req, res, "complete", completeServiceWorkCommand);
  });
  app.post("/api/services/works/:workId/cancel", requireAuth, async (req: Request, res: Response) => {
    await handleServiceWorkCommand(req, res, "cancel", cancelServiceWorkCommand);
  });
}
