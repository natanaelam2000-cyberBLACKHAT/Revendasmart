import { useEffect, useState, useMemo, useRef } from "react";
import "@/styles/marketing.css";
import { Layout } from "@/components/layout";
import { defaultSettings, getProductImage } from "@/lib/mock-data";
import { useProductPickerData } from "@/hooks/useProductPickerData";
import { useUserSettings } from "@/providers/UserSettingsProvider";
import { getFirebaseAuth, logTelemetryEvent, trackAnalyticsEvent, logError } from "@/lib/firebase";
import { useFeatureEnabled } from "@/lib/remote-config-context";
import { useMarketingHistory, type MarketingHistoryEntry, type MarketingAction } from "@/hooks/useMarketingHistory";
import { MarketingHistoryPanel } from "@/components/MarketingHistoryPanel";
import { PageSkeleton } from "@/components/PageSkeleton";
import { MarketingHub } from "@/components/marketing/MarketingHub";
import { MarketingWorkspaceNav } from "@/components/marketing/MarketingWorkspaceNav";
import { MarketingProductSelector } from "@/components/marketing/MarketingProductSelector";
import { MarketingTemplateSelector } from "@/components/marketing/MarketingTemplateSelector";
import { MarketingEditor } from "@/components/marketing/MarketingEditor";
import { MarketingPreview } from "@/components/marketing/MarketingPreview";
import { MarketingCopyPanel } from "@/components/marketing/MarketingCopyPanel";
import { MarketingExportActions } from "@/components/marketing/MarketingExportActions";
import { createMarketingCard, MarketingCardImageError, MarketingCardRenderError } from "@/lib/marketing-card";
import { isMarketingShareCancelledError, MarketingFileOperationError, saveMarketingCard, shareMarketingCard, type MarketingShareResult } from "@/lib/marketing-share";
import { MARKETING_IMAGE_ERROR_MESSAGE, MarketingImageResolutionError, resolveMarketingImageCandidates, type ResolvedMarketingImage } from "@/lib/marketing-image";
import { buildPublicCatalogUrl } from "@/lib/public-url";
import { MARKETING_AD_THEME_IDS, MARKETING_TEMPLATES, buildMarketingAdConfig, buildMarketingAdMessage, buildMarketingVolumeText, buildMarketingWhatsappUrl, formatMarketingPrice, getMarketingAdImageCandidates, normalizeMarketingAdConfig, normalizeMarketingGeneratedText, parseMarketingPriceNumber, resolveMarketingTemplate, type MarketingAdThemeId, type MarketingBackgroundStyle, type MarketingTemplateId } from "@/lib/marketing-ad";
import { isMarketingKitProduct, readMarketingLaunchRequest, type MarketingWorkspaceView } from "@/lib/marketing-flow";
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
const WHATSAPP_SETUP_MESSAGE = "Cadastre o WhatsApp da sua loja para receber pedidos por este card.";

type MarketingImageResolutionState = {
  key: string;
  status: "idle" | "resolving" | "ready" | "error";
  resolved: ResolvedMarketingImage | null;
  error: string;
};

function getMarketingOperationError(error: unknown, action: "download" | "share") {
  if (error instanceof MarketingImageResolutionError || error instanceof MarketingCardImageError) {
    return { message: MARKETING_IMAGE_ERROR_MESSAGE, code: "image-resolution" };
  }
  if (error instanceof MarketingCardRenderError) {
    return { message: error.message, code: error.code };
  }
  if (error instanceof MarketingFileOperationError) {
    return { message: error.message, code: error.code };
  }
  return {
    message: action === "download" ? "Não foi possível salvar o card." : "Não foi possível compartilhar o card com imagem.",
    code: action === "download" ? "download-unknown" : "share-unknown",
  };
}

function readStoredMarketingTheme(): MarketingAdThemeId {
  if (typeof window === "undefined") return "brand";
  try {
    const stored = localStorage.getItem(MARKETING_AD_THEME_STORAGE_KEY) as MarketingAdThemeId | null;
    return stored && MARKETING_AD_THEME_IDS.includes(stored) ? stored : "brand";
  } catch {
    return "brand";
  }
}

