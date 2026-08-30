import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, Send, ShoppingCart, Trash2, X } from "lucide-react";
import { CatalogShowcase } from "@/components/catalog/CatalogShowcase";
import { ShareCatalogSheet } from "@/components/catalog/ShareCatalogSheet";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Layout } from "@/components/layout";
import { useProductsData } from "@/hooks/useProductsData";
import { useSalesData } from "@/hooks/useSalesData";
import { resolveCatalogExperience } from "@/lib/catalog-experience";
import { getFirebaseAuth, logTelemetryEvent, trackAnalyticsEvent } from "@/lib/firebase";
import type { AppSettings, Product } from "@/lib/mock-data";
import { notifyInfo, notifyWarning } from "@/lib/notify";
import { formatCurrency, getPromotionalPrice } from "@/lib/product-pricing";
import { buildPublicCatalogUrl } from "@/lib/public-url";
import { useUserSettings } from "@/providers/UserSettingsProvider";

type CatalogStoreSettings = AppSettings & {
  storeBannerUrl?: string;
  storeBannerTitle?: string;
  storeBannerSubtitle?: string;
  storeDescription?: string;
};

/**
 * CATALOG-GOLDEN-RESTORE-05 §1/§3/§7 — restaurado fielmente do commit histórico (6de2c85): carrinho de
 * PRÉVIA local à aba interna do catálogo, nunca uma venda — nenhuma Sale/Payment/StockMovement é criada
 * aqui, nenhuma reserva de estoque acontece. "Ver pedido" só monta e abre uma mensagem de WhatsApp
 * (handleSendOrderWhatsApp abaixo); pagamento online (Pix/Cartão/Mercado Pago) permanece exclusivo do
 * catálogo público (client/src/pages/public-catalog.tsx), deliberadamente não reintroduzido aqui.
 */
interface CartItem {
  product: Product;
  quantity: number;
}

