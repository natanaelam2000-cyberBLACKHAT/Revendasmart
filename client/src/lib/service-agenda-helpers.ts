/**
 * SERV-UI-01 — helpers puros para a Agenda operacional: conversão de "dia local + timezone do resource"
 * para o range UTC correspondente, formatação de horário no timezone do resource, e derivação visual do
 * status de cada segmento (AVAILABLE/BOOKED/BLOCKED) a partir de dados já buscados (weeklyHours, Bookings
 * confirmados, AvailabilityBlocks).
 *
 * IMPORTANTE — timezone: nunca usa date-fns-tz aqui (isso é server-only, ver server/service-availability-
 * commands.ts) nem qualquer outra lib de timezone — só `Intl.DateTimeFormat`, já nativa do runtime, exatamente
 * a mesma técnica (dois formatToParts) já usada e comprovada corretamente no servidor, reimplementada sem
 * dependência para nunca entrar no bundle do client (script/performance/check-bundle-budgets.mjs proíbe
 * explicitamente um chunk vendor-date-fns no client).
 *
 * §20 — o horário exibido (bookings/slots) sempre respeita o timezone do resource, nunca o do navegador; o
 * timezone do navegador só é usado como fallback quando NENHUM ServiceResourceSchedule existe ainda (nada
 * configurado = nada para respeitar), nunca quando um schedule real está presente.
 */
import type { Booking } from "@shared/service-bookings";
import type { DailyPeriod, DayOfWeek, ServiceAvailabilityBlock, WeeklyHours } from "@shared/service-availability";

/** Só os TIPOS de shared/service-availability.ts são importados aqui (apagados em compile-time, custo
 * zero de bundle) — nunca as funções/classe de validação (assertValidDailyPeriod/assertNoOverlappingPeriods/
 * ServiceAvailabilityDomainError), que tornariam aquele módulo alcançável pela primeira vez no client (ele
 * hoje só é usado por server/service-availability-commands.ts e pelas duas funções puras de shape usadas em
 * service-availability-persistence.ts). "HH:MM" com zero à esquerda é diretamente comparável como string —
 * `validateWeeklyDraft` abaixo reimplica a MESMA regra (start<end, sem overlap) com aritmética local
 * equivalente, documentada como exceção deliberada só por causa do orçamento de bundle (§0/§26 SERV-UI-02),
 * nunca uma segunda definição de negócio divergente — o servidor continua validando as mesmas regras de
 * verdade em todo upsertServiceResourceSchedule. */

export type AgendaSegmentStatus = "available" | "booked" | "blocked";

export type AgendaSegment = {
  readonly startAt: string;
  readonly endAt: string;
  readonly status: AgendaSegmentStatus;
  readonly booking?: Booking;
  readonly block?: ServiceAvailabilityBlock;
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** "YYYY-MM-DD" + minuto do dia + timezone IANA -> instante UTC real (respeitando DST). Mesma técnica de
 * dois formatToParts já usada no servidor (SERV-AVAIL-01), sem nenhuma dependência de timezone. */
export function zonedWallClockToUtcInstant(dateKey: string, minuteOfDay: number, timeZone: string): Date {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  const [year, month, day] = dateKey.split("-").map(Number);
  // Primeiro palpite: trata o horário de parede como se já fosse UTC.
  const guess = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0, 0));
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(guess).map((part) => [part.type, part.value])) as Record<string, string>;
  const guessedAsUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  const offsetMs = guess.getTime() - guessedAsUtc;
  return new Date(guess.getTime() + offsetMs);
}

/** Range [início do dia, início do dia seguinte) no timezone do resource, como instantes UTC — usado para
 * consultar Bookings/candidatos do dia selecionado, nunca um range maior (§19). */
export function computeLocalDayRangeUtc(dateKey: string, timeZone: string): { rangeStartAt: string; rangeEndAt: string } {
  const start = zonedWallClockToUtcInstant(dateKey, 0, timeZone);
  const nextDateKey = addDaysToDateKey(dateKey, 1);
  const end = zonedWallClockToUtcInstant(nextDateKey, 0, timeZone);
  return { rangeStartAt: start.toISOString(), rangeEndAt: end.toISOString() };
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

export function todayDateKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** dia da semana (0=domingo) de "YYYY-MM-DD" NO TIMEZONE do resource — nunca o do navegador. */
export function dayOfWeekForDateKeyInTimezone(dateKey: string, timeZone: string): number {
  const noonUtc = zonedWallClockToUtcInstant(dateKey, 12 * 60, timeZone);
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" });
  const short = dtf.format(noonUtc);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[short] ?? new Date(dateKey).getUTCDay();
}

/** "HH:mm" no timezone do resource — nunca o do navegador (§20). */
export function formatTimeInTimezone(isoString: string, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(isoString));
}

