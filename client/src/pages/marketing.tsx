import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import "@/styles/marketing.css";
import { Layout } from "@/components/layout";
import { usePlan } from "@/providers/PlanProvider";
import { defaultSettings, getProductImage } from "@/lib/mock-data";
import { useProductPickerData } from "@/hooks/useProductPickerData";
import { useUserSettings } from "@/providers/UserSettingsProvider";
import { getFirebaseAuth, logTelemetryEvent, trackAnalyticsEvent, logError } from "@/lib/firebase";
import { fireServerCountedFirstOccurrence } from "@/lib/analytics-milestones";
import { useFeatureEnabled } from "@/lib/remote-config-context";
import { useMarketingHistory, countMarketingHistoryEntries, type MarketingHistoryEntry, type MarketingAction, type NewMarketingEntry } from "@/hooks/useMarketingHistory";
import { MarketingHistoryPanel } from "@/components/MarketingHistoryPanel";
import { MarketingSection } from "@/components/marketing/MarketingSection";
import { MarketingSelectedProduct } from "@/components/marketing/MarketingSelectedProduct";
import { PageSkeleton } from "@/components/PageSkeleton";
import { MarketingProPanel } from "@/components/marketing/MarketingProPanel";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { MarketingTabs } from "@/components/marketing/MarketingTabs";
import { MarketingProductSelector } from "@/components/marketing/MarketingProductSelector";
import { MarketingTemplateSelector } from "@/components/marketing/MarketingTemplateSelector";
import { MarketingEditor } from "@/components/marketing/MarketingEditor";
import { MarketingPreview } from "@/components/marketing/MarketingPreview";
import { MarketingCopyPanel } from "@/components/marketing/MarketingCopyPanel";
import { MarketingExportActions } from "@/components/marketing/MarketingExportActions";
import { createMarketingCard, MarketingCardImageError, MarketingCardRenderError } from "@/lib/marketing-card";
import { isMarketingShareCancelledError, MarketingFileOperationError, saveMarketingCard, shareMarketingCard, type MarketingShareResult } from "@/lib/marketing-share";
import { MARKETING_IMAGE_ERROR_MESSAGE, MarketingImageResolutionError, collectMarketingImageCandidates, hasMarketingImageSource, resolveMarketingImageCandidates, resolveMarketingImageSource, type ResolvedMarketingImage } from "@/lib/marketing-image";
import { MARKETING_PRODUCT_PRESERVATION_ERROR_MESSAGE, MarketingHistoryAssetError, MarketingProductPreservationError, assertProductAssetSnapshotMatches, captureMarketingProductRenderIdentity, createProductAssetSnapshot, isMarketingProductRenderIdentityCurrent, prepareMarketingProductImage, type MarketingProductRenderIdentity, type PreparedMarketingProductImage } from "@/lib/marketing-product-preservation";
import { buildPublicCatalogUrl } from "@/lib/public-url";
import { MARKETING_AD_THEME_IDS, buildMarketingAdConfig, buildMarketingAdMessage, buildMarketingVolumeText, buildMarketingWhatsappUrl, formatMarketingPrice, getMarketingAdImageCandidates, getMarketingTemplateAllowedTiers, normalizeMarketingAdConfig, normalizeMarketingGeneratedText, parseMarketingPriceNumber, resolveMarketingTemplate, resolveMarketingTemplateForPlan, type MarketingAdThemeId, type MarketingBackgroundStyle, type MarketingTemplateId } from "@/lib/marketing-ad";
import { isMarketingKitProduct, readMarketingLaunchRequest, type MarketingWorkspaceView } from "@/lib/marketing-flow";
import { createInFlightLock, type InFlightLock } from "@/lib/product-availability";
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
  productId: string;
  status: "idle" | "resolving" | "ready" | "error";
  resolved: ResolvedMarketingImage | null;
  prepared: PreparedMarketingProductImage | null;
  error: string;
};