export default function Catalog() {
  const { products, loading, error: productsError } = useProductsData();
  const { sales, loading: salesLoading, error: salesError } = useSalesData();
  const dataError = productsError || salesError;
  const { settings } = useUserSettings();
  const [search, setSearch] = useState("");
  const [genderFilter, setGenderFilter] = useState("todos");
  const [categoryFilter, setCategoryFilter] = useState("todos");
  const [showShareModal, setShowShareModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showCart, setShowCart] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const experienceNowRef = useRef(new Date());

  // CATALOG-GOLDEN-RESTORE-05 — mesma lógica pura já usada em client/src/pages/public-catalog.tsx
  // (addToCart/removeFromCart/updateQuantity/cartQuantities/cartCount): estoque nunca é reservado aqui,
  // só limita quanto o vendedor pode adicionar à prévia local do pedido.
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

  const updateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }
    setCart((previous) => {
      const item = previous.find((cartItem) => cartItem.product.id === productId);
      if (!item || quantity > Number(item.product.stock || 0)) return previous;
      return previous.map((cartItem) => cartItem.product.id === productId ? { ...cartItem, quantity } : cartItem);
    });
  };

  const cartQuantities = useMemo(() => new Map(cart.map((item) => [item.product.id, item.quantity])), [cart]);
  // P0 (mesmo raciocínio de public-catalog.tsx): uma ÚNICA fonte de preço para carrinho/subtotal/
  // mensagem do WhatsApp — nunca salePrice bruto, que ignora promoção/desconto ativos.
  const cartEffectivePrices = useMemo(
    () => new Map(cart.map((item) => [item.product.id, getPromotionalPrice(item.product) ?? Number(item.product.salePrice || 0)])),
    [cart],
  );
  const cartTotal = useMemo(
    () => cart.reduce((sum, item) => sum + (cartEffectivePrices.get(item.product.id) ?? 0) * item.quantity, 0),
    [cart, cartEffectivePrices],
  );
  const cartCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);

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

  // CATALOG-GOLDEN-RESTORE-05 §3 — "Ver pedido" monta e abre a mensagem de WhatsApp, nunca processa
  // pagamento/estoque (mesmo comportamento fiel ao commit histórico 6de2c85, sem o botão de checkout
  // Pix/Cartão que esse commit tinha — pagamento online continua exclusivo do catálogo público).
  const handleSendOrderWhatsApp = () => {
    if (cart.length === 0) return;
    let message = "🛍️ *Novo Pedido*\n\n";
    for (const item of cart) {
      const unitPrice = cartEffectivePrices.get(item.product.id) ?? 0;
      message += `• ${item.product.name}\n`;
      message += `  Qtd: ${item.quantity} | ${formatCurrency(unitPrice * item.quantity)}\n\n`;
    }
    message += `💰 *Total: ${formatCurrency(cartTotal)}*\n\n`;
    message += `Visite meu catálogo: ${catalogUrl}`;
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

      {/* CATALOG-GOLDEN-RESTORE-05 — drawer mínimo de prévia de pedido, restaurado fielmente do commit
          histórico (6de2c85) MENOS o botão de checkout Pix/Cartão que esse commit tinha: aqui só existe
          "Enviar Pedido no WhatsApp" — nunca processa pagamento/estoque, nunca cria Sale/Payment. */}
      {showCart && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/40" role="dialog" aria-modal="true" aria-label="Pedido">
          <div className="max-h-[85vh] overflow-y-auto rounded-t-[2rem] bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Pedido</h2>
              <button type="button" onClick={() => setShowCart(false)} className="rs-icon-press flex h-10 w-10 items-center justify-center rounded-full bg-secondary" aria-label="Fechar pedido"><X className="h-5 w-5" /></button>
            </div>

            {cart.length === 0 ? (
              <div className="flex flex-col items-center py-10 text-center">
                <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-[2rem] bg-primary/10"><ShoppingCart className="h-9 w-9 text-primary/45" /></div>
                <p className="text-sm font-semibold text-slate-700">Seu pedido está vazio</p>
                <p className="mt-2 max-w-[240px] text-xs leading-relaxed text-muted-foreground">Adicione produtos ao pedido para enviar pelo WhatsApp.</p>
                <button type="button" onClick={() => setShowCart(false)} className="rs-pressable mt-5 rounded-2xl bg-primary px-5 py-3 text-xs font-semibold text-white">Continuar navegando</button>
              </div>
            ) : (
              <div className="space-y-3">
                {cart.map((item) => (
                  <div key={item.product.id} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold text-slate-900">{item.product.name}</p>
                      <p className="text-[11px] text-muted-foreground">{formatCurrency(cartEffectivePrices.get(item.product.id) ?? 0)}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <button type="button" onClick={() => updateQuantity(item.product.id, item.quantity - 1)} className="rs-icon-press flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-sm" aria-label="Diminuir quantidade"><Minus className="h-3 w-3" /></button>
                        <span className="w-5 text-center text-xs font-bold">{item.quantity}</span>
                        <button type="button" onClick={() => updateQuantity(item.product.id, item.quantity + 1)} disabled={item.quantity >= Number(item.product.stock || 0)} className="rs-icon-press flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-sm disabled:opacity-40" aria-label="Aumentar quantidade"><Plus className="h-3 w-3" /></button>
                      </div>
                    </div>
                    <button type="button" onClick={() => removeFromCart(item.product.id)} className="rs-pressable flex items-center gap-1 text-[9px] font-bold text-red-600"><Trash2 className="h-3.5 w-3.5" /> Remover</button>
                  </div>
                ))}
              </div>
            )}

            {cart.length > 0 && (
              <div className="mt-4 space-y-3 border-t border-border/30 pt-4">
                <div className="flex items-center justify-between"><span className="text-xs font-bold text-muted-foreground">Itens</span><span className="text-sm font-semibold">{cartCount}</span></div>
                <div className="flex items-center justify-between"><span className="text-xs font-semibold text-muted-foreground">Total</span><span className="text-2xl font-semibold text-foreground">{formatCurrency(cartTotal)}</span></div>
                <button type="button" onClick={handleSendOrderWhatsApp} className="rs-pressable flex w-full items-center justify-center gap-3 rounded-[2rem] bg-[#25D366] py-4 font-semibold text-white shadow-xl shadow-green-200"><Send className="h-5 w-5" /> Enviar Pedido no WhatsApp</button>
              </div>
            )}
          </div>
        </div>
      )}

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
    </Layout>
  );
}
