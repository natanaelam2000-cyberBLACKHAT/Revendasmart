/**
 * SERV-AVAIL-01 — camada de disponibilidade server-authoritative: expediente semanal (ServiceResourceSchedule),
 * bloqueios extraordinários (ServiceAvailabilityBlock) e a consulta de projeção de slots (getServiceAvailability).
 *
 * TIMEZONE (§5/§39) — auditoria antes de escolher a implementação: Node 24 (runtime deste projeto) expõe
 * `Intl.DateTimeFormat`/`Intl.supportedValuesOf("timeZone")` com a base IANA completa, mas NÃO expõe
 * `Temporal` de forma estável, e a stdlib não oferece uma conversão local<->UTC para uma zona IANA
 * arbitrária pronta para uso (só `toLocaleString`/`formatToParts`, que exigiriam reimplementar à mão o
 * algoritmo iterativo de resolução de offset/DST — exatamente o tipo de "cálculo manual de offset" que
 * este ticket veta). `date-fns-tz` foi adicionada (server-only) por ser a extensão oficial e já madura do
 * `date-fns` que este projeto já usa como dependência de datas, pequena, sem novas peer deps, e usada aqui
 * exclusivamente dentro de server/ — nunca importada por shared/ nem client/, então nunca entra no bundle
 * do client (confirmado por performance:bundle-check permanecer com INITIAL_BOOT_REGRESSION_BYTES=0).
 *
 * Nenhum código aqui calcula offset manualmente: toZonedTime/fromZonedTime usam a base de dados IANA real
 * do runtime (a mesma que Intl usa), então DST é resolvido corretamente para qualquer timezone válida.
 */
import type { Express, NextFunction, Request, Response } from "express";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { logError, logInfo, logWarn } from "./logger";
import { type IsoUtcString, type Service } from "../shared/services";
import {
  assertValidBookingInterval,
  assertValidScheduleLock,
  computeScheduleSegments,
  isExpired,
  isSegmentAvailableForHold,
  resolveBookableServiceDuration,
  ServiceBookingsDomainError,
  type ScheduleLock,
} from "../shared/service-bookings";
import {
  assertValidAdvanceWindow,
  assertValidAvailabilityBlock,
  assertValidAvailabilityQueryRange,
  assertValidServiceResourceSchedule,
  assertValidSlotStepMinutes,
  assertValidTimezone,
  assertValidWeeklyHours,
  DAYS_OF_WEEK,
  generateCandidateStartMinutes,
  intervalsOverlap,
  isIntervalWithinPeriods,
  ServiceAvailabilityDomainError,
  type DayOfWeek,
  type ServiceAvailabilityBlock,
  type ServiceResourceSchedule,
  type WeeklyHours,
} from "../shared/service-availability";

export type ServiceAvailabilityCommandErrorCode =
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "INVALID_PAYLOAD"
  | "OUTSIDE_WORKING_HOURS"
  | "BLOCKED_INTERVAL"
  | "MISALIGNED_SLOT"
  | "MIN_ADVANCE_VIOLATION"
  | "MAX_ADVANCE_VIOLATION"
  | "BLOCK_CONFLICT_WITH_BOOKING"
  | "BLOCK_CONFLICT_WITH_ACTIVE_HOLD"
  | "IDEMPOTENCY_CONFLICT";

export class ServiceAvailabilityCommandError extends Error {
  readonly code: ServiceAvailabilityCommandErrorCode;

  constructor(code: ServiceAvailabilityCommandErrorCode, message: string) {
    super(message);
    this.name = "ServiceAvailabilityCommandError";
    this.code = code;
  }
}

const COMMAND_ERROR_MESSAGES: Record<ServiceAvailabilityCommandErrorCode, string> = {
  UNAUTHENTICATED: "Sessão inválida. Faça login novamente.",
  NOT_FOUND: "Serviço, agenda ou bloqueio não encontrado.",
  INVALID_PAYLOAD: "Confira os dados enviados e tente novamente.",
  OUTSIDE_WORKING_HOURS: "Este horário está fora do expediente configurado.",
  BLOCKED_INTERVAL: "Este horário está bloqueado na agenda.",
  MISALIGNED_SLOT: "Este horário não está alinhado aos horários disponíveis.",
  MIN_ADVANCE_VIOLATION: "Este horário está muito próximo do momento atual.",
  MAX_ADVANCE_VIOLATION: "Este horário está além da janela de antecedência permitida.",
  BLOCK_CONFLICT_WITH_BOOKING: "Já existe um agendamento confirmado neste horário.",
  BLOCK_CONFLICT_WITH_ACTIVE_HOLD: "Existe uma reserva temporária ativa neste horário.",
  IDEMPOTENCY_CONFLICT: "A mesma chave não pode ser reutilizada em outra operação.",
};

