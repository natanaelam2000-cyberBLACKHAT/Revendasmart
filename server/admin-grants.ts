/**
 * REVENDASMART-OWNER-ACCESS-02 — concessões internas (TESTER / PREMIUM_PLUS), separadas do plano
 * comercial (`planData/main`, nunca tocado por este módulo). Fonte de verdade: `users/{uid}/
 * internalGrants/main`, lido/escrito só via Admin SDK — mesmo padrão de `planData` (sem regra própria
 * em firestore.rules porque não existe caminho de leitura/escrita direta pelo client SDK; tudo passa
 * por estas rotas, atrás de `requireAdmin`).
 */
import type { Express, NextFunction, Request, Response } from "express";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { requireAdmin, isAdminUid } from "./admin-auth";
import { logInfo, logWarn } from "./logger";
import {
  BENEFIT_GRANTS,
  DEFAULT_INTERNAL_GRANT,
  isBenefitGrant,
  isGrantAuditAction,
  resolveEntitlements,
  type BenefitGrant,
  type GrantAuditAction,
  type InternalGrantData,
  type PlanData,
} from "../shared/monetization";

const ADMIN_GRANT_ERROR_MESSAGES = {
  UNAUTHORIZED: "Sessão inválida. Faça login novamente.",
  FORBIDDEN: "Apenas administradores podem executar esta ação.",
  SELF_ELEVATION_BLOCKED: "Um admin não pode alterar as próprias concessões por esta rota.",
  INVALID_EMAIL: "Informe um e-mail válido.",
  USER_NOT_FOUND: "Nenhuma conta encontrada com este e-mail.",
  INVALID_ACTION: "Ação inválida.",
  ACTION_NOOP: "Este usuário já está neste estado.",
  GRANT_UPDATE_FAILED: "Não foi possível atualizar a concessão. Tente novamente.",
} as const;

type AdminGrantErrorCode = keyof typeof ADMIN_GRANT_ERROR_MESSAGES;

function sendAdminGrantError(res: Response, status: number, code: AdminGrantErrorCode): void {
  res.status(status).json({ code, message: ADMIN_GRANT_ERROR_MESSAGES[code] });
}

function internalGrantRef(db: FirebaseFirestore.Firestore, uid: string) {
  return db.collection("users").doc(uid).collection("internalGrants").doc("main");
}

export async function getInternalGrant(db: FirebaseFirestore.Firestore, uid: string): Promise<InternalGrantData> {
  const snapshot = await internalGrantRef(db, uid).get();
  if (!snapshot.exists) return DEFAULT_INTERNAL_GRANT;
  const data = snapshot.data() as Partial<InternalGrantData> | undefined;
  return {
    benefitGrant: isBenefitGrant(data?.benefitGrant) ? data!.benefitGrant : "none",
    grantedBy: typeof data?.grantedBy === "string" ? data.grantedBy : null,
    grantedAt: data?.grantedAt ?? null,
    reason: typeof data?.reason === "string" ? data.reason : null,
    updatedAt: data?.updatedAt ?? null,
  };
}

/**
 * Único ponto de composição server-side: busca `planData` + `internalGrants` e devolve a decisão final
 * via `resolveEntitlements` (shared/monetization.ts) — a MESMA função usada pelo client sobre o payload
 * de `/api/plan/data/:userId`, para nunca divergir sobre "quem tem acesso Premium".
 */
export async function resolveUserEntitlements(db: FirebaseFirestore.Firestore, uid: string) {
  const [planDoc, grant] = await Promise.all([
    db.collection("users").doc(uid).collection("planData").doc("main").get(),
    getInternalGrant(db, uid),
  ]);
  const planData = planDoc.exists ? (planDoc.data() as PlanData) : null;
  return { entitlements: resolveEntitlements(planData, grant), grant, planData };
}

