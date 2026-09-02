/**
 * PLAN-IMPL-03 — autoridade canônica de lifecycle do plano: concessão do trial Premium de 7 dias
 * (server-owned, uma vez por conta, só para contas novas de verdade — nunca retroativo para conta
 * legada) e reconciliação preguiçosa de Products/Services quando o plano EFETIVO muda (trial
 * expira/converte, assinatura muda) — o primeiro chamador real de reconcilePlanAccess
 * (server/plan-access-reconciliation.ts), que desde PLAN-IMPL-02B1 já existia pronta e sem chamador
 * (ver o cabeçalho daquele arquivo).
 *
 * BASE vs EFETIVO (§4 do ticket): `currentPlan`/`premiumActive`/`premiumSource` em planData continuam
 * descrevendo só o plano BASE (assinatura real, admin, indicação) — nunca escritos por este arquivo.
 * O plano EFETIVO (o que todo o resto do app usa) é sempre recalculado puro em
 * `resolveCommercialPlan`/`resolveBaseCommercialPlan` (shared/monetization.ts); este arquivo só decide
 * QUANDO conceder o trial e QUANDO essa mudança precisa ser materializada em Products/Services.
 */
import crypto from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { reconcilePlanAccess } from "./plan-access-reconciliation";
import {
  PLANS,
  TRIAL_DURATION_DAYS,
  isTrialCurrentlyActive,
  resolveBaseCommercialPlan,
  toEntitlementDate,
  type PlanData,
  type PlanType,
} from "../shared/monetization";

/**
 * §10 — nenhuma conta criada ANTES deste corte recebe trial retroativo, mesmo que `planData` só venha
 * a existir depois (login tardio, reinstalação, etc.) — a autoridade é `metadata.creationTime` do
 * Firebase Auth (nunca `planData` ausente sozinho, que também é verdade para conta legada sem doc).
 * Injetável em teste (§50) via o parâmetro `cutoverIso` de `isNewEligibleUserForTrial`.
 */
export const TRIAL_ELIGIBILITY_SINCE = "2026-09-02T00:00:00.000Z";

/** Mesmo padrão de `isReferralAccountOldEnough` (server/routes.ts) — só o timestamp do Firebase Auth,
 * nunca nada vindo do client, decide elegibilidade. Aqui a direção é oposta (conta precisa ser NOVA o
 * bastante, não velha o bastante), mas a garantia é a mesma: nenhum client forja "sou uma conta nova". */
export function isNewEligibleUserForTrial(
  authUserCreationTimeIso: string | undefined | null,
  cutoverIso: string = TRIAL_ELIGIBILITY_SINCE,
): boolean {
  if (!authUserCreationTimeIso) return false;
  const createdAtMs = new Date(authUserCreationTimeIso).getTime();
  if (!Number.isFinite(createdAtMs)) return false;
  const cutoverMs = new Date(cutoverIso).getTime();
  if (!Number.isFinite(cutoverMs)) return false;
  return createdAtMs >= cutoverMs;
}

/**
 * §6/§7/§9/§11 — puro: nunca toca Firestore, nunca decide sozinho "já usou o trial" (quem decide isso é
 * o chamador, checando se o doc planData já existe — ver server/routes.ts `/api/plan/initialize`, que só
 * entra neste caminho quando o documento está sendo criado pela primeira vez, então não há como já ter
 * `trialStatus` gravado). Devolve `{}` (nenhum campo) quando a conta não é elegível — nunca grava
 * `trialStatus: 'ineligible'` ou similar; ausência do campo já significa "nunca concedido" (§7, sem
 * exigir escrita em massa para conta legada).
 */
export function computeTrialGrantFields(
  authUserCreationTimeIso: string | undefined | null,
  nowIso: string,
  cutoverIso: string = TRIAL_ELIGIBILITY_SINCE,
): Partial<PlanData> {
  if (!isNewEligibleUserForTrial(authUserCreationTimeIso, cutoverIso)) return {};
  const now = new Date(nowIso);
  const trialEndsAt = new Date(now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);
  return {
    trialStatus: "active",
    trialStartedAt: now,
    trialEndsAt,
    trialGrantedPlan: PLANS.PREMIUM,
  };
}

function planDataRef(db: Firestore, uid: string) {
  return db.collection("users").doc(uid).collection("planData").doc("main");
}

function referralCodeForUid(uid: string): string {
  return `USER-${crypto.createHash("md5").update(uid).digest("hex").substring(0, 9).toUpperCase()}`;
}

/**
 * §9/§11/§12 — chamada de `POST /api/plan/initialize/:userId` (server/routes.ts), que já dispara em todo
 * login real (PrivateRouter.tsx) — o único caminho real de concessão de trial neste ticket.
 * `authUserCreationTimeIso` vem do Firebase Auth, lido pelo CHAMADOR fora de qualquer transação (Auth não
 * participa de transação do Firestore) — nunca deste arquivo diretamente, para esta função permanecer
 * testável sem precisar de um usuário Auth real por trás de cada `uid` de teste.
 *
 * `tx.create()` (nunca `set`) no doc de plano é a garantia de atomicidade/idempotência (§11): duas
 * chamadas concorrentes para o MESMO uid nunca produzem dois trials nem um segundo `set()` sobrescrevendo
 * o primeiro — a perdedora simplesmente vê o doc já existente e não faz nada.
 */
