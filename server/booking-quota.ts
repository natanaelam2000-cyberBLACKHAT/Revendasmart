/**
 * PLAN-IMPL-02C — autoridade canônica de "mês comercial" do tenant para a cota mensal de agendamentos
 * (Free = 20/mês, Pro/Premium = fair use, nunca bloqueado). Deliberadamente SEPARADA de
 * ServiceResourceSchedule.timezone (que continua responsável só por expediente/disponibilidade POR
 * RECURSO, inalterada por este arquivo) — BOOKING_QUOTA_TIMEZONE é UMA por tenant, nunca por recurso,
 * resolvendo a ambiguidade que travou PLAN-IMPL-02A (§13 daquele ticket, ver PLAN-IMPL-02A_REPORT): um
 * tenant com recursos em timezones diferentes agora tem uma autoridade única e não-ambígua para decidir
 * "a que mês pertence este Booking" — a disponibilidade de cada recurso continua decidida pela SUA
 * PRÓPRIA timezone, exatamente como antes.
 *
 * TIMEZONE: mesma base (date-fns-tz, Intl real via assertValidTimezone) e mesmo padrão já auditado e
 * aprovado em server/service-availability-commands.ts — reaproveitado aqui, nunca um segundo cálculo de
 * offset/DST à mão.
 */
import type { Express, NextFunction, Request, Response } from "express";
import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { logError } from "./logger";
import { assertValidTimezone } from "../shared/service-availability";
import { PLAN_CONFIG, UNLIMITED, type PlanType } from "../shared/monetization";
import type { IsoUtcString } from "../shared/services";

/** §8 — nunca UTC como fallback silencioso; V1 é para o mercado brasileiro. */
export const DEFAULT_BUSINESS_TIMEZONE = "America/Sao_Paulo";

export type BookingQuotaTimezoneSource = "existing_business_timezone" | "single_resource_timezone" | "default_brazil";

export type BookingMonthlyUsage = {
  readonly monthKey: string;
  readonly timezone: string;
  readonly confirmedCount: number;
  readonly initializedAt: string;
  readonly updatedAt: string;
};

function usageSummaryRef(db: Firestore, uid: string) {
  return db.collection("users").doc(uid).collection("planUsage").doc("summary");
}
/** §13/§14 — id determinístico por mês, dentro da MESMA coleção planUsage já criada em PLAN-IMPL-02A2
 * (nenhuma segunda coleção de "uso"). */
function monthlyUsageRef(db: Firestore, uid: string, monthKey: string) {
  return db.collection("users").doc(uid).collection("planUsage").doc(`bookings-${monthKey}`);
}
function userSettingsRef(db: Firestore, uid: string) {
  return db.collection("user_settings").doc(uid);
}
function resourceSchedulesCollection(db: Firestore, uid: string) {
  return db.collection("users").doc(uid).collection("serviceResourceSchedules");
}
function bookingsCollection(db: Firestore, uid: string) {
  return db.collection("users").doc(uid).collection("bookings");
}