function db_(): Firestore {
  return getFirebaseAdmin().firestore();
}
function serviceRef(db: Firestore, uid: string, serviceId: string) {
  return db.collection("users").doc(uid).collection("services").doc(serviceId);
}
function resourceScheduleRef(db: Firestore, uid: string, resourceId: string) {
  return db.collection("users").doc(uid).collection("serviceResourceSchedules").doc(resourceId);
}
function availabilityBlocksCollection(db: Firestore, uid: string) {
  return db.collection("users").doc(uid).collection("serviceAvailabilityBlocks");
}
function availabilityBlockRef(db: Firestore, uid: string, blockId: string) {
  return availabilityBlocksCollection(db, uid).doc(blockId);
}
function scheduleLockId(resourceId: string, segmentStartAt: string): string {
  return `${resourceId}__${segmentStartAt.replace(/[:.]/g, "-")}`;
}
function scheduleLockRef(db: Firestore, uid: string, resourceId: string, segmentStartAt: string) {
  return db.collection("users").doc(uid).collection("scheduleLocks").doc(scheduleLockId(resourceId, segmentStartAt));
}
function scheduleLocksCollection(db: Firestore, uid: string) {
  return db.collection("users").doc(uid).collection("scheduleLocks");
}
function availabilityIdempotencyRef(db: Firestore, uid: string, key: string) {
  return db.collection("users").doc(uid).collection("serviceAvailabilityCommandIdempotency").doc(key);
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v !== "undefined")) as T;
}