function getMarketingOperationError(error: unknown, action: "download" | "share") {
  if (error instanceof MarketingImageResolutionError || error instanceof MarketingCardImageError) {
    return { message: MARKETING_IMAGE_ERROR_MESSAGE, code: "image-resolution" };
  }
  if (error instanceof MarketingProductPreservationError) {
    return { message: error.message, code: error.code };
  }
  if (error instanceof MarketingHistoryAssetError) {
    return { message: error.message, code: error.code };
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
  const [, setLocation] = useLocation();
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
  // PRO-04: ÚNICO ponto da árvore de Anúncios que conhece o plano. Resolve uma vez aqui e passa
  // `allowedTemplateTiers` (dado puro) para o selector — nenhum outro componente de marketing lê
  // plano por conta própria (ver script/smoke-tests.ts, garantia "não pode consumir plano").
  const { activePlan, loading: planLoading } = usePlan();
  const allowedTemplateTiers = useMemo(() => getMarketingTemplateAllowedTiers(activePlan), [activePlan]);

  const [cardError, setCardError] = useState("");
  const [cardAction, setCardAction] = useState<"download" | "share" | null>(null);
  const [imageResolution, setImageResolution] = useState<MarketingImageResolutionState>({
    key: "",
    productId: "",
    status: "idle",
    resolved: null,
    prepared: null,
    error: "",
  });

  // Ad Generator State
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedKitId, setSelectedKitId] = useState('');
  // Ponto A do gate (PRO-04, seção 4): valor inicial vindo do deep link/query string passa pelo
  // resolvedor plan-aware — um `?template=premium_spotlight` em conta Free nunca ativa o template Pro.
  // Fail-closed enquanto o plano carrega (activePlan começa "free" até usePlan confirmar), NUNCA um
  // template Pro otimista antes de saber o plano de verdade.
  const [template, setTemplate] = useState<MarketingTemplateId>(
    () => resolveMarketingTemplateForPlan(launchRequest.templateId || "promo", activePlan).id,
  );
  // PRO-05 (achado do E2E real, não só leitura de código): a PRIMEIRA revalidação, depois que o plano
  // termina de carregar, precisa reprocessar o pedido ORIGINAL do deep link (`launchRequest.templateId`)
  // — não o `template` atual. O estado inicial acima já tinha sido rebaixado para "promo" (fail-closed,
  // plano ainda "free" no primeiro render); revalidar contra ESSE "promo" nunca reabre o Pro pedido,
  // porque "promo" é sempre permitido em qualquer plano — o pedido original ficava perdido para sempre
  // assim que o plano Premium confirmava. Um teste E2E com login e plano reais (não só a função pura)
  // pegou isso: `/marketing?template=luxury` como Premium nunca abria "luxury" numa carga de página
  // fresca. Corrigido: a resolução inicial (`hasResolvedInitialTemplateRef`) reprocessa o pedido
  // original; só as revalidações SEGUINTES (downgrade em sessão já aberta) reavaliam o `template` atual.
  const hasResolvedInitialTemplateRef = useRef(false);
  useEffect(() => {
    if (planLoading) return;
    if (!hasResolvedInitialTemplateRef.current) {
      hasResolvedInitialTemplateRef.current = true;
      setTemplate(resolveMarketingTemplateForPlan(launchRequest.templateId || "promo", activePlan).id);
      return;
    }
    // Downgrade em sessão já aberta (PRO-04, seção 7): nunca perde dados do anúncio — só troca o
    // templateId, o resto do formulário continua intacto.
    setTemplate((current) => {
      const allowed = resolveMarketingTemplateForPlan(current, activePlan).id;
      if (allowed !== current) notifyInfo("Este template exige o plano Premium. Trocamos para um template gratuito.");
      return allowed;
    });
  }, [activePlan, planLoading, launchRequest.templateId]);
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
  /** Fonte histórica verificada mantida apenas nesta sessão; não contém bytes nem altera o schema. */
  const [historyAssetOverride, setHistoryAssetOverride] = useState<MarketingHistoryEntry | null>(null);
  /** Aviso quando o produto do anúncio salvo não existe mais no catálogo (ver applyEntryToEditor). */
  const [missingProductWarning, setMissingProductWarning] = useState("");
  /** Rotulo da operacao em andamento (`${entryId}:${operacao}`) — usado SO pela UI. */
  const [busyHistoryAction, setBusyHistoryAction] = useState<string | null>(null);
  /** Exclusao mutua real das acoes de historico: sincrona, imune a dois toques no mesmo tick. */
  const historyActionLockRef = useRef<InFlightLock>(createInFlightLock());
  /** Seletor de produtos aberto? Colapsa depois da escolha para o editor caber na tela do celular. */
  const [productPickerOpen, setProductPickerOpen] = useState(true);
  const [includePayment, setIncludePayment] = useState(false);
  // Entrar em Marketing é entrar no fluxo de criação: não existe mais tela de resumo antes dele.
  const [workspaceView, setWorkspaceView] = useState<MarketingWorkspaceView>("editor");
  // RELEASE V1 §4.2: Anúncios Pro é admin/dev-only enquanto experimental — a aba some para todo o
  // resto (Free e Premium comum), e um usuário que já estivesse na aba "pro" antes de perder o acesso
  // (ou um estado inicial otimista qualquer) é levado de volta para o editor, nunca deixado lá.
  const { isAdmin: isProAdsAdmin } = useAdminAccess();
  useEffect(() => {
    if (!isProAdsAdmin && workspaceView === "pro") setWorkspaceView("editor");
  }, [isProAdsAdmin, workspaceView]);
  const [showWhatsappSetupNotice, setShowWhatsappSetupNotice] = useState(false);
  const generatedKeys = useRef(new Set<string>());
  const launchSelectionAppliedRef = useRef(false);
  const copyResetTimeoutRef = useRef<number | null>(null);
  const { entries: historyEntries, loading: historyLoading, recordAction, updateEntry, removeEntry, clearHistory } = useMarketingHistory();

  /** Ids de produto realmente presentes no catálogo carregado — base do aviso de anúncio órfão. */
  const availableProductIds = useMemo(() => new Set(products.map((product) => product.id)), [products]);

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
    const historicalImage = historyAssetOverride?.productId === selectedItem.id ? historyAssetOverride : null;
    return buildMarketingAdConfig({
      productId: selectedItem.id,
      productName: selectedItem.name,
      productBrand: selectedItem.brand || "",
      productImageUrl: historicalImage ? historicalImage.productImageUrl : selectedItem.imageUrl || currentImageUrl,
      imageUrl: historicalImage ? historicalImage.imageUrl : selectedItem.thumbnailUrl || currentImageUrl,
      photoUrl: historicalImage ? historicalImage.photoUrl : (selectedItem as { photoUrl?: string }).photoUrl,
      image: historicalImage ? historicalImage.image : (selectedItem as { image?: string }).image,
      imageId: historicalImage ? historicalImage.imageId : selectedItem.imageId,
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
  }, [adTheme, backgroundStyle, catalogUrl, ctaText, currentImageUrl, currentTemplate.headline, currentTemplate.id, historyAssetOverride, note, priceOverride, selectedItem, settings.primaryColor, showBrand, showStockStatus, showVolume, showWhatsAppCta, storeDisplayName, storeLogoUrl]);
  const defaultGeneratedText = useMemo(() => currentAdConfig ? buildMarketingAdMessage(currentAdConfig, { includePayment, pixKey: settings.pixKey, paymentLink: settings.paymentLink }) : "", [currentAdConfig, includePayment, settings.paymentLink, settings.pixKey]);
  const [generatedText, setGeneratedText] = useState("");
  useEffect(() => setGeneratedText(defaultGeneratedText), [defaultGeneratedText]);
  const previewWhatsappUrl = useMemo(() => generatedText ? buildMarketingWhatsappUrl({ phone: storeWhatsappNumber, message: generatedText }) : "", [generatedText, storeWhatsappNumber]);
  const currentImageCandidates = useMemo(
    () => currentAdConfig ? getMarketingAdImageCandidates(currentAdConfig) : [],
    [currentAdConfig?.image, currentAdConfig?.imageUrl, currentAdConfig?.photoUrl, currentAdConfig?.productImageUrl],
  );
  // A chave inclui o imageId: sem isso, trocar para um produto cuja unica foto esta guardada
  // localmente nao invalidaria a resolucao anterior e o card sairia com a imagem do produto errado.
  const currentHasImageSource = currentAdConfig ? hasMarketingImageSource(currentAdConfig) : false;
  const currentImageKey = `${String(currentAdConfig?.productId || "")}|${currentImageCandidates.join("\u001f")}|${String(currentAdConfig?.imageId || "")}|${String(historyAssetOverride?.productAssetSnapshot?.assetId || "")}`;

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
    // Deep link (catálogo/atalho) também é anúncio novo: nunca herda uma sessão de edição anterior.
    setEditingEntryId(null);
    setHistoryAssetOverride(null);
    setPriceOverride("");
    setMissingProductWarning("");
    setWorkspaceView("editor");
    launchSelectionAppliedRef.current = true;
  }, [launchRequest.productId, products]);

  /**
   * Abre o editor como SESSÃO NOVA. É o único caminho por onde "criar anúncio" deve passar.
   *
   * Sem isso, `editingEntryId` sobrevivia à navegação: quem editava um anúncio salvo, voltava ao
   * histórico e clicava em "criar anúncio" continuava com a sessão de edição aberta — e o salvar
   * sobrescrevia o anúncio antigo em vez de criar um novo. O mesmo valia ao trocar de produto no
   * meio de uma edição.
   */
  const startNewAd = useCallback(() => {
    setEditingEntryId(null);
    setHistoryAssetOverride(null);
    // Anúncio novo começa pelo passo 1: o seletor volta aberto para a escolha do produto.
    setProductPickerOpen(true);
    setPriceOverride("");
    setNote("");
    setCardError("");
    setMissingProductWarning("");
    setWorkspaceView("editor");
  }, []);

  const selectMarketingItem = (product: typeof products[number]) => {
    if (isMarketingKitProduct(product)) {
      setSelectedKitId(product.id);
      setSelectedProductId("");
    } else {
      setSelectedProductId(product.id);
      setSelectedKitId("");
    }
    // Escolher outro produto é começar outro anúncio — nunca reaproveitar a sessão de edição anterior.
    startNewAd();
    setProductPickerOpen(false);
  };

  useEffect(() => {
    let active = true;
    setCardError("");
    if (!currentAdConfig) {
      setImageResolution({ key: "", productId: "", status: "idle", resolved: null, prepared: null, error: "" });
      return () => { active = false; };
    }
    const expectedProductId = currentAdConfig.productId;
    if (!currentHasImageSource) {
      setImageResolution({ key: currentImageKey, productId: expectedProductId, status: "ready", resolved: null, prepared: null, error: "" });
      return () => { active = false; };
    }

    setImageResolution({ key: currentImageKey, productId: expectedProductId, status: "resolving", resolved: null, prepared: null, error: "" });
    // collectMarketingImageCandidates resolve `imageId` no armazenamento local — é o que permite ao
    // anúncio usar exatamente a mesma foto que a tela de Produtos já exibe.
    void collectMarketingImageCandidates(currentAdConfig)
      .then((candidates) => (candidates.length ? resolveMarketingImageCandidates(candidates) : null))
      .then((resolved) => {
        if (!active) return;
        if (!resolved) throw new MarketingImageResolutionError(currentImageCandidates.length);
        const prepared = prepareMarketingProductImage({ productId: expectedProductId, resolvedImage: resolved });
        const expectedSnapshot = historyAssetOverride?.productId === expectedProductId
          ? historyAssetOverride.productAssetSnapshot
          : undefined;
        if (expectedSnapshot) assertProductAssetSnapshotMatches({ snapshot: expectedSnapshot, prepared });
        if (!active) return;
        setImageResolution({ key: currentImageKey, productId: expectedProductId, status: "ready", resolved, prepared, error: "" });
      })
      .catch((error) => {
        if (!active) return;
        const message = error instanceof MarketingProductPreservationError || error instanceof MarketingHistoryAssetError
          ? error.message
          : error instanceof MarketingImageResolutionError ? error.message : MARKETING_IMAGE_ERROR_MESSAGE;
        setImageResolution({ key: currentImageKey, productId: expectedProductId, status: "error", resolved: null, prepared: null, error: message });
        setCardError(message);
      });
    return () => { active = false; };
  }, [currentImageKey]);

  const currentImageState = imageResolution.key === currentImageKey && imageResolution.productId === currentAdConfig?.productId ? imageResolution : {
    key: currentImageKey,
    productId: currentAdConfig?.productId || "",
    status: currentHasImageSource ? "resolving" as const : "ready" as const,
    resolved: null,
    prepared: null,
    error: "",
  };
  const currentResolvedImage = currentImageState.resolved;
  const currentPreparedProductImage = currentImageState.prepared;
  const activeProductRenderRef = useRef<{ productId: string; prepared: PreparedMarketingProductImage | null }>({ productId: "", prepared: null });
  activeProductRenderRef.current = {
    productId: currentAdConfig?.productId || "",
    prepared: currentPreparedProductImage,
  };
  const cardActionsBlocked = cardAction !== null || (currentHasImageSource && currentImageState.status !== "ready");
  const canGenerateCurrentCard = () => {
    if (!currentHasImageSource) return true;
    if (currentImageState.status === "resolving") {
      notifyInfo("Aguarde enquanto preparamos a foto do produto.");
      return false;
    }
    if (currentImageState.status === "ready" && currentResolvedImage && currentPreparedProductImage) return true;
    const message = currentImageState.error || MARKETING_PRODUCT_PRESERVATION_ERROR_MESSAGE;
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
    ...(currentPreparedProductImage ? { productAssetSnapshot: createProductAssetSnapshot(currentPreparedProductImage) } : {}),
  } : null;

  const registerAction = async (action: MarketingAction) => {
    const payload = entryPayload(action);
    if (!payload) return;
    try {
      await recordAction(payload);
      // PLAN-IMPL-06 §14 — "primeiro Marketing" é o primeiro registro REAL persistido em
      // users/{uid}/marketingHistory (useMarketingHistory.ts), nunca só abrir a tela — mesma contagem
      // real de servidor de fireServerCountedFirstOccurrence, reaproveitada (não um marcador local só,
      // já que este histórico é de fato persistido no Firestore).
      const uid = getFirebaseAuth()?.currentUser?.uid;
      if (uid) {
        void fireServerCountedFirstOccurrence(
          uid,
          "first_marketing_created",
          "first_marketing_created",
          () => countMarketingHistoryEntries(uid),
        );
      }
    } catch (error) {
      logError("marketing_history_record_failed", error instanceof Error ? error.message : "Falha ao registrar histórico", { context: { action } });
    }
  };

  useEffect(() => () => {
    if (copyResetTimeoutRef.current !== null) window.clearTimeout(copyResetTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (!selectedItem || !generatedText || generatedText !== defaultGeneratedText || editingEntryId) return;
    if (currentHasImageSource && !currentPreparedProductImage) return;
    const key = `${selectedItem.id}:${template}`;
    if (generatedKeys.current.has(key)) return;
    generatedKeys.current.add(key);
    void registerAction("generated");
  }, [selectedItem?.id, template, editingEntryId, generatedText, defaultGeneratedText, currentHasImageSource, currentPreparedProductImage?.asset.assetId]);

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

  const ensureProductRenderStillCurrent = (captured: MarketingProductRenderIdentity | null) => {
    if (!captured) return;
    const current = activeProductRenderRef.current;
    if (!isMarketingProductRenderIdentityCurrent(captured, current.productId, current.prepared)) {
      throw new MarketingProductPreservationError();
    }
  };

  const shareAdBlob = async (
    payload: NonNullable<ReturnType<typeof entryPayload>>,
    preparedProductImage: PreparedMarketingProductImage | null,
    captured: MarketingProductRenderIdentity | null,
  ) => {
    const blob = await createMarketingCard(payload, { preparedProductImage });
    // A seleção pode mudar enquanto canvas/logo/imagem são decodificados. O blob antigo fica apenas
    // em memória e nunca chega ao share/download quando o produto ativo já é outro.
    ensureProductRenderStillCurrent(captured);
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
    const captured = currentPreparedProductImage ? captureMarketingProductRenderIdentity(currentPreparedProductImage) : null;
    try {
      await shareAdBlob(payload, currentPreparedProductImage, captured);
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

  const handleDownloadImage = async () => {
    const payload = entryPayload("downloaded");
    if (!payload || cardAction || !canGenerateCurrentCard()) return;
    setCardAction("download");
    setCardError("");
    const captured = currentPreparedProductImage ? captureMarketingProductRenderIdentity(currentPreparedProductImage) : null;
    try {
      const blob = await createMarketingCard(payload, { preparedProductImage: currentPreparedProductImage });
      ensureProductRenderStillCurrent(captured);
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
    return {
      action,
      ...config,
      generatedText,
      template: config.templateId,
      price: config.priceText,
      ...(entry.productAssetSnapshot ? { productAssetSnapshot: entry.productAssetSnapshot } : {}),
    };
  };
  /**
   * Lock de operação do histórico. Sem ele, dois toques rápidos em "Compartilhar" ou "Baixar"
   * disparavam duas renderizações e DUAS entradas de histórico para a mesma intenção — além de dois
   * arquivos salvos. A chave inclui o id da entrada, então ações em anúncios diferentes não se
   * bloqueiam entre si.
   */
  const runHistoryAction = async (entry: MarketingHistoryEntry, operation: string, action: () => Promise<void>) => {
    // A AUTORIDADE é o ref, não o state: dois toques no mesmo tick do React leem o mesmo valor de
    // `busyHistoryAction` (o setState ainda não foi aplicado) e ambos passariam pela guarda, gerando
    // dois arquivos e duas entradas de histórico. O ref muda de forma síncrona e barra o segundo.
    if (!historyActionLockRef.current.tryAcquire()) return;
    // O state existe só para a UI (desabilitar botões / indicar operação em andamento).
    setBusyHistoryAction(`${entry.id}:${operation}`);
    try {
      await action();
    } finally {
      historyActionLockRef.current.release();
      setBusyHistoryAction(null);
    }
  };

  /**
   * Imagem do anúncio salvo, resolvida a partir dos campos da PRÓPRIA entrada (inclusive `imageId`).
   * Se não der para resolver, devolve null e o card é montado sem imagem forçada — nunca com a foto
   * de outro produto que estivesse selecionado no editor.
   */
  const resolveEntryImage = async (entry: MarketingHistoryEntry): Promise<{
    resolved: ResolvedMarketingImage | null;
    prepared: PreparedMarketingProductImage | null;
    identityVerified: boolean;
  }> => {
    try {
      const resolved = await resolveMarketingImageSource(entry);
      if (!entry.productAssetSnapshot) return { resolved, prepared: null, identityVerified: false };
      if (!resolved) throw new MarketingHistoryAssetError();
      const prepared = prepareMarketingProductImage({ productId: entry.productId, resolvedImage: resolved });
      assertProductAssetSnapshotMatches({ snapshot: entry.productAssetSnapshot, prepared });
      return { resolved, prepared, identityVerified: true };
    } catch {
      if (entry.productAssetSnapshot) throw new MarketingHistoryAssetError();
      return { resolved: null, prepared: null, identityVerified: false };
    }
  };

  /**
   * ADS-PRO-03 — repetição de ação para uma entrada Pro: preserva mode/identidade (composer/family/
   * background/cutout) exatamente como já persistidos, nunca via repeatPayload/normalizeMarketingAdConfig
   * (que só entendem o shape clássico e descartariam os campos Pro).
   */
  const repeatProPayload = (entry: MarketingHistoryEntry, action: MarketingAction): NewMarketingEntry => ({
    action,
    mode: "pro",
    composerVersion: entry.composerVersion,
    creativeFamily: entry.creativeFamily,
    creativeConceptId: entry.creativeConceptId,
    format: entry.format,
    productId: entry.productId,
    productName: entry.productName,
    productBrand: entry.productBrand,
    productImageUrl: entry.productImageUrl,
    productVolume: entry.productVolume,
    imageUrl: entry.imageUrl,
    generatedText: "",
    template: "pro-ad",
    price: entry.price,
    priceText: entry.priceText,
    headline: entry.headline,
    storeName: entry.storeName,
    storeLogoUrl: entry.storeLogoUrl,
    primaryColor: entry.primaryColor,
    proBackground: entry.proBackground,
    proCutout: entry.proCutout,
  });

  const repeatCopy = async (entry: MarketingHistoryEntry) => runHistoryAction(entry, "copy", async () => {
    const payload = repeatPayload(entry, "copied");
    await copyTextWithFallback(payload.generatedText);
    await recordAction(payload);
    notifySuccess("Anúncio copiado.");
  });
  const repeatShare = async (entry: MarketingHistoryEntry) => runHistoryAction(entry, "share", async () => {
    // ADS-PRO-03 §26 — um registro Pro já tem a arte final persistida (imageUrl); nunca re-renderiza
    // pelo compositor clássico, que não entende creativeFamily/background/cutout.
    if (entry.mode === "pro") {
      if (!entry.imageUrl) { notifyInfo("Este anúncio não tem uma imagem salva para compartilhar."); return; }
      try {
        const blob = await fetch(entry.imageUrl).then((response) => response.blob());
        const text = `${entry.productName}${entry.priceText ? ` — ${entry.priceText}` : ""}`;
        const result = await shareMarketingCard({
          blob,
          productName: entry.productName,
          text,
          title: `${entry.productName} | ${entry.storeName || "Revenda Smart"}`,
          dialogTitle: "Compartilhar anúncio",
          onTextFallback: copyTextWithFallback,
        });
        await recordAction(repeatProPayload(entry, "shared"));
        notifyShareResult(result);
      } catch (error) {
        if (isMarketingShareCancelledError(error)) { notifyInfo("Compartilhamento cancelado."); return; }
        const failure = reportMarketingActionError(error, "share");
        logError("ad_history_share_failed", failure.message, { context: { stage: failure.code, entryAction: entry.action } });
      }
      return;
    }
    const payload = repeatPayload(entry, "shared");
    try {
      const historicalImage = await resolveEntryImage(entry);
      const blob = historicalImage.identityVerified
        ? await createMarketingCard(payload, { preparedProductImage: historicalImage.prepared })
        : await createMarketingCard(payload, { resolvedProductImage: historicalImage.resolved });
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
  });
  const repeatDownload = async (entry: MarketingHistoryEntry) => runHistoryAction(entry, "download", async () => {
    if (entry.mode === "pro") {
      if (!entry.imageUrl) { notifyInfo("Este anúncio não tem uma imagem salva para baixar."); return; }
      try {
        const blob = await fetch(entry.imageUrl).then((response) => response.blob());
        const result = await saveMarketingCard({ blob, productName: entry.productName });
        await recordAction(repeatProPayload(entry, "downloaded"));
        notifySuccess(`Card salvo em ${result.locationLabel}.`);
      } catch (error) {
        const failure = reportMarketingActionError(error, "download");
        logError("ad_history_download_failed", failure.message, { context: { stage: failure.code, entryAction: entry.action } });
      }
      return;
    }
    try {
      const payload = repeatPayload(entry, "downloaded");
      const historicalImage = await resolveEntryImage(entry);
      const blob = historicalImage.identityVerified
        ? await createMarketingCard(payload, { preparedProductImage: historicalImage.prepared })
        : await createMarketingCard(payload, { resolvedProductImage: historicalImage.resolved });
      const result = await saveMarketingCard({ blob, productName: payload.productName });
      await recordAction(payload);
      notifySuccess(`Card salvo em ${result.locationLabel}.`);
    } catch (error) {
      const failure = reportMarketingActionError(error, "download");
      logError("ad_history_download_failed", failure.message, { context: { stage: failure.code, entryAction: entry.action } });
    }
  });


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
    // Ponto C do gate (PRO-04, seções 4 e 7): um anúncio salvo com template Pro por uma conta Premium
    // que depois virou Free reabre com fallback seguro — nunca perde os outros dados do anúncio, só o
    // templateId muda. O aviso é o mesmo canal de toast já usado no resto do fluxo (notifyInfo).
    const resolvedTemplate = resolveMarketingTemplateForPlan(config.templateId, activePlan);
    const templateDowngraded = resolvedTemplate.id !== config.templateId;
    setTemplate(resolvedTemplate.id);
    setAdTheme(config.themeId);
    setPriceOverride(parseMarketingPriceNumber(config.price).toFixed(2));
    setNote(config.note || "");
    setCtaText(config.ctaText || "Chamar no WhatsApp");
    setShowBrand(config.showBrand);
    setShowVolume(config.showVolume);
    setShowStockStatus(config.showStockStatus);
    setShowWhatsAppCta(config.showWhatsAppCta);
    setBackgroundStyle(config.backgroundStyle);
    // Duplicar SEMPRE começa uma entrada nova: o original não pode ser tocado pelo salvar seguinte.
    setEditingEntryId(mode === "duplicate" ? null : entry.id);
    setCardError("");
    // O produto do anúncio pode ter sido excluído do catálogo depois que o anúncio foi salvo. Nesse
    // caso avisamos em vez de seguir em silêncio: o editor continua aberto com os dados históricos,
    // mas o lojista precisa saber que aquele produto não existe mais antes de salvar por cima.
    setMissingProductWarning(
      !savedProduct && config.productId
        ? `O produto deste anúncio (${config.productName || config.productId}) não está mais no catálogo. Escolha outro produto antes de salvar.`
        : "",
    );
    setProductPickerOpen(false);
    setWorkspaceView("editor");
    // PRO-05: o host de feedback (UserFeedbackHost) só mostra UM toast por vez — duas chamadas de
    // notifyInfo na mesma execução síncrona fazem o React batchar os dois setState e só a ÚLTIMA
    // sobrevive ao render. Antes disso, o aviso de downgrade acima nunca chegava a aparecer: sempre
    // era substituído por este toast genérico no mesmo tick. Corrigido combinando os dois numa só
    // mensagem, em vez de disparar dois notifyInfo — nenhum aviso concorre com o outro.
    const modeMessage = mode === "duplicate" ? "Anúncio duplicado no editor." : mode === "theme" ? "Escolha um novo tema e confirme para salvar." : "Anúncio aberto para edição.";
    notifyInfo(templateDowngraded ? `${modeMessage} O template original exigia Premium; trocamos por um template gratuito.` : modeMessage);
  };

  const openHistoryEntry = async (entry: MarketingHistoryEntry, mode: "edit" | "theme" | "duplicate") =>
    runHistoryAction(entry, mode, async () => {
      try {
        // Entradas novas provam a identidade ANTES de popular o editor. Legacy continua abrindo pelo
        // comportamento anterior, mas não recebe retroativamente uma garantia que nunca teve.
        if (entry.productAssetSnapshot) await resolveEntryImage(entry);
        setHistoryAssetOverride(entry.productAssetSnapshot ? entry : null);
        applyEntryToEditor(entry, mode);
        if (mode === "duplicate") await recordAction(repeatPayload(entry, "duplicated"));
      } catch (error) {
        const failure = reportMarketingActionError(error, "download");
        logError("ad_history_reopen_failed", failure.message, { context: { stage: failure.code, mode } });
      }
    });

  /** Abre uma entrada existente para edição — só ela poderá ser atualizada pelo salvar. */
  const startEditAd = (entry: MarketingHistoryEntry) => { void openHistoryEntry(entry, "edit"); };

  const handleDuplicateEntry = async (entry: MarketingHistoryEntry) => {
    await openHistoryEntry(entry, "duplicate");
  };

  const handleSaveEditedEntry = async () => {
    if (!editingEntryId) return;
    const payload = entryPayload("edited");
    if (!payload) return;
    const existingEntry = historyEntries.find((entry) => entry.id === editingEntryId);
    const safePatch = { ...payload, productAssetSnapshot: undefined };
    await updateEntry(editingEntryId, {
      ...safePatch,
      ...(existingEntry?.productAssetSnapshot ? { productAssetSnapshot: existingEntry.productAssetSnapshot } : {}),
    });
    setEditingEntryId(null);
    setHistoryAssetOverride(null);
    notifySuccess("Anúncio atualizado.");
  };

  const handleCancelEditing = () => {
    setEditingEntryId(null);
    setHistoryAssetOverride(null);
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
        {/* Coluna única: o fluxo é vertical do produto até a arte, sem telas intermediárias. A largura
            máxima segura o layout no desktop sem virar um segundo desenho de tela.

            `grid-cols-[minmax(0,1fr)]` é o que impede a página de rolar de lado: uma coluna implícita
            `auto` é dimensionada pelo min-content dos filhos, então qualquer trilho horizontal
            interno esticaria a coluna e, com ela, a página. Com o piso em 0, a coluna acompanha a
            viewport e o scroll lateral fica restrito a quem realmente o pediu. */}
        <div className="mx-auto grid w-full max-w-2xl grid-cols-[minmax(0,1fr)] gap-3 overflow-y-auto px-4 pb-[max(8rem,calc(8rem+env(safe-area-inset-bottom)))] pt-3 sm:px-6 sm:pt-5">
          <MarketingTabs activeView={workspaceView} onChange={setWorkspaceView} showProTab={isProAdsAdmin} />

          {workspaceView === "editor" && (
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
                <MarketingSection
                  step={1}
                  title="Produto"
                  hint={selectedItem ? undefined : "Escolha o produto do anúncio"}
                  testId="marketing-step-product"
                  action={selectedItem && productPickerOpen ? (
                    <button type="button" onClick={() => setProductPickerOpen(false)} className="rounded-full border border-border/60 bg-white px-3 py-1.5 text-[11px] font-bold text-foreground">Pronto</button>
                  ) : undefined}
                >
                {selectedItem && !productPickerOpen ? (
                  <MarketingSelectedProduct
                    name={selectedItem.name}
                    brand={selectedItem.brand}
                    price={priceOverride || selectedItem.salePrice || 0}
                    stock={selectedItem.stock}
                    imageSource={selectedItem}
                    onChange={() => setProductPickerOpen(true)}
                  />
                ) : (
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
                  onSelectProduct={(productId) => { setSelectedProductId(productId); setSelectedKitId(""); setProductPickerOpen(false); }}
                  onSelectKit={(productId) => { setSelectedKitId(productId); setSelectedProductId(""); setProductPickerOpen(false); }}
                  onSelectFeatured={selectMarketingItem}
                  onLoadMore={() => void loadMore()}
                />
                )}
                </MarketingSection>

                <MarketingSection step={2} title="Template" hint="Escolha o formato do anúncio" testId="marketing-step-type">
                <MarketingTemplateSelector
                  template={template}
                  v2TemplatesEnabled={v2TemplatesEnabled}
                  allowedTiers={allowedTemplateTiers}
                  // Ponto B do gate (PRO-04, seção 4): o selector já não deixa clicar num template Pro
                  // bloqueado (ver aria-disabled/onLockedTemplateTap ali), mas o gate é aplicado de
                  // novo aqui — defesa em profundidade, nunca confiar só na UI para a garantia de plano.
                  onTemplateChange={(id) => setTemplate(resolveMarketingTemplateForPlan(id, activePlan).id)}
                  onLockedTemplateTap={() => setLocation("/subscribe")}
                />
                </MarketingSection>

                <MarketingSection step={3} title="Personalização" hint="Cor, informações, preço e chamada" testId="marketing-step-customize">
                <MarketingEditor
                  themeId={adTheme}
                  brandAccent={settings.primaryColor || "#ec4899"}
                  priceText={currentPrice}
                  priceOverride={priceOverride}
                  note={note}
                  ctaText={ctaText}
                  showBrand={showBrand}
                  showVolume={showVolume}
                  showStockStatus={showStockStatus}
                  showWhatsAppCta={showWhatsAppCta}
                  includePayment={includePayment}
                  hasPaymentConfiguration={Boolean(settings.pixKey || settings.paymentLink)}
                  onThemeChange={setAdTheme}
                  onUseThemeAsDefault={handleUseThemeAsDefault}
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
                </MarketingSection>

                {missingProductWarning && (
                  <p className="rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-xs font-semibold text-destructive">{missingProductWarning}</p>
                )}
                {editingEntryId && (
                  <div className="grid gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 sm:grid-cols-2">
                    <button type="button" onClick={handleCancelEditing} className="min-h-11 rounded-xl border border-amber-300 bg-white px-4 text-xs font-bold text-amber-900">Cancelar edição</button>
                    <button type="button" onClick={handleSaveEditedEntry} className="min-h-11 rounded-xl bg-primary px-4 text-xs font-bold text-white">Salvar alterações</button>
                  </div>
                )}

                <MarketingSection step={4} title="Preview" hint="É assim que sua arte será gerada." testId="marketing-step-preview">
                <MarketingPreview
                  config={currentAdConfig}
                  preparedProductImage={currentPreparedProductImage}
                  imageStatus={currentImageState.status}
                  editing={Boolean(editingEntryId)}
                  showWhatsappSetupNotice={showWhatsappSetupNotice}
                  hasWhatsapp={Boolean(storeWhatsappNumber)}
                  hasProducts={products.length > 0}
                  onCtaClick={handleCardCtaClick}
                  onConfigureWhatsapp={openWhatsappSettings}
                  onCreateProduct={() => { window.location.href = "/add-product"; }}
                />
                </MarketingSection>

                {currentAdConfig && (
                  <MarketingSection step={5} title="Gerar arte" hint="Envie no WhatsApp ou salve o PNG" testId="marketing-step-actions">
                    <MarketingExportActions
                      cardAction={cardAction}
                      blocked={cardActionsBlocked}
                      imageStatus={currentImageState.status}
                      error={cardError}
                      onShare={handleShare}
                      onDownload={handleDownloadImage}
                    />
                    {/* Texto do anúncio como ação SECUNDÁRIA: fica abaixo das duas principais e não
                        compete com elas, mas continua editável e copiável como antes. */}
                    <div className="mt-3">
                      <MarketingCopyPanel generatedText={generatedText} copied={copied} onTextChange={setGeneratedText} onCopy={handleCopy} />
                    </div>
                  </MarketingSection>
                )}
            </div>
          )}

          {workspaceView === "pro" && isProAdsAdmin && (
            <MarketingProPanel
              products={products}
              storeName={storeDisplayName}
              storeLogoUrl={storeLogoUrl || undefined}
              primaryColor={settings.primaryColor || undefined}
            />
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
              onCreate={startNewAd}
              onEdit={startEditAd}
              busyActionId={busyHistoryAction}
              availableProductIds={availableProductIds}
              onTheme={(entry) => { void openHistoryEntry(entry, "theme"); }}
              onDuplicate={handleDuplicateEntry}
            />
          )}
        </div>
      </div>
    </Layout>
  );
}
