/**
 * SERV-AVAIL-01 — camada de disponibilidade da Agenda V1: expediente semanal por resource e bloqueios
 * extraordinários (ServiceAvailabilityBlock). Fronteira própria (não em shared/services.ts nem em
 * shared/service-bookings.ts) pelo mesmo motivo dessas duas: "expediente"/"bloqueio" não são conceitos do
 * domínio comercial nem do motor transacional de locks — eles só alimentam esse motor como um
 * pré-requisito adicional (ver server/service-availability-commands.ts, chamado a partir de
 * server/service-booking-commands.ts em createHold/confirm/reschedule).
 *
 * IMPORTANTE — timezone: este módulo é `shared/`, importado pelo client (persistence/validators), e por
 * isso NUNCA importa uma lib de conversão de timezone (date-fns-tz fica só em server/, nunca no boot do
 * client — ver server/service-availability-commands.ts). Tudo aqui é aritmética pura sobre "minuto do dia
 * local" (0-1439) e nome do dia da semana; a conversão UTC<->local acontece uma única vez, no servidor,
 * ANTES de chamar estas funções.
 */
import {
  assertEntityId,
  assertIsoUtcString,
  assertUid,
  type EntityId,
  type IsoUtcString,
  type Uid,
} from "./services";

export type DayOfWeek = "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday";

/** Ordem alinhada a Date.prototype.getUTCDay() (0=domingo) — o servidor usa esse índice diretamente depois
 * de converter um instante para o "relógio de parede" local da agenda (ver server/). */
export const DAYS_OF_WEEK: readonly DayOfWeek[] = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
];

export type DailyPeriod = {
  /** "HH:MM", 24h, horário de parede local da agenda — nunca UTC. */
  readonly start: string;
  readonly end: string;
};

export type WeeklyHours = Readonly<Record<DayOfWeek, readonly DailyPeriod[]>>;

/** §10 — passo de exibição/aceitação pública. Nunca confundir com SCHEDULE_LOCK_GRANULARITY_MINUTES (5
 * min, em shared/service-bookings.ts) — aquele é a granularidade REAL de concorrência; este é só quais
 * horários de início são candidatos/aceitos. */
export const AVAILABILITY_SLOT_STEP_MINUTES_OPTIONS = [15, 30] as const;
export type AvailabilitySlotStepMinutes = (typeof AVAILABILITY_SLOT_STEP_MINUTES_OPTIONS)[number];

/** §40/§41 — limite de segurança/performance por chamada de consulta de disponibilidade; nunca gerar
 * candidatos para um horizonte maior que este, mesmo que o client peça. */
export const MAX_AVAILABILITY_QUERY_RANGE_DAYS = 31;

export type ServiceResourceSchedule = {
  /** === resourceId (1 resource : 1 agenda em V1) — torna a leitura determinística, sem query. */
  readonly id: EntityId;
  readonly tenantUid: Uid;
  readonly resourceId: EntityId;
  /** IANA, ex. "America/Sao_Paulo" — nunca offset fixo, nunca implícito do servidor/device (§5). */
  readonly timezone: string;
  readonly slotStepMinutes: AvailabilitySlotStepMinutes;
  /** §12 — 0 quando ausente na criação (ver server, nunca omitido no documento persistido). */
  readonly minAdvanceMinutes: number;
  /** §13 — ausente = sem limite de janela específico em V1 (documentado; ver
   * server/service-availability-commands.ts `assertIntervalAllowedByScheduleCommand`). A consulta pública
   * de disponibilidade (§14/§40) permanece limitada a MAX_AVAILABILITY_QUERY_RANGE_DAYS independentemente
   * disto, por ser uma proteção de performance/DoS, não uma regra de negócio da agenda. */
  readonly maxAdvanceDays?: number;
  readonly weeklyHours: WeeklyHours;
  readonly createdAt: IsoUtcString;
  readonly updatedAt: IsoUtcString;
};

export type ServiceAvailabilityBlock = {
  readonly id: EntityId;
  readonly tenantUid: Uid;
  readonly resourceId: EntityId;
  /** [startAt, endAt) — mesma semântica de intervalo do resto do domínio de agenda (§9). */
  readonly startAt: IsoUtcString;
  readonly endAt: IsoUtcString;
  readonly reason?: string;
  readonly createdAt: IsoUtcString;
};

export type ServiceAvailabilityDomainErrorCode =
  | "INVALID_TIMEZONE"
  | "INVALID_SLOT_STEP"
  | "INVALID_ADVANCE_WINDOW"
  | "INVALID_DAILY_PERIOD"
  | "OVERLAPPING_DAILY_PERIODS"
  | "INVALID_WEEKLY_HOURS"
  | "INVALID_RESOURCE_SCHEDULE"
  | "INVALID_AVAILABILITY_BLOCK"
  | "INVALID_AVAILABILITY_RANGE";

