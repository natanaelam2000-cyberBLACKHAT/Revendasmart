import type { ReactNode } from "react";
import { Wallet } from "lucide-react";
import { MARKETING_AD_THEMES, MARKETING_AD_THEME_IDS, type MarketingAdThemeId } from "@/lib/marketing-ad";

/**
 * Personalização do anúncio — cor, informações exibidas, preço, chamada e pagamento.
 *
 * Cada decisão visual morava num bloco próprio: os temas numa grade de cards altos dentro do seletor
 * de templates, as opções em caixas de seleção espalhadas, o preço e o CTA em campos soltos. Aqui
 * tudo vira uma seção só, separada por divisórias leves em vez de novos cartões.
 *
 * Nenhum controle novo foi inventado: são exatamente os campos que o gerador de anúncio já consome.
 * Não existe toggle de "mostrar preço" ou "mostrar selo" porque esses elementos não são opcionais no
 * contrato atual da arte, e "sob encomenda" não aparece porque a disponibilidade é derivada do
 * estoque do produto, não escolhida à mão.
 */
type Props = {
  themeId: MarketingAdThemeId;
  /** Cor primária da loja — é ela que o tema "Marca da loja" usa de fato na arte. */
  brandAccent: string;
  /** Preço que está indo para a arte agora, já formatado por formatMarketingPrice. */
  priceText: string;
  priceOverride: string;
  note: string;
  ctaText: string;
  showBrand: boolean;
  showVolume: boolean;
  showStockStatus: boolean;
  showWhatsAppCta: boolean;
  includePayment: boolean;
  hasPaymentConfiguration: boolean;
  onThemeChange: (theme: MarketingAdThemeId) => void;
  onUseThemeAsDefault: () => void;
  onPriceChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onCtaChange: (value: string) => void;
  onShowBrandChange: (value: boolean) => void;
  onShowVolumeChange: (value: boolean) => void;
  onShowStockStatusChange: (value: boolean) => void;
  onShowWhatsAppCtaChange: (value: boolean) => void;
  onIncludePaymentChange: (value: boolean) => void;
  onConfigurePayment: () => void;
  extensionSlot?: ReactNode;
};

const fieldLabel = "text-[11px] font-bold text-muted-foreground";
const fieldInput = "w-full rounded-xl border border-border bg-secondary/20 px-3 py-2.5 text-sm text-foreground";

function ToggleChip({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      data-testid={`chip-marketing-${label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "-")}`}
      className={[
        "rs-pressable min-h-9 rounded-full border px-3 text-[11px] font-bold transition",
        checked ? "border-primary bg-primary/10 text-primary" : "border-border/60 bg-white text-muted-foreground",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

export function MarketingEditor({
  themeId,
  brandAccent,
  priceText,
  priceOverride,
  note,
  ctaText,
  showBrand,
  showVolume,
  showStockStatus,
  showWhatsAppCta,
  includePayment,
  hasPaymentConfiguration,
  onThemeChange,
  onUseThemeAsDefault,
  onPriceChange,
  onNoteChange,
  onCtaChange,
  onShowBrandChange,
  onShowVolumeChange,
  onShowStockStatusChange,
  onShowWhatsAppCtaChange,
  onIncludePaymentChange,
  onConfigurePayment,
  extensionSlot,
}: Props) {
  return (
    <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3" data-testid="marketing-editor">
      <div className="min-w-0">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <p className={fieldLabel}>Cor do anúncio</p>
          <button type="button" onClick={onUseThemeAsDefault} className="rounded text-[10px] font-black text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
            Usar como padrão
          </button>
        </div>
        <div className="-mx-1 flex gap-2 overflow-x-auto hide-scrollbar px-1 pb-1" role="group" aria-label="Cor do anúncio">
          {MARKETING_AD_THEME_IDS.map((id) => {
            const item = MARKETING_AD_THEMES[id];
            const active = themeId === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onThemeChange(id)}
                aria-pressed={active}
                data-testid={`button-marketing-theme-${id}`}
                className="rs-pressable flex w-14 shrink-0 flex-col items-center gap-1"
              >
                <span
                  className={[
                    "h-8 w-8 rounded-full border-2 transition",
                    active ? "border-primary ring-2 ring-primary/25" : "border-white shadow-sm",
                  ].join(" ")}
                  style={{ background: id === "brand" ? brandAccent : item.accent }}
                />
                <span className={`text-center text-[9px] font-bold leading-[1.1] ${active ? "text-primary" : "text-muted-foreground"}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-w-0 border-t border-border/50 pt-3">
        <p className={`${fieldLabel} mb-1.5`}>Mostrar no anúncio</p>
        <div className="flex flex-wrap gap-1.5">
          <ToggleChip label="Marca" checked={showBrand} onChange={onShowBrandChange} />
          <ToggleChip label="Volume" checked={showVolume} onChange={onShowVolumeChange} />
          <ToggleChip label="Disponibilidade" checked={showStockStatus} onChange={onShowStockStatusChange} />
        </div>
      </div>

      <div className="min-w-0 border-t border-border/50 pt-3">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <p className={fieldLabel}>Preço</p>
          <span className="text-xs font-black text-foreground" data-testid="marketing-current-price">{priceText}</span>
        </div>
        <input
          type="number"
          inputMode="decimal"
          enterKeyHint="next"
          aria-label="Preço especial (opcional)"
          placeholder="Preço especial (opcional). Ex.: 89,90"
          className={fieldInput}
          value={priceOverride}
          onChange={(event) => onPriceChange(event.target.value)}
          min="0.01"
          max="999999"
          step="0.01"
          data-testid="input-price-override"
        />
        <input
          type="text"
          maxLength={110}
          aria-label="Nota curta"
          placeholder="Nota curta. Ex.: só hoje ou frete grátis"
          className={`${fieldInput} mt-2`}
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
        />
      </div>

      <div className="min-w-0 border-t border-border/50 pt-3">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <p className={fieldLabel}>Chamada para ação</p>
          <ToggleChip label="Mostrar botão" checked={showWhatsAppCta} onChange={onShowWhatsAppCtaChange} />
        </div>
        <input
          type="text"
          maxLength={80}
          aria-label="Texto da chamada para ação"
          className={fieldInput}
          value={ctaText}
          onChange={(event) => onCtaChange(event.target.value)}
          disabled={!showWhatsAppCta}
        />
      </div>

      <div className="min-w-0 border-t border-border/50 pt-3">
        <label className="flex min-h-9 items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-[11px] font-bold text-muted-foreground">
            <Wallet className="h-3.5 w-3.5 text-primary" /> Mostrar forma de pagamento
          </span>
          <input type="checkbox" checked={includePayment} disabled={!hasPaymentConfiguration} onChange={(event) => onIncludePaymentChange(event.target.checked)} className="h-5 w-5 accent-primary disabled:opacity-40" />
        </label>
        {!hasPaymentConfiguration && (
          <button type="button" onClick={onConfigurePayment} className="mt-1 text-[10px] font-bold text-primary underline underline-offset-4">
            Configure PIX ou link de pagamento na loja
          </button>
        )}
      </div>

      {extensionSlot}
    </section>
  );
}
