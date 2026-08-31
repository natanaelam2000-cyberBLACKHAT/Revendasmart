/**
 * SERV-BOOK-01 — núcleo transacional da Agenda V1: BookingHold (reserva temporária), Booking (confirmado)
 * e ScheduleLock (autoridade de concorrência por segmento). Fronteira própria (não espalhado em
 * shared/services.ts) porque os conceitos de intervalo/segmento/expiração não pertencem ao domínio
 * comercial de Service/ServiceWork — só o consomem no momento da confirmação (criação de ServiceWork).
 *
 * Analogia funcional: horário funciona como poltrona de cinema (quem reservar primeiro fica com aquele
 * intervalo), mas a autoridade é sempre o servidor — nunca o cliente decide concorrência, expiração ou
 * ownership de um segmento.
 */
import {
  assertEntityId,
  assertIsoUtcString,
  assertUid,
  type EntityId,
  type IsoUtcString,
  type Service,
  type Uid,
} from "./services";

/** Granularidade real de concorrência — nunca exposta como "step" de agendamento público. */
export const SCHEDULE_LOCK_GRANULARITY_MINUTES = 5;
/** Tempo que um Hold garante o intervalo antes de poder ser reaproveitado por outro cliente. */
export const BOOKING_HOLD_TTL_MINUTES = 5;
/** Passo de exibição pública — múltiplo da granularidade interna, nunca a mesma coisa (§21). */
export const PUBLIC_SLOT_STEP_MINUTES_OPTIONS = [15, 30] as const;

export type ServiceBookingsDomainErrorCode =
  | "INVALID_BOOKING_INTERVAL"
  | "UNALIGNED_BOOKING_INTERVAL"
  | "SERVICE_NOT_BOOKABLE"
  | "INVALID_BOOKING_HOLD"
  | "INVALID_BOOKING"
  | "INVALID_SCHEDULE_LOCK";

export class ServiceBookingsDomainError extends Error {
  readonly code: ServiceBookingsDomainErrorCode;

  constructor(code: ServiceBookingsDomainErrorCode, message: string) {
    super(message);
    this.name = "ServiceBookingsDomainError";
    this.code = code;
  }
}

/**
 * §5 — status mínimo suficiente: nunca persistimos "expired". Expiração é sempre DERIVADA comparando
 * `expiresAt` com o relógio do servidor no momento da leitura (§10) — nunca um terceiro status gravado.
 * SERV-BOOK-02 adiciona "released" (liberação voluntária, §5-7) — um estado terminal irmão de
 * "confirmed", nunca alcançável a partir dele (§7: hold confirmado nunca é released).
 */
export type BookingHoldStatus = "active" | "confirmed" | "released";

export type BookingHold = {
  readonly id: EntityId;
  readonly tenantUid: Uid;
  readonly serviceId: EntityId;
  readonly resourceId: EntityId;
  readonly customerId?: EntityId;
  readonly startAt: IsoUtcString;
  readonly endAt: IsoUtcString;
  readonly status: BookingHoldStatus;
  readonly expiresAt: IsoUtcString;
  readonly createdAt: IsoUtcString;
  readonly idempotencyKey: string;
  /** Preenchidos atomicamente só na confirmação — permitem que uma segunda tentativa de confirmar (com
   * key diferente da idempotency original) devolva o MESMO Booking/Work em vez de duplicar (§16/§26). */
  readonly confirmedBookingId?: EntityId;
  readonly confirmedWorkId?: EntityId;
  /** Preenchido atomicamente só na liberação (SERV-BOOK-02 §5). */
  readonly releasedAt?: IsoUtcString;
};

/** SERV-BOOK-02 §8-12 adiciona "cancelled" — nunca deletado (§27), só muda de status, como ServiceWork. */
export type BookingStatus = "confirmed" | "cancelled";
/** SERV-PUBLIC-01 — "public" adicionado exatamente como este comentário sempre previu: um Booking criado
 * pelo fluxo público de agendamento (cliente sem conta, via /agendar/:storeSlug) em vez de pelo dono da
 * loja. Nenhuma outra regra do domínio distingue por source — é só proveniência, para auditoria/UI. */
export type BookingSource = "manual" | "public";