async function writeGrantAuditLog(
  db: FirebaseFirestore.Firestore,
  entry: {
    actorUid: string;
    targetUid: string;
    action: GrantAuditAction;
    previousState: BenefitGrant;
    newState: BenefitGrant;
    reason: string | null;
  },
): Promise<void> {
  const admin = getFirebaseAdmin();
  await db.collection("adminGrantAuditLog").add({
    ...entry,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/** GRANT_TESTER/REVOKE_TESTER/GRANT_PREMIUM_PLUS/REVOKE_PREMIUM_PLUS -> estado alvo. Nunca aceita o
 * estado direto do client — só a AÇÃO, o servidor decide o `benefitGrant` resultante. */
function targetStateForAction(action: GrantAuditAction): BenefitGrant {
  switch (action) {
    case "GRANT_TESTER": return BENEFIT_GRANTS.TESTER;
    case "GRANT_PREMIUM_PLUS": return BENEFIT_GRANTS.PREMIUM_PLUS;
    case "REVOKE_TESTER":
    case "REVOKE_PREMIUM_PLUS":
      return BENEFIT_GRANTS.NONE;
  }
}

export function registerAdminGrantRoutes(
  app: Express,
  requireAuth: (req: Request, res: Response, next: NextFunction) => void,
): void {
  // GET /api/admin/users/lookup?email= — busca uma conta por e-mail (Auth, não Firestore: nenhum
  // índice novo necessário) e devolve a visão composta (role/benefício/plano comercial/expiração).
  app.get("/api/admin/users/lookup", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const email = typeof req.query.email === "string" ? req.query.email.trim() : "";
    if (!email || !email.includes("@")) {
      return sendAdminGrantError(res, 400, "INVALID_EMAIL");
    }
    try {
      const admin = getFirebaseAdmin();
      const db = admin.firestore();
      const authUser = await admin.auth().getUserByEmail(email).catch(() => null);
      if (!authUser) return sendAdminGrantError(res, 404, "USER_NOT_FOUND");

      const [{ entitlements, grant, planData }, isTargetAdmin] = await Promise.all([
        resolveUserEntitlements(db, authUser.uid),
        isAdminUid(authUser.uid),
      ]);

      return res.status(200).json({
        uid: authUser.uid,
        email: authUser.email,
        role: isTargetAdmin ? "admin" : "user",
        benefitGrant: grant.benefitGrant,
        grantedBy: grant.grantedBy,
        grantedAt: grant.grantedAt,
        reason: grant.reason,
        commercialPlan: planData?.currentPlan ?? "free",
        commercialPremiumActive: planData ? entitlements.source === "commercial" : false,
        premiumExpiresAt: planData?.premiumExpiresAt ?? null,
        hasPremiumAccess: entitlements.hasPremiumAccess,
        source: entitlements.source,
      });
    } catch (error) {
      logWarn("admin_grants.lookup_failed", { message: error instanceof Error ? error.message : String(error) });
      return sendAdminGrantError(res, 500, "GRANT_UPDATE_FAILED");
    }
  });

  // GET /api/admin/testers/count — total de contas com benefitGrant == tester. Só referência
  // operacional (§10 do ticket) — nunca um limite técnico rígido no backend.
  app.get("/api/admin/testers/count", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const db = getFirebaseAdmin().firestore();
      const snapshot = await db.collectionGroup("internalGrants")
        .where("benefitGrant", "==", BENEFIT_GRANTS.TESTER)
        .count()
        .get();
      return res.status(200).json({ count: snapshot.data().count });
    } catch (error) {
      logWarn("admin_grants.tester_count_failed", { message: error instanceof Error ? error.message : String(error) });
      return sendAdminGrantError(res, 500, "GRANT_UPDATE_FAILED");
    }
  });

  // POST /api/admin/grants/:targetUid — única rota de mutação. `targetUid` vem SEMPRE da URL (resolvida
  // no lookup acima, nunca de um campo `role`/`benefitGrant` enviado pelo client), a ação decide o
  // estado resultante (nunca um valor arbitrário vindo do body).
  app.post("/api/admin/grants/:targetUid", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const actorUid = (req as Request & { firebaseUid?: string }).firebaseUid;
    const targetUid = req.params.targetUid;
    const { action, reason } = req.body ?? {};

    if (!actorUid) return sendAdminGrantError(res, 401, "UNAUTHORIZED");
    if (!targetUid || typeof targetUid !== "string") return sendAdminGrantError(res, 400, "INVALID_ACTION");
    if (!isGrantAuditAction(action)) return sendAdminGrantError(res, 400, "INVALID_ACTION");

    // §12/§13: "ninguém pode se autoelevar" — inclusive um admin sobre a própria conta, por esta rota.
    if (actorUid === targetUid) return sendAdminGrantError(res, 403, "SELF_ELEVATION_BLOCKED");

    try {
      const db = getFirebaseAdmin().firestore();
      const ref = internalGrantRef(db, targetUid);
      const admin = getFirebaseAdmin();

      const result = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const current: BenefitGrant = snapshot.exists && isBenefitGrant(snapshot.data()?.benefitGrant)
          ? (snapshot.data()!.benefitGrant as BenefitGrant)
          : "none";
        const nextState = targetStateForAction(action);

        // REVOKE_TESTER só derruba um grant que hoje É tester (idem PREMIUM_PLUS) — evita que revogar
        // tester apague um Premium+ concedido por engano, e vice-versa (nunca overwrite cego).
        if ((action === "REVOKE_TESTER" && current !== "tester")
          || (action === "REVOKE_PREMIUM_PLUS" && current !== "premium_plus")) {
          return { noop: true as const, current };
        }
        if ((action === "GRANT_TESTER" && current === "tester")
          || (action === "GRANT_PREMIUM_PLUS" && current === "premium_plus")) {
          return { noop: true as const, current };
        }

        transaction.set(ref, {
          benefitGrant: nextState,
          grantedBy: nextState === "none" ? null : actorUid,
          grantedAt: nextState === "none" ? null : admin.firestore.FieldValue.serverTimestamp(),
          reason: nextState === "none" ? null : (typeof reason === "string" ? reason.slice(0, 300) : null),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return { noop: false as const, current, next: nextState };
      });

      if (result.noop) {
        return sendAdminGrantError(res, 409, "ACTION_NOOP");
      }

      await writeGrantAuditLog(db, {
        actorUid,
        targetUid,
        action,
        previousState: result.current,
        newState: result.next,
        reason: typeof reason === "string" ? reason.slice(0, 300) : null,
      });

      logInfo("admin_grants.mutated", { actorUid, targetUid, action });
      return res.status(200).json({ success: true, targetUid, benefitGrant: result.next });
    } catch (error) {
      logWarn("admin_grants.mutation_failed", { message: error instanceof Error ? error.message : String(error) });
      return sendAdminGrantError(res, 500, "GRANT_UPDATE_FAILED");
    }
  });
}