function generateBlockId(): string {
  return `block-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseService(value: unknown): Service {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ServiceAvailabilityCommandError("NOT_FOUND", "Serviço não encontrado.");
  }
  return value as Service;
}
function parseSchedule(value: unknown): ServiceResourceSchedule {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ServiceAvailabilityCommandError("NOT_FOUND", "Agenda não encontrada.");
  }
  return assertValidServiceResourceSchedule(value as ServiceResourceSchedule);
}
function parseBlock(value: unknown): ServiceAvailabilityBlock {
  return assertValidAvailabilityBlock(value as ServiceAvailabilityBlock);
}
function parseLock(value: unknown): ScheduleLock {
  return assertValidScheduleLock(value as ScheduleLock);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Converte um instante UTC para o "relógio de parede" local da timezone da agenda — só isto que precisa
 * de date-fns-tz; nunca reimplementado à mão (ver nota de timezone no topo do arquivo).
 *
 * IMPORTANTE: `toZonedTime` (date-fns-tz@3) devolve um Date cujos campos LOCAIS (system timezone —
 * getHours/getDate/etc., não getUTCHours/getUTCDate) representam o horário de parede da timezone alvo —
 * nunca os campos UTC (confirmado lendo node_modules/date-fns-tz/dist/esm/toZonedTime/index.js, que usa
 * `resultDate.setHours(...)`, um setter local). Usar os getters UTC aqui seria um bug silencioso que só
 * "funcionaria por acidente" numa máquina cujo próprio system timezone já fosse UTC — por isso os
 * getters locais são usados explicitamente, independente do timezone do processo que roda o servidor. */
function resolveLocalWallClock(instantIso: string, timezone: string): { dayOfWeek: DayOfWeek; minuteOfDay: number; localDateKey: string } {
  const zoned = toZonedTime(instantIso, timezone);
  return {
    dayOfWeek: DAYS_OF_WEEK[zoned.getDay()],
    minuteOfDay: zoned.getHours() * 60 + zoned.getMinutes(),
    localDateKey: `${zoned.getFullYear()}-${pad2(zoned.getMonth() + 1)}-${pad2(zoned.getDate())}`,
  };
}

/** Inverso: um horário de parede local ("YYYY-MM-DD" + minuto do dia) na timezone da agenda -> instante
 * UTC real, respeitando DST via date-fns-tz. */
function localWallClockToInstant(localDateKey: string, minuteOfDay: number, timezone: string): IsoUtcString {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  const localNaiveIso = `${localDateKey}T${pad2(hours)}:${pad2(minutes)}:00.000`;
  return fromZonedTime(localNaiveIso, timezone).toISOString();
}

function addLocalDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}
function dayOfWeekForDateKey(dateKey: string): DayOfWeek {
  const [year, month, day] = dateKey.split("-").map(Number);
  return DAYS_OF_WEEK[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function validateRouteEntityId(value: unknown, fieldName: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(text)) {
    throw new ServiceAvailabilityCommandError("INVALID_PAYLOAD", `${fieldName} inválido.`);
  }
  return text;
}
function validateIdempotencyKey(value: unknown): string {
  const key = typeof value === "string" ? value.trim() : "";
  if (!/^[a-zA-Z0-9_-]{6,120}$/.test(key)) {
    throw new ServiceAvailabilityCommandError("INVALID_PAYLOAD", "idempotencyKey inválida.");
  }
  return key;
}
function validateTimestampInput(value: unknown, fieldName: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || !Number.isFinite(Date.parse(text))) {
    throw new ServiceAvailabilityCommandError("INVALID_PAYLOAD", `${fieldName} deve ser um timestamp ISO válido.`);
  }
  return new Date(Date.parse(text)).toISOString();
}

/**
 * §17/§18/§24 — CRÍTICO: chamada por server/service-booking-commands.ts em createHold/confirm/reschedule
 * ANTES de qualquer escrita de lock/Booking/Work, dentro da MESMA transaction. Nunca reimplementa a
 * definição de "hold ativo ocupa o segmento" (reusa isSegmentAvailableForHold/isExpired de
 * shared/service-bookings.ts) nem materializa lock para blocks (§21) — só lê.
 *
 * Compatibilidade retroativa deliberada: se o resource ainda NÃO tem ServiceResourceSchedule configurado,
 * a validação de expediente é pulada (resource "sem agenda" = sempre aberto, mesmo comportamento implícito
 * de antes deste ticket existir) — isto preserva 100% dos testes/recursos do motor SERV-BOOK-01/02
 * aprovado, que nunca configuram uma agenda. Blocks, por outro lado, SEMPRE são checados, independente de
 * agenda configurada, porque um bloqueio é uma ação administrativa explícita para aquele resource (§19/§20).
 */
export async function assertIntervalAllowedByScheduleCommand(
  tx: Transaction,
  db: Firestore,
  uid: string,
  resourceId: string,
  startAt: IsoUtcString,
  endAt: IsoUtcString,
  serverNowIso: IsoUtcString,
): Promise<void> {
  const scheduleSnap = await tx.get(resourceScheduleRef(db, uid, resourceId));
  if (scheduleSnap.exists) {
    const schedule = parseSchedule(scheduleSnap.data());
    const { dayOfWeek, minuteOfDay } = resolveLocalWallClock(startAt, schedule.timezone);

    if (minuteOfDay % schedule.slotStepMinutes !== 0) {
      throw new ServiceAvailabilityCommandError("MISALIGNED_SLOT", COMMAND_ERROR_MESSAGES.MISALIGNED_SLOT);
    }

    const durationMinutes = Math.round((Date.parse(endAt) - Date.parse(startAt)) / 60_000);
    const periods = schedule.weeklyHours[dayOfWeek];
    if (!isIntervalWithinPeriods(minuteOfDay, durationMinutes, periods)) {
      throw new ServiceAvailabilityCommandError("OUTSIDE_WORKING_HOURS", COMMAND_ERROR_MESSAGES.OUTSIDE_WORKING_HOURS);
    }

    // §12/E2 — startAt >= now + minAdvance é permitido (boundary inclusivo, semântica documentada no ticket).
    const advanceMs = Date.parse(startAt) - Date.parse(serverNowIso);
    if (advanceMs < schedule.minAdvanceMinutes * 60_000) {
      throw new ServiceAvailabilityCommandError("MIN_ADVANCE_VIOLATION", COMMAND_ERROR_MESSAGES.MIN_ADVANCE_VIOLATION);
    }
    if (typeof schedule.maxAdvanceDays === "number" && advanceMs > schedule.maxAdvanceDays * 86_400_000) {
      throw new ServiceAvailabilityCommandError("MAX_ADVANCE_VIOLATION", COMMAND_ERROR_MESSAGES.MAX_ADVANCE_VIOLATION);
    }
  }

  // §19/§20 — blocks sempre valem, mesmo sem ServiceResourceSchedule configurado.
  const overlappingBlocksSnap = await tx.get(
    availabilityBlocksCollection(db, uid).where("resourceId", "==", resourceId).where("startAt", "<", endAt),
  );
  for (const blockDoc of overlappingBlocksSnap.docs) {
    const block = parseBlock(blockDoc.data());
    if (intervalsOverlap(startAt, endAt, block.startAt, block.endAt)) {
      throw new ServiceAvailabilityCommandError("BLOCKED_INTERVAL", COMMAND_ERROR_MESSAGES.BLOCKED_INTERVAL);
    }
  }
}

// ====================================================================================================
// upsertServiceResourceSchedule — §22/§23: nunca invalida Bookings/Holds já existentes, só passa a valer
// para novos holds/reschedules a partir de agora (assertIntervalAllowedByScheduleCommand lê a agenda ATUAL
// a cada chamada, nunca uma cópia congelada).
// ====================================================================================================

type UpsertScheduleResult = {
  action: "upsert_schedule";
  resourceId: string;
  idempotentReplay: boolean;
};

type AvailabilityIdempotencyRecord = {
  key: string;
  tenantUid: string;
  action: "upsert_schedule" | "create_block" | "delete_block";
  resourceId?: string;
  blockId?: string;
  payloadHash?: string;
  createdAt: string;
};

export type UpsertServiceResourceScheduleInput = {
  timezone: string;
  slotStepMinutes: number;
  minAdvanceMinutes?: number;
  maxAdvanceDays?: number;
  weeklyHours: WeeklyHours;
};

function hashUpsertInput(resourceId: string, input: UpsertServiceResourceScheduleInput): string {
  return JSON.stringify({
    resourceId,
    timezone: input.timezone,
    slotStepMinutes: input.slotStepMinutes,
    minAdvanceMinutes: input.minAdvanceMinutes ?? 0,
    maxAdvanceDays: input.maxAdvanceDays ?? null,
    weeklyHours: input.weeklyHours,
  });
}

export async function upsertServiceResourceScheduleCommand(
  db: Firestore,
  uid: string,
  resourceId: string,
  input: UpsertServiceResourceScheduleInput,
  idempotencyKey: string,
): Promise<UpsertScheduleResult> {
  const payloadHash = hashUpsertInput(resourceId, input);
  return await db.runTransaction(async (tx: Transaction): Promise<UpsertScheduleResult> => {
    const idemRef = availabilityIdempotencyRef(db, uid, idempotencyKey);
    const idemSnap = await tx.get(idemRef);
    if (idemSnap.exists) {
      const existing = idemSnap.data() as Partial<AvailabilityIdempotencyRecord>;
      if (existing.action !== "upsert_schedule" || existing.resourceId !== resourceId || existing.payloadHash !== payloadHash) {
        throw new ServiceAvailabilityCommandError("IDEMPOTENCY_CONFLICT", COMMAND_ERROR_MESSAGES.IDEMPOTENCY_CONFLICT);
      }
      return { action: "upsert_schedule", resourceId, idempotentReplay: true };
    }

    const scheduleDocRef = resourceScheduleRef(db, uid, resourceId);
    const existingSnap = await tx.get(scheduleDocRef);
    const serverNowIso = new Date().toISOString();
    const minAdvanceMinutes = input.minAdvanceMinutes ?? 0;

    const schedule: ServiceResourceSchedule = assertValidServiceResourceSchedule({
      id: resourceId,
      tenantUid: uid,
      resourceId,
      timezone: assertValidTimezone(input.timezone),
      slotStepMinutes: assertValidSlotStepMinutes(input.slotStepMinutes),
      minAdvanceMinutes,
      maxAdvanceDays: input.maxAdvanceDays,
      weeklyHours: assertValidWeeklyHours(input.weeklyHours),
      createdAt: existingSnap.exists && typeof existingSnap.data()?.createdAt === "string" ? (existingSnap.data()!.createdAt as string) : serverNowIso,
      updatedAt: serverNowIso,
    });
    assertValidAdvanceWindow(schedule.minAdvanceMinutes, schedule.maxAdvanceDays);

    tx.set(scheduleDocRef, omitUndefined(schedule as unknown as Record<string, unknown>));
    tx.create(idemRef, {
      key: idempotencyKey, tenantUid: uid, action: "upsert_schedule", resourceId, payloadHash, createdAt: serverNowIso,
    } satisfies AvailabilityIdempotencyRecord);

    return { action: "upsert_schedule", resourceId, idempotentReplay: false };
  });
}

// ====================================================================================================
// createServiceAvailabilityBlock / deleteServiceAvailabilityBlock — §8/§19/§20/§21.
// ====================================================================================================

type CreateBlockResult = {
  action: "create_block";
  blockId: string;
  resourceId: string;
  startAt: IsoUtcString;
  endAt: IsoUtcString;
  idempotentReplay: boolean;
};

type DeleteBlockResult = {
  action: "delete_block";
  blockId: string;
  idempotentReplay: boolean;
};

export async function createServiceAvailabilityBlockCommand(
  db: Firestore,
  uid: string,
  resourceId: string,
  startAtInput: string,
  endAtInput: string,
  reason: string | undefined,
  idempotencyKey: string,
): Promise<CreateBlockResult> {
  return await db.runTransaction(async (tx: Transaction): Promise<CreateBlockResult> => {
    const idemRef = availabilityIdempotencyRef(db, uid, idempotencyKey);
    const idemSnap = await tx.get(idemRef);
    if (idemSnap.exists) {
      const existing = idemSnap.data() as Partial<AvailabilityIdempotencyRecord>;
      const payloadHash = JSON.stringify({ resourceId, startAtInput, endAtInput, reason: reason ?? null });
      if (existing.action !== "create_block" || existing.payloadHash !== payloadHash) {
        throw new ServiceAvailabilityCommandError("IDEMPOTENCY_CONFLICT", COMMAND_ERROR_MESSAGES.IDEMPOTENCY_CONFLICT);
      }
      if (typeof existing.blockId !== "string") {
        throw new ServiceAvailabilityCommandError("IDEMPOTENCY_CONFLICT", "Registro de idempotência incompleto.");
      }
      return { action: "create_block", blockId: existing.blockId, resourceId, startAt: startAtInput, endAt: endAtInput, idempotentReplay: true };
    }

    // §9/§21 — reusa a MESMA definição de segmento de 5 minutos usada pelos locks (nunca uma segunda
    // definição de intervalo/alinhamento paralela); um block que não se alinhe à grade é rejeitado como
    // payload inválido, exatamente como um createHold seria.
    let validStart: IsoUtcString;
    let validEnd: IsoUtcString;
    let segments: readonly IsoUtcString[];
    try {
      const interval = assertValidBookingInterval(startAtInput, endAtInput);
      validStart = interval.startAt;
      validEnd = interval.endAt;
      segments = computeScheduleSegments(validStart, validEnd);
    } catch (error) {
      if (error instanceof ServiceBookingsDomainError) {
        throw new ServiceAvailabilityCommandError("INVALID_PAYLOAD", error.message);
      }
      throw error;
    }

    const serverNowIso = new Date().toISOString();
    const lockRefs = segments.map((segmentStartAt) => scheduleLockRef(db, uid, resourceId, segmentStartAt));
    const lockSnaps = lockRefs.length ? await tx.getAll(...lockRefs) : [];
    for (const lockSnap of lockSnaps) {
      if (!lockSnap.exists) continue;
      const lock = parseLock(lockSnap.data());
      if (lock.ownerType === "booking") {
        throw new ServiceAvailabilityCommandError("BLOCK_CONFLICT_WITH_BOOKING", COMMAND_ERROR_MESSAGES.BLOCK_CONFLICT_WITH_BOOKING);
      }
      if (lock.ownerType === "hold" && typeof lock.expiresAt === "string" && !isExpired(lock.expiresAt, serverNowIso)) {
        throw new ServiceAvailabilityCommandError("BLOCK_CONFLICT_WITH_ACTIVE_HOLD", COMMAND_ERROR_MESSAGES.BLOCK_CONFLICT_WITH_ACTIVE_HOLD);
      }
      // hold expirado (§20) — não bloqueia a criação do block.
    }

    const blockId = generateBlockId();
    const block: ServiceAvailabilityBlock = assertValidAvailabilityBlock({
      id: blockId, tenantUid: uid, resourceId, startAt: validStart, endAt: validEnd, reason, createdAt: serverNowIso,
    });
    const payloadHash = JSON.stringify({ resourceId, startAtInput, endAtInput, reason: reason ?? null });

    // §21 — nenhum ScheduleLock é criado para o block; só o documento de disponibilidade em si.
    tx.create(availabilityBlockRef(db, uid, blockId), omitUndefined(block as unknown as Record<string, unknown>));
    tx.create(idemRef, {
      key: idempotencyKey, tenantUid: uid, action: "create_block", resourceId, blockId, payloadHash, createdAt: serverNowIso,
    } satisfies AvailabilityIdempotencyRecord);

    return { action: "create_block", blockId, resourceId, startAt: validStart, endAt: validEnd, idempotentReplay: false };
  });
}

export async function deleteServiceAvailabilityBlockCommand(
  db: Firestore,
  uid: string,
  blockId: string,
  idempotencyKey: string,
): Promise<DeleteBlockResult> {
  return await db.runTransaction(async (tx: Transaction): Promise<DeleteBlockResult> => {
    const idemRef = availabilityIdempotencyRef(db, uid, idempotencyKey);
    const idemSnap = await tx.get(idemRef);
    if (idemSnap.exists) {
      const existing = idemSnap.data() as Partial<AvailabilityIdempotencyRecord>;
      if (existing.action !== "delete_block" || existing.blockId !== blockId) {
        throw new ServiceAvailabilityCommandError("IDEMPOTENCY_CONFLICT", COMMAND_ERROR_MESSAGES.IDEMPOTENCY_CONFLICT);
      }
      return { action: "delete_block", blockId, idempotentReplay: true };
    }

    const blockDocRef = availabilityBlockRef(db, uid, blockId);
    const blockSnap = await tx.get(blockDocRef);
    const serverNowIso = new Date().toISOString();
    // §29 — idempotente: já não existir é sucesso (nunca um erro), mesma robustez de release-hold/cancel.
    if (blockSnap.exists) {
      const block = parseBlock(blockSnap.data());
      if (block.tenantUid === uid) {
        tx.delete(blockDocRef);
      }
    }
    tx.create(idemRef, {
      key: idempotencyKey, tenantUid: uid, action: "delete_block", blockId, createdAt: serverNowIso,
    } satisfies AvailabilityIdempotencyRecord);

    return { action: "delete_block", blockId, idempotentReplay: false };
  });
}

// ====================================================================================================
// getServiceAvailability — §14/§16: PROJEÇÃO server-side, não transacional, não reserva nada. Entre esta
// leitura e um createBookingHold real, outro cliente pode ocupar o mesmo horário — a autoridade final é
// sempre a transaction de createHold (que roda esta MESMA validação de novo, dentro da transaction).
// ====================================================================================================

export type AvailabilityCandidate = { readonly startAt: IsoUtcString; readonly endAt: IsoUtcString };
export type ServiceAvailabilityResult = {
  readonly timezone: string;
  readonly slotStepMinutes: number;
  readonly durationMinutes: number;
  readonly candidates: readonly AvailabilityCandidate[];
};

export async function getServiceAvailabilityCommand(
  db: Firestore,
  uid: string,
  serviceId: string,
  resourceId: string,
  rangeStartAtInput: string,
  rangeEndAtInput: string,
): Promise<ServiceAvailabilityResult> {
  let rangeStartAt: IsoUtcString;
  let rangeEndAt: IsoUtcString;
  try {
    ({ rangeStartAt, rangeEndAt } = assertValidAvailabilityQueryRange(rangeStartAtInput, rangeEndAtInput));
  } catch (error) {
    if (error instanceof ServiceAvailabilityDomainError) throw new ServiceAvailabilityCommandError("INVALID_PAYLOAD", error.message);
    throw error;
  }

  const serviceSnap = await serviceRef(db, uid, serviceId).get();
  if (!serviceSnap.exists) throw new ServiceAvailabilityCommandError("NOT_FOUND", "Serviço não encontrado.");
  const service = parseService(serviceSnap.data());
  if (service.tenantUid !== uid) throw new ServiceAvailabilityCommandError("NOT_FOUND", "Serviço não encontrado.");
  let durationMinutes: number;
  try {
    durationMinutes = resolveBookableServiceDuration(service);
  } catch (error) {
    if (error instanceof ServiceBookingsDomainError) throw new ServiceAvailabilityCommandError("INVALID_PAYLOAD", error.message);
    throw error;
  }

  const scheduleSnap = await resourceScheduleRef(db, uid, resourceId).get();
  if (!scheduleSnap.exists) {
    // §16 — sem agenda configurada, a projeção não pode "inventar" expediente: nenhum candidato.
    return { timezone: "UTC", slotStepMinutes: 30, durationMinutes, candidates: [] };
  }
  const schedule = parseSchedule(scheduleSnap.data());
  const serverNowIso = new Date().toISOString();

  const startWall = resolveLocalWallClock(rangeStartAt, schedule.timezone);
  const endWall = resolveLocalWallClock(rangeEndAt, schedule.timezone);

  const candidates: AvailabilityCandidate[] = [];
  // §40 — bounded pelo range já validado (<= MAX_AVAILABILITY_QUERY_RANGE_DAYS), nunca um loop arbitrário.
  for (let dateKey = startWall.localDateKey; Date.parse(`${dateKey}T00:00:00.000Z`) <= Date.parse(`${endWall.localDateKey}T00:00:00.000Z`); dateKey = addLocalDays(dateKey, 1)) {
    const periods = schedule.weeklyHours[dayOfWeekForDateKey(dateKey)];
    for (const startMinute of generateCandidateStartMinutes(periods, schedule.slotStepMinutes, durationMinutes)) {
      const candidateStartAt = localWallClockToInstant(dateKey, startMinute, schedule.timezone);
      const candidateEndAt = localWallClockToInstant(dateKey, startMinute + durationMinutes, schedule.timezone);
      if (Date.parse(candidateStartAt) < Date.parse(rangeStartAt) || Date.parse(candidateStartAt) >= Date.parse(rangeEndAt)) continue;
      const advanceMs = Date.parse(candidateStartAt) - Date.parse(serverNowIso);
      if (advanceMs < schedule.minAdvanceMinutes * 60_000) continue;
      if (typeof schedule.maxAdvanceDays === "number" && advanceMs > schedule.maxAdvanceDays * 86_400_000) continue;
      candidates.push({ startAt: candidateStartAt, endAt: candidateEndAt });
    }
  }

  const lockSnaps = await scheduleLocksCollection(db, uid)
    .where("resourceId", "==", resourceId)
    .where("segmentStartAt", ">=", rangeStartAt)
    .where("segmentStartAt", "<", rangeEndAt)
    .get();
  const occupiedSegments = new Set<string>();
  for (const lockDoc of lockSnaps.docs) {
    const lock = parseLock(lockDoc.data());
    if (!isSegmentAvailableForHold(lock, serverNowIso)) occupiedSegments.add(lock.segmentStartAt);
  }

  const blockSnaps = await availabilityBlocksCollection(db, uid)
    .where("resourceId", "==", resourceId)
    .where("startAt", "<", rangeEndAt)
    .get();
  const overlappingBlocks = blockSnaps.docs.map((doc) => parseBlock(doc.data())).filter((block) => Date.parse(block.endAt) > Date.parse(rangeStartAt));

  const available = candidates.filter((candidate) => {
    const segments = computeScheduleSegments(candidate.startAt, candidate.endAt);
    if (segments.some((segment) => occupiedSegments.has(segment))) return false;
    if (overlappingBlocks.some((block) => intervalsOverlap(candidate.startAt, candidate.endAt, block.startAt, block.endAt))) return false;
    return true;
  });

  return { timezone: schedule.timezone, slotStepMinutes: schedule.slotStepMinutes, durationMinutes, candidates: available };
}

// ====================================================================================================
// Rotas HTTP — mesmo padrão de server/service-booking-commands.ts.
// ====================================================================================================

function sendAvailabilityCommandError(res: Response, status: number, code: ServiceAvailabilityCommandErrorCode): void {
  res.status(status).json({ code, message: COMMAND_ERROR_MESSAGES[code] });
}
function statusForAvailabilityError(code: ServiceAvailabilityCommandErrorCode): number {
  if (code === "UNAUTHENTICATED") return 401;
  if (code === "NOT_FOUND") return 404;
  if (code === "INVALID_PAYLOAD") return 400;
  return 409;
}

export function registerServiceAvailabilityRoutes(
  app: Express,
  requireAuth: (req: Request, res: Response, next: NextFunction) => void,
): void {
  app.post("/api/services/availability/schedules/:resourceId", requireAuth, async (req, res) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!uid) { sendAvailabilityCommandError(res, 401, "UNAUTHENTICATED"); return; }
    try {
      const resourceId = validateRouteEntityId(req.params.resourceId, "resourceId");
      const idempotencyKey = validateIdempotencyKey(req.body?.idempotencyKey);
      const timezone = typeof req.body?.timezone === "string" ? req.body.timezone : "";
      const slotStepMinutes = Number(req.body?.slotStepMinutes);
      const minAdvanceMinutes = typeof req.body?.minAdvanceMinutes === "number" ? req.body.minAdvanceMinutes : undefined;
      const maxAdvanceDays = typeof req.body?.maxAdvanceDays === "number" ? req.body.maxAdvanceDays : undefined;
      const weeklyHours = req.body?.weeklyHours as WeeklyHours;
      if (!weeklyHours || typeof weeklyHours !== "object") throw new ServiceAvailabilityCommandError("INVALID_PAYLOAD", "weeklyHours inválido.");
      const result = await upsertServiceResourceScheduleCommand(db_(), uid, resourceId, { timezone, slotStepMinutes, minAdvanceMinutes, maxAdvanceDays, weeklyHours }, idempotencyKey);
      logInfo("service_availability.schedule_upserted", { requestId: req.requestId, resourceId, idempotent: result.idempotentReplay });
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceAvailabilityCommandError) {
        logWarn("service_availability.schedule_upsert_rejected", { requestId: req.requestId, code: error.code });
        sendAvailabilityCommandError(res, statusForAvailabilityError(error.code), error.code);
        return;
      }
      if (error instanceof ServiceAvailabilityDomainError) {
        sendAvailabilityCommandError(res, 400, "INVALID_PAYLOAD");
        return;
      }
      logError("service_availability.schedule_upsert_failed", error, { requestId: req.requestId });
      res.status(500).json({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível salvar a agenda agora." });
    }
  });

  app.post("/api/services/availability/blocks", requireAuth, async (req, res) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!uid) { sendAvailabilityCommandError(res, 401, "UNAUTHENTICATED"); return; }
    try {
      const resourceId = validateRouteEntityId(req.body?.resourceId, "resourceId");
      const startAt = validateTimestampInput(req.body?.startAt, "startAt");
      const endAt = validateTimestampInput(req.body?.endAt, "endAt");
      const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
      const idempotencyKey = validateIdempotencyKey(req.body?.idempotencyKey);
      const result = await createServiceAvailabilityBlockCommand(db_(), uid, resourceId, startAt, endAt, reason, idempotencyKey);
      logInfo("service_availability.block_created", { requestId: req.requestId, blockId: result.blockId, idempotent: result.idempotentReplay });
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceAvailabilityCommandError) {
        logWarn("service_availability.block_create_rejected", { requestId: req.requestId, code: error.code });
        sendAvailabilityCommandError(res, statusForAvailabilityError(error.code), error.code);
        return;
      }
      if (error instanceof ServiceAvailabilityDomainError) {
        sendAvailabilityCommandError(res, 400, "INVALID_PAYLOAD");
        return;
      }
      logError("service_availability.block_create_failed", error, { requestId: req.requestId });
      res.status(500).json({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível criar o bloqueio agora." });
    }
  });

  app.post("/api/services/availability/blocks/:blockId/delete", requireAuth, async (req, res) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!uid) { sendAvailabilityCommandError(res, 401, "UNAUTHENTICATED"); return; }
    try {
      const blockId = validateRouteEntityId(req.params.blockId, "blockId");
      const idempotencyKey = validateIdempotencyKey(req.body?.idempotencyKey);
      const result = await deleteServiceAvailabilityBlockCommand(db_(), uid, blockId, idempotencyKey);
      logInfo("service_availability.block_deleted", { requestId: req.requestId, blockId, idempotent: result.idempotentReplay });
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceAvailabilityCommandError) {
        logWarn("service_availability.block_delete_rejected", { requestId: req.requestId, code: error.code });
        sendAvailabilityCommandError(res, statusForAvailabilityError(error.code), error.code);
        return;
      }
      logError("service_availability.block_delete_failed", error, { requestId: req.requestId });
      res.status(500).json({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível remover o bloqueio agora." });
    }
  });

  app.get("/api/services/availability", requireAuth, async (req, res) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!uid) { sendAvailabilityCommandError(res, 401, "UNAUTHENTICATED"); return; }
    try {
      const serviceId = validateRouteEntityId(req.query.serviceId, "serviceId");
      const resourceId = validateRouteEntityId(req.query.resourceId, "resourceId");
      const rangeStartAt = typeof req.query.rangeStartAt === "string" ? req.query.rangeStartAt : "";
      const rangeEndAt = typeof req.query.rangeEndAt === "string" ? req.query.rangeEndAt : "";
      const result = await getServiceAvailabilityCommand(db_(), uid, serviceId, resourceId, rangeStartAt, rangeEndAt);
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceAvailabilityCommandError) {
        sendAvailabilityCommandError(res, statusForAvailabilityError(error.code), error.code);
        return;
      }
      logError("service_availability.query_failed", error, { requestId: req.requestId });
      res.status(500).json({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível consultar a disponibilidade agora." });
    }
  });
}