export type Booking = {
  readonly id: EntityId;
  readonly tenantUid: Uid;
  readonly serviceId: EntityId;
  readonly resourceId: EntityId;
  readonly customerId?: EntityId;
  readonly workId: EntityId;
  readonly startAt: IsoUtcString;
  readonly endAt: IsoUtcString;
  readonly status: BookingStatus;
  readonly source: BookingSource;
  readonly createdAt: IsoUtcString;
  /** SERV-BOOK-02 — Booking nasceu (SERV-BOOK-01) só com createdAt; reagendar/cancelar são mutações reais
   * do fato operacional, então passam a exigir updatedAt, mesmo padrão de Service/ServiceWork/Quote.
   * `updatedAt === createdAt` no momento da criação (mesmo padrão já usado em ServiceWork/Quote). */
  readonly updatedAt: IsoUtcString;
  /** Preenchido atomicamente só no cancelamento (SERV-BOOK-02 §8-12), nunca noutro momento. */
  readonly cancelledAt?: IsoUtcString;
  /** SERV-PUBLIC-02 — sha256 hex (64 chars) do token opaco de gerenciamento público entregue ao cliente só
   * na confirmação (nunca persistido em plaintext, ver server/service-public-booking.ts). Só existe para
   * Bookings source="public"; Bookings internos/legados nunca têm este campo, o que já os torna não-
   * gerenciáveis publicamente (§34 — nenhuma migração retroativa). Server-authoritative: o client nunca
   * pode escrevê-lo (Bookings já são 100% create/update/delete:false nas Rules). */
  readonly publicManageTokenHash?: string;
};

export type ScheduleLockOwnerType = "hold" | "booking";

export type ScheduleLock = {
  readonly tenantUid: Uid;
  readonly resourceId: EntityId;
  readonly segmentStartAt: IsoUtcString;
  readonly ownerType: ScheduleLockOwnerType;
  readonly ownerId: EntityId;
  /** Só existe para ownerType "hold" — um lock de booking confirmado nunca expira (§9). */
  readonly expiresAt?: IsoUtcString;
};

/**
 * §8 — [startAt, endAt), startAt < endAt obrigatório. Nunca confia em endAt vindo do cliente para
 * createHold (o servidor deriva de Service.durationMinutes — ver server/service-booking-commands.ts);
 * esta função valida o par depois de já resolvido, e é reutilizada pela leitura de um Hold existente.
 */
export function assertValidBookingInterval(startAt: string, endAt: string): { startAt: IsoUtcString; endAt: IsoUtcString } {
  const validStart = assertIsoUtcString(startAt, "startAt");
  const validEnd = assertIsoUtcString(endAt, "endAt");
  if (Date.parse(validEnd) <= Date.parse(validStart)) {
    throw new ServiceBookingsDomainError("INVALID_BOOKING_INTERVAL", "endAt must be strictly after startAt.");
  }
  return { startAt: validStart, endAt: validEnd };
}

/** true se o instante (ms epoch) cai exatamente num múltiplo da granularidade de lock de 5 minutos. */
export function isAlignedToLockGrid(epochMs: number): boolean {
  return epochMs % (SCHEDULE_LOCK_GRANULARITY_MINUTES * 60_000) === 0;
}

/**
 * §9 — converte [startAt, endAt) nos segmentos de 5 minutos que ocupa, deterministicamente. Exemplo do
 * ticket: 10:00–10:30 => exatamente 6 segmentos (10:00, 10:05, ..., 10:25); 10:30 nunca é ocupado (fica
 * livre para o próximo intervalo adjacente, §8/§13 boundary). Exige que startAt/endAt já estejam
 * alinhados à grade de 5 minutos — chamado depois de `assertValidBookingInterval`.
 */
export function computeScheduleSegments(startAt: string, endAt: string): IsoUtcString[] {
  const startMs = Date.parse(startAt);
  const endMs = Date.parse(endAt);
  if (!isAlignedToLockGrid(startMs) || !isAlignedToLockGrid(endMs)) {
    throw new ServiceBookingsDomainError(
      "UNALIGNED_BOOKING_INTERVAL",
      `startAt/endAt must align to the ${SCHEDULE_LOCK_GRANULARITY_MINUTES}-minute lock grid.`,
    );
  }
  const stepMs = SCHEDULE_LOCK_GRANULARITY_MINUTES * 60_000;
  const segments: string[] = [];
  for (let cursor = startMs; cursor < endMs; cursor += stepMs) {
    segments.push(new Date(cursor).toISOString());
  }
  return segments;
}

/** §10 — nunca usar deleção física do Firestore como autoridade: um lock/hold cujo expiresAt já passou o
 * relógio do servidor está logicamente expirado e pode ser reaproveitado imediatamente por uma transaction
 * válida, mesmo que o documento antigo ainda exista fisicamente. */
export function isExpired(expiresAt: IsoUtcString, serverNowIso: IsoUtcString): boolean {
  return Date.parse(expiresAt) <= Date.parse(serverNowIso);
}

