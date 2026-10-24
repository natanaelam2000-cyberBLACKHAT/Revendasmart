import type { NextFunction, Request, Response } from "express";

type DecodedToken = { uid: string };

export type FirebaseAdminForRequestAuth = {
  auth(): {
    verifyIdToken(token: string, checkRevoked: boolean): Promise<DecodedToken>;
  };
  firestore(): {
    collection(name: string): {
      doc(id: string): {
        get(): Promise<{ exists: boolean }>;
      };
    };
  };
};

const INVALID_CREDENTIAL_CODES = new Set([
  "auth/argument-error",
  "auth/id-token-expired",
  "auth/id-token-revoked",
  "auth/invalid-id-token",
  "auth/user-disabled",
  "auth/user-not-found",
]);

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function isInvalidCredentialError(error: unknown): boolean {
  const code = errorCode(error);
  return code !== undefined && INVALID_CREDENTIAL_CODES.has(code);
}

function clearFirebaseUid(req: Request): void {
  delete (req as Request & { firebaseUid?: string }).firebaseUid;
}

/**
 * Builds the request-authentication middleware with an injectable Admin dependency.
 * Only Firebase Auth's documented token/account rejection codes become a 401. Every
 * other failure is fail-closed as an unavailable authentication dependency (503).
 */
export function createRequireAuth(getFirebaseAdmin: () => FirebaseAdminForRequestAuth) {
  return async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    clearFirebaseUid(req);

    const authorization = req.headers.authorization;
    if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized: missing token" });
      return;
    }

    const token = authorization.slice("Bearer ".length).trim();
    if (!token) {
      res.status(401).json({ error: "Unauthorized: missing token" });
      return;
    }

    let admin: FirebaseAdminForRequestAuth;
    let decoded: DecodedToken;
    try {
      admin = getFirebaseAdmin();
      // checkRevoked=true preserves the account disable/revocation control.
      decoded = await admin.auth().verifyIdToken(token, true);
    } catch (error) {
      if (isInvalidCredentialError(error)) {
        res.status(401).json({ error: "Unauthorized: invalid token" });
        return;
      }
      res.status(503).json({ error: "AUTH_SERVICE_UNAVAILABLE" });
      return;
    }

    if (typeof decoded.uid !== "string" || !decoded.uid) {
      res.status(503).json({ error: "AUTH_SERVICE_UNAVAILABLE" });
      return;
    }

    try {
      const deletionRequest = await admin.firestore()
        .collection("account_deletion_requests")
        .doc(decoded.uid)
        .get();
      const isDeletionRetry = req.method === "DELETE" && req.path === "/api/account";
      if (deletionRequest.exists && !isDeletionRetry) {
        res.status(403).json({ error: "Forbidden: account deletion is in progress" });
        return;
      }
    } catch {
      res.status(503).json({ error: "AUTH_SERVICE_UNAVAILABLE" });
      return;
    }

    (req as Request & { firebaseUid?: string }).firebaseUid = decoded.uid;
    next();
  };
}

/** Middleware for routes addressed by :userId; it must always follow requireAuth. */
export function createRequireOwnership(onMismatch: (firebaseUid: string, userId: string) => void) {
  return function requireOwnership(req: Request, res: Response, next: NextFunction): void {
    const firebaseUid = (req as Request & { firebaseUid?: string }).firebaseUid;
    const rawUserId = req.params.userId;
    const userId = Array.isArray(rawUserId) ? rawUserId[0] : rawUserId;

    if (!firebaseUid) {
      res.status(401).json({ error: "Unauthorized: missing verified identity" });
      return;
    }

    if (userId && firebaseUid !== userId) {
      onMismatch(firebaseUid, userId);
      res.status(403).json({ error: "Forbidden: you can only access your own data" });
      return;
    }

    next();
  };
}
