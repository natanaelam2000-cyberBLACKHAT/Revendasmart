import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams } from "wouter";

import {
  Check,
  Copy,
  Minus,
  Package,
  Plus,
  Search,
  Send,
  Share2,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Store,
  Tag,
  Trash2,
  X,
} from "lucide-react";

import {
  Product,
  AppSettings,
  defaultSettings,
} from "@/lib/mock-data";
import { getApiUrl } from "@/lib/api-config";
import { ProductImageCard } from "@/components/ProductImageCard";
import { PageSkeleton } from "@/components/PageSkeleton";

interface CartItem {
  product: Product;
  quantity: number;
}

interface PublicStoreSettings extends AppSettings {
  storeBannerUrl?: string;
  storeBannerTitle?: string;
  storeBannerSubtitle?: string;
  storeDescription?: string;
  whatsappNumber?: string;
}

const normalize = (value: unknown) => String(value || "").trim().toLowerCase();

const formatCurrency = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const getPromotionalPrice = (product: Product) => {
  const promotionalPrice = Number((product as Product & { promotionalPrice?: number }).promotionalPrice || 0);
  if (promotionalPrice > 0 && promotionalPrice < Number(product.salePrice || 0)) return promotionalPrice;
  if (product.discountPercent && product.discountPercent > 0 && product.discountPercent < 100) {
    return Number(product.salePrice || 0) * (1 - product.discountPercent / 100);
  }
  return null;
};

const getCreatedAtTime = (product: Product) => {
  const raw = (product as Product & { createdAt?: string | number | Date }).createdAt;
  if (!raw) return 0;
  const time = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  return Number.isFinite(time) ? time : 0;
};