/** §9/F — decide se um lock de segmento bloqueia uma nova tentativa de hold. */
export function isSegmentAvailableForHold(
  lock: Pick<ScheduleLock, "ownerType" | "expiresAt"> | undefined,
  serverNowIso: IsoUtcString,
): boolean {
  if (!lock) return true;
  if (lock.ownerType === "booking") return false;
  return typeof lock.expiresAt === "string" && isExpired(lock.expiresAt, serverNowIso);
}

export function assertValidBookingHold(hold: BookingHold): BookingHold {
  assertEntityId(hold.id, "bookingHold.id");
  assertUid(hold.tenantUid, "bookingHold.tenantUid");
  assertEntityId(hold.serviceId, "bookingHold.serviceId");
  assertEntityId(hold.resourceId, "bookingHold.resourceId");
  if (typeof hold.customerId !== "undefined") assertEntityId(hold.customerId, "bookingHold.customerId");
  assertValidBookingInterval(hold.startAt, hold.endAt);
  if (hold.status !== "active" && hold.status !== "confirmed" && hold.status !== "released") {
    throw new ServiceBookingsDomainError("INVALID_BOOKING_HOLD", "bookingHold.status is invalid.");
  }
  assertIsoUtcString(hold.expiresAt, "bookingHold.expiresAt");
  assertIsoUtcString(hold.createdAt, "bookingHold.createdAt");
  if (typeof hold.idempotencyKey !== "string" || !/^[a-zA-Z0-9_-]{6,120}$/.test(hold.idempotencyKey)) {
    throw new ServiceBookingsDomainError("INVALID_BOOKING_HOLD", "bookingHold.idempotencyKey is invalid.");
  }
  if (typeof hold.confirmedBookingId !== "undefined") assertEntityId(hold.confirmedBookingId, "bookingHold.confirmedBookingId");
  if (typeof hold.confirmedWorkId !== "undefined") assertEntityId(hold.confirmedWorkId, "bookingHold.confirmedWorkId");
  if (typeof hold.releasedAt !== "undefined") assertIsoUtcString(hold.releasedAt, "bookingHold.releasedAt");
  if (hold.status === "confirmed" && (!hold.confirmedBookingId || !hold.confirmedWorkId)) {
    throw new ServiceBookingsDomainError("INVALID_BOOKING_HOLD", "confirmed bookingHold must contain confirmedBookingId/confirmedWorkId.");
  }
  if (hold.status === "confirmed" && typeof hold.releasedAt !== "undefined") {
    throw new ServiceBookingsDomainError("INVALID_BOOKING_HOLD", "confirmed bookingHold cannot contain releasedAt — a confirmed hold is never released (§7).");
  }
  if (hold.status === "released" && typeof hold.releasedAt === "undefined") {
    throw new ServiceBookingsDomainError("INVALID_BOOKING_HOLD", "released bookingHold must contain releasedAt.");
  }
  if (hold.status === "released" && (hold.confirmedBookingId || hold.confirmedWorkId)) {
    throw new ServiceBookingsDomainError("INVALID_BOOKING_HOLD", "released bookingHold cannot contain confirmedBookingId/confirmedWorkId.");
  }
  if (hold.status === "active" && (hold.confirmedBookingId || hold.confirmedWorkId || typeof hold.releasedAt !== "undefined")) {
    throw new ServiceBookingsDomainError("INVALID_BOOKING_HOLD", "active bookingHold cannot contain confirmedBookingId/confirmedWorkId/releasedAt.");
  }
  return hold;
}

export function assertValidBooking(booking: Booking): Booking {
  assertEntityId(booking.id, "booking.id");
  assertUid(booking.tenantUid, "booking.tenantUid");
  assertEntityId(booking.serviceId, "booking.serviceId");
  assertEntityId(booking.resourceId, "booking.resourceId");
  if (typeof booking.customerId !== "undefined") assertEntityId(booking.customerId, "booking.customerId");
  assertEntityId(booking.workId, "booking.workId");
  assertValidBookingInterval(booking.startAt, booking.endAt);
  if (booking.status !== "confirmed" && booking.status !== "cancelled") {
    throw new ServiceBookingsDomainError("INVALID_BOOKING", "booking.status is invalid.");
  }
  if (booking.source !== "manual" && booking.source !== "public") {
    throw new ServiceBookingsDomainError("INVALID_BOOKING", "booking.source is invalid.");
  }
  assertIsoUtcString(booking.createdAt, "booking.createdAt");
  assertIsoUtcString(booking.updatedAt, "booking.updatedAt");
  if (typeof booking.cancelledAt !== "undefined") assertIsoUtcString(booking.cancelledAt, "booking.cancelledAt");
  if (booking.status === "cancelled" && typeof booking.cancelledAt === "undefined") {
    throw new ServiceBookingsDomainError("INVALID_BOOKING", "cancelled booking must contain cancelledAt.");
  }
  if (booking.status === "confirmed" && typeof booking.cancelledAt !== "undefined") {
    throw new ServiceBookingsDomainError("INVALID_BOOKING", "confirmed booking cannot contain cancelledAt.");
  }
  if (typeof booking.publicManageTokenHash !== "undefined" && !/^[a-f0-9]{64}$/.test(booking.publicManageTokenHash)) {
    throw new ServiceBookingsDomainError("INVALID_BOOKING", "booking.publicManageTokenHash must be a sha256 hex digest.");
  }
  return booking;
}

