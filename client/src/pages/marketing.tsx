import { useState, useMemo, useRef } from "react";
import { Layout } from "@/components/layout";
import { Product, AppSettings, defaultSettings, getProductImage } from "@/lib/mock-data";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useUserSettings } from "@/hooks/useUserSettings";
import { getFirebaseAuth, logTelemetryEvent, trackAnalyticsEvent, logError } from "@/lib/firebase";
import { useFeatureEnabled } from "@/lib/remote-config-context";
import { 
  Megaphone, Share2, MessageSquare, Plus, Tag,
  Gift, Sparkles, Heart, Copy, ChevronRight, AlertCircle, ShoppingBag, 
  Smartphone, Wallet, Info, Image as ImageIcon, Download
} from "lucide-react";

export default function Marketing() {
  const { products, loading, error } = useDashboardData();
  const { settings: firestoreSettings } = useUserSettings();
  const settings = firestoreSettings || defaultSettings;
  const v2TemplatesEnabled = useFeatureEnabled("marketing_templates_v2_enabled");
  
  const [imageError, setImageError] = useState("");
  
  // Ad Generator State
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedKitId, setSelectedKitId] = useState('');
  const [template, setTemplate] = useState('promo');
  const [priceOverride, setPriceOverride] = useState('');
  const [note, setNote] = useState('');
  const [ctaText, setCtaText] = useState('Me chama no WhatsApp!');
  const [includePayment, setIncludePayment] = useState(false);

  // Get products and filter Kit products from Firestore (unified source)
  const kitProducts = useMemo(() => 
    products.filter(p => p.category === 'Kit'),
    [products]
  );

  const selectedProduct = useMemo(() => 
    products.find(p => p.id === selectedProductId), 
    [products, selectedProductId]
  );

  const selectedKit = useMemo(() => 
    kitProducts.find(k => k.id === selectedKitId),
    [kitProducts, selectedKitId]
  );

  const templates = {
    promo: { label: 'Promoção', emoji: '🏷️', headline: 'OFERTA IMPERDÍVEL!' },
    last: { label: 'Últimas Unidades', emoji: '🚨', headline: 'CORRE QUE ESTÁ ACABANDO!' },
    kit: { label: 'Kit/Combo', emoji: '🎁', headline: 'MONTE SEU KIT ESPECIAL!' },
    new: { label: 'Lançamento', emoji: '✨', headline: 'NOVIDADE CHEGANDO!' },
    tip: { label: 'Dica de Beleza', emoji: '💡', headline: 'DICA DE BELEZA DO DIA!' }
  };

  const generatedText = useMemo(() => {
    if (!selectedProduct && !selectedKit) return '';
    
    const t = templates[template as keyof typeof templates];
    const price = priceOverride || (selectedProduct ? selectedProduct.salePrice.toFixed(2) : selectedKit?.salePrice.toFixed(2));
    
    let text = `${t.emoji} *${t.headline}*\n\n`;
    const item = selectedProduct || selectedKit;
    if (item) {
      const emoji = selectedKit ? '🎁' : '🛍️';
      text += `${emoji} *${item.name}*\n`;
      if (item.brand) text += `✨ Marca: ${item.brand}\n`;
    }
    text += `💰 *Por apenas R$ ${price}*\n\n`;
    text += `✅ Pronta entrega\n`;
    
    if (note) text += `📝 ${note}\n`;
    
    if (selectedProduct?.extras) {
      Object.entries(selectedProduct.extras).forEach(([key, val]) => {
        if (val) {
          const label = {
            size: 'Tamanho', color: 'Cor', material: 'Material',
            volume_ml: 'Volume', expiration_date: 'Validade', scent_family: 'Fragrância',
            weight: 'Peso', flavor: 'Sabor', model: 'Modelo', extra_notes: 'Notas'
          }[key] || key;
          text += `🔹 ${label}: ${val}\n`;
        }
      });
    }
    
    text += `\n💬 ${ctaText}\n`;
    
    if (includePayment) {
      if (settings.pixKey) text += `\n🔑 PIX: ${settings.pixKey}`;
      if (settings.paymentLink) text += `\n💳 Link de Pagamento: ${settings.paymentLink}`;
    }
    
    return text;
  }, [selectedProduct, selectedKit, template, priceOverride, note, ctaText, includePayment, settings]);

  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    
    const user = getFirebaseAuth()?.currentUser;
    logTelemetryEvent("ad_text_copied", {
      template,
      hasProduct: !!selectedProductId,
      hasKit: !!selectedKitId,
    }, user?.uid);
    
    // Track ad text copied event (both telemetry and analytics)
    const productId = selectedProductId || selectedKitId;
    if (productId) {
      const user = getFirebaseAuth()?.currentUser;
      logTelemetryEvent("ad_text_copied", { productId, template }, user?.uid);
      trackAnalyticsEvent("ad_text_copied", { item_id: productId });
    }
  };

  const handleShare = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(generatedText)}`, '_blank');
    
    // Track ad shared event (both telemetry and analytics)
    const productId = selectedProductId || selectedKitId;
    if (productId) {
      const user = getFirebaseAuth()?.currentUser;
      logTelemetryEvent("ad_shared", { productId, channel: "whatsapp" }, user?.uid);
      trackAnalyticsEvent("share", { method: "whatsapp", content_type: "product", item_id: productId });
    }
  };

  const adRef = useRef<HTMLDivElement>(null);

  if (loading) {
    return (
      <Layout title="Anúncios">
        <div className="flex flex-col items-center justify-center py-12">
          <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin"></div>
          <p className="text-muted-foreground mt-4">Carregando produtos...</p>
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout title="Anúncios">
        <div className="p-6 text-center">
          <p className="text-destructive font-bold mb-2">Erro ao carregar produtos</p>
          <p className="text-muted-foreground text-sm">{error}</p>
        </div>
      </Layout>
    );
  }

  const renderProductImage = (ctx: CanvasRenderingContext2D, url: string, callback: () => void) => {
    if (!url) {
      callback();
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    img.onload = () => {
      // Calculate aspect ratio to fit in 500x500
      const ratio = Math.min(500 / img.width, 500 / img.height);
      const w = img.width * ratio;
      const h = img.height * ratio;
      const x = 540 - w / 2;
      const y = 500 - h / 2;
      ctx.drawImage(img, x, y, w, h);
      callback();
    };
    img.onerror = () => callback();
  };

  const handleDownloadImage = () => {
    if (!adRef.current) return;
    
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = 1080;
      canvas.height = 1080;

      // Background
      const gradient = ctx.createLinearGradient(0, 0, 1080, 1080);
      gradient.addColorStop(0, settings.primaryColor || '#ec4899');
      gradient.addColorStop(1, '#ffffff');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 1080, 1080);

      // White Card
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.1)';
      ctx.shadowBlur = 50;
      ctx.beginPath();
      ctx.roundRect(100, 100, 880, 880, 80);
      ctx.fill();

      // Store Name
      ctx.shadowBlur = 0;
      ctx.fillStyle = settings.primaryColor || '#ec4899';
      ctx.font = '900 40px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(settings.storeName.toUpperCase(), 540, 200);

      // Product Image (if available)
      const itemToRender = selectedProduct || selectedKit;
      const imgUrl = itemToRender ? getProductImage(itemToRender) : null;
      if (imgUrl) {
        renderProductImage(ctx, imgUrl, renderText);
      } else {
        renderText();
      }

      function renderText() {
        const t = templates[template as keyof typeof templates];
        const price = priceOverride || selectedProduct?.salePrice.toFixed(2);

        // Badge
        ctx.fillStyle = settings.primaryColor || '#ec4899';
        ctx.beginPath();
        ctx.roundRect(340, 780, 400, 80, 40);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = '900 32px Outfit, sans-serif';
        ctx.fillText(t.headline, 540, 832);

        // Product/Kit Name
        ctx.fillStyle = '#1f2937';
        ctx.font = '900 60px Outfit, sans-serif';
        ctx.fillText(selectedProduct?.name || selectedKit?.name || "", 540, 920);

        // Price
        ctx.fillStyle = settings.primaryColor || '#ec4899';
        ctx.font = '900 80px Outfit, sans-serif';
        ctx.fillText(`R$ ${price}`, 540, 1010);

        const link = document.createElement('a');
        link.download = `anuncio-${selectedProduct?.name || selectedKit?.name}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro desconhecido ao gerar imagem";
      setImageError(`Erro: ${msg}`);
      logError("ad_image_generation_failed", msg, {
        template,
        hasProduct: !!selectedProductId,
        hasKit: !!selectedKitId,
      });
    }
  };


  return (
    <Layout title="Marketing">
      <div className="flex flex-col h-full bg-background">
        <div className="flex-1 overflow-y-auto p-6 pb-32">
          {(
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
              {/* New Templates Notice - Controlled by marketing_templates_v2_enabled flag */}
              {v2TemplatesEnabled && (
                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex gap-3">
                  <Sparkles className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-blue-900 text-sm">Novos Templates Disponíveis!</p>
                    <p className="text-xs text-blue-700 mt-1">Você agora tem acesso a templates v2 com mais opções de personalização.</p>
                  </div>
                </div>
              )}
              
              {/* Product/Kit Selection */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest px-1">Produto Solo</label>
                  <select 
                    className="w-full bg-white border border-border rounded-2xl p-4 text-xs focus:ring-2 focus:ring-primary/20 outline-none"
                    value={selectedProductId}
                    onChange={e => {
                      setSelectedProductId(e.target.value);
                      setSelectedKitId('');
                    }}
                  >
                    <option value="">Escolher...</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest px-1">Ou um Kit</label>
                  <select 
                    className="w-full bg-white border border-border rounded-2xl p-4 text-xs focus:ring-2 focus:ring-primary/20 outline-none"
                    value={selectedKitId}
                    onChange={e => {
                      setSelectedKitId(e.target.value);
                      setSelectedProductId('');
                    }}
                  >
                    <option value="">Escolher...</option>
                    {kitProducts.length === 0 ? (
                      <option disabled>Nenhum kit cadastrado</option>
                    ) : (
                      kitProducts.map(k => <option key={k.id} value={k.id}>{k.name}</option>)
                    )}
                  </select>
                </div>
              </div>

              {/* Template Selection */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest px-1">Escolha o Tema</label>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(templates).map(([key, t]) => (
                    <button 
                      key={key}
                      onClick={() => setTemplate(key)}
                      className={`flex flex-col items-center gap-1 p-3 rounded-2xl border transition-all ${template === key ? 'bg-primary/5 border-primary text-primary shadow-sm' : 'bg-white border-border text-muted-foreground'}`}
                    >
                      <span className="text-lg">{t.emoji}</span>
                      <span className="text-[8px] font-black uppercase text-center leading-tight">{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Options */}
              <div className="space-y-4 bg-white p-6 rounded-3xl border border-border/50 shadow-sm">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest px-1">Preço Especial (Opcional)</label>
                  <input 
                    type="number" 
                    placeholder="Ex: 89.90"
                    className="w-full bg-secondary/30 border-none rounded-xl p-3 text-sm"
                    value={priceOverride}
                    onChange={e => {
                      const val = e.target.value;
                      if (val === '' || (parseFloat(val) >= 0.01 && parseFloat(val) <= 999999)) {
                        setPriceOverride(val);
                      }
                    }}
                    min="0.01"
                    max="999999"
                    step="0.01"
                    data-testid="input-price-override"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest px-1">Nota Curta</label>
                  <input 
                    type="text" 
                    placeholder="Ex: Só hoje!, Frete Grátis"
                    className="w-full bg-secondary/30 border-none rounded-xl p-3 text-sm"
                    value={note}
                    onChange={e => setNote(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest px-1">Chamada (CTA)</label>
                  <input 
                    type="text" 
                    className="w-full bg-secondary/30 border-none rounded-xl p-3 text-sm"
                    value={ctaText}
                    onChange={e => setCtaText(e.target.value)}
                  />
                </div>
                
                {(settings.pixKey || settings.paymentLink) && (
                  <div className="flex items-center justify-between pt-2 border-t border-border/50 mt-2">
                    <div className="flex items-center gap-2">
                      <Wallet className="w-4 h-4 text-primary" />
                      <span className="text-[10px] font-black text-muted-foreground uppercase">Incluir Pagamento</span>
                    </div>
                    <input 
                      type="checkbox" 
                      checked={includePayment}
                      onChange={e => setIncludePayment(e.target.checked)}
                      className="w-5 h-5 accent-primary"
                    />
                  </div>
                )}
              </div>

              {/* Preview Area */}
              {selectedProduct || selectedKit ? (
                <div className="space-y-4">
                  <div className="bg-[#E7FCE3] p-6 rounded-[2.5rem] border border-green-200 shadow-sm relative">
                    <div className="absolute -top-3 -left-3 bg-white p-2 rounded-full border border-green-100 shadow-sm">
                      <Smartphone className="w-4 h-4 text-green-600" />
                    </div>
                    <div className="flex gap-4 mb-4">
                      <div className="w-20 h-20 bg-white rounded-2xl overflow-hidden shadow-sm p-2 flex-shrink-0 flex items-center justify-center">
                        {(() => {
                          const itemToUse = selectedProduct || (selectedKit && products.find(p => p.id === selectedKit.id));
                          const imgSrc = itemToUse ? getProductImage(itemToUse) : null;
                          return imgSrc ? (
                            <img src={imgSrc} className="w-full h-full object-contain" alt="preview" />
                          ) : (
                            <div className="text-[8px] text-muted-foreground text-center">Sem imagem</div>
                          );
                        })()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-black text-green-700 uppercase tracking-widest mb-1">Preview WhatsApp</p>
                        <div className="bg-white p-3 rounded-2xl text-[11px] font-medium whitespace-pre-wrap leading-relaxed shadow-sm">
                          {generatedText}
                        </div>
                      </div>
                    </div>
                    
                    {/* CTA Hierarchy: Primary > Secondary > Tertiary */}
                    <button 
                      onClick={handleCopy}
                      className={`w-full font-black py-4 rounded-2xl text-[10px] uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all mb-3 border ${
                        copied
                          ? "bg-green-500 text-white border-green-600"
                          : "bg-primary text-white border-primary/20 hover:shadow-xl"
                      }`}
                      data-testid="button-copy-ad-text"
                    >
                      {copied ? "✓ Copiado!" : <>
                        <Copy className="w-4 h-4" /> Copiar Anúncio
                      </>}
                    </button>

                    <button 
                      onClick={handleShare}
                      className="w-full bg-[#25D366] text-white font-black py-3.5 rounded-2xl text-[10px] uppercase tracking-wider flex items-center justify-center gap-2 shadow-md hover:shadow-lg active:scale-95 transition-all mb-3"
                      data-testid="button-share-whatsapp-ad"
                    >
                      <MessageSquare className="w-4 h-4" /> Compartilhar no WhatsApp
                    </button>

                    <button 
                      onClick={handleDownloadImage}
                      className="w-full bg-white text-primary font-black py-3 rounded-2xl text-[10px] uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm hover:bg-primary/5 active:scale-95 transition-all border border-primary/20"
                      data-testid="button-download-ad-image"
                    >
                      <ImageIcon className="w-4 h-4" /> Baixar Card
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-white p-12 rounded-[2.5rem] border border-dashed border-border flex flex-col items-center justify-center text-center gap-4">
                  <div className="w-16 h-16 bg-secondary rounded-full flex items-center justify-center">
                    <Info className="w-8 h-8 text-muted-foreground/40" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-muted-foreground uppercase">Nenhum produto selecionado</p>
                    <p className="text-[10px] text-muted-foreground/60 px-4">Escolha um produto acima para gerar seu anúncio automático!</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