const DAY_NAMES: readonly DayOfWeek[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * §7/§17 — deriva o status visual de cada segmento de exibição (passo de 30min, só para RENDER — nunca a
 * granularidade real de lock de 5min, que continua exclusivamente server-side) dentro do expediente do dia:
 * AVAILABLE (dentro do weeklyHours, livre), BOOKED (sobreposto a um Booking confirmado) ou BLOCKED
 * (sobreposto a um AvailabilityBlock). Projeção best-effort para exibição — nunca a autoridade de reserva
 * (§16 do SERV-AVAIL-01: quem decide de verdade é sempre a transaction de createHold/confirm/reschedule).
 */
export function buildAgendaSegments(
  dateKey: string,
  timeZone: string,
  weeklyHours: WeeklyHours | undefined,
  bookings: readonly Booking[],
  blocks: readonly ServiceAvailabilityBlock[],
  displayStepMinutes = 30,
): AgendaSegment[] {
  const dayOfWeek = DAY_NAMES[dayOfWeekForDateKeyInTimezone(dateKey, timeZone)];
  const periods = weeklyHours?.[dayOfWeek as keyof WeeklyHours] ?? [];
  const segments: AgendaSegment[] = [];

  for (const period of periods) {
    const [startHour, startMinute] = period.start.split(":").map(Number);
    const [endHour, endMinute] = period.end.split(":").map(Number);
    const periodStartMinute = startHour * 60 + startMinute;
    const periodEndMinute = endHour * 60 + endMinute;

    for (let minuteOfDay = periodStartMinute; minuteOfDay < periodEndMinute; minuteOfDay += displayStepMinutes) {
      const segmentStart = zonedWallClockToUtcInstant(dateKey, minuteOfDay, timeZone);
      const segmentEnd = zonedWallClockToUtcInstant(dateKey, Math.min(minuteOfDay + displayStepMinutes, periodEndMinute), timeZone);
      const startAt = segmentStart.toISOString();
      const endAt = segmentEnd.toISOString();

      const overlappingBooking = bookings.find((booking) =>
        booking.status === "confirmed" && Date.parse(booking.startAt) < Date.parse(endAt) && Date.parse(startAt) < Date.parse(booking.endAt));
      if (overlappingBooking) {
        segments.push({ startAt, endAt, status: "booked", booking: overlappingBooking });
        continue;
      }

      const overlappingBlock = blocks.find((block) =>
        Date.parse(block.startAt) < Date.parse(endAt) && Date.parse(startAt) < Date.parse(block.endAt));
      if (overlappingBlock) {
        segments.push({ startAt, endAt, status: "blocked", block: overlappingBlock });
        continue;
      }

      segments.push({ startAt, endAt, status: "available" });
    }
  }

  return segments;
}

function apiErrorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code || "") : "";
}

/** SERV-UI-01 §22 / SERV-UI-02 §18 — nunca expõe código/stack interno; traduz os casos conhecidos do
 * backend de disponibilidade/booking, cai num texto genérico seguro. Compartilhado entre a Agenda e a tela
 * de configuração de disponibilidade — as duas conversam com os mesmos comandos, os mesmos códigos de erro
 * podem aparecer nas duas. */
export function agendaErrorMessage(error: unknown): string {
  const code = apiErrorCode(error);
  if (code === "SEGMENT_UNAVAILABLE" || code === "BLOCKED_INTERVAL") return "Esse horário não está mais disponível. Escolha outro.";
  if (code === "OUTSIDE_WORKING_HOURS") return "Esse horário está fora do expediente configurado.";
  if (code === "MISALIGNED_SLOT") return "Esse horário não está alinhado aos horários disponíveis.";
  if (code === "MIN_ADVANCE_VIOLATION" || code === "MAX_ADVANCE_VIOLATION") return "Esse horário está fora da janela de antecedência permitida.";
  if (code === "WORK_NOT_CANCELABLE" || code === "BOOKING_NOT_RESCHEDULABLE") return "Este atendimento já foi iniciado ou concluído.";
  if (code === "BLOCK_CONFLICT_WITH_BOOKING") return "Existe um atendimento agendado nesse período.";
  if (code === "BLOCK_CONFLICT_WITH_ACTIVE_HOLD") return "Esse horário está temporariamente reservado. Tente novamente em alguns instantes.";
  if (code === "INVALID_TIMEZONE") return "Fuso horário inválido.";
  if (code === "INVALID_SLOT_STEP") return "Intervalo entre horários inválido.";
  if (code === "INVALID_ADVANCE_WINDOW") return "Antecedência inválida.";
  if (code === "OVERLAPPING_DAILY_PERIODS") return "Há horários de atendimento sobrepostos neste dia.";
  return "Não foi possível concluir a ação agora. Tente novamente.";
}

