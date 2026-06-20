import { useEffect, useState, useMemo, useRef } from "react";
import { Layout } from "@/components/layout";
import { defaultSettings, getProductImage } from "@/lib/mock-data";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useUserSettings } from "@/hooks/useUserSettings";
import { getFirebaseAuth, logTelemetryEvent, trackAnalyticsEvent, logError } from "@/lib/firebase";
import { useFeatureEnabled } from "@/lib/remote-config-context";
import { MessageSquare, Sparkles, Copy, Smartphone, Wallet, Info, Image as ImageIcon, History, WandSparkles } from "lucide-react";
import { useMarketingHistory, type MarketingHistoryEntry, type MarketingAction } from "@/hooks/useMarketingHistory";
import { MarketingHistoryPanel } from "@/components/MarketingHistoryPanel";
import { MarketingStats } from "@/components/MarketingStats";
import { PageSkeleton } from "@/components/PageSkeleton";
import { createMarketingCard, downloadMarketingCard } from "@/lib/marketing-card";

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
  const [activeTab, setActiveTab] = useState<"generator" | "history">("generator");
  const [feedback, setFeedback] = useState("");
  const generatedKeys = useRef(new Set<string>());
  const { entries: historyEntries, loading: historyLoading, recordAction, removeEntry, clearHistory } = useMarketingHistory();

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
  const selectedItem = selectedProduct || selectedKit;
  const currentPrice = priceOverride || selectedItem?.salePrice?.toFixed(2) || "0,00";
  const currentTemplate = templates[template as keyof typeof templates];
  const currentImageUrl = selectedItem ? getProductImage(selectedItem) || undefined : undefined;

  const entryPayload = (action: MarketingAction) => selectedItem ? {
    action, productId: selectedItem.id, productName: selectedItem.name,
    productBrand: String(selectedItem.brand || ""), imageUrl: selectedItem.imageUrl || currentImageUrl,
    photoUrl: (selectedItem as any).photoUrl, image: (selectedItem as any).image, imageId: selectedItem.imageId,
    generatedText, template, price: currentPrice, headline: currentTemplate.headline,
    storeName: settings.storeName || "RevendaSmart", primaryColor: settings.primaryColor || "#ec4899",
  } : null;

  const registerAction = async (action: MarketingAction) => {
    const payload = entryPayload(action);
    if (payload) await recordAction(payload).catch(error => console.error("[marketing] action not recorded", error));
  };

  useEffect(() => {
    if (!selectedItem || !generatedText) return;
    const key = `${selectedItem.id}:${template}`;
    if (generatedKeys.current.has(key)) return;
    generatedKeys.current.add(key);
    void registerAction("generated");
  }, [selectedItem?.id, template]);

  const showFeedback = (message: string) => {
    setFeedback(message);
    window.setTimeout(() => setFeedback(""), 2500);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(generatedText);
    setCopied(true); window.setTimeout(() => setCopied(false), 2000);
    await registerAction("copied");
    showFeedback("Anúncio copiado");
    const productId = selectedProductId || selectedKitId;
    const user = getFirebaseAuth()?.currentUser;
    logTelemetryEvent("ad_text_copied", { productId, template }, user?.uid);
    trackAnalyticsEvent("ad_text_copied", { item_id: productId });
  };

  const handleShare = async () => {
    await registerAction("shared");
    showFeedback("Compartilhamento aberto no WhatsApp");
    window.open(`https://wa.me/?text=${encodeURIComponent(generatedText)}`, "_blank");
    const productId = selectedProductId || selectedKitId;
    const user = getFirebaseAuth()?.currentUser;
    logTelemetryEvent("ad_shared", { productId, channel: "whatsapp" }, user?.uid);
    trackAnalyticsEvent("share", { method: "whatsapp", content_type: "product", item_id: productId });
  };

  const downloadEntryCard = async (entry: MarketingHistoryEntry) => {
    const blob = await createMarketingCard(entry);
    downloadMarketingCard(blob, entry.productName);
  };

  const handleDownloadImage = async () => {
    const payload = entryPayload("downloaded");
    if (!payload) return;
    try {
      const blob = await createMarketingCard(payload);
      downloadMarketingCard(blob, payload.productName);
      await recordAction(payload);
      showFeedback("Download concluído");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível baixar o card";
      setImageError(message);
      logError("ad_image_generation_failed", message, { template, hasProduct: !!selectedProductId, hasKit: !!selectedKitId });
    }
  };

  const repeatPayload = (entry: MarketingHistoryEntry, action: MarketingAction) => ({
    action, productId: entry.productId, productName: entry.productName, productBrand: entry.productBrand || "",
    imageUrl: entry.imageUrl, photoUrl: entry.photoUrl, image: entry.image, imageId: entry.imageId, generatedText: entry.generatedText, template: entry.template, price: entry.price,
    headline: entry.headline, storeName: entry.storeName, primaryColor: entry.primaryColor,
  });
  const repeatCopy = async (entry: MarketingHistoryEntry) => {
    await navigator.clipboard.writeText(entry.generatedText);
    await recordAction(repeatPayload(entry, "copied"));
    showFeedback("Anúncio copiado");
  };
  const repeatShare = async (entry: MarketingHistoryEntry) => {
    await recordAction(repeatPayload(entry, "shared"));
    window.open(`https://wa.me/?text=${encodeURIComponent(entry.generatedText)}`, "_blank");
  };
  const repeatDownload = async (entry: MarketingHistoryEntry) => {
    await downloadEntryCard(entry);
    await recordAction(repeatPayload(entry, "downloaded"));
    showFeedback("Download concluído");
  };

  if (loading) return <Layout title="Anúncios"><PageSkeleton variant="dashboard" /></Layout>;

  if (error) {
    return (
      <Layout title="Anúncios">
        <div className="p-6 text-center">
          <p className="text-destructive font-bold mb-2">Ocorreu um erro temporário.</p>
          <p className="text-muted-foreground text-sm mb-4">Não foi possível carregar os produtos para o Marketing.</p>
          <button onClick={() => window.location.reload()} className="rounded-xl bg-primary px-5 py-3 text-xs font-black text-white">Tentar novamente</button>
        </div>
      </Layout>
    );
  }



  return (
    <Layout title="Marketing">
      <div className="flex flex-col h-full bg-background">
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-32 space-y-5">
          <MarketingStats entries={historyEntries} />
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-secondary/50 p-1.5">
            <button onClick={() => setActiveTab("generator")} className={`flex items-center justify-center gap-2 rounded-xl py-3 text-xs font-black transition-all ${activeTab === "generator" ? "bg-white text-primary shadow-sm" : "text-muted-foreground"}`}><WandSparkles className="h-4 w-4"/>Gerador</button>
            <button onClick={() => setActiveTab("history")} className={`flex items-center justify-center gap-2 rounded-xl py-3 text-xs font-black transition-all ${activeTab === "history" ? "bg-white text-primary shadow-sm" : "text-muted-foreground"}`}><History className="h-4 w-4"/>Histórico</button>
          </div>
          {feedback && <div className="fixed left-1/2 top-20 z-[80] -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-xs font-bold text-background shadow-xl animate-in fade-in">{feedback}</div>}
          {activeTab === "generator" ? (
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
                            <img src={imgSrc} className="w-full h-full object-contain" alt={itemToUse?.name || "Produto"} loading="lazy" decoding="async" />
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

                    {imageError && <p className="mb-3 rounded-xl bg-red-50 p-3 text-center text-[10px] font-bold text-red-700">{imageError}</p>}
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
          ) : (
            <MarketingHistoryPanel entries={historyEntries} loading={historyLoading} onCopy={repeatCopy} onShare={repeatShare} onDownload={repeatDownload} onRemove={removeEntry} onClear={clearHistory} />
          )}
        </div>
      </div>
    </Layout>
  );
}
