import { useEffect } from "react";
import { Minus, Plus, X } from "lucide-react";
import { ProductImageCard } from "@/components/ProductImageCard";
import { formatCurrency, getPromotionalPrice } from "@/lib/product-pricing";
import type { Product } from "@/lib/mock-data";

function CatalogQuantityAction({
  product,
  quantity,
  onAddToCart,
  onUpdateQuantity,
}: {
  product: Product;
  quantity: number;
  onAddToCart: (product: Product) => void;
  onUpdateQuantity: (productId: string, quantity: number) => void;
}) {
  const stock = Math.max(0, Number(product.stock || 0));
  if (quantity > 0) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-2xl bg-slate-100 p-2">
        <button
          type="button"
          onClick={() => onUpdateQuantity(product.id, quantity - 1)}
          className="flex min-h-9 min-w-9 items-center justify-center rounded-xl bg-white shadow-sm transition-transform active:scale-95"
          aria-label={`Diminuir quantidade de ${product.name}`}
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="text-sm font-black text-slate-900" aria-label={`${quantity} no carrinho`}>{quantity}</span>
        <button
          type="button"
          onClick={() => onAddToCart(product)}
          disabled={quantity >= stock}
          className="flex min-h-9 min-w-9 items-center justify-center rounded-xl bg-primary text-white shadow-sm transition-transform active:scale-95 disabled:opacity-40"
          aria-label={`Aumentar quantidade de ${product.name}`}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onAddToCart(product)}
      disabled={stock <= 0}
      className="min-h-11 w-full rounded-2xl bg-primary text-xs font-black text-white shadow-lg shadow-primary/15 transition-all active:scale-[0.98] disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none"
    >
      {stock > 0 ? "Adicionar ao carrinho" : "Indisponível"}
    </button>
  );
}

interface CatalogProductDetailsProps {
  product: Product;
  showPrice: boolean;
  quantity: number;
  onAddToCart: (product: Product) => void;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onClose: () => void;
}

export function CatalogProductDetails({ product, showPrice, quantity, onAddToCart, onUpdateQuantity, onClose }: CatalogProductDetailsProps) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const price = Number(product.salePrice || 0);
  const promotionalPrice = getPromotionalPrice(product);
  const stock = Math.max(0, Number(product.stock || 0));
  const available = stock > 0;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,calc(env(safe-area-inset-bottom)+1rem))] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="catalog-product-details-title"
      data-testid="product-detail-modal"
      onClick={onClose}
    >
      <div
        className="rs-sheet-enter flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between px-5 pt-5">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">{available ? "Disponível" : "Esgotado"}</p>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100" aria-label="Fechar detalhes do produto"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-3">
          <div className="aspect-square w-full overflow-hidden rounded-xl bg-slate-50">
            <ProductImageCard product={product} size="full" objectFit="contain" className="!h-full !w-full !rounded-none !border-0" />
          </div>
          {product.brand && <p className="mt-4 text-xs font-black uppercase tracking-[0.14em] text-primary">{product.brand}</p>}
          <h2 id="catalog-product-details-title" className="mt-1 text-xl font-black leading-tight tracking-tight text-slate-950">{product.name}</h2>
          {showPrice && (
            <div className="mt-3">
              {promotionalPrice !== null && <p className="text-sm font-semibold text-slate-400 line-through">{formatCurrency(price)}</p>}
              <p className="text-3xl font-black text-slate-950">{formatCurrency(promotionalPrice ?? price)}</p>
            </div>
          )}
          {product.description && <p className="mt-3 text-sm leading-relaxed text-slate-600">{product.description}</p>}
          <div className="mt-5">
            <CatalogQuantityAction product={product} quantity={quantity} onAddToCart={onAddToCart} onUpdateQuantity={onUpdateQuantity} />
          </div>
        </div>
      </div>
    </div>
  );
}
