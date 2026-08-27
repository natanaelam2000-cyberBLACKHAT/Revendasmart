import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, Send, ShoppingCart, Trash2, X } from "lucide-react";
import { CatalogShowcase } from "@/components/catalog/CatalogShowcase";
import { ShareCatalogSheet } from "@/components/catalog/ShareCatalogSheet";
import { PageSkeleton } from "@/components/PageSkeleton";
import { ProductImageCard } from "@/components/ProductImageCard";
import { Layout } from "@/components/layout";
import { useProductsData } from "@/hooks/useProductsData";
import { useSalesData } from "@/hooks/useSalesData";
import { resolveCatalogExperience } from "@/lib/catalog-experience";
import { getFirebaseAuth, logTelemetryEvent, trackAnalyticsEvent } from "@/lib/firebase";
import type { AppSettings, Product } from "@/lib/mock-data";
import { notifyInfo, notifyWarning } from "@/lib/notify";
import { buildPublicCatalogUrl } from "@/lib/public-url";
import { useUserSettings } from "@/providers/UserSettingsProvider";

type CatalogStoreSettings = AppSettings & {
  storeBannerUrl?: string;
  storeBannerTitle?: string;
  storeBannerSubtitle?: string;
  storeDescription?: string;
};

interface CartItem {
  product: Product;
  quantity: number;
}

// REVENDASMART-CATALOG-GOLDEN-RESTORE-05 — o carrinho de prévia foi restaurado fielmente do commit
// histórico (6de2c85: card com estoque real limitando quantidade, carrinho no header com badge). O que
// NÃO foi trazido de volta: o botão antigo de "Pagar com Mercado Pago" que existia no drawer daquele
// commit (endpoint legado, não-idempotente) — preservar o contrato atual de checkout (público, com
// Pix/idempotência) significa não recriar um checkout paralelo aqui. "Ver pedido" na aba
// interna serve só para o vendedor pré-visualizar/montar um pedido e enviá-lo por WhatsApp — nunca para
// processar pagamento nem decrementar estoque de verdade (isso continua exclusivo de Vendas).

