import { useState, useMemo } from "react";
import { Layout } from "@/components/layout";
import { Share2, Search, X, Link as LinkIcon, Copy, Check, ShoppingCart, Plus, Minus, Trash2, Send, Loader2 } from "lucide-react";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useUserSettings } from "@/hooks/useUserSettings";
import type { Product } from "@/lib/mock-data";
import { getProductImage } from "@/lib/mock-data";
import { getFirebaseAuth, logTelemetryEvent, trackAnalyticsEvent, measureOperation } from "@/lib/firebase";
import { getApiUrl } from "@/lib/api-config";

interface CartItem {
  product: Product;
  quantity: number;
}

export default function Catalog() {
  const { products, loading } = useDashboardData();
  const { settings } = useUserSettings();

  const [search, setSearch] = useState("");
  const [genderFilter, setGenderFilter] = useState("todos");
  const [categoryFilter, setCategoryFilter] = useState("todos");
  const [showShareModal, setShowShareModal] = useState(false);
  const [showCart, setShowCart] = useState(false);
  const [shareCategory, setShareCategory] = useState("todos");
  const [copied, setCopied] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");

  // Get unique categories
  const categories = useMemo(() => {
    const cats = Array.from(new Set(products.map(p => p.category || "Geral")));
    return ["todos", ...cats.sort()];
  }, [products]);

  // Filter products
  const filtered = useMemo(() => {
    return products.filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
                           p.brand?.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = categoryFilter === "todos" || p.category === categoryFilter;
      
      // Gender filter based on product type and extras
      let gender = "unissex";
      
      // Priority 1: Use extras.public_type if product is Roupas and field exists
      if (p.productType === "Roupas" && p.extras?.public_type) {
        gender = p.extras.public_type.toLowerCase();
      } else {
        // Fallback: Infer from name/category for compatibility with older products
        const nameAndCat = (p.name + p.category).toLowerCase();
        if (nameAndCat.includes("feminino") || nameAndCat.includes("mulher")) {
          gender = "feminino";
        } else if (nameAndCat.includes("masculino") || nameAndCat.includes("homem")) {
          gender = "masculino";
        }
      }
      
      const matchesGender = genderFilter === "todos" || gender === genderFilter;
      const inStock = p.stock > 0;
      
      return matchesSearch && matchesCategory && matchesGender && inStock;
    });
  }, [products, search, categoryFilter, genderFilter]);

  // Carrinho
  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        // Se já existe, aumentar quantidade respeitando estoque
        if (existing.quantity < product.stock) {
          return prev.map(item =>
            item.product.id === product.id
              ? { ...item, quantity: item.quantity + 1 }
              : item
          );
        }
        // Se chegou ao máximo de estoque, não aumenta mais
        return prev;
      }
      // Novo item
      return [...prev, { product, quantity: 1 }];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.product.id !== productId));
  };

  const updateQuantity = (productId: string, newQuantity: number) => {
    if (newQuantity <= 0) {
      removeFromCart(productId);
      return;
    }
    
    const product = products.find(p => p.id === productId);
    if (!product || newQuantity > product.stock) return;

    setCart(prev =>
      prev.map(item =>
        item.product.id === productId
          ? { ...item, quantity: newQuantity }
          : item
      )
    );
  };

  // Totais
  const cartTotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + (item.product.salePrice * item.quantity), 0);
  }, [cart]);

  const cartCount = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.quantity, 0);
  }, [cart]);

  const catalogUrl = `https://revendasmart.vercel.app/u/${settings?.catalog_slug || "seu-catalogo"}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(catalogUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    
    // Track catalog link copied event (both telemetry and analytics)
    const user = getFirebaseAuth()?.currentUser;
    const catalogSlug = settings?.catalog_slug || "default";
    logTelemetryEvent("catalog_link_shared", { catalogSlug }, user?.uid);
    trackAnalyticsEvent("catalog_shared", { method: "copy" });
  };

  const handleShareWhatsApp = () => {
    const msg = `Confira meu catálogo de produtos! 💐 ${catalogUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
    setShowShareModal(false);
  };

  const handleShareProduct = (product: Product) => {
    const msg = `${product.name} - R$ ${product.salePrice.toFixed(2)} 💐\n${catalogUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const handleSendOrderWhatsApp = () => {
    if (cart.length === 0) return;
    
    let message = "🛍️ *Novo Pedido*\n\n";
    cart.forEach(item => {
      message += `• ${item.product.name}\n`;
      message += `  Qtd: ${item.quantity} | R$ ${(item.product.salePrice * item.quantity).toFixed(2)}\n\n`;
    });
    message += `💰 *Total: R$ ${cartTotal.toFixed(2)}*\n\n`;
    message += `Visite meu catálogo: ${catalogUrl}`;
    
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
  };

  const handleMercadoPagoCheckout = async () => {
    if (cart.length === 0) {
      setCheckoutError("Adicione produtos ao carrinho");
      return;
    }

    const auth = getFirebaseAuth();
    const user = auth?.currentUser;
    if (!user) {
      setCheckoutError("Você precisa estar autenticado para pagar");
      return;
    }

    setCheckoutLoading(true);
    setCheckoutError("");

    try {
      const resp = await measureOperation("catalog_checkout", async () => {
        const token = await user.getIdToken();
        const cartId = Math.random().toString(36).substr(2, 9);
        
        const payload = {
          uid: user.uid,
          clientId: "catalog",
          title: `Catálogo - Pedido ${cartId}`,
          description: `${cart.length} produto(s)`,
          amount: cartTotal,
          metadata: {
            cartId,
            itemCount: cart.length,
            items: cart.map(item => ({
              productId: item.product.id,
              name: item.product.name,
              quantity: item.quantity,
              price: item.product.salePrice,
            })),
          },
        };

        return await fetch(getApiUrl("/api/payments/create-link"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
      });

      const data = await resp.json();

      if (!resp.ok) {
        const errMsg = data?.message || data?.error || `Erro ${resp.status}`;
        logError("catalog_checkout_failed", errMsg, {
          cartValue: cartTotal,
          itemCount: cart.length,
          status: resp.status,
        });
        throw new Error(errMsg);
      }

      if (!data.paymentUrl) {
        logError("catalog_checkout_invalid_response", "No paymentUrl in response", {
          cartValue: cartTotal,
        });
        throw new Error("Erro: URL de pagamento inválida");
      }

      window.location.href = data.paymentUrl;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao processar pagamento";
      setCheckoutError(`❌ ${msg}`);
      console.error("[catalog] Checkout error:", err);
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleShareCategoryClick = () => {
    if (shareCategory === "todos") {
      handleShareWhatsApp();
    } else {
      const msg = `Confira minha coleção de *${shareCategory}*! 💐 ${catalogUrl}`;
      window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
    }
    
    // Track catalog link shared event (both telemetry and analytics)
    const user = getFirebaseAuth()?.currentUser;
    const catalogSlug = settings?.catalog_slug || "default";
    logTelemetryEvent("catalog_link_shared", { catalogSlug }, user?.uid);
    trackAnalyticsEvent("catalog_shared", { method: "whatsapp" });
    
    setShowShareModal(false);
  };

  const getGenderBadge = (product: Product) => {
    let genderLabel = "";
    
    // Priority 1: Use extras.public_type if product is Roupas and field exists
    if (product.productType === "Roupas" && product.extras?.public_type) {
      genderLabel = product.extras.public_type.toLowerCase();
    } else {
      // Fallback: Infer from name/category for compatibility with older products
      const nameAndCat = (product.name + product.category).toLowerCase();
      if (nameAndCat.includes("feminino") || nameAndCat.includes("mulher")) {
        genderLabel = "feminino";
      } else if (nameAndCat.includes("masculino") || nameAndCat.includes("homem")) {
        genderLabel = "masculino";
      }
    }
    
    // Return badge only for feminino/masculino (not unissex)
    if (genderLabel === "feminino") {
      return { label: "Feminino", color: "bg-pink-100 text-pink-700" };
    }
    if (genderLabel === "masculino") {
      return { label: "Masculino", color: "bg-blue-100 text-blue-700" };
    }
    return null;
  };

  const getCartItemQuantity = (productId: string) => {
    const item = cart.find(c => c.product.id === productId);
    return item?.quantity || 0;
  };

  if (loading) {
    return (
      <Layout title="Catálogo">
        <div className="flex items-center justify-center py-12">
          <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Catálogo">
      <div className="pb-32 bg-gradient-to-b from-white via-white to-pink-50/30">
        {/* Header */}
        <div className="px-6 pt-6 pb-3 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-foreground mb-1">Meu Catálogo</h1>
            <p className="text-xs text-muted-foreground/70">
              {filtered.length} produto{filtered.length !== 1 ? "s" : ""} disponível{filtered.length !== 1 ? "s" : ""}
            </p>
          </div>
          {cartCount > 0 && (
            <button
              onClick={() => setShowCart(true)}
              className="relative w-12 h-12 bg-primary text-white rounded-full flex items-center justify-center shadow-lg hover:shadow-xl transition-shadow"
              data-testid="button-open-cart"
            >
              <ShoppingCart className="w-5 h-5" />
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-black w-6 h-6 rounded-full flex items-center justify-center">
                {cartCount}
              </span>
            </button>
          )}
        </div>

        {/* Share Bar */}
        <div className="px-6 py-3 flex items-center justify-between bg-pink-50/40 border-y border-pink-100/50 mb-4">
          <div className="text-xs font-bold text-foreground/60">Compartilhe seu catálogo</div>
          <button
            data-testid="button-share-catalog"
            onClick={() => setShowShareModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-white border border-pink-200/40 text-foreground hover:bg-pink-50/30 transition-all text-xs font-bold shadow-sm"
          >
            <Share2 className="w-3.5 h-3.5" /> Compartilhar
          </button>
        </div>

        {/* Search */}
        <div className="px-6 pb-3">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
            <input
              data-testid="input-catalog-search"
              type="text"
              placeholder="Buscar marca ou produto..."
              className="w-full bg-white border border-border/40 rounded-full py-3 pl-11 pr-4 text-sm outline-none focus:ring-2 focus:ring-pink-300/40 focus:border-pink-200 transition-all placeholder:text-muted-foreground/50"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Gender Filter */}
        <div className="px-6 pb-3 overflow-x-auto hide-scrollbar">
          <div className="flex gap-2 min-w-min">
            {["todos", "feminino", "masculino", "unissex"].map((gender) => (
              <button
                key={gender}
                data-testid={`filter-gender-${gender}`}
                onClick={() => setGenderFilter(gender)}
                className={`whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold uppercase transition-all ${
                  genderFilter === gender
                    ? "bg-primary text-white shadow-md"
                    : "bg-white border border-border/40 text-muted-foreground hover:bg-pink-50/30"
                }`}
              >
                {gender === "todos" ? "Todos" : gender}
              </button>
            ))}
          </div>
        </div>

        {/* Category Filter */}
        <div className="px-6 pb-4 overflow-x-auto hide-scrollbar border-b border-border/30">
          <div className="flex gap-2 min-w-min pb-2">
            {categories.map((cat) => (
              <button
                key={cat}
                data-testid={`filter-category-${cat}`}
                onClick={() => setCategoryFilter(cat)}
                className={`whitespace-nowrap px-3 py-1.5 rounded-full text-[11px] font-black uppercase transition-all ${
                  categoryFilter === cat
                    ? "bg-pink-200/40 text-primary border border-primary/30"
                    : "bg-white border border-border/30 text-muted-foreground/60 hover:border-border/50"
                }`}
              >
                {cat === "todos" ? "Todos" : cat}
              </button>
            ))}
          </div>
        </div>

        {/* Products Grid */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="w-16 h-16 bg-muted/20 rounded-full flex items-center justify-center mb-4">
              <Search className="w-8 h-8 text-muted-foreground/30" />
            </div>
            <p className="font-bold text-muted-foreground mb-1">Nenhum produto encontrado</p>
            <p className="text-xs text-muted-foreground/60">Tente outra busca ou filtro</p>
          </div>
        ) : (
          <div className="px-4 pt-4 grid grid-cols-2 gap-3">
            {filtered.map((product) => {
              const imgSrc = getProductImage(product);
              const genderBadge = getGenderBadge(product);
              const cartQty = getCartItemQuantity(product.id);

              return (
                <div
                  key={product.id}
                  data-testid={`product-card-${product.id}`}
                  className="bg-white rounded-2xl border border-border/40 overflow-hidden shadow-sm hover:shadow-md transition-shadow flex flex-col h-full"
                >
                  {/* Image Container */}
                  <div className="aspect-square bg-gradient-to-br from-pink-50/40 to-purple-50/20 relative overflow-hidden flex items-center justify-center group">
                    {imgSrc ? (
                      <img
                        src={imgSrc}
                        alt={product.name}
                        className="w-full h-full object-contain mix-blend-multiply p-2 group-hover:scale-105 transition-transform"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center text-muted-foreground/40 w-full h-full">
                        <div className="w-12 h-12 bg-border/30 rounded-full mb-2" />
                        <span className="text-[10px]">Sem imagem</span>
                      </div>
                    )}

                    {/* Stock Badge */}
                    <div className="absolute top-2 right-2 bg-black/70 text-white text-[8px] font-black px-2 py-1 rounded-lg">
                      {product.stock} un
                    </div>

                    {/* Discount Badge */}
                    {(product.isOnSale || (product.discountPercent && product.discountPercent > 0)) && (
                      <div className="absolute top-2 left-2 bg-red-500 text-white text-[8px] font-black px-2 py-1 rounded-lg">
                        {product.discountPercent && product.discountPercent > 0 ? `-${product.discountPercent}%` : "Promo"}
                      </div>
                    )}

                    {/* Featured Badge */}
                    {product.isFeatured && (
                      <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-purple-500 text-white text-[8px] font-black px-2 py-1 rounded-lg">
                        ⭐ Destaque
                      </div>
                    )}

                    {/* Gender Badge */}
                    {genderBadge && (
                      <div className={`absolute bottom-2 right-2 ${genderBadge.color} text-[8px] font-bold px-2 py-1 rounded-lg`}>
                        {genderBadge.label}
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="p-3 flex flex-col flex-1">
                    {/* Brand */}
                    {product.brand && (
                      <p className="text-[8px] text-muted-foreground/60 font-bold uppercase tracking-wider mb-0.5">
                        {product.brand}
                      </p>
                    )}

                    {/* Category */}
                    {product.category && (
                      <p className="text-[9px] text-primary/70 font-bold uppercase tracking-wider mb-1">
                        {product.category}
                      </p>
                    )}

                    {/* Name */}
                    <h3 className="text-xs font-black text-foreground mb-2 line-clamp-2 leading-tight">
                      {product.name}
                    </h3>

                    {/* Price */}
                    <div className="mb-3">
                      {product.isOnSale && product.discountPercent && product.discountPercent > 0 && (
                        <p className="text-[9px] text-muted-foreground/50 line-through">
                          R$ {product.salePrice.toFixed(2)}
                        </p>
                      )}
                      <p className="text-base font-black text-pink-600">
                        R$ {product.salePrice.toFixed(2)}
                      </p>
                    </div>

                    {/* Stock Status */}
                    {product.stock <= 5 && (
                      <p className="text-[8px] text-orange-600 font-bold mb-2 uppercase">
                        ⚡ Últimas unidades
                      </p>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-2 mt-auto pt-2 border-t border-border/30">
                      <button
                        data-testid={`button-share-product-${product.id}`}
                        onClick={() => handleShareProduct(product)}
                        className="flex-1 bg-white border border-border/50 text-foreground font-bold text-[10px] py-2 rounded-lg hover:bg-pink-50/30 transition-colors"
                      >
                        Compartilhar
                      </button>
                      {cartQty === 0 ? (
                        <button
                          data-testid={`button-add-product-${product.id}`}
                          onClick={() => addToCart(product)}
                          className="flex-1 bg-primary text-white font-bold text-[10px] py-2 rounded-lg hover:bg-primary/90 transition-colors shadow-sm"
                        >
                          Adicionar
                        </button>
                      ) : (
                        <div className="flex-1 flex items-center justify-center gap-1 bg-primary/10 border border-primary rounded-lg">
                          <button
                            onClick={() => updateQuantity(product.id, cartQty - 1)}
                            className="p-1 text-primary hover:bg-primary/20 rounded"
                            data-testid={`button-decrease-${product.id}`}
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="text-[10px] font-black text-primary w-4 text-center">{cartQty}</span>
                          <button
                            onClick={() => cartQty < product.stock && updateQuantity(product.id, cartQty + 1)}
                            disabled={cartQty >= product.stock}
                            className="p-1 text-primary hover:bg-primary/20 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                            data-testid={`button-increase-${product.id}`}
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end max-w-md mx-auto">
          <div className="bg-white w-full rounded-t-3xl p-6 space-y-3 animate-in slide-in-from-bottom-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-black text-lg">Compartilhar Catálogo</h3>
              <button
                onClick={() => setShowShareModal(false)}
                className="w-8 h-8 rounded-full bg-muted/20 flex items-center justify-center hover:bg-muted/30 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Category Selector */}
            <div className="space-y-2">
              <label className="text-xs font-black text-muted-foreground uppercase">Escolha uma categoria</label>
              <select
                value={shareCategory}
                onChange={(e) => setShareCategory(e.target.value)}
                className="w-full bg-white border border-border/40 rounded-2xl px-4 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/30"
                data-testid="select-share-category"
              >
                <option value="todos">📚 Catálogo Completo</option>
                {categories.map(cat => (
                  cat !== "todos" && (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  )
                ))}
              </select>
            </div>

            <button
              data-testid="button-share-whatsapp-category"
              onClick={handleShareCategoryClick}
              className="w-full bg-green-500 text-white font-black py-3 rounded-2xl flex items-center justify-center gap-2 hover:bg-green-600 transition-colors"
            >
              <Share2 className="w-4 h-4" /> WhatsApp
            </button>

            <button
              data-testid="button-share-copy-modal"
              onClick={handleCopyLink}
              className="w-full bg-primary text-white font-black py-3 rounded-2xl flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4" /> Copiado!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" /> Copiar Link
                </>
              )}
            </button>

            <p className="text-xs text-muted-foreground/60 text-center pt-2 break-all">
              {catalogUrl}
            </p>
          </div>
        </div>
      )}

      {/* Cart Modal */}
      {showCart && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end max-w-md mx-auto">
          <div className="bg-white w-full rounded-t-3xl max-h-[90vh] overflow-y-auto flex flex-col animate-in slide-in-from-bottom-4">
            {/* Cart Header */}
            <div className="sticky top-0 bg-white border-b border-border/30 p-6 flex items-center justify-between">
              <h3 className="font-black text-lg">🛒 Carrinho</h3>
              <button
                onClick={() => setShowCart(false)}
                className="w-8 h-8 rounded-full bg-muted/20 flex items-center justify-center hover:bg-muted/30 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Cart Items */}
            {cart.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                <ShoppingCart className="w-12 h-12 text-muted-foreground/30 mb-3" />
                <p className="font-bold text-muted-foreground">Carrinho vazio</p>
                <p className="text-xs text-muted-foreground/60">Adicione produtos para começar!</p>
              </div>
            ) : (
              <div className="flex-1 space-y-2 p-6">
                {cart.map(item => (
                  <div key={item.product.id} className="flex gap-3 p-3 bg-secondary/20 rounded-2xl">
                    {/* Mini Image */}
                    <div className="w-16 h-16 bg-white rounded-xl border border-border/30 flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {getProductImage(item.product) ? (
                        <img
                          src={getProductImage(item.product)!}
                          alt={item.product.name}
                          className="w-full h-full object-contain p-1"
                        />
                      ) : (
                        <div className="text-[10px] text-muted-foreground/40">Sem imagem</div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-muted-foreground/60 font-bold uppercase mb-0.5">
                        {item.product.brand}
                      </p>
                      <p className="text-xs font-bold truncate mb-1">{item.product.name}</p>
                      <p className="text-sm font-black text-pink-600">
                        R$ {(item.product.salePrice * item.quantity).toFixed(2)}
                      </p>
                    </div>

                    {/* Qty Controls */}
                    <div className="flex flex-col gap-1 items-end">
                      <div className="flex items-center gap-1 bg-white border border-border rounded-lg">
                        <button
                          onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                          className="p-1 hover:bg-primary/10"
                          data-testid={`cart-decrease-${item.product.id}`}
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-[10px] font-black w-3 text-center">{item.quantity}</span>
                        <button
                          onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                          disabled={item.quantity >= item.product.stock}
                          className="p-1 hover:bg-primary/10 disabled:opacity-50"
                          data-testid={`cart-increase-${item.product.id}`}
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                      <button
                        onClick={() => removeFromCart(item.product.id)}
                        className="p-1 text-destructive hover:bg-destructive/10 rounded"
                        data-testid={`cart-remove-${item.product.id}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Cart Summary & Actions - Sticky Bottom */}
            {cart.length > 0 && (
              <div className="sticky bottom-0 bg-white border-t border-border/30 p-6 space-y-3">
                {/* Total */}
                <div className="flex items-center justify-between p-4 bg-pink-50/60 rounded-2xl border border-pink-200/40">
                  <span className="font-black text-foreground">Total:</span>
                  <span className="text-xl font-black text-pink-600">R$ {cartTotal.toFixed(2)}</span>
                </div>

                {/* WhatsApp Order */}
                <button
                  onClick={handleSendOrderWhatsApp}
                  className="w-full bg-green-500 text-white font-black py-3 rounded-2xl flex items-center justify-center gap-2 hover:bg-green-600 transition-colors"
                  data-testid="button-send-whatsapp-order"
                >
                  <Send className="w-4 h-4" /> Enviar Pedido via WhatsApp
                </button>

                {/* Mercado Pago Checkout */}
                <button
                  onClick={handleMercadoPagoCheckout}
                  disabled={checkoutLoading || cart.length === 0}
                  className="w-full bg-blue-600 text-white font-black py-3 rounded-2xl flex items-center justify-center gap-2 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  data-testid="button-pay-mercado-pago"
                >
                  {checkoutLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Processando...
                    </>
                  ) : (
                    <>
                      💳 Pagar com Mercado Pago
                    </>
                  )}
                </button>

                {/* Continue Shopping */}
                <button
                  onClick={() => setShowCart(false)}
                  className="w-full bg-secondary text-foreground font-black py-3 rounded-2xl hover:bg-secondary/80 transition-colors"
                  data-testid="button-continue-shopping"
                >
                  Continuar Comprando
                </button>

                {/* Checkout Error - Clear visibility */}
                {checkoutError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-2xl animate-in slide-in-from-top-2">
                    ⚠️ {checkoutError}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      </Layout>
    );
  }