/**
 * SERV-BOOK-02 §16 — classifica os segmentos de um reagendamento em 3 grupos: `sharedSegments` (já
 * pertencem ao próprio Booking e continuam pertencendo — NUNCA tratados como conflito), `releasedSegments`
 * (pertenciam ao intervalo antigo e deixaram de ser necessários) e `acquiredSegments` (precisam ser
 * validados/adquiridos porque são novos). Exemplo do ticket: 10:00–10:30 -> 10:15–10:45 => shared =
 * [10:15,10:20,10:25], released = [10:00,10:05,10:10], acquired = [10:30,10:35,10:40].
 */
export type ScheduleSegmentDiff = {
  readonly sharedSegments: readonly IsoUtcString[];
  readonly releasedSegments: readonly IsoUtcString[];
  readonly acquiredSegments: readonly IsoUtcString[];
};

export function diffScheduleSegments(oldSegments: readonly string[], newSegments: readonly string[]): ScheduleSegmentDiff {
  const oldSet = new Set(oldSegments);
  const newSet = new Set(newSegments);
  return {
    sharedSegments: newSegments.filter((segment) => oldSet.has(segment)),
    releasedSegments: oldSegments.filter((segment) => !newSet.has(segment)),
    acquiredSegments: newSegments.filter((segment) => !oldSet.has(segment)),
  };
}

/**
 * SERV-AVAIL-01 — movida de server/service-booking-commands.ts (era uma função privada só usada ali) para
 * cá, exportada, porque agora TAMBÉM é consumida por server/service-availability-commands.ts (§14 —
 * getServiceAvailability precisa da mesma duração real do Service usada por createHold, nunca uma segunda
 * definição paralela). Fica em shared/service-bookings.ts — não em shared/services.ts — porque o conceito
 * "reservável" (bookingMode/duração múltipla de 5 min/preço fixo) é específico do domínio de agenda, não do
 * domínio comercial genérico. Nunca aceitar endAt/duração vindos do cliente (§8/§11) — o servidor sempre
 * deriva a partir daqui.
 */
export function resolveBookableServiceDuration(service: Service): number {
  if (service.bookingMode === "none") {
    throw new ServiceBookingsDomainError("SERVICE_NOT_BOOKABLE", "Este serviço não aceita reservas (bookingMode=none).");
  }
  if (typeof service.durationMinutes !== "number" || !Number.isInteger(service.durationMinutes) || service.durationMinutes <= 0) {
    throw new ServiceBookingsDomainError("SERVICE_NOT_BOOKABLE", "Este serviço não possui duração configurada.");
  }
  if (service.durationMinutes % SCHEDULE_LOCK_GRANULARITY_MINUTES !== 0) {
    throw new ServiceBookingsDomainError("SERVICE_NOT_BOOKABLE", "A duração do serviço precisa ser múltipla de 5 minutos.");
  }
  if (service.pricing.mode !== "fixed") {
    throw new ServiceBookingsDomainError("SERVICE_NOT_BOOKABLE", "Este serviço não possui preço fixo configurado para reserva.");
  }
  return service.durationMinutes;
}

export function assertValidScheduleLock(lock: ScheduleLock): ScheduleLock {
  assertUid(lock.tenantUid, "scheduleLock.tenantUid");
  assertEntityId(lock.resourceId, "scheduleLock.resourceId");
  assertIsoUtcString(lock.segmentStartAt, "scheduleLock.segmentStartAt");
  if (lock.ownerType !== "hold" && lock.ownerType !== "booking") {
    throw new ServiceBookingsDomainError("INVALID_SCHEDULE_LOCK", "scheduleLock.ownerType is invalid.");
  }
  assertEntityId(lock.ownerId, "scheduleLock.ownerId");
  if (typeof lock.expiresAt !== "undefined") {
    assertIsoUtcString(lock.expiresAt, "scheduleLock.expiresAt");
  }
  if (lock.ownerType === "booking" && typeof lock.expiresAt !== "undefined") {
    throw new ServiceBookingsDomainError("INVALID_SCHEDULE_LOCK", "a booking-owned scheduleLock cannot carry expiresAt.");
  }
  return lock;
}
