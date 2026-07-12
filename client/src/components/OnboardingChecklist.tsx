import type { LucideIcon } from "lucide-react";
import { CheckCircle2, ChevronDown, ChevronUp, X } from "lucide-react";

export type OnboardingChecklistItem = {
  id: string;
  label: string;
  description: string;
  done: boolean;
  path: string;
  icon: LucideIcon;
};

type OnboardingChecklistProps = {
  items: OnboardingChecklistItem[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onDismiss: () => void;
  onGoTo: (path: string) => void;
};

export function OnboardingChecklist({
  items,
  collapsed,
  onToggleCollapsed,
  onDismiss,
  onGoTo,
}: OnboardingChecklistProps) {
  const doneCount = items.filter((item) => item.done).length;
  const percent = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0;
  const nextItem = items.find((item) => !item.done) || items[0];

  return (
    <section className="rounded-[2rem] border border-primary/10 bg-gradient-to-br from-white via-primary/5 to-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Primeiros passos</p>
          <h2 className="mt-1 text-lg font-black tracking-tight text-foreground">Configure sua loja no seu ritmo</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Um guia rápido para deixar o Revenda Smart pronto sem bloquear seu uso.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="rs-icon-press flex h-9 w-9 items-center justify-center rounded-2xl bg-white text-muted-foreground shadow-sm"
            aria-label={collapsed ? "Expandir checklist" : "Recolher checklist"}
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rs-icon-press flex h-9 w-9 items-center justify-center rounded-2xl bg-white text-muted-foreground shadow-sm"
            aria-label="Ocultar checklist"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-[11px] font-bold text-muted-foreground">
          <span>{doneCount} de {items.length} concluídos</span>
          <span>{percent}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${percent}%` }} />
        </div>
      </div>

      {collapsed ? (
        nextItem && !nextItem.done && (
          <button
            type="button"
            onClick={() => onGoTo(nextItem.path)}
            className="mt-4 flex w-full items-center justify-between rounded-2xl bg-white p-3 text-left shadow-sm rs-pressable"
          >
            <span className="text-xs font-bold text-foreground">Próximo: {nextItem.label}</span>
            <span className="text-[10px] font-black uppercase tracking-wide text-primary">Abrir</span>
          </button>
        )
      ) : (
        <div className="mt-4 grid gap-2">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onGoTo(item.path)}
                className="flex items-center gap-3 rounded-2xl bg-white p-3 text-left shadow-sm transition-colors hover:bg-secondary/40"
              >
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${item.done ? "bg-emerald-50 text-emerald-600" : "bg-primary/10 text-primary"}`}>
                  {item.done ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black text-foreground">{item.label}</p>
                  <p className="truncate text-[10px] font-medium text-muted-foreground">{item.description}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black ${item.done ? "bg-emerald-50 text-emerald-700" : "bg-secondary text-muted-foreground"}`}>
                  {item.done ? "OK" : "Abrir"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
