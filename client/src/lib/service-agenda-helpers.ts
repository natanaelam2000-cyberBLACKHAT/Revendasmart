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
import type { ServiceAvailabilityBlock, WeeklyHours } from "@shared/service-availability";

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

const DAY_NAMES: readonly string[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

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
