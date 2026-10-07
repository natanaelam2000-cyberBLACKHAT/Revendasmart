import type { Express, NextFunction, Request, Response } from "express";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import type { Bucket } from "@google-cloud/storage";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { logError, logInfo, logWarn } from "./logger";
import { checkRecentIdentity } from "./auth-recent";

type RequireAuth = (req: Request, res: Response, next: NextFunction) => unknown;

export const ACCOUNT_DELETION_COLLECTION = "account_deletion_requests";

export class AccountDeletionBlockedError extends Error {
  constructor(readonly reason: "ACTIVE_SUBSCRIPTION" | "ACTIVE_MERCADOPAGO_CONNECTION") {
    super(reason);
    this.name = "AccountDeletionBlockedError";
  }
}

export interface AccountDeletionDependencies {
  db: Firestore;
  auth: Auth;
  bucket: Bucket;
  now: () => Date;
}

function isSubscriptionBlocking(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  const status = String(data.subscriptionStatus ?? "").trim().toLowerCase();
  const hasExternalSubscription = typeof data.subscriptionId === "string" && data.subscriptionId.length > 0;
  if (!hasExternalSubscription) return false;
  return !["cancelled", "canceled", "paused", "rejected", "expired"].includes(status);
}

async function assertExternalIntegrationsInactive(db: Firestore, uid: string): Promise<void> {
  const userRef = db.collection("users").doc(uid);
  const [plan, connections] = await Promise.all([
    userRef.collection("planData").doc("main").get(),
    userRef.collection("mercadopago_connections").get(),
  ]);
  if (isSubscriptionBlocking(plan.data())) throw new AccountDeletionBlockedError("ACTIVE_SUBSCRIPTION");
  if (connections.docs.some((doc) => String(doc.data().status ?? "active") !== "revoked")) {
    throw new AccountDeletionBlockedError("ACTIVE_MERCADOPAGO_CONNECTION");
  }
}

/**
 * RELEASE-28: cleanup do schema LEGADO de referral (`user_settings.referred_users` — array de UIDs na
 * conta do REFERRER — e os contadores `referral_conversions`/`reward_eligible_conversions` que andam
 * em lockstep com ele, gravados juntos na mesma transação em server/routes.ts `/api/user/settings`).
 *
 * Diferente do schema atual (`referralEvents`/`validatedReferrals`, já limpo abaixo por UID próprio),
 * este é um array dentro do documento de OUTRO usuário — quem foi indicado nunca sabe/guarda quem
 * indicou usando este campo; é o REFERRER que guarda a lista de quem ele indicou. Por isso a exclusão
 * de `uid` (quando `uid` foi o INDICADO) deixava `uid` para sempre na lista de outro usuário, e o
 * contador desse outro usuário nunca refletia a perda.
 *
 * `array-contains` é uma query de campo único — não precisa de índice composto novo.
 */
async function cleanupLegacyReferrerReferences(db: Firestore, uid: string): Promise<void> {
  const [referrerDocs, referredUserDocs] = await Promise.all([
    db.collection("user_settings").where("referred_users", "array-contains", uid).get(),
    db.collection("user_settings").where("referral_source", "==", uid).get(),
  ]);
  await Promise.all([
    ...referrerDocs.docs.map((doc) => doc.ref.update({
      referred_users: FieldValue.arrayRemove(uid),
      // These counters are historical eligibility totals and must remain monotonic. Only the
      // user list is scrubbed, so deletion removes unnecessary PII without recycling a milestone.
    })),
    ...referredUserDocs.docs
      .filter((doc) => doc.id !== uid)
      .map((doc) => doc.ref.update({
        referral_source: FieldValue.delete(),
        referral_applied_at: FieldValue.delete(),
        referral_applied_by: FieldValue.delete(),
        referral_immutable: FieldValue.delete(),
      })),
  ]);
}

