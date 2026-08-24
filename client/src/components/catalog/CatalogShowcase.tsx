import { useCallback, useEffect, useMemo, useState } from "react";
import { Package } from "lucide-react";
import { CatalogHeader } from "@/components/catalog/CatalogHeader";
import { CatalogProductRail } from "@/components/catalog/CatalogProductRail";
import { CatalogCategoryRail } from "@/components/catalog/CatalogCategoryRail";
import { CatalogGenderFilter } from "@/components/catalog/CatalogGenderFilter";
import { CatalogProductTile } from "@/components/catalog/CatalogProductTile";
import { CatalogProductDetails } from "@/components/catalog/CatalogProductDetails";
import { hasProductImage, type CatalogExperience, type CatalogNicheExperience } from "@/lib/catalog-experience";
import { normalizeProductCategory } from "@/lib/nicho-config";
import type { Product } from "@/lib/mock-data";
import { resolveProductGender } from "@/lib/product-gender";
import { normalizeProductSearchText } from "@/lib/product-search";
import { compareProductAvailabilityFirst } from "@/lib/product-availability";

export type CatalogShowcaseContext = "seller" | "public";

export interface CatalogShowcaseStore {
  name: string;
  logoUrl?: string;
  bannerUrl?: string;
  bannerTitle?: string;
  description?: string;
  showPrice?: boolean;
  showStock?: boolean;
}

export interface CatalogShowcaseProps {
  context: CatalogShowcaseContext;
  experience: CatalogExperience;
  products: Product[];
  store: CatalogShowcaseStore;
  searchTerm: string;
  selectedCategory: string;
  selectedGender: string;
  cartQuantities: ReadonlyMap<string, number>;
  productNicheIds?: ReadonlyMap<string, string>;
  cartCount: number;
  onSearchTermChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onGenderChange: (value: string) => void;
  onAddToCart: (product: Product) => void;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onOpenCart: () => void;
  onShareCatalog: () => void;
  onCreateProduct?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  loadMoreError?: string;
  onLoadMore?: () => void;
}

export function getCategoryOptions(products: Product[]): string[] {
  const labels = new Map<string, string>();
  for (const product of products) {
    const label = normalizeProductCategory(product.category);
    if (!label) continue;
    const key = label.toLocaleLowerCase("pt-BR");
    if (!labels.has(key)) labels.set(key, label);
  }
  return Array.from(labels.values()).sort((left, right) => left.localeCompare(right, "pt-BR"));
}

/** Disponíveis primeiro, depois produtos sem foto perdem prioridade — ordenação estável (não embaralha o resto). */
function sortForShowcase(products: Product[]): Product[] {
  return [...products].sort((left, right) => {
    // Disponibilidade vem do helper central (mesma regra de Produtos); a vitrine só acrescenta o
    // critério próprio de desempate: produto com foto antes de produto sem foto.
    const byAvailability = compareProductAvailabilityFirst(left, right);
    if (byAvailability !== 0) return byAvailability;
    const leftHasImage = hasProductImage(left);
    const rightHasImage = hasProductImage(right);
    if (leftHasImage !== rightHasImage) return leftHasImage ? -1 : 1;
    return 0;
  });
}

