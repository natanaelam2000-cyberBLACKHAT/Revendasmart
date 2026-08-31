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
  diffScheduleSegments,
  isSegmentAvailableForHold,
  resolveBookableServiceDuration,
  type Booking,
  type BookingHold,
  type ScheduleLock,
} from "../shared/service-bookings";
import {
  ServiceAvailabilityCommandError,
  assertIntervalAllowedByScheduleCommand,
} from "./service-availability-commands";

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

type ReleaseHoldResult = {
  action: "release_hold";
  holdId: string;
  idempotentReplay: boolean;
};

type CancelBookingResult = {
  action: "cancel_booking";
  bookingId: string;
  workId: string;
  cancelledAt: IsoUtcString;
  idempotentReplay: boolean;
};

type RescheduleBookingResult = {
  action: "reschedule_booking";
  bookingId: string;
  workId: string;
  startAt: IsoUtcString;
  endAt: IsoUtcString;
  idempotentReplay: boolean;
};

export type ServiceBookingCommandResult = CreateHoldResult | ConfirmHoldResult | ReleaseHoldResult | CancelBookingResult | RescheduleBookingResult;
type ServiceBookingCommandAction = ServiceBookingCommandResult["action"];

/** Resultado interno da transaction de createHold — "conflict" nunca escapa para o chamador HTTP como um
 * CreateHoldResult; a rota traduz para 409 SEGMENT_UNAVAILABLE antes de responder (§F: abortar tudo, sem
 * lock parcial, sem hold parcial — a transaction simplesmente não escreve nada nesse caminho). */
type CreateHoldOutcome = CreateHoldResult | { readonly action: "create_hold"; readonly conflict: true };
/** Mesma ideia para reschedule: "conflict" nunca vira RescheduleBookingResult — a rota traduz para 409
 * SEGMENT_UNAVAILABLE (§18: horário antigo/locks/Work preservados intactos, transaction all-or-nothing). */
type RescheduleBookingOutcome = RescheduleBookingResult | { readonly action: "reschedule_booking"; readonly conflict: true };

type BookingIdempotencyRecord = {
  key: string;
  tenantUid: string;
  action: ServiceBookingCommandAction;
  serviceId?: string;
  resourceId?: string;
  startAt?: IsoUtcString;
  endAt?: IsoUtcString;
  holdId?: string;
  bookingId?: string;
  workId?: string;
  cancelledAt?: IsoUtcString;
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
    | "HOLD_RELEASED"
    | "HOLD_ALREADY_CONFIRMED"
    | "LOCK_OWNERSHIP_LOST"
    | "WORK_NOT_CANCELABLE"
    | "BOOKING_NOT_RESCHEDULABLE"
    | "IDEMPOTENCY_CONFLICT"
    | "OUTSIDE_WORKING_HOURS"
    | "BLOCKED_INTERVAL"
    | "MISALIGNED_SLOT"
    | "MIN_ADVANCE_VIOLATION"
    | "MAX_ADVANCE_VIOLATION";

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
  HOLD_RELEASED: "Esta reserva temporária já foi liberada.",
  HOLD_ALREADY_CONFIRMED: "Esta reserva já foi confirmada e não pode mais ser liberada.",
  LOCK_OWNERSHIP_LOST: "Esta reserva temporária perdeu a posse do horário. Solicite um novo.",
  WORK_NOT_CANCELABLE: "Este atendimento não pode mais ser cancelado.",
  BOOKING_NOT_RESCHEDULABLE: "Este agendamento não pode mais ser reagendado.",
  IDEMPOTENCY_CONFLICT: "A mesma chave não pode ser reutilizada em outra operação.",
  OUTSIDE_WORKING_HOURS: "Este horário está fora do expediente configurado.",
  BLOCKED_INTERVAL: "Este horário está bloqueado na agenda.",
  MISALIGNED_SLOT: "Este horário não está alinhado aos horários disponíveis.",
  MIN_ADVANCE_VIOLATION: "Este horário está muito próximo do momento atual.",
  MAX_ADVANCE_VIOLATION: "Este horário está além da janela de antecedência permitida.",
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
function parseBooking(value: unknown): Booking {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ServiceBookingCommandError("NOT_FOUND", "Booking inválido.");
  }
  return assertValidBooking(value as Booking);
}
function parseServiceWorkDoc(value: unknown): ServiceWork {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ServiceBookingCommandError("NOT_FOUND", "Atendimento inválido.");
  }
  return assertValidServiceWork(value as ServiceWork);
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
  return { action: "create_hold", holdId: existing.holdId, serviceId: expected.serviceId ?? "", resourceId: expected.resourceId ?? "", startAt: expected.startAt ?? "", endAt: "", expiresAt: "", idempotentReplay: true };
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
    holdId: expected.holdId ?? "",
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

    const serverNowIso = new Date().toISOString();
    // SERV-AVAIL-01 §17 — o cliente nunca contorna o expediente/blocks/step/antecedência enviando um
    // horário fora deles: o servidor sempre revalida contra a agenda ANTES de conceder qualquer lock.
    try {
      await assertIntervalAllowedByScheduleCommand(tx, db, uid, resourceId, validStart, validEnd, serverNowIso);
    } catch (error) {
      if (error instanceof ServiceAvailabilityCommandError) throw translateAvailabilityError(error);
      throw error;
    }

    const segments = computeScheduleSegments(validStart, validEnd);
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