function isValidIanaTimezone(value: string): boolean {
  try {
    assertValidTimezone(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * §11/§12 — pura: classifica um instante UTC pelo "relógio de parede" LOCAL da timezone de cota
 * (toZonedTime + getters locais, nunca getUTC-algo ou prefixo de string) — mesmo padrão já usado por
 * resolveLocalWallClock em server/service-availability-commands.ts, nunca um segundo cálculo à mão.
 * O mesmo instante pode legitimamente cair no mês local ANTERIOR ao prefixo UTC (§12 do ticket).
 */
export function resolveBookingQuotaMonthKey(scheduledStartIso: IsoUtcString, timezone: string): string {
  const zoned = toZonedTime(scheduledStartIso, timezone);
  const year = zoned.getFullYear();
  const month = String(zoned.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/** Inverso de resolveBookingQuotaMonthKey: os limites UTC do mês comercial "monthKey" nesta timezone —
 * usado só para o bootstrap (§17), nunca para classificar um Booking individual (isso é sempre
 * resolveBookingQuotaMonthKey sobre o startAt real do Booking). */
function resolveMonthUtcRange(monthKey: string, timezone: string): { readonly startUtc: string; readonly endUtc: string } {
  const [yearStr, monthStr] = monthKey.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const startLocalNaive = `${monthKey}-01T00:00:00`;
  const endLocalNaive = `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01T00:00:00`;
  return {
    startUtc: fromZonedTime(startLocalNaive, timezone).toISOString(),
    endUtc: fromZonedTime(endLocalNaive, timezone).toISOString(),
  };
}

export type ResolvedBookingQuotaTimezone = {
  readonly timezone: string;
  readonly source: BookingQuotaTimezoneSource | "already_set";
  readonly needsPersist: boolean;
};

/**
 * §6-9 — resolve a timezone de cota do tenant DENTRO de uma transação já aberta (o CHAMADOR decide
 * quando persistir o bootstrap via persistBookingQuotaTimezone, já que toda escrita numa transação
 * Firestore precisa vir depois de TODAS as leituras).
 *
 * Ordem de bootstrap (§8), auditada antes de escrever este código (ver PLAN-IMPL-02C_REPORT):
 * 1) timezone de negócio já existente — auditado: NENHUM campo desse tipo existe hoje em user_settings
 *    (grep confirmado, nenhum "businessTimezone"/"storeTimezone" em todo o schema real). Verificado aqui
 *    mesmo assim, de forma forward-compatible: se um ticket futuro adicionar `storeTimezone` a
 *    user_settings, o bootstrap já o usa automaticamente, sem precisar mudar este arquivo.
 * 2) todos os ServiceResourceSchedules já cadastrados concordando na MESMA timezone (§9 — múltiplas
 *    timezones entre recursos NÃO é erro, só significa que esta regra não se aplica e cai para 3).
 * 3) DEFAULT_BUSINESS_TIMEZONE. Nunca UTC como fallback silencioso.
 */
export async function resolveBookingQuotaTimezone(tx: Transaction, db: Firestore, uid: string): Promise<ResolvedBookingQuotaTimezone> {
  const summarySnap = await tx.get(usageSummaryRef(db, uid));
  const existing = summarySnap.exists ? summarySnap.data()?.bookingQuotaTimezone : undefined;
  if (typeof existing === "string" && existing.length > 0) {
    return { timezone: existing, source: "already_set", needsPersist: false };
  }

  const settingsSnap = await tx.get(userSettingsRef(db, uid));
  const businessTimezone = settingsSnap.exists ? settingsSnap.data()?.storeTimezone : undefined;
  if (typeof businessTimezone === "string" && businessTimezone.length > 0 && isValidIanaTimezone(businessTimezone)) {
    return { timezone: businessTimezone, source: "existing_business_timezone", needsPersist: true };
  }

  const schedulesSnap = await tx.get(resourceSchedulesCollection(db, uid));
  const resourceTimezones = new Set<string>();
  for (const doc of schedulesSnap.docs) {
    const tz = doc.data()?.timezone;
    if (typeof tz === "string" && tz.length > 0) resourceTimezones.add(tz);
  }
  if (resourceTimezones.size === 1) {
    return { timezone: Array.from(resourceTimezones)[0]!, source: "single_resource_timezone", needsPersist: true };
  }

  return { timezone: DEFAULT_BUSINESS_TIMEZONE, source: "default_brazil", needsPersist: true };
}

/** §10 — grava o resultado do bootstrap (fase de ESCRITA da transação). `merge: true` é essencial: este
 * é o MESMO documento planUsage/summary onde productsCount/servicesCount já vivem (PLAN-IMPL-02A2) — um
 * `set` sem merge apagaria esses campos. Uma vez persistida, nunca mais recalculada (source="already_set"
 * na próxima leitura) — estável, client nunca pode alterá-la (ver firestore.rules, planUsage já é
 * `allow read, write: if false` desde 02A2, inalterado). */
export function persistBookingQuotaTimezone(tx: Transaction, db: Firestore, uid: string, resolved: ResolvedBookingQuotaTimezone, nowIso: string): void {
  if (!resolved.needsPersist) return;
  tx.set(usageSummaryRef(db, uid), {
    bookingQuotaTimezone: resolved.timezone,
    bookingQuotaTimezoneSource: resolved.source,
    updatedAt: nowIso,
  }, { merge: true });
}

export type MonthlyUsageResolution = {
  readonly ref: DocumentReference;
  readonly confirmedCount: number;
  readonly initializedAt: string;
};

/**
 * §13/§17/§18/§19 — lê o doc mensal; se ausente, faz o bootstrap UMA VEZ: busca real de Bookings cujo
 * `startAt` caia neste mês local (um range query por startAt, nunca um scan da coleção inteira e nunca
 * uma query composta que exigisse índice novo — o filtro por status="confirmed" é aplicado em memória
 * sobre o resultado, deliberadamente, para não depender de um índice composto ainda não implantado) DENTRO
 * da MESMA transação (§18 — bootstrap convive com confirmações concorrentes porque tudo serializa no
 * mesmo documento). Depois do bootstrap, toda confirmação seguinte só lê este documento — nunca mais
 * recontagem completa (§19).
 */
export async function readOrBootstrapMonthlyUsage(tx: Transaction, db: Firestore, uid: string, monthKey: string, timezone: string): Promise<MonthlyUsageResolution> {
  const ref = monthlyUsageRef(db, uid, monthKey);
  const snap = await tx.get(ref);
  if (snap.exists) {
    const data = snap.data() as Partial<BookingMonthlyUsage>;
    return {
      ref,
      confirmedCount: Number.isFinite(data.confirmedCount) ? Math.max(0, Number(data.confirmedCount)) : 0,
      initializedAt: typeof data.initializedAt === "string" ? data.initializedAt : new Date().toISOString(),
    };
  }

  const { startUtc, endUtc } = resolveMonthUtcRange(monthKey, timezone);
  const bootstrapSnap = await tx.get(
    bookingsCollection(db, uid).where("startAt", ">=", startUtc).where("startAt", "<", endUtc),
  );
  const confirmedCount = bootstrapSnap.docs.filter((doc) => doc.data().status === "confirmed").length;
  return { ref, confirmedCount, initializedAt: new Date().toISOString() };
}

/** Grava o doc mensal com o novo confirmedCount (fase de escrita) — sempre o shape completo (nunca um
 * update parcial), já que quem chama sempre tem o valor total já calculado (leitura + delta local). */
export function writeMonthlyUsage(tx: Transaction, ref: DocumentReference, monthKey: string, timezone: string, confirmedCount: number, initializedAt: string, nowIso: string): void {
  tx.set(ref, {
    monthKey, timezone, confirmedCount: Math.max(0, confirmedCount), initializedAt, updatedAt: nowIso,
  } satisfies BookingMonthlyUsage);
}

/** §21/§22 — UNLIMITED (Pro/Premium) nunca bloqueia; Free bloqueia em >= limite. */
export function isWithinBookingsMonthlyLimit(plan: PlanType, confirmedCount: number): boolean {
  const limit = PLAN_CONFIG[plan].limits.bookingsMonthly;
  return limit === UNLIMITED || confirmedCount < limit;
}

/**
 * §55 — diagnóstico/reparo administrativo: recalcula do zero a contagem REAL de um mês (mesma lógica do
 * bootstrap, mas chamável a qualquer momento, não só quando o doc mensal está ausente). NUNCA chamado
 * automaticamente numa confirmação normal (§19 proíbe recontagem completa a cada request) — só para
 * teste/manutenção futura.
 */
export async function recountBookingMonthUsage(db: Firestore, uid: string, monthKey: string, timezone: string): Promise<number> {
  const { startUtc, endUtc } = resolveMonthUtcRange(monthKey, timezone);
  const snap = await bookingsCollection(db, uid).where("startAt", ">=", startUtc).where("startAt", "<", endUtc).get();
  return snap.docs.filter((doc) => doc.data().status === "confirmed").length;
}

export type CurrentMonthBookingUsage = {
  readonly used: number;
  readonly limit: number;
  readonly monthKey: string;
  readonly timezone: string;
};

/**
 * Leitura para UI (Plano e uso, §46/§47) — não incrementa nada, mas ainda roda dentro de uma transação
 * porque pode legitimamente precisar bootstrapar a timezone/doc mensal na primeira vez que alguém olha a
 * tela antes de qualquer Booking real ter sido confirmado neste mês (mesmo espírito "lazy bootstrap" já
 * usado por planUsage/summary desde PLAN-IMPL-02A2).
 */
export async function getCurrentMonthBookingUsage(db: Firestore, uid: string, plan: PlanType): Promise<CurrentMonthBookingUsage> {
  const nowIso = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const resolvedTimezone = await resolveBookingQuotaTimezone(tx, db, uid);
    const monthKey = resolveBookingQuotaMonthKey(nowIso, resolvedTimezone.timezone);
    const usage = await readOrBootstrapMonthlyUsage(tx, db, uid, monthKey, resolvedTimezone.timezone);

    persistBookingQuotaTimezone(tx, db, uid, resolvedTimezone, nowIso);
    // Bootstrap desta leitura também é persistido (mesma semântica de "resolver uma vez, nunca mais
    // recontar") mesmo que nenhum Booking tenha sido confirmado ainda através desta chamada específica.
    writeMonthlyUsage(tx, usage.ref, monthKey, resolvedTimezone.timezone, usage.confirmedCount, usage.initializedAt, nowIso);

    return {
      used: usage.confirmedCount,
      limit: PLAN_CONFIG[plan].limits.bookingsMonthly,
      monthKey,
      timezone: resolvedTimezone.timezone,
    };
  });
}

/**
 * §46/§47 — a única forma do client saber `used`/`monthKey` para a UI de Plano e uso: o doc mensal é
 * `allow read, write: if false` (server-only, ver firestore.rules) desde sua criação, então precisa de um
 * endpoint dedicado, no mesmo padrão de autenticação/resolução de plano de todo o resto deste domínio
 * (resolveServerPlan — nunca confia num plano que o client alegue ter).
 */
export function registerBookingQuotaRoutes(
  app: Express,
  requireAuth: (req: Request, res: Response, next: NextFunction) => void,
  resolveServerPlan: (db: Firestore, uid: string) => Promise<PlanType>,
): void {
  app.get("/api/booking-quota/current-month", requireAuth, async (req: Request, res: Response) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!uid) return res.status(401).json({ code: "UNAUTHORIZED", message: "Sessão inválida. Faça login novamente." });
    try {
      const db = getFirebaseAdmin().firestore();
      const plan = await resolveServerPlan(db, uid);
      const result = await getCurrentMonthBookingUsage(db, uid, plan);
      return res.status(200).json(result);
    } catch (error) {
      logError("booking_quota.current_month_failed", error, { requestId: req.requestId });
      return res.status(500).json({ code: "BOOKING_QUOTA_READ_FAILED", message: "Não foi possível carregar o uso de agendamentos agora." });
    }
  });
}