export default function MarketingPage() {
  const launchRequest = useMemo(
    () => readMarketingLaunchRequest(typeof window === "undefined" ? "" : window.location.search),
    [],
  );
  const { products, loading, loadingMore, error, preferredProductStatus, hasMore, search, setSearch, loadMore } = useProductPickerData({
    preferredProductId: launchRequest.productId,
  });
  const { settings: firestoreSettings } = useUserSettings();
  const settings = firestoreSettings || defaultSettings;
  const v2TemplatesEnabled = useFeatureEnabled("marketing_templates_v2_enabled");

  const [cardError, setCardError] = useState("");
  const [cardAction, setCardAction] = useState<"download" | "share" | null>(null);
  const [imageResolution, setImageResolution] = useState<MarketingImageResolutionState>({
    key: "",
    status: "idle",
    resolved: null,
    error: "",
  });

  // Ad Generator State
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedKitId, setSelectedKitId] = useState('');
  const [template, setTemplate] = useState<MarketingTemplateId>(launchRequest.templateId || "promo");
  const [priceOverride, setPriceOverride] = useState('');
  const [note, setNote] = useState('');
  const [ctaText, setCtaText] = useState('Chamar no WhatsApp');
  const [adTheme, setAdTheme] = useState<MarketingAdThemeId>(() => readStoredMarketingTheme());
  const [showBrand, setShowBrand] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [showStockStatus, setShowStockStatus] = useState(true);
  const [showWhatsAppCta, setShowWhatsAppCta] = useState(true);
  const [backgroundStyle, setBackgroundStyle] = useState<MarketingBackgroundStyle>('soft-gradient');
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [includePayment, setIncludePayment] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<MarketingWorkspaceView>(
    launchRequest.source === "catalog" || launchRequest.source === "legacy-social" ? "editor" : "hub",
  );
  const [showWhatsappSetupNotice, setShowWhatsappSetupNotice] = useState(false);
  const [catalogCopied, setCatalogCopied] = useState(false);
  const generatedKeys = useRef(new Set<string>());
  const launchSelectionAppliedRef = useRef(false);
  const copyResetTimeoutRef = useRef<number | null>(null);
  const catalogCopyResetTimeoutRef = useRef<number | null>(null);
  const { entries: historyEntries, loading: historyLoading, recordAction, updateEntry, removeEntry, clearHistory } = useMarketingHistory();

  const normalizedProductSearch = search.trim().toLowerCase();
  const filteredProducts = useMemo(() =>
    products.filter((product) => product.name.toLowerCase().includes(normalizedProductSearch)),
    [normalizedProductSearch, products]
  );

  const kitProducts = useMemo(
    () => filteredProducts.filter(isMarketingKitProduct),
    [filteredProducts],
  );
  const regularProducts = useMemo(
    () => filteredProducts.filter((product) => !isMarketingKitProduct(product)),
    [filteredProducts],
  );

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId && !isMarketingKitProduct(product)),
    [products, selectedProductId],
  );

  const selectedKit = useMemo(
    () => products.find((product) => product.id === selectedKitId && isMarketingKitProduct(product)),
    [products, selectedKitId],
  );
  const selectedItem = selectedProduct || selectedKit;
  const catalogSlug = String((settings as typeof settings & { catalogSlug?: string; catalog_slug?: string }).catalogSlug || (settings as typeof settings & { catalogSlug?: string; catalog_slug?: string }).catalog_slug || "").trim();
  const catalogUrl = useMemo(() => buildPublicCatalogUrl(catalogSlug), [catalogSlug]);
  const featuredMarketingProducts = useMemo(() => filteredProducts.slice(0, 4), [filteredProducts]);
  const currentTemplate = resolveMarketingTemplate(template);
  const currentImageUrl = selectedItem ? getProductImage(selectedItem) || undefined : undefined;
  const storeDisplayName = String(settings.storeName || settings.storeIdentity?.name || "Minha loja").trim() || "Minha loja";
  const storeLogoUrl = String(settings.storeIdentity?.logoUrl || settings.storeLogo || "").trim();
  const storeWhatsappNumber = String(settings.whatsapp || (settings as typeof settings & { whatsappNumber?: string; phone?: string }).whatsappNumber || (settings as typeof settings & { whatsappNumber?: string; phone?: string }).phone || "").replace(/\D/g, "");
  const currentAdConfig = useMemo(() => {
    if (!selectedItem) return null;
    return buildMarketingAdConfig({
      productId: selectedItem.id,
      productName: selectedItem.name,
      productBrand: selectedItem.brand || "",
      productImageUrl: selectedItem.imageUrl || currentImageUrl,
      imageUrl: selectedItem.thumbnailUrl || currentImageUrl,
      photoUrl: (selectedItem as { photoUrl?: string }).photoUrl,
      image: (selectedItem as { image?: string }).image,
      imageId: selectedItem.imageId,
      productVolume: buildMarketingVolumeText(selectedItem.extras),
      productStock: selectedItem.stock,
      price: priceOverride || selectedItem.salePrice || 0,
      headline: currentTemplate.headline,
      note,
      ctaText,
      storeName: storeDisplayName,
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
  }, [adTheme, backgroundStyle, catalogUrl, ctaText, currentImageUrl, currentTemplate.headline, currentTemplate.id, note, priceOverride, selectedItem, settings.primaryColor, showBrand, showStockStatus, showVolume, showWhatsAppCta, storeDisplayName, storeLogoUrl]);
  const defaultGeneratedText = useMemo(() => currentAdConfig ? buildMarketingAdMessage(currentAdConfig, { includePayment, pixKey: settings.pixKey, paymentLink: settings.paymentLink }) : "", [currentAdConfig, includePayment, settings.paymentLink, settings.pixKey]);
  const [generatedText, setGeneratedText] = useState("");
  useEffect(() => setGeneratedText(defaultGeneratedText), [defaultGeneratedText]);
  const previewWhatsappUrl = useMemo(() => generatedText ? buildMarketingWhatsappUrl({ phone: storeWhatsappNumber, message: generatedText }) : "", [generatedText, storeWhatsappNumber]);
  const currentImageCandidates = useMemo(
    () => currentAdConfig ? getMarketingAdImageCandidates(currentAdConfig) : [],
    [currentAdConfig?.image, currentAdConfig?.imageUrl, currentAdConfig?.photoUrl, currentAdConfig?.productImageUrl],
  );
  const currentImageKey = currentImageCandidates.join("\u001f");

  const [copied, setCopied] = useState(false);
  const currentPrice = currentAdConfig?.priceText || formatMarketingPrice(0);

  useEffect(() => {
    if (!launchRequest.productId || launchSelectionAppliedRef.current) return;
    const requestedProduct = products.find((product) => product.id === launchRequest.productId);
    if (!requestedProduct) return;
    if (isMarketingKitProduct(requestedProduct)) {
      setSelectedKitId(requestedProduct.id);
      setSelectedProductId("");
    } else {
      setSelectedProductId(requestedProduct.id);
      setSelectedKitId("");
    }
    setWorkspaceView("editor");
    launchSelectionAppliedRef.current = true;
  }, [launchRequest.productId, products]);

  const selectMarketingItem = (product: typeof products[number]) => {
    if (isMarketingKitProduct(product)) {
      setSelectedKitId(product.id);
      setSelectedProductId("");
    } else {
      setSelectedProductId(product.id);
      setSelectedKitId("");
    }
    setWorkspaceView("editor");
  };

  useEffect(() => {
    let active = true;
    setCardError("");
    if (!currentAdConfig) {
      setImageResolution({ key: "", status: "idle", resolved: null, error: "" });
      return () => { active = false; };
    }
    if (!currentImageCandidates.length) {
      setImageResolution({ key: currentImageKey, status: "ready", resolved: null, error: "" });
      return () => { active = false; };
    }

    setImageResolution({ key: currentImageKey, status: "resolving", resolved: null, error: "" });
    void resolveMarketingImageCandidates(currentImageCandidates)
      .then((resolved) => {
        if (!active) return;
        setImageResolution({ key: currentImageKey, status: "ready", resolved, error: "" });
      })
      .catch((error) => {
        if (!active) return;
        const message = error instanceof MarketingImageResolutionError ? error.message : MARKETING_IMAGE_ERROR_MESSAGE;
        setImageResolution({ key: currentImageKey, status: "error", resolved: null, error: message });
        setCardError(message);
      });
    return () => { active = false; };
  }, [currentImageKey]);

  const currentImageState = imageResolution.key === currentImageKey ? imageResolution : {
    key: currentImageKey,
    status: currentImageCandidates.length ? "resolving" as const : "ready" as const,
    resolved: null,
    error: "",
  };
  const currentResolvedImage = currentImageState.resolved;
  const cardActionsBlocked = cardAction !== null || (currentImageCandidates.length > 0 && currentImageState.status !== "ready");
  const canGenerateCurrentCard = () => {
    if (!currentImageCandidates.length) return true;
    if (currentImageState.status === "resolving") {
      notifyInfo("Aguarde enquanto preparamos a foto do produto.");
      return false;
    }
    if (currentImageState.status === "ready" && currentResolvedImage) return true;
    const message = currentImageState.error || MARKETING_IMAGE_ERROR_MESSAGE;
    setCardError(message);
    notifyError(message);
    return false;
  };

  const entryPayload = (action: MarketingAction) => currentAdConfig ? {
    action,
    source: launchRequest.source === "catalog" ? "catalog" : "manual",
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
    if (!selectedItem || !generatedText || generatedText !== defaultGeneratedText || editingEntryId) return;
    const key = `${selectedItem.id}:${template}`;
    if (generatedKeys.current.has(key)) return;
    generatedKeys.current.add(key);
    void registerAction("generated");
  }, [selectedItem?.id, template, editingEntryId, generatedText, defaultGeneratedText]);

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

  const openWhatsappSettings = () => { window.location.href = "/settings?tab=store"; };
  const notifyMissingStoreWhatsapp = () => {
    setShowWhatsappSetupNotice(true);
    notifyError(WHATSAPP_SETUP_MESSAGE);
  };

  const notifyShareResult = (result: MarketingShareResult) => {
    if (result.method === "web-download-fallback") {
      notifyInfo("Seu navegador não compartilha imagem direto; baixei o PNG e copiei o texto.");
      return;
    }
    notifySuccess("Card pronto para compartilhar com imagem.");
  };

  const reportMarketingActionError = (error: unknown, action: "download" | "share") => {
    const result = getMarketingOperationError(error, action);
    setCardError(result.message);
    notifyError(result.message);
    return result;
  };

  const shareAdBlob = async (payload: NonNullable<ReturnType<typeof entryPayload>>, resolvedProductImage?: ResolvedMarketingImage | null) => {
    const blob = await createMarketingCard(payload, { resolvedProductImage });
    const result = await shareMarketingCard({
      blob,
      productName: payload.productName,
      text: payload.generatedText || generatedText,
      title: `${payload.productName} | ${payload.storeName || "Revenda Smart"}`,
      dialogTitle: "Compartilhar anúncio",
      onTextFallback: copyTextWithFallback,
    });
    notifyShareResult(result);
    return result;
  };

  const handleCardCtaClick = () => {
    if (!storeWhatsappNumber || !previewWhatsappUrl) {
      notifyMissingStoreWhatsapp();
      return;
    }
    notifyInfo("WhatsApp da loja aberto.");
    window.open(previewWhatsappUrl, "_blank", "noopener,noreferrer");
  };

  const handleShare = async () => {
    const payload = entryPayload("shared");
    if (!payload || cardAction || !canGenerateCurrentCard()) return;

    setCardAction("share");
    setCardError("");
    try {
      await shareAdBlob(payload, currentResolvedImage);
      await recordAction(payload);
      const productId = selectedProductId || selectedKitId;
      const user = getFirebaseAuth()?.currentUser;
      logTelemetryEvent("ad_shared", { productId, channel: "whatsapp" }, user?.uid);
      trackAnalyticsEvent("share", { method: "whatsapp", content_type: "product", item_id: productId });
    } catch (error) {
      if (isMarketingShareCancelledError(error)) {
        notifyInfo("Compartilhamento cancelado.");
        return;
      }
      const failure = reportMarketingActionError(error, "share");
      logError("ad_image_share_failed", failure.message, { context: { stage: failure.code, template, hasProduct: !!selectedProductId, hasKit: !!selectedKitId } });
    } finally {
      setCardAction(null);
    }
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

  const handleDownloadImage = async () => {
    const payload = entryPayload("downloaded");
    if (!payload || cardAction || !canGenerateCurrentCard()) return;
    setCardAction("download");
    setCardError("");
    try {
      const blob = await createMarketingCard(payload, { resolvedProductImage: currentResolvedImage });
      const result = await saveMarketingCard({ blob, productName: payload.productName });
      await recordAction(payload);
      notifySuccess(`Card salvo em ${result.locationLabel}.`);
    } catch (error) {
      const failure = reportMarketingActionError(error, "download");
      logError("ad_image_generation_failed", failure.message, { context: { stage: failure.code, template, hasProduct: !!selectedProductId, hasKit: !!selectedKitId } });
    } finally {
      setCardAction(null);
    }
  };

  const repeatPayload = (entry: MarketingHistoryEntry, action: MarketingAction) => {
    const config = normalizeMarketingAdConfig(entry);
    const normalizedGeneratedText = normalizeMarketingGeneratedText(entry.generatedText);
    const generatedText = normalizedGeneratedText.includes(config.productName) && normalizedGeneratedText.includes(config.priceText)
      ? normalizedGeneratedText
      : buildMarketingAdMessage(config);
    return { action, ...config, generatedText, template: config.templateId, price: config.priceText };
  };
  const repeatCopy = async (entry: MarketingHistoryEntry) => {
    const payload = repeatPayload(entry, "copied");
    await copyTextWithFallback(payload.generatedText);
    await recordAction(payload);
    notifySuccess("Anúncio copiado.");
  };
  const repeatShare = async (entry: MarketingHistoryEntry) => {
    const payload = repeatPayload(entry, "shared");
    try {
      const blob = await createMarketingCard(payload);
      const result = await shareMarketingCard({
        blob,
        productName: payload.productName,
        text: payload.generatedText,
        title: `${payload.productName} | ${payload.storeName || "Revenda Smart"}`,
        dialogTitle: "Compartilhar anúncio",
        onTextFallback: copyTextWithFallback,
      });
      await recordAction(payload);
      notifyShareResult(result);
    } catch (error) {
      if (isMarketingShareCancelledError(error)) {
        notifyInfo("Compartilhamento cancelado.");
        return;
      }
      const failure = reportMarketingActionError(error, "share");
      logError("ad_history_share_failed", failure.message, { context: { stage: failure.code, entryAction: entry.action } });
    }
  };
  const repeatDownload = async (entry: MarketingHistoryEntry) => {
    try {
      const payload = repeatPayload(entry, "downloaded");
      const blob = await createMarketingCard(payload);
      const result = await saveMarketingCard({ blob, productName: payload.productName });
      await recordAction(payload);
      notifySuccess(`Card salvo em ${result.locationLabel}.`);
    } catch (error) {
      const failure = reportMarketingActionError(error, "download");
      logError("ad_history_download_failed", failure.message, { context: { stage: failure.code, entryAction: entry.action } });
    }
  };


  const applyEntryToEditor = (entry: MarketingHistoryEntry, mode: "edit" | "theme" | "duplicate") => {
    const config = normalizeMarketingAdConfig(entry);
    const savedProduct = products.find((product) => product.id === config.productId);
    if (savedProduct && isMarketingKitProduct(savedProduct)) {
      setSelectedKitId(config.productId);
      setSelectedProductId("");
    } else {
      setSelectedProductId(config.productId);
      setSelectedKitId("");
    }
    setTemplate(config.templateId);
    setAdTheme(config.themeId);
    setPriceOverride(parseMarketingPriceNumber(config.price).toFixed(2));
    setNote(config.note || "");
    setCtaText(config.ctaText || "Chamar no WhatsApp");
    setShowBrand(config.showBrand);
    setShowVolume(config.showVolume);
    setShowStockStatus(config.showStockStatus);
    setShowWhatsAppCta(config.showWhatsAppCta);
    setBackgroundStyle(config.backgroundStyle);
    setEditingEntryId(mode === "duplicate" ? null : entry.id);
    setWorkspaceView("editor");
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
      <div className="flex h-full flex-col bg-background">
        <div className="mx-auto grid w-full max-w-7xl gap-5 overflow-y-auto px-4 pb-32 pt-4 sm:px-6 sm:pt-6">
          <MarketingWorkspaceNav activeView={workspaceView} onChange={setWorkspaceView} />

          {workspaceView === "hub" && (
            <MarketingHub
              productCount={products.length}
              historyEntries={historyEntries}
              templateCount={Object.keys(MARKETING_TEMPLATES).length}
              catalogUrl={catalogUrl}
              catalogCopied={catalogCopied}
              onStart={() => setWorkspaceView("editor")}
              onStartPromotion={() => { setTemplate("promo"); setWorkspaceView("editor"); }}
              onStartWhatsapp={() => { setTemplate("whatsapp"); setWorkspaceView("editor"); }}
              onShowHistory={() => setWorkspaceView("history")}
              onCopyCatalog={handleCopyCatalog}
              onShareCatalog={handleShareCatalog}
            />
          )}

          {workspaceView === "editor" && (
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,.95fr)]">
              <div className="grid min-w-0 gap-5">
                <MarketingProductSelector
                  products={regularProducts}
                  kitProducts={kitProducts}
                  featuredProducts={featuredMarketingProducts}
                  selectedProductId={selectedProductId}
                  selectedKitId={selectedKitId}
                  search={search}
                  hasMore={hasMore}
                  loadingMore={loadingMore}
                  catalogLaunchState={launchRequest.source !== "catalog"
                    ? "none"
                    : launchRequest.invalidProductId || !launchRequest.productId
                      ? "invalid"
                      : preferredProductStatus}
                  onSearchChange={setSearch}
                  onSelectProduct={(productId) => { setSelectedProductId(productId); setSelectedKitId(""); }}
                  onSelectKit={(productId) => { setSelectedKitId(productId); setSelectedProductId(""); }}
                  onSelectFeatured={selectMarketingItem}
                  onLoadMore={() => void loadMore()}
                />

                <MarketingTemplateSelector
                  template={template}
                  theme={adTheme}
                  v2TemplatesEnabled={v2TemplatesEnabled}
                  onTemplateChange={setTemplate}
                  onThemeChange={setAdTheme}
                  onUseThemeAsDefault={handleUseThemeAsDefault}
                />

                <MarketingEditor
                  priceOverride={priceOverride}
                  note={note}
                  ctaText={ctaText}
                  showBrand={showBrand}
                  showVolume={showVolume}
                  showStockStatus={showStockStatus}
                  showWhatsAppCta={showWhatsAppCta}
                  includePayment={includePayment}
                  hasPaymentConfiguration={Boolean(settings.pixKey || settings.paymentLink)}
                  onPriceChange={(value) => {
                    if (value === "" || (Number.parseFloat(value) >= 0.01 && Number.parseFloat(value) <= 999999)) {
                      setPriceOverride(value);
                    }
                  }}
                  onNoteChange={setNote}
                  onCtaChange={setCtaText}
                  onShowBrandChange={setShowBrand}
                  onShowVolumeChange={setShowVolume}
                  onShowStockStatusChange={setShowStockStatus}
                  onShowWhatsAppCtaChange={setShowWhatsAppCta}
                  onIncludePaymentChange={setIncludePayment}
                  onConfigurePayment={openWhatsappSettings}
                />

                {editingEntryId && (
                  <div className="grid gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 sm:grid-cols-2">
                    <button type="button" onClick={handleCancelEditing} className="min-h-11 rounded-xl border border-amber-300 bg-white px-4 text-xs font-bold text-amber-900">Cancelar edição</button>
                    <button type="button" onClick={handleSaveEditedEntry} className="min-h-11 rounded-xl bg-primary px-4 text-xs font-bold text-white">Salvar alterações</button>
                  </div>
                )}
              </div>

              <div className="grid min-w-0 gap-5 lg:sticky lg:top-4">
                <MarketingPreview
                  config={currentAdConfig}
                  resolvedImage={currentResolvedImage}
                  imageStatus={currentImageState.status}
                  editing={Boolean(editingEntryId)}
                  showWhatsappSetupNotice={showWhatsappSetupNotice}
                  hasWhatsapp={Boolean(storeWhatsappNumber)}
                  hasProducts={products.length > 0}
                  onCtaClick={handleCardCtaClick}
                  onConfigureWhatsapp={openWhatsappSettings}
                  onCreateProduct={() => { window.location.href = "/add-product"; }}
                />

                {currentAdConfig && (
                  <>
                    <MarketingCopyPanel generatedText={generatedText} copied={copied} onTextChange={setGeneratedText} onCopy={handleCopy} />
                    <MarketingExportActions
                      cardAction={cardAction}
                      blocked={cardActionsBlocked}
                      imageStatus={currentImageState.status}
                      error={cardError}
                      onShare={handleShare}
                      onDownload={handleDownloadImage}
                    />
                  </>
                )}
              </div>
            </div>
          )}

          {workspaceView === "history" && (
            <MarketingHistoryPanel
              entries={historyEntries}
              loading={historyLoading}
              onCopy={repeatCopy}
              onShare={repeatShare}
              onDownload={repeatDownload}
              onRemove={removeEntry}
              onClear={clearHistory}
              onCreate={() => setWorkspaceView("editor")}
              onEdit={(entry) => applyEntryToEditor(entry, "edit")}
              onTheme={(entry) => applyEntryToEditor(entry, "theme")}
              onDuplicate={handleDuplicateEntry}
            />
          )}
        </div>
      </div>
    </Layout>
  );
}