export class ServiceAvailabilityDomainError extends Error {
  readonly code: ServiceAvailabilityDomainErrorCode;

  constructor(code: ServiceAvailabilityDomainErrorCode, message: string) {
    super(message);
    this.name = "ServiceAvailabilityDomainError";
    this.code = code;
  }
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "08:00" -> 480. Único parser de horário local do domínio — nunca duplicado. */
export function parseTimeToMinutes(value: string, fieldName = "time"): number {
  const match = TIME_PATTERN.exec(value);
  if (!match) {
    throw new ServiceAvailabilityDomainError("INVALID_DAILY_PERIOD", `${fieldName} must be a "HH:MM" 24h string.`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

export function assertValidDailyPeriod(period: DailyPeriod, fieldName = "period"): DailyPeriod {
  const startMinute = parseTimeToMinutes(period.start, `${fieldName}.start`);
  const endMinute = parseTimeToMinutes(period.end, `${fieldName}.end`);
  if (endMinute <= startMinute) {
    throw new ServiceAvailabilityDomainError("INVALID_DAILY_PERIOD", `${fieldName}.end must be strictly after ${fieldName}.start.`);
  }
  return period;
}

/** §6 — exemplo inválido do ticket: 08:00-12:00 + 11:00-14:00 no mesmo dia deve ser rejeitado. */
export function assertNoOverlappingPeriods(periods: readonly DailyPeriod[], fieldName = "periods"): readonly DailyPeriod[] {
  const sorted = periods
    .map((period) => ({ period, start: parseTimeToMinutes(period.start), end: parseTimeToMinutes(period.end) }))
    .sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].start < sorted[i - 1].end) {
      throw new ServiceAvailabilityDomainError("OVERLAPPING_DAILY_PERIODS", `${fieldName} contains overlapping periods.`);
    }
  }
  return periods;
}

export function assertValidWeeklyHours(weeklyHours: WeeklyHours): WeeklyHours {
  for (const day of DAYS_OF_WEEK) {
    const periods = weeklyHours[day];
    if (!Array.isArray(periods)) {
      throw new ServiceAvailabilityDomainError("INVALID_WEEKLY_HOURS", `weeklyHours.${day} must be an array (empty means closed).`);
    }
    if (periods.length > 12) {
      throw new ServiceAvailabilityDomainError("INVALID_WEEKLY_HOURS", `weeklyHours.${day} has too many periods.`);
    }
    for (const period of periods) assertValidDailyPeriod(period, `weeklyHours.${day}`);
    assertNoOverlappingPeriods(periods, `weeklyHours.${day}`);
  }
  return weeklyHours;
}

/** §11 — [start, start+duration) precisa caber INTEIRAMENTE dentro de um único período do dia; nunca
 * ultrapassar o fim do período (ex.: expediente termina 12:00, serviço de 45min não pode começar 11:30). */
export function isIntervalWithinPeriods(startMinute: number, durationMinutes: number, periods: readonly DailyPeriod[]): boolean {
  const endMinute = startMinute + durationMinutes;
  return periods.some((period) => {
    const periodStart = parseTimeToMinutes(period.start);
    const periodEnd = parseTimeToMinutes(period.end);
    return startMinute >= periodStart && endMinute <= periodEnd;
  });
}

/** §10/§11/B1-B4 — candidatos de início alinhados ao slotStep que cabem inteiramente em algum período do
 * dia; usado pela consulta de disponibilidade (§14), nunca pela validação de um horário já escolhido
 * (essa usa isIntervalWithinPeriods diretamente, ver server/service-availability-commands.ts). */
export function generateCandidateStartMinutes(
  periods: readonly DailyPeriod[],
  slotStepMinutes: number,
  durationMinutes: number,
): number[] {
  const candidates: number[] = [];
  for (const period of periods) {
    const periodStart = parseTimeToMinutes(period.start);
    const periodEnd = parseTimeToMinutes(period.end);
    for (let cursor = periodStart; cursor + durationMinutes <= periodEnd; cursor += slotStepMinutes) {
      candidates.push(cursor);
    }
  }
  return candidates;
}

export function assertValidTimezone(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 80) {
    throw new ServiceAvailabilityDomainError("INVALID_TIMEZONE", "timezone must be a non-empty IANA identifier.");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
  } catch {
    throw new ServiceAvailabilityDomainError("INVALID_TIMEZONE", `"${value}" is not a recognized IANA timezone.`);
  }
  return value;
}

export function assertValidSlotStepMinutes(value: number): AvailabilitySlotStepMinutes {
  if (!(AVAILABILITY_SLOT_STEP_MINUTES_OPTIONS as readonly number[]).includes(value)) {
    throw new ServiceAvailabilityDomainError("INVALID_SLOT_STEP", "slotStepMinutes must be 15 or 30.");
  }
  return value as AvailabilitySlotStepMinutes;
}

