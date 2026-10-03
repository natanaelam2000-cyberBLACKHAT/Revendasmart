const key = (uid: string) => `rs:onboarding-draft:${uid}`;
export function readOnboardingDraft(uid: string): Record<string, unknown> | null {
  try { const raw = localStorage.getItem(key(uid)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function writeOnboardingDraft(uid: string, payload: Record<string, unknown> | null) {
  try { if (payload) localStorage.setItem(key(uid), JSON.stringify(payload)); else localStorage.removeItem(key(uid)); return true; } catch { return false; }
}
