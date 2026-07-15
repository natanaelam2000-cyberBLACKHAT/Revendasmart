import { Copy, Download, MessageSquare, Trash2, WandSparkles } from "lucide-react";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { PageSkeleton } from "@/components/PageSkeleton";
import type { MarketingHistoryEntry } from "@/hooks/useMarketingHistory";

const labels = { generated: "Card gerado", downloaded: "Card baixado", copied: "Anúncio copiado", shared: "Compartilhado no WhatsApp", edited: "Anúncio editado", duplicated: "Anúncio duplicado" };
const entryDate = (entry: MarketingHistoryEntry) => entry.createdAt?.toDate?.() || new Date(entry.createdAtISO);
const dayLabel = (entry: MarketingHistoryEntry) => {
  const date = entryDate(entry), today = new Date(), yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Hoje";
  if (date.toDateString() === yesterday.toDateString()) return "Ontem";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
};
type Props = { entries: MarketingHistoryEntry[]; loading: boolean; onCopy: (e: MarketingHistoryEntry) => void; onShare: (e: MarketingHistoryEntry) => void; onDownload: (e: MarketingHistoryEntry) => void; onRemove: (id: string) => void; onClear: () => void; onCreate?: () => void; onEdit?: (e: MarketingHistoryEntry) => void; onTheme?: (e: MarketingHistoryEntry) => void; onDuplicate?: (e: MarketingHistoryEntry) => void; };

export function MarketingHistoryPanel({ entries, loading, onCopy, onShare, onDownload, onRemove, onClear, onCreate, onEdit, onTheme, onDuplicate }: Props) {
  if (loading) return <PageSkeleton variant="list" />;
  if (!entries.length) return <div className="mh-empty"><div className="mh-empty-icon"><WandSparkles /></div><h3>Nenhum histórico de Marketing</h3><p>Gere, copie, compartilhe ou baixe um card para registrar suas ações aqui.</p>{onCreate && <button onClick={onCreate} className="mh-create"><WandSparkles />Gerar anúncio</button>}</div>;
  let previousDay = "";
  return <div className="mh-list"><div className="mh-clear-row"><ConfirmActionDialog title="Limpar histórico" description="Deseja limpar todo o histórico de Marketing? Essa ação não pode ser desfeita." confirmLabel="Limpar" onConfirm={onClear} trigger={<button className="mh-clear"><Trash2 />Limpar histórico</button>} /></div>{entries.map(entry => {
    const day = dayLabel(entry), showDay = day !== previousDay; previousDay = day;
    return <div key={entry.id}>{showDay && <p className="mh-day">{day}</p>}<article className="mh-card"><div className="mh-head"><div className="mh-ok">✓</div><div className="mh-copy"><p>{labels[entry.action]}</p><span>{entry.productName}{entry.productBrand ? ` · ${entry.productBrand}` : ""}</span><small>{entryDate(entry).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}{entry.themeId ? ` · tema ${entry.themeId}` : ""}</small></div><ConfirmActionDialog description="Deseja remover este registro do histórico? Essa ação não pode ser desfeita." confirmLabel="Remover" onConfirm={() => onRemove(entry.id)} trigger={<button className="mh-remove" aria-label="Excluir registro"><Trash2 /></button>} /></div><div className="mh-actions">{onEdit && <button onClick={() => onEdit(entry)}><WandSparkles />Editar anúncio</button>}{onTheme && <button className="mh-primary" onClick={() => onTheme(entry)}><WandSparkles />Trocar tema</button>}{onDuplicate && <button onClick={() => onDuplicate(entry)}><Copy />Duplicar</button>}<button className="mh-whatsapp" onClick={() => onShare(entry)}><MessageSquare />Compartilhar</button><button className="mh-primary" onClick={() => onDownload(entry)}><Download />Baixar novamente</button><button onClick={() => onCopy(entry)}><Copy />Copiar</button></div></article></div>;
  })}</div>;
}
