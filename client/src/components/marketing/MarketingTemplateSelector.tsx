import { MARKETING_TEMPLATES, type MarketingTemplateId, type MarketingTemplateTier } from "@/lib/marketing-ad";

/**
 * Trilho horizontal com os templates REAIS do anúncio.
 *
 * Antes os dez templates ficavam empilhados numa grade de duas colunas, e logo abaixo vinha uma
 * segunda grade com os temas de cor — juntos ocupavam quase uma tela inteira de celular no meio do
 * fluxo. Agora os templates rolam lateralmente (scroll horizontal intencional) e a cor foi para a
 * seção de personalização, junto das demais decisões visuais.
 *
 * A lista sai inteira de MARKETING_TEMPLATES: nada é inventado para preencher o trilho.
 *
 * PRO-04: templates Pro continuam VISÍVEIS para todo mundo (é assim que o Free entende o valor do
 * plano), mas ficam com aria-disabled e um selo "PRO" quando `allowedTiers` não inclui a faixa deles.
 * Este componente nunca lê o plano da conta por conta própria — recebe só a lista de faixas já
 * resolvida por `pages/marketing.tsx`, o único lugar da árvore que sabe qual é o plano ativo.
 */
const TEMPLATE_ENTRIES = Object.entries(MARKETING_TEMPLATES) as [MarketingTemplateId, { label: string; emoji: string; tier: MarketingTemplateTier }][];

type Props = {
  template: MarketingTemplateId;
  v2TemplatesEnabled: boolean;
  allowedTiers: readonly MarketingTemplateTier[];
  onTemplateChange: (template: MarketingTemplateId) => void;
  onLockedTemplateTap?: (template: MarketingTemplateId) => void;
};

export function MarketingTemplateSelector({ template, v2TemplatesEnabled, allowedTiers, onTemplateChange, onLockedTemplateTap }: Props) {
  return (
    <div data-testid="marketing-template-selector">
      <div className="-mx-1 flex snap-x gap-2 overflow-x-auto hide-scrollbar px-1 pb-1">
        {TEMPLATE_ENTRIES.map(([id, item]) => {
          const active = template === id;
          const locked = !allowedTiers.includes(item.tier);
          return (
            <button
              key={id}
              type="button"
              onClick={() => (locked ? onLockedTemplateTap?.(id) : onTemplateChange(id))}
              aria-pressed={active}
              aria-disabled={locked}
              data-testid={`button-marketing-template-${id}`}
              data-locked={locked}
              className={[
                "rs-pressable relative flex min-h-[4.25rem] w-20 shrink-0 snap-start flex-col items-center justify-start gap-1 rounded-xl border px-1 py-2 transition",
                active ? "border-primary bg-primary/10 text-primary" : "border-border/60 bg-white text-muted-foreground",
                locked ? "opacity-60" : "",
              ].join(" ")}
            >
              {locked && (
                <span className="absolute -right-1 -top-1 rounded-full bg-amber-500 px-1 py-0.5 text-[8px] font-black leading-none text-white">
                  PRO
                </span>
              )}
              <span className="text-base leading-none">{item.emoji}</span>
              <span className="text-center text-[10px] font-bold leading-[1.15]">{item.label}</span>
            </button>
          );
        })}
      </div>
      {v2TemplatesEnabled && (
        <p className="mt-1.5 text-[10px] font-semibold text-muted-foreground">Novos templates visuais estão disponíveis neste mesmo editor.</p>
      )}
    </div>
  );
}
