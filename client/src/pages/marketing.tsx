import { useEffect, useState, useMemo, useRef } from "react";
import "@/styles/marketing.css";
import { Layout } from "@/components/layout";
import { defaultSettings, getProductImage } from "@/lib/mock-data";
import { useProductPickerData } from "@/hooks/useProductPickerData";
import { useUserSettings } from "@/providers/UserSettingsProvider";
import { getFirebaseAuth, logTelemetryEvent, trackAnalyticsEvent, logError } from "@/lib/firebase";
import { useFeatureEnabled } from "@/lib/remote-config-context";
import { Search, MessageSquare, Copy, Wallet, Info, Image as ImageIcon, History, WandSparkles, QrCode, Store, PackageCheck, Megaphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useMarketingHistory, type MarketingHistoryEntry, type MarketingAction } from "@/hooks/useMarketingHistory";
import { MarketingHistoryPanel } from "@/components/MarketingHistoryPanel";
import { MarketingStats } from "@/components/MarketingStats";
import { MarketingAdCanvas } from "@/components/MarketingAdCanvas";
import { PageSkeleton } from "@/components/PageSkeleton";
import { createMarketingCard, downloadMarketingCard } from "@/lib/marketing-card";
import { MARKETING_AD_THEME_IDS, MARKETING_AD_THEMES, MARKETING_TEMPLATES, buildMarketingAdConfig, buildMarketingAdMessage, buildMarketingVolumeText, formatMarketingPrice, normalizeMarketingAdConfig, parseMarketingPriceNumber, resolveMarketingTemplate, type MarketingAdThemeId, type MarketingBackgroundStyle, type MarketingTemplateId } from "@/lib/marketing-ad";
import { notifyError, notifyInfo, notifySuccess } from "@/lib/notify";

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

const MARKETING_AD_THEME_STORAGE_KEY = "rs:marketing-ad-theme";

