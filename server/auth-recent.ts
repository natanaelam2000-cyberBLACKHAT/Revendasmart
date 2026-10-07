import { hasRecentAuthentication } from "../shared/auth-security";

type Identity = { uid: string; auth_time: number };
export async function checkRecentIdentity(
  uid: string, authorization: string | undefined,
  verify: (token: string, checkRevoked: boolean) => Promise<Identity>,
): Promise<"UNAUTHENTICATED" | "REAUTH_REQUIRED" | null> {
  const token = authorization?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return "UNAUTHENTICATED";
  try {
    const decoded = await verify(token, true);
    return decoded.uid === uid && hasRecentAuthentication(decoded.auth_time) ? null : "REAUTH_REQUIRED";
  } catch { return "UNAUTHENTICATED"; }
}
