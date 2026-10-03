import { getApiUrl } from "@/lib/api-config";
import { getFirebaseAuth } from "@/lib/firebase";
import { notifyError, notifySuccess } from "@/lib/notify";

export async function saveMonthlyGoal(
  monthlyGoalInput: string,
  settings: Record<string, any>,
  onSaved: () => void
): Promise<boolean> {
  const nextGoal = Number(monthlyGoalInput);
  if (!Number.isFinite(nextGoal) || nextGoal <= 0) {
    notifyError("Informe uma meta válida.");
    return false;
  }
  const user = getFirebaseAuth()?.currentUser;
  if (!user) {
    notifyError("Sessão expirada. Faça login novamente.");
    return false;
  }

  const token = await user.getIdToken();
  const response = await fetch(getApiUrl(`/api/user/settings/${user.uid}`), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...settings, monthlyGoal: nextGoal }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  notifySuccess("Meta mensal salva.");
  onSaved();
  return true;
}
