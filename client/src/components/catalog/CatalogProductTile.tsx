import type { KeyboardEvent } from "react";
import { Minus, Plus } from "lucide-react";
import { ProductImageCard } from "@/components/ProductImageCard";
import type { Product } from "@/lib/mock-data";
import { formatCurrency, getPromotionalPrice } from "@/lib/product-pricing";

interface CatalogProductTileProps {
  product: Product;
  showPrice: boolean;
  showStock: boolean;
  /** Abre o modal de detalhes. Omitido no catálogo do revendedor — lá o tile é só visualização. */
  onSelectProduct?: (product: Product) => void;
  /** Adiciona direto ao carrinho a partir do tile, sem passar pelo modal. Só usado no catálogo público. */
  onAddToCart?: (product: Product) => void;
  onUpdateQuantity?: (productId: string, quantity: number) => void;
  cartQuantity?: number;
  className?: string;
}

export function CatalogProductTile({ product, showPrice, showStock, onSelectProduct, onAddToCart, onUpdateQuantity, cartQuantity = 0, className = "" }: CatalogProductTileProps) {
  const price = Number(product.salePrice || 0);
  const promotionalPrice = getPromotionalPrice(product);
  const discountPercent = Number(product.discountPercent || 0);
  const hasValidDiscount = promotionalPrice !== null && discountPercent > 0 && discountPercent < 100;
  const stock = Math.max(0, Number(product.stock || 0));
  const available = stock > 0;
  const name = product.name || "Produto";
  const brand = (product.brand || "").trim();
  // Não repete a marca quando ela já aparece dentro do nome (ex: "Tênis Puma Classic" + marca "Puma").
  const showBrand = brand.length > 0 && !name.toLocaleLowerCase("pt-BR").includes(brand.toLocaleLowerCase("pt-BR"));
  const interactive = Boolean(onSelectProduct);

  const openDetails = () => onSelectProduct?.(product);
  const handleKeyDown = (event: KeyboardEvent) => {
    if (!interactive) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetails();
    }
  };

  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? openDetails : undefined}
      onKeyDown={handleKeyDown}
      className={`flex h-full w-full flex-col text-left transition-transform ${interactive ? "cursor-pointer active:scale-[0.98]" : ""} ${className}`}
      aria-label={interactive ? `Ver detalhes de ${name}` : undefined}
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-slate-50">
        <ProductImageCard product={product} size="full" objectFit="contain" className="!rounded-none !border-0" />
        {hasValidDiscount && (
          <span className="absolute right-1.5 top-1.5 rounded-full border border-emerald-600 bg-white px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
            -{discountPercent}%
          </span>
        )}
        {showStock && !available && (
          <span className="absolute left-1.5 top-1.5 rounded-full bg-white/90 px-1.5 py-0.5 text-[9px] font-bold text-red-600">Esgotado</span>
        )}
        {onAddToCart && available && (
          <div className="absolute bottom-1.5 right-1.5" onClick={(event) => event.stopPropagation()}>
            {cartQuantity > 0 ? (
              <div className="flex items-center gap-1 rounded-full bg-white/95 p-0.5 shadow-md">
                <button
                  type="button"
                  onClick={() => onUpdateQuantity?.(product.id, cartQuantity - 1)}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 transition-transform active:scale-95"
                  aria-label={`Diminuir quantidade de ${name}`}
                >
                  <Minus className="h-3 w-3" />
                </button>
                <span className="min-w-[1rem] text-center text-[11px] font-black text-slate-900" aria-label={`${cartQuantity} no carrinho`}>{cartQuantity}</span>
                <button
                  type="button"
                  onClick={() => onAddToCart(product)}
                  disabled={cartQuantity >= stock}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white transition-transform active:scale-95 disabled:opacity-40"
                  aria-label={`Aumentar quantidade de ${name}`}
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onAddToCart(product)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white shadow-md transition-transform active:scale-95"
                aria-label={`Adicionar ${name} ao carrinho`}
              >
                <Plus className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 pt-1.5">
        {showBrand && <p className="truncate text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400">{brand}</p>}
        <h3 className="line-clamp-3 text-xs font-semibold leading-snug text-slate-900">{name}</h3>
        {showPrice && (
          <div className="mt-auto pt-1">
            {promotionalPrice !== null && <p className="text-[10px] font-medium text-slate-400 line-through">{formatCurrency(price)}</p>}
            <p className="text-sm font-bold text-slate-950">{formatCurrency(promotionalPrice ?? price)}</p>
          </div>
        )}
      </div>
    </div>
  );
}
