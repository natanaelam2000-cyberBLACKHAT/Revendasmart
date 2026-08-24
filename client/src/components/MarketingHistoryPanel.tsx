import { Trash2, WandSparkles } from "lucide-react";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { PageSkeleton } from "@/components/PageSkeleton";
import { MarketingHistoryCard } from "@/components/marketing/MarketingHistoryCard";
import type { MarketingHistoryEntry } from "@/hooks/useMarketingHistory";

const entryDate = (entry: MarketingHistoryEntry) => entry.createdAt?.toDate?.() || new Date(entry.createdAtISO);

const dayLabel = (entry: MarketingHistoryEntry) => {
  const date = entryDate(entry), today = new Date(), yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (Number.isNaN(date.getTime())) return "Anúncios salvos";
  if (date.toDateString() === today.toDateString()) return "Hoje";
  if (date.toDateString() === yesterday.toDateString()) return "Ontem";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
};

type Props = {
  entries: MarketingHistoryEntry[];
  loading: boolean;
  onCopy: (e: MarketingHistoryEntry) => void;
  onShare: (e: MarketingHistoryEntry) => void;
  onDownload: (e: MarketingHistoryEntry) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onCreate?: () => void;
  onEdit?: (e: MarketingHistoryEntry) => void;
  onTheme?: (e: MarketingHistoryEntry) => void;
  onDuplicate?: (e: MarketingHistoryEntry) => void;
  /** `${entryId}:${operacao}` da ação em andamento — trava os botões para evitar execução dupla. */
  busyActionId?: string | null;
  /** Ids de produto que ainda existem no catálogo; usado para sinalizar anúncio órfão. */
  availableProductIds?: ReadonlySet<string>;
};

export function MarketingHistoryPanel({
  entries, loading, onCopy, onShare, onDownload, onRemove, onClear, onCreate, onEdit, onTheme, onDuplicate, busyActionId, availableProductIds,
}: Props) {
  // Um toque duplo em "Compartilhar"/"Baixar" gerava DOIS arquivos e DUAS entradas de historico para
  // a mesma intencao. Enquanto uma acao roda, todas as demais ficam desabilitadas.
  const isBusy = Boolean(busyActionId);

  if (loading) return <PageSkeleton variant="list" />;

  if (!entries.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border/60 bg-white px-6 py-12 text-center" data-testid="marketing-history-empty">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <WandSparkles className="h-6 w-6 text-primary/50" />
        </div>
        <h3 className="text-sm font-black text-foreground">Nenhum anúncio ainda</h3>
        <p className="mx-auto mt-1.5 max-w-[280px] text-xs leading-relaxed text-muted-foreground">
          Crie seu primeiro anúncio para compartilhar com seus clientes. Ele fica salvo aqui para reusar quando quiser.
        </p>
        {onCreate && (
          <button type="button" onClick={onCreate} data-testid="button-create-first-ad" className="rs-pressable mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-white">
            <WandSparkles className="h-4 w-4" /> Criar anúncio
          </button>
        )}
      </div>
    );
  }

  let previousDay = "";
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3" data-testid="marketing-history-list">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold text-muted-foreground">
          {entries.length} {entries.length === 1 ? "anúncio salvo" : "anúncios salvos"}
        </p>
        <ConfirmActionDialog
          title="Limpar histórico"
          description="Deseja limpar todo o histórico de anúncios? Essa ação não pode ser desfeita."
          confirmLabel="Limpar"
          onConfirm={onClear}
          trigger={
            <button type="button" disabled={isBusy} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold text-muted-foreground disabled:opacity-40">
              <Trash2 className="h-3.5 w-3.5" /> Limpar
            </button>
          }
        />
      </div>

      {entries.map((entry) => {
        const day = dayLabel(entry);
        const showDay = day !== previousDay;
        previousDay = day;
        return (
          <div key={entry.id} className="grid gap-2">
            {showDay && <p className="px-1 text-[10px] font-black uppercase tracking-wide text-muted-foreground">{day}</p>}
            <MarketingHistoryCard
              entry={entry}
              // Sem a lista de produtos carregada não dá para afirmar que sumiu — nesse caso não
              // sinalizamos nada, para nunca acusar ausência que não foi verificada.
              productMissing={Boolean(availableProductIds && entry.productId && !availableProductIds.has(entry.productId))}
              busy={isBusy}
              onShare={onShare}
              onDownload={onDownload}
              onCopy={onCopy}
              onEdit={onEdit}
              onTheme={onTheme}
              onDuplicate={onDuplicate}
              onRemove={onRemove}
            />
          </div>
        );
      })}
    </div>
  );
}
