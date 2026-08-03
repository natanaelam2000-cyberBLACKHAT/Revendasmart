import { PackageCheck, Search } from "lucide-react";
import type { Product } from "@/lib/mock-data";

type Props = {
  products: Product[];
  kitProducts: Product[];
  featuredProducts: Product[];
  selectedProductId: string;
  selectedKitId: string;
  search: string;
  hasMore: boolean;
  loadingMore: boolean;
  catalogLaunchState: "none" | "idle" | "loading" | "found" | "missing" | "invalid";
  onSearchChange: (value: string) => void;
  onSelectProduct: (productId: string) => void;
  onSelectKit: (productId: string) => void;
  onSelectFeatured: (product: Product) => void;
  onLoadMore: () => void;
};

const priceFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function MarketingProductSelector({
  products,
  kitProducts,
  featuredProducts,
  selectedProductId,
  selectedKitId,
  search,
  hasMore,
  loadingMore,
  catalogLaunchState,
  onSearchChange,
  onSelectProduct,
  onSelectKit,
  onSelectFeatured,
  onLoadMore,
}: Props) {
  const catalogMessage = {
    none: "Use qualquer produto cadastrado para montar o anúncio.",
    idle: "Preparando o produto enviado pelo catálogo…",
    loading: "Carregando o produto enviado pelo catálogo…",
    found: "O produto enviado pelo catálogo foi carregado no editor.",
    missing: "Não encontramos esse produto na sua conta. Escolha outro produto para continuar.",
    invalid: "O link do produto é inválido. Escolha um produto para continuar.",
  }[catalogLaunchState];

  return (
    <section className="grid gap-4 rounded-[1.75rem] border border-border/60 bg-white p-4 shadow-sm sm:p-5" data-testid="marketing-product-selector">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[.18em] text-primary">1. Escolha o item</p>
        <h2 className="mt-1 text-base font-black">Produto ou kit</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground" role="status" aria-live="polite">
          {catalogMessage}
        </p>
      </div>

      {featuredProducts.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Acesso rápido</p>
            <PackageCheck className="h-4 w-4 text-primary" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {featuredProducts.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => onSelectFeatured(product)}
                aria-pressed={selectedProductId === product.id || selectedKitId === product.id}
                className={[
                  "min-w-0 rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                  selectedProductId === product.id || selectedKitId === product.id
                    ? "border-primary bg-primary/5"
                    : "border-border/60 bg-secondary/20 hover:border-primary/30",
                ].join(" ")}
              >
                <p className="truncate text-[9px] font-bold uppercase text-muted-foreground">{product.brand || "Produto"}</p>
                <p className="mt-1 line-clamp-2 text-xs font-black">{product.name}</p>
                <p className="mt-2 text-[11px] font-bold text-primary">{priceFormatter.format(Number(product.salePrice || 0))}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <label htmlFor="marketing-product-search" className="text-xs font-bold text-muted-foreground">Pesquisar produto</label>
        <div className="relative mt-2">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="marketing-product-search"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Nome do produto..."
            className="w-full rounded-xl border border-border bg-white py-3 pl-10 pr-3 text-sm outline-none focus:border-primary"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-2 text-xs font-bold text-muted-foreground">
          Produto
          <select className="w-full rounded-xl border border-border bg-white p-3 text-sm text-foreground" value={selectedProductId} onChange={(event) => onSelectProduct(event.target.value)}>
            <option value="">Escolher produto...</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
        </label>
        <label className="grid gap-2 text-xs font-bold text-muted-foreground">
          Kit
          <select className="w-full rounded-xl border border-border bg-white p-3 text-sm text-foreground" value={selectedKitId} onChange={(event) => onSelectKit(event.target.value)}>
            <option value="">Escolher kit...</option>
            {kitProducts.length === 0
              ? <option disabled>Nenhum kit cadastrado</option>
              : kitProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
        </label>
      </div>

      {hasMore && (
        <button type="button" onClick={onLoadMore} disabled={loadingMore} className="min-h-11 rounded-xl border border-border bg-white px-4 text-xs font-bold text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60">
          {loadingMore ? "Carregando..." : "Carregar mais"}
        </button>
      )}
      {search && hasMore && <p className="text-center text-[11px] text-muted-foreground">Carregue mais produtos para ampliar a busca.</p>}
    </section>
  );
}
