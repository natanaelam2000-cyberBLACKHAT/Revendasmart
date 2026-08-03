import type { ReactNode } from "react";
import { Wallet } from "lucide-react";

type Props = {
  priceOverride: string;
  note: string;
  ctaText: string;
  showBrand: boolean;
  showVolume: boolean;
  showStockStatus: boolean;
  showWhatsAppCta: boolean;
  includePayment: boolean;
  hasPaymentConfiguration: boolean;
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

export function MarketingEditor({
  priceOverride,
  note,
  ctaText,
  showBrand,
  showVolume,
  showStockStatus,
  showWhatsAppCta,
  includePayment,
  hasPaymentConfiguration,
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
  const options = [
    { label: "Marca", checked: showBrand, change: onShowBrandChange },
    { label: "Volume", checked: showVolume, change: onShowVolumeChange },
    { label: "Estoque", checked: showStockStatus, change: onShowStockStatusChange },
    { label: "Chamada (CTA)", checked: showWhatsAppCta, change: onShowWhatsAppCtaChange },
  ];

  return (
    <section className="grid gap-4 rounded-[1.75rem] border border-border/60 bg-white p-4 shadow-sm sm:p-5" data-testid="marketing-editor">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[.18em] text-primary">3. Personalize</p>
        <h2 className="mt-1 text-base font-black">Conteúdo do anúncio</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">Todos os campos são manuais e ficam disponíveis no plano gratuito.</p>
      </div>

      <div className="grid gap-3">
        <label className="grid gap-2 text-xs font-bold text-muted-foreground">
          Preço especial (opcional)
          <input
            type="number"
            inputMode="decimal"
            enterKeyHint="next"
            placeholder="Ex.: 89,90"
            className="w-full rounded-xl border border-border bg-secondary/20 p-3 text-sm text-foreground"
            value={priceOverride}
            onChange={(event) => onPriceChange(event.target.value)}
            min="0.01"
            max="999999"
            step="0.01"
            data-testid="input-price-override"
          />
        </label>
        <label className="grid gap-2 text-xs font-bold text-muted-foreground">
          Nota curta
          <input type="text" maxLength={110} placeholder="Ex.: Só hoje ou frete grátis" className="w-full rounded-xl border border-border bg-secondary/20 p-3 text-sm text-foreground" value={note} onChange={(event) => onNoteChange(event.target.value)} />
        </label>
        <label className="grid gap-2 text-xs font-bold text-muted-foreground">
          Chamada (CTA)
          <input type="text" maxLength={80} className="w-full rounded-xl border border-border bg-secondary/20 p-3 text-sm text-foreground" value={ctaText} onChange={(event) => onCtaChange(event.target.value)} />
        </label>
      </div>

      <fieldset>
        <legend className="mb-2 text-xs font-bold text-muted-foreground">Mostrar no anúncio</legend>
        <div className="grid grid-cols-2 gap-2">
          {options.map((option) => (
            <label key={option.label} className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-secondary/30 px-3 text-[11px] font-bold text-muted-foreground">
              {option.label}
              <input type="checkbox" checked={option.checked} onChange={(event) => option.change(event.target.checked)} className="h-4 w-4 accent-primary" />
            </label>
          ))}
        </div>
      </fieldset>

      <div className="rounded-xl border border-border/60 bg-secondary/20 p-3">
        <label className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-xs font-bold text-muted-foreground"><Wallet className="h-4 w-4 text-primary" /> Mostrar forma de pagamento</span>
          <input type="checkbox" checked={includePayment} disabled={!hasPaymentConfiguration} onChange={(event) => onIncludePaymentChange(event.target.checked)} className="h-5 w-5 accent-primary disabled:opacity-40" />
        </label>
        {!hasPaymentConfiguration && (
          <button type="button" onClick={onConfigurePayment} className="mt-2 text-[10px] font-bold text-primary underline underline-offset-4">
            Configure PIX ou link de pagamento na loja
          </button>
        )}
      </div>

      {extensionSlot}
    </section>
  );
}
