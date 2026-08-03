import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Loader2, Minus, Plus, Send, Share2, ShoppingCart, Trash2, X } from "lucide-react";
import { CatalogShowcase } from "@/components/catalog/CatalogShowcase";
import { PageSkeleton } from "@/components/PageSkeleton";
import { ProductImageCard } from "@/components/ProductImageCard";
import { Layout } from "@/components/layout";
import { useProductsData } from "@/hooks/useProductsData";
import { useSalesData } from "@/hooks/useSalesData";
import { getApiUrl } from "@/lib/api-config";
import { resolveCatalogExperience } from "@/lib/catalog-experience";
import { getFirebaseAuth, logTelemetryEvent, measureOperation, trackAnalyticsEvent } from "@/lib/firebase";
import type { AppSettings, Product } from "@/lib/mock-data";
import { buildPublicCatalogUrl } from "@/lib/public-url";
import { useUserSettings } from "@/providers/UserSettingsProvider";

interface CartItem {
  product: Product;
  quantity: number;
}

type CatalogStoreSettings = AppSettings & {
  storeBannerUrl?: string;
  storeBannerTitle?: string;
  storeBannerSubtitle?: string;
  storeDescription?: string;
};

export default function Catalog() {
  const { products, loading } = useProductsData();
  const { sales, loading: salesLoading } = useSalesData();
  const { settings } = useUserSettings();
  const [search, setSearch] = useState("");
  const [genderFilter, setGenderFilter] = useState("todos");
  const [categoryFilter, setCategoryFilter] = useState("todos");
  const [showShareModal, setShowShareModal] = useState(false);
  const [showCart, setShowCart] = useState(false);
  const [copied, setCopied] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const experienceNowRef = useRef(new Date());

  useEffect(() => () => {
    if (copyResetTimeoutRef.current) clearTimeout(copyResetTimeoutRef.current);
  }, []);

  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const experience = useMemo(() => resolveCatalogExperience({
    businessType: settings?.businessType,
    businessTypes: settings?.businessTypes,
    customCategoriesByNicho: settings?.customCategoriesByNicho,
    products,
    sales,
    lowStockThreshold: settings?.lowStockThreshold ?? 3,
    now: experienceNowRef.current,
  }), [products, sales, settings?.businessType, settings?.businessTypes, settings?.customCategoriesByNicho, settings?.lowStockThreshold]);

  const addToCart = (product: Product) => {
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
  };

  const removeFromCart = (productId: string) => {
    setCart((previous) => previous.filter((item) => item.product.id !== productId));
  };

  const updateQuantity = (productId: string, newQuantity: number) => {
    if (newQuantity <= 0) {
      removeFromCart(productId);
      return;
    }
    const product = productById.get(productId);
    if (!product || newQuantity > Number(product.stock || 0)) return;
    setCart((previous) => previous.map((item) => item.product.id === productId ? { ...item, quantity: newQuantity } : item));
  };

  const cartQuantities = useMemo(() => new Map(cart.map((item) => [item.product.id, item.quantity])), [cart]);
  const cartTotal = useMemo(() => cart.reduce((sum, item) => sum + Number(item.product.salePrice || 0) * item.quantity, 0), [cart]);
  const cartCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);
  const catalogSettings = settings as CatalogStoreSettings | undefined;
  const catalogSlug = settings?.catalogSlug || settings?.catalog_slug || "seu-catalogo";
  const catalogUrl = buildPublicCatalogUrl(catalogSlug);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(catalogUrl);
      setCopied(true);
      if (copyResetTimeoutRef.current) clearTimeout(copyResetTimeoutRef.current);
      copyResetTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
      const user = getFirebaseAuth()?.currentUser;
      logTelemetryEvent("catalog_link_shared", { catalogSlug }, user?.uid);
      trackAnalyticsEvent("catalog_shared", { method: "copy" });
    } catch {
      setCopied(false);
    }
  };

  const handleShareWhatsApp = () => {
    const message = `Confira meu catálogo de produtos! ${catalogUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
    setShowShareModal(false);
    const user = getFirebaseAuth()?.currentUser;
    logTelemetryEvent("catalog_link_shared", { catalogSlug }, user?.uid);
    trackAnalyticsEvent("catalog_shared", { method: "whatsapp" });
  };

  const handleSendOrderWhatsApp = () => {
    if (cart.length === 0) return;
    let message = "🛍️ *Novo Pedido*\n\n";
    for (const item of cart) {
      message += `• ${item.product.name}\n`;
      message += `  Qtd: ${item.quantity} | R$ ${(Number(item.product.salePrice || 0) * item.quantity).toFixed(2)}\n\n`;
    }
    message += `💰 *Total: R$ ${cartTotal.toFixed(2)}*\n\n`;
    message += `Visite meu catálogo: ${catalogUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
  };

  const handleMercadoPagoCheckout = async () => {
    if (cart.length === 0) {
      setCheckoutError("Adicione produtos ao carrinho");
      return;
    }

    const user = getFirebaseAuth()?.currentUser;
    if (!user) {
      setCheckoutError("Você precisa estar autenticado para pagar");
      return;
    }

    setCheckoutLoading(true);
    setCheckoutError("");
    try {
      const response = await measureOperation("catalog_checkout", async () => {
        const token = await user.getIdToken();
        const cartId = Math.random().toString(36).slice(2, 11);
        return fetch(getApiUrl("/api/payments/create-link"), {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            uid: user.uid,
            clientId: "catalog",
            title: `Catálogo - Pedido ${cartId}`,
            description: `${cart.length} produto(s)`,
            amount: cartTotal,
            metadata: {
              cartId,
              itemCount: cart.length,
              items: cart.map((item) => ({
                productId: item.product.id,
                name: item.product.name,
                quantity: item.quantity,
                price: item.product.salePrice,
              })),
            },
          }),
        });
      });
      const data = await response.json();
      if (!response.ok) {
        const technicalMessage = String(data?.message || data?.error || "");
        const friendlyMessage = data?.userMessage || data?.details || (/Unsupported state|unable to authenticate|decrypt/i.test(technicalMessage)
          ? "A conexão com o Mercado Pago precisa ser renovada em Ajustes."
          : "Não foi possível iniciar o pagamento agora. Tente novamente.");
        console.error("[catalog/checkout] Preference creation failed", { status: response.status, stage: data?.stage || "unknown", error: technicalMessage });
        throw new Error(friendlyMessage);
      }
      if (!data.paymentUrl) throw new Error("Erro: URL de pagamento inválida");
      window.location.href = data.paymentUrl;
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : "Erro ao processar pagamento");
      console.error("[catalog] Checkout error:", error);
    } finally {
      setCheckoutLoading(false);
    }
  };

  if (loading || salesLoading) {
    return <Layout title="Catálogo"><PageSkeleton variant="cards" /></Layout>;
  }

  return (
    <Layout title="Catálogo">
      <CatalogShowcase
        context="seller"
        experience={experience}
        products={products}
        store={{
          name: settings?.storeName || "Minha Loja",
          logoUrl: settings?.storeLogo,
          bannerUrl: catalogSettings?.storeBannerUrl || settings?.storeIdentity?.heroImageUrl,
          bannerTitle: catalogSettings?.storeBannerTitle,
          description: catalogSettings?.storeDescription || catalogSettings?.storeBannerSubtitle,
          showPrice: true,
          showStock: true,
        }}
        searchTerm={search}
        selectedCategory={categoryFilter}
        selectedGender={genderFilter}
        cartQuantities={cartQuantities}
        cartCount={cartCount}
        onSearchTermChange={setSearch}
        onCategoryChange={setCategoryFilter}
        onGenderChange={setGenderFilter}
        onAddToCart={addToCart}
        onUpdateQuantity={updateQuantity}
        onOpenCart={() => setShowCart(true)}
        onShareCatalog={() => setShowShareModal(true)}
        onCreateProduct={() => { window.location.href = "/add-product"; }}
        onCreateAd={(product) => { window.location.href = `/marketing?productId=${encodeURIComponent(product.id)}&source=catalog`; }}
      />

      {showCart && (
        <div className="rs-sheet-enter fixed inset-0 z-[70] flex flex-col bg-white">
          <div className="flex items-center justify-between border-b border-border/40 px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
            <button onClick={() => setShowCart(false)} className="rs-icon-press flex h-10 w-10 items-center justify-center rounded-full bg-secondary" aria-label="Fechar pedido"><X className="h-5 w-5" /></button>
            <h3 className="text-lg font-semibold">Meu Pedido</h3>
            <div className="w-10" />
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            {cart.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-[2rem] bg-primary/10"><ShoppingCart className="h-9 w-9 text-primary/45" /></div>
                <p className="font-semibold text-foreground">Seu carrinho está vazio</p>
                <p className="mt-2 max-w-[240px] text-xs leading-relaxed text-muted-foreground">Adicione produtos ao pedido para enviar pelo WhatsApp ou pagar online.</p>
                <button onClick={() => setShowCart(false)} className="rs-pressable mt-5 rounded-2xl bg-primary px-5 py-3 text-xs font-semibold text-white">Continuar comprando</button>
              </div>
            ) : cart.map((item) => (
              <div key={item.product.id} className="rs-card-interactive flex gap-4 rounded-[2rem] border border-border/40 bg-[#F8F9FA] p-4">
                <div className="h-16 w-16 overflow-hidden rounded-2xl border border-border/20 bg-white"><ProductImageCard product={item.product} size="md" objectFit="contain" /></div>
                <div className="min-w-0 flex-1">
                  <h4 className="mb-1 line-clamp-2 text-xs font-bold leading-tight">{item.product.name}</h4>
                  <p className="text-[10px] font-semibold text-primary/80">{item.product.brand || "Sem marca"}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">Preço unitário: R$ {Number(item.product.salePrice || 0).toFixed(2)}</p>
                  <p className="mt-1 text-xs font-semibold text-primary">Subtotal: R$ {(Number(item.product.salePrice || 0) * item.quantity).toFixed(2)}</p>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button onClick={() => updateQuantity(item.product.id, item.quantity - 1)} className="rs-icon-press flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-sm" aria-label="Diminuir quantidade"><Minus className="h-3 w-3" /></button>
                      <span className="text-xs font-semibold">{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.product.id, item.quantity + 1)} disabled={item.quantity >= Number(item.product.stock || 0)} className="rs-icon-press flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-sm disabled:opacity-40" aria-label="Aumentar quantidade"><Plus className="h-3 w-3" /></button>
                    </div>
                    <button onClick={() => removeFromCart(item.product.id)} className="rs-pressable flex items-center gap-1 text-[9px] font-bold text-red-600"><Trash2 className="h-3.5 w-3.5" /> Remover</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {cart.length > 0 && (
            <div className="space-y-3 border-t border-border/40 bg-white px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
              <div className="space-y-2 rounded-2xl bg-secondary/20 p-4">
                <div className="flex items-center justify-between"><span className="text-[10px] font-bold text-muted-foreground">Itens</span><span className="text-sm font-semibold">{cartCount}</span></div>
                <div className="flex items-center justify-between border-t border-border/30 pt-2"><span className="text-xs font-semibold text-muted-foreground">Total</span><span className="text-2xl font-semibold text-foreground">R$ {cartTotal.toFixed(2)}</span></div>
              </div>
              <button onClick={() => setShowCart(false)} className="rs-pressable w-full py-3 text-xs font-semibold text-primary">Continuar comprando</button>
              <button onClick={handleSendOrderWhatsApp} className="rs-pressable flex w-full items-center justify-center gap-3 rounded-[2rem] bg-[#25D366] py-5 font-semibold text-white shadow-xl shadow-green-200"><Send className="h-5 w-5" /> Enviar Pedido no WhatsApp</button>
              <button onClick={handleMercadoPagoCheckout} disabled={checkoutLoading} className="rs-pressable flex w-full items-center justify-center gap-3 rounded-[2rem] bg-primary py-5 font-semibold text-white shadow-xl shadow-primary/20 disabled:opacity-60">
                {checkoutLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShoppingCart className="h-5 w-5" />} Pagar com Pix / Cartão de Crédito
              </button>
              {checkoutError && <p className="text-center text-[10px] font-bold text-red-500">{checkoutError}</p>}
            </div>
          )}
        </div>
      )}

      {showShareModal && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:p-4">
          <div className="rs-sheet-enter max-h-[calc(100dvh-1rem)] w-full max-w-md space-y-5 overflow-y-auto overscroll-contain rounded-t-[2rem] bg-white px-5 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-5 sm:rounded-[2rem] sm:p-7">
            <div className="flex items-center justify-between">
              <h3 className="text-2xl font-semibold tracking-tight">Compartilhar Catálogo</h3>
              <button onClick={() => setShowShareModal(false)} className="rs-icon-press flex h-10 w-10 items-center justify-center rounded-full bg-secondary" aria-label="Fechar compartilhamento"><X className="h-5 w-5" /></button>
            </div>
            <div className="rounded-2xl border border-border/40 bg-secondary/30 p-3"><p className="mb-1 text-[10px] font-medium text-muted-foreground">Link do catálogo</p><p className="break-all font-mono text-xs text-foreground">{catalogUrl}</p></div>
            <div className="grid grid-cols-2 gap-4">
              <button onClick={handleShareWhatsApp} className="rs-pressable flex flex-col items-center gap-3 rounded-[2rem] border border-green-100 bg-green-50 p-5"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-green-500 shadow-lg shadow-green-200"><Share2 className="h-6 w-6 text-white" /></div><span className="text-xs font-semibold text-green-700">WhatsApp</span></button>
              <button onClick={handleCopyLink} className="rs-pressable flex flex-col items-center gap-3 rounded-[2rem] border border-primary/10 bg-primary/5 p-5"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/20">{copied ? <Check className="h-6 w-6 text-white" /> : <Copy className="h-6 w-6 text-white" />}</div><span className="text-xs font-semibold text-primary">{copied ? "Copiado!" : "Copiar Link"}</span></button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
