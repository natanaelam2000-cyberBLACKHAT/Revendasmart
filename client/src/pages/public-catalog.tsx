import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Send, ShoppingCart, Store, Trash2, X, Minus, Plus } from "lucide-react";
import { useParams } from "wouter";
import { CatalogShowcase } from "@/components/catalog/CatalogShowcase";
import { PageSkeleton } from "@/components/PageSkeleton";
import { ProductImageCard } from "@/components/ProductImageCard";
import { getApiUrl } from "@/lib/api-config";
import { buildPublicProductNicheMap, toCatalogExperience, toCatalogProduct } from "@/lib/public-catalog-adapter";
import type { Product } from "@/lib/mock-data";
import type {
  PublicCatalogPageResponse,
  PublicCatalogPresentation,
  PublicCatalogProduct,
  PublicCatalogResponse,
  PublicCatalogStore,
} from "@shared/public-catalog";

interface CartItem {
  product: Product;
  quantity: number;
}

function formatCurrency(value: number): string {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function PublicCatalog() {
  const { storeSlug } = useParams();
  const [selectedGender, setSelectedGender] = useState("todos");
  const [selectedCategory, setSelectedCategory] = useState("todos");
  const [searchTerm, setSearchTerm] = useState("");
  const [store, setStore] = useState<PublicCatalogStore | null>(null);
  const [presentation, setPresentation] = useState<PublicCatalogPresentation | null>(null);
  const [publicProducts, setPublicProducts] = useState<PublicCatalogProduct[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showCart, setShowCart] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const copyResetTimeoutRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (copyResetTimeoutRef.current !== null) window.clearTimeout(copyResetTimeoutRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadCatalog() {
      setLoading(true);
      setLoadFailed(false);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await fetch(getApiUrl(`/api/public/catalog/${encodeURIComponent(storeSlug || "")}`));
          if (response.status === 404) break;
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.json() as PublicCatalogResponse;
          if (!data.store || !data.presentation || !Array.isArray(data.products) || !data.pagination) {
            throw new Error("INVALID_PUBLIC_CATALOG_RESPONSE");
          }
          if (cancelled) return;
          setStore(data.store);
          setPresentation(data.presentation);
          setPublicProducts(data.products);
          setNextCursor(typeof data.pagination.nextCursor === "string" ? data.pagination.nextCursor : null);
          setHasMore(data.pagination.hasMore === true);
          setLoadMoreError("");
          setLoading(false);
          return;
        } catch (error) {
          console.warn(`[CATALOG] Tentativa ${attempt + 1} falhou:`, error);
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
        }
      }
      if (!cancelled) {
        setStore(null);
        setPresentation(null);
        setPublicProducts([]);
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
      const data = await response.json() as PublicCatalogPageResponse;
      const nextProducts = Array.isArray(data.products) ? data.products : [];
      setPublicProducts((current) => {
        const seen = new Set(current.map((product) => product.id));
        return [...current, ...nextProducts.filter((product) => product?.id && !seen.has(product.id))];
      });
      setNextCursor(typeof data.pagination?.nextCursor === "string" ? data.pagination.nextCursor : null);
      setHasMore(data.pagination?.hasMore === true);
    } catch (error) {
      console.warn("[CATALOG] Falha ao carregar mais produtos:", error);
      setLoadMoreError("Não foi possível carregar mais produtos agora. Tente novamente.");
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextCursor, selectedGender, storeSlug]);

  const products = useMemo(() => publicProducts.map(toCatalogProduct), [publicProducts]);
  const experience = useMemo(() => presentation ? toCatalogExperience(presentation) : null, [presentation]);
  const productNicheIds = useMemo(
    () => presentation ? buildPublicProductNicheMap(presentation, publicProducts) : new Map<string, string>(),
    [presentation, publicProducts],
  );

  const addToCart = useCallback((product: Product) => {
    const stock = Math.max(0, Number(product.stock || 0));
    if (stock <= 0) return;
    setCart((previous) => {
      const existing = previous.find((item) => item.product.id === product.id);
      if (existing) {
        if (existing.quantity >= stock) return previous;
        return previous.map((item) => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...previous, { product, quantity: 1 }];
    });
  }, []);

  const removeFromCart = useCallback((productId: string) => {
    setCart((previous) => previous.filter((item) => item.product.id !== productId));
  }, []);

  const updateQuantity = useCallback((productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }
    setCart((previous) => {
      const item = previous.find((cartItem) => cartItem.product.id === productId);
      if (!item || quantity > Number(item.product.stock || 0)) return previous;
      return previous.map((cartItem) => cartItem.product.id === productId ? { ...cartItem, quantity } : cartItem);
    });
  }, [removeFromCart]);

  const cartQuantities = useMemo(() => new Map(cart.map((item) => [item.product.id, item.quantity])), [cart]);
  const cartTotal = useMemo(() => cart.reduce((sum, item) => sum + Number(item.product.salePrice || 0) * item.quantity, 0), [cart]);
  const cartCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);
  const storeDisplayName = store?.name || "Minha Loja";
  const storeDescription = store?.description || store?.bannerSubtitle || "Escolha seus produtos favoritos e envie seu pedido em poucos cliques.";
  const catalogUrl = typeof window !== "undefined" ? window.location.href : `https://revendasmart.vercel.app/u/${storeSlug || "catalogo"}`;
  const publicWhatsapp = store?.whatsappNumber || "";

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
    for (const item of cart) {
      message += `• ${item.product.name}\n`;
      message += `  Qtd: ${item.quantity} | Subtotal: ${formatCurrency(Number(item.product.salePrice || 0) * item.quantity)}\n\n`;
    }
    message += `💰 *Total: ${formatCurrency(cartTotal)}*\n\n`;
    message += `Catálogo: ${catalogUrl}`;
    const phone = publicWhatsapp.replace(/\D/g, "");
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank");
  };

  if (loading) return <PageSkeleton variant="publicCatalog" />;

  if (!store || !experience) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-secondary"><Store className="h-10 w-10 text-muted-foreground" /></div>
        <h1 className="mb-2 text-xl font-bold">Catálogo Indisponível</h1>
        <p className="text-sm text-muted-foreground">{loadFailed ? "Não foi possível carregar agora. Tente novamente em instantes." : "Este catálogo não foi encontrado ou está desativado pelo consultor."}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <CatalogShowcase
        context="public"
        experience={experience}
        products={products}
        store={{
          name: storeDisplayName,
          logoUrl: store.logoUrl,
          bannerUrl: store.bannerUrl,
          bannerTitle: store.bannerTitle,
          description: storeDescription,
          showPrice: store.showPrice,
          showStock: store.showStock,
        }}
        searchTerm={searchTerm}
        selectedCategory={selectedCategory}
        selectedGender={selectedGender}
        cartQuantities={cartQuantities}
        productNicheIds={productNicheIds}
        cartCount={cartCount}
        onSearchTermChange={setSearchTerm}
        onCategoryChange={setSelectedCategory}
        onGenderChange={setSelectedGender}
        onAddToCart={addToCart}
        onUpdateQuantity={updateQuantity}
        onOpenCart={() => setShowCart(true)}
        onShareCatalog={handleShareCatalog}
        onCopyCatalog={handleCopyCatalog}
        copied={copied}
        hasMore={hasMore}
        loadingMore={loadingMore}
        loadMoreError={loadMoreError}
        onLoadMore={loadMoreProducts}
      />

      {showCart && (
        <div className="fixed inset-0 z-[70] flex flex-col overflow-hidden bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
            <button onClick={() => setShowCart(false)} className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-slate-100 transition-transform active:scale-95" aria-label="Fechar pedido"><X className="h-5 w-5" /></button>
            <h3 className="text-lg font-black">Meu Pedido</h3>
            <div className="w-11" />
          </div>
          <div className={`${cart.length === 0 ? "min-h-0 flex-1" : "max-h-[52dvh] shrink-0"} space-y-3 overflow-y-auto px-5 pb-2 pt-4`}>
            {cart.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-[2rem] bg-primary/10"><ShoppingCart className="h-9 w-9 text-primary/45" /></div>
                <p className="font-black text-slate-900">Seu carrinho está vazio</p>
                <p className="mt-2 max-w-[240px] text-sm leading-relaxed text-muted-foreground">Adicione produtos ao pedido para enviar pelo WhatsApp.</p>
                <button onClick={() => setShowCart(false)} className="mt-5 min-h-12 rounded-2xl bg-primary px-5 text-xs font-black text-white">Continuar comprando</button>
              </div>
            ) : cart.map((item) => (
              <div key={item.product.id} className="flex gap-3 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-3.5">
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white"><ProductImageCard product={item.product} size="md" objectFit="contain" /></div>
                <div className="min-w-0 flex-1">
                  <h4 className="line-clamp-2 text-sm font-black leading-tight">{item.product.name}</h4>
                  <p className="mt-1 text-[10px] font-black uppercase tracking-[0.12em] text-primary">{item.product.brand || "Sem marca"}</p>
                  <p className="mt-1.5 text-xs text-slate-500">Preço unitário: {formatCurrency(Number(item.product.salePrice || 0))}</p>
                  <p className="text-sm font-black text-primary">Subtotal: {formatCurrency(Number(item.product.salePrice || 0) * item.quantity)}</p>
                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button onClick={() => updateQuantity(item.product.id, item.quantity - 1)} className="flex min-h-8 min-w-8 items-center justify-center rounded-full bg-white shadow-sm" aria-label="Diminuir quantidade"><Minus className="h-3.5 w-3.5" /></button>
                      <span className="text-sm font-black">{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.product.id, item.quantity + 1)} disabled={item.quantity >= Number(item.product.stock || 0)} className="flex min-h-8 min-w-8 items-center justify-center rounded-full bg-white shadow-sm disabled:opacity-40" aria-label="Aumentar quantidade"><Plus className="h-3.5 w-3.5" /></button>
                    </div>
                    <button onClick={() => removeFromCart(item.product.id)} className="flex items-center gap-1 text-[11px] font-black text-red-600"><Trash2 className="h-3.5 w-3.5" /> Remover</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {cart.length > 0 && (
            <div className="shrink-0 space-y-2.5 border-t border-slate-200 bg-white px-5 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))] pt-3 shadow-[0_-10px_30px_rgba(15,23,42,0.06)]">
              <div className="space-y-2 rounded-2xl bg-slate-50 p-3.5">
                <div className="flex items-center justify-between"><span className="text-xs font-bold text-slate-500">Itens</span><span className="text-sm font-black">{cartCount}</span></div>
                <div className="flex items-center justify-between border-t border-slate-200 pt-2.5"><span className="text-sm font-black text-slate-600">Total</span><span className="text-2xl font-black text-slate-950">{formatCurrency(cartTotal)}</span></div>
              </div>
              <button onClick={() => setShowCart(false)} className="min-h-11 w-full rounded-2xl text-xs font-black text-primary">Continuar comprando</button>
              <button onClick={handleSendOrderWhatsApp} className="flex min-h-14 w-full items-center justify-center gap-3 rounded-[1.5rem] bg-[#25D366] font-black text-white shadow-xl shadow-green-200 transition-transform active:scale-[0.99]"><Send className="h-5 w-5" /> Enviar pedido no WhatsApp</button>
            </div>
          )}
        </div>
      )}

      <footer className="py-8 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Criado com Revenda Smart</footer>
    </div>
  );
}
