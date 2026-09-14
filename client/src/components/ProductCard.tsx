import { memo } from "react";
import { Product } from "@/lib/mock-data";
import { formatCurrency } from "@/lib/product-pricing";
import { ProductImageCard } from "./ProductImageCard";
import { StockBadge } from "./StockBadge";

interface ProductCardProps { product: Product; lowStockThreshold?: number; }
const ProductCardComponent = ({ product, lowStockThreshold }: ProductCardProps) => {
  const cost = Number(product.costPrice || 0);
  const sale = Number(product.salePrice || 0);
  const profit = sale - cost;
  return (
    <div className="bg-white h-full flex flex-col">
      <div className="relative aspect-square bg-gradient-to-br from-slate-50 to-slate-100 p-2 sm:p-3">
        <ProductImageCard product={product} size="full" objectFit="contain" className="!rounded-xl !w-full !h-full" />
        <div className="absolute top-2 right-2"><StockBadge stock={product.stock} lowStockThreshold={lowStockThreshold} className="shadow-sm bg-white/95 text-[8px] sm:text-[9px]" /></div>
      </div>
      <div className="p-3 flex-1 flex flex-col min-w-0">
        <p className="text-[9px] sm:text-[10px] font-black text-primary uppercase tracking-wider truncate">{product.brand || "Sem marca"}</p>
        <h3 className="text-xs sm:text-sm font-bold leading-tight line-clamp-2 min-h-[2rem] sm:min-h-[2.5rem] mt-1">{product.name}</h3>
        <p className="text-[9px] text-muted-foreground truncate mt-1">{product.category || "Sem categoria"}</p>
        {sale <= 1 && (
          <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-[9px] font-semibold leading-tight text-amber-700">
            Preço possivelmente incompleto
          </p>
        )}
        <div className="grid grid-cols-2 gap-x-2 gap-y-2 mt-3 pt-3 border-t border-border/40">
          <div><span className="block text-[8px] text-muted-foreground uppercase">Venda</span><strong className="block text-[10px] sm:text-xs text-primary truncate">{formatCurrency(sale)}</strong></div>
          <div><span className="block text-[8px] text-muted-foreground uppercase">Custo</span><strong className="block text-[10px] sm:text-xs truncate">{formatCurrency(cost)}</strong></div>
          <div><span className="block text-[8px] text-muted-foreground uppercase">Lucro</span><strong className={`block text-[10px] sm:text-xs truncate ${profit >= 0 ? "text-green-600" : "text-red-600"}`}>{formatCurrency(profit)}</strong></div>
          <div><span className="block text-[8px] text-muted-foreground uppercase">Unidades</span><strong className="block text-[10px] sm:text-xs">{product.stock} un</strong></div>
        </div>
      </div>
    </div>
  );
};

export const ProductCard = memo(ProductCardComponent);
