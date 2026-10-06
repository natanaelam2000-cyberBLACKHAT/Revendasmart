import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent } from "react";
import { Maximize2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createMarketingEntryId, useMarketingHistory } from "@/hooks/useMarketingHistory";
import { getFirebaseAuth } from "@/lib/firebase";
import { uploadImageViaServer } from "@/lib/server-upload";
import type { Product } from "@/lib/mock-data";
import { getProductImage } from "@/lib/mock-data";
import {
  STUDIO_EXPORT_MAX_SIDE,
  STUDIO_PREVIEW_MAX_SIDE,
  buildStudioRenderAssets,
  loadStudioStaticBackground,
  resolveStudioRenderDoc,
} from "@/lib/ads-pro-studio-assets";
import { STUDIO_BACKGROUND_CATALOG, resolveStudioBackdrop } from "@/lib/ads-pro-studio-catalog";
import { exportAdsProAdAsPng } from "@/lib/ads-pro-studio-render";
import { downloadStudioAd, shareStudioAd } from "@/lib/ads-pro-studio-export";
import {
  STUDIO_SAVE_MESSAGES,
  readStudioDocumentFromEntry,
  saveStudioProject,
  type StudioBranding,
  type StudioSaveDeps,
} from "@/lib/ads-pro-studio-persistence";
import {
  NEUTRAL_PHOTO_ADJUST,
  getAdsProCanvasSize,
  withBackground,
  withDirection,
  withFormat,
  withPhoto,
  withText,
  withVisibility,
  withArchetype,
  type AdsProAdDocumentV1,
  type AdsProAdText,
  type AdsProAdVisibility,
  type AdsProFormat,
} from "@shared/ads-pro/ad-document";
import { buildAdsProProductFacts } from "@shared/ads-pro/ad-product-facts";
import {
  INITIAL_STUDIO_STATE,
  carryStudioContent,
  hasUnsavedStudioChanges,
  isStudioEdited,
  studioReducer,
} from "@shared/ads-pro/ad-studio-state";
import { resolveAdsProStyleDirection, type AdsProIntensity } from "@shared/ads-pro/ad-style-direction";
import {
  generateAdsProVariations,
  rankAdsProBackgroundsForFacts,
  type AdsProVariation,
} from "@shared/ads-pro/ad-variations";
import { toDocumentBackground } from "@shared/ads-pro/ad-backdrop";
import type { AdsProCreativeProfileV1 } from "@shared/ads-pro/creative-profile";
import type { MarketingProBackgroundAsset } from "@shared/marketing-pro-background-library";
import type { MarketingProStyle } from "@shared/marketing-pro-contract";
import type { MarketingCampaignIntentId } from "@shared/marketing-pro-creative-intelligence";
import { AdsProStudioCanvas, resolveRenderWidth, useElementWidth, type StudioCanvasReport } from "./AdsProStudioCanvas";
import { StudioBackgroundStep } from "./StudioBackgroundStep";
import { StudioEditStep } from "./StudioEditStep";
import { StudioOptionsStep, type StudioAssetsFactory } from "./StudioOptionsStep";
import { StudioPhotoStep } from "./StudioPhotoStep";
import { StudioSaveStep, type StudioBusy, type StudioFeedback, type StudioSavedProject } from "./StudioSaveStep";
import { StudioStyleStep, type StudioStyleOrigin } from "./StudioStyleStep";
import { StudioBanner, StudioPrimaryButton } from "./StudioPrimitives";
import { STUDIO_STEPS, nextStudioStep, type StudioPhotoPatch, type StudioStepId, type StudioStyleChoice } from "./studio-shared";
import { useStaticBackgroundImage, useStudioAssets } from "./use-studio-assets";

// O cartão do perfil de estilo (quiz) carrega à parte: o estúdio já nasce com o perfil lido, sem esperar o quiz.
const AdsProProfileCard = lazy(() =>
  import("@/components/marketing/AdsProProfileCard").then((m) => ({ default: m.AdsProProfileCard })),
);

export interface AdsProStudioProps {
  readonly products: readonly Product[];
  readonly selectedProductId: string;
  readonly onSelectProduct: (productId: string) => void;
  readonly branding: StudioBranding;
}

const HEX = /^#[0-9a-f]{6}$/i;

