import { History, LayoutDashboard, WandSparkles } from "lucide-react";
import type { MarketingWorkspaceView } from "@/lib/marketing-flow";

type Props = {
  activeView: MarketingWorkspaceView;
  onChange: (view: MarketingWorkspaceView) => void;
};

const items = [
  { id: "hub", label: "Visão geral", icon: LayoutDashboard },
  { id: "editor", label: "Criar anúncio", icon: WandSparkles },
  { id: "history", label: "Histórico", icon: History },
] as const;

export function MarketingWorkspaceNav({ activeView, onChange }: Props) {
  return (
    <nav aria-label="Áreas do Marketing" className="grid grid-cols-3 gap-2 rounded-2xl bg-secondary/55 p-1.5">
      {items.map((item) => {
        const Icon = item.icon;
        const active = activeView === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={[
              "flex min-h-12 items-center justify-center gap-2 rounded-xl px-2 text-[11px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
              active ? "bg-white text-primary shadow-sm" : "text-muted-foreground hover:bg-white/60",
            ].join(" ")}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
