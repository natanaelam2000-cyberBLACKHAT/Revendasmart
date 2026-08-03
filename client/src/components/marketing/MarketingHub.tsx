import { Copy, History, Megaphone, MessageSquare, QrCode, Store, WandSparkles } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { MarketingStats } from "@/components/MarketingStats";
import type { MarketingHistoryEntry } from "@/hooks/useMarketingHistory";

type Props = {
  productCount: number;
  historyEntries: MarketingHistoryEntry[];
  templateCount: number;
  catalogUrl: string;
  catalogCopied: boolean;
  onStart: () => void;
  onStartPromotion: () => void;
  onStartWhatsapp: () => void;
  onShowHistory: () => void;
  onCopyCatalog: () => void;
  onShareCatalog: () => void;
};

export function MarketingHub({
  productCount,
  historyEntries,
  templateCount,
  catalogUrl,
  catalogCopied,
  onStart,
  onStartPromotion,
  onStartWhatsapp,
  onShowHistory,
  onCopyCatalog,
  onShareCatalog,
}: Props) {
  return (
    <div className="grid gap-5" data-testid="marketing-hub">
      <section className="relative overflow-hidden rounded-[2rem] border border-primary/10 bg-gradient-to-br from-white via-primary/5 to-rose-50 p-5 shadow-sm sm:p-7">
        <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative grid gap-6 lg:grid-cols-[1.15fr_.85fr] lg:items-center">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[.2em] text-primary">Central de divulgação</p>
            <h1 className="mt-2 max-w-2xl text-2xl font-black tracking-tight text-foreground sm:text-3xl">
              Materiais profissionais para divulgar e vender
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Crie anúncios manualmente, compartilhe o catálogo e acompanhe seus materiais em um fluxo simples.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                [productCount, "produtos"],
                [historyEntries.length, "materiais"],
                [templateCount, "templates"],
                ["FREE", "editor manual"],
              ].map(([value, label]) => (
                <div key={String(label)} className="rounded-2xl border border-white/70 bg-white/85 p-3 shadow-sm">
                  <p className="text-lg font-black text-primary">{value}</p>
                  <p className="text-[10px] font-semibold text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-border/55 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Catálogo público</p>
                <p className="mt-1 break-words text-sm font-black">{catalogUrl || "Link ainda não configurado"}</p>
              </div>
              <div className="mx-auto rounded-2xl bg-white p-2 outline outline-1 outline-slate-200 sm:mx-0">
                {catalogUrl ? (
                  <QRCodeSVG value={catalogUrl} size={82} bgColor="#ffffff" fgColor="#0f172a" level="M" includeMargin />
                ) : (
                  <QrCode className="h-[82px] w-[82px] text-muted-foreground/30" />
                )}
              </div>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={onCopyCatalog} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-3 text-xs font-bold text-white">
                <Copy className="h-4 w-4" /> {catalogCopied ? "Link copiado" : "Copiar link"}
              </button>
              <button type="button" onClick={onShareCatalog} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#25d366] px-3 text-xs font-bold text-white">
                <MessageSquare className="h-4 w-4" /> WhatsApp
              </button>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3">
          <p className="text-[10px] font-black uppercase tracking-[.18em] text-primary">Comece por aqui</p>
          <h2 className="mt-1 text-lg font-black">O que você quer divulgar?</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {[
            { title: "Criar anúncio", detail: "Produto ou kit", icon: WandSparkles, action: onStart },
            { title: "Criar promoção", detail: "Oferta pronta", icon: Megaphone, action: onStartPromotion },
            { title: "Mensagem WhatsApp", detail: "Texto comercial", icon: MessageSquare, action: onStartWhatsapp },
            { title: "Compartilhar catálogo", detail: "Link da loja", icon: Store, action: onShareCatalog },
            { title: "Copiar QR Code", detail: "Link rápido", icon: QrCode, action: onCopyCatalog },
            { title: "Consultar histórico", detail: "Materiais recentes", icon: History, action: onShowHistory },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.title} type="button" onClick={item.action} className="rounded-2xl border border-border/60 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md">
                <Icon className="h-5 w-5 text-primary" />
                <p className="mt-3 text-xs font-black">{item.title}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">{item.detail}</p>
              </button>
            );
          })}
        </div>
      </section>

      <MarketingStats entries={historyEntries} />

      <section className="rounded-2xl border border-primary/10 bg-primary/5 p-4">
        <p className="text-xs font-black text-primary">Criação manual disponível para todos</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Produto, kit, templates, temas, texto, preview, PNG, compartilhamento e histórico não dependem de plano Premium.
        </p>
      </section>
    </div>
  );
}
