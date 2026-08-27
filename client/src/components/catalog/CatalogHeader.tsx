import { useState } from "react";
import { Search, Share2, ShoppingCart } from "lucide-react";

interface CatalogHeaderProps {
  mode: "seller" | "public";
  storeName: string;
  storeLogoUrl?: string;
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  cartCount: number;
  onOpenCart: () => void;
  onShareCatalog: () => void;
}

// `mode` não muda mais o que este header renderiza (carrinho+Compartilhar aparecem juntos em qualquer
// contexto, ver comentário abaixo) — mantido na interface só porque CatalogShowcase ainda o repassa.
export function CatalogHeader({ storeName, storeLogoUrl, searchTerm, onSearchTermChange, cartCount, onOpenCart, onShareCatalog }: CatalogHeaderProps) {
  const [logoFailed, setLogoFailed] = useState(false);

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2.5 sm:px-6">
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          {storeLogoUrl && !logoFailed && (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg">
              <img src={storeLogoUrl} alt={storeName} className="h-full w-full object-cover" width={32} height={32} loading="eager" decoding="async" onError={() => setLogoFailed(true)} />
            </div>
          )}
          <div className="min-w-0 leading-tight">
            <p className="text-xs font-black uppercase tracking-[0.08em] text-primary sm:text-sm">Revenda Smart</p>
            <h1 className="max-w-[32vw] truncate text-[10px] font-semibold text-slate-500 sm:max-w-none sm:text-xs">{storeName}</h1>
          </div>
        </div>

        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => onSearchTermChange(event.target.value)}
            placeholder="Buscar produto..."
            aria-label="Buscar produto"
            inputMode="search"
            enterKeyHint="search"
            className="min-h-9 w-full rounded-full bg-slate-100 py-1.5 pl-9 pr-3 text-xs font-medium outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        {/* CATALOG-GOLDEN-RESTORE-05 §1/§3 — no commit histórico (6de2c85) carrinho+badge e Compartilhar
            apareciam JUNTOS, em qualquer contexto (nunca um substituindo o outro) — a troca "seller vê só
            Compartilhar, público vê só Carrinho" foi uma simplificação de um sprint posterior. Restaurado
            fielmente: os dois botões sempre juntos, do jeito que os screenshots históricos mostram. */}
        <button
          type="button"
          onClick={onShareCatalog}
          aria-label="Compartilhar catálogo"
          className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-bold text-white"
        >
          <Share2 className="h-4 w-4" /> <span className="hidden sm:inline">Compartilhar</span>
        </button>
        <button
          type="button"
          onClick={onOpenCart}
          data-testid="button-open-cart"
          aria-label={cartCount > 0 ? `Abrir carrinho, ${cartCount} item${cartCount === 1 ? "" : "s"}` : "Abrir carrinho"}
          className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-white"
        >
          <ShoppingCart className="h-4 w-4" />
          {cartCount > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[9px] font-black text-white ring-2 ring-white">{cartCount}</span>}
        </button>
      </div>
    </header>
  );
}
