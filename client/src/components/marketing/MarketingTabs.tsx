import { History, Megaphone, Sparkles } from "lucide-react";
import type { MarketingWorkspaceView } from "@/lib/marketing-flow";

/**
 * Três áreas do Marketing: criar, premium e histórico.
 *
 * A navegação anterior abria em "Visão geral" — uma tela de resumo que o lojista precisava atravessar
 * antes de conseguir criar qualquer coisa. Aqui a aba padrão já é a de trabalho, e o seletor é uma
 * faixa compacta: alvo de toque confortável, mas sem os cards grandes que empurravam o fluxo real
 * para baixo da dobra no celular.
 *
 * A cor ativa sai do tema do app (`primary`), nunca de um valor fixo.
 */
const TABS: { id: MarketingWorkspaceView; label: string; icon: typeof History }[] = [
  { id: "editor", label: "Criar anúncio", icon: Megaphone },
  { id: "pro", label: "Anúncio Pro", icon: Sparkles },
  { id: "history", label: "Histórico", icon: History },
];

type Props = {
  activeView: MarketingWorkspaceView;
  onChange: (view: MarketingWorkspaceView) => void;
  /** RELEASE V1 §4.2: Anúncios Pro ainda está em desenvolvimento — a aba só aparece para admin/dev
   * autorizado (fail-closed: `false`/indefinido esconde, nunca mostra por omissão). */
  showProTab?: boolean;
};

export function MarketingTabs({ activeView, onChange, showProTab = false }: Props) {
  const visibleTabs = showProTab ? TABS : TABS.filter((tab) => tab.id !== "pro");
  return (
    <nav aria-label="Áreas do Marketing" data-testid="marketing-tabs" className={`grid gap-1 rounded-2xl bg-secondary/60 p-1 ${visibleTabs.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
      {visibleTabs.map((tab) => {
        const Icon = tab.icon;
        const active = activeView === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-current={active ? "page" : undefined}
            data-testid={`tab-marketing-${tab.id}`}
            className={[
              "flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-xl px-1.5 text-[11px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
              active ? "bg-white text-primary shadow-sm" : "text-muted-foreground",
            ].join(" ")}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {/* Quebra em duas linhas em vez de truncar: a 320 px "Criar anúncio" não cabe numa linha
                só, e um rótulo cortado é pior do que um rótulo em duas linhas. */}
            <span className="text-center leading-[1.1]">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
