type SessionStorage = Pick<Storage, "setItem" | "removeItem">;

/** Compatibility key for local UI helpers only; Firebase remains the authentication authority. */
export function mirrorAuthenticatedUid(uid: string | null, storage?: SessionStorage): void {
  try {
    const target = storage ?? globalThis.localStorage;
    if (uid) target.setItem("rs:session", uid);
    else target.removeItem("rs:session");
  } catch { /* Unavailable local storage cannot invent or replace a Firebase session. */ }
}