export default function PublicCatalog() {
  const { storeSlug } = useParams();
  const [selectedGender, setSelectedGender] = useState("todos");
  const [selectedCategory, setSelectedCategory] = useState("todos");
  const [searchTerm, setSearchTerm] = useState("");
  const [targetUser, setTargetUser] = useState<{ uid: string } | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<PublicStoreSettings>(defaultSettings);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showCart, setShowCart] = useState(false);
  const copyResetTimeoutRef = useRef<number | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);

  useEffect(() => () => {
    if (copyResetTimeoutRef.current !== null) window.clearTimeout(copyResetTimeoutRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLogoFailed(false);
    async function loadCatalog() {
      setLoading(true);
      setLoadFailed(false);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await fetch(getApiUrl(`/api/public/catalog/${encodeURIComponent(storeSlug || "")}`));
          if (response.status === 404) break;
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.json();
          if (cancelled) return;
          setTargetUser({ uid: data.uid || data.settings?.uid || "public" });
          setSettings({ ...defaultSettings, ...(data.settings || {}) });
          setProducts(Array.isArray(data.products) ? data.products : []);
          setNextCursor(typeof data.nextCursor === "string" ? data.nextCursor : null);
          setHasMore(data.hasMore === true);
          setLoadMoreError("");
          setLoading(false);
          return;
        } catch (err) {
          console.warn(`[CATALOG] Tentativa ${attempt + 1} falhou:`, err);
          if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
        }
      }
      if (!cancelled) {
        setTargetUser(null);
        setNextCursor(null);
        setHasMore(false);
        setLoadFailed(true);
        setLoading(false);
      }
    }
    loadCatalog();
    return () => { cancelled = true; };
  }, [storeSlug]);

  const loadMoreProducts = useCallback(async () => {
    if (!storeSlug || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError("");
    try {
      const params = new URLSearchParams({ cursor: nextCursor, limit: "24" });
      if (selectedGender !== "todos") params.set("gender", selectedGender);
      const response = await fetch(getApiUrl(`/api/public/catalog/${encodeURIComponent(storeSlug)}/products?${params.toString()}`));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const nextProducts = Array.isArray(data.products) ? data.products : [];
      setProducts((current) => {
        const seen = new Set(current.map((product) => product.id));
        return [...current, ...nextProducts.filter((product: Product) => product?.id && !seen.has(product.id))];
      });
      setNextCursor(typeof data.nextCursor === "string" ? data.nextCursor : null);
      setHasMore(data.hasMore === true);
    } catch (err) {
      console.warn("[CATALOG] Falha ao carregar mais produtos:", err);
      setLoadMoreError("Não foi possível carregar mais produtos agora. Tente novamente.");
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextCursor, selectedGender, storeSlug]);

  const storeDisplayName = settings?.storeName || "Minha Loja";
  const storeDescription = settings.storeDescription || settings.storeBannerSubtitle || "Escolha seus produtos favoritos e envie seu pedido em poucos cliques.";
  const catalogUrl = typeof window !== "undefined" ? window.location.href : `https://revendasmart.vercel.app/u/${storeSlug || "catalogo"}`;
  const publicWhatsapp = settings.whatsappNumber || settings.whatsapp || settings.phone || "";

  const categories = useMemo(() => {
    const uniqueCategories = Array.from(new Set(products.map(product => product.category || "Geral")));
    return ["todos", ...uniqueCategories.sort((a, b) => String(a).localeCompare(String(b), "pt-BR"))];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const term = normalize(searchTerm);
    return (Array.isArray(products) ? products : []).filter(product => {
      if (!product) return false;
      const matchesGender = selectedGender === "todos" || normalize(product.gender) === normalize(selectedGender);
      const matchesCategory = selectedCategory === "todos" || normalize(product.category) === normalize(selectedCategory);
      const matchesSearch = !term || [product.name, product.brand, product.category, product.description]
        .some(value => normalize(value).includes(term));
      return matchesGender && matchesCategory && matchesSearch;
    });
  }, [products, searchTerm, selectedCategory, selectedGender]);

  const availableProducts = useMemo(() => products.filter(product => product.stock > 0), [products]);

  const featuredProducts = useMemo(() => {
    const featured = availableProducts.filter(product => product.isFeatured);
    return (featured.length > 0 ? featured : availableProducts).slice(0, 6);
  }, [availableProducts]);

  const newestProducts = useMemo(() => {
    const withDates = availableProducts
      .map(product => ({ product, createdAtTime: getCreatedAtTime(product) }))
      .filter(item => item.createdAtTime > 0);
    const source = withDates.length > 0
      ? withDates.sort((a, b) => b.createdAtTime - a.createdAtTime).map(item => item.product)
      : availableProducts;
    return source.slice(0, 6);
  }, [availableProducts]);

  const promoProducts = useMemo(() => availableProducts
    .filter(product => product.isOnSale || getPromotionalPrice(product) !== null)
    .slice(0, 6), [availableProducts]);

  const addToCart = useCallback((product: Product) => {
    if (product.stock <= 0) return;
    setCart(previous => {
      const existing = previous.find(item => item.product.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) return previous;
        return previous.map(item => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...previous, { product, quantity: 1 }];
    });
  }, []);

  const removeFromCart = useCallback((productId: string) => {
    setCart(previous => previous.filter(item => item.product.id !== productId));
  }, []);

  const updateQuantity = useCallback((productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }
    setCart(previous => {
      const item = previous.find(cartItem => cartItem.product.id === productId);
      if (!item || quantity > item.product.stock) return previous;
      return previous.map(cartItem => cartItem.product.id === productId ? { ...cartItem, quantity } : cartItem);
    });
  }, [removeFromCart]);

  const cartQuantities = useMemo(() => new Map(cart.map(item => [item.product.id, item.quantity])), [cart]);
  const cartTotal = useMemo(() => cart.reduce((sum, item) => sum + Number(item.product.salePrice || 0) * item.quantity, 0), [cart]);
  const cartCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);
  const activeFilterCount = useMemo(() => Number(searchTerm.trim().length > 0) + Number(selectedCategory !== "todos") + Number(selectedGender !== "todos"), [searchTerm, selectedCategory, selectedGender]);

  const handleCopyCatalog = async () => {
    try {
      await navigator.clipboard.writeText(catalogUrl);
      setCopied(true);
      if (copyResetTimeoutRef.current !== null) window.clearTimeout(copyResetTimeoutRef.current);
      copyResetTimeoutRef.current = window.setTimeout(() => {
        setCopied(false);
        copyResetTimeoutRef.current = null;
      }, 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleShareCatalog = () => {
    const message = `Conheça o catálogo da ${storeDisplayName}: ${catalogUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
  };

  const handleSendOrderWhatsApp = () => {
    if (cart.length === 0) return;
    let message = `🛍️ *Pedido - ${storeDisplayName}*\n\n`;
    cart.forEach(item => {
      message += `• ${item.product.name}\n`;
      message += `  Qtd: ${item.quantity} | Subtotal: ${formatCurrency(Number(item.product.salePrice || 0) * item.quantity)}\n\n`;
    });
    message += `💰 *Total: ${formatCurrency(cartTotal)}*\n\n`;
    message += `Catálogo: ${catalogUrl}`;
    const phone = publicWhatsapp.replace(/\D/g, "");
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank");
  };

  const clearFilters = () => {
    setSearchTerm("");
    setSelectedCategory("todos");
    setSelectedGender("todos");
  };

  if (loading) {
    return <PageSkeleton variant="publicCatalog" />;
  }

  const catalogEnabled = (settings as PublicStoreSettings & { enablePublicCatalog?: boolean; catalogEnabled?: boolean })?.enablePublicCatalog ?? (settings as PublicStoreSettings & { catalogEnabled?: boolean })?.catalogEnabled ?? true;
  if (!targetUser || catalogEnabled === false || settings?.disablePublicCatalog) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
        <div className="w-20 h-20 bg-secondary rounded-full flex items-center justify-center mb-6">
          <Store className="w-10 h-10 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-bold mb-2">Catálogo Indisponível</h1>
        <p className="text-sm text-muted-foreground">{loadFailed ? "Não foi possível carregar agora. Tente novamente em instantes." : "Este catálogo não foi encontrado ou está desativado pelo consultor."}</p>
      </div>
    );
  }

  const renderProductCard = (product: Product) => {
    const price = Number(product.salePrice || 0);
    const promoPrice = getPromotionalPrice(product);
    const cartQty = cartQuantities.get(product.id) || 0;
    const isAvailable = product.stock > 0;

    return (
      <article key={product.id} className="bg-white rounded-[1.75rem] border border-slate-200 shadow-sm overflow-hidden flex flex-col transition-all duration-200 hover:border-primary/30 hover:shadow-md active:scale-[0.99]">
        <div className="relative aspect-[4/5] bg-gradient-to-br from-slate-50 to-rose-50/60">
          <ProductImageCard product={product} size="full" objectFit="contain" className="!rounded-none !border-0" />
          {promoPrice !== null && <span className="absolute left-3 top-3 rounded-full bg-rose-600 px-2.5 py-1 text-[10px] font-black text-white shadow-sm">Oferta</span>}
          <span className={`absolute right-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-bold shadow-sm ${isAvailable ? "bg-white/90 text-emerald-700" : "bg-white/90 text-red-600"}`}>{isAvailable ? `${product.stock} un.` : "Esgotado"}</span>
        </div>
        <div className="p-3 sm:p-4 flex flex-1 flex-col gap-2">
          <div className="min-h-[4.25rem]">
            <p className="text-[10px] font-black text-primary uppercase tracking-[0.12em] truncate">{product.brand || "Sem marca"}</p>
            <h2 className="mt-1 text-sm font-extrabold leading-tight text-slate-900 line-clamp-2">{product.name || "Produto"}</h2>
            <p className="mt-1 text-[11px] font-medium text-slate-500 truncate">{product.category || "Geral"}</p>
          </div>
          {settings.showPrice !== false && (
            <div className="mt-auto">
              {promoPrice !== null && <p className="text-[11px] font-semibold text-slate-400 line-through">{formatCurrency(price)}</p>}
              <p className="text-lg sm:text-xl font-black text-primary">{formatCurrency(promoPrice ?? price)}</p>
            </div>
          )}
          {cartQty > 0 ? (
            <div className="mt-1 flex items-center justify-between gap-2 rounded-2xl bg-slate-100 p-2">
              <button type="button" onClick={() => updateQuantity(product.id, cartQty - 1)} className="min-h-9 min-w-9 rounded-xl bg-white flex items-center justify-center shadow-sm active:scale-95 transition-transform" aria-label="Diminuir quantidade"><Minus className="w-4 h-4" /></button>
              <span className="text-sm font-black text-slate-900">{cartQty}</span>
              <button type="button" onClick={() => addToCart(product)} disabled={cartQty >= product.stock} className="min-h-9 min-w-9 rounded-xl bg-primary text-white flex items-center justify-center shadow-sm active:scale-95 transition-transform disabled:opacity-40" aria-label="Aumentar quantidade"><Plus className="w-4 h-4" /></button>
            </div>
          ) : (
            <button type="button" onClick={() => addToCart(product)} disabled={!isAvailable} className="mt-1 min-h-11 rounded-2xl bg-primary px-3 py-3 text-xs font-black text-white shadow-lg shadow-primary/15 transition-all duration-200 active:scale-[0.98] disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none">
              {isAvailable ? "Adicionar ao carrinho" : "Indisponível"}
            </button>
          )}
        </div>
      </article>
    );
  };

  const renderProductRail = (title: string, subtitle: string, items: Product[], icon: "sparkles" | "tag" | "bag") => {
    if (items.length === 0) return null;
    const Icon = icon === "tag" ? Tag : icon === "bag" ? ShoppingBag : Sparkles;
    return (
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span>
              <h2 className="text-lg font-black tracking-tight text-slate-950">{title}</h2>
            </div>
            <p className="mt-1 text-xs font-medium text-slate-500">{subtitle}</p>
          </div>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2 hide-scrollbar snap-x">
          {items.map(product => (
            <div key={`${title}-${product.id}`} className="min-w-[160px] max-w-[160px] snap-start sm:min-w-[190px] sm:max-w-[190px]">
              {renderProductCard(product)}
            </div>
          ))}
        </div>
      </section>
    );
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900">
      <header className="sticky top-0 z-30 border-b border-white/70 bg-white/85 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-primary text-white flex shrink-0 items-center justify-center font-black text-xl overflow-hidden shadow-lg shadow-primary/15">{settings?.storeLogo && !logoFailed ? <img src={settings.storeLogo} alt={storeDisplayName} className="w-full h-full object-cover" loading="eager" decoding="async" fetchPriority="high" width={48} height={48} onError={() => setLogoFailed(true)} /> : storeDisplayName.charAt(0).toUpperCase()}</div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-black truncate">{storeDisplayName}</h1>
              <p className="text-[11px] font-semibold text-muted-foreground truncate">Catálogo digital · {products.length} produtos carregados</p>
            </div>
          </div>
          <button type="button" onClick={() => setShowCart(true)} className="relative min-h-11 min-w-11 rounded-2xl bg-primary text-white flex items-center justify-center shadow-lg shadow-primary/20 active:scale-95 transition-transform" aria-label="Abrir carrinho">
            <ShoppingCart className="w-5 h-5" />
            {cartCount > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-black text-white ring-2 ring-white">{cartCount}</span>}
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-7 pb-28">
        <section className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-primary text-white shadow-xl shadow-primary/10">
          {settings.storeBannerUrl ? (
            <img src={settings.storeBannerUrl} alt="Banner da loja" className="absolute inset-0 h-full w-full object-cover" loading="eager" decoding="async" fetchPriority="high" width={1200} height={480} />
          ) : (
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.35),transparent_32%),linear-gradient(135deg,#be5363,#e88b9b_52%,#f5c4cf)]" />
          )}
          <div className="absolute inset-0 bg-slate-950/20" />
          <div className="relative p-5 sm:p-8 min-h-[230px] flex flex-col justify-end">
            <span className="mb-4 inline-flex w-fit items-center gap-2 rounded-full bg-white/18 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.16em] backdrop-blur">Loja online</span>
            <h2 className="max-w-2xl text-3xl sm:text-5xl font-black leading-none tracking-tight">{settings.storeBannerTitle || storeDisplayName}</h2>
            <p className="mt-3 max-w-xl text-sm sm:text-base font-medium text-white/90">{storeDescription}</p>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:flex">
              <button type="button" onClick={handleShareCatalog} className="min-h-12 rounded-2xl bg-[#25D366] px-4 text-sm font-black text-white shadow-lg shadow-black/10 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"><Share2 className="w-4 h-4" /> WhatsApp</button>
              <button type="button" onClick={handleCopyCatalog} className="min-h-12 rounded-2xl bg-white px-4 text-sm font-black text-primary shadow-lg shadow-black/10 active:scale-[0.98] transition-transform flex items-center justify-center gap-2">{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? "Copiado" : "Copiar link"}</button>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2 text-[10px] font-black uppercase tracking-wide text-white/90">
              <span className="rounded-2xl bg-white/15 px-3 py-2 text-center backdrop-blur">WhatsApp</span>
              <span className="rounded-2xl bg-white/15 px-3 py-2 text-center backdrop-blur">Pedido fácil</span>
              <span className="rounded-2xl bg-white/15 px-3 py-2 text-center backdrop-blur">Loja segura</span>
            </div>
          </div>
        </section>

        {renderProductRail("Destaques da loja", "Produtos disponíveis para pedir agora", featuredProducts, "sparkles")}
        {renderProductRail("Novidades", "Itens recentes e sugestões da vitrine", newestProducts, "bag")}
        {renderProductRail("Promoções", "Ofertas cadastradas pela loja", promoProducts, "tag")}

        <section className="rounded-[2rem] border border-slate-200 bg-white p-4 sm:p-5 shadow-sm space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-black tracking-tight text-slate-950">Todos os produtos</h2>
              <p className="text-xs font-medium text-slate-500">Use busca e filtros para encontrar mais rápido.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {activeFilterCount > 0 && <button type="button" onClick={clearFilters} className="rounded-full bg-slate-950 px-3 py-1.5 text-[11px] font-bold text-white">Limpar {activeFilterCount} filtro{activeFilterCount === 1 ? "" : "s"}</button>}
              {hasMore && <p className="rounded-full bg-amber-50 px-3 py-1.5 text-[11px] font-bold text-amber-700">Carregue mais produtos para ampliar a busca.</p>}
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Buscar produto..."
              inputMode="search"
              enterKeyHint="search"
              className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm font-semibold outline-none transition focus:border-primary/40 focus:bg-white focus:ring-4 focus:ring-primary/10"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
            {["todos", "masculino", "feminino", "unisex"].map(gender => (
              <button key={gender} onClick={() => setSelectedGender(gender)} className={`min-h-10 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap border transition-all ${selectedGender === gender ? "bg-primary text-white border-primary shadow-sm" : "bg-white text-slate-600 border-slate-200"}`}>{gender === "todos" ? "Todos" : gender.charAt(0).toUpperCase() + gender.slice(1)}</button>
            ))}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
            {categories.map(category => (
              <button key={category} onClick={() => setSelectedCategory(String(category))} className={`min-h-10 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap border transition-all ${selectedCategory === category ? "bg-slate-950 text-white border-slate-950 shadow-sm" : "bg-white text-slate-600 border-slate-200"}`}>{category === "todos" ? "Categorias" : category}</button>
            ))}
          </div>
        </section>

        {filteredProducts.length > 0 ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">
              {filteredProducts.map(product => renderProductCard(product))}
            </div>
            {hasMore && (
              <div className="flex flex-col items-center gap-3 pt-2">
                {loadMoreError && <p className="text-xs font-semibold text-red-500 text-center">{loadMoreError}</p>}
                <button type="button" onClick={loadMoreProducts} disabled={loadingMore} className="min-h-12 rounded-full bg-primary px-7 py-3 text-sm font-black text-white shadow-lg shadow-primary/15 disabled:opacity-60 active:scale-[0.98] transition-transform">{loadingMore ? "Carregando..." : "Carregar mais"}</button>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center rounded-[2rem] border border-dashed border-slate-300 bg-white px-6 py-20 text-center shadow-sm">
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-[2rem] bg-slate-100"><Package className="h-10 w-10 text-slate-300" /></div>
            <p className="font-black text-slate-800">{products.length === 0 ? "Nenhum produto disponível" : "Nenhum produto encontrado"}</p>
            <p className="mt-2 max-w-[300px] text-sm leading-relaxed text-muted-foreground">{products.length === 0 ? "A loja ainda não publicou produtos neste catálogo. Volte em breve para conferir as novidades." : "Tente outro termo ou limpe os filtros para voltar à vitrine completa."}</p>
            {products.length > 0 && <button type="button" onClick={clearFilters} className="mt-5 min-h-11 rounded-2xl bg-slate-950 px-5 text-xs font-black text-white">Limpar filtros</button>}
          </div>
        )}
      </main>

      {cartCount > 0 && !showCart && (
        <button type="button" onClick={() => setShowCart(true)} className="fixed bottom-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))] left-4 right-4 z-40 mx-auto flex min-h-14 max-w-md items-center justify-between rounded-[1.5rem] bg-slate-950 px-5 text-white shadow-2xl shadow-slate-950/25 active:scale-[0.99] transition-transform">
          <span className="flex items-center gap-2 text-sm font-black"><ShoppingCart className="h-5 w-5" /> Ver pedido · {cartCount} item{cartCount === 1 ? "" : "s"}</span>
          <span className="text-sm font-black">{formatCurrency(cartTotal)}</span>
        </button>
      )}

      {showCart && (
        <div className="fixed inset-0 z-[70] bg-white flex flex-col overflow-hidden">
          <div className="px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-4 flex items-center justify-between border-b border-slate-200">
            <button onClick={() => setShowCart(false)} className="min-h-11 min-w-11 rounded-full bg-slate-100 flex items-center justify-center active:scale-95 transition-transform" aria-label="Fechar pedido"><X className="w-5 h-5" /></button>
            <h3 className="font-black text-lg">Meu Pedido</h3>
            <div className="w-11" />
          </div>
          <div className={`${cart.length === 0 ? "min-h-0 flex-1" : "shrink-0 max-h-[52dvh]"} overflow-y-auto px-5 pt-4 pb-2 space-y-3`}>
            {cart.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-[2rem] bg-primary/10"><ShoppingCart className="h-9 w-9 text-primary/45" /></div>
                <p className="font-black text-slate-900">Seu carrinho está vazio</p>
                <p className="mt-2 max-w-[240px] text-sm leading-relaxed text-muted-foreground">Adicione produtos ao pedido para enviar pelo WhatsApp.</p>
                <button onClick={() => setShowCart(false)} className="mt-5 min-h-12 rounded-2xl bg-primary px-5 text-xs font-black text-white">Continuar comprando</button>
              </div>
            ) : cart.map(item => (
              <div key={item.product.id} className="flex gap-3 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-3.5">
                <div className="w-14 h-14 shrink-0 bg-white rounded-2xl overflow-hidden border border-slate-200"><ProductImageCard product={item.product} size="md" objectFit="contain" /></div>
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-black leading-tight line-clamp-2">{item.product.name}</h4>
                  <p className="mt-1 text-[10px] font-black uppercase tracking-[0.12em] text-primary">{item.product.brand || "Sem marca"}</p>
                  <p className="mt-1.5 text-xs text-slate-500">Preço unitário: {formatCurrency(Number(item.product.salePrice || 0))}</p>
                  <p className="text-sm font-black text-primary">Subtotal: {formatCurrency(Number(item.product.salePrice || 0) * item.quantity)}</p>
                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button onClick={() => updateQuantity(item.product.id, item.quantity - 1)} className="min-h-8 min-w-8 rounded-full bg-white shadow-sm flex items-center justify-center" aria-label="Diminuir quantidade"><Minus className="w-3.5 h-3.5" /></button>
                      <span className="text-sm font-black">{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.product.id, item.quantity + 1)} disabled={item.quantity >= item.product.stock} className="min-h-8 min-w-8 rounded-full bg-white shadow-sm flex items-center justify-center disabled:opacity-40" aria-label="Aumentar quantidade"><Plus className="w-3.5 h-3.5" /></button>
                    </div>
                    <button onClick={() => removeFromCart(item.product.id)} className="flex items-center gap-1 text-[11px] font-black text-red-600"><Trash2 className="w-3.5 h-3.5" /> Remover</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {cart.length > 0 && (
            <div className="shrink-0 border-t border-slate-200 bg-white px-5 pt-3 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))] space-y-2.5 shadow-[0_-10px_30px_rgba(15,23,42,0.06)]">
              <div className="rounded-2xl bg-slate-50 p-3.5 space-y-2">
                <div className="flex items-center justify-between"><span className="text-xs font-bold text-slate-500">Itens</span><span className="text-sm font-black">{cartCount}</span></div>
                <div className="flex items-center justify-between border-t border-slate-200 pt-2.5"><span className="text-sm font-black text-slate-600">Total</span><span className="text-2xl font-black text-slate-950">{formatCurrency(cartTotal)}</span></div>
              </div>
              <button onClick={() => setShowCart(false)} className="min-h-11 w-full rounded-2xl text-xs font-black text-primary">Continuar comprando</button>
              <button onClick={handleSendOrderWhatsApp} className="min-h-14 w-full rounded-[1.5rem] bg-[#25D366] text-white font-black flex items-center justify-center gap-3 shadow-xl shadow-green-200 active:scale-[0.99] transition-transform"><Send className="w-5 h-5" /> Enviar pedido no WhatsApp</button>
            </div>
          )}
        </div>
      )}

      <footer className="py-8 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Criado com Revenda Smart</footer>
    </div>
  );
}
