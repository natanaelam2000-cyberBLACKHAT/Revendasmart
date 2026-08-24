/**
 * RELEASE V1 §4.1 — mecanismo ÚNICO de identificação de admin/dev, reaproveitado por toda a
 * plataforma (rotas de admin já existentes em routes.ts, o novo endpoint de status, e o gate de
 * Anúncios Pro em marketing-pro.ts). Fonte de verdade: Firebase custom claim `admin` (definido
 * server-side via `firebase auth:set:custom-claims`), nunca UID/e-mail hardcoded no client, nunca
 * query param/localStorage como autoridade. O fallback de e-mail legado é o MESMO mecanismo de
 * migração que já existia em routes.ts antes desta tarefa — só foi movido para cá para poder ser
 * reaproveitado sem import circular (routes.ts já importa de marketing-pro.ts).
 */
import type { NextFunction, Request, Response } from "express";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { logError, logInfo, logWarn } from "./logger";

// MIGRAÇÃO: lista temporária (será removida quando todos os admins tiverem a custom claim definida).
// Definir via: firebase auth:set:custom-claims uid --custom-claims '{"admin": true}'
const ADMIN_UIDS_LEGACY = new Set<string>([
  "natanaelam2000@gmail.com",
]);

export async function isAdminUid(uid: string): Promise<boolean> {
  const admin = getFirebaseAdmin();
  const userRecord = await admin.auth().getUser(uid);
  if (userRecord.customClaims?.["admin"] === true) return true;
  if (ADMIN_UIDS_LEGACY.has(userRecord.email || "")) {
    logWarn("admin_auth.legacy_email_fallback_used", { message: "MIGRATION: using legacy email check — set custom claim to remove fallback" });
    return true;
  }
  return false;
}

/** Middleware Express — usar depois de `requireAuth` (precisa de `req.firebaseUid` já resolvido). */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const firebaseUid = (req as Request & { firebaseUid?: string }).firebaseUid;
  if (!firebaseUid) {
    res.status(401).json({ error: "Unauthorized: could not verify admin status" });
    return;
  }
  try {
    const granted = await isAdminUid(firebaseUid);
    if (granted) {
      logInfo("admin_auth.access_granted", { requestId: req.requestId });
      next();
      return;
    }
    logWarn("admin_auth.access_denied", { requestId: req.requestId });
    res.status(403).json({ error: "Forbidden: admin access required" });
  } catch (e) {
    logError("admin_auth.check_failed", e, { requestId: req.requestId });
    res.status(401).json({ error: "Unauthorized: could not verify admin status" });
  }
}
