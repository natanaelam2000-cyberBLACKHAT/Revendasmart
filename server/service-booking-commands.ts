/**
 * SERV-BOOK-01 — núcleo transacional da Agenda V1: BookingHold (reserva temporária), locks por segmento
 * de 5 minutos, expiração lógica (nunca física), confirmação atômica que cria Booking + ServiceWork.
 *
 * Autoridade é sempre o servidor: o cliente só pode solicitar (createHold/confirmHold) e ler o próprio
 * estado — nunca cria/altera lock, decide expiração, confirma diretamente no Firestore ou define
 * timestamps autoritativos (§ REGRA CRÍTICA do ticket).
 */
import type { Express, NextFunction, Request, Response } from "express";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { logError, logInfo, logWarn } from "./logger";
import {
  assertValidServiceWork,
  calculateCommercialTotals,
  calculateLineTotalCents,
  createZeroServiceWorkFinancialSummary,
  type IsoUtcString,
  type Service,
  type ServiceLineItem,
  type ServiceWork,
} from "../shared/services";
import {
  BOOKING_HOLD_TTL_MINUTES,
  ServiceBookingsDomainError,
  assertValidBooking,
  assertValidBookingHold,
  assertValidBookingInterval,
  assertValidScheduleLock,
  computeScheduleSegments,
  isSegmentAvailableForHold,
  type Booking,
  type BookingHold,
  type ScheduleLock,
} from "../shared/service-bookings";

type CreateHoldResult = {
  action: "create_hold";
  holdId: string;
  serviceId: string;
  resourceId: string;
  startAt: IsoUtcString;
  endAt: IsoUtcString;
  expiresAt: IsoUtcString;
  idempotentReplay: boolean;
};

type ConfirmHoldResult = {
  action: "confirm_hold";
  holdId: string;
  bookingId: string;
  workId: string;
  serviceId: string;
  resourceId: string;
  startAt: IsoUtcString;
  endAt: IsoUtcString;
  idempotentReplay: boolean;
};

export type ServiceBookingCommandResult = CreateHoldResult | ConfirmHoldResult;
type ServiceBookingCommandAction = ServiceBookingCommandResult["action"];

/** Resultado interno da transaction de createHold — "conflict" nunca escapa para o chamador HTTP como um
 * CreateHoldResult; a rota traduz para 409 SEGMENT_UNAVAILABLE antes de responder (§F: abortar tudo, sem
 * lock parcial, sem hold parcial — a transaction simplesmente não escreve nada nesse caminho). */
type CreateHoldOutcome = CreateHoldResult | { readonly action: "create_hold"; readonly conflict: true };

type BookingIdempotencyRecord = {
  key: string;
  tenantUid: string;
  action: ServiceBookingCommandAction;
  serviceId: string;
  resourceId: string;
  startAt?: IsoUtcString;
  holdId: string;
  bookingId?: string;
  workId?: string;
  createdAt: string;
};

export class ServiceBookingCommandError extends Error {
  readonly code:
    | "UNAUTHENTICATED"
    | "NOT_FOUND"
    | "INVALID_PAYLOAD"
    | "SERVICE_NOT_BOOKABLE"
    | "SEGMENT_UNAVAILABLE"
    | "HOLD_EXPIRED"
    | "LOCK_OWNERSHIP_LOST"
    | "IDEMPOTENCY_CONFLICT";

  constructor(code: ServiceBookingCommandError["code"], message: string) {
    super(message);
    this.name = "ServiceBookingCommandError";
    this.code = code;
  }
}

const COMMAND_ERROR_MESSAGES = {
  UNAUTHENTICATED: "Sessão inválida. Faça login novamente.",
  NOT_FOUND: "Serviço ou reserva não encontrada.",
  INVALID_PAYLOAD: "Confira os dados enviados e tente novamente.",
  SERVICE_NOT_BOOKABLE: "Este serviço não pode ser reservado no momento.",
  SEGMENT_UNAVAILABLE: "Este horário não está mais disponível.",
  HOLD_EXPIRED: "Esta reserva temporária expirou. Solicite um novo horário.",
  LOCK_OWNERSHIP_LOST: "Esta reserva temporária perdeu a posse do horário. Solicite um novo.",
  IDEMPOTENCY_CONFLICT: "A mesma chave não pode ser reutilizada em outra operação.",
} as const;

