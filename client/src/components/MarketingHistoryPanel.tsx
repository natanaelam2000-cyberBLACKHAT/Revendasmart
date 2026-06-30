import { Copy, Download, MessageSquare, Sparkles, Trash2 } from "lucide-react";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { PageSkeleton } from "@/components/PageSkeleton";
import type { MarketingHistoryEntry } from "@/hooks/useMarketingHistory";

const labels = { generated: "Card gerado", downloaded: "Card baixado", copied: "Anúncio copiado", shared: "Compartilhado no WhatsApp" };
const dayLabel = (entry: MarketingHistoryEntry) => {
  const date = entry.createdAt?.toDate?.() || new Date(entry.createdAtISO);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Hoje";
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Ontem";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
};

export function MarketingHistoryPanel({ entries, loading, onCopy, onShare, onDownload, onRemove, onClear }:{ entries:MarketingHistoryEntry[];loading:boolean;onCopy:(e:MarketingHistoryEntry)=>void;onShare:(e:MarketingHistoryEntry)=>void;onDownload:(e:MarketingHistoryEntry)=>void;onRemove:(id:string)=>void;onClear:()=>void; }) {
  if (loading) return <PageSkeleton variant="list" />;
  if (!entries.length) return <div className="rounded-3xl border border-dashed border-border bg-white p-10 text-center"><Sparkles className="mx-auto mb-3 h-10 w-10 text-primary/30"/><h3 className="font-black">Nenhuma ação registrada</h3><p className="mt-2 text-xs text-muted-foreground">Gere, copie, compartilhe ou baixe um card para iniciar seu histórico.</p></div>;
  let previousDay="";
  return <div className="space-y-4"><div className="flex justify-end"><ConfirmActionDialog title="Limpar histórico" description="Deseja limpar todo o histórico de Marketing? Essa ação não pode ser desfeita." confirmLabel="Limpar" onConfirm={onClear} trigger={<button className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[10px] font-bold text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5"/>Limpar histórico</button>} /></div>{entries.map(entry=>{const day=dayLabel(entry);const showDay=day!==previousDay;previousDay=day;return <div key={entry.id}>{showDay&&<p className="mb-2 px-1 text-xs font-black text-muted-foreground">{day}</p>}<article className="rounded-2xl border border-border/60 bg-white p-4 shadow-sm"><div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-green-50 text-green-600">✓</div><div className="min-w-0 flex-1"><p className="text-sm font-black">{labels[entry.action]}</p><p className="truncate text-xs text-muted-foreground">{entry.productName}{entry.productBrand?` · ${entry.productBrand}`:""}</p><p className="mt-1 text-[10px] text-muted-foreground">{(entry.createdAt?.toDate?.()||new Date(entry.createdAtISO)).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</p></div><ConfirmActionDialog description="Deseja remover este registro do histórico? Essa ação não pode ser desfeita." confirmLabel="Remover" onConfirm={()=>onRemove(entry.id)} trigger={<button className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-red-50 hover:text-red-600" aria-label="Excluir registro"><Trash2 className="h-4 w-4"/></button>} /></div><div className="mt-3 grid grid-cols-3 gap-2 border-t border-border/40 pt-3"><button onClick={()=>onShare(entry)} className="flex items-center justify-center gap-1 rounded-xl bg-green-50 px-2 py-2 text-[9px] font-bold text-green-700"><MessageSquare className="h-3.5 w-3.5"/>Compartilhar</button><button onClick={()=>onDownload(entry)} className="flex items-center justify-center gap-1 rounded-xl bg-primary/10 px-2 py-2 text-[9px] font-bold text-primary"><Download className="h-3.5 w-3.5"/>Baixar</button><button onClick={()=>onCopy(entry)} className="flex items-center justify-center gap-1 rounded-xl bg-secondary px-2 py-2 text-[9px] font-bold"><Copy className="h-3.5 w-3.5"/>Copiar</button></div></article></div>;})}</div>;
}
