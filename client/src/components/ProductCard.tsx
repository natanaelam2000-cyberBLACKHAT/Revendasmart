import { Product } from "@/lib/mock-data";
import { ProductImageCard } from "./ProductImageCard";
import { StockBadge } from "./StockBadge";
import { Badge } from "@/components/ui/badge";
import { Tag } from "lucide-react";

interface ProductCardProps {
  product: Product;
  onClick?: () => void;
  lowStockThreshold?: number;
}

export const ProductCard = ({ product, onClick, lowStockThreshold }: ProductCardProps) => {
  const hasCost = product.costPrice > 0;
  const profit = hasCost ? product.salePrice - product.costPrice : null;

  return (
    <div
      onClick={onClick}
      className="bg-white overflow-hidden hover:bg-slate-50/50 transition-colors cursor-pointer flex flex-row min-h-[138px] group"
    >
      {/* Imagem compacta */}
      <div className="relative w-24 sm:w-28 flex-shrink-0 bg-gradient-to-br from-muted/30 to-muted/10 overflow-hidden">
        <ProductImageCard
          product={product}
          size="full"
          objectFit="contain"
          className="!rounded-none group-hover:scale-105 transition-transform duration-300"
        />
        <div className="absolute top-2 right-2">
          <StockBadge
            stock={product.stock}
            lowStockThreshold={lowStockThreshold}
            className="shadow-sm bg-white/90 backdrop-blur-sm"
          />
        </div>
      </div>

      {/* Conteúdo */}
      <div className="p-3 flex-1 min-w-0 flex flex-col gap-1.5">
        {/* Marca + Categoria */}
        <div className="flex gap-1.5 flex-wrap">
          <Badge variant="secondary" className="text-[9px] font-black uppercase tracking-wider py-0.5 px-2 rounded-lg flex items-center gap-1">
            <Tag className="w-2.5 h-2.5" /> {product.brand}
          </Badge>
          {product.category ? (
            <Badge variant="outline" className="text-[9px] font-black uppercase tracking-wider py-0.5 px-2 rounded-lg border-primary/20 text-primary">
              {product.category}
            </Badge>
          ) : null}
        </div>

        {/* Nome */}
        <h3 className="font-bold text-sm text-foreground leading-tight line-clamp-2">
          {product.name}
        </h3>

        {/* Valores financeiros — sempre rotulados */}
        <div className="mt-auto pt-2 border-t border-border/40 grid grid-cols-2 gap-2">
          <div className="min-w-0">
            <span className="block text-[9px] text-muted-foreground uppercase">Venda</span>
            <span className="block text-xs font-black text-primary truncate">
              R$ {product.salePrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </span>
          </div>

          {hasCost && (
            <div className="min-w-0">
              <span className="block text-[9px] text-muted-foreground uppercase">Custo</span>
              <span className="block text-xs font-bold text-foreground truncate">
                R$ {product.costPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </span>
            </div>
          )}

          {profit !== null && profit > 0 && (
            <div className="min-w-0">
              <span className="block text-[9px] text-muted-foreground uppercase">Lucro</span>
              <span className="block text-xs font-bold text-green-600 truncate">
                R$ {profit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </span>
            </div>
          )}

          <div className="min-w-0">
            <span className="block text-[9px] text-muted-foreground uppercase">Estoque</span>
            <span className="block text-xs font-bold text-foreground">{product.stock} un</span>
          </div>
        </div>
      </div>
    </div>
  );
};