function db_(): Firestore {
  return getFirebaseAdmin().firestore();
}
function serviceRef(db: Firestore, uid: string, serviceId: string) {
  return db.collection("users").doc(uid).collection("services").doc(serviceId);
}
function serviceWorkRef(db: Firestore, uid: string, workId: string) {
  return db.collection("users").doc(uid).collection("serviceWorks").doc(workId);
}
function bookingHoldRef(db: Firestore, uid: string, holdId: string) {
  return db.collection("users").doc(uid).collection("bookingHolds").doc(holdId);
}
function bookingRef(db: Firestore, uid: string, bookingId: string) {
  return db.collection("users").doc(uid).collection("bookings").doc(bookingId);
}
/** ISO timestamps contêm ":"/"." — trocados por "-" para virar um id de documento seguro e legível. */
function scheduleLockId(resourceId: string, segmentStartAt: string): string {
  return `${resourceId}__${segmentStartAt.replace(/[:.]/g, "-")}`;
}
function scheduleLockRef(db: Firestore, uid: string, resourceId: string, segmentStartAt: string) {
  return db.collection("users").doc(uid).collection("scheduleLocks").doc(scheduleLockId(resourceId, segmentStartAt));
}
function bookingIdempotencyRef(db: Firestore, uid: string, key: string) {
  return db.collection("users").doc(uid).collection("serviceBookingCommandIdempotency").doc(key);
}

