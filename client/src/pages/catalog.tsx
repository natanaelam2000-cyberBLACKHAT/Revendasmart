import { useState, useMemo } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Layout } from "@/components/layout";
import { Share2, Search, X, Copy, Check, ShoppingCart, Plus, Minus, Trash2, Send, Loader2 } from "lucide-react";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useUserSettings } from "@/hooks/useUserSettings";
import type { Product } from "@/lib/mock-data";
import { ProductImageCard } from "@/components/ProductImageCard";
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
  const [genderFilter] = useState("todos");
  const [categoryFilter, setCategoryFilter] = useState("todos");
  const [showShareModal, setShowShareModal] = useState(false);
  const [showCart, setShowCart] = useState(false);
  const [copied, setCopied] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");

  const categories = useMemo(() => {
    const cats = Array.from(new Set(products.map(p => p.category || "Geral")));
    return ["todos", ...cats.sort()];
  }, [products]);

  const filtered = useMemo(() => {
    return products.filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
                           p.brand?.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = categoryFilter === "todos" || p.category === categoryFilter;
      
      let gender = "unissex";
      if (p.productType === "Roupas" && p.extras?.public_type) {
        gender = p.extras.public_type.toLowerCase();
      } else {
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

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        if (existing.quantity < product.stock) {
          return prev.map(item =>
            item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
          );
        }
        return prev;
      }
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
        item.product.id === productId ? { ...item, quantity: newQuantity } : item
      )
    );
  };

  const cartTotal = useMemo(() => cart.reduce((sum, item) => sum + (item.product.salePrice * item.quantity), 0), [cart]);
  const cartCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);
  const catalogSlug = settings?.catalogSlug || settings?.catalog_slug || "seu-catalogo";
  const catalogUrl = `https://revendasmart.vercel.app/u/${catalogSlug}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(catalogUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    const user = getFirebaseAuth()?.currentUser;
    logTelemetryEvent("catalog_link_shared", { method: "copy" }, user?.uid);
    trackAnalyticsEvent("catalog_shared", { method: "copy" });
  };

  const handleShareWhatsApp = () => {
    const msg = `Confira meu catálogo de produtos! 💐 ${catalogUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
    setShowShareModal(false);
    const user = getFirebaseAuth()?.currentUser;
    logTelemetryEvent("catalog_link_shared", { method: "whatsapp" }, user?.uid);
    trackAnalyticsEvent("catalog_shared", { method: "whatsapp" });
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
        throw new Error(data?.message || data?.error || `Erro ${resp.status}`);
      }

      if (!data.paymentUrl) {
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

  if (loading) {
    return <Layout title="Catálogo"><PageSkeleton variant="cards" /></Layout>;
  }

  return (
    <Layout title="Catálogo">
      <div className="bg-[#F8F9FA] min-h-full pb-32">
        {/* Header */}
        <div className="px-6 pt-8 pb-6 bg-white border-b border-border/40">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-black text-foreground tracking-tight">Catálogo</h1>
              <p className="text-[10px] font-black text-muted-foreground/50 uppercase tracking-[0.2em]">{filtered.length} produtos</p>
            </div>
            {cartCount > 0 && (
              <button 
                onClick={() => setShowCart(true)} 
                className="relative w-14 h-14 bg-primary text-white rounded-2xl flex items-center justify-center shadow-xl shadow-primary/30"
              >
                <ShoppingCart className="w-6 h-6" />
                <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-black w-6 h-6 rounded-full flex items-center justify-center ring-4 ring-white">
                  {cartCount}
                </span>
              </button>
            )}
          </div>
          
          <div className="relative mb-4">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground/30" />
            <input
              type="text"
              placeholder="Buscar marca ou produto..."
              className="w-full bg-secondary/30 border-none rounded-2xl py-4 pl-12 pr-4 text-sm focus:ring-2 focus:ring-primary/20"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-2">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
                  categoryFilter === cat ? "bg-primary text-white shadow-md" : "bg-secondary/50 text-muted-foreground"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Products Grid - Vitrine */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
            <div className="w-20 h-20 bg-white rounded-[2.5rem] shadow-sm flex items-center justify-center mb-4">
              <Search className="w-8 h-8 text-muted-foreground/20" />
            </div>
            <p className="font-bold text-muted-foreground">Nenhum resultado</p>
            <p className="text-xs text-muted-foreground/50 mt-1">Tente ajustar seus filtros.</p>
          </div>
        ) : (
          <div className="p-4 grid grid-cols-2 gap-3">
            {filtered.map((product) => {
              const cartQty = cart.find(i => i.product.id === product.id)?.quantity || 0;

              return (
                <div
                  key={product.id}
                  className="bg-white rounded-[2rem] border border-border/40 shadow-sm overflow-hidden flex flex-col transition-all active:scale-[0.98]"
                >
                  {/* Imagem em destaque */}
                  <div className="aspect-square bg-[#F1F3F5] overflow-hidden relative">
                    <ProductImageCard 
                      product={product} 
                      size="vitrine"
                      objectFit="contain"
                      className="!w-full !h-full !rounded-0"
                    />
                    <div className="absolute top-2 right-2 bg-black/70 text-white text-[8px] font-black px-2 py-1 rounded-lg">
                      {product.stock} un
                    </div>
                  </div>

                  {/* Info e ações */}
                  <div className="p-3 flex flex-col gap-2">
                    <div>
                      <p className="text-[8px] font-black text-primary/40 uppercase tracking-widest mb-0.5">{product.brand || "Geral"}</p>
                      <h3 className="text-[11px] font-bold text-foreground leading-tight h-7 line-clamp-2">{product.name}</h3>
                    </div>
                    
                    {/* Preço em destaque */}
                    <div className="flex items-baseline gap-1">
                      <span className="text-lg font-black text-primary">R$ {product.salePrice.toFixed(2)}</span>
                    </div>

                    {/* Botão de ação */}
                    {cartQty > 0 ? (
                      <div className="flex items-center justify-between gap-2 bg-secondary/50 p-2 rounded-xl">
                        <button onClick={() => updateQuantity(product.id, cartQty - 1)} className="w-6 h-6 rounded-lg bg-white flex items-center justify-center shadow-sm"><Minus className="w-3 h-3"/></button>
                        <span className="text-[10px] font-black flex-1 text-center">{cartQty}</span>
                        <button onClick={() => addToCart(product)} disabled={cartQty >= product.stock} className="w-6 h-6 rounded-lg bg-primary text-white flex items-center justify-center shadow-sm disabled:opacity-30"><Plus className="w-3 h-3"/></button>
                      </div>
                    ) : (
                      <button onClick={() => addToCart(product)} className="w-full bg-primary text-white font-black py-3 rounded-xl text-xs uppercase tracking-widest shadow-lg shadow-primary/20">
                        Adicionar
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Cart Modal */}
      {showCart && (
        <div className="fixed inset-0 bg-white z-[70] flex flex-col animate-in slide-in-from-bottom-full duration-300">
          <div className="px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-4 flex items-center justify-between border-b border-border/40">
            <button onClick={() => setShowCart(false)} className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center"><X className="w-5 h-5" /></button>
            <h3 className="font-black text-lg">Meu Pedido</h3>
            <div className="w-10" />
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <ShoppingCart className="w-12 h-12 text-muted-foreground/20 mb-3" />
                <p className="font-bold text-muted-foreground">Carrinho vazio</p>
                <button onClick={() => setShowCart(false)} className="mt-5 rounded-xl bg-primary px-5 py-3 text-xs font-black text-white">Continuar comprando</button>
              </div>
            ) : (
              cart.map(item => (
                <div key={item.product.id} className="flex gap-4 p-4 bg-[#F8F9FA] rounded-[2rem] border border-border/40">
                  <div className="w-16 h-16 bg-white rounded-2xl overflow-hidden border border-border/20">
                    <ProductImageCard product={item.product} size="md" objectFit="contain" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-xs font-bold leading-tight mb-1 line-clamp-2">{item.product.name}</h4>
                    <p className="text-[9px] font-black uppercase tracking-wider text-primary">{item.product.brand || "Sem marca"}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">Preço unitário: R$ {item.product.salePrice.toFixed(2)}</p>
                    <p className="text-xs font-black text-primary mt-1">Subtotal: R$ {(item.product.salePrice * item.quantity).toFixed(2)}</p>
                    <div className="flex items-center justify-between gap-2 mt-3"><div className="flex items-center gap-2"><span className="text-[9px] font-bold text-muted-foreground mr-1">Quantidade:</span>
                      <button onClick={() => updateQuantity(item.product.id, item.quantity - 1)} className="w-7 h-7 rounded-full bg-white shadow-sm flex items-center justify-center"><Minus className="w-3 h-3"/></button>
                      <span className="text-xs font-black">{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.product.id, item.quantity + 1)} disabled={item.quantity >= item.product.stock} className="w-7 h-7 rounded-full bg-white shadow-sm flex items-center justify-center"><Plus className="w-3 h-3"/></button></div>
                      <button onClick={() => removeFromCart(item.product.id)} className="flex items-center gap-1 text-[9px] font-bold text-red-600"><Trash2 className="w-3.5 h-3.5"/>Remover</button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {cart.length > 0 && (
            <div className="px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] border-t border-border/40 space-y-3 bg-white">
              <div className="bg-secondary/20 rounded-2xl p-4 space-y-2">
                <div className="flex items-center justify-between"><span className="text-[10px] font-bold text-muted-foreground">Itens</span><span className="text-sm font-black">{cartCount}</span></div>
                <div className="flex items-center justify-between border-t border-border/30 pt-2"><span className="text-[10px] font-black uppercase tracking-widest">Total</span><span className="text-2xl font-black text-foreground">R$ {cartTotal.toFixed(2)}</span></div>
              </div>
              <button onClick={() => setShowCart(false)} className="w-full py-3 text-xs font-black text-primary">Continuar comprando</button>
              <button 
                onClick={handleSendOrderWhatsApp} 
                className="w-full bg-[#25D366] text-white font-black py-5 rounded-[2rem] flex items-center justify-center gap-3 shadow-xl shadow-green-200"
              >
                <Send className="w-5 h-5" /> Enviar Pedido no WhatsApp
              </button>
              <button 
                onClick={handleMercadoPagoCheckout} 
                disabled={checkoutLoading} 
                className="w-full bg-primary text-white font-black py-5 rounded-[2rem] flex items-center justify-center gap-3 shadow-xl shadow-primary/20"
              >
                {checkoutLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShoppingCart className="w-5 h-5" />}
                Pagar com Pix / Cartão de Crédito
              </button>
              {checkoutError && <p className="text-[10px] text-red-500 font-bold text-center">{checkoutError}</p>}
            </div>
          )}
        </div>
      )}

      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-end justify-center p-0 sm:p-4">
          <div className="bg-white w-full max-w-md rounded-t-[2rem] sm:rounded-[2rem] px-5 pt-5 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:p-7 space-y-5 max-h-[calc(100dvh-1rem)] overflow-y-auto overscroll-contain animate-in slide-in-from-bottom-full">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-2xl">Compartilhar Catálogo</h3>
              <button onClick={() => setShowShareModal(false)} className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center"><X className="w-5 h-5" /></button>
            </div>
            <div className="bg-secondary/30 rounded-2xl p-3 border border-border/40"><p className="text-[9px] font-black text-muted-foreground uppercase mb-1">Link do catálogo</p><p className="text-xs font-mono break-all text-foreground">{catalogUrl}</p></div>
            <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={handleShareWhatsApp} 
                className="flex flex-col items-center gap-3 p-5 bg-green-50 rounded-[2rem] border border-green-100"
              >
                <div className="w-12 h-12 bg-green-500 rounded-2xl flex items-center justify-center shadow-lg shadow-green-200"><Share2 className="w-6 h-6 text-white" /></div>
                <span className="text-[10px] font-black uppercase tracking-widest text-green-700">WhatsApp</span>
              </button>
              <button 
                onClick={handleCopyLink} 
                className="flex flex-col items-center gap-3 p-5 bg-primary/5 rounded-[2rem] border border-primary/10"
              >
                <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center shadow-lg shadow-primary/20">
                  {copied ? <Check className="w-6 h-6 text-white" /> : <Copy className="w-6 h-6 text-white" />}
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-primary">{copied ? "Copiado!" : "Copiar Link"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Button */}
      <button 
        onClick={() => setShowShareModal(true)}
        className="fixed bottom-24 right-6 bg-white border border-border/40 p-4 rounded-full shadow-2xl flex items-center gap-2 active:scale-95 transition-all z-40"
      >
        <Share2 className="w-5 h-5 text-primary" />
        <span className="text-[10px] font-black uppercase tracking-widest pr-2">Compartilhar</span>
      </button>
    </Layout>
  );
}
