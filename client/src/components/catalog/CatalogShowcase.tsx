import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  Boxes,
  Check,
  Copy,
  Layers3,
  Megaphone,
  Minus,
  Package,
  Plus,
  Search,
  Share2,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Store,
  Tag,
  TrendingUp,
} from "lucide-react";
import { ProductImageCard } from "@/components/ProductImageCard";
import type {
  CatalogCollection,
  CatalogCollectionId,
  CatalogExperience,
  CatalogHeroReason,
  CatalogNicheExperience,
} from "@/lib/catalog-experience";
import type { Product } from "@/lib/mock-data";
import { normalizeProductSearchText } from "@/lib/product-search";

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
  onCopyCatalog?: () => void;
  copied?: boolean;
  onCreateProduct?: () => void;
  onCreateAd?: (product: Product) => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  loadMoreError?: string;
  onLoadMore?: () => void;
}

type CollectionPresentation = {
  label: string;
  subtitle: string;
  icon: ComponentType<{ className?: string }>;
};

const COLLECTION_PRESENTATION: Record<CatalogCollectionId, CollectionPresentation> = {
  offers: { label: "Ofertas", subtitle: "Condições especiais cadastradas pela loja", icon: Tag },
  featured: { label: "Destaques", subtitle: "Produtos escolhidos para ganhar visibilidade", icon: Sparkles },
  best_sellers: { label: "Mais vendidos", subtitle: "Seleção baseada no histórico real de vendas", icon: TrendingUp },
  kits: { label: "Kits", subtitle: "Combinações prontas para escolher", icon: ShoppingBag },
  ready_to_deliver: { label: "Pronta entrega", subtitle: "Produtos com estoque disponível agora", icon: Package },
  low_stock: { label: "Últimas unidades", subtitle: "Itens disponíveis com estoque reduzido", icon: Boxes },
  uncategorized: { label: "Sem categoria", subtitle: "Produtos que ainda não foram classificados", icon: Layers3 },
};

const HERO_REASON_LABELS: Record<CatalogHeroReason, string> = {
  manual_featured: "Destaque da loja",
  active_promotion: "Oferta em destaque",
  top_seller: "Mais vendido",
  has_image: "Escolha da vitrine",
  available: "Disponível agora",
};

const GENDER_FILTERS = ["todos", "feminino", "masculino", "unisex"] as const;