export async function initializePlanCommand(
  db: Firestore,
  uid: string,
  authUserCreationTimeIso: string | undefined | null,
  nowIso: string = new Date().toISOString(),
  cutoverIso: string = TRIAL_ELIGIBILITY_SINCE,
): Promise<{ referralCode: string }> {
  const referralCode = referralCodeForUid(uid);
  const planRef = planDataRef(db, uid);
  const referralCodeRef = db.collection("referralCodes").doc(referralCode);

  await db.runTransaction(async (tx) => {
    const existingPlan = await tx.get(planRef);
    if (existingPlan.exists) return;

    const trialFields = computeTrialGrantFields(authUserCreationTimeIso, nowIso, cutoverIso);
    tx.create(planRef, {
      currentPlan: "free",
      premiumActive: false,
      premiumExpiresAt: null,
      premiumStartedAt: null,
      premiumSource: null,
      referralCode,
      referralCount: 0,
      updatedAt: new Date(nowIso),
      ...trialFields,
    });
    // RELEASE-28: índice reverso code -> uid — `set` (não `create`) preserva o comportamento original,
    // tolerante a um doc de índice remanescente de um estado anterior incomum (o próprio planData
    // deletado manualmente, por exemplo); o hash é determinístico por uid, então reescrevê-lo com os
    // mesmos dados nunca é destrutivo.
    tx.set(referralCodeRef, { uid, createdAt: new Date(nowIso) });
  });

  return { referralCode };
}

export type PlanLifecycleTrialSnapshot = {
  readonly status: "active" | "expired" | "converted";
  readonly startedAt: string | null;
  readonly endsAt: string | null;
};

export type PlanLifecycleSnapshot = {
  readonly basePlan: PlanType;
  readonly effectivePlan: PlanType;
  readonly trial: PlanLifecycleTrialSnapshot | null;
};

const NEVER_INITIALIZED_SNAPSHOT: PlanLifecycleSnapshot = { basePlan: PLANS.FREE, effectivePlan: PLANS.FREE, trial: null };

/**
 * §24/§25 — reconciliação PREGUIÇOSA server-authoritative: chamada de qualquer superfície que precise do
 * plano efetivo atual (fetch de planData, catálogo público, agendamento público, mutação de
 * Product/Service — ver os chamadores). Nunca cria `planData` (§11 é quem cria, no initialize) — para um
 * tenant sem doc ainda, devolve Free sem nenhuma escrita (evitaria um doc parcial que o initialize depois
 * jamais completaria, já que ele só escreve quando `!exists`).
 *
 * Idempotência/concorrência (§27/§28): `effectivePlan` é sempre recalculado puro a partir de
 * trial+base+`now`, nunca de um diff armazenado — duas chamadas concorrentes calculam o MESMO
 * `effectivePlan` e, na pior hipótese, chamam `reconcilePlanAccess` duas vezes (idempotente por
 * construção, ver o cabeçalho daquele arquivo) e gravam o MESMO `lastAppliedEffectivePlan` — nunca um
 * estado parcialmente divergente. Ordem deliberada: reconciliar PRIMEIRO, marcar `lastAppliedEffectivePlan`
 * DEPOIS — um crash entre os dois deixa a marca ainda desatualizada, então a PRÓXIMA chamada detecta a
 * mesma transição pendente e tenta de novo (at-least-once, nunca at-most-once — nunca perde uma
 * reconciliação pendente silenciosamente).
 */
export async function ensurePlanLifecycleCurrent(db: Firestore, uid: string, now: Date = new Date()): Promise<PlanLifecycleSnapshot> {
  const ref = planDataRef(db, uid);
  const snap = await ref.get();
  if (!snap.exists) return NEVER_INITIALIZED_SNAPSHOT;

  const planData = snap.data() as PlanData;
  const basePlan = resolveBaseCommercialPlan(planData);
  const trialActiveNow = isTrialCurrentlyActive(planData, now);
  const effectivePlan = trialActiveNow ? PLANS.PREMIUM : basePlan;

  // §22/§23 — rótulo armazenado só é "expired" quando ele dizia "active" e o relógio já passou de
  // trialEndsAt; `isTrialCurrentlyActive` já tinha detectado isso acima (não é uma segunda verificação
  // divergente, só a materialização do mesmo cálculo puro).
  const trialJustExpired = planData.trialStatus === "active" && !trialActiveNow;

  const lastApplied = planData.lastAppliedEffectivePlan ?? null;
  const transitioned = lastApplied !== effectivePlan;

  if (transitioned) {
    await reconcilePlanAccess(db, uid, lastApplied ?? effectivePlan, effectivePlan);
  }

  if (transitioned || trialJustExpired) {
    const update: Record<string, unknown> = { lastAppliedEffectivePlan: effectivePlan, lastLifecycleEvaluatedAt: now };
    if (trialJustExpired) update.trialStatus = "expired";
    await ref.set(update, { merge: true });
  }

  const trial: PlanLifecycleTrialSnapshot | null = planData.trialStatus
    ? {
        status: trialJustExpired ? "expired" : planData.trialStatus,
        startedAt: toEntitlementDate(planData.trialStartedAt)?.toISOString() ?? null,
        endsAt: toEntitlementDate(planData.trialEndsAt)?.toISOString() ?? null,
      }
    : null;

  return { basePlan, effectivePlan, trial };
}
