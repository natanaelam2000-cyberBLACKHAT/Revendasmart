import { Check, Search, UserPlus, X } from "lucide-react";
import { useDismissibleOnBack } from "@/hooks/useDismissibleOnBack";

interface PickerClient {
  id: string;
  name: string;
  phone?: string;
}

interface ClientPickerSheetProps {
  open: boolean;
  onClose: () => void;
  clients: PickerClient[];
  selectedClientId: string;
  onSelect: (id: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onCreateNew: () => void;
}

export function ClientPickerSheet({
  open,
  onClose,
  clients,
  selectedClientId,
  onSelect,
  search,
  onSearchChange,
  hasMore,
  loadingMore,
  onLoadMore,
  onCreateNew,
}: ClientPickerSheetProps) {
  // RELEASE-QUALITY-03 P1-01: componente NÃO desmonta quando fechado (só retorna null), diferente dos
  // primitivos Radix — por isso o hook precisa do `open` real, não de `true` fixo, para não ficar
  // registrado na pilha global depois que a sheet já fechou.
  useDismissibleOnBack(open, onClose);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Selecionar cliente"
      onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}
    >
      <div className="rs-sheet-enter flex max-h-[80vh] w-full max-w-sm flex-col rounded-t-[1.5rem] bg-white pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between border-b border-border/40 px-5 pb-3 pt-5">
          <h3 className="text-base font-bold tracking-tight">Selecionar cliente</h3>
          <button type="button" onClick={onClose} className="rs-icon-press flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full bg-secondary" aria-label="Fechar seleção de cliente"><X className="h-4 w-4" /></button>
        </div>

        <div className="px-5 pt-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              autoFocus
              placeholder="Buscar cliente..."
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              className="w-full rounded-full border-none bg-secondary/50 py-3 pl-11 pr-4 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              aria-label="Buscar cliente"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {clients.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">Nenhum cliente encontrado.</p>
          ) : (
            <ul role="listbox" aria-label="Clientes">
              {clients.map((client) => {
                const isSelected = client.id === selectedClientId;
                return (
                  <li key={client.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => { onSelect(client.id); onClose(); }}
                      className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors ${isSelected ? "bg-primary/8" : "hover:bg-secondary/50 active:bg-secondary/70"}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">{client.name}</p>
                        {client.phone && <p className="truncate text-xs text-muted-foreground">{client.phone}</p>}
                      </div>
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${isSelected ? "border-primary bg-primary" : "border-border"}`}>
                        {isSelected && <Check className="h-3 w-3 text-white" />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {hasMore && (
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loadingMore}
              className="mx-2 mt-1 w-[calc(100%-1rem)] rounded-xl bg-secondary/60 px-4 py-2 text-xs font-semibold text-muted-foreground disabled:opacity-60"
            >
              {loadingMore ? "Carregando..." : "Carregar mais"}
            </button>
          )}
        </div>

        <div className="border-t border-border/40 px-5 py-3">
          <button
            type="button"
            onClick={onCreateNew}
            className="rs-pressable flex w-full items-center justify-center gap-2 rounded-2xl bg-primary/10 px-4 py-3 text-xs font-semibold text-primary"
          >
            <UserPlus className="h-4 w-4" /> Novo cliente
          </button>
        </div>
      </div>
    </div>
  );
}
