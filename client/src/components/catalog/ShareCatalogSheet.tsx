import { Check, Copy, Instagram, Megaphone, Send, Share2, X } from "lucide-react";
import { useDismissibleOnBack } from "@/hooks/useDismissibleOnBack";

interface ShareCatalogSheetProps {
  open: boolean;
  onClose: () => void;
  catalogUrl: string;
  hasCatalogSlug: boolean;
  copied: boolean;
  onCopyLink: () => void;
  onShareWhatsApp: () => void;
  onShareInstagram: () => void;
}

export function ShareCatalogSheet({ open, onClose, catalogUrl, hasCatalogSlug, copied, onCopyLink, onShareWhatsApp, onShareInstagram }: ShareCatalogSheetProps) {
  useDismissibleOnBack(open, onClose);

  if (!open) return null;

  const options = [
    { testId: "button-share-whatsapp", onClick: onShareWhatsApp, tone: "green", icon: <Send className="h-5 w-5 text-green-600" />, label: "WhatsApp", desc: "Enviar para contatos pelo WhatsApp" },
    { testId: "button-share-instagram", onClick: onShareInstagram, tone: "pink", icon: <Instagram className="h-5 w-5 text-pink-600" />, label: "Instagram", desc: "Compartilhar nos stories ou direct" },
    {
      testId: "button-share-copy-link", onClick: onCopyLink, tone: "primary",
      icon: copied ? <Check className="h-5 w-5 text-primary" /> : <Copy className="h-5 w-5 text-primary" />,
      label: copied ? "Copiado" : "Copiar link", desc: "Copiar o link para compartilhar",
      title: catalogUrl, "aria-label": `Copiar link completo: ${catalogUrl}`,
    },
  ] as const;

  const toneClass: Record<string, string> = {
    green: "border-green-100 bg-green-50",
    pink: "border-pink-100 bg-pink-50",
    primary: "border-primary/15 bg-primary/5",
  };
  const toneText: Record<string, string> = { green: "text-green-800", pink: "text-pink-800", primary: "text-primary" };
  const toneDesc: Record<string, string> = { green: "text-green-700/80", pink: "text-pink-700/80", primary: "text-primary/70" };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Compartilhar catálogo">
      <div className="rs-sheet-enter w-full max-w-sm space-y-5 rounded-t-[1.5rem] bg-white px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Share2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold tracking-tight">Compartilhar Catálogo</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">Divulgue seu catálogo e aumente suas vendas!</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <button onClick={onClose} className="rs-icon-press flex h-8 w-8 items-center justify-center rounded-full bg-secondary" aria-label="Fechar compartilhamento"><X className="h-4 w-4" /></button>
            <Megaphone className="h-9 w-9 text-primary/70" aria-hidden="true" />
          </div>
        </div>

        {hasCatalogSlug ? (
          <>
            <div>
              <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Compartilhar via</p>
              <div className="grid grid-cols-3 gap-2">
                {options.map((option) => (
                  <button
                    key={option.testId}
                    type="button"
                    onClick={option.onClick}
                    title={"title" in option ? option.title : undefined}
                    aria-label={"aria-label" in option ? option["aria-label"] : undefined}
                    className={`rs-pressable flex flex-col items-start gap-1.5 rounded-2xl border p-3 text-left ${toneClass[option.tone]}`}
                    data-testid={option.testId}
                  >
                    {option.icon}
                    <span className={`text-[11px] font-bold ${toneText[option.tone]}`}>{option.label}</span>
                    <span className={`text-[9px] leading-tight ${toneDesc[option.tone]}`}>{option.desc}</span>
                  </button>
                ))}
              </div>
            </div>
            {copied && <p className="text-[11px] font-semibold text-green-600" role="status" aria-live="polite">Link copiado</p>}
          </>
        ) : (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4" data-testid="catalog-share-slug-missing">
            <p className="text-sm font-semibold text-amber-800">Seu catálogo ainda não tem um link configurado.</p>
            <p className="mt-1 text-xs text-amber-700">Vá em Configurações e salve o nome da sua loja para gerar o link público antes de compartilhar.</p>
            <a href="/settings" className="rs-pressable mt-3 inline-flex min-h-11 items-center justify-center rounded-2xl bg-amber-600 px-4 text-xs font-semibold text-white">Ir para Configurações</a>
          </div>
        )}
      </div>
    </div>
  );
}