/** Agrupa segmentos contíguos do MESMO status/booking/block numa única faixa visual — evita renderizar
 * dezenas de blocos de 30min idênticos lado a lado para um Booking/Block que ocupa horas seguidas. */
export function collapseAdjacentSegments(segments: readonly AgendaSegment[]): AgendaSegment[] {
  const collapsed: AgendaSegment[] = [];
  for (const segment of segments) {
    const last = collapsed[collapsed.length - 1];
    const sameOwner = last
      && last.status === segment.status
      && last.endAt === segment.startAt
      && (last.booking?.id ?? null) === (segment.booking?.id ?? null)
      && (last.block?.id ?? null) === (segment.block?.id ?? null);
    if (sameOwner) {
      collapsed[collapsed.length - 1] = { ...last, endAt: segment.endAt };
    } else {
      collapsed.push(segment);
    }
  }
  return collapsed;
}

/**
 * SERV-UI-02 — rótulos/ordem de exibição do expediente semanal (segunda primeiro, como o ticket pede),
 * independente da ordem de indexação de DAYS_OF_WEEK (domingo primeiro, alinhada a getUTCDay()).
 */
export const DAY_LABELS: Readonly<Record<DayOfWeek, string>> = {
  monday: "Segunda-feira", tuesday: "Terça-feira", wednesday: "Quarta-feira", thursday: "Quinta-feira",
  friday: "Sexta-feira", saturday: "Sábado", sunday: "Domingo",
};
export const DISPLAY_DAYS: readonly DayOfWeek[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export type DraftPeriod = { readonly id: string; readonly start: string; readonly end: string };
export type WeeklyDraft = Record<DayOfWeek, DraftPeriod[]>;

function generateDraftId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyWeeklyDraft(): WeeklyDraft {
  return { sunday: [], monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [] };
}

/** Schedule carregado do servidor -> rascunho editável (cada período ganha um id local estável para a
 * lista React — o backend nunca vê/persiste esse id). */
export function draftFromWeeklyHours(weeklyHours: WeeklyHours): WeeklyDraft {
  const draft = emptyWeeklyDraft();
  for (const day of DAY_NAMES) {
    draft[day] = weeklyHours[day].map((period) => ({ id: generateDraftId(), start: period.start, end: period.end }));
  }
  return draft;
}

/** Rascunho editável -> shape que o comando server-side espera (nunca inclui o id local). */
export function weeklyHoursFromDraft(draft: WeeklyDraft): WeeklyHours {
  const result = {} as Record<DayOfWeek, readonly DailyPeriod[]>;
  for (const day of DAY_NAMES) {
    result[day] = draft[day].map(({ start, end }) => ({ start, end }));
  }
  return result as WeeklyHours;
}

/**
 * §6/§7 — valida ordem (start<end) e overlap por dia ANTES de enviar ao servidor: a MESMA regra de negócio
 * que shared/service-availability.ts's assertValidDailyPeriod/assertNoOverlappingPeriods aplicam
 * server-side, só reimplementada com aritmética local em vez de importar essas funções (ver nota de
 * bundle no topo do arquivo) — nunca uma definição DIVERGENTE. "HH:MM" com dois dígitos e zero à esquerda
 * é diretamente comparável como string (a mesma ordem lexicográfica é a ordem cronológica do dia). O
 * servidor continua sendo a autoridade final — esta checagem é só UX, roda de novo (com autoridade) no
 * upsertServiceResourceSchedule. Retorna a mensagem amigável do primeiro dia inválido, ou `null` se tudo
 * estiver correto.
 */
export function validateWeeklyDraft(draft: WeeklyDraft): string | null {
  for (const day of DAY_NAMES) {
    const periods = draft[day];
    for (const period of periods) {
      if (period.end <= period.start) {
        return `${DAY_LABELS[day]}: confira o início e o fim de cada período (o fim precisa vir depois do início).`;
      }
    }
    const sorted = [...periods].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].start < sorted[i - 1].end) {
        return `${DAY_LABELS[day]}: há horários de atendimento sobrepostos neste dia.`;
      }
    }
  }
  return null;
}
