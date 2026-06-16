import { Product } from "@/lib/mock-data";
import { ProductImageCard } from "./ProductImageCard";
import { StockBadge } from "./StockBadge";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, DollarSign, Package, Tag } from "lucide-react";

interface ProductCardProps {
  product: Product;
  onClick?: () => void;
  lowStockThreshold?: number;
}

export const ProductCard = ({ product, onClick, lowStockThreshold }: ProductCardProps) => {
  const profit = product.salePrice - product.costPrice;
  
  return (
    <div 
      onClick={onClick}
      className="bg-white rounded-[1.5rem] border border-border/50 shadow-sm overflow-hidden hover:shadow-md transition-all active:scale-[0.98] cursor-pointer flex flex-col h-full group"
    >
      {/* Imagem em destaque */}
      <div className="relative aspect-square bg-gradient-to-br from-muted/30 to-muted/10 overflow-hidden">
        <ProductImageCard 
          product={product} 
          size="full" 
          objectFit="contain" 
          className="!rounded-none group-hover:scale-105 transition-transform duration-300" 
        />
        
        {/* Status Badge flutuante */}
        <div className="absolute top-3 right-3">
          <StockBadge 
            stock={product.stock} 
            lowStockThreshold={lowStockThreshold} 
            className="shadow-sm backdrop-blur-sm bg-white/90" 
          />
        </div>
      </div>

      {/* Conteúdo */}
      <div className="p-4 flex-1 flex flex-col">
        <div className="mb-3">
          <div className="flex gap-1.5 mb-2 overflow-x-auto hide-scrollbar">
            <Badge variant="secondary" className="text-[9px] font-black uppercase tracking-wider py-0.5 px-2 rounded-lg flex items-center gap-1">
              <Tag className="w-2.5 h-2.5" /> {product.brand}
            </Badge>
            <Badge variant="outline" className="text-[9px] font-black uppercase tracking-wider py-0.5 px-2 rounded-lg border-primary/20 text-primary">
              {product.category}
            </Badge>
          </div>
          <h3 className="font-bold text-sm text-foreground leading-tight line-clamp-2 min-h-[2.5rem]">
            {product.name}
          </h3>
        </div>

        {/* Indicadores Financeiros */}
        <div className="mt-auto space-y-2.5 pt-3 border-t border-border/40">
          <div className="flex justify-between items-end">
            <div className="space-y-0.5">
              <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Preço de Venda</p>
              <p className="text-lg font-black text-primary leading-none">
                R$ {product.salePrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[9px] font-bold text-green-600 bg-green-50 px-2 py-1 rounded-lg inline-flex items-center gap-1">
                <TrendingUp className="w-2.5 h-2.5" /> +R$ {profit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} lucro
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-muted/30 p-2 rounded-xl">
              <p className="text-[8px] font-black text-muted-foreground uppercase mb-0.5 flex items-center gap-1">
                <DollarSign className="w-2 h-2" /> Custo
              </p>
              <p className="text-[11px] font-bold">R$ {product.costPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-muted/30 p-2 rounded-xl text-right">
              <p className="text-[8px] font-black text-muted-foreground uppercase mb-0.5 flex items-center gap-1 justify-end">
                <Package className="w-2 h-2" /> Estoque
              </p>
              <p className="text-[11px] font-bold">{product.stock} un</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
