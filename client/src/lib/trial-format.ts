export function formatTrialDaysRemaining(endsAt: string | null): string | null {
  if (!endsAt) return null;
  const endsAtMs = new Date(endsAt).getTime();
  if (!Number.isFinite(endsAtMs)) return null;
  const daysRemaining = Math.max(0, Math.ceil((endsAtMs - Date.now()) / (24 * 60 * 60 * 1000)));
  return daysRemaining <= 0 ? "Último dia" : `Restam ${daysRemaining} dia${daysRemaining === 1 ? "" : "s"}`;
}
