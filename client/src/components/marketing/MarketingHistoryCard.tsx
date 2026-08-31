import { useState } from "react";
import { Copy, Download, ImageOff, MessageSquare, MoreVertical, Palette, Pencil, Trash2 } from "lucide-react";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { ProductImageCard } from "@/components/ProductImageCard";
import { resolveMarketingTemplate } from "@/lib/marketing-ad";
import { MARKETING_PRO_CREATIVE_FAMILY_LABELS } from "@/lib/marketing-pro-creative-family-labels";
import type { MarketingHistoryEntry } from "@/hooks/useMarketingHistory";

const ACTION_LABELS: Record<string, string> = {
  generated: "Card gerado",
  downloaded: "Card baixado",
  copied: "Anúncio copiado",
  shared: "Compartilhado",
  edited: "Anúncio editado",
  duplicated: "Anúncio duplicado",
};

/**
 * MINIATURA — decisão consciente de arquitetura.
 *
 * O ideal seria mostrar o PNG real do card, mas isso exigiria persistir a arte em Storage (P0-B),
 * que está fora do escopo. Em vez de renderizar 200 canvas na lista (caro em memória e CPU no
 * celular), a miniatura usa a FOTO DO PRODUTO que a própria entrada já guarda — mesmo dado, custo
 * quase zero, e o ProductImageCard ainda resolve `imageId` com cache compartilhado entre os cards.
 *
 * Quando não há foto alguma, o lugar da miniatura vira um selo com a cor do anúncio: identifica a
 * entrada sem inventar uma imagem que não existe.
 */
function EntryThumbnail({ entry }: { entry: MarketingHistoryEntry }) {
  const imageSource = {
    imageUrl: entry.imageUrl || entry.productImageUrl,
    photoUrl: entry.photoUrl,
    image: entry.image,
    imageId: entry.imageId,
  };
  const hasAnyImage = Boolean(imageSource.imageUrl || imageSource.photoUrl || imageSource.image || imageSource.imageId);

  if (!hasAnyImage) {
    return (
      <div
        className="flex h-full w-full flex-col items-center justify-center gap-1 text-white"
        style={{ backgroundColor: entry.primaryColor || "#ec4899" }}
        aria-label="Anúncio sem foto do produto"
      >
        <ImageOff className="h-4 w-4 opacity-80" />
        <span className="text-[8px] font-bold uppercase tracking-wide opacity-90">sem foto</span>
      </div>
    );
  }
  return <ProductImageCard product={imageSource} size="sm" objectFit="cover" className="!rounded-none !border-0" />;
}

interface MarketingHistoryCardProps {
  entry: MarketingHistoryEntry;
  /** Produto sumiu do catálogo — o anúncio continua utilizável, mas editar exige escolher outro. */
  productMissing: boolean;
  busy: boolean;
  onShare: (entry: MarketingHistoryEntry) => void;
  onDownload: (entry: MarketingHistoryEntry) => void;
  onCopy: (entry: MarketingHistoryEntry) => void;
  onEdit?: (entry: MarketingHistoryEntry) => void;
  onTheme?: (entry: MarketingHistoryEntry) => void;
  onDuplicate?: (entry: MarketingHistoryEntry) => void;
  onRemove: (id: string) => void;
}

