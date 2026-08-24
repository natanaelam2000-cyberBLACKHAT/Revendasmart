import { ImageOff, Package } from "lucide-react";
import { ProductImageCard } from "@/components/ProductImageCard";
import { formatMarketingPrice } from "@/lib/marketing-ad";

/**
 * Resumo compacto do produto já escolhido.
 *
 * Antes, o seletor de produtos ficava permanentemente aberto no topo do editor, ocupando boa parte
 * da tela do celular mesmo depois da escolha feita — o usuário precisava rolar por uma lista inteira
 * só para chegar na personalização. Agora, escolhido o produto, a lista colapsa nesta linha e o
 * botão "Trocar" a reabre quando for preciso.
 */
interface MarketingSelectedProductProps {
  name: string;
  brand?: string;
  price: string | number;
  stock?: number;
  /** Campos de imagem do produto — o ProductImageCard resolve inclusive `imageId` (IndexedDB). */
  imageSource: { imageUrl?: string; photoUrl?: string; image?: string; thumbnailUrl?: string; imageId?: string } | null;
  onChange: () => void;
}

export function MarketingSelectedProduct({ name, brand, price, stock, imageSource, onChange }: MarketingSelectedProductProps) {
  const priceText = typeof price === "string" && price.trim().startsWith("R$") ? price : formatMarketingPrice(price);
  const hasStockInfo = typeof stock === "number" && Number.isFinite(stock);

  return (
    <div className="flex items-center gap-3" data-testid="marketing-selected-product">
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-border/50 bg-secondary/30">
        {imageSource ? (
          <ProductImageCard product={imageSource} size="sm" objectFit="contain" className="!rounded-none !border-0" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground/50"><ImageOff className="h-4 w-4" /></div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold leading-tight text-foreground">{name}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
          <span className="font-bold text-foreground">{priceText}</span>
          {brand && <span className="truncate">{brand}</span>}
          {/* Estoque só aparece quando é informação acionável: sem unidades o anúncio ainda pode ser
              feito (pré-venda), mas o lojista precisa saber. */}
          {hasStockInfo && (
            <span className={stock > 0 ? "" : "font-semibold text-destructive"}>
              {stock > 0 ? `${stock} un` : "sem estoque"}
            </span>
          )}
        </p>
      </div>

      <button
        type="button"
        onClick={onChange}
        data-testid="button-change-marketing-product"
        className="rs-pressable flex shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-white px-3 py-2 text-[11px] font-bold text-foreground"
      >
        <Package className="h-3.5 w-3.5" /> Trocar
      </button>
    </div>
  );
}
