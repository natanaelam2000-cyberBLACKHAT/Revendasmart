/**
 * PLAN-IMPL-05 — autoridade server-only da cota mensal de NOVAS preparações profissionais de produto
 * (Anúncios Pro): Free=0, Pro=3, Premium=100 (`PLAN_CONFIG[plan].limits.proAdPreparationsMonthly`,
 * shared/monetization.ts — nunca hardcoded aqui). Mede exclusivamente a operação cara e reutilizável
 * (recorte real via PhotoRoom, server/product-cutout-photoroom.ts) — nunca geração de anúncio, export,
 * troca de template/fundo/proporção ou replay de histórico (isso é reuso puro do asset já preparado,
 * sempre gratuito).
 *
 * Mesmo padrão de autoridade de "mês comercial" de server/booking-quota.ts (PLAN-IMPL-02C), reaproveitado
 * por importação direta (`resolveBookingQuotaTimezone`/`persistBookingQuotaTimezone`/
 * `resolveBookingQuotaMonthKey`) — nenhuma segunda noção de timezone/mês é inventada aqui (§14 do
 * ticket). O doc mensal vive na MESMA subcoleção `planUsage` já criada em PLAN-IMPL-02A2/02C
 * (`users/{uid}/planUsage/ads-pro-preparations-{monthKey}`), já `allow read, write: if false` em
 * firestore.rules (regra genérica por wildcard `{usageId}` — nenhuma regra nova precisa ser adicionada).
 *
 * Reserva/concorrência (§19-§22 do ticket): a chamada ao provider (PhotoRoom) NUNCA roda dentro de uma
 * transação Firestore — só a decisão "posso consumir uma preparação agora" é atômica. Duas transações
 * atômicas, nunca uma só, para o mesmo produto/mês:
 *   1) `reservePreparationSlot` — ANTES do provider: dentro de UMA transação, lê e verifica o lock
 *      `users/{uid}/adsProPreparationLocks/{productId}` (protege concorrência do MESMO produto — dois
 *      cliques simultâneos no mesmo produto convergem no mesmo lock e só um consome; o outro recebe
 *      IN_PROGRESS sem consumir nada) E o doc mensal `used < limit` (protege concorrência entre produtos
 *      DIFERENTES — dois produtos diferentes competem pela MESMA última vaga do mês, só um vence) — se
 *      ambos passam, incrementa `used` e cria o lock como "processing" no MESMO commit.
 *   2) `completePreparationSlot`/`releasePreparationSlot` — DEPOIS do provider: sucesso apaga o lock
 *      (cota já ficou gasta no passo 1, nunca "gasta duas vezes"); falha decrementa `used` de volta e
 *      apaga o lock — nenhuma cota é permanentemente perdida por uma falha de provider/storage (§23).
 */
import type { Express, NextFunction, Request, Response } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { logError } from "./logger";
import {
  DEFAULT_BUSINESS_TIMEZONE,
  persistBookingQuotaTimezone,
  resolveBookingQuotaMonthKey,
  resolveBookingQuotaTimezone,
} from "./booking-quota";
import { PLAN_CONFIG, UNLIMITED, type PlanType } from "../shared/monetization";

function monthlyUsageRef(db: Firestore, uid: string, monthKey: string) {
  return db.collection("users").doc(uid).collection("planUsage").doc(`ads-pro-preparations-${monthKey}`);
}
function preparationLockRef(db: Firestore, uid: string, productId: string) {
  return db.collection("users").doc(uid).collection("adsProPreparationLocks").doc(productId);
}

export type AdsProPreparationMonthlyUsage = {
  readonly monthKey: string;
  readonly timezone: string;
  readonly used: number;
  readonly updatedAt: string;
};

interface PreparationLockDoc {
  readonly status: "processing";
  readonly monthKey: string;
  readonly createdAt: string;
}

export type ReservePreparationSlotResult =
  | { readonly reserved: true; readonly monthKey: string }
  | { readonly reserved: false; readonly reason: "limit_reached"; readonly monthKey: string; readonly used: number; readonly limit: number }
  | { readonly reserved: false; readonly reason: "in_progress" };