async function deleteRootReferences(db: Firestore, uid: string): Promise<void> {
  // RELEASE-17: os campos REAIS gravados por /api/referral/track-event e /api/referral/validate-referral
  // (server/routes.ts) são `referredUID`/`referrerUID` (UID maiúsculo) — tanto em `referralEvents` quanto
  // em `planData/main/validatedReferrals/{referredUid}`. Não existe nenhuma escrita de produção com o
  // casing `referredUid`/`referrerUid` (confirmado por busca no código-fonte); por isso não há
  // compatibilidade legada a preservar aqui — só o schema real.
  const [eventsByReferrer, eventsByReferred, oauthStates, slugReservations] = await Promise.all([
    db.collection("referralEvents").where("referrerUID", "==", uid).get(),
    db.collection("referralEvents").where("referredUID", "==", uid).get(),
    db.collection("mercadopago_oauth_states").where("uid", "==", uid).get(),
    db.collection("public_catalog_slugs").where("ownerUid", "==", uid).get(),
    cleanupLegacyReferrerReferences(db, uid),
  ]);
  const referralEvents = new Map([...eventsByReferrer.docs, ...eventsByReferred.docs].map((doc) => [doc.ref.path, doc]));
  const validationReferences = Array.from(referralEvents.values()).flatMap((doc) => {
    const data = doc.data();
    const referrerUid = typeof data.referrerUID === "string" ? data.referrerUID : "";
    const referredUid = typeof data.referredUID === "string" ? data.referredUID : "";
    return referrerUid && referredUid
      ? [db.doc(`users/${referrerUid}/planData/main/validatedReferrals/${referredUid}`).delete()]
      : [];
  });
  await Promise.all([
    ...Array.from(referralEvents.values()).map((doc) => doc.ref.delete()),
    ...validationReferences,
    ...oauthStates.docs.map((doc) => doc.ref.delete()),
    ...slugReservations.docs.map((doc) => doc.ref.delete()),
    db.collection("user_settings").doc(uid).delete(),
    db.collection("admin_users").doc(uid).delete(),
  ]);
}

function isAuthNotFound(error: unknown): boolean {
  return typeof (error as { code?: unknown })?.code === "string" &&
    (error as { code: string }).code === "auth/user-not-found";
}

/**
 * Destructive server-only workflow. The caller must supply an authenticated UID;
 * no ownership value is accepted from a request body.
 */
export async function deleteAccountByUid(uid: string, deps: AccountDeletionDependencies): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error("INVALID_AUTHENTICATED_UID");
  await assertExternalIntegrationsInactive(deps.db, uid);

  const requestRef = deps.db.collection(ACCOUNT_DELETION_COLLECTION).doc(uid);
  await requestRef.set({
    status: "deleting",
    requestedAt: deps.now(),
    updatedAt: deps.now(),
  }, { merge: true });

  try {
    await deleteRootReferences(deps.db, uid);
    await deps.db.recursiveDelete(deps.db.collection("users").doc(uid));
    await deps.bucket.deleteFiles({ prefix: `users/${uid}/`, force: true });
    // Keep a minimal server-owned tombstone. Firestore/Storage Rules and requireAuth consult it so an
    // already-issued ID token cannot recreate data during its remaining token lifetime.
    await requestRef.set({ status: "auth_pending", dataDeletedAt: deps.now(), updatedAt: deps.now() }, { merge: true });
    try {
      await deps.auth.deleteUser(uid);
    } catch (error) {
      if (!isAuthNotFound(error)) throw error;
    }
  } catch (error) {
    await requestRef.set({ status: "failed", updatedAt: deps.now() }, { merge: true }).catch(() => undefined);
    throw error;
  }
}

export function createAccountDeletionDependencies(): AccountDeletionDependencies {
  const admin = getFirebaseAdmin();
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET?.trim();
  return {
    db: admin.firestore(),
    auth: admin.auth(),
    bucket: admin.storage().bucket(bucketName || undefined),
    now: () => new Date(),
  };
}

export function registerAccountDeletionRoutes(app: Express, requireAuth: RequireAuth): void {
  app.delete("/api/account", requireAuth, async (req: Request, res: Response) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!uid) return res.status(401).json({ error: { code: "UNAUTHENTICATED", requestId: req.requestId } });

    // Enforce freshness on the server before any destructive write. A refreshed old token is not
    // proof of recent authentication, and neither a client timestamp nor a body UID is trusted.
    const identityError = await checkRecentIdentity(uid, req.headers.authorization,
      (token, checkRevoked) => getFirebaseAdmin().auth().verifyIdToken(token, checkRevoked));
    if (identityError) {
      return res.status(identityError === "REAUTH_REQUIRED" ? 403 : 401).json({
        error: { code: identityError, message: "Confirme sua identidade novamente antes de excluir a conta.", requestId: req.requestId },
      });
    }

    try {
      await deleteAccountByUid(uid, createAccountDeletionDependencies());
      logInfo("account_deletion.completed", { uid, requestId: req.requestId });
      return res.status(200).json({ deleted: true, requestId: req.requestId });
    } catch (error) {
      if (error instanceof AccountDeletionBlockedError) {
        logWarn("account_deletion.blocked", { uid, reason: error.reason, requestId: req.requestId });
        return res.status(409).json({
          error: {
            code: error.reason,
            message: error.reason === "ACTIVE_SUBSCRIPTION"
              ? "Cancele a assinatura ativa antes de excluir a conta."
              : "Desconecte sua conta Mercado Pago antes de excluir a conta.",
            requestId: req.requestId,
          },
        });
      }
      logError("account_deletion.failed", error, { uid, requestId: req.requestId });
      return res.status(500).json({
        error: { code: "ACCOUNT_DELETION_FAILED", message: "A exclusão não foi concluída. Tente novamente.", requestId: req.requestId },
      });
    }
  });
}
