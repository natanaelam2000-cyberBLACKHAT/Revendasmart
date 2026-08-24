import { CatalogProductTile } from "@/components/catalog/CatalogProductTile";
import type { Product } from "@/lib/mock-data";

interface CatalogProductRailProps {
  title: string;
  products: Product[];
  showPrice: boolean;
  showStock: boolean;
  onSelectProduct?: (product: Product) => void;
  onAddToCart?: (product: Product) => void;
  onUpdateQuantity?: (productId: string, quantity: number) => void;
  cartQuantities?: ReadonlyMap<string, number>;
  /** Limite de itens exibidos no trilho (o restante fica só na vitrine completa). */
  maxItems?: number;
}

export function CatalogProductRail({ title, products, showPrice, showStock, onSelectProduct, onAddToCart, onUpdateQuantity, cartQuantities, maxItems = 10 }: CatalogProductRailProps) {
  const items = products.slice(0, maxItems);
  if (items.length === 0) return null;

  return (
    <section className="space-y-2" data-catalog-rail={title}>
      <h2 className="px-4 text-base font-bold tracking-tight text-slate-950 sm:px-6">{title}</h2>
      <div className="overflow-x-auto hide-scrollbar snap-x snap-mandatory">
        <div className="flex gap-2 px-4 sm:px-6">
          {items.map((product) => (
            <div key={product.id} className="w-[38%] shrink-0 snap-start sm:w-[22%]">
              <CatalogProductTile
                product={product}
                showPrice={showPrice}
                showStock={showStock}
                onSelectProduct={onSelectProduct}
                onAddToCart={onAddToCart}
                onUpdateQuantity={onUpdateQuantity}
                cartQuantity={cartQuantities?.get(product.id) || 0}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