export type ConfirmServiceBookingHoldOptions = {
  /** SERV-PUBLIC-01 — só usado pelo fluxo público (server/service-public-booking.ts): a proveniência do
   * Booking resultante. O fluxo interno do dono nunca passa isto — default "manual", igual ao comportamento
   * anterior a este ticket. */
  readonly source?: Booking["source"];
  /** SERV-PUBLIC-01 — cria (uma única vez, tx.create — a idempotência do próprio confirm já garante que
   * este código só roda na primeira confirmação bem-sucedida deste holdId) um Client de contato ATOMICAMENTE
   * com o Booking/Work, e usa seu id como customerId. hold.customerId (já opcional hoje) continua a única
   * fonte quando isto não é informado — nenhuma mudança de comportamento para o fluxo interno existente. */
  readonly publicCustomerContact?: { readonly clientId: string; readonly name: string; readonly phone: string };
};

export async function confirmServiceBookingHoldCommand(
  db: Firestore,
  uid: string,
  holdId: string,
  idempotencyKey: string,
  options: ConfirmServiceBookingHoldOptions = {},
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

    // SERV-BOOK-02 §26 — se a liberação (release) já venceu a corrida contra esta confirmação, o hold
    // está definitivamente encerrado: nunca confirmar sobre um hold já released, mesmo que o caller ainda
    // possua o holdId (mesma defesa em profundidade do §7).
    if (hold.status === "released") {
      throw new ServiceBookingCommandError("HOLD_RELEASED", "Esta reserva temporária já foi liberada.");
    }

    const serverNowIso = new Date().toISOString();
    if (Date.parse(hold.expiresAt) <= Date.parse(serverNowIso)) {
      throw new ServiceBookingCommandError("HOLD_EXPIRED", "Esta reserva temporária expirou.");
    }

    // SERV-AVAIL-01 §24 — antes de transformar o hold em Booking, revalida a agenda ATUAL: se um novo
    // block ou uma mudança de expediente tornaram este intervalo inválido desde a criação do hold, a
    // confirmação é rejeitada aqui, sem escrever Booking/Work e sem converter nenhum lock (transaction
    // ainda não escreveu nada até este ponto).
    try {
      await assertIntervalAllowedByScheduleCommand(tx, db, uid, hold.resourceId, hold.startAt, hold.endAt, serverNowIso);
    } catch (error) {
      if (error instanceof ServiceAvailabilityCommandError) throw translateAvailabilityError(error);
      throw error;
    }

    const segments = computeScheduleSegments(hold.startAt, hold.endAt);
    const lockRefs = segments.map((segmentStartAt) => scheduleLockRef(db, uid, hold.resourceId, segmentStartAt));
    const serviceSnapRef = serviceRef(db, uid, hold.serviceId);
    const clientDocRef = options.publicCustomerContact
      ? db.collection("users").doc(uid).collection("clients").doc(options.publicCustomerContact.clientId)
      : undefined;
    const [lockSnaps, serviceSnap, clientSnap] = await Promise.all([
      lockRefs.length ? tx.getAll(...lockRefs) : Promise.resolve([]),
      tx.get(serviceSnapRef),
      clientDocRef ? tx.get(clientDocRef) : Promise.resolve(undefined),
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
    // SERV-PUBLIC-01 — o contato público vira a fonte do customerId quando presente; hold.customerId
    // continua a única fonte para o fluxo interno (publicCustomerContact nunca é passado por ele).
    const customerId = options.publicCustomerContact?.clientId ?? hold.customerId;
    const work: ServiceWork = assertValidServiceWork({
      id: workId,
      tenantUid: uid,
      status: "planned",
      origin: "booking",
      customerId,
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
      customerId,
      workId,
      startAt: hold.startAt,
      endAt: hold.endAt,
      status: "confirmed",
      source: options.source ?? "manual",
      createdAt: serverNowIso,
      updatedAt: serverNowIso,
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

    // SERV-PUBLIC-01 — o Client de contato entra na MESMA transaction do Booking/Work (atomicidade real:
    // nunca um Client órfão sem Booking, nunca um Booking sem o contato do cliente). Só cria se ainda não
    // existir (clientSnap lido acima, antes de qualquer escrita) — protege contra um clientId reaproveitado
    // de uma tentativa anterior que falhou depois deste ponto.
    if (options.publicCustomerContact && clientDocRef && clientSnap && !clientSnap.exists) {
      tx.create(clientDocRef, {
        id: options.publicCustomerContact.clientId,
        name: options.publicCustomerContact.name,
        phone: options.publicCustomerContact.phone,
      });
    }
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

/**
 * SERV-BOOK-02 §5-7 — libera voluntariamente um Hold ainda ativo antes do TTL de 5 minutos, devolvendo os
 * segmentos imediatamente. Nunca libera locks de um Hold já confirmado (§7) e nunca apaga lock pertencente
 * a outro owner (§5 passo 6) — só remove exatamente os locks que ainda pertencem a ESTE holdId.
 */
export async function releaseServiceBookingHoldCommand(
  db: Firestore,
  uid: string,
  holdId: string,
  idempotencyKey: string,
): Promise<ReleaseHoldResult> {
  return await db.runTransaction(async (tx: Transaction): Promise<ReleaseHoldResult> => {
    const idemRef = bookingIdempotencyRef(db, uid, idempotencyKey);
    const idemSnap = await tx.get(idemRef);
    if (idemSnap.exists) {
      const existing = idemSnap.data() as Partial<BookingIdempotencyRecord>;
      if (existing.key !== idempotencyKey || existing.tenantUid !== uid || existing.action !== "release_hold" || existing.holdId !== holdId) {
        throw new ServiceBookingCommandError("IDEMPOTENCY_CONFLICT", "idempotencyKey já usada com outros dados.");
      }
      return { action: "release_hold", holdId, idempotentReplay: true };
    }

    const holdDocRef = bookingHoldRef(db, uid, holdId);
    const holdSnap = await tx.get(holdDocRef);
    if (!holdSnap.exists) throw new ServiceBookingCommandError("NOT_FOUND", "Reserva temporária não encontrada.");
    const hold = parseHold(holdSnap.data());
    if (hold.tenantUid !== uid) throw new ServiceBookingCommandError("NOT_FOUND", "Reserva temporária não encontrada.");

    // §7 — hold já confirmado nunca é liberado, mesmo que o caller ainda possua o holdId: os locks agora
    // pertencem ao Booking, não mais ao Hold.
    if (hold.status === "confirmed") {
      throw new ServiceBookingCommandError("HOLD_ALREADY_CONFIRMED", "Esta reserva já foi confirmada e não pode mais ser liberada.");
    }

    const serverNowIso = new Date().toISOString();
    const result: ReleaseHoldResult = { action: "release_hold", holdId, idempotentReplay: false };

    // §6/R2 — já released (idempotência estrutural do próprio estado, mesmo sob uma key nova): nada a
    // liberar de novo, nunca reprocessa locks.
    if (hold.status === "released") {
      tx.create(idemRef, { key: idempotencyKey, tenantUid: uid, action: "release_hold", holdId, createdAt: serverNowIso } satisfies BookingIdempotencyRecord);
      return result;
    }

    const segments = computeScheduleSegments(hold.startAt, hold.endAt);
    const lockRefs = segments.map((segmentStartAt) => scheduleLockRef(db, uid, hold.resourceId, segmentStartAt));
    const lockSnaps = lockRefs.length ? await tx.getAll(...lockRefs) : [];

    // §6 — segura mesmo se hold.expiresAt <= serverNow (hold logicamente expirado): liberar é sempre
    // idempotente e nunca falha de forma a manter um segmento bloqueado artificialmente.
    const releasedHold: BookingHold = assertValidBookingHold({ ...hold, status: "released", releasedAt: serverNowIso });
    tx.set(holdDocRef, omitUndefined(releasedHold as unknown as Record<string, unknown>));

    for (let i = 0; i < lockSnaps.length; i += 1) {
      const lockSnap = lockSnaps[i];
      if (!lockSnap.exists) continue;
      const lock = parseLock(lockSnap.data());
      // Nunca apaga lock pertencente a outro owner (§5 passo 6) — só libera o que ainda é deste hold.
      if (lock.ownerType === "hold" && lock.ownerId === holdId) {
        tx.delete(lockRefs[i]);
      }
    }

    tx.create(idemRef, { key: idempotencyKey, tenantUid: uid, action: "release_hold", holdId, createdAt: serverNowIso } satisfies BookingIdempotencyRecord);
    return result;
  });
}

/**
 * SERV-BOOK-02 §8-12/§27-28 — cancela um Booking confirmado, atomicamente com o ServiceWork relacionado e
 * a liberação dos locks. NUNCA cria Refund, NUNCA altera Payment/refundedTotalCents — o domínio financeiro
 * é inteiramente independente (§10). Booking nunca é deletado, só muda de status (§27), mesmo padrão já
 * usado por ServiceWork.
 */
export async function cancelServiceBookingCommand(
  db: Firestore,
  uid: string,
  bookingId: string,
  idempotencyKey: string,
): Promise<CancelBookingResult> {
  return await db.runTransaction(async (tx: Transaction): Promise<CancelBookingResult> => {
    const idemRef = bookingIdempotencyRef(db, uid, idempotencyKey);
    const idemSnap = await tx.get(idemRef);
    if (idemSnap.exists) {
      const existing = idemSnap.data() as Partial<BookingIdempotencyRecord>;
      if (existing.key !== idempotencyKey || existing.tenantUid !== uid || existing.action !== "cancel_booking" || existing.bookingId !== bookingId) {
        throw new ServiceBookingCommandError("IDEMPOTENCY_CONFLICT", "idempotencyKey já usada com outros dados.");
      }
      if (typeof existing.workId !== "string" || typeof existing.cancelledAt !== "string") {
        throw new ServiceBookingCommandError("IDEMPOTENCY_CONFLICT", "Registro de idempotência incompleto.");
      }
      return { action: "cancel_booking", bookingId, workId: existing.workId, cancelledAt: existing.cancelledAt, idempotentReplay: true };
    }

    const bookingDocRef = bookingRef(db, uid, bookingId);
    const bookingSnap = await tx.get(bookingDocRef);
    if (!bookingSnap.exists) throw new ServiceBookingCommandError("NOT_FOUND", "Agendamento não encontrado.");
    const booking = parseBooking(bookingSnap.data());
    if (booking.tenantUid !== uid) throw new ServiceBookingCommandError("NOT_FOUND", "Agendamento não encontrado.");

    const serverNowIso = new Date().toISOString();

    // §12/C2 — cancelar um Booking já cancelado (mesmo com key nova) devolve o estado já existente, nunca
    // tenta liberar locks/mutar o Work de novo.
    if (booking.status === "cancelled") {
      const cancelledAt = booking.cancelledAt ?? serverNowIso;
      const result: CancelBookingResult = { action: "cancel_booking", bookingId, workId: booking.workId, cancelledAt, idempotentReplay: false };
      tx.create(idemRef, { key: idempotencyKey, tenantUid: uid, action: "cancel_booking", bookingId, workId: booking.workId, cancelledAt, createdAt: serverNowIso } satisfies BookingIdempotencyRecord);
      return result;
    }

    const workDocRef = serviceWorkRef(db, uid, booking.workId);
    const workSnap = await tx.get(workDocRef);
    if (!workSnap.exists) throw new ServiceBookingCommandError("NOT_FOUND", "Atendimento não encontrado.");
    const work = parseServiceWorkDoc(workSnap.data());

    // §9/§19/C5/C6 — política V1: só cancela via Booking enquanto o Work ainda não começou a ser
    // executado. Isto NÃO altera as transições aprovadas de ServiceWork (que continuam permitindo
    // in_progress -> cancelled por outras vias, ex. cancelServiceWorkCommand) — é uma regra adicional,
    // mais estrita, específica deste comando de cancelamento via Booking.
    if (work.status !== "planned") {
      throw new ServiceBookingCommandError("WORK_NOT_CANCELABLE", "Este atendimento não pode mais ser cancelado.");
    }

    const segments = computeScheduleSegments(booking.startAt, booking.endAt);
    const lockRefs = segments.map((segmentStartAt) => scheduleLockRef(db, uid, booking.resourceId, segmentStartAt));
    const lockSnaps = lockRefs.length ? await tx.getAll(...lockRefs) : [];

    // §10 — NUNCA toca financialSummary/ServicePaymentRecord/ServiceRefundRecord: só status/timing
    // operacional do Work, exatamente os campos que cancelServiceWorkCommand também tocaria.
    const cancelledBooking: Booking = assertValidBooking({ ...booking, status: "cancelled", updatedAt: serverNowIso, cancelledAt: serverNowIso });
    const cancelledWork: ServiceWork = assertValidServiceWork({ ...work, status: "cancelled", updatedAt: serverNowIso, cancelledAt: serverNowIso });

    const result: CancelBookingResult = { action: "cancel_booking", bookingId, workId: booking.workId, cancelledAt: serverNowIso, idempotentReplay: false };

    tx.set(bookingDocRef, omitUndefined(cancelledBooking as unknown as Record<string, unknown>));
    tx.set(workDocRef, omitUndefined(cancelledWork as unknown as Record<string, unknown>));
    for (let i = 0; i < lockSnaps.length; i += 1) {
      const lockSnap = lockSnaps[i];
      if (!lockSnap.exists) continue;
      const lock = parseLock(lockSnap.data());
      if (lock.ownerType === "booking" && lock.ownerId === bookingId) {
        tx.delete(lockRefs[i]);
      }
    }
    tx.create(idemRef, {
      key: idempotencyKey, tenantUid: uid, action: "cancel_booking", bookingId, workId: booking.workId,
      cancelledAt: serverNowIso, createdAt: serverNowIso,
    } satisfies BookingIdempotencyRecord);

    return result;
  });
}

/**
 * SERV-BOOK-02 §13-21 — reagenda um Booking confirmado para um novo startAt (resourceId/serviceId/
 * bookingId/workId permanecem inalterados, §13). endAt é sempre derivado de Service.durationMinutes, nunca
 * aceito do cliente (§14, mesma regra do createHold). Segmentos compartilhados com o intervalo antigo
 * nunca são tratados como conflito (§16) — só os segmentos realmente novos precisam ser validados/
 * adquiridos, e o horário antigo só é liberado depois que o novo já foi garantido na MESMA transaction
 * (§18: all-or-nothing, nunca perde o slot antigo numa falha).
 */
export async function rescheduleServiceBookingCommand(
  db: Firestore,
  uid: string,
  bookingId: string,
  newStartAtInput: string,
  idempotencyKey: string,
): Promise<RescheduleBookingOutcome> {
  return await db.runTransaction(async (tx: Transaction): Promise<RescheduleBookingOutcome> => {
    const idemRef = bookingIdempotencyRef(db, uid, idempotencyKey);
    const idemSnap = await tx.get(idemRef);
    if (idemSnap.exists) {
      const existing = idemSnap.data() as Partial<BookingIdempotencyRecord>;
      // §21 — fingerprint: bookingId + startAt alvo (endAt é sempre derivado do mesmo startAt+duração do
      // Service, então comparar startAt já garante o mesmo intervalo final).
      if (
        existing.key !== idempotencyKey || existing.tenantUid !== uid || existing.action !== "reschedule_booking"
        || existing.bookingId !== bookingId || existing.startAt !== newStartAtInput
      ) {
        throw new ServiceBookingCommandError("IDEMPOTENCY_CONFLICT", "idempotencyKey já usada com outros dados.");
      }
      if (typeof existing.workId !== "string" || typeof existing.endAt !== "string") {
        throw new ServiceBookingCommandError("IDEMPOTENCY_CONFLICT", "Registro de idempotência incompleto.");
      }
      return { action: "reschedule_booking", bookingId, workId: existing.workId, startAt: newStartAtInput, endAt: existing.endAt, idempotentReplay: true };
    }

    const bookingDocRef = bookingRef(db, uid, bookingId);
    const bookingSnap = await tx.get(bookingDocRef);
    if (!bookingSnap.exists) throw new ServiceBookingCommandError("NOT_FOUND", "Agendamento não encontrado.");
    const booking = parseBooking(bookingSnap.data());
    if (booking.tenantUid !== uid) throw new ServiceBookingCommandError("NOT_FOUND", "Agendamento não encontrado.");

    // §20/S7 — Booking cancelado nunca reagenda, deterministicamente.
    if (booking.status !== "confirmed") {
      throw new ServiceBookingCommandError("BOOKING_NOT_RESCHEDULABLE", "Este agendamento não pode mais ser reagendado.");
    }

    const workDocRef = serviceWorkRef(db, uid, booking.workId);
    const serviceDocRef = serviceRef(db, uid, booking.serviceId);
    const [workSnap, serviceSnap] = await Promise.all([tx.get(workDocRef), tx.get(serviceDocRef)]);
    if (!workSnap.exists) throw new ServiceBookingCommandError("NOT_FOUND", "Atendimento não encontrado.");
    const work = parseServiceWorkDoc(workSnap.data());
    if (!serviceSnap.exists) throw new ServiceBookingCommandError("NOT_FOUND", "Serviço não encontrado.");
    const service = parseService(serviceSnap.data());

    // §19/S8/S9 — mesma política V1 do cancel: só reagenda enquanto o Work ainda não começou.
    if (work.status !== "planned") {
      throw new ServiceBookingCommandError("BOOKING_NOT_RESCHEDULABLE", "Este agendamento não pode mais ser reagendado.");
    }

    const durationMinutes = resolveBookableServiceDuration(service);
    const newStartAt = validateStartAt(newStartAtInput);
    const newEndAt = new Date(Date.parse(newStartAt) + durationMinutes * 60_000).toISOString();
    const { startAt: validNewStart, endAt: validNewEnd } = assertValidBookingInterval(newStartAt, newEndAt);

    const serverNowIso = new Date().toISOString();
    // SERV-AVAIL-01 §18 — o NOVO alvo também precisa respeitar expediente/blocks/step/antecedência; o
    // intervalo antigo já foi validado quando o Booking nasceu/foi reagendado, não precisa revalidar aqui.
    // Chamado ANTES de tocar em qualquer lock, para nunca liberar o horário antigo sem garantir o novo.
    try {
      await assertIntervalAllowedByScheduleCommand(tx, db, uid, booking.resourceId, validNewStart, validNewEnd, serverNowIso);
    } catch (error) {
      if (error instanceof ServiceAvailabilityCommandError) throw translateAvailabilityError(error);
      throw error;
    }

    const oldSegments = computeScheduleSegments(booking.startAt, booking.endAt);
    const newSegments = computeScheduleSegments(validNewStart, validNewEnd);
    const { sharedSegments, releasedSegments, acquiredSegments } = diffScheduleSegments(oldSegments, newSegments);

    // §15 passo 9 — união de TODOS os segmentos envolvidos, uma única leitura, sempre antes de qualquer
    // escrita nesta transaction.
    const unionSegments = Array.from(new Set([...oldSegments, ...newSegments]));
    const lockRefs = unionSegments.map((segmentStartAt) => scheduleLockRef(db, uid, booking.resourceId, segmentStartAt));
    const lockSnaps = lockRefs.length ? await tx.getAll(...lockRefs) : [];
    const lockSnapBySegment = new Map<string, (typeof lockSnaps)[number]>();
    for (let i = 0; i < unionSegments.length; i += 1) lockSnapBySegment.set(unionSegments[i], lockSnaps[i]);

    // §17/§18 — target ocupado por outro Booking ou Hold ativo de outro owner => aborta TUDO, sem tocar
    // no horário antigo (a transaction ainda não escreveu nada até aqui).
    for (const segment of acquiredSegments) {
      const lockSnap = lockSnapBySegment.get(segment);
      const lock = lockSnap?.exists ? parseLock(lockSnap.data()) : undefined;
      if (!isSegmentAvailableForHold(lock, serverNowIso)) {
        return { action: "reschedule_booking", conflict: true };
      }
    }
    // §16 — segmentos compartilhados precisam continuar pertencendo a este mesmo Booking (checagem
    // defensiva; por construção são os próprios locks do Booking sendo reagendado).
    for (const segment of sharedSegments) {
      const lockSnap = lockSnapBySegment.get(segment);
      const lock = lockSnap?.exists ? parseLock(lockSnap.data()) : undefined;
      if (!lock || lock.ownerType !== "booking" || lock.ownerId !== bookingId) {
        throw new ServiceBookingCommandError("LOCK_OWNERSHIP_LOST", "Um dos horários deste agendamento não está mais garantido.");
      }
    }

    const rescheduledBooking: Booking = assertValidBooking({ ...booking, startAt: validNewStart, endAt: validNewEnd, updatedAt: serverNowIso });

    const result: RescheduleBookingOutcome = {
      action: "reschedule_booking", bookingId, workId: booking.workId, startAt: validNewStart, endAt: validNewEnd, idempotentReplay: false,
    };

    tx.set(bookingDocRef, omitUndefined(rescheduledBooking as unknown as Record<string, unknown>));
    for (const segment of acquiredSegments) {
      const ref = scheduleLockRef(db, uid, booking.resourceId, segment);
      const lockDoc: ScheduleLock = assertValidScheduleLock({ tenantUid: uid, resourceId: booking.resourceId, segmentStartAt: segment, ownerType: "booking", ownerId: bookingId });
      tx.set(ref, omitUndefined(lockDoc as unknown as Record<string, unknown>));
    }
    for (const segment of releasedSegments) {
      tx.delete(scheduleLockRef(db, uid, booking.resourceId, segment));
    }
    tx.create(idemRef, {
      key: idempotencyKey, tenantUid: uid, action: "reschedule_booking", bookingId, workId: booking.workId,
      startAt: newStartAtInput, endAt: validNewEnd, createdAt: serverNowIso,
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
  if (
    code === "SEGMENT_UNAVAILABLE" || code === "HOLD_EXPIRED" || code === "HOLD_RELEASED"
    || code === "HOLD_ALREADY_CONFIRMED" || code === "LOCK_OWNERSHIP_LOST"
    || code === "WORK_NOT_CANCELABLE" || code === "BOOKING_NOT_RESCHEDULABLE"
    || code === "OUTSIDE_WORKING_HOURS" || code === "BLOCKED_INTERVAL" || code === "MISALIGNED_SLOT"
    || code === "MIN_ADVANCE_VIOLATION" || code === "MAX_ADVANCE_VIOLATION"
  ) return 409;
  return 400;
}

/**
 * SERV-AVAIL-01 §17/§18/§24 — traduz uma rejeição da camada de disponibilidade (schedule/blocks) para o
 * mesmo tipo de erro que o resto deste arquivo já usa, para que o catch de cada rota não precise conhecer
 * o módulo de disponibilidade. server/service-availability-commands.ts nunca importa nada deste arquivo —
 * a dependência é sempre em UM sentido (booking -> availability) para não criar um ciclo entre os dois.
 */
function translateAvailabilityError(error: ServiceAvailabilityCommandError): ServiceBookingCommandError {
  const code: ServiceBookingCommandError["code"] = error.code === "OUTSIDE_WORKING_HOURS" ? "OUTSIDE_WORKING_HOURS"
    : error.code === "BLOCKED_INTERVAL" ? "BLOCKED_INTERVAL"
    : error.code === "MISALIGNED_SLOT" ? "MISALIGNED_SLOT"
    : error.code === "MIN_ADVANCE_VIOLATION" ? "MIN_ADVANCE_VIOLATION"
    : error.code === "MAX_ADVANCE_VIOLATION" ? "MAX_ADVANCE_VIOLATION"
    : "SEGMENT_UNAVAILABLE";
  return new ServiceBookingCommandError(code, error.message);
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

  app.post("/api/services/bookings/holds/:holdId/release", requireAuth, async (req, res) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!uid) { sendServiceBookingCommandError(res, 401, "UNAUTHENTICATED"); return; }
    try {
      const holdId = validateRouteEntityId(req.params.holdId, "holdId");
      const idempotencyKey = validateIdempotencyKey(req.body?.idempotencyKey);
      const result = await releaseServiceBookingHoldCommand(db_(), uid, holdId, idempotencyKey);
      logInfo("service_booking.hold_released", { requestId: req.requestId, holdId, idempotent: result.idempotentReplay });
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceBookingCommandError) {
        logWarn("service_booking.release_rejected", { requestId: req.requestId, holdId: req.params.holdId, code: error.code });
        sendServiceBookingCommandError(res, statusForError(error.code), error.code);
        return;
      }
      if (error instanceof ServiceBookingsDomainError) {
        sendServiceBookingCommandError(res, 400, "INVALID_PAYLOAD");
        return;
      }
      logError("service_booking.release_failed", error, { requestId: req.requestId, holdId: req.params.holdId });
      res.status(500).json({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível liberar a reserva agora." });
    }
  });

  app.post("/api/services/bookings/:bookingId/cancel", requireAuth, async (req, res) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!uid) { sendServiceBookingCommandError(res, 401, "UNAUTHENTICATED"); return; }
    try {
      const bookingId = validateRouteEntityId(req.params.bookingId, "bookingId");
      const idempotencyKey = validateIdempotencyKey(req.body?.idempotencyKey);
      const result = await cancelServiceBookingCommand(db_(), uid, bookingId, idempotencyKey);
      logInfo("service_booking.cancelled", { requestId: req.requestId, bookingId, workId: result.workId, idempotent: result.idempotentReplay });
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceBookingCommandError) {
        logWarn("service_booking.cancel_rejected", { requestId: req.requestId, bookingId: req.params.bookingId, code: error.code });
        sendServiceBookingCommandError(res, statusForError(error.code), error.code);
        return;
      }
      if (error instanceof ServiceBookingsDomainError) {
        sendServiceBookingCommandError(res, 400, "INVALID_PAYLOAD");
        return;
      }
      logError("service_booking.cancel_failed", error, { requestId: req.requestId, bookingId: req.params.bookingId });
      res.status(500).json({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível cancelar o agendamento agora." });
    }
  });

  app.post("/api/services/bookings/:bookingId/reschedule", requireAuth, async (req, res) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!uid) { sendServiceBookingCommandError(res, 401, "UNAUTHENTICATED"); return; }
    try {
      const bookingId = validateRouteEntityId(req.params.bookingId, "bookingId");
      const startAt = typeof req.body?.startAt === "string" ? req.body.startAt : "";
      const idempotencyKey = validateIdempotencyKey(req.body?.idempotencyKey);
      const outcome = await rescheduleServiceBookingCommand(db_(), uid, bookingId, startAt, idempotencyKey);
      if ("conflict" in outcome) {
        logWarn("service_booking.reschedule_conflict", { requestId: req.requestId, bookingId });
        sendServiceBookingCommandError(res, 409, "SEGMENT_UNAVAILABLE");
        return;
      }
      logInfo("service_booking.rescheduled", { requestId: req.requestId, bookingId, workId: outcome.workId, idempotent: outcome.idempotentReplay });
      res.status(200).json(outcome);
    } catch (error) {
      if (error instanceof ServiceBookingCommandError) {
        logWarn("service_booking.reschedule_rejected", { requestId: req.requestId, bookingId: req.params.bookingId, code: error.code });
        sendServiceBookingCommandError(res, statusForError(error.code), error.code);
        return;
      }
      if (error instanceof ServiceBookingsDomainError) {
        sendServiceBookingCommandError(res, 400, "INVALID_PAYLOAD");
        return;
      }
      logError("service_booking.reschedule_failed", error, { requestId: req.requestId, bookingId: req.params.bookingId });
      res.status(500).json({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível reagendar agora." });
    }
  });
}