function formatCurrency(value: number): string {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function getPromotionalPrice(product: Product): number | null {
  const runtimePromotionalPrice = Number((product as Product & { promotionalPrice?: number }).promotionalPrice || 0);
  const salePrice = Number(product.salePrice || 0);
  if (runtimePromotionalPrice > 0 && runtimePromotionalPrice < salePrice) return runtimePromotionalPrice;
  const discountPercent = Number(product.discountPercent || 0);
  if (discountPercent > 0 && discountPercent < 100) return salePrice * (1 - discountPercent / 100);
  return null;
}

function resolveProductGender(product: Product): string {
  const explicitGender = normalizeProductSearchText(product.gender);
  if (explicitGender) return explicitGender;
  const publicType = normalizeProductSearchText(product.extras?.public_type);
  if (publicType) return publicType;
  const searchable = normalizeProductSearchText(`${product.name} ${product.category}`);
  if (searchable.includes("feminino") || searchable.includes("mulher")) return "feminino";
  if (searchable.includes("masculino") || searchable.includes("homem")) return "masculino";
  return "unisex";
}

function getCategoryOptions(products: Product[]): string[] {
  const labels = new Map<string, string>();
  for (const product of products) {
    const label = String(product.category || "").trim();
    if (!label) continue;
    const key = label.toLocaleLowerCase("pt-BR");
    if (!labels.has(key)) labels.set(key, label);
  }
  return Array.from(labels.values()).sort((left, right) => left.localeCompare(right, "pt-BR"));
}

function CatalogQuantityAction({
  product,
  quantity,
  onAddToCart,
  onUpdateQuantity,
  compact = false,
}: {
  product: Product;
  quantity: number;
  onAddToCart: (product: Product) => void;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  compact?: boolean;
}) {
  const stock = Math.max(0, Number(product.stock || 0));
  if (quantity > 0) {
    return (
      <div className={`flex items-center justify-between gap-2 rounded-2xl bg-slate-100 ${compact ? "p-1.5" : "p-2"}`}>
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
      className={`rounded-2xl bg-primary px-3 font-black text-white shadow-lg shadow-primary/15 transition-all active:scale-[0.98] disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none ${compact ? "min-h-10 text-[11px]" : "min-h-11 text-xs"}`}
    >
      {stock > 0 ? "Adicionar ao carrinho" : "Indisponível"}
    </button>
  );
}

function CatalogProductCard({
  product,
  quantity,
  showPrice,
  showStock,
  onAddToCart,
  onUpdateQuantity,
}: {
  product: Product;
  quantity: number;
  showPrice: boolean;
  showStock: boolean;
  onAddToCart: (product: Product) => void;
  onUpdateQuantity: (productId: string, quantity: number) => void;
}) {
  const price = Number(product.salePrice || 0);
  const promotionalPrice = getPromotionalPrice(product);
  const stock = Math.max(0, Number(product.stock || 0));
  const available = stock > 0;

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:border-primary/30 hover:shadow-md active:scale-[0.99]">
      <div className="relative aspect-[4/5] bg-gradient-to-br from-slate-50 to-primary/5">
        <ProductImageCard product={product} size="full" objectFit="contain" className="!rounded-none !border-0" />
        {promotionalPrice !== null && (
          <span className="absolute left-3 top-3 rounded-full bg-rose-600 px-2.5 py-1 text-[10px] font-black text-white shadow-sm">Oferta</span>
        )}
        {showStock && (
          <span className={`absolute right-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-bold shadow-sm ${available ? "text-emerald-700" : "text-red-600"}`}>
            {available ? `${stock} un.` : "Esgotado"}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3 sm:p-4">
        <div className="min-h-[4.25rem]">
          <p className="truncate text-[10px] font-black uppercase tracking-[0.12em] text-primary">{product.brand || "Sem marca"}</p>
          <h3 className="mt-1 line-clamp-2 text-sm font-extrabold leading-tight text-slate-900">{product.name || "Produto"}</h3>
          <p className="mt-1 truncate text-[11px] font-medium text-slate-500">{product.category || "Sem categoria"}</p>
        </div>
        {showPrice && (
          <div className="mt-auto">
            {promotionalPrice !== null && <p className="text-[11px] font-semibold text-slate-400 line-through">{formatCurrency(price)}</p>}
            <p className="text-lg font-black text-primary sm:text-xl">{formatCurrency(promotionalPrice ?? price)}</p>
          </div>
        )}
        <CatalogQuantityAction
          product={product}
          quantity={quantity}
          onAddToCart={onAddToCart}
          onUpdateQuantity={onUpdateQuantity}
        />
      </div>
    </article>
  );
}

function CatalogCollectionRail({
  collection,
  cartQuantities,
  showPrice,
  showStock,
  onAddToCart,
  onUpdateQuantity,
}: {
  collection: CatalogCollection;
  cartQuantities: ReadonlyMap<string, number>;
  showPrice: boolean;
  showStock: boolean;
  onAddToCart: (product: Product) => void;
  onUpdateQuantity: (productId: string, quantity: number) => void;
}) {
  const presentation = COLLECTION_PRESENTATION[collection.id];
  const Icon = presentation.icon;
  return (
    <section className="space-y-3" data-catalog-collection={collection.id}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span>
            <h2 className="text-lg font-black tracking-tight text-slate-950">{presentation.label}</h2>
          </div>
          <p className="mt-1 text-xs font-medium text-slate-500">{presentation.subtitle}</p>
        </div>
      </div>
      <div className="flex snap-x gap-3 overflow-x-auto pb-2 hide-scrollbar">
        {collection.products.slice(0, 8).map((product) => (
          <div key={`${collection.id}-${product.id}`} className="min-w-[160px] max-w-[160px] snap-start sm:min-w-[190px] sm:max-w-[190px]">
            <CatalogProductCard
              product={product}
              quantity={cartQuantities.get(product.id) || 0}
              showPrice={showPrice}
              showStock={showStock}
              onAddToCart={onAddToCart}
              onUpdateQuantity={onUpdateQuantity}
            />
          </div>
        ))}
      </div>
    </section>
  );
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
      <section className="space-y-3" data-catalog-mode="hub">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-primary">Hub de nichos</p>
          <h2 className="mt-1 text-xl font-black tracking-tight text-slate-950">Explore cada área da loja</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {experience.niches.map((niche) => (
            <button
              type="button"
              key={niche.id}
              onClick={() => onChange(niche.id)}
              className={`min-h-28 rounded-[1.5rem] border p-4 text-left transition-all ${activeNicheId === niche.id ? "border-primary bg-primary text-white shadow-lg shadow-primary/15" : "border-slate-200 bg-white text-slate-900 hover:border-primary/30"}`}
            >
              <span className="text-[10px] font-black uppercase tracking-[0.14em] opacity-75">{niche.isPrimary ? "Principal" : "Nicho"}</span>
              <strong className="mt-2 block text-sm leading-tight">{niche.label}</strong>
              <span className="mt-3 block text-xs font-bold opacity-75">{niche.productCount} produto{niche.productCount === 1 ? "" : "s"}</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3" data-catalog-mode={experience.mode}>
      <div className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
        {experience.mode === "segmented" && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className={`min-h-10 whitespace-nowrap rounded-full border px-4 text-xs font-black transition-all ${!activeNicheId ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-600"}`}
          >
            Visão geral
          </button>
        )}
        {experience.niches.map((niche) => (
          <button
            type="button"
            key={niche.id}
            onClick={() => onChange(niche.id)}
            className={`min-h-10 whitespace-nowrap rounded-full border px-4 text-xs font-black transition-all ${activeNicheId === niche.id ? "border-primary bg-primary text-white shadow-sm" : "border-slate-200 bg-white text-slate-600"}`}
          >
            {niche.label} · {niche.productCount}
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
  onCopyCatalog,
  copied = false,
  onCreateProduct,
  onCreateAd,
  hasMore = false,
  loadingMore = false,
  loadMoreError = "",
  onLoadMore,
}: CatalogShowcaseProps) {
  const [activeNicheId, setActiveNicheId] = useState<string | undefined>(experience.activeNicheId);
  const [logoFailed, setLogoFailed] = useState(false);
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

  useEffect(() => setLogoFailed(false), [store.logoUrl]);

  const activeNiche = findActiveNiche(experience, activeNicheId);
  const scopedProducts = activeNiche
    ? productNicheIds
      ? products.filter((product) => productNicheIds.get(product.id) === activeNiche.id)
      : activeNiche.products
    : products;
  const hero = activeNiche?.hero ?? experience.hero;
  const collections = activeNiche?.quickCollections ?? experience.quickCollections;
  const categoryOptions = useMemo(() => getCategoryOptions(scopedProducts), [scopedProducts]);
  const effectiveCategory = selectedCategory === "todos" || categoryOptions.includes(selectedCategory) ? selectedCategory : "todos";
  const normalizedSearch = useMemo(() => normalizeProductSearchText(searchTerm), [searchTerm]);

  useEffect(() => {
    if (selectedCategory !== effectiveCategory) onCategoryChange(effectiveCategory);
  }, [effectiveCategory, onCategoryChange, selectedCategory]);

  const filteredProducts = useMemo(() => scopedProducts.filter((product) => {
    const searchable = [product.name, product.brand, product.category, product.description, product.productType]
      .map((value) => normalizeProductSearchText(value))
      .join(" ");
    const matchesSearch = !normalizedSearch || searchable.includes(normalizedSearch);
    const matchesCategory = effectiveCategory === "todos"
      || String(product.category || "").toLocaleLowerCase("pt-BR") === effectiveCategory.toLocaleLowerCase("pt-BR");
    const productGender = resolveProductGender(product);
    const matchesGender = selectedGender === "todos" || productGender === normalizeProductSearchText(selectedGender);
    return matchesSearch && matchesCategory && matchesGender;
  }), [effectiveCategory, normalizedSearch, scopedProducts, selectedGender]);

  const showPrice = context === "seller" || store.showPrice !== false;
  const showStock = context === "seller" || store.showStock !== false;
  const heroQuantity = hero ? cartQuantities.get(hero.product.id) || 0 : 0;
  const inventory = experience.inventorySummary;
  const storeName = store.name || "Minha Loja";
  const topCategories = activeNiche?.usedCategories ?? experience.topCategories;
  const showSeparatedOrphans = experience.mode !== "general" && experience.orphanedProducts.length > 0;
  const nicheProductIds = useMemo(
    () => {
      const productIds = new Set(experience.niches.flatMap((niche) => niche.products.map((product) => product.id)));
      productNicheIds?.forEach((nicheId, productId) => {
        if (nicheId) productIds.add(productId);
      });
      return productIds;
    },
    [experience.niches, productNicheIds],
  );
  const orphanIds = useMemo(() => new Set(experience.orphanedProducts.map((product) => product.id)), [experience.orphanedProducts]);
  const unplacedUncategorized = experience.uncategorizedProducts.filter(
    (product) => !nicheProductIds.has(product.id) && !orphanIds.has(product.id),
  );

  const clearFilters = () => {
    onSearchTermChange("");
    onCategoryChange("todos");
    onGenderChange("todos");
  };
  const activeFilterCount = Number(Boolean(searchTerm.trim())) + Number(effectiveCategory !== "todos") + Number(selectedGender !== "todos");

  return (
    <div className="min-h-full bg-[#f8fafc] text-slate-900" data-catalog-showcase={context}>
      <header className="sticky top-0 z-30 border-b border-white/70 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-primary text-xl font-black text-white shadow-lg shadow-primary/15">
              {store.logoUrl && !logoFailed ? (
                <img src={store.logoUrl} alt={storeName} className="h-full w-full object-cover" width={48} height={48} loading="eager" decoding="async" onError={() => setLogoFailed(true)} />
              ) : storeName.charAt(0).toUpperCase() || <Store className="h-5 w-5" />}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-black sm:text-xl">{storeName}</h1>
              <p className="truncate text-[11px] font-semibold text-muted-foreground">
                {context === "seller" ? "Prévia da sua vitrine" : "Catálogo digital"} · {products.length} produtos carregados
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onCreateProduct && (
              <button type="button" onClick={onCreateProduct} className="hidden min-h-11 rounded-2xl border border-slate-200 bg-white px-4 text-xs font-black text-slate-700 sm:inline-flex sm:items-center">Novo produto</button>
            )}
            <button type="button" onClick={onShareCatalog} className="flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-primary shadow-sm" aria-label="Compartilhar catálogo"><Share2 className="h-5 w-5" /></button>
            <button type="button" onClick={onOpenCart} className="relative flex min-h-11 min-w-11 items-center justify-center rounded-2xl bg-primary text-white shadow-lg shadow-primary/20" aria-label="Abrir carrinho">
              <ShoppingCart className="h-5 w-5" />
              {cartCount > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-black text-white ring-2 ring-white">{cartCount}</span>}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-7 px-4 py-5 pb-28 sm:px-6 sm:py-8">
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(260px,0.75fr)]" data-catalog-bento-hero>
          <div className="relative min-h-[320px] overflow-hidden rounded-[2rem] border border-white/70 bg-primary text-white shadow-xl shadow-primary/10">
            {store.bannerUrl ? (
              <img src={store.bannerUrl} alt="Banner da loja" className="absolute inset-0 h-full w-full object-cover" loading="eager" decoding="async" width={1200} height={640} />
            ) : (
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.36),transparent_34%),linear-gradient(135deg,hsl(var(--primary)),#e88b9b_58%,#f5c4cf)]" />
            )}
            <div className="absolute inset-0 bg-slate-950/25" />
            {hero ? (
              <div className="relative grid min-h-[320px] gap-5 p-5 sm:grid-cols-[minmax(0,1fr)_220px] sm:p-8">
                <div className="flex flex-col justify-end">
                  <span className="mb-4 inline-flex w-fit items-center gap-2 rounded-full bg-white/18 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.16em] backdrop-blur"><Sparkles className="h-3.5 w-3.5" /> {HERO_REASON_LABELS[hero.reason]}</span>
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-white/75">{hero.product.brand || hero.product.category || "Produto"}</p>
                  <h2 className="mt-2 max-w-xl text-3xl font-black leading-none tracking-tight sm:text-5xl">{hero.product.name}</h2>
                  {showPrice && <p className="mt-4 text-2xl font-black">{formatCurrency(getPromotionalPrice(hero.product) ?? Number(hero.product.salePrice || 0))}</p>}
                  <div className="mt-5 flex max-w-md flex-col gap-2 sm:flex-row">
                    <div className="min-w-0 flex-1 rounded-2xl bg-white p-1 text-slate-900">
                      <CatalogQuantityAction product={hero.product} quantity={heroQuantity} onAddToCart={onAddToCart} onUpdateQuantity={onUpdateQuantity} compact />
                    </div>
                    {context === "seller" && onCreateAd && (
                      <button type="button" onClick={() => onCreateAd(hero.product)} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 text-xs font-black text-white"><Megaphone className="h-4 w-4" /> Criar anúncio</button>
                    )}
                  </div>
                </div>
                <div className="hidden self-center overflow-hidden rounded-[1.75rem] border border-white/30 bg-white/95 shadow-2xl sm:block">
                  <div className="aspect-square"><ProductImageCard product={hero.product} size="full" objectFit="contain" className="!h-full !w-full !rounded-none !border-0" /></div>
                </div>
              </div>
            ) : (
              <div className="relative flex min-h-[320px] flex-col justify-end p-6 sm:p-8">
                <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15"><Package className="h-6 w-6" /></span>
                <h2 className="text-3xl font-black tracking-tight">{products.length === 0 ? "Sua vitrine começa aqui" : "Estoque indisponível"}</h2>
                <p className="mt-3 max-w-lg text-sm font-medium text-white/85">{products.length === 0 ? "Adicione produtos reais para formar o destaque e as coleções do catálogo." : "Os produtos continuam visíveis, mas nenhum item com estoque positivo pode ser promovido como oferta principal."}</p>
                {context === "seller" && onCreateProduct && <button type="button" onClick={onCreateProduct} className="mt-5 min-h-12 w-fit rounded-2xl bg-white px-5 text-xs font-black text-primary">Cadastrar produto</button>}
              </div>
            )}
          </div>

          <aside className="grid grid-cols-2 gap-3 lg:grid-cols-1">
            <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Disponibilidade</p>
              <strong className="mt-2 block text-3xl font-black text-slate-950">{inventory.availableProducts}</strong>
              <p className="mt-1 text-xs font-semibold text-slate-500">de {inventory.totalProducts} produtos disponíveis</p>
            </div>
            <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">{context === "seller" ? "Estoque baixo" : "Categorias"}</p>
              <strong className="mt-2 block text-3xl font-black text-slate-950">{context === "seller" ? inventory.lowStockProducts : experience.topCategories.length}</strong>
              <p className="mt-1 text-xs font-semibold text-slate-500">{context === "seller" ? `${inventory.totalUnits} unidades no total` : `${inventory.activeNiches} nicho${inventory.activeNiches === 1 ? "" : "s"} ativo${inventory.activeNiches === 1 ? "" : "s"}`}</p>
            </div>
            {context === "seller" && experience.orphanedProducts.length > 0 && (
              <div className="col-span-2 rounded-[1.75rem] border border-amber-200 bg-amber-50 p-5 shadow-sm lg:col-span-1">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-700">Revisão necessária</p>
                <strong className="mt-2 block text-2xl font-black text-amber-950">{experience.orphanedProducts.length} fora dos nichos</strong>
                <p className="mt-1 text-xs font-semibold text-amber-700">Os produtos continuam disponíveis na vitrine.</p>
              </div>
            )}
          </aside>
        </section>

        <NicheSelector experience={experience} activeNicheId={activeNicheId} onChange={(nicheId) => { setActiveNicheId(nicheId); onCategoryChange("todos"); }} />

        {topCategories.length > 0 && (
          <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Top categorias</p>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
              {topCategories.slice(0, 8).map((category) => (
                <button key={category.id} type="button" onClick={() => onCategoryChange(category.label)} className="min-h-10 whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-4 text-xs font-black text-slate-700 transition hover:border-primary/30 hover:text-primary">
                  {category.label} · {category.productCount}
                </button>
              ))}
            </div>
          </section>
        )}

        {collections.map((collection) => (
          <CatalogCollectionRail
            key={collection.id}
            collection={collection}
            cartQuantities={cartQuantities}
            showPrice={showPrice}
            showStock={showStock}
            onAddToCart={onAddToCart}
            onUpdateQuantity={onUpdateQuantity}
          />
        ))}

        <section className="space-y-4 rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm sm:p-5" data-catalog-all-products>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Vitrine completa</p>
              <h2 className="mt-1 text-xl font-black tracking-tight text-slate-950">{activeNiche?.label || "Todos os produtos"}</h2>
              <p className="mt-1 text-xs font-medium text-slate-500">Busca e filtros consideram os produtos já carregados.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {activeFilterCount > 0 && <button type="button" onClick={clearFilters} className="rounded-full bg-slate-950 px-3 py-1.5 text-[11px] font-bold text-white">Limpar {activeFilterCount} filtro{activeFilterCount === 1 ? "" : "s"}</button>}
              {hasMore && <span className="rounded-full bg-amber-50 px-3 py-1.5 text-[11px] font-bold text-amber-700">Há mais produtos para carregar</span>}
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => onSearchTermChange(event.target.value)}
              placeholder="Buscar produto, marca, categoria ou nicho..."
              inputMode="search"
              enterKeyHint="search"
              className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm font-semibold outline-none transition focus:border-primary/40 focus:bg-white focus:ring-4 focus:ring-primary/10"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
            {GENDER_FILTERS.map((gender) => (
              <button key={gender} type="button" onClick={() => onGenderChange(gender)} className={`min-h-10 whitespace-nowrap rounded-full border px-4 text-xs font-bold transition-all ${selectedGender === gender ? "border-primary bg-primary text-white shadow-sm" : "border-slate-200 bg-white text-slate-600"}`}>
                {gender === "todos" ? "Todos" : gender === "unisex" ? "Unissex" : gender.charAt(0).toUpperCase() + gender.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
            <button type="button" onClick={() => onCategoryChange("todos")} className={`min-h-10 whitespace-nowrap rounded-full border px-4 text-xs font-bold transition-all ${effectiveCategory === "todos" ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-600"}`}>Categorias</button>
            {categoryOptions.map((category) => (
              <button key={category} type="button" onClick={() => onCategoryChange(category)} className={`min-h-10 whitespace-nowrap rounded-full border px-4 text-xs font-bold transition-all ${effectiveCategory === category ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-600"}`}>{category}</button>
            ))}
          </div>
        </section>

        {filteredProducts.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4" data-catalog-product-grid>
            {filteredProducts.map((product) => (
              <CatalogProductCard
                key={product.id}
                product={product}
                quantity={cartQuantities.get(product.id) || 0}
                showPrice={showPrice}
                showStock={showStock}
                onAddToCart={onAddToCart}
                onUpdateQuantity={onUpdateQuantity}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center rounded-[2rem] border border-dashed border-slate-300 bg-white px-6 py-16 text-center shadow-sm">
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-[2rem] bg-slate-100"><Package className="h-10 w-10 text-slate-300" /></div>
            <p className="font-black text-slate-800">{scopedProducts.length === 0 ? "Nenhum produto neste nicho" : "Nenhum produto encontrado"}</p>
            <p className="mt-2 max-w-[300px] text-sm leading-relaxed text-muted-foreground">{scopedProducts.length === 0 ? "A vitrine será preenchida assim que houver produtos associados a esta seleção." : "Tente outro termo ou limpe os filtros para voltar à vitrine completa."}</p>
            {scopedProducts.length > 0 && <button type="button" onClick={clearFilters} className="mt-5 min-h-11 rounded-2xl bg-slate-950 px-5 text-xs font-black text-white">Limpar filtros</button>}
          </div>
        )}

        {hasMore && onLoadMore && (
          <div className="flex flex-col items-center gap-3 pt-2">
            {loadMoreError && <p className="text-center text-xs font-semibold text-red-500">{loadMoreError}</p>}
            <button type="button" onClick={onLoadMore} disabled={loadingMore} className="min-h-12 rounded-full bg-primary px-7 py-3 text-sm font-black text-white shadow-lg shadow-primary/15 transition-transform active:scale-[0.98] disabled:opacity-60">{loadingMore ? "Carregando..." : "Carregar mais"}</button>
          </div>
        )}

        {showSeparatedOrphans && (
          <section className="space-y-4 rounded-[2rem] border border-amber-200 bg-amber-50/70 p-4 sm:p-5" data-catalog-orphaned-products>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-700">Outros produtos</p>
              <h2 className="mt-1 text-xl font-black tracking-tight text-amber-950">Fora dos nichos atuais</h2>
              <p className="mt-1 text-xs font-medium text-amber-700">Estes produtos pertencem a um nicho removido e continuam visíveis.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
              {experience.orphanedProducts.map((product) => (
                <CatalogProductCard key={`orphan-${product.id}`} product={product} quantity={cartQuantities.get(product.id) || 0} showPrice={showPrice} showStock={showStock} onAddToCart={onAddToCart} onUpdateQuantity={onUpdateQuantity} />
              ))}
            </div>
          </section>
        )}

        {unplacedUncategorized.length > 0 && experience.mode !== "general" && (
          <section className="space-y-4 rounded-[2rem] border border-slate-200 bg-slate-100/70 p-4 sm:p-5" data-catalog-uncategorized-products>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Sem categoria</p>
              <h2 className="mt-1 text-xl font-black tracking-tight text-slate-950">Produtos ainda não classificados</h2>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
              {unplacedUncategorized.map((product) => (
                <CatalogProductCard key={`uncategorized-${product.id}`} product={product} quantity={cartQuantities.get(product.id) || 0} showPrice={showPrice} showStock={showStock} onAddToCart={onAddToCart} onUpdateQuantity={onUpdateQuantity} />
              ))}
            </div>
          </section>
        )}
      </main>

      {context === "public" && cartCount > 0 && (
        <button type="button" onClick={onOpenCart} className="fixed bottom-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))] left-4 right-4 z-40 mx-auto flex min-h-14 max-w-md items-center justify-between rounded-[1.5rem] bg-slate-950 px-5 text-white shadow-2xl shadow-slate-950/25 transition-transform active:scale-[0.99]">
          <span className="flex items-center gap-2 text-sm font-black"><ShoppingCart className="h-5 w-5" /> Ver pedido · {cartCount} item{cartCount === 1 ? "" : "s"}</span>
          <span className="text-xs font-black">Abrir</span>
        </button>
      )}

      {context === "public" && onCopyCatalog && (
        <div className="mx-auto flex max-w-6xl justify-center gap-2 px-4 pb-8 sm:px-6">
          <button type="button" onClick={onCopyCatalog} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-xs font-black text-primary shadow-sm">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Link copiado" : "Copiar link"}</button>
          <button type="button" onClick={onShareCatalog} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-4 text-xs font-black text-white shadow-sm"><Share2 className="h-4 w-4" /> Compartilhar</button>
        </div>
      )}
    </div>
  );
}
