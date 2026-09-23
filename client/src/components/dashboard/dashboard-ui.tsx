import type { ReactNode } from "react";

/**
 * HOTFIX-P0-D (rodada 2, code-split) — extraído de dashboard.tsx para que a seção de serviços
 * (client/src/components/dashboard/ServicesOverviewSection.tsx, lazy) possa reusar os mesmos 3
 * primitivos visuais sem precisar importar a PÁGINA dashboard.tsx inteira (o que anularia o
 * code-split, já que o chunk lazy voltaria a arrastar o chunk eager junto).
 */
export function SectionCard({ title, eyebrow, children, action }: { title: string; eyebrow?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-[1.5rem] border border-border/50 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">{eyebrow}</p>}
          <h2 className="mt-1 text-base font-black text-foreground">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function SummaryTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-2xl bg-secondary/35 p-3">
      <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-black text-foreground">{value}</p>
      {detail && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{detail}</p>}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-border/70 bg-secondary/20 px-4 py-5 text-sm font-semibold text-muted-foreground">{children}</div>;
}

export function shortNumber(value: number): string {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}
