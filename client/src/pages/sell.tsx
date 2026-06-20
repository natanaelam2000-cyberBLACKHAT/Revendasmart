import { useState, useEffect } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Product, getProductImage } from "@/lib/mock-data";
import { Layout } from "@/components/layout";
import { ProductImageCard } from "@/components/ProductImageCard";
import { Search, ShoppingBag, Plus, Minus, CheckCircle2, AlertCircle } from "lucide-react";
import { useLocation } from "wouter";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useClientsData } from "@/hooks/useClientsData";
import { getFirebaseAuth, logError, logTelemetryEvent, trackAnalyticsEvent, measureOperation } from "@/lib/firebase";
import { getApiUrl } from "@/lib/api-config";

export default function Sell() {
  const [, setLocation] = useLocation();
  const { products, loading: productsLoading } = useDashboardData();
  const { clients, loading: clientsLoading } = useClientsData();
  
  const [search, setSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState<string>("");
  const [cart, setCart] = useState<{product: Product, quantity: number}[]>([]);
  const [paymentType, setPaymentType] = useState<'cash' | 'installments'>('cash');
  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'dinheiro' | 'credito' | 'debito'>('pix');
  const [downPaymentMethod, setDownPaymentMethod] = useState<'pix' | 'dinheiro' | 'credito' | 'debito'>('pix');
  const [discountType, setDiscountType] = useState<'fixed' | 'percent'>('fixed');
  const [discountValue, setDiscountValue] = useState(0);
  const [installments, setInstallments] = useState(1);
  const [downPayment, setDownPayment] = useState(0);
  const [success, setSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) && p.stock > 0
  );

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) return prev;
        return prev.map(item => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => {
      const existing = prev.find(item => item.product.id === productId);
      if (existing && existing.quantity > 1) {
        return prev.map(item => item.product.id === productId ? { ...item, quantity: item.quantity - 1 } : item);
      }
      return prev.filter(item => item.product.id !== productId);
    });
  };

  const subtotal = cart.reduce((acc, item) => acc + (item.product.salePrice * item.quantity), 0);
  const discountAmount = Math.min(subtotal, discountType === 'percent' ? subtotal * Math.min(100, discountValue) / 100 : discountValue);
  const total = Math.max(0, subtotal - discountAmount);
  const remainingBalance = Math.max(0, total - downPayment);

  const handleCheckout = async () => {
    if (cart.length === 0) {
      setSaveError("Adicione produtos ao carrinho");
      return;
    }
    
    if (!selectedClient) {
      setSaveError("Selecione um cliente para prosseguir");
      return;
    }

    // Validação para venda a prazo
    if (paymentType === 'installments') {
      if (downPayment < 0) {
        setSaveError("Entrada não pode ser negativa");
        return;
      }
      if (downPayment > total) {
        setSaveError("Entrada não pode ser maior que o total");
        return;
      }
      if (installments < 1 || installments > 12) {
        setSaveError("Parcelas deve estar entre 1 e 12");
        return;
      }
      if (remainingBalance > 0 && installments === 0) {
        setSaveError("Defina o número de parcelas");
        return;
      }
    }

    const auth = getFirebaseAuth();
    const uid = auth?.currentUser?.uid;
    
    if (!uid) {
      setSaveError("Usuário não autenticado");
      return;
    }

    setIsSaving(true);
    setSaveError("");

    try {
      const saleId = Math.random().toString(36).substring(2, 11);
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Não foi possível autenticar a venda");

      const saleResponse = await measureOperation("sale_registration", () => fetch(getApiUrl("/api/sales/finalize"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          saleId,
          clientId: selectedClient,
          products: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity })),
          discountType,
          discountValue,
          paymentType: paymentType === "cash" ? "avista" : "prazo",
          paymentMethod: paymentType === "cash" ? paymentMethod : null,
          downPayment: paymentType === "installments" ? downPayment : 0,
          downPaymentMethod: paymentType === "installments" && downPayment > 0 ? downPaymentMethod : null,
          installments: paymentType === "installments" ? installments : 0,
        }),
      }));

      const saleResult = await saleResponse.json().catch(() => ({}));
      if (!saleResponse.ok) {
        throw new Error(saleResult.message || "Não foi possível finalizar a venda");
      }

      logTelemetryEvent("sale_registered", {
        saleId: saleResult.saleId,
        clientId: selectedClient,
        amount: saleResult.total,
        itemCount: cart.length,
        paymentType,
      }, uid);

      trackAnalyticsEvent("purchase", {
        transaction_id: saleResult.saleId,
        value: saleResult.total,
        currency: "BRL",
        items: cart.map(item => ({
          item_id: item.product.id,
          item_name: item.product.name,
          quantity: item.quantity,
        })),
      });

      for (const productId of saleResult.depletedProductIds ?? []) {
        const product = products.find((item) => item.id === productId);
        if (product) {
          logTelemetryEvent("product_last_unit_sold", {
            productId,
            productName: product.name,
          }, uid);
        }
      }

      // Generate charges if installments
      if (paymentType === 'installments' && saleResult.remainingBalance > 0) {
        const chargeResponse = await fetch(getApiUrl("/api/payments/create-link"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            uid,
            clientId: selectedClient,
            saleId: saleResult.saleId,
            title: `Parcelamento - Venda ${saleResult.saleId}`,
            description: `${installments}x de R$ ${(saleResult.remainingBalance / installments).toFixed(2)}`,
            amount: saleResult.remainingBalance,
            metadata: {
              installmentCount: installments,
              downPayment,
              downPaymentMethod: downPayment > 0 ? downPaymentMethod : null,
              subtotal,
              discountType,
              discountValue,
              discountAmount,
              saleId: saleResult.saleId,
            },
          }),
        });

        if (!chargeResponse.ok) {
          const errorData = await chargeResponse.json().catch(() => ({}));
          const errorMsg = errorData.message || errorData.error || `HTTP ${chargeResponse.status}`;
          setSaveError(`⚠️ Venda salva, mas cobrança falhou: ${errorMsg}. Crie o link manualmente em Cobranças.`);
          logError("sale_charge_creation_failed", errorMsg, {
            saleId: saleResult.saleId,
            clientId: selectedClient,
            amount: saleResult.remainingBalance,
            status: chargeResponse.status,
          });
        } else {
          const chargeData = await chargeResponse.json();
          console.log("[sell] Charge created:", chargeData.chargeId);
        }
      }

      setSuccess(true);
      setTimeout(() => setLocation("/"), 2000);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Erro desconhecido";
      setSaveError(`Erro ao salvar: ${errorMsg}`);
      console.error("[sell] Checkout error:", err);
      
      // Log to Crashlytics
      logError("sale_checkout_error", errorMsg, {
        error: err instanceof Error ? err : undefined,
        context: { 
          clientId: selectedClient,
          cartItems: cart.length, 
          paymentType,
          totalAmount: total 
        },
        userId: uid,
        severity: "error",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (productsLoading || clientsLoading) {
    return <Layout title="Registrar Venda"><PageSkeleton variant="cards" count={4} /></Layout>;
  }

  if (success) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-full p-6 text-center animate-in fade-in zoom-in duration-300">
          <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mb-6">
            <CheckCircle2 className="w-12 h-12 text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-2">Venda Registrada!</h2>
          <p className="text-muted-foreground mb-4">Salva no Firestore com sucesso!</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Registrar Venda">
      <div className="flex flex-col h-full">
        <div className="p-6 bg-white border-b border-border/50 space-y-4">
          <div>
            <label className="text-[10px] font-black text-muted-foreground uppercase mb-1 block">Cliente (Obrigatório)</label>
            <select 
              required
              className="w-full bg-secondary/50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
              value={selectedClient}
              onChange={e => setSelectedClient(e.target.value)}
            >
              <option value="">Selecione o cliente...</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          
          <div className="relative">
            <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input 
              type="text" 
              placeholder="Buscar produto..." 
              className="w-full bg-secondary/50 border-none rounded-full py-3 pl-11 pr-4 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 pb-48 hide-scrollbar">
          <div className="grid grid-cols-2 gap-4">
            {filteredProducts.map(product => {
              const qty = cart.find(c => c.product.id === product.id)?.quantity || 0;
              return (
                <div key={product.id} className={`bg-white rounded-3xl p-3 border transition-all ${qty > 0 ? 'border-primary ring-4 ring-primary/5' : 'border-border/40'}`}>
                  <div className="aspect-square bg-secondary/30 rounded-2xl mb-2 flex items-center justify-center overflow-hidden relative">
                    <ProductImageCard product={product} size="full" objectFit="contain" className="!rounded-none !border-0" />
                    <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-md text-white text-[8px] font-black px-2 py-1 rounded-lg uppercase">
                      {product.stock} un
                    </div>
                  </div>
                  <h3 className="text-[11px] font-bold truncate">{product.name}</h3>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs font-black">R$ {Number(product.salePrice || 0).toFixed(2)}</span>
                    <div className="flex items-center gap-1">
                      {qty > 0 && <button onClick={() => removeFromCart(product.id)} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center active:scale-90"><Minus className="w-3.5 h-3.5"/></button>}
                      {qty > 0 && <span className="text-xs font-black w-4 text-center">{qty}</span>}
                      <button onClick={() => addToCart(product)} className="w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center active:scale-90 shadow-sm"><Plus className="w-3.5 h-3.5"/></button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {cart.length > 0 && (
          <div className="fixed bottom-24 left-0 right-0 p-4 max-w-md mx-auto z-40">
            <div className="bg-white rounded-2xl p-5 shadow-xl border border-border/20 animate-in slide-in-from-bottom-5 max-h-[calc(100dvh-8rem)] overflow-y-auto">
              <div className="mb-3"><p className="text-[9px] text-muted-foreground font-black uppercase tracking-widest">Resumo da Venda</p></div>
              <div className="mb-4 rounded-xl bg-secondary/20 p-3 space-y-3">
                <div className="flex items-center justify-between"><span className="text-[10px] font-bold text-muted-foreground">Subtotal</span><span className="text-sm font-bold">R$ {subtotal.toFixed(2)}</span></div>
                <div className="grid grid-cols-[auto_1fr] gap-2">
                  <div className="flex bg-white rounded-lg p-1 border border-border/40">
                    <button type="button" onClick={() => setDiscountType('fixed')} className={`px-3 py-2 rounded-md text-[9px] font-black ${discountType === 'fixed' ? 'bg-primary text-white' : 'text-muted-foreground'}`}>R$</button>
                    <button type="button" onClick={() => setDiscountType('percent')} className={`px-3 py-2 rounded-md text-[9px] font-black ${discountType === 'percent' ? 'bg-primary text-white' : 'text-muted-foreground'}`}>%</button>
                  </div>
                  <input type="number" min="0" max={discountType === 'percent' ? 100 : subtotal} step="0.01" value={discountValue} onChange={e => setDiscountValue(Math.max(0, Number(e.target.value)))} placeholder="Desconto" className="min-w-0 bg-white border border-border/40 rounded-lg px-3 text-sm font-bold outline-none focus:ring-1 focus:ring-primary" />
                </div>
                {discountAmount > 0 && <div className="flex items-center justify-between text-green-700"><span className="text-[10px] font-bold">Desconto aplicado</span><span className="text-sm font-black">- R$ {discountAmount.toFixed(2)}</span></div>}
                <div className="flex items-center justify-between border-t border-border/30 pt-2"><span className="text-[10px] font-black uppercase">Total</span><span className="text-2xl font-black">R$ {total.toFixed(2)}</span></div>
              </div>
              {/* Payment Type Toggle */}
              <div className="flex gap-3 mb-4">
                <button 
                  data-testid="button-payment-cash"
                  onClick={() => setPaymentType('cash')}
                  className={`flex-1 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all ${
                    paymentType === 'cash' 
                      ? 'bg-primary text-white shadow-sm' 
                      : 'bg-secondary/40 text-muted-foreground'
                  }`}
                >
                  À Vista
                </button>
                <button 
                  data-testid="button-payment-installments"
                  onClick={() => setPaymentType('installments')}
                  className={`flex-1 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all ${
                    paymentType === 'installments' 
                      ? 'bg-primary text-white shadow-sm' 
                      : 'bg-secondary/40 text-muted-foreground'
                  }`}
                >
                  A Prazo
                </button>
              </div>

              {/* Payment Details - Compact */}
              {paymentType === 'cash' ? (
                <div className="mb-4 pb-4 border-b border-border/20 space-y-2">
                  <p className="text-[9px] text-muted-foreground font-black uppercase">Forma de pagamento</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[['pix','Pix'],['dinheiro','Dinheiro'],['credito','Cartão de crédito'],['debito','Cartão de débito']].map(([value,label]) => <button type="button" key={value} onClick={() => setPaymentMethod(value as typeof paymentMethod)} className={`py-2.5 px-2 rounded-xl text-[9px] font-bold border ${paymentMethod === value ? 'bg-primary text-white border-primary' : 'bg-white text-muted-foreground border-border/50'}`}>{label}</button>)}
                  </div>
                </div>
              ) : (
                <div className="mb-4 pb-4 border-b border-border/20 space-y-2">
                  {/* Entrada */}
                  <div>
                    <label className="text-[8px] font-black text-muted-foreground uppercase block mb-1">Entrada (Opcional)</label>
                    <input 
                      data-testid="input-installment-down-payment"
                      type="number" 
                      className="w-full bg-secondary/30 border-none rounded-lg p-2 text-sm font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      value={downPayment} 
                      onChange={e => setDownPayment(Math.max(0, Number(e.target.value)))}
                      min={0}
                      max={total}
                      placeholder="0"
                    />
                  </div>

                  {downPayment > 0 && <div>
                    <label className="text-[8px] font-black text-muted-foreground uppercase block mb-1">Forma da entrada</label>
                    <div className="grid grid-cols-2 gap-2">
                      {[['pix','Pix'],['dinheiro','Dinheiro'],['credito','Cartão de crédito'],['debito','Cartão de débito']].map(([value,label]) => <button type="button" key={value} onClick={() => setDownPaymentMethod(value as typeof downPaymentMethod)} className={`py-2 px-2 rounded-lg text-[9px] font-bold border ${downPaymentMethod === value ? 'bg-primary text-white border-primary' : 'bg-white text-muted-foreground border-border/50'}`}>{label}</button>)}
                    </div>
                  </div>}
                  {/* Parcelas + Valor grid */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[8px] font-black text-muted-foreground uppercase block mb-1">Parcelas</label>
                      <input 
                        data-testid="input-installment-count"
                        type="number" 
                        className="w-full bg-secondary/30 border-none rounded-lg p-2 text-sm font-bold text-foreground text-center focus:outline-none focus:ring-1 focus:ring-primary"
                        value={installments} 
                        onChange={e => setInstallments(Math.max(1, Math.min(12, Number(e.target.value))))}
                        min={1}
                        max={12}
                      />
                    </div>
                    <div>
                      <label className="text-[8px] font-black text-muted-foreground uppercase block mb-1">Valor/Parc</label>
                      <div className="bg-primary/5 border border-primary/10 rounded-lg p-2 text-xs font-bold text-primary text-center">
                        {remainingBalance > 0 && installments > 0 
                          ? `R$ ${(remainingBalance / installments).toFixed(2)}`
                          : '-'
                        }
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Validation Messages - Discrete */}
              {!selectedClient && (
                <p className="text-[8px] text-muted-foreground font-medium mb-2">⚠ Selecione um cliente</p>
              )}
              {paymentType === 'installments' && installments < 1 && (
                <p className="text-[8px] text-muted-foreground font-medium mb-2">⚠ Defina parcelas</p>
              )}
              {saveError && (
                <p className="text-[8px] text-destructive font-medium mb-2">{saveError}</p>
              )}

              {/* CTA Button - Primary Action */}
              <button 
                data-testid="button-finalize-sale"
                onClick={handleCheckout}
                disabled={!selectedClient || cart.length === 0 || isSaving || (paymentType === 'installments' && installments < 1)}
                className="w-full bg-gradient-to-r from-primary to-primary/90 text-white font-black py-4 rounded-xl shadow-lg hover:shadow-xl disabled:opacity-40 disabled:cursor-not-allowed uppercase tracking-wider text-sm active:scale-95 transition-all border border-primary/20"
              >
                {isSaving ? (
                  <>
                    <span className="animate-spin inline-block mr-2">⏳</span>Finalizando...
                  </>
                ) : (
                  "✓ Finalizar Venda"
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
