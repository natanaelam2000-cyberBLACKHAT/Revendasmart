import { Info, WandSparkles } from "lucide-react";
import { MarketingAdCanvas } from "@/components/MarketingAdCanvas";
import type { MarketingAdConfig } from "@/lib/marketing-ad";
import type { ResolvedMarketingImage } from "@/lib/marketing-image";

type Props = {
  config: MarketingAdConfig | null;
  resolvedImage: ResolvedMarketingImage | null;
  imageStatus: "idle" | "resolving" | "ready" | "error";
  editing: boolean;
  showWhatsappSetupNotice: boolean;
  hasWhatsapp: boolean;
  hasProducts: boolean;
  onCtaClick: () => void;
  onConfigureWhatsapp: () => void;
  onCreateProduct: () => void;
};

export function MarketingPreview({
  config,
  resolvedImage,
  imageStatus,
  editing,
  showWhatsappSetupNotice,
  hasWhatsapp,
  hasProducts,
  onCtaClick,
  onConfigureWhatsapp,
  onCreateProduct,
}: Props) {
  return (
    <section className="grid gap-3" data-testid="marketing-preview">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[.18em] text-primary">4. Confira</p>
        <h2 className="mt-1 text-base font-black">Preview do anúncio</h2>
      </div>

      {!config ? (
        <div className="flex min-h-64 flex-col items-center justify-center rounded-[1.75rem] border border-dashed border-border bg-white p-8 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10"><Info className="h-7 w-7 text-primary/50" /></div>
          <p className="mt-4 text-sm font-black">Escolha um produto ou kit</p>
          <p className="mt-2 max-w-xs text-xs leading-5 text-muted-foreground">O preview, o texto e as ações de exportação aparecerão aqui.</p>
          {!hasProducts && <button type="button" onClick={onCreateProduct} className="mt-4 rounded-xl bg-primary px-4 py-3 text-xs font-bold text-white">Cadastrar produto</button>}
        </div>
      ) : (
        <>
          {editing && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">Editando um anúncio salvo. O histórico só muda quando você confirmar.</div>}
          <div className="rounded-[1.75rem] border border-border/60 bg-white p-3 shadow-sm">
            <MarketingAdCanvas config={config} onCtaClick={onCtaClick} resolvedImage={resolvedImage} imageStatus={imageStatus} />
          </div>
          {showWhatsappSetupNotice && !hasWhatsapp && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900" role="status">
              <p>Cadastre o WhatsApp da sua loja para receber pedidos por este card.</p>
              <button type="button" onClick={onConfigureWhatsapp} className="mt-2 underline underline-offset-4" data-testid="button-configure-store-whatsapp">Configurar WhatsApp da loja</button>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            {["Foto limpa", "Preço visível", "CTA direto"].map((tip) => (
              <div key={tip} className="flex items-center gap-2 rounded-xl bg-primary/5 p-3 text-[10px] font-bold text-primary"><WandSparkles className="h-3.5 w-3.5" />{tip}</div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
