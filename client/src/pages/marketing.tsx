import { useEffect, useState, useMemo, useRef } from "react";
import { Layout } from "@/components/layout";
import { defaultSettings, getProductImage } from "@/lib/mock-data";
import { useProductPickerData } from "@/hooks/useProductPickerData";
import { useUserSettings } from "@/providers/UserSettingsProvider";
import { getFirebaseAuth, logTelemetryEvent, trackAnalyticsEvent, logError } from "@/lib/firebase";
import { useFeatureEnabled } from "@/lib/remote-config-context";
import { Search, MessageSquare, Sparkles, Copy, Smartphone, Wallet, Info, Image as ImageIcon, History, WandSparkles, QrCode, ExternalLink, Store, PackageCheck, Megaphone, Link as LinkIcon } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useMarketingHistory, type MarketingHistoryEntry, type MarketingAction } from "@/hooks/useMarketingHistory";
import { MarketingHistoryPanel } from "@/components/MarketingHistoryPanel";
import { MarketingStats } from "@/components/MarketingStats";
import { PageSkeleton } from "@/components/PageSkeleton";
import { createMarketingCard, downloadMarketingCard } from "@/lib/marketing-card";
import { notifyError, notifyInfo, notifySuccess } from "@/lib/notify";

const MARKETING_TEMPLATES = {
  spotlight: { label: 'Produto em destaque', emoji: '⭐', headline: 'DESTAQUE DA LOJA!' },
  promo: { label: 'Oferta especial', emoji: '🏷️', headline: 'OFERTA IMPERDÍVEL!' },
  last: { label: 'Últimas unidades', emoji: '🚨', headline: 'CORRE QUE ESTÁ ACABANDO!' },
  new: { label: 'Lançamento', emoji: '✨', headline: 'NOVIDADE CHEGANDO!' },
  bestseller: { label: 'Mais vendido', emoji: '🏆', headline: 'O QUERIDINHO DAS CLIENTES!' },
  kit: { label: 'Kit promocional', emoji: '🎁', headline: 'MONTE SEU KIT ESPECIAL!' },
  catalog: { label: 'Compre pelo catálogo', emoji: '🛒', headline: 'PEÇA PELO CATÁLOGO ONLINE!' },
  whatsapp: { label: 'Chame no WhatsApp', emoji: '💬', headline: 'ME CHAMA NO WHATSAPP!' },
  delivery: { label: 'Frete/entrega', emoji: '🚚', headline: 'ENTREGA COMBINADA!' },
  preorder: { label: 'Encomendas abertas', emoji: '📦', headline: 'ENCOMENDAS ABERTAS!' },
} as const;