function readStoredMarketingTheme(): MarketingAdThemeId {
  if (typeof window === "undefined") return "brand";
  try {
    const stored = localStorage.getItem(MARKETING_AD_THEME_STORAGE_KEY) as MarketingAdThemeId | null;
    return stored && MARKETING_AD_THEME_IDS.includes(stored) ? stored : "brand";
  } catch {
    return "brand";
  }
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
  const [template, setTemplate] = useState<MarketingTemplateId>('promo');
  const [priceOverride, setPriceOverride] = useState('');
  const [note, setNote] = useState('');
  const [ctaText, setCtaText] = useState('Peça pelo WhatsApp');
  const [adTheme, setAdTheme] = useState<MarketingAdThemeId>(() => readStoredMarketingTheme());
  const [showBrand, setShowBrand] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [showStockStatus, setShowStockStatus] = useState(true);
  const [showWhatsAppCta, setShowWhatsAppCta] = useState(true);
  const [backgroundStyle, setBackgroundStyle] = useState<MarketingBackgroundStyle>('soft-gradient');
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [includePayment, setIncludePayment] = useState(false);
  const [activeTab, setActiveTab] = useState<"generator" | "history">("generator");
  const [catalogCopied, setCatalogCopied] = useState(false);
  const generatedKeys = useRef(new Set<string>());
  const copyResetTimeoutRef = useRef<number | null>(null);
  const catalogCopyResetTimeoutRef = useRef<number | null>(null);
  const { entries: historyEntries, loading: historyLoading, recordAction, updateEntry, removeEntry, clearHistory } = useMarketingHistory();

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
  const selectedItem = selectedProduct || selectedKit;
  const catalogSlug = String((settings as typeof settings & { catalogSlug?: string; catalog_slug?: string }).catalogSlug || (settings as typeof settings & { catalogSlug?: string; catalog_slug?: string }).catalog_slug || "").trim();
  const catalogUrl = useMemo(() => {
    if (!catalogSlug) return "";
    const origin = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
    return origin ? `${origin}/u/${catalogSlug}` : `/u/${catalogSlug}`;
  }, [catalogSlug]);
  const featuredMarketingProducts = useMemo(() => filteredProducts.slice(0, 4), [filteredProducts]);
  const recentMaterialsCount = historyEntries.length;
  const currentTemplate = resolveMarketingTemplate(template);
  const currentImageUrl = selectedItem ? getProductImage(selectedItem) || undefined : undefined;
  const storeLogoUrl = String(settings.storeIdentity?.logoUrl || settings.storeLogo || "").trim();
  const currentAdConfig = useMemo(() => {
    if (!selectedItem) return null;
    return buildMarketingAdConfig({
      productId: selectedItem.id,
      productName: selectedItem.name,
      productBrand: selectedItem.brand || "",
      productImageUrl: currentImageUrl,
      imageUrl: selectedItem.imageUrl || currentImageUrl,
      photoUrl: (selectedItem as { photoUrl?: string }).photoUrl,
      image: (selectedItem as { image?: string }).image,
      imageId: selectedItem.imageId,
      productVolume: buildMarketingVolumeText(selectedItem.extras),
      productStock: selectedItem.stock,
      price: priceOverride || selectedItem.salePrice || 0,
      headline: currentTemplate.headline,
      note,
      ctaText,
      storeName: settings.storeName || "Revenda Smart",
      storeLogoUrl,
      primaryColor: settings.primaryColor || "#ec4899",
      templateId: currentTemplate.id,
      themeId: adTheme,
      showBrand,
      showVolume,
      showStockStatus,
      showWhatsAppCta,
      backgroundStyle,
      catalogUrl,
    });
  }, [adTheme, backgroundStyle, catalogUrl, ctaText, currentImageUrl, currentTemplate.headline, currentTemplate.id, note, priceOverride, selectedItem, settings.primaryColor, settings.storeName, showBrand, showStockStatus, showVolume, showWhatsAppCta, storeLogoUrl]);
  const generatedText = useMemo(() => currentAdConfig ? buildMarketingAdMessage(currentAdConfig, { includePayment, pixKey: settings.pixKey, paymentLink: settings.paymentLink }) : "", [currentAdConfig, includePayment, settings.paymentLink, settings.pixKey]);

  const [copied, setCopied] = useState(false);
  const currentPrice = currentAdConfig?.priceText || formatMarketingPrice(0);

  const entryPayload = (action: MarketingAction) => currentAdConfig ? {
    action,
    ...currentAdConfig,
    generatedText,
    template: currentAdConfig.templateId,
    price: currentPrice,
  } : null;

  const registerAction = async (action: MarketingAction) => {
    const payload = entryPayload(action);
    if (payload) await recordAction(payload).catch(error => logError("marketing_history_record_failed", error instanceof Error ? error.message : "Falha ao registrar histórico", { context: { action } }));
  };

  useEffect(() => () => {
    if (copyResetTimeoutRef.current !== null) window.clearTimeout(copyResetTimeoutRef.current);
    if (catalogCopyResetTimeoutRef.current !== null) window.clearTimeout(catalogCopyResetTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (!selectedItem || !generatedText || editingEntryId) return;
    const key = `${selectedItem.id}:${template}`;
    if (generatedKeys.current.has(key)) return;
    generatedKeys.current.add(key);
    void registerAction("generated");
  }, [selectedItem?.id, template, editingEntryId]);

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

  const repeatPayload = (entry: MarketingHistoryEntry, action: MarketingAction) => {
    const config = normalizeMarketingAdConfig(entry);
    return { action, ...config, generatedText: entry.generatedText || buildMarketingAdMessage(config), template: config.templateId, price: config.priceText };
  };
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


  const applyEntryToEditor = (entry: MarketingHistoryEntry, mode: "edit" | "theme" | "duplicate") => {
    const config = normalizeMarketingAdConfig(entry);
    setSelectedProductId(config.productId);
    setSelectedKitId('');
    setTemplate(config.templateId);
    setAdTheme(config.themeId);
    setPriceOverride(parseMarketingPriceNumber(config.price).toFixed(2));
    setNote(config.note || "");
    setCtaText(config.ctaText || "Peça pelo WhatsApp");
    setShowBrand(config.showBrand);
    setShowVolume(config.showVolume);
    setShowStockStatus(config.showStockStatus);
    setShowWhatsAppCta(config.showWhatsAppCta);
    setBackgroundStyle(config.backgroundStyle);
    setEditingEntryId(mode === "duplicate" ? null : entry.id);
    setActiveTab("generator");
    notifyInfo(mode === "duplicate" ? "Anúncio duplicado no editor." : mode === "theme" ? "Escolha um novo tema e confirme para salvar." : "Anúncio aberto para edição.");
  };

  const handleDuplicateEntry = async (entry: MarketingHistoryEntry) => {
    applyEntryToEditor(entry, "duplicate");
    await recordAction(repeatPayload(entry, "duplicated"));
  };

  const handleSaveEditedEntry = async () => {
    if (!editingEntryId) return;
    const payload = entryPayload("edited");
    if (!payload) return;
    await updateEntry(editingEntryId, payload);
    setEditingEntryId(null);
    notifySuccess("Anúncio atualizado.");
  };

  const handleCancelEditing = () => {
    setEditingEntryId(null);
    notifyInfo("Edição cancelada. O anúncio salvo não foi alterado.");
  };

  const handleUseThemeAsDefault = () => {
    try { localStorage.setItem(MARKETING_AD_THEME_STORAGE_KEY, adTheme); } catch { /* local preference unavailable */ }
    notifySuccess("Tema salvo como padrão neste aparelho.");
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
      <div className="mk79">
        <div className="mk65">
          <section className="mk80">
            <div className="mk44" />
            <div className="mk42">
              <div>
                <p className="mk60">Central de divulgação</p>
                <h1 className="mk75">Divulgue sua loja com materiais prontos para vender</h1>
                <p className="mk81">Crie artes, copie mensagens, gere QR Code e compartilhe seu catálogo sem sair do Revenda Smart.</p>
                <div className="mk52">
                  <div className="mk86"><p className="mk47">{products.length}</p><p className="mk45">produtos</p></div>
                  <div className="mk86"><p className="mk47">{recentMaterialsCount}</p><p className="mk45">materiais</p></div>
                  <div className="mk86"><p className="mk47">10</p><p className="mk45">templates</p></div>
                  <div className="mk86"><p className="mk47">QR</p><p className="mk45">catálogo</p></div>
                </div>
              </div>
              <div className="mk12">
                <div className="mk59">
                  <div>
                    <p className="mk53">Catálogo público</p>
                    <p className="mk87">{catalogUrl || "Link ainda não configurado"}</p>
                  </div>
                  <div className="mk88">
                    {catalogUrl ? <QRCodeSVG value={catalogUrl} size={72} bgColor="#ffffff" fgColor="#0f172a" level="M" includeMargin /> : <QrCode className="h-[72px] w-[72px] text-muted-foreground/35" />}
                  </div>
                </div>
                <div className="mk58">
                  <button type="button" onClick={handleCopyCatalog} className="mk84 mk14"><Copy className="w-4 h-4" /> {catalogCopied ? "Copiado" : "Copiar link"}</button>
                  <button type="button" onClick={handleShareCatalog} className="mk84 mk8"><MessageSquare className="w-4 h-4" /> WhatsApp</button>
                </div>
              </div>
            </div>
          </section>

          <section className="mk40">
            <button type="button" onClick={() => setActiveTab("generator")} className="mk70"><WandSparkles className="mk37" /><p className="mk30">Criar arte</p><p className="mk6">Produto ou promoção</p></button>
            <button type="button" onClick={() => { setActiveTab("generator"); setTemplate("promo"); }} className="mk70"><Megaphone className="mk37" /><p className="mk30">Criar promoção</p><p className="mk6">Oferta pronta</p></button>
            <button type="button" onClick={handleShareCatalog} className="mk70"><Store className="mk37" /><p className="mk30">Compartilhar catálogo</p><p className="mk6">Link da loja</p></button>
            <button type="button" onClick={handleCopyCatalog} className="mk70"><QrCode className="mk37" /><p className="mk30">Gerar QR Code</p><p className="mk6">Copie o link rápido</p></button>
            <button type="button" onClick={() => { setActiveTab("generator"); setTemplate("whatsapp"); }} className="mk70"><MessageSquare className="mk37" /><p className="mk30">Mensagem WhatsApp</p><p className="mk6">Texto pronto</p></button>
            <button type="button" onClick={() => setActiveTab("history")} className="mk70"><History className="mk37" /><p className="mk30">Histórico</p><p className="mk6">Materiais recentes</p></button>
          </section>

          <MarketingStats entries={historyEntries} />
          <div className="mk78">
            <button onClick={() => setActiveTab("generator")} className={`mk85 ${activeTab === "generator" ? "mk23" : ""}`}><WandSparkles className="h-4 w-4"/>Gerador</button>
            <button onClick={() => setActiveTab("history")} className={`mk85 ${activeTab === "history" ? "mk23" : ""}`}><History className="h-4 w-4"/>Histórico</button>
          </div>
          {activeTab === "generator" ? (
            <div className="mk71">
              {/* New Templates Notice - Controlled by marketing_templates_v2_enabled flag */}
              {v2TemplatesEnabled && (
                <div className="mk64">
                  <WandSparkles className="mk24" />
                  <div>
                    <p className="mk16">Novos Templates Disponíveis!</p>
                    <p className="mk29">Você agora tem acesso a templates v2 com mais opções de personalização.</p>
                  </div>
                </div>
              )}

              {featuredMarketingProducts.length > 0 && (
                <section className="mk63">
                  <div className="mk59">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-primary">Produtos em destaque</p>
                      <p className="mk19">Toque para começar uma arte rapidamente.</p>
                    </div>
                    <PackageCheck className="mk17" />
                  </div>
                  <div className="mk9">
                    {featuredMarketingProducts.map((product) => (
                      <button key={product.id} type="button" onClick={() => { setSelectedProductId(product.id); setSelectedKitId(''); }} className={`mk77 ${selectedProductId === product.id ? "mk15" : ""}`}>
                        <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground truncate">{product.brand || "Produto"}</p>
                        <p className="mt-1 text-xs font-black line-clamp-2">{product.name}</p>
                        <p className="mt-2 text-[11px] font-bold text-primary">R$ {Number(product.salePrice || 0).toFixed(2)}</p>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* Product/Kit Selection */}
              <div className="mk76">
                <label className="mk73">Pesquisar produto</label>
                <div className="mk20">
                  <Search className="mk28" />
                  <input
                    type="search"
                    inputMode="search"
                    enterKeyHint="search"
                    autoComplete="off"
                    placeholder="Pesquisar produto..."
                    className="mk68"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="mk22">
                <div className="mk76">
                  <label className="mk73">Produto Solo</label>
                  <select
                    className="mk69"
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
                <div className="mk76">
                  <label className="mk73">Ou um Kit</label>
                  <select
                    className="mk69"
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
                <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="mk46">
                  {loadingMore ? "Carregando..." : "Carregar mais"}
                </button>
              )}
              {search && hasMore && (
                <p className="mk82">Carregue mais produtos para ampliar a busca.</p>
              )}

              {/* Template Selection */}
              <div className="mk76">
                <label className="mk73">Templates rápidos</label>
                <div className="mk7">
                  {Object.entries(templates).map(([key, t]) => (
                    <button
                      key={key}
                      onClick={() => setTemplate(key as MarketingTemplateId)}
                      className={`mk55 ${template === key ? "mk2" : ""}`}
                    >
                      <span className="mk4">{t.emoji}</span>
                      <span className="mk3">{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="mk63">
                <div className="mk59">
                  <div>
                    <label className="mk73">Tema do card</label>
                    <p className="mk43">Troque o tema e confira no preview antes de salvar.</p>
                  </div>
                  <button type="button" onClick={handleUseThemeAsDefault} className="mk56">Usar como padrão</button>
                </div>
                <div className="mk40">
                  {MARKETING_AD_THEME_IDS.map((themeId) => {
                    const theme = MARKETING_AD_THEMES[themeId];
                    return (
                      <button key={themeId} type="button" onClick={() => setAdTheme(themeId)} className={`mk74 ${adTheme === themeId ? "mk5" : ""}`}>
                        <div className="mk13" style={{ background: `linear-gradient(135deg,#fff 0%,${theme.accent}33 55%,#fff 100%)` }} />
                        <p className="mk26">{theme.label}</p>
                        <p className="mk11">Preview do tema</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Options */}
              <div className="mk62">
                <div className="mk76">
                  <label className="mk73">Preço Especial (Opcional)</label>
                  <input
                    type="number" inputMode="decimal" enterKeyHint="next"
                    placeholder="Ex: 89.90"
                    className="mk41"
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
                <div className="mk76">
                  <label className="mk73">Nota Curta</label>
                  <input
                    type="text"
                    placeholder="Ex: Só hoje!, Frete Grátis"
                    className="mk41"
                    value={note}
                    onChange={e => setNote(e.target.value)}
                  />
                </div>
                <div className="mk76">
                  <label className="mk73">Chamada (CTA)</label>
                  <input
                    type="text"
                    className="mk41"
                    value={ctaText}
                    onChange={e => setCtaText(e.target.value)}
                  />
                </div>
                <div className="mk27">
                  {[{ label: "Marca", checked: showBrand, onChange: setShowBrand }, { label: "Volume", checked: showVolume, onChange: setShowVolume }, { label: "Pronta entrega", checked: showStockStatus, onChange: setShowStockStatus }, { label: "CTA", checked: showWhatsAppCta, onChange: setShowWhatsAppCta }].map((option) => (
                    <label key={option.label} className="mk67">
                      {option.label}
                      <input type="checkbox" checked={option.checked} onChange={(event) => option.onChange(event.target.checked)} className="mk49" />
                    </label>
                  ))}
                </div>

                {(settings.pixKey || settings.paymentLink) && (
                  <div className="mk21">
                    <div className="mk66">
                      <Wallet className="mk61" />
                      <span className="mk31">Incluir Pagamento</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={includePayment}
                      onChange={e => setIncludePayment(e.target.checked)}
                      className="mk33"
                    />
                  </div>
                )}
              </div>

              {/* Preview Area */}
              <section className="mk54">
                {[
                  "Use foto limpa e preço visível.",
                  "Comece pelo produto campeão da semana.",
                  "Compartilhe o catálogo depois da arte.",
                ].map((tip) => (
                  <div key={tip} className="rounded-2xl border border-primary/10 bg-primary/5 p-3 text-[11px] font-semibold text-primary"><WandSparkles className="mk50" />{tip}</div>
                ))}
              </section>

              {currentAdConfig ? (
                <div className="mk57">
                  {editingEntryId && (
                    <div className="mk35">
                      Editando anúncio salvo. Troque tema ou texto à vontade; o histórico só será substituído quando você confirmar.
                    </div>
                  )}
                  <MarketingAdCanvas config={currentAdConfig} />
                  <div className="mk18">
                    <p className="mk53">Texto para WhatsApp</p>
                    <div className="mk32">{generatedText}</div>
                  </div>

                  {editingEntryId && (
                    <div className="mk58">
                      <button type="button" onClick={handleCancelEditing} className="mk84 mk36">Cancelar edição</button>
                      <button type="button" onClick={handleSaveEditedEntry} className="mk84 mk14">Salvar alterações</button>
                    </div>
                  )}

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
                    className="mk51 mk0"
                    data-testid="button-share-whatsapp-ad"
                  >
                    <MessageSquare className="w-4 h-4" /> Compartilhar no WhatsApp
                  </button>

                  {imageError && <p className="mk72">{imageError}</p>}
                  <button
                    onClick={handleDownloadImage}
                    className="mk51 mk1"
                    data-testid="button-download-ad-image"
                  >
                    <ImageIcon className="w-4 h-4" /> Baixar Card
                  </button>
                </div>
              ) : (
                <div className="mk10">
                  <div className="mk34">
                    <Info className="mk48" />
                  </div>
                  <div>
                    <p className="mk25">Nenhum produto selecionado</p>
                    <p className="mk38">Escolha um produto ou kit acima para gerar seu anúncio automático.</p>
                  </div>
                  {products.length === 0 && <button onClick={() => window.location.href = "/add-product"} className="mk84 mk14">Cadastrar produto</button>}
                </div>
              )}
            </div>
          ) : (
            <MarketingHistoryPanel entries={historyEntries} loading={historyLoading} onCopy={repeatCopy} onShare={repeatShare} onDownload={repeatDownload} onRemove={removeEntry} onClear={clearHistory} onCreate={() => setActiveTab("generator")} onEdit={(entry) => applyEntryToEditor(entry, "edit")} onTheme={(entry) => applyEntryToEditor(entry, "theme")} onDuplicate={handleDuplicateEntry} />
          )}
        </div>
      </div>
    </Layout>
  );
}