/** §19/§20/§21 — única transação atômica que decide "esta preparação pode consumir uma vaga agora". */
export async function reservePreparationSlot(
  db: Firestore,
  uid: string,
  productId: string,
  plan: PlanType,
): Promise<ReservePreparationSlotResult> {
  const limit = PLAN_CONFIG[plan].limits.proAdPreparationsMonthly;
  const nowIso = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    const lockRef = preparationLockRef(db, uid, productId);
    const lockSnap = await tx.get(lockRef);
    if (lockSnap.exists) {
      return { reserved: false, reason: "in_progress" } as const;
    }

    const resolvedTimezone = await resolveBookingQuotaTimezone(tx, db, uid);
    const monthKey = resolveBookingQuotaMonthKey(nowIso, resolvedTimezone.timezone);
    const usageRef = monthlyUsageRef(db, uid, monthKey);
    const usageSnap = await tx.get(usageRef);
    const used = usageSnap.exists && Number.isFinite(usageSnap.data()?.used) ? Math.max(0, Number(usageSnap.data()?.used)) : 0;

    if (limit !== UNLIMITED && used >= limit) {
      return { reserved: false, reason: "limit_reached", monthKey, used, limit } as const;
    }

    persistBookingQuotaTimezone(tx, db, uid, resolvedTimezone, nowIso);
    tx.set(usageRef, {
      monthKey, timezone: resolvedTimezone.timezone, used: used + 1, updatedAt: nowIso,
    } satisfies AdsProPreparationMonthlyUsage, { merge: true });
    tx.create(lockRef, { status: "processing", monthKey, createdAt: nowIso } satisfies PreparationLockDoc);

    return { reserved: true, monthKey } as const;
  });
}

/** Sucesso: a cota reservada em `reservePreparationSlot` fica consumida — só libera o lock. */
export async function completePreparationSlot(db: Firestore, uid: string, productId: string): Promise<void> {
  await preparationLockRef(db, uid, productId).delete();
}

/** Falha (provider ou storage, §23): devolve a vaga reservada e libera o lock para uma nova tentativa. */
export async function releasePreparationSlot(db: Firestore, uid: string, productId: string, monthKey: string): Promise<void> {
  const nowIso = new Date().toISOString();
  await db.runTransaction(async (tx) => {
    const lockRef = preparationLockRef(db, uid, productId);
    const usageRef = monthlyUsageRef(db, uid, monthKey);
    const usageSnap = await tx.get(usageRef);
    const used = usageSnap.exists && Number.isFinite(usageSnap.data()?.used) ? Math.max(0, Number(usageSnap.data()?.used)) : 0;
    tx.set(usageRef, { used: Math.max(0, used - 1), updatedAt: nowIso }, { merge: true });
    tx.delete(lockRef);
  });
}

export type CurrentMonthPreparationUsage = {
  readonly used: number;
  readonly limit: number;
  readonly monthKey: string;
  readonly timezone: string;
};

/** Leitura para a UI (Plano e uso, §31) — nunca incrementa nada; pode bootstrapar timezone/mês na
 * primeira vez que alguém abre a tela, mesmo espírito lazy-bootstrap de getCurrentMonthBookingUsage. */
export async function getCurrentMonthPreparationUsage(db: Firestore, uid: string, plan: PlanType): Promise<CurrentMonthPreparationUsage> {
  const nowIso = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const resolvedTimezone = await resolveBookingQuotaTimezone(tx, db, uid);
    const monthKey = resolveBookingQuotaMonthKey(nowIso, resolvedTimezone.timezone);
    const usageRef = monthlyUsageRef(db, uid, monthKey);
    const usageSnap = await tx.get(usageRef);
    const used = usageSnap.exists && Number.isFinite(usageSnap.data()?.used) ? Math.max(0, Number(usageSnap.data()?.used)) : 0;

    persistBookingQuotaTimezone(tx, db, uid, resolvedTimezone, nowIso);
    if (!usageSnap.exists) {
      tx.set(usageRef, { monthKey, timezone: resolvedTimezone.timezone, used: 0, updatedAt: nowIso } satisfies AdsProPreparationMonthlyUsage);
    }

    return { used, limit: PLAN_CONFIG[plan].limits.proAdPreparationsMonthly, monthKey, timezone: resolvedTimezone.timezone };
  });
}

/** Fallback só para o caso adversarial de resolveBookingQuotaTimezone nunca ter rodado (nenhum caminho
 * real hoje deixa isso acontecer) — nunca UTC silencioso, mesmo princípio de booking-quota.ts. */
export function fallbackPreparationMonthKey(now: Date = new Date()): string {
  return resolveBookingQuotaMonthKey(now.toISOString(), DEFAULT_BUSINESS_TIMEZONE);
}

export function registerAdsProPreparationQuotaRoutes(
  app: Express,
  requireAuth: (req: Request, res: Response, next: NextFunction) => void,
  resolveServerPlan: (db: Firestore, uid: string) => Promise<PlanType>,
): void {
  app.get("/api/ads-pro/preparation-quota/current-month", requireAuth, async (req: Request, res: Response) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!uid) return res.status(401).json({ code: "UNAUTHORIZED", message: "Sessão inválida. Faça login novamente." });
    try {
      const db = getFirebaseAdmin().firestore();
      const plan = await resolveServerPlan(db, uid);
      const result = await getCurrentMonthPreparationUsage(db, uid, plan);
      return res.status(200).json(result);
    } catch (error) {
      logError("ads_pro_preparation_quota.current_month_failed", error, { requestId: req.requestId });
      return res.status(500).json({ code: "ADS_PRO_PREPARATION_QUOTA_READ_FAILED", message: "Não foi possível carregar o uso de preparações agora." });
    }
  });
}
