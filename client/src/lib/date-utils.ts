type DateInput = Date | number | string;

export const ptBR = { code: "pt-BR" } as const;

type WeekOptions = { weekStartsOn?: number };
type LocaleOptions = { locale?: unknown };
type DistanceOptions = LocaleOptions & { addSuffix?: boolean };

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MONTHS_SHORT_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function wantsPtBr(options?: LocaleOptions) {
  const locale = options?.locale as { code?: string } | string | undefined;
  return locale === ptBR || locale === "pt-BR" || (typeof locale === "object" && locale?.code === "pt-BR");
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function toDate(value: DateInput) {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === "string") return parseISO(value);
  return new Date(value);
}

export function parseISO(value: string) {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  return new Date(value);
}

export function startOfDay(value: DateInput) {
  const date = toDate(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function endOfDay(value: DateInput) {
  const date = toDate(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

export function startOfMonth(value: DateInput) {
  const date = toDate(value);
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(value: DateInput) {
  const date = toDate(value);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

export function startOfYear(value: DateInput) {
  const date = toDate(value);
  return new Date(date.getFullYear(), 0, 1);
}

export function endOfYear(value: DateInput) {
  const date = toDate(value);
  return new Date(date.getFullYear(), 11, 31, 23, 59, 59, 999);
}

export function addDays(value: DateInput, amount: number) {
  const date = toDate(value);
  date.setDate(date.getDate() + amount);
  return date;
}

export function subDays(value: DateInput, amount: number) {
  return addDays(value, -amount);
}

export function subWeeks(value: DateInput, amount: number) {
  return addDays(value, -amount * 7);
}

export function subMonths(value: DateInput, amount: number) {
  const date = toDate(value);
  const targetMonthIndex = date.getFullYear() * 12 + date.getMonth() - amount;
  const targetYear = Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  return new Date(
    targetYear,
    targetMonth,
    Math.min(date.getDate(), daysInMonth(targetYear, targetMonth)),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  );
}

export function subYears(value: DateInput, amount: number) {
  const date = toDate(value);
  const targetYear = date.getFullYear() - amount;
  return new Date(
    targetYear,
    date.getMonth(),
    Math.min(date.getDate(), daysInMonth(targetYear, date.getMonth())),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  );
}

export function startOfWeek(value: DateInput, options: WeekOptions = {}) {
  const weekStartsOn = options.weekStartsOn ?? 0;
  const date = startOfDay(value);
  const day = date.getDay();
  const diff = (day < weekStartsOn ? 7 : 0) + day - weekStartsOn;
  return addDays(date, -diff);
}

export function endOfWeek(value: DateInput, options: WeekOptions = {}) {
  return endOfDay(addDays(startOfWeek(value, options), 6));
}

export function isSameDay(left: DateInput, right: DateInput) {
  const a = toDate(left);
  const b = toDate(right);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function isSameMonth(left: DateInput, right: DateInput) {
  const a = toDate(left);
  const b = toDate(right);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function isToday(value: DateInput) {
  return isSameDay(value, new Date());
}

export function isTomorrow(value: DateInput) {
  return isSameDay(value, addDays(new Date(), 1));
}

export function isBefore(left: DateInput, right: DateInput) {
  return toDate(left).getTime() < toDate(right).getTime();
}

export function isAfter(left: DateInput, right: DateInput) {
  return toDate(left).getTime() > toDate(right).getTime();
}

export function differenceInDays(left: DateInput, right: DateInput) {
  return Math.floor((startOfDay(left).getTime() - startOfDay(right).getTime()) / MS_PER_DAY);
}

export function differenceInCalendarDays(left: DateInput, right: DateInput) {
  return differenceInDays(left, right);
}

export function getDate(value: DateInput) {
  return toDate(value).getDate();
}

export function isWithinInterval(value: DateInput, interval: { start: DateInput; end: DateInput }) {
  const time = toDate(value).getTime();
  return time >= toDate(interval.start).getTime() && time <= toDate(interval.end).getTime();
}

export function format(value: DateInput, pattern: string, options?: LocaleOptions) {
  const date = toDate(value);
  const yyyy = String(date.getFullYear());
  const yy = yyyy.slice(-2);
  const MM = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const HH = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const usePtBr = wantsPtBr(options);
  const months = usePtBr ? MONTHS_PT : MONTHS_EN;
  const shortMonths = usePtBr ? MONTHS_SHORT_PT : MONTHS_SHORT_EN;

  switch (pattern) {
    case "dd/MM/yyyy":
      return `${dd}/${MM}/${yyyy}`;
    case "dd/MM":
      return `${dd}/${MM}`;
    case "dd/MM HH:mm":
      return `${dd}/${MM} ${HH}:${mm}`;
    case "yyyy-MM-dd'T'HH:mm":
      return `${yyyy}-${MM}-${dd}T${HH}:${mm}`;
    case "yyyy-MM":
      return `${yyyy}-${MM}`;
    case "MMM/yy":
      return `${shortMonths[date.getMonth()]}/${yy}`;
    case "MMMM yyyy":
      return `${months[date.getMonth()]} ${yyyy}`;
    case "MM/yy":
      return `${MM}/${yy}`;
    case "dd 'de' MMMM":
      return `${dd} de ${months[date.getMonth()]}`;
    case "dd 'de' MMMM 'de' yyyy":
      return `${dd} de ${months[date.getMonth()]} de ${yyyy}`;
    default:
      return date.toLocaleDateString(usePtBr ? "pt-BR" : "en-US");
  }
}

export function formatDistanceToNow(value: DateInput, options: DistanceOptions = {}) {
  const diffMs = toDate(value).getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const minutes = Math.round(absMs / 60000);
  const hours = Math.round(absMs / 3600000);
  const days = Math.round(absMs / MS_PER_DAY);
  const months = Math.round(days / 30);
  const years = Math.round(days / 365);

  let text: string;
  if (minutes < 1) text = "menos de um minuto";
  else if (minutes < 60) text = `${minutes} minuto${minutes === 1 ? "" : "s"}`;
  else if (hours < 24) text = `${hours} hora${hours === 1 ? "" : "s"}`;
  else if (days < 30) text = `${days} dia${days === 1 ? "" : "s"}`;
  else if (months < 12) text = `${months} mês${months === 1 ? "" : "es"}`;
  else text = `${years} ano${years === 1 ? "" : "s"}`;

  if (!options.addSuffix) return text;
  return diffMs < 0 ? `há ${text}` : `em ${text}`;
}
