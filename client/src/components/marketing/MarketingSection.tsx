import type { ReactNode } from "react";

/**
 * Passo do fluxo de criação de anúncio.
 *
 * O `min-w-0` na raiz não é cosmético. Como item de grid/flex, o tamanho mínimo automático da seção
 * é o min-content do seu conteúdo — e o trilho de templates tem 880px de min-content (10 botões de
 * 80px + gaps). Sem o `min-w-0`, essa seção dimensionava a coluna do pai em ~900px e a PÁGINA
 * inteira passava a rolar lateralmente no celular, mesmo com o trilho tendo overflow próprio.
 *
 * A tela antiga era uma pilha de cards autônomos, cada um repetindo seu próprio cabeçalho grande e
 * numeração solta — no celular o usuário rolava bastante sem entender onde estava na sequência.
 * Aqui o número vive num selo pequeno ao lado do título, o card é enxuto, e a ordem
 * Produto → Tipo → Personalização → Preview → Ações fica legível de relance.
 */
interface MarketingSectionProps {
  step: number;
  title: string;
  hint?: string;
  /** Conteúdo opcional alinhado à direita do cabeçalho (ex: botão "Trocar"). */
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
}

export function MarketingSection({ step, title, hint, action, children, testId }: MarketingSectionProps) {
  return (
    <section className="min-w-0 rounded-2xl border border-border/60 bg-white p-3.5 shadow-sm sm:p-4" data-testid={testId}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-black text-primary">
            {step}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-black leading-tight text-foreground">{title}</h2>
            {hint && <p className="mt-0.5 truncate text-[11px] leading-snug text-muted-foreground">{hint}</p>}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}
