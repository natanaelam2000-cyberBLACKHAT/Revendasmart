import { formatTrialDaysRemaining } from "@/lib/trial-format";

export default function TrialBanner({ trial }: { trial: { status: "active" | "expired" | "converted"; endsAt: string | null } }) {
  if (trial.status !== "active" || !trial.endsAt) return null;
  const daysRemainingLabel = formatTrialDaysRemaining(trial.endsAt);
  if (!daysRemainingLabel) return null;
  return (
    <section className="flex items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-white px-4 py-3 shadow-sm" data-testid="home-trial-banner">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-black text-foreground">Premium de teste ativo</p>
        <p className="text-xs text-muted-foreground">
          {daysRemainingLabel} · Nenhuma cobrança automática ao final.
        </p>
      </div>
    </section>
  );
}
