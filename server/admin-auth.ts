/**
 * RELEASE V1 §4.1 — mecanismo ÚNICO de identificação de admin/dev, reaproveitado por toda a
 * plataforma (rotas de admin já existentes em routes.ts, o novo endpoint de status, e o gate de
 * Anúncios Pro em marketing-pro.ts). Fonte de verdade: Firebase custom claim `admin` (definido
 * server-side via `firebase auth:set:custom-claims`), nunca UID/e-mail hardcoded no client, nunca
 * query param/localStorage como autoridade. E-mail, mesmo verificado, nunca concede privilégios.
 */
import type { NextFunction, Request, Response } from "express";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { logError, logInfo, logWarn } from "./logger";

export async function isAdminUid(uid: string): Promise<boolean> {
  const admin = getFirebaseAdmin();
  const userRecord = await admin.auth().getUser(uid);
  return userRecord.disabled !== true && userRecord.customClaims?.["admin"] === true;
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