export default function Catalog() {
  const { products, loading, error: productsError } = useProductsData();
  const { sales, loading: salesLoading, error: salesError } = useSalesData();
  const dataError = productsError || salesError;
  const { settings } = useUserSettings();
  const [search, setSearch] = useState("");
  const [genderFilter, setGenderFilter] = useState("todos");
  const [categoryFilter, setCategoryFilter] = useState("todos");
  const [showShareModal, setShowShareModal] = useState(false);
  const [showCart, setShowCart] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [copied, setCopied] = useState(false);
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const experienceNowRef = useRef(new Date());

  useEffect(() => () => {
    if (copyResetTimeoutRef.current) clearTimeout(copyResetTimeoutRef.current);
  }, []);

  const experience = useMemo(() => resolveCatalogExperience({
    businessType: settings?.businessType,
    businessTypes: settings?.businessTypes,
    customCategoriesByNicho: settings?.customCategoriesByNicho,
    products,
    sales,
    lowStockThreshold: settings?.lowStockThreshold ?? 3,
    now: experienceNowRef.current,
  }), [products, sales, settings?.businessType, settings?.businessTypes, settings?.customCategoriesByNicho, settings?.lowStockThreshold]);

  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);

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
  const hasCatalogSlug = Boolean(settings?.catalogSlug || settings?.catalog_slug);
  const catalogSlug = settings?.catalogSlug || settings?.catalog_slug || "seu-catalogo";
  const catalogUrl = buildPublicCatalogUrl(catalogSlug);

  const handleCopyLink = async () => {
    if (!hasCatalogSlug) {
      notifyWarning("Configure o link do seu catálogo em Configurações antes de compartilhar.");
      return;
    }
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
    if (!hasCatalogSlug) {
      notifyWarning("Configure o link do seu catálogo em Configurações antes de compartilhar.");
      return;
    }
    const message = `Confira meu catálogo de produtos! ${catalogUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
    setShowShareModal(false);
    const user = getFirebaseAuth()?.currentUser;
    logTelemetryEvent("catalog_link_shared", { catalogSlug }, user?.uid);
    trackAnalyticsEvent("catalog_shared", { method: "whatsapp" });
  };

  const handleShareInstagram = async () => {
    if (!hasCatalogSlug) {
      notifyWarning("Configure o link do seu catálogo em Configurações antes de compartilhar.");
      return;
    }
    const user = getFirebaseAuth()?.currentUser;
    const text = `Confira meu catálogo de produtos! ${catalogUrl}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Meu catálogo", text, url: catalogUrl });
        logTelemetryEvent("catalog_link_shared", { catalogSlug }, user?.uid);
        trackAnalyticsEvent("catalog_shared", { method: "instagram" });
      } catch {
        // Usuário cancelou o share sheet nativo — nenhuma ação necessária.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(catalogUrl);
      notifyInfo("Link copiado. Cole no Instagram.");
      logTelemetryEvent("catalog_link_shared", { catalogSlug }, user?.uid);
      trackAnalyticsEvent("catalog_shared", { method: "instagram" });
    } catch {
      notifyWarning("Não foi possível copiar o link.");
    }
  };

  const handleSendOrderWhatsApp = () => {
    if (cart.length === 0) return;
    let message = "🛍️ *Pedido montado no catálogo*\n\n";
    for (const item of cart) {
      message += `• ${item.product.name}\n`;
      message += `  Qtd: ${item.quantity} | R$ ${(Number(item.product.salePrice || 0) * item.quantity).toFixed(2)}\n\n`;
    }
    message += `💰 *Total: R$ ${cartTotal.toFixed(2)}*`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
  };

  if (loading || salesLoading) {
    return <Layout title="Catálogo"><PageSkeleton variant="cards" /></Layout>;
  }

  // P1-03: antes, uma falha de leitura (rede/Firestore) caía direto no render normal com arrays vazios —
  // indistinguível de "catálogo sem produtos ainda". Mesmo padrão de erro+retry já usado em dashboard.tsx.
  if (dataError) {
    return (
      <Layout title="Catálogo">
        <div className="mx-auto max-w-3xl px-4 py-8 text-center">
          <p className="mb-2 font-bold text-destructive">Ocorreu um erro temporário.</p>
          <p className="mb-4 text-sm text-muted-foreground">Não foi possível carregar seu catálogo.</p>
          <button type="button" onClick={() => window.location.reload()} className="rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white">Tentar novamente</button>
        </div>
      </Layout>
    );
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
      />

      <ShareCatalogSheet
        open={showShareModal}
        onClose={() => setShowShareModal(false)}
        catalogUrl={catalogUrl}
        hasCatalogSlug={hasCatalogSlug}
        copied={copied}
        onCopyLink={handleCopyLink}
        onShareWhatsApp={handleShareWhatsApp}
        onShareInstagram={handleShareInstagram}
      />

      {/* Prévia do pedido — monta e envia por WhatsApp. Nunca processa pagamento nem decrementa
          estoque real (isso é exclusivo do fluxo de Vendas, com sua própria transação server-side). */}
      {showCart && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-background" role="dialog" aria-modal="true" aria-label="Prévia do pedido">
          <div className="flex items-center justify-between border-b border-border/40 px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
            <button type="button" onClick={() => setShowCart(false)} className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary" aria-label="Fechar"><X className="h-5 w-5" /></button>
            <h3 className="text-lg font-bold">Prévia do pedido</h3>
            <div className="w-10" />
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            {cart.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-[2rem] bg-primary/10">
                  <ShoppingCart className="h-9 w-9 text-primary/45" />
                </div>
                <p className="font-semibold text-foreground">Nenhum item ainda</p>
                <p className="mt-2 max-w-[240px] text-xs leading-relaxed text-muted-foreground">Adicione produtos na vitrine para montar um pedido de teste.</p>
              </div>
            ) : (
              cart.map((item) => (
                <div key={item.product.id} className="flex gap-4 rounded-[2rem] border border-border/40 bg-secondary/30 p-4">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-border/20 bg-white">
                    <ProductImageCard product={item.product} size="md" objectFit="contain" />
                  </div>
                  <div className="flex-1">
                    <h4 className="mb-1 line-clamp-2 text-xs font-bold leading-tight">{item.product.name}</h4>
                    <p className="text-xs font-semibold text-primary">Subtotal: R$ {(Number(item.product.salePrice || 0) * item.quantity).toFixed(2)}</p>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => updateQuantity(item.product.id, item.quantity - 1)} className="flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-sm" data-testid={`button-decrease-${item.product.id}`}><Minus className="h-3 w-3" /></button>
                        <span className="text-xs font-semibold" data-testid={`text-quantity-${item.product.id}`}>{item.quantity}</span>
                        <button type="button" onClick={() => updateQuantity(item.product.id, item.quantity + 1)} disabled={item.quantity >= Number(item.product.stock || 0)} className="flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-sm disabled:opacity-30" data-testid={`button-increase-${item.product.id}`}><Plus className="h-3 w-3" /></button>
                      </div>
                      <button type="button" onClick={() => removeFromCart(item.product.id)} className="flex items-center gap-1 text-[10px] font-bold text-destructive"><Trash2 className="h-3.5 w-3.5" />Remover</button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {cart.length > 0 && (
            <div className="space-y-3 border-t border-border/40 bg-background px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
              <div className="flex items-center justify-between rounded-2xl bg-secondary/30 p-4">
                <span className="text-xs font-semibold text-muted-foreground">Total</span>
                <span className="text-xl font-bold">R$ {cartTotal.toFixed(2)}</span>
              </div>
              <button type="button" onClick={handleSendOrderWhatsApp} className="flex min-h-14 w-full items-center justify-center gap-3 rounded-[2rem] bg-[#25D366] font-bold text-white shadow-lg" data-testid="button-send-order-whatsapp">
                <Send className="h-5 w-5" /> Enviar pedido no WhatsApp
              </button>
            </div>
          )}
        </div>
      )}
    </Layout>
  );
}