export function MarketingHistoryCard({
  entry, productMissing, busy, onShare, onDownload, onCopy, onEdit, onTheme, onDuplicate, onRemove,
}: MarketingHistoryCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  // ADS-PRO-03 §16 — entrada do Anúncios Pro (composer canônico + library), distinta do editor clássico.
  // resolveMarketingTemplate nunca é chamada para ela: um valor como "pro-ad" não é um MarketingTemplateId
  // real, e o rótulo certo para Pro é a creativeFamily, não um template clássico.
  const isPro = entry.mode === "pro";
  const template = isPro ? null : resolveMarketingTemplate(entry.templateId || entry.template);
  const proFamilyLabel = isPro && entry.creativeFamily ? MARKETING_PRO_CREATIVE_FAMILY_LABELS[entry.creativeFamily as keyof typeof MARKETING_PRO_CREATIVE_FAMILY_LABELS] : undefined;
  const date = entry.createdAt?.toDate?.() || new Date(entry.createdAtISO);
  const timeLabel = Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const runAndClose = (action: () => void) => { setMenuOpen(false); action(); };

  return (
    <article className="relative rounded-2xl border border-border/60 bg-white p-3 shadow-sm" data-testid={`marketing-history-card-${entry.id}`}>
      <div className="flex gap-3">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-border/50 bg-secondary/30">
          <EntryThumbnail entry={entry} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 truncate text-sm font-bold leading-tight text-foreground">{entry.productName || "Produto"}</p>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              disabled={busy}
              aria-label="Mais ações"
              aria-expanded={menuOpen}
              data-testid={`button-history-menu-${entry.id}`}
              className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground disabled:opacity-40"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {isPro ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary" data-testid={`badge-history-pro-${entry.id}`}>
                ✨ Pro{proFamilyLabel ? ` · ${proFamilyLabel}` : ""}
              </span>
            ) : (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                {template!.emoji} {template!.label}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">{ACTION_LABELS[entry.action] || entry.action}</span>
            {timeLabel && <span className="text-[10px] text-muted-foreground">· {timeLabel}</span>}
          </div>

          {/* Estado especial: o anúncio segue compartilhável, mas o produto não existe mais. Mensagem
              em português comum, nunca a exceção técnica. */}
          {productMissing && (
            <p className="mt-1.5 rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800">
              Produto não está mais no catálogo
            </p>
          )}

          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => onShare(entry)}
              disabled={busy}
              data-testid={`button-history-share-${entry.id}`}
              className="rs-pressable flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#25d366] px-3 text-[11px] font-bold text-white disabled:opacity-50"
            >
              <MessageSquare className="h-3.5 w-3.5" /> Compartilhar
            </button>
            <button
              type="button"
              onClick={() => onDownload(entry)}
              disabled={busy}
              data-testid={`button-history-download-${entry.id}`}
              className="rs-pressable flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-primary/25 bg-white px-3 text-[11px] font-bold text-primary disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" /> Baixar
            </button>
          </div>
        </div>
      </div>

      {menuOpen && (
        <>
          {/* Camada de fechamento: toque fora fecha o menu sem exigir um segundo toque no botão. */}
          <button type="button" className="fixed inset-0 z-10 cursor-default" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-3 top-11 z-20 w-44 overflow-hidden rounded-xl border border-border/60 bg-white py-1 shadow-lg" role="menu">
            {/* ADS-PRO-03 §17 — editar/trocar tema/duplicar/copiar texto pressupõem o editor clássico
                (reescrevem `entry` via normalizeMarketingAdConfig, que não entende campos Pro); nunca
                mostrados para um registro Pro. Não é escopo deste ticket implementar os equivalentes. */}
            {onEdit && !isPro && (
              <button type="button" role="menuitem" disabled={busy} onClick={() => runAndClose(() => onEdit(entry))} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-foreground hover:bg-secondary/50 disabled:opacity-40">
                <Pencil className="h-3.5 w-3.5" /> Editar
              </button>
            )}
            {onTheme && !isPro && (
              <button type="button" role="menuitem" disabled={busy} onClick={() => runAndClose(() => onTheme(entry))} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-foreground hover:bg-secondary/50 disabled:opacity-40">
                <Palette className="h-3.5 w-3.5" /> Trocar tema
              </button>
            )}
            {onDuplicate && !isPro && (
              <button type="button" role="menuitem" disabled={busy} onClick={() => runAndClose(() => onDuplicate(entry))} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-foreground hover:bg-secondary/50 disabled:opacity-40">
                <Copy className="h-3.5 w-3.5" /> Duplicar
              </button>
            )}
            {!isPro && (
              <button type="button" role="menuitem" disabled={busy} onClick={() => runAndClose(() => onCopy(entry))} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-foreground hover:bg-secondary/50 disabled:opacity-40">
                <Copy className="h-3.5 w-3.5" /> Copiar texto
              </button>
            )}
            <ConfirmActionDialog
              description="Deseja remover este registro do histórico? Essa ação não pode ser desfeita."
              confirmLabel="Remover"
              onConfirm={() => runAndClose(() => onRemove(entry.id))}
              trigger={
                <button type="button" role="menuitem" disabled={busy} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-destructive hover:bg-destructive/5 disabled:opacity-40">
                  <Trash2 className="h-3.5 w-3.5" /> Excluir
                </button>
              }
            />
          </div>
        </>
      )}
    </article>
  );
}