function NicheSelector({
  experience,
  activeNicheId,
  onChange,
}: {
  experience: CatalogExperience;
  activeNicheId?: string;
  onChange: (nicheId?: string) => void;
}) {
  if (experience.mode === "general" || experience.niches.length === 0) return null;

  if (experience.mode === "hub") {
    return (
      <section className="space-y-2 px-4 sm:px-6" data-catalog-mode="hub">
        <h2 className="text-base font-bold tracking-tight text-slate-950">Explore cada área da loja</h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {experience.niches.map((niche) => (
            <button
              type="button"
              key={niche.id}
              onClick={() => onChange(niche.id)}
              className={`min-h-20 rounded-xl p-3 text-left transition-colors ${activeNicheId === niche.id ? "bg-primary text-white" : "bg-slate-100 text-slate-900"}`}
            >
              <strong className="block text-sm leading-tight">{niche.label}</strong>
              <span className="mt-1 block text-xs font-bold opacity-75">{niche.productCount} produto{niche.productCount === 1 ? "" : "s"}</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-x-auto hide-scrollbar snap-x snap-mandatory" data-catalog-mode={experience.mode}>
      <div className="flex gap-2 px-4 sm:px-6">
        {experience.mode === "segmented" && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className={`min-h-9 shrink-0 snap-start whitespace-nowrap rounded-full px-4 text-xs font-bold transition-colors ${!activeNicheId ? "bg-primary text-white" : "bg-slate-100 text-slate-600"}`}
          >
            Visão geral
          </button>
        )}
        {experience.niches.map((niche) => (
          <button
            type="button"
            key={niche.id}
            onClick={() => onChange(niche.id)}
            className={`min-h-9 shrink-0 snap-start whitespace-nowrap rounded-full px-4 text-xs font-bold transition-colors ${activeNicheId === niche.id ? "bg-primary text-white" : "bg-slate-100 text-slate-600"}`}
          >
            {niche.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function findActiveNiche(experience: CatalogExperience, activeNicheId?: string): CatalogNicheExperience | undefined {
  return experience.niches.find((niche) => niche.id === activeNicheId);
}

export function CatalogShowcase({
  context,
  experience,
  products,
  store,
  searchTerm,
  selectedCategory,
  selectedGender,
  cartQuantities,
  productNicheIds,
  cartCount,
  onSearchTermChange,
  onCategoryChange,
  onGenderChange,
  onAddToCart,
  onUpdateQuantity,
  onOpenCart,
  onShareCatalog,
  onCreateProduct,
  hasMore = false,
  loadingMore = false,
  loadMoreError = "",
  onLoadMore,
}: CatalogShowcaseProps) {
  const [activeNicheId, setActiveNicheId] = useState<string | undefined>(experience.activeNicheId);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const nicheKey = experience.niches.map((niche) => niche.id).join("|");

  useEffect(() => {
    if (experience.mode === "general") {
      setActiveNicheId(undefined);
      return;
    }
    if (!experience.niches.some((niche) => niche.id === activeNicheId)) {
      setActiveNicheId(experience.activeNicheId ?? experience.niches[0]?.id);
    }
  }, [activeNicheId, experience.activeNicheId, experience.mode, experience.niches, nicheKey]);

  const activeNiche = findActiveNiche(experience, activeNicheId);
  const scopedProducts = activeNiche
    ? productNicheIds
      ? products.filter((product) => productNicheIds.get(product.id) === activeNiche.id)
      : activeNiche.products
    : products;

  const categoryOptions = useMemo(() => getCategoryOptions(scopedProducts), [scopedProducts]);
  const effectiveCategory = selectedCategory === "todos" || categoryOptions.includes(selectedCategory) ? selectedCategory : "todos";
  const normalizedSearch = useMemo(() => normalizeProductSearchText(searchTerm), [searchTerm]);

  // Só faz sentido oferecer o filtro quando o nicho realmente tem produtos de mais de um público.
  const genderOptionsPresent = useMemo(() => new Set(scopedProducts.map((product) => resolveProductGender(product))), [scopedProducts]);
  const showGenderFilter = genderOptionsPresent.size > 1;
  const normalizedSelectedGender = normalizeProductSearchText(selectedGender) || "todos";
  const effectiveGender = normalizedSelectedGender === "todos" || genderOptionsPresent.has(normalizedSelectedGender) ? normalizedSelectedGender : "todos";

  useEffect(() => {
    if (selectedCategory !== effectiveCategory) onCategoryChange(effectiveCategory);
  }, [effectiveCategory, onCategoryChange, selectedCategory]);

  useEffect(() => {
    if (selectedGender !== effectiveGender) onGenderChange(effectiveGender);
  }, [effectiveGender, onGenderChange, selectedGender]);

  // Busca/categoria/público valem tanto para a vitrine completa quanto para os trilhos curados
  // (Ofertas, Recomendados, Mais vendidos) — antes só a vitrine respeitava os filtros, então os
  // trilhos continuavam mostrando os mesmos produtos fixos mesmo com uma busca ativa, dando a
  // impressão de que a busca não fazia nada.
  const matchesActiveFilters = useCallback((product: Product) => {
    const searchable = [product.name, product.brand, product.category, product.description, product.productType]
      .map((value) => normalizeProductSearchText(value))
      .join(" ");
    const matchesSearch = !normalizedSearch || searchable.includes(normalizedSearch);
    const matchesCategory = effectiveCategory === "todos"
      || normalizeProductCategory(product.category).toLocaleLowerCase("pt-BR") === effectiveCategory.toLocaleLowerCase("pt-BR");
    const matchesGender = effectiveGender === "todos" || resolveProductGender(product) === effectiveGender;
    return matchesSearch && matchesCategory && matchesGender;
  }, [effectiveCategory, effectiveGender, normalizedSearch]);

  const collections = activeNiche?.quickCollections ?? experience.quickCollections;
  const offersProducts = useMemo(
    () => (collections.find((collection) => collection.id === "offers")?.products ?? []).filter(matchesActiveFilters),
    [collections, matchesActiveFilters],
  );
  const bestSellerProducts = useMemo(
    () => (collections.find((collection) => collection.id === "best_sellers")?.products ?? []).filter(matchesActiveFilters),
    [collections, matchesActiveFilters],
  );
  const recommendedProducts = useMemo(() => {
    const featured = (collections.find((collection) => collection.id === "featured")?.products ?? []).filter(matchesActiveFilters);
    if (featured.length === 0) return featured;
    const offersIds = new Set(offersProducts.map((product) => product.id));
    const withoutOverlap = featured.filter((product) => !offersIds.has(product.id));
    // Só filtra sobreposição quando ainda sobra variedade; nunca esconde produtos válidos sem necessidade.
    return withoutOverlap.length > 0 ? withoutOverlap : featured;
  }, [collections, matchesActiveFilters, offersProducts]);

  const filteredProducts = useMemo(
    () => sortForShowcase(scopedProducts.filter(matchesActiveFilters)),
    [matchesActiveFilters, scopedProducts],
  );

  const showPrice = context === "seller" || store.showPrice !== false;
  const showStock = context === "seller" || store.showStock !== false;
  const storeName = store.name || "Minha Loja";

  const clearFilters = () => {
    onSearchTermChange("");
    onCategoryChange("todos");
    onGenderChange("todos");
  };

  return (
    <div className="min-h-full bg-white text-slate-900" data-catalog-showcase={context}>
      <CatalogHeader
        mode={context}
        storeName={storeName}
        storeLogoUrl={store.logoUrl}
        searchTerm={searchTerm}
        onSearchTermChange={onSearchTermChange}
        cartCount={cartCount}
        onOpenCart={onOpenCart}
        onShareCatalog={onShareCatalog}
      />

      <main className="mx-auto max-w-6xl space-y-6 pb-28 pt-4">
        <NicheSelector experience={experience} activeNicheId={activeNicheId} onChange={(nicheId) => { setActiveNicheId(nicheId); onCategoryChange("todos"); }} />

        <CatalogProductRail title="Ofertas do dia" products={offersProducts} showPrice={showPrice} showStock={showStock} onSelectProduct={context === "public" ? setDetailProduct : undefined} onAddToCart={context === "public" ? onAddToCart : undefined} onUpdateQuantity={onUpdateQuantity} cartQuantities={cartQuantities} />
        <CatalogProductRail title="Recomendados para você" products={recommendedProducts} showPrice={showPrice} showStock={showStock} onSelectProduct={context === "public" ? setDetailProduct : undefined} onAddToCart={context === "public" ? onAddToCart : undefined} onUpdateQuantity={onUpdateQuantity} cartQuantities={cartQuantities} />
        <CatalogProductRail title="Produtos mais vendidos" products={bestSellerProducts} showPrice={showPrice} showStock={showStock} onSelectProduct={context === "public" ? setDetailProduct : undefined} onAddToCart={context === "public" ? onAddToCart : undefined} onUpdateQuantity={onUpdateQuantity} cartQuantities={cartQuantities} />

        {categoryOptions.length > 0 && (
          <CatalogCategoryRail categories={categoryOptions} selectedCategory={effectiveCategory} onSelectCategory={onCategoryChange} />
        )}

        {showGenderFilter && (
          <CatalogGenderFilter selectedGender={effectiveGender} onSelectGender={onGenderChange} />
        )}

        <div className="px-4 sm:px-6">
          {filteredProducts.length > 0 ? (
            <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4" data-catalog-product-grid>
              {filteredProducts.map((product) => (
                <CatalogProductTile
                  key={product.id}
                  product={product}
                  showPrice={showPrice}
                  showStock={showStock}
                  onSelectProduct={context === "public" ? setDetailProduct : undefined}
                  onAddToCart={context === "public" ? onAddToCart : undefined}
                  onUpdateQuantity={onUpdateQuantity}
                  cartQuantity={cartQuantities.get(product.id) || 0}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100"><Package className="h-8 w-8 text-slate-300" /></div>
              <p className="font-bold text-slate-800">{products.length === 0 ? "Sua vitrine começa aqui" : scopedProducts.length === 0 ? "Nenhum produto neste nicho" : "Nenhum produto encontrado"}</p>
              <p className="mt-2 max-w-[300px] text-sm leading-relaxed text-muted-foreground">
                {products.length === 0
                  ? "Cadastre produtos reais para formar o catálogo."
                  : scopedProducts.length === 0
                    ? "A vitrine será preenchida assim que houver produtos associados a esta seleção."
                    : "Tente outro termo ou limpe os filtros para voltar à vitrine completa."}
              </p>
              {products.length === 0 && context === "seller" && onCreateProduct ? (
                <button type="button" onClick={onCreateProduct} className="mt-5 min-h-11 rounded-full bg-primary px-5 text-xs font-bold text-white">Cadastrar produto</button>
              ) : scopedProducts.length > 0 ? (
                <button type="button" onClick={clearFilters} className="mt-5 min-h-11 rounded-full bg-slate-950 px-5 text-xs font-bold text-white">Limpar filtros</button>
              ) : null}
            </div>
          )}

          {hasMore && onLoadMore && (
            <div className="flex flex-col items-center gap-3 pt-6">
              {loadMoreError && <p className="text-center text-xs font-semibold text-red-500">{loadMoreError}</p>}
              <button type="button" onClick={onLoadMore} disabled={loadingMore} className="min-h-11 rounded-full bg-primary px-6 text-xs font-bold text-white disabled:opacity-60">{loadingMore ? "Carregando..." : "Carregar mais"}</button>
            </div>
          )}
        </div>

      </main>

      {context === "public" && detailProduct && (
        <CatalogProductDetails
          product={detailProduct}
          showPrice={showPrice}
          quantity={cartQuantities.get(detailProduct.id) || 0}
          onAddToCart={onAddToCart}
          onUpdateQuantity={onUpdateQuantity}
          onClose={() => setDetailProduct(null)}
        />
      )}
    </div>
  );
}
