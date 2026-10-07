/** Token refresh does not change auth_time. Only an actual sign-in / reauthentication does. */
export function hasRecentAuthentication(authTime: unknown, nowMs = Date.now()): boolean {
  return typeof authTime === "number" && Number.isFinite(authTime) &&
    authTime * 1000 <= nowMs + 30_000 && nowMs - authTime * 1000 <= 5 * 60_000;
}