function buildBookingId(holdId: string): string {
  return `booking-${holdId}`;
}
function buildBookingWorkId(holdId: string): string {
  return `booking-work-${holdId}`;
}
function generateHoldId(): string {
  return `hold-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v !== "undefined")) as T;
}

function parseService(value: unknown): Service {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ServiceBookingCommandError("NOT_FOUND", "Service inválido.");
  }
  return value as Service;
}
function parseHold(value: unknown): BookingHold {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ServiceBookingCommandError("NOT_FOUND", "BookingHold inválido.");
  }
  return assertValidBookingHold(value as BookingHold);
}
function parseLock(value: unknown): ScheduleLock {
  return assertValidScheduleLock(value as ScheduleLock);
}

function validateIdempotencyKey(value: unknown): string {
  const key = typeof value === "string" ? value.trim() : "";
  if (!/^[a-zA-Z0-9_-]{6,120}$/.test(key)) {
    throw new ServiceBookingCommandError("INVALID_PAYLOAD", "idempotencyKey inválida.");
  }
  return key;
}
function validateRouteEntityId(value: unknown, fieldName: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(text)) {
    throw new ServiceBookingCommandError("INVALID_PAYLOAD", `${fieldName} inválido.`);
  }
  return text;
}
function validateOptionalEntityId(value: unknown, fieldName: string): string | undefined {
  if (typeof value === "undefined" || value === null) return undefined;
  return validateRouteEntityId(value, fieldName);
}
function validateStartAt(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || !Number.isFinite(Date.parse(text))) {
    throw new ServiceBookingCommandError("INVALID_PAYLOAD", "startAt deve ser um timestamp ISO válido.");
  }
  return new Date(Date.parse(text)).toISOString();
}

/**
 * §8/§11 — o CLIENTE nunca envia endAt/duração: o servidor SEMPRE deriva de Service.durationMinutes, para
 * que reduzir a duração no payload nunca "fure" a concorrência real. Um Service só é reservável (§21,
 * bookingMode reaproveitado como já existente — nunca reimplementado) quando: bookingMode != "none",
 * durationMinutes é um inteiro positivo múltiplo da grade de lock de 5 minutos, e pricing.mode é "fixed"
 * (preço determinístico é exigido para o ServiceWork nascer com totals corretos na confirmação).
 */
function resolveBookableServiceDuration(service: Service): number {
  if (service.bookingMode === "none") {
    throw new ServiceBookingCommandError("SERVICE_NOT_BOOKABLE", "Este serviço não aceita reservas (bookingMode=none).");
  }
  if (typeof service.durationMinutes !== "number" || !Number.isInteger(service.durationMinutes) || service.durationMinutes <= 0) {
    throw new ServiceBookingCommandError("SERVICE_NOT_BOOKABLE", "Este serviço não possui duração configurada.");
  }
  if (service.durationMinutes % 5 !== 0) {
    throw new ServiceBookingCommandError("SERVICE_NOT_BOOKABLE", "A duração do serviço precisa ser múltipla de 5 minutos.");
  }
  if (service.pricing.mode !== "fixed") {
    throw new ServiceBookingCommandError("SERVICE_NOT_BOOKABLE", "Este serviço não possui preço fixo configurado para reserva.");
  }
  return service.durationMinutes;
}

function buildServiceLineItem(service: Service, capturedAt: IsoUtcString): ServiceLineItem {
  if (service.pricing.mode !== "fixed") {
    throw new ServiceBookingCommandError("SERVICE_NOT_BOOKABLE", "Este serviço não possui preço fixo configurado para reserva.");
  }
  const unitPriceCents = service.pricing.priceCents;
  return {
    kind: "service",
    id: `item-${service.id}`,
    sourceId: service.id,
    snapshot: {
      sourceId: service.id,
      capturedAt,
      name: service.name,
      priceMode: "fixed",
      priceCents: unitPriceCents,
      ...(typeof service.durationMinutes === "number" ? { durationMinutes: service.durationMinutes } : {}),
    },
    quantity: 1,
    unitPriceCents,
    lineTotalCents: calculateLineTotalCents(1, unitPriceCents),
  };
}

function ensureCreateReplayCompatible(
  existing: Partial<BookingIdempotencyRecord>,
  expected: Omit<BookingIdempotencyRecord, "createdAt" | "holdId">,
): CreateHoldResult {
  if (
    existing.key !== expected.key
    || existing.tenantUid !== expected.tenantUid
    || existing.action !== expected.action
    || existing.serviceId !== expected.serviceId
    || existing.resourceId !== expected.resourceId
    || existing.startAt !== expected.startAt
  ) {
    throw new ServiceBookingCommandError("IDEMPOTENCY_CONFLICT", "idempotencyKey já usada com outros dados.");
  }
  if (typeof existing.holdId !== "string") {
    throw new ServiceBookingCommandError("IDEMPOTENCY_CONFLICT", "Registro de idempotência incompleto.");
  }
  return { action: "create_hold", holdId: existing.holdId, serviceId: expected.serviceId, resourceId: expected.resourceId, startAt: expected.startAt!, endAt: "", expiresAt: "", idempotentReplay: true };
}

function ensureConfirmReplayCompatible(
  existing: Partial<BookingIdempotencyRecord>,
  expected: Omit<BookingIdempotencyRecord, "createdAt" | "bookingId" | "workId">,
): ConfirmHoldResult {
  if (
    existing.key !== expected.key
    || existing.tenantUid !== expected.tenantUid
    || existing.action !== expected.action
    || existing.holdId !== expected.holdId
  ) {
    throw new ServiceBookingCommandError("IDEMPOTENCY_CONFLICT", "idempotencyKey já usada com outros dados.");
  }
  if (typeof existing.bookingId !== "string" || typeof existing.workId !== "string") {
    throw new ServiceBookingCommandError("IDEMPOTENCY_CONFLICT", "Registro de idempotência incompleto.");
  }
  return {
    action: "confirm_hold",
    holdId: expected.holdId,
    bookingId: existing.bookingId,
    workId: existing.workId,
    serviceId: existing.serviceId ?? "",
    resourceId: existing.resourceId ?? "",
    startAt: existing.startAt ?? "",
    endAt: "",
    idempotentReplay: true,
  };
}

export async function createServiceBookingHoldCommand(
  db: Firestore,
  uid: string,
  serviceId: string,
  resourceId: string,
  startAtInput: string,
  customerId: string | undefined,
  idempotencyKey: string,
): Promise<CreateHoldOutcome> {
  return await db.runTransaction(async (tx: Transaction): Promise<CreateHoldOutcome> => {
    const idemRef = bookingIdempotencyRef(db, uid, idempotencyKey);
    const idemSnap = await tx.get(idemRef);
    if (idemSnap.exists) {
      return ensureCreateReplayCompatible(idemSnap.data() as Partial<BookingIdempotencyRecord>, {
        key: idempotencyKey, tenantUid: uid, action: "create_hold", serviceId, resourceId, startAt: startAtInput,
      });
    }

    const serviceSnap = await tx.get(serviceRef(db, uid, serviceId));
    if (!serviceSnap.exists) throw new ServiceBookingCommandError("NOT_FOUND", "Serviço não encontrado.");
    const service = parseService(serviceSnap.data());
    if (service.tenantUid !== uid) throw new ServiceBookingCommandError("NOT_FOUND", "Serviço não encontrado.");

    const durationMinutes = resolveBookableServiceDuration(service);
    const startAt = validateStartAt(startAtInput);
    const endAt = new Date(Date.parse(startAt) + durationMinutes * 60_000).toISOString();
    const { startAt: validStart, endAt: validEnd } = assertValidBookingInterval(startAt, endAt);
    const segments = computeScheduleSegments(validStart, validEnd);

    const serverNowIso = new Date().toISOString();
    const lockRefs = segments.map((segmentStartAt) => scheduleLockRef(db, uid, resourceId, segmentStartAt));
    const lockSnaps = lockRefs.length ? await tx.getAll(...lockRefs) : [];

    for (const lockSnap of lockSnaps) {
      const lock = lockSnap.exists ? parseLock(lockSnap.data()) : undefined;
      if (!isSegmentAvailableForHold(lock, serverNowIso)) {
        return { action: "create_hold", conflict: true };
      }
    }

    const holdId = generateHoldId();
    const expiresAt = new Date(Date.parse(serverNowIso) + BOOKING_HOLD_TTL_MINUTES * 60_000).toISOString();
    const hold: BookingHold = assertValidBookingHold({
      id: holdId,
      tenantUid: uid,
      serviceId,
      resourceId,
      customerId,
      startAt: validStart,
      endAt: validEnd,
      status: "active",
      expiresAt,
      createdAt: serverNowIso,
      idempotencyKey,
    });

    const result: CreateHoldResult = { action: "create_hold", holdId, serviceId, resourceId, startAt: validStart, endAt: validEnd, expiresAt, idempotentReplay: false };

    tx.create(bookingHoldRef(db, uid, holdId), omitUndefined(hold as unknown as Record<string, unknown>));
    for (let i = 0; i < segments.length; i += 1) {
      const lockDoc: ScheduleLock = assertValidScheduleLock({
        tenantUid: uid, resourceId, segmentStartAt: segments[i], ownerType: "hold", ownerId: holdId, expiresAt,
      });
      tx.set(lockRefs[i], omitUndefined(lockDoc as unknown as Record<string, unknown>));
    }
    tx.create(idemRef, {
      key: idempotencyKey, tenantUid: uid, action: "create_hold", serviceId, resourceId, startAt: validStart, holdId, createdAt: serverNowIso,
    } satisfies BookingIdempotencyRecord);

    return result;
  });
}

export async function confirmServiceBookingHoldCommand(
  db: Firestore,
  uid: string,
  holdId: string,
  idempotencyKey: string,
): Promise<ConfirmHoldResult> {
  return await db.runTransaction(async (tx: Transaction) => {
    const idemRef = bookingIdempotencyRef(db, uid, idempotencyKey);
    const idemSnap = await tx.get(idemRef);
    if (idemSnap.exists) {
      return ensureConfirmReplayCompatible(idemSnap.data() as Partial<BookingIdempotencyRecord>, {
        key: idempotencyKey, tenantUid: uid, action: "confirm_hold", holdId, serviceId: "", resourceId: "", startAt: "",
      });
    }

    const holdDocRef = bookingHoldRef(db, uid, holdId);
    const holdSnap = await tx.get(holdDocRef);
    if (!holdSnap.exists) throw new ServiceBookingCommandError("NOT_FOUND", "Reserva temporária não encontrada.");
    const hold = parseHold(holdSnap.data());
    if (hold.tenantUid !== uid) throw new ServiceBookingCommandError("NOT_FOUND", "Reserva temporária não encontrada.");

    // §16/§26 — já confirmado (por qualquer chamada anterior, mesmo com outra idempotencyKey): devolve o
    // MESMO Booking/Work sempre, nunca duplica, mesmo sob uma key nova.
    if (hold.status === "confirmed") {
      if (!hold.confirmedBookingId || !hold.confirmedWorkId) {
        throw new ServiceBookingCommandError("LOCK_OWNERSHIP_LOST", "Reserva confirmada em estado inconsistente.");
      }
      const result: ConfirmHoldResult = {
        action: "confirm_hold", holdId, bookingId: hold.confirmedBookingId, workId: hold.confirmedWorkId,
        serviceId: hold.serviceId, resourceId: hold.resourceId, startAt: hold.startAt, endAt: hold.endAt, idempotentReplay: true,
      };
      tx.create(idemRef, {
        key: idempotencyKey, tenantUid: uid, action: "confirm_hold", serviceId: hold.serviceId, resourceId: hold.resourceId,
        holdId, bookingId: hold.confirmedBookingId, workId: hold.confirmedWorkId, createdAt: new Date().toISOString(),
      } satisfies BookingIdempotencyRecord);
      return result;
    }

    const serverNowIso = new Date().toISOString();
    if (Date.parse(hold.expiresAt) <= Date.parse(serverNowIso)) {
      throw new ServiceBookingCommandError("HOLD_EXPIRED", "Esta reserva temporária expirou.");
    }

    const segments = computeScheduleSegments(hold.startAt, hold.endAt);
    const lockRefs = segments.map((segmentStartAt) => scheduleLockRef(db, uid, hold.resourceId, segmentStartAt));
    const serviceSnapRef = serviceRef(db, uid, hold.serviceId);
    const [lockSnaps, serviceSnap] = await Promise.all([
      lockRefs.length ? tx.getAll(...lockRefs) : Promise.resolve([]),
      tx.get(serviceSnapRef),
    ]);

    for (const lockSnap of lockSnaps) {
      if (!lockSnap.exists) throw new ServiceBookingCommandError("LOCK_OWNERSHIP_LOST", "Um dos horários desta reserva não está mais garantido.");
      const lock = parseLock(lockSnap.data());
      if (lock.ownerType !== "hold" || lock.ownerId !== holdId) {
        throw new ServiceBookingCommandError("LOCK_OWNERSHIP_LOST", "Um dos horários desta reserva não está mais garantido.");
      }
    }

    if (!serviceSnap.exists) throw new ServiceBookingCommandError("NOT_FOUND", "Serviço não encontrado.");
    const service = parseService(serviceSnap.data());

    const bookingId = buildBookingId(holdId);
    const workId = buildBookingWorkId(holdId);
    const lineItem = buildServiceLineItem(service, serverNowIso);
    const items = [lineItem];
    const work: ServiceWork = assertValidServiceWork({
      id: workId,
      tenantUid: uid,
      status: "planned",
      origin: "booking",
      customerId: hold.customerId,
      items,
      totals: calculateCommercialTotals(items),
      financialSummary: createZeroServiceWorkFinancialSummary(),
      cost: { kind: "unknown" },
      createdAt: serverNowIso,
      updatedAt: serverNowIso,
    });
    const booking: Booking = assertValidBooking({
      id: bookingId,
      tenantUid: uid,
      serviceId: hold.serviceId,
      resourceId: hold.resourceId,
      customerId: hold.customerId,
      workId,
      startAt: hold.startAt,
      endAt: hold.endAt,
      status: "confirmed",
      source: "manual",
      createdAt: serverNowIso,
    });
    const confirmedHold: BookingHold = assertValidBookingHold({
      ...hold,
      status: "confirmed",
      confirmedBookingId: bookingId,
      confirmedWorkId: workId,
    });

    const result: ConfirmHoldResult = {
      action: "confirm_hold", holdId, bookingId, workId, serviceId: hold.serviceId, resourceId: hold.resourceId,
      startAt: hold.startAt, endAt: hold.endAt, idempotentReplay: false,
    };

    tx.create(serviceWorkRef(db, uid, workId), omitUndefined(work as unknown as Record<string, unknown>));
    tx.create(bookingRef(db, uid, bookingId), omitUndefined(booking as unknown as Record<string, unknown>));
    tx.set(holdDocRef, omitUndefined(confirmedHold as unknown as Record<string, unknown>));
    for (let i = 0; i < segments.length; i += 1) {
      const lockDoc: ScheduleLock = assertValidScheduleLock({
        tenantUid: uid, resourceId: hold.resourceId, segmentStartAt: segments[i], ownerType: "booking", ownerId: bookingId,
      });
      tx.set(lockRefs[i], omitUndefined(lockDoc as unknown as Record<string, unknown>));
    }
    tx.create(idemRef, {
      key: idempotencyKey, tenantUid: uid, action: "confirm_hold", serviceId: hold.serviceId, resourceId: hold.resourceId,
      holdId, bookingId, workId, createdAt: serverNowIso,
    } satisfies BookingIdempotencyRecord);

    return result;
  });
}

function sendServiceBookingCommandError(res: Response, status: number, code: keyof typeof COMMAND_ERROR_MESSAGES): void {
  res.status(status).json({ code, message: COMMAND_ERROR_MESSAGES[code] });
}
function statusForError(code: ServiceBookingCommandError["code"]): number {
  if (code === "UNAUTHENTICATED") return 401;
  if (code === "NOT_FOUND") return 404;
  if (code === "IDEMPOTENCY_CONFLICT") return 409;
  if (code === "SEGMENT_UNAVAILABLE" || code === "HOLD_EXPIRED" || code === "LOCK_OWNERSHIP_LOST") return 409;
  return 400;
}

export function registerServiceBookingRoutes(
  app: Express,
  requireAuth: (req: Request, res: Response, next: NextFunction) => void,
): void {
  app.post("/api/services/bookings/holds", requireAuth, async (req, res) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!uid) { sendServiceBookingCommandError(res, 401, "UNAUTHENTICATED"); return; }
    try {
      const serviceId = validateRouteEntityId(req.body?.serviceId, "serviceId");
      const resourceId = validateRouteEntityId(req.body?.resourceId, "resourceId");
      const customerId = validateOptionalEntityId(req.body?.customerId, "customerId");
      const startAt = typeof req.body?.startAt === "string" ? req.body.startAt : "";
      const idempotencyKey = validateIdempotencyKey(req.body?.idempotencyKey);
      const outcome = await createServiceBookingHoldCommand(db_(), uid, serviceId, resourceId, startAt, customerId, idempotencyKey);
      if ("conflict" in outcome) {
        logWarn("service_booking.hold_conflict", { requestId: req.requestId, serviceId, resourceId });
        sendServiceBookingCommandError(res, 409, "SEGMENT_UNAVAILABLE");
        return;
      }
      logInfo("service_booking.hold_created", { requestId: req.requestId, holdId: outcome.holdId, idempotent: outcome.idempotentReplay });
      res.status(200).json(outcome);
    } catch (error) {
      if (error instanceof ServiceBookingCommandError) {
        logWarn("service_booking.hold_rejected", { requestId: req.requestId, code: error.code });
        sendServiceBookingCommandError(res, statusForError(error.code), error.code);
        return;
      }
      if (error instanceof ServiceBookingsDomainError) {
        sendServiceBookingCommandError(res, 400, "INVALID_PAYLOAD");
        return;
      }
      logError("service_booking.hold_failed", error, { requestId: req.requestId });
      res.status(500).json({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível criar a reserva agora." });
    }
  });

  app.post("/api/services/bookings/holds/:holdId/confirm", requireAuth, async (req, res) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!uid) { sendServiceBookingCommandError(res, 401, "UNAUTHENTICATED"); return; }
    try {
      const holdId = validateRouteEntityId(req.params.holdId, "holdId");
      const idempotencyKey = validateIdempotencyKey(req.body?.idempotencyKey);
      const result = await confirmServiceBookingHoldCommand(db_(), uid, holdId, idempotencyKey);
      logInfo("service_booking.hold_confirmed", { requestId: req.requestId, holdId, bookingId: result.bookingId, workId: result.workId, idempotent: result.idempotentReplay });
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceBookingCommandError) {
        logWarn("service_booking.confirm_rejected", { requestId: req.requestId, holdId: req.params.holdId, code: error.code });
        sendServiceBookingCommandError(res, statusForError(error.code), error.code);
        return;
      }
      if (error instanceof ServiceBookingsDomainError) {
        sendServiceBookingCommandError(res, 400, "INVALID_PAYLOAD");
        return;
      }
      logError("service_booking.confirm_failed", error, { requestId: req.requestId, holdId: req.params.holdId });
      res.status(500).json({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível confirmar a reserva agora." });
    }
  });
}