function buildFacts(product: Product) {
  const extras = product.extras ?? {};
  return buildAdsProProductFacts({
    id: product.id,
    name: product.name,
    brand: product.brand,
    category: product.category,
    salePrice: product.salePrice,
    promotionalPrice: (product as unknown as Record<string, unknown>).promotionalPrice,
    discountPercent: product.discountPercent,
    stock: product.stock,
    description: product.description,
    extras,
  });
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export function AdsProStudio({ products, selectedProductId, onSelectProduct, branding }: AdsProStudioProps) {
  const product = useMemo(() => products.find((item) => item.id === selectedProductId) ?? products[0], [products, selectedProductId]);
  const facts = useMemo(() => (product ? buildFacts(product) : null), [product]);
  const assets = useStudioAssets(product, branding.storeLogoUrl);
  const history = useMarketingHistory();

  // Perfil criativo do vendedor (quiz de estilo): define quais estilos lideram as opções. `null` = ainda sem perfil.
  const [profile, setProfile] = useState<AdsProCreativeProfileV1 | null>(null);
  const [step, setStep] = useState<StudioStepId>("photo");
  const [intent, setIntent] = useState<MarketingCampaignIntentId>("spotlight");
  const [format, setFormat] = useState<AdsProFormat>("portrait");
  const [intensity, setIntensity] = useState<AdsProIntensity | undefined>(undefined);
  const [styleChoice, setStyleChoice] = useState<StudioStyleChoice>("profile");
  const [round, setRound] = useState(0);
  const [showOriginal, setShowOriginal] = useState(false);
  const [state, dispatch] = useReducer(studioReducer, INITIAL_STUDIO_STATE);
  const [report, setReport] = useState<StudioCanvasReport | null>(null);
  const [busy, setBusy] = useState<StudioBusy>("idle");
  const [feedback, setFeedback] = useState<StudioFeedback | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const [headerOffset, setHeaderOffset] = useState(0);

  const frameRef = useRef<HTMLDivElement | null>(null);
  const entryIdRef = useRef<string>(createMarketingEntryId());
  const remoteExistsRef = useRef(false);
  const busyRef = useRef(false);
  const pendingProjectRef = useRef<{ readonly doc: AdsProAdDocumentV1; readonly entryId: string } | null>(null);
  const autoCutoutProductRef = useRef<string | null>(null);

  // ---- Opções (variações) ---------------------------------------------------------------------
  const profileStyles = useMemo<readonly MarketingProStyle[]>(() => profile?.preferredStyles ?? [], [profile]);
  const preferredStyles = useMemo<readonly MarketingProStyle[]>(
    () => (styleChoice === "profile" ? profileStyles : [styleChoice, ...profileStyles.filter((style) => style !== styleChoice)]),
    [profileStyles, styleChoice],
  );
  const accent = branding.primaryColor && HEX.test(branding.primaryColor) ? branding.primaryColor : undefined;

  const baseDirection = useMemo(
    () => (facts ? resolveAdsProStyleDirection({ preferredStyles, intent, category: facts.category, intensityOverride: intensity }) : null),
    [facts, preferredStyles, intent, intensity],
  );
  const styleOrigin: StudioStyleOrigin = styleChoice !== "profile" ? "chosen" : baseDirection?.styleSource === "profile" ? "profile" : "category-default";

  const variations = useMemo<readonly AdsProVariation[]>(
    () => (facts ? generateAdsProVariations({ facts, preferredStyles, intent, format, storeName: branding.storeName, accent, intensityOverride: intensity, round, manifest: STUDIO_BACKGROUND_CATALOG.manifest, library: STUDIO_BACKGROUND_CATALOG.library }) : []),
    [facts, preferredStyles, intent, format, branding.storeName, accent, intensity, round],
  );

  // Trocar de produto zera o projeto (ou abre o projeto que estava esperando esse produto).
  useEffect(() => {
    const pending = pendingProjectRef.current;
    if (pending && product && pending.doc.productId === product.id) {
      pendingProjectRef.current = null;
      entryIdRef.current = pending.entryId;
      remoteExistsRef.current = true;
      setFormat(pending.doc.format);
      setIntent(pending.doc.direction.intent);
      dispatch({ type: "open-project", doc: pending.doc });
      setStep("edit");
      return;
    }
    dispatch({ type: "reset" });
    entryIdRef.current = createMarketingEntryId();
    remoteExistsRef.current = false;
    setRound(0);
    setFeedback(null);
    setShowOriginal(false);
  }, [product?.id]);

  useEffect(() => {
    if (variations.length > 0) dispatch({ type: "variations-ready", variations });
  }, [variations]);

  // Projeto reaberto "sem fundo": o recorte local é determinístico, então é refeito sozinho (sem custo).
  useEffect(() => {
    const doc = state.doc;
    if (!doc || !product || doc.photo.mode !== "cutout") return;
    if (assets.photoStatus !== "ready" || assets.cutout || assets.cutoutBusy || assets.cutoutFailure) return;
    if (autoCutoutProductRef.current === product.id) return;
    autoCutoutProductRef.current = product.id;
    void assets.generateCutout();
  }, [state.doc, product, assets]);

  // ---- Edições --------------------------------------------------------------------------------
  const edit = useCallback(
    (kind: "content" | "look" | "photo" | "format", apply: (doc: AdsProAdDocumentV1) => AdsProAdDocumentV1, key?: string) => {
      dispatch({ type: "edit", kind, apply, key, now: Date.now() });
      setFeedback(null);
    },
    [],
  );
  const handlePhotoChange = useCallback((patch: StudioPhotoPatch, key?: string) => edit("photo", (doc) => withPhoto(doc, patch), key), [edit]);
  const handleText = useCallback((patch: Partial<AdsProAdText>, key: string) => edit("content", (doc) => withText(doc, patch), key), [edit]);
  const handleVisibility = useCallback((patch: Partial<AdsProAdVisibility>) => edit("content", (doc) => withVisibility(doc, patch)), [edit]);
  const handleArchetype = useCallback((archetype: AdsProAdDocumentV1["direction"]["archetype"]) => edit("look", (doc) => withArchetype(doc, archetype)), [edit]);
  const handleDirection = useCallback(
    (patch: Parameters<typeof withDirection>[1]) => edit("look", (doc) => withDirection(doc, patch)),
    [edit],
  );
  const handleFormat = useCallback(
    (next: AdsProFormat) => {
      setFormat(next);
      edit("format", (doc) => withFormat(doc, next));
    },
    [edit],
  );
  const handleBackground = useCallback(
    (asset: MarketingProBackgroundAsset) => edit("look", (doc) => withBackground(doc, toDocumentBackground(asset))),
    [edit],
  );
  const handlePick = useCallback((variation: AdsProVariation) => {
    dispatch({ type: "pick-variation", variation });
    setFeedback(null);
  }, []);
  const handleRestoreText = useCallback(() => {
    const source = variations.find((variation) => variation.id === state.selectedVariationId) ?? variations[0];
    if (source) edit("content", (doc) => ({ ...doc, text: source.doc.text, show: source.doc.show }));
  }, [edit, state.selectedVariationId, variations]);

  // ---- Produto / novo projeto -----------------------------------------------------------------
  const requestProduct = useCallback(
    (id: string) => {
      if (id === product?.id) return;
      if (isStudioEdited(state) && hasUnsavedStudioChanges(state)) {
        setPendingProductId(id);
        return;
      }
      onSelectProduct(id);
    },
    [onSelectProduct, product?.id, state],
  );

  const handleNewProject = useCallback(() => {
    if (isStudioEdited(state) && hasUnsavedStudioChanges(state) && !confirmNew) {
      setConfirmNew(true);
      return;
    }
    setConfirmNew(false);
    dispatch({ type: "reset" });
    entryIdRef.current = createMarketingEntryId();
    remoteExistsRef.current = false;
    setRound(0);
    setFeedback(null);
    setStep("photo");
    if (variations.length > 0) dispatch({ type: "variations-ready", variations });
  }, [confirmNew, state, variations]);

  // ---- Documento e imagens para desenhar ------------------------------------------------------
  const cutoutAvailable = assets.cutout !== null;
  const previewDoc = useMemo<AdsProAdDocumentV1 | null>(() => {
    if (!state.doc) return null;
    const base = showOriginal ? { ...state.doc, photo: { ...state.doc.photo, mode: "original" as const, adjust: NEUTRAL_PHOTO_ADJUST } } : state.doc;
    return resolveStudioRenderDoc(base, cutoutAvailable);
  }, [state.doc, showOriginal, cutoutAvailable]);
  const deferredDoc = useDeferredValue(previewDoc);
  const stillSettling = deferredDoc !== previewDoc;

  const backdropAsset = useMemo(() => (deferredDoc ? resolveStudioBackdrop(deferredDoc.background, deferredDoc.format).asset : undefined), [deferredDoc]);
  const backgroundImage = useStaticBackgroundImage(backdropAsset);
  const previewAssets = useMemo(
    () => (deferredDoc ? buildStudioRenderAssets({ doc: deferredDoc, original: assets.original, cutout: assets.cutout, logo: assets.logo, backgroundImage: backgroundImage.image, maxSide: STUDIO_PREVIEW_MAX_SIDE }) : null),
    [deferredDoc, assets.original, assets.cutout, assets.logo, backgroundImage.image],
  );

  const assetsFor = useCallback<StudioAssetsFactory>(
    (doc, bgImage, maxSide) => buildStudioRenderAssets({ doc, original: assets.original, cutout: assets.cutout, logo: assets.logo, backgroundImage: bgImage, maxSide }),
    [assets.original, assets.cutout, assets.logo],
  );
  // Miniaturas = o que você teria ao tocar na opção: visual da opção + sua foto/seus textos.
  const decorate = useCallback(
    (variationDoc: AdsProAdDocumentV1) => resolveStudioRenderDoc(carryStudioContent(state.doc, variationDoc, state.contentEdited), cutoutAvailable),
    [state.doc, state.contentEdited, cutoutAvailable],
  );

  const backgroundSuggestions = useMemo(() => {
    if (!facts || !state.doc) return [];
    return rankAdsProBackgroundsForFacts({ facts, preferredStyles, style: state.doc.direction.style, intent, format: state.doc.format, manifest: STUDIO_BACKGROUND_CATALOG.manifest, library: STUDIO_BACKGROUND_CATALOG.library });
  }, [facts, preferredStyles, intent, state.doc?.direction.style, state.doc?.format]);

  // ---- Exportar / salvar / compartilhar -------------------------------------------------------
  const photoReady = assets.photoStatus === "ready";
  const exportBlockedReason =
    assets.photoStatus === "loading" ? "Aguarde a foto do produto carregar para exportar."
    : assets.photoStatus === "no-image" ? "Este produto não tem foto cadastrada — adicione uma foto no cadastro para salvar, baixar ou compartilhar."
    : assets.photoStatus === "load-failed" ? "Não foi possível carregar a foto do produto — tente novamente antes de exportar."
    : null;
  const canExport = Boolean(state.doc) && photoReady;

  const exportCurrent = useCallback(async () => {
    const doc = state.doc;
    if (!doc) throw new Error("no-document");
    const renderDoc = resolveStudioRenderDoc(doc, assets.cutout !== null);
    const backdrop = resolveStudioBackdrop(renderDoc.background, renderDoc.format);
    // O fundo estático é carregado de novo aqui: a exportação nunca depende de a miniatura já ter terminado.
    const staticImage = backdrop.asset.sourceType === "STATIC_ASSET" ? await loadStudioStaticBackground(backdrop.asset.staticUrl) : null;
    const renderAssets = buildStudioRenderAssets({ doc: renderDoc, original: assets.original, cutout: assets.cutout, logo: assets.logo, backgroundImage: staticImage, maxSide: STUDIO_EXPORT_MAX_SIDE });
    const exported = await exportAdsProAdAsPng(renderDoc, renderAssets);
    // Garantia de dimensão: o arquivo SEMPRE sai no tamanho exato do formato (4:5 = 1080×1350, 1:1 = 1080×1080).
    const expected = getAdsProCanvasSize(renderDoc.format);
    if (exported.width !== expected.width || exported.height !== expected.height) throw new Error("export-size-mismatch");
    return exported;
  }, [state.doc, assets.cutout, assets.original, assets.logo]);

  const runExclusive = useCallback(async (mode: StudioBusy, task: () => Promise<void>) => {
    if (busyRef.current) return; // duplo toque / retry rápido nunca dispara duas operações
    busyRef.current = true;
    setBusy(mode);
    setFeedback(null);
    try {
      await task();
    } finally {
      busyRef.current = false;
      setBusy("idle");
    }
  }, []);

  const saveDeps = useMemo<StudioSaveDeps>(
    () => ({
      getToken: async () => {
        try {
          return await getFirebaseAuth()?.currentUser?.getIdToken();
        } catch {
          return undefined;
        }
      },
      upload: uploadImageViaServer,
      recordAction: history.recordAction,
      updateEntry: history.updateEntry,
    }),
    [history.recordAction, history.updateEntry],
  );

  const handleSave = useCallback(
    () => runExclusive("saving", async () => {
      const doc = state.doc;
      if (!doc || !product) return;
      let png: Blob;
      try {
        png = (await exportCurrent()).blob;
      } catch {
        setFeedback({ tone: "error", kind: "save", text: "Não foi possível gerar a imagem do anúncio. Tente novamente." });
        return;
      }
      const result = await saveStudioProject(
        { entryId: entryIdRef.current, doc, png, product: { id: product.id, name: product.name, brand: product.brand, imageUrl: getProductImage(product) ?? undefined }, branding, remoteExists: remoteExistsRef.current },
        saveDeps,
      );
      remoteExistsRef.current = result.remoteExists;
      if (result.status === "failed") {
        setFeedback({ tone: "error", kind: "save", text: result.failure === "no-auth" ? "Entre na sua conta para salvar o anúncio." : STUDIO_SAVE_MESSAGES.failed });
        return;
      }
      dispatch({ type: "mark-saved" });
      setFeedback({ tone: result.status === "saved" ? "success" : "warning", kind: "save", text: STUDIO_SAVE_MESSAGES[result.status] });
    }),
    [branding, exportCurrent, product, runExclusive, saveDeps, state.doc],
  );

  const handleDownload = useCallback(
    () => runExclusive("downloading", async () => {
      if (!state.doc || !product) return;
      let blob: Blob;
      try {
        blob = (await exportCurrent()).blob;
      } catch {
        setFeedback({ tone: "error", kind: "download", text: "Não foi possível gerar a imagem do anúncio. Tente novamente." });
        return;
      }
      const outcome = await downloadStudioAd({ blob, productName: product.name });
      setFeedback({ tone: outcome.status === "saved" ? "success" : "error", kind: "download", text: outcome.message });
    }),
    [exportCurrent, product, runExclusive, state.doc],
  );

  const handleShare = useCallback(
    () => runExclusive("sharing", async () => {
      const doc = state.doc;
      if (!doc || !product) return;
      let blob: Blob;
      try {
        blob = (await exportCurrent()).blob;
      } catch {
        setFeedback({ tone: "error", kind: "share", text: "Não foi possível gerar a imagem do anúncio. Tente novamente." });
        return;
      }
      const text = [doc.text.headline.trim(), doc.show.price ? doc.text.priceText.trim() : "", branding.storeName].filter(Boolean).join(" — ");
      const outcome = await shareStudioAd({ blob, productName: product.name, text });
      const tone = outcome.status === "shared" ? "success" : outcome.status === "downloaded-fallback" ? "warning" : outcome.status === "cancelled" ? "info" : "error";
      setFeedback({ tone, kind: "share", text: outcome.message });
    }),
    [branding.storeName, exportCurrent, product, runExclusive, state.doc],
  );

  // ---- Projetos salvos ------------------------------------------------------------------------
  const projects = useMemo<readonly StudioSavedProject[]>(() => {
    const list: StudioSavedProject[] = [];
    for (const entry of history.entries) {
      if (list.length >= 6) break;
      const doc = readStudioDocumentFromEntry(entry);
      if (!doc) continue;
      list.push({ id: entry.id, title: entry.productName || doc.text.headline || "Anúncio", dateLabel: formatDate(entry.createdAtISO), imageUrl: entry.imageUrl || undefined, format: doc.format });
    }
    return list;
  }, [history.entries]);

  const handleOpenProject = useCallback(
    (entryId: string) => {
      const entry = history.entries.find((item) => item.id === entryId);
      const doc = entry ? readStudioDocumentFromEntry(entry) : null;
      if (!entry || !doc) {
        setFeedback({ tone: "error", kind: "save", text: "Este anúncio não pode ser reaberto para edição." });
        return;
      }
      if (!products.some((item) => item.id === doc.productId)) {
        setFeedback({ tone: "warning", kind: "save", text: "O produto deste anúncio não existe mais, então ele não pode ser reaberto para edição." });
        return;
      }
      if (product && doc.productId === product.id) {
        entryIdRef.current = entry.id;
        remoteExistsRef.current = true;
        setFormat(doc.format);
        setIntent(doc.direction.intent);
        dispatch({ type: "open-project", doc });
        setFeedback({ tone: "success", kind: "save", text: "Anúncio reaberto. Continue editando." });
        setStep("edit");
        return;
      }
      pendingProjectRef.current = { doc, entryId: entry.id };
      onSelectProduct(doc.productId);
    },
    [history.entries, onSelectProduct, product, products],
  );

  // ---- Layout: preview fixo abaixo do cabeçalho do app ----------------------------------------
  useEffect(() => {
    const header = typeof document === "undefined" ? null : document.querySelector<HTMLElement>(".rs-app-header");
    if (!header) {
      setHeaderOffset(0);
      return;
    }
    const measure = () => setHeaderOffset(Math.round(header.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  // Com o bloco fixo (prévia + abas) por cima do conteúdo, tudo que a rolagem/foco leva "para a vista" precisa parar
  // ABAIXO dele (e acima da barra inferior) — senão o campo focado fica escondido atrás da prévia.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof window === "undefined") return;
    const root = document.documentElement;
    const apply = () => {
      const stacked = window.getComputedStyle(frame).position === "sticky" && !window.matchMedia("(min-width: 1024px)").matches;
      root.style.scrollPaddingTop = stacked ? `${Math.round(headerOffset + 8 + frame.getBoundingClientRect().height + 12)}px` : "";
      root.style.scrollPaddingBottom = stacked ? "6rem" : "";
    };
    apply();
    window.addEventListener("resize", apply);
    if (typeof ResizeObserver === "undefined") return () => { window.removeEventListener("resize", apply); root.style.scrollPaddingTop = ""; root.style.scrollPaddingBottom = ""; };
    const observer = new ResizeObserver(apply);
    observer.observe(frame);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", apply);
      root.style.scrollPaddingTop = "";
      root.style.scrollPaddingBottom = "";
    };
  }, [headerOffset, product?.id]);

  const preview = useElementWidth<HTMLDivElement>(320);
  const previewRenderWidth = deferredDoc ? resolveRenderWidth(preview.width, deferredDoc.format) : 360;
  const selectedVariation = variations.find((variation) => variation.id === state.selectedVariationId);
  const optionLabel = state.selectedVariationId === "saved" ? "Projeto salvo" : selectedVariation ? `${selectedVariation.label} · ${selectedVariation.roleLabel}` : "Montando suas opções...";
  const exportSize = getAdsProCanvasSize(state.doc?.format ?? format);
  const unsaved = hasUnsavedStudioChanges(state);

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const index = STUDIO_STEPS.findIndex((item) => item.id === step);
    const next = STUDIO_STEPS[(index + (event.key === "ArrowRight" ? 1 : STUDIO_STEPS.length - 1)) % STUDIO_STEPS.length];
    setStep(next.id);
    document.getElementById(`studio-tab-${next.id}`)?.focus();
    event.preventDefault();
  };

  if (!product || !facts) {
    return (
      <div className="rounded-2xl border border-border/60 bg-white p-3.5" data-testid="ads-pro-studio-empty">
        <StudioBanner tone="info">Cadastre um produto para começar um anúncio.</StudioBanner>
      </div>
    );
  }

  return (
    <section
      className="min-w-0 rounded-2xl border border-primary/20 bg-white p-3 shadow-sm sm:p-4 lg:grid lg:grid-cols-[minmax(300px,420px)_minmax(0,1fr)] lg:items-start lg:gap-6"
      data-testid="ads-pro-studio"
      data-step={step}
      data-product-id={product.id}
      data-format={state.doc?.format ?? format}
      data-variation-id={state.selectedVariationId ?? ""}
      data-photo-status={assets.photoStatus}
      data-unsaved={unsaved}
      data-edited={isStudioEdited(state)}
    >
      <div
        ref={frameRef}
        className="z-30 -mx-1 mb-3 rounded-2xl border border-border/60 bg-white/95 px-2 pb-2 pt-2 shadow-sm backdrop-blur [@media(min-height:560px)]:sticky lg:sticky lg:mx-0 lg:mb-0"
        style={{ top: headerOffset + 8 }}
        data-testid="studio-preview-frame"
      >
        <div ref={preview.ref} className="flex w-full flex-row items-center gap-2 lg:flex-col lg:items-stretch" data-testid="studio-preview">
          <div className="flex min-w-0 shrink-0 justify-center lg:shrink">
            {deferredDoc && previewAssets ? (
              <AdsProStudioCanvas
                doc={deferredDoc}
                assets={previewAssets}
                renderWidth={previewRenderWidth}
                ariaLabel={`Prévia do anúncio de ${product.name}`}
                testId="studio-canvas"
                maxHeight="min(30vh, 300px)"
                className="lg:!max-h-[56vh]"
                onRendered={setReport}
              />
            ) : (
              <div className="flex aspect-[4/5] h-[min(30vh,300px)] items-center justify-center rounded-2xl bg-muted/50 px-2 text-center text-xs font-semibold text-muted-foreground" data-testid="studio-canvas-loading">Montando o anúncio...</div>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 lg:flex-none lg:flex-row lg:items-center lg:justify-between">
            <p className="line-clamp-3 min-w-0 text-[11px] font-bold leading-snug text-foreground lg:truncate" data-testid="studio-option-label" aria-live="polite">
              {optionLabel}{stillSettling ? " …" : ""}
            </p>
            <button
              type="button"
              onClick={() => setZoomOpen(true)}
              disabled={!deferredDoc}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-primary/30 bg-white px-3 text-[11px] font-black text-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              data-testid="studio-zoom-open"
            >
              <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" /> Ampliar
            </button>
            {showOriginal && <p className="text-[10px] font-semibold leading-snug text-amber-700 lg:hidden" data-testid="studio-showing-original">Mostrando a foto original, sem ajustes nem recorte.</p>}
          </div>
        </div>
        {showOriginal && <p className="mt-1 hidden text-[10px] font-semibold text-amber-700 lg:block" data-testid="studio-showing-original-desktop">Mostrando a foto original, sem ajustes nem recorte.</p>}

        <div
          role="tablist"
          aria-label="Etapas do anúncio"
          className="mt-2 grid grid-cols-6 gap-1"
          onKeyDown={onTabKeyDown}
          data-testid="studio-tabs"
        >
          {STUDIO_STEPS.map((item, index) => {
            const selected = step === item.id;
            return (
              <button
                key={item.id}
                id={`studio-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`studio-panel-${item.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setStep(item.id)}
                data-testid={`studio-tab-${item.id}`}
                className={`min-h-11 min-w-0 rounded-xl px-0.5 text-[11px] font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:px-2 sm:text-xs ${selected ? "bg-primary text-primary-foreground shadow-sm" : "bg-secondary/50 text-muted-foreground hover:bg-secondary"}`}
              >
                <span className="hidden text-[10px] opacity-70 sm:mr-1 sm:inline">{index + 1}</span>{item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-w-0" data-testid="studio-panels">
        {pendingProductId && (
          <div className="mb-3 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3" role="alertdialog" aria-label="Trocar de produto" data-testid="studio-switch-product-confirm">
            <p className="text-xs font-semibold text-amber-800">Trocar de produto descarta as alterações que você ainda não salvou neste anúncio.</p>
            <div className="grid grid-cols-2 gap-2">
              <StudioPrimaryButton tone="outline" onClick={() => setPendingProductId(null)} testId="studio-switch-product-cancel">Continuar editando</StudioPrimaryButton>
              <StudioPrimaryButton onClick={() => { const id = pendingProductId; setPendingProductId(null); if (id) onSelectProduct(id); }} testId="studio-switch-product-confirm-button">Trocar de produto</StudioPrimaryButton>
            </div>
          </div>
        )}

        <div role="tabpanel" id="studio-panel-photo" aria-labelledby="studio-tab-photo" hidden={step !== "photo"}>
          {step === "photo" && (
            <StudioPhotoStep
              products={products}
              productId={product.id}
              onSelectProduct={requestProduct}
              assets={assets}
              photo={state.doc?.photo ?? null}
              onPhotoChange={handlePhotoChange}
              showOriginal={showOriginal}
              onToggleShowOriginal={() => setShowOriginal((value) => !value)}
              onNext={() => setStep(nextStudioStep("photo"))}
            />
          )}
        </div>

        <div role="tabpanel" id="studio-panel-style" aria-labelledby="studio-tab-style" hidden={step !== "style"} className="space-y-4">
          {/* Sempre montado: o perfil carrega mesmo com outro passo aberto e alimenta as opções desde o início. */}
          <Suspense fallback={null}>
            <AdsProProfileCard className="mb-1" onProfileChange={setProfile} />
          </Suspense>
          {step === "style" && (
            <StudioStyleStep
              styleChoice={styleChoice}
              onStyleChoice={setStyleChoice}
              resolvedStyle={baseDirection?.primaryStyle ?? null}
              origin={styleOrigin}
              intent={intent}
              onIntent={setIntent}
              intensity={intensity}
              onIntensity={setIntensity}
              format={state.doc?.format ?? format}
              onFormat={handleFormat}
              facts={facts}
              onNext={() => setStep(nextStudioStep("style"))}
            />
          )}
        </div>

        <div role="tabpanel" id="studio-panel-options" aria-labelledby="studio-tab-options" hidden={step !== "options"}>
          {step === "options" && (
            <StudioOptionsStep
              variations={variations}
              chosenStyle={styleChoice === "profile" ? null : styleChoice}
              decorate={decorate}
              assetsFor={assetsFor}
              selectedId={state.selectedVariationId}
              staleVariations={state.staleVariations}
              hasPhoto={photoReady}
              onPick={handlePick}
              onMore={() => setRound((value) => value + 1)}
              onNext={() => setStep(nextStudioStep("options"))}
            />
          )}
        </div>

        <div role="tabpanel" id="studio-panel-background" aria-labelledby="studio-tab-background" hidden={step !== "background"}>
          {step === "background" && state.doc && (
            <StudioBackgroundStep
              suggestions={backgroundSuggestions}
              currentId={state.doc.background.id}
              format={state.doc.format}
              backgroundMissing={report?.backgroundMissing ?? false}
              staticStatus={backgroundImage.status}
              onPick={handleBackground}
              onNext={() => setStep(nextStudioStep("background"))}
            />
          )}
        </div>

        <div role="tabpanel" id="studio-panel-edit" aria-labelledby="studio-tab-edit" hidden={step !== "edit"}>
          {step === "edit" && state.doc && (
            <StudioEditStep
              doc={state.doc}
              facts={facts}
              hasLogo={assets.logo !== null}
              canUndo={state.past.length > 0}
              canRedo={state.future.length > 0}
              onUndo={() => dispatch({ type: "undo" })}
              onRedo={() => dispatch({ type: "redo" })}
              onText={handleText}
              onVisibility={handleVisibility}
              onRestoreText={handleRestoreText}
              onArchetype={handleArchetype}
              onDirection={handleDirection}
              report={report}
              onNext={() => setStep(nextStudioStep("edit"))}
            />
          )}
        </div>

        <div role="tabpanel" id="studio-panel-save" aria-labelledby="studio-tab-save" hidden={step !== "save"}>
          {step === "save" && (
            <>
              {confirmNew && (
                <div className="mb-3">
                  <StudioBanner tone="warning" testId="studio-new-confirm">Há alterações não salvas. Toque em “Novo anúncio” de novo para descartar e recomeçar.</StudioBanner>
                </div>
              )}
              <StudioSaveStep
                canExport={canExport}
                exportBlockedReason={exportBlockedReason}
                size={exportSize}
                unsaved={unsaved}
                hasSaved={remoteExistsRef.current}
                busy={busy}
                feedback={feedback}
                projects={projects}
                onSave={() => void handleSave()}
                onDownload={() => void handleDownload()}
                onShare={() => void handleShare()}
                onNewProject={handleNewProject}
                onOpenProject={handleOpenProject}
              />
            </>
          )}
        </div>
      </div>

      <Dialog open={zoomOpen} onOpenChange={setZoomOpen}>
        <DialogContent className="max-w-xl" data-testid="studio-zoom-dialog">
          <DialogHeader>
            <DialogTitle>Prévia ampliada</DialogTitle>
            <DialogDescription>É assim que o anúncio sai no PNG exportado.</DialogDescription>
          </DialogHeader>
          {zoomOpen && deferredDoc && previewAssets && (
            <div className="flex justify-center">
              <AdsProStudioCanvas doc={deferredDoc} assets={previewAssets} renderWidth={Math.min(900, getAdsProCanvasSize(deferredDoc.format).width)} ariaLabel={`Prévia ampliada do anúncio de ${product.name}`} testId="studio-canvas-zoom" maxHeight="70dvh" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
