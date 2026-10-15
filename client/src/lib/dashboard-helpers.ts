import { notifyError } from "./notify";

const HOME_ONBOARDING_STRIP_STORAGE_KEY = "revendasmart:home:onboarding-strip:v1";

// Sem guard de `typeof window`: fora do browser o acesso lança e cai no mesmo catch.
export function readOnboardingStripDismissed(): boolean {
  try {
    return window.localStorage.getItem(HOME_ONBOARDING_STRIP_STORAGE_KEY) === "dismissed";
  } catch {
    return false;
  }
}

export function writeOnboardingStripDismissed(): void {
  try {
    window.localStorage.setItem(HOME_ONBOARDING_STRIP_STORAGE_KEY, "dismissed");
  } catch {
    // localStorage can be unavailable (SSR, private mode or restricted WebViews).
  }
}

/** Owns the lazy import as well as loading cleanup, so import failures are retryable. */
export async function runSaveMonthlyGoal(
  input: string,
  settings: Record<string, any>,
  onSaved: () => void,
  setSaving: (saving: boolean) => void,
  load: () => Promise<typeof import("./save-monthly-goal")> = () => import("./save-monthly-goal"),
): Promise<void> {
  setSaving(true);
  try {
    const { saveMonthlyGoal } = await load();
    await saveMonthlyGoal(input, settings, onSaved);
  } catch (error) {
    console.error("[dashboard] Failed to save monthly goal:", error);
    notifyError("Erro ao salvar meta mensal.");
  } finally {
    setSaving(false);
  }
}