async function copyTextWithFallback(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export default function Marketing() {
  const { products, loading, loadingMore, error, hasMore, search, setSearch, loadMore } = useProductPickerData();
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
  const [catalogCopied, setCatalogCopied] = useState(false);
  const generatedKeys = useRef(new Set<string>());
  const copyResetTimeoutRef = useRef<number | null>(null);
  const catalogCopyResetTimeoutRef = useRef<number | null>(null);
  const { entries: historyEntries, loading: historyLoading, recordAction, removeEntry, clearHistory } = useMarketingHistory();

  const normalizedProductSearch = search.trim().toLowerCase();
  const filteredProducts = useMemo(() =>
    products.filter((product) => product.name.toLowerCase().includes(normalizedProductSearch)),
    [normalizedProductSearch, products]
  );

  // Get products and filter Kit products from Firestore (unified source)
  const kitProducts = useMemo(() =>
    filteredProducts.filter(p => p.category === 'Kit'),
    [filteredProducts]
  );

  const selectedProduct = useMemo(() =>
    products.find(p => p.id === selectedProductId),
    [products, selectedProductId]
  );

  const selectedKit = useMemo(() =>
    kitProducts.find(k => k.id === selectedKitId),
    [kitProducts, selectedKitId]
  );

  const templates = MARKETING_TEMPLATES;

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
  const catalogSlug = String((settings as typeof settings & { catalogSlug?: string; catalog_slug?: string }).catalogSlug || (settings as typeof settings & { catalogSlug?: string; catalog_slug?: string }).catalog_slug || "").trim();
  const catalogUrl = useMemo(() => {
    if (!catalogSlug) return "";
    const origin = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
    return origin ? `${origin}/u/${catalogSlug}` : `/u/${catalogSlug}`;
  }, [catalogSlug]);
  const featuredMarketingProducts = useMemo(() => filteredProducts.slice(0, 4), [filteredProducts]);
  const recentMaterialsCount = historyEntries.length;
  const currentPrice = priceOverride || selectedItem?.salePrice?.toFixed(2) || "0,00";
  const currentTemplate = templates[template as keyof typeof templates];
  const currentImageUrl = selectedItem ? getProductImage(selectedItem) || undefined : undefined;

  const entryPayload = (action: MarketingAction) => selectedItem ? {
    action, productId: selectedItem.id, productName: selectedItem.name,
    productBrand: String(selectedItem.brand || ""), imageUrl: selectedItem.imageUrl || currentImageUrl,
    photoUrl: (selectedItem as any).photoUrl, image: (selectedItem as any).image, imageId: selectedItem.imageId,
    generatedText, template, price: currentPrice, headline: currentTemplate.headline,
    storeName: settings.storeName || "Revenda Smart", primaryColor: settings.primaryColor || "#ec4899",
  } : null;

  const registerAction = async (action: MarketingAction) => {
    const payload = entryPayload(action);
    if (payload) await recordAction(payload).catch(error => console.error("[marketing] action not recorded", error));
  };

  useEffect(() => () => {
    if (copyResetTimeoutRef.current !== null) window.clearTimeout(copyResetTimeoutRef.current);
    if (catalogCopyResetTimeoutRef.current !== null) window.clearTimeout(catalogCopyResetTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (!selectedItem || !generatedText) return;
    const key = `${selectedItem.id}:${template}`;
    if (generatedKeys.current.has(key)) return;
    generatedKeys.current.add(key);
    void registerAction("generated");
  }, [selectedItem?.id, template]);

  const handleCopy = async () => {
    await copyTextWithFallback(generatedText);
    setCopied(true);
    if (copyResetTimeoutRef.current !== null) window.clearTimeout(copyResetTimeoutRef.current);
    copyResetTimeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
    await registerAction("copied");
    notifySuccess("Anúncio copiado.");
    const productId = selectedProductId || selectedKitId;
    const user = getFirebaseAuth()?.currentUser;
    logTelemetryEvent("ad_text_copied", { productId, template }, user?.uid);
    trackAnalyticsEvent("ad_text_copied", { item_id: productId });
  };

  const handleShare = async () => {
    await registerAction("shared");
    notifyInfo("Compartilhamento aberto no WhatsApp.");
    window.open(`https://wa.me/?text=${encodeURIComponent(generatedText)}`, "_blank", "noopener,noreferrer");
    const productId = selectedProductId || selectedKitId;
    const user = getFirebaseAuth()?.currentUser;
    logTelemetryEvent("ad_shared", { productId, channel: "whatsapp" }, user?.uid);
    trackAnalyticsEvent("share", { method: "whatsapp", content_type: "product", item_id: productId });
  };

  const requireCatalogUrl = () => {
    if (catalogUrl) return true;
    notifyError("Configure o link do catálogo nas configurações da loja.");
    return false;
  };

  const handleCopyCatalog = async () => {
    if (!requireCatalogUrl()) return;
    await copyTextWithFallback(catalogUrl);
    setCatalogCopied(true);
    if (catalogCopyResetTimeoutRef.current !== null) window.clearTimeout(catalogCopyResetTimeoutRef.current);
    catalogCopyResetTimeoutRef.current = window.setTimeout(() => setCatalogCopied(false), 2200);
    notifySuccess("Link do catálogo copiado.");
  };

  const handleShareCatalog = () => {
    if (!requireCatalogUrl()) return;
    const message = `Conheça meu catálogo online: ${catalogUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
    notifyInfo("Compartilhamento do catálogo aberto no WhatsApp.");
  };

  const handleOpenCatalog = () => {
    if (!requireCatalogUrl()) return;
    window.open(catalogUrl, "_blank", "noopener,noreferrer");
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
      notifySuccess("Card salvo.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível baixar o card";
      setImageError(message);
      notifyError("Não foi possível salvar o card.");
      logError("ad_image_generation_failed", message, { context: { template, hasProduct: !!selectedProductId, hasKit: !!selectedKitId } });
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
    notifySuccess("Anúncio copiado.");
  };
  const repeatShare = async (entry: MarketingHistoryEntry) => {
    await recordAction(repeatPayload(entry, "shared"));
    window.open(`https://wa.me/?text=${encodeURIComponent(entry.generatedText)}`, "_blank", "noopener,noreferrer");
    notifyInfo("Compartilhamento aberto no WhatsApp.");
  };
  const repeatDownload = async (entry: MarketingHistoryEntry) => {
    await downloadEntryCard(entry);
    await recordAction(repeatPayload(entry, "downloaded"));
    notifySuccess("Card salvo.");
  };

  if (loading) return <Layout title="Anúncios"><PageSkeleton variant="dashboard" /></Layout>;

  if (error) {
    return (
      <Layout title="Anúncios">
        <div className="p-6 text-center">
          <p className="text-destructive font-bold mb-2">Ocorreu um erro temporário.</p>
          <p className="text-muted-foreground text-sm mb-4">Não foi possível carregar os produtos para o Marketing.</p>
          <button onClick={() => window.location.reload()} className="rounded-xl bg-primary px-5 py-3 text-xs font-semibold text-white">Tentar novamente</button>
        </div>
      </Layout>
    );
  }



  return (
    <Layout title="Marketing">
      <div className="flex flex-col h-full bg-background">
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-32 space-y-5">
          <section className="relative overflow-hidden rounded-[2rem] border border-primary/10 bg-gradient-to-br from-white via-primary/5 to-rose-50 p-5 shadow-sm">
            <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
            <div className="relative grid gap-5 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary">Central de divulgação</p>
                <h1 className="mt-2 text-2xl font-black tracking-tight text-foreground">Divulgue sua loja com materiais prontos para vender</h1>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Crie artes, copie mensagens, gere QR Code e compartilhe seu catálogo sem sair do Revenda Smart.</p>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-2xl bg-white/80 p-3 shadow-sm"><p className="text-lg font-black text-primary">{products.length}</p><p className="text-[10px] font-bold text-muted-foreground">produtos</p></div>
                  <div className="rounded-2xl bg-white/80 p-3 shadow-sm"><p className="text-lg font-black text-primary">{recentMaterialsCount}</p><p className="text-[10px] font-bold text-muted-foreground">materiais</p></div>
                  <div className="rounded-2xl bg-white/80 p-3 shadow-sm"><p className="text-lg font-black text-primary">10</p><p className="text-[10px] font-bold text-muted-foreground">templates</p></div>
                  <div className="rounded-2xl bg-white/80 p-3 shadow-sm"><p className="text-lg font-black text-primary">QR</p><p className="text-[10px] font-bold text-muted-foreground">catálogo</p></div>
                </div>
              </div>
              <div className="rounded-[1.75rem] border border-border/50 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Catálogo público</p>
                    <p className="mt-1 text-sm font-black text-foreground truncate">{catalogUrl || "Link ainda não configurado"}</p>
                  </div>
                  <div className="rounded-2xl bg-white p-2 shadow-sm ring-1 ring-slate-200">
                    {catalogUrl ? <QRCodeSVG value={catalogUrl} size={72} bgColor="#ffffff" fgColor="#0f172a" level="M" includeMargin /> : <QrCode className="h-[72px] w-[72px] text-muted-foreground/35" />}
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button type="button" onClick={handleCopyCatalog} className="rs-pressable min-h-11 rounded-2xl bg-primary text-xs font-black text-white flex items-center justify-center gap-2"><Copy className="w-4 h-4" /> {catalogCopied ? "Copiado" : "Copiar link"}</button>
                  <button type="button" onClick={handleShareCatalog} className="rs-pressable min-h-11 rounded-2xl bg-[#25D366] text-xs font-black text-white flex items-center justify-center gap-2"><MessageSquare className="w-4 h-4" /> WhatsApp</button>
                </div>
              </div>
            </div>
          </section>

          <section className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <button type="button" onClick={() => setActiveTab("generator")} className="rs-card-interactive rounded-2xl border border-border bg-white p-4 text-left shadow-sm"><WandSparkles className="mb-3 h-5 w-5 text-primary" /><p className="text-xs font-black">Criar arte</p><p className="mt-1 text-[10px] text-muted-foreground">Produto ou promoção</p></button>
            <button type="button" onClick={() => { setActiveTab("generator"); setTemplate("promo"); }} className="rs-card-interactive rounded-2xl border border-border bg-white p-4 text-left shadow-sm"><Megaphone className="mb-3 h-5 w-5 text-primary" /><p className="text-xs font-black">Criar promoção</p><p className="mt-1 text-[10px] text-muted-foreground">Oferta pronta</p></button>
            <button type="button" onClick={handleShareCatalog} className="rs-card-interactive rounded-2xl border border-border bg-white p-4 text-left shadow-sm"><Store className="mb-3 h-5 w-5 text-primary" /><p className="text-xs font-black">Compartilhar catálogo</p><p className="mt-1 text-[10px] text-muted-foreground">Link da loja</p></button>
            <button type="button" onClick={handleCopyCatalog} className="rs-card-interactive rounded-2xl border border-border bg-white p-4 text-left shadow-sm"><QrCode className="mb-3 h-5 w-5 text-primary" /><p className="text-xs font-black">Gerar QR Code</p><p className="mt-1 text-[10px] text-muted-foreground">Copie o link rápido</p></button>
            <button type="button" onClick={() => { setActiveTab("generator"); setTemplate("whatsapp"); }} className="rs-card-interactive rounded-2xl border border-border bg-white p-4 text-left shadow-sm"><MessageSquare className="mb-3 h-5 w-5 text-primary" /><p className="text-xs font-black">Mensagem WhatsApp</p><p className="mt-1 text-[10px] text-muted-foreground">Texto pronto</p></button>
            <button type="button" onClick={() => setActiveTab("history")} className="rs-card-interactive rounded-2xl border border-border bg-white p-4 text-left shadow-sm"><History className="mb-3 h-5 w-5 text-primary" /><p className="text-xs font-black">Histórico</p><p className="mt-1 text-[10px] text-muted-foreground">Materiais recentes</p></button>
          </section>

          <MarketingStats entries={historyEntries} />
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-secondary/50 p-1.5">
            <button onClick={() => setActiveTab("generator")} className={`flex items-center justify-center gap-2 rounded-xl py-3 text-xs font-semibold transition-all ${activeTab === "generator" ? "bg-white text-primary shadow-sm" : "text-muted-foreground"}`}><WandSparkles className="h-4 w-4"/>Gerador</button>
            <button onClick={() => setActiveTab("history")} className={`flex items-center justify-center gap-2 rounded-xl py-3 text-xs font-semibold transition-all ${activeTab === "history" ? "bg-white text-primary shadow-sm" : "text-muted-foreground"}`}><History className="h-4 w-4"/>Histórico</button>
          </div>
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

              {featuredMarketingProducts.length > 0 && (
                <section className="space-y-3 rounded-[2rem] border border-border/50 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-primary">Produtos em destaque</p>
                      <p className="text-xs text-muted-foreground">Toque para começar uma arte rapidamente.</p>
                    </div>
                    <PackageCheck className="h-5 w-5 text-primary" />
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {featuredMarketingProducts.map((product) => (
                      <button key={product.id} type="button" onClick={() => { setSelectedProductId(product.id); setSelectedKitId(''); }} className={`rounded-2xl border p-3 text-left transition-all active:scale-[0.98] ${selectedProductId === product.id ? "border-primary bg-primary/5 text-primary" : "border-border bg-secondary/20 text-foreground"}`}>
                        <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground truncate">{product.brand || "Produto"}</p>
                        <p className="mt-1 text-xs font-black line-clamp-2">{product.name}</p>
                        <p className="mt-2 text-[11px] font-bold text-primary">R$ {Number(product.salePrice || 0).toFixed(2)}</p>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* Product/Kit Selection */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground px-1">Pesquisar produto</label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="search"
                    inputMode="search"
                    enterKeyHint="search"
                    autoComplete="off"
                    placeholder="Pesquisar produto..."
                    className="w-full bg-white border border-border rounded-2xl py-3 pl-11 pr-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground px-1">Produto Solo</label>
                  <select
                    className="w-full bg-white border border-border rounded-2xl p-4 text-xs focus:ring-2 focus:ring-primary/20 outline-none"
                    value={selectedProductId}
                    onChange={e => {
                      setSelectedProductId(e.target.value);
                      setSelectedKitId('');
                    }}
                  >
                    <option value="">Escolher...</option>
                    {filteredProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground px-1">Ou um Kit</label>
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
              {hasMore && (
                <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="w-full rounded-2xl bg-white border border-border px-4 py-3 text-xs font-semibold text-muted-foreground shadow-sm disabled:opacity-60">
                  {loadingMore ? "Carregando..." : "Carregar mais"}
                </button>
              )}
              {search && hasMore && (
                <p className="px-1 text-center text-[11px] text-muted-foreground">Carregue mais produtos para ampliar a busca.</p>
              )}

              {/* Template Selection */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground px-1">Templates rápidos</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {Object.entries(templates).map(([key, t]) => (
                    <button
                      key={key}
                      onClick={() => setTemplate(key)}
                      className={`rs-card-interactive flex flex-col items-center gap-1 p-3 rounded-2xl border ${template === key ? 'bg-primary/5 border-primary text-primary shadow-sm' : 'bg-white border-border text-muted-foreground'}`}
                    >
                      <span className="text-lg">{t.emoji}</span>
                      <span className="text-[10px] font-semibold text-center leading-tight">{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Options */}
              <div className="space-y-4 bg-white p-6 rounded-3xl border border-border/50 shadow-sm">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground px-1">Preço Especial (Opcional)</label>
                  <input
                    type="number" inputMode="decimal" enterKeyHint="next"
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
                  <label className="text-xs font-semibold text-muted-foreground px-1">Nota Curta</label>
                  <input
                    type="text"
                    placeholder="Ex: Só hoje!, Frete Grátis"
                    className="w-full bg-secondary/30 border-none rounded-xl p-3 text-sm"
                    value={note}
                    onChange={e => setNote(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground px-1">Chamada (CTA)</label>
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
                      <span className="text-xs font-semibold text-muted-foreground">Incluir Pagamento</span>
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
              <section className="grid gap-3 sm:grid-cols-3">
                {[
                  "Use foto limpa e preço visível.",
                  "Comece pelo produto campeão da semana.",
                  "Compartilhe o catálogo depois da arte.",
                ].map((tip) => (
                  <div key={tip} className="rounded-2xl border border-primary/10 bg-primary/5 p-3 text-[11px] font-semibold text-primary"><Sparkles className="mb-2 h-4 w-4" />{tip}</div>
                ))}
              </section>

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
                            <img src={imgSrc} className="w-full h-full object-contain" alt={itemToUse?.name || "Produto"} loading="lazy" decoding="async" width={80} height={80} />
                          ) : (
                            <div className="text-[8px] text-muted-foreground text-center">Sem imagem</div>
                          );
                        })()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-green-700 mb-1">Preview WhatsApp</p>
                        <div className="bg-white p-3 rounded-2xl text-[11px] font-medium whitespace-pre-wrap leading-relaxed shadow-sm">
                          {generatedText}
                        </div>
                      </div>
                    </div>

                    {/* CTA Hierarchy: Primary > Secondary > Tertiary */}
                    <button
                      onClick={handleCopy}
                      className={`w-full font-semibold py-4 rounded-2xl text-xs flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all mb-3 border ${
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
                      className="rs-pressable w-full bg-[#25D366] text-white font-semibold py-3.5 rounded-2xl text-xs flex items-center justify-center gap-2 shadow-md hover:shadow-lg mb-3"
                      data-testid="button-share-whatsapp-ad"
                    >
                      <MessageSquare className="w-4 h-4" /> Compartilhar no WhatsApp
                    </button>

                    {imageError && <p className="mb-3 rounded-xl bg-red-50 p-3 text-center text-[10px] font-bold text-red-700">{imageError}</p>}
                    <button
                      onClick={handleDownloadImage}
                      className="rs-pressable w-full bg-white text-primary font-semibold py-3 rounded-2xl text-xs flex items-center justify-center gap-2 shadow-sm hover:bg-primary/5 border border-primary/20"
                      data-testid="button-download-ad-image"
                    >
                      <ImageIcon className="w-4 h-4" /> Baixar Card
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-white p-12 rounded-[2.5rem] border border-dashed border-border flex flex-col items-center justify-center text-center gap-4">
                  <div className="w-20 h-20 bg-primary/10 rounded-[2rem] flex items-center justify-center">
                    <Info className="w-9 h-9 text-primary/45" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Nenhum produto selecionado</p>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground px-4">Escolha um produto ou kit acima para gerar seu anúncio automático.</p>
                  </div>
                  {products.length === 0 && <button onClick={() => window.location.href = "/add-product"} className="rs-pressable rounded-2xl bg-primary px-5 py-3 text-xs font-semibold text-white">Cadastrar produto</button>}
                </div>
              )}
            </div>
          ) : (
            <MarketingHistoryPanel entries={historyEntries} loading={historyLoading} onCopy={repeatCopy} onShare={repeatShare} onDownload={repeatDownload} onRemove={removeEntry} onClear={clearHistory} onCreate={() => setActiveTab("generator")} />
          )}
        </div>
      </div>
    </Layout>
  );
}