export function assertValidAdvanceWindow(minAdvanceMinutes: number, maxAdvanceDays: number | undefined): void {
  if (!Number.isFinite(minAdvanceMinutes) || !Number.isInteger(minAdvanceMinutes) || minAdvanceMinutes < 0) {
    throw new ServiceAvailabilityDomainError("INVALID_ADVANCE_WINDOW", "minAdvanceMinutes must be a non-negative integer.");
  }
  if (typeof maxAdvanceDays !== "undefined") {
    if (!Number.isFinite(maxAdvanceDays) || !Number.isInteger(maxAdvanceDays) || maxAdvanceDays <= 0) {
      throw new ServiceAvailabilityDomainError("INVALID_ADVANCE_WINDOW", "maxAdvanceDays must be a positive integer when present.");
    }
  }
}

export function assertValidServiceResourceSchedule(schedule: ServiceResourceSchedule): ServiceResourceSchedule {
  assertEntityId(schedule.id, "schedule.id");
  assertUid(schedule.tenantUid, "schedule.tenantUid");
  assertEntityId(schedule.resourceId, "schedule.resourceId");
  if (schedule.id !== schedule.resourceId) {
    throw new ServiceAvailabilityDomainError("INVALID_RESOURCE_SCHEDULE", "schedule.id must equal schedule.resourceId (1 resource : 1 schedule in V1).");
  }
  assertValidTimezone(schedule.timezone);
  assertValidSlotStepMinutes(schedule.slotStepMinutes);
  assertValidAdvanceWindow(schedule.minAdvanceMinutes, schedule.maxAdvanceDays);
  assertValidWeeklyHours(schedule.weeklyHours);
  assertIsoUtcString(schedule.createdAt, "schedule.createdAt");
  assertIsoUtcString(schedule.updatedAt, "schedule.updatedAt");
  return schedule;
}

function assertValidUtcInterval(startAt: string, endAt: string, fieldPrefix: string): { startAt: IsoUtcString; endAt: IsoUtcString } {
  const validStart = assertIsoUtcString(startAt, `${fieldPrefix}.startAt`);
  const validEnd = assertIsoUtcString(endAt, `${fieldPrefix}.endAt`);
  if (Date.parse(validEnd) <= Date.parse(validStart)) {
    throw new ServiceAvailabilityDomainError("INVALID_AVAILABILITY_BLOCK", `${fieldPrefix}.endAt must be strictly after ${fieldPrefix}.startAt.`);
  }
  return { startAt: validStart, endAt: validEnd };
}

export function assertValidAvailabilityBlock(block: ServiceAvailabilityBlock): ServiceAvailabilityBlock {
  assertEntityId(block.id, "block.id");
  assertUid(block.tenantUid, "block.tenantUid");
  assertEntityId(block.resourceId, "block.resourceId");
  assertValidUtcInterval(block.startAt, block.endAt, "block");
  if (typeof block.reason !== "undefined" && (typeof block.reason !== "string" || block.reason.length > 280)) {
    throw new ServiceAvailabilityDomainError("INVALID_AVAILABILITY_BLOCK", "block.reason must be a string up to 280 characters.");
  }
  assertIsoUtcString(block.createdAt, "block.createdAt");
  return block;
}

/** §9 — overlap de dois intervalos [start,end), mesma semântica usada no resto do domínio de agenda. */
export function intervalsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return Date.parse(aStart) < Date.parse(bEnd) && Date.parse(bStart) < Date.parse(aEnd);
}

/** §40/§41 — valida o range de uma consulta de disponibilidade: start<end e no máximo
 * MAX_AVAILABILITY_QUERY_RANGE_DAYS, para nunca gerar um horizonte arbitrariamente grande de candidatos. */
export function assertValidAvailabilityQueryRange(rangeStartAt: string, rangeEndAt: string): { rangeStartAt: IsoUtcString; rangeEndAt: IsoUtcString } {
  const validStart = assertIsoUtcString(rangeStartAt, "rangeStartAt");
  const validEnd = assertIsoUtcString(rangeEndAt, "rangeEndAt");
  if (Date.parse(validEnd) <= Date.parse(validStart)) {
    throw new ServiceAvailabilityDomainError("INVALID_AVAILABILITY_RANGE", "rangeEndAt must be strictly after rangeStartAt.");
  }
  const rangeDays = (Date.parse(validEnd) - Date.parse(validStart)) / 86_400_000;
  if (rangeDays > MAX_AVAILABILITY_QUERY_RANGE_DAYS) {
    throw new ServiceAvailabilityDomainError("INVALID_AVAILABILITY_RANGE", `Query range cannot exceed ${MAX_AVAILABILITY_QUERY_RANGE_DAYS} days.`);
  }
  return { rangeStartAt: validStart, rangeEndAt: validEnd };
}
