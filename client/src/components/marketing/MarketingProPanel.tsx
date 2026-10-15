import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eraser, ImagePlus, Sparkles } from "lucide-react";
import { useLocation } from "wouter";
import { canUseFeature } from "@shared/monetization";
import { usePlan } from "@/providers/PlanProvider";
import { getFirebaseAuth } from "@/lib/firebase";
import { getProductImage, type Product } from "@/lib/mock-data";
import type { MarketingProStyle } from "@/lib/marketing-pro";
import { prepareMarketingProPreview } from "@/lib/marketing-pro-compositor";
import { MarketingProPreview } from "./MarketingProPreview";
import { useFeatureEnabled } from "@/lib/remote-config-context";
import { MarketingProCutoutPreservationError, type PremiumCreativeFamily } from "@shared/marketing-pro-creative-v2";
import { prepareMarketingProCreativeV2, readApprovedProductCutoutSource } from "@/lib/marketing-pro-creative-v2";
import { MarketingProCreativeV2Preview } from "./MarketingProCreativeV2Preview";
import { resolveMarketingImageSource } from "@/lib/marketing-image";
import {
  generateProductCutoutRgba,
  renderCutoutRgbaToPngBlob,
  saveApprovedProductCutout,
  type ProductCutoutGenerationResult,
} from "@/lib/product-cutout-pipeline";
import type { ApprovedProductCutout } from "@shared/approved-product-cutout";
import {
  composeMarketingProRealBackgroundPreview,
  canvasToPngBlob,
} from "@/lib/marketing-pro-real-background-composer";
import { CreativeProfileOnboarding } from "./CreativeProfileOnboarding";
// ADS-PRO-FINAL: o estúdio (foto → estilo → opções → fundo → edição → salvar/exportar/compartilhar) é o fluxo
// principal do Anúncio Pro. Fica num chunk próprio: só é baixado quando o painel Pro abre para quem tem acesso.
const AdsProStudio = lazy(() =>
  import("@/components/marketing/ads-pro-studio/AdsProStudio").then((m) => ({ default: m.AdsProStudio }))
);
import {
  getCreativeProfile,
  saveCreativeProfile,
  cacheCreativeProfileLocally,
  readCachedCreativeProfile,
  markCreativeProfileOnboardingSkipped,
  wasCreativeProfileOnboardingSkipped,
} from "@/lib/creative-profile-service";
import { mapSellerProfileToOnboardingAnswers, type CreativeProfileWizardAnswers } from "@/lib/creative-profile-mapper";
import type { SellerCreativeProfile } from "@shared/marketing-pro-creative-intelligence";
import { CreativeConceptsSection } from "./CreativeConceptsSection";
import {
  createMarketingProGenerationRequestId,
  generateMarketingProBackgroundAndWait,
  type MarketingProGenerationDto,
} from "@/lib/marketing-pro-real-background";

const CREATIVE_FAMILY_LABELS: Record<PremiumCreativeFamily, string> = {
  luxury: "Luxo",
  editorial: "Editorial",
  modern: "Moderno",
};

type CutoutReadyResult = Extract<ProductCutoutGenerationResult, { ok: true }>;

type CutoutToolState =
  | { readonly phase: "idle" }
  | { readonly phase: "generating" }
  | { readonly phase: "preview"; readonly ready: CutoutReadyResult; readonly previewUrl: string; readonly pngBlob: Blob }
  | { readonly phase: "saving"; readonly previewUrl: string }
  | { readonly phase: "saved" }
  | { readonly phase: "error"; readonly message: string };

type RealBackgroundToolState =
  | { readonly phase: "idle" }
  | { readonly phase: "generating" }
  | { readonly phase: "preview"; readonly previewUrl: string; readonly pngBlob: Blob }
  | { readonly phase: "applied"; readonly previewUrl: string }
  | { readonly phase: "error"; readonly message: string };

const REAL_BACKGROUND_ERROR_MESSAGES: Record<string, string> = {
  PRO_ADS_REQUIRED: "Anúncios Pro requer o plano Premium.",
  BUDGET_EXCEEDED: "O gerador de fundos com IA está indisponível no momento. Tente novamente mais tarde.",
  GENERATION_TIMEOUT: "O gerador demorou demais para responder. Tente novamente.",
  GENERATION_FAILED: "Não foi possível gerar o fundo agora. Tente novamente.",
};

const CUTOUT_FAILURE_MESSAGES: Record<string, string> = {
  "no-image": "Este produto não tem foto cadastrada.",
  "load-failed": "Não foi possível carregar a foto deste produto.",
  "decode-failed": "Não foi possível processar esta foto.",
  "background-not-detected": "Não conseguimos identificar um fundo uniforme para remover nesta foto. Funciona melhor com fotos em fundo liso.",
  "compose-rejected": "A remoção de fundo não passou na validação de preservação do produto — nada foi alterado.",
};

const PRO_STYLE_LABELS: Record<MarketingProStyle, string> = {
  luxury: "Luxo",
  editorial: "Editorial",
  minimal: "Minimalista",
  sensory: "Sensorial",
  modern: "Moderno",
};

type MarketingProPanelProps = {
  products?: Product[];
  storeName?: string;
  storeLogoUrl?: string;
  primaryColor?: string;
};

function readProductVolume(product: Product): string | undefined {
  const extras = product.extras || {};
  const value = extras.volume ?? extras.volumeText ?? extras.size ?? extras.unit;
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function readProductBenefits(product: Product): string[] {
  const extras = product.extras || {};
  const values = extras.benefits ?? extras.attributes;
  return Array.isArray(values)
    ? values.filter((value: unknown): value is string => typeof value === "string")
    : [];
}

export function MarketingProPanel({ products = [], storeName = "Minha loja", storeLogoUrl, primaryColor }: MarketingProPanelProps) {
  const [, setLocation] = useLocation();
  const { activePlan, loading: planLoading } = usePlan();
  const proAdsEnabled = canUseFeature(activePlan, "proAds");
  const accessState = planLoading ? "loading" : proAdsEnabled ? "entitled" : "free";
  // Composer Premium V2 (PRO-07J): flag OFF ou plano Free -> nunca entra neste caminho, o comportamento
  // atual (demo em MarketingProPreview) continua idêntico. Free nunca vê esta seção, mesmo com a flag ON.
  const creativeV2Enabled = useFeatureEnabled("marketing_pro_creative_v2_enabled");
  // PRO-08: só controla visibilidade do botão — o backend (flag + entitlement + credencial) é a
  // autoridade real. Ver comentário do flag em client/src/lib/remote-config.ts.
  const realBackgroundEnabled = useFeatureEnabled("marketing_pro_real_background_enabled");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedStyle, setSelectedStyle] = useState<MarketingProStyle>("luxury");
  const [selectedCreativeFamily, setSelectedCreativeFamily] = useState<PremiumCreativeFamily>("luxury");
  // PRO-07: "Remover fundo" real (§2 da tarefa). Estado por produto para não misturar preview de um
  // produto com o resultado de outro se o usuário trocar o select no meio do processo.
  const [cutoutToolState, setCutoutToolState] = useState<CutoutToolState>({ phase: "idle" });
  const [savedCutoutOverride, setSavedCutoutOverride] = useState<Map<string, ApprovedProductCutout>>(new Map());
  const cutoutBusyRef = useRef(false);
  // PRO-08: geração real de fundo, por produto. Nunca inicia sem approvedCutoutSource (fail closed, §9).
  const [realBackgroundToolState, setRealBackgroundToolState] = useState<RealBackgroundToolState>({ phase: "idle" });
  const realBackgroundBusyRef = useRef(false);

  // PRO-10B — "Vamos descobrir seu estilo": onboarding do Perfil Criativo (SellerCreativeProfile,
  // shared/marketing-pro-creative-intelligence.ts). O SERVIDOR é canônico (§11 da tarefa) — o cache
  // local (`creative-profile-service.ts`) só existe como fallback de exibição quando o GET falha,
  // nunca como autoridade de gating. Free nunca chega aqui: todo este bloco só roda dentro de
  // `{proAdsEnabled && ...}` mais abaixo, e o efeito de carregamento também checa `proAdsEnabled`.
  type CreativeProfilePanelState =
    | { readonly status: "loading" }
    | { readonly status: "none" }
    | { readonly status: "profile"; readonly profile: SellerCreativeProfile }
    | { readonly status: "unavailable" };
  const [creativeProfileState, setCreativeProfileState] = useState<CreativeProfilePanelState>({ status: "loading" });
  const [creativeProfileOnboardingOpen, setCreativeProfileOnboardingOpen] = useState(false);
  const [creativeProfileInitialAnswers, setCreativeProfileInitialAnswers] = useState<CreativeProfileWizardAnswers | undefined>(undefined);
  const creativeProfileUidRef = useRef<string | null>(null);

  useEffect(() => {
    if (!proAdsEnabled) return;
    const uid = getFirebaseAuth()?.currentUser?.uid;
    if (!uid) return;
    creativeProfileUidRef.current = uid;
    let cancelled = false;
    (async () => {
      try {
        const profile = await getCreativeProfile();
        if (cancelled) return;
        cacheCreativeProfileLocally(uid, profile);
        if (profile) {
          setCreativeProfileState({ status: "profile", profile });
        } else {
          setCreativeProfileState({ status: "none" });
          // §9: Premium sem profile existente abre sozinho — a menos que já tenha pulado antes (evita loop irritante).
          if (!wasCreativeProfileOnboardingSkipped(uid)) setCreativeProfileOnboardingOpen(true);
        }
      } catch {
        if (cancelled) return;
        // §12: GET falhou — nunca apaga o que já sabíamos. Um cache com perfil existente vira exibição de
        // fallback (e NUNCA abre o onboarding sozinho, para não repetir uma pergunta já respondida antes
        // só porque a rede falhou agora). Sem cache nenhum, mostra "indisponível" e também não abre sozinho.
        const cached = readCachedCreativeProfile(uid);
        setCreativeProfileState(cached?.profile ? { status: "profile", profile: cached.profile } : { status: "unavailable" });
      }
    })();
    return () => { cancelled = true; };
  }, [proAdsEnabled]);

  const handleCreativeProfileComplete = useCallback(async (profile: SellerCreativeProfile): Promise<boolean> => {
    const uid = creativeProfileUidRef.current;
    if (!uid) return false;
    try {
      const saved = await saveCreativeProfile(profile);
      cacheCreativeProfileLocally(uid, saved);
      setCreativeProfileState({ status: "profile", profile: saved });
      return true;
    } catch {
      // §12: SAVE falhou — nunca marca como concluído, nunca mexe no estado já exibido.
      return false;
    }
  }, []);

  const handleCreativeProfileClose = useCallback(() => {
    setCreativeProfileOnboardingOpen(false);
    setCreativeProfileInitialAnswers(undefined);
    const uid = creativeProfileUidRef.current;
    setCreativeProfileState((current) => {
      // Fechar sem concluir só conta como "pulei" quando ainda não existia perfil nenhum — fechar no
      // meio de uma EDIÇÃO nunca apaga/reclassifica o perfil que já existia (§10).
      if (current.status !== "profile" && uid) markCreativeProfileOnboardingSkipped(uid);
      return current;
    });
  }, []);

  const handleCreativeProfileEdit = useCallback(() => {
    setCreativeProfileState((current) => {
      if (current.status === "profile") setCreativeProfileInitialAnswers(mapSellerProfileToOnboardingAnswers(current.profile));
      return current;
    });
    setCreativeProfileOnboardingOpen(true);
  }, []);

  const handleCreativeProfileRetake = useCallback(() => {
    // §10: "refazer" NUNCA apaga o perfil server-side antes da conclusão — só reabre o wizard do zero.
    // Se o usuário cancelar no meio, o perfil anterior (se houver) continua intacto no servidor.
    setCreativeProfileInitialAnswers(undefined);
    setCreativeProfileOnboardingOpen(true);
  }, []);
  const previewProducts = useMemo(
    () => [...products]
      .sort((first, second) => Number(second.stock > 0) - Number(first.stock > 0)),
    [products],
  );
  const selectedProduct = previewProducts.find((product) => product.id === selectedProductId) || previewProducts[0];

  useEffect(() => {
    if (!selectedProductId || !previewProducts.some((product) => product.id === selectedProductId)) {
      setSelectedProductId(previewProducts[0]?.id || "");
    }
  }, [previewProducts, selectedProductId]);

  // Trocar de produto descarta qualquer preview de recorte pendente do produto anterior — nunca aplica
  // o resultado de um produto na foto de outro.
  useEffect(() => {
    setCutoutToolState((current) => {
      if (current.phase === "preview" || current.phase === "saving") URL.revokeObjectURL(current.previewUrl);
      return { phase: "idle" };
    });
  }, [selectedProductId]);

  useEffect(() => () => {
    setCutoutToolState((current) => {
      if (current.phase === "preview" || current.phase === "saving") URL.revokeObjectURL(current.previewUrl);
      return current;
    });
  }, []);

  const handleGenerateCutout = useCallback(async () => {
    if (!selectedProduct || !proAdsEnabled || cutoutBusyRef.current) return;
    const imageUrl = getProductImage(selectedProduct);
    if (!imageUrl) {
      setCutoutToolState({ phase: "error", message: CUTOUT_FAILURE_MESSAGES["no-image"] });
      return;
    }
    cutoutBusyRef.current = true;
    setCutoutToolState({ phase: "generating" });
    try {
      const resolved = await resolveMarketingImageSource({ productImageUrl: imageUrl });
      if (!resolved) {
        setCutoutToolState({ phase: "error", message: CUTOUT_FAILURE_MESSAGES["load-failed"] });
        return;
      }
      const result = await generateProductCutoutRgba(selectedProduct.id, resolved);
      if (!result.ok) {
        setCutoutToolState({ phase: "error", message: CUTOUT_FAILURE_MESSAGES[result.reason] || "Não foi possível remover o fundo desta foto." });
        return;
      }
      const pngBlob = await renderCutoutRgbaToPngBlob(result.composed.rgba, result.width, result.height);
      if (!pngBlob) {
        setCutoutToolState({ phase: "error", message: "Não foi possível gerar o arquivo da imagem recortada." });
        return;
      }
      const previewUrl = URL.createObjectURL(pngBlob);
      setCutoutToolState({ phase: "preview", ready: result, previewUrl, pngBlob });
    } catch {
      setCutoutToolState({ phase: "error", message: "Falha inesperada ao remover o fundo. Tente novamente." });
    } finally {
      cutoutBusyRef.current = false;
    }
  }, [proAdsEnabled, selectedProduct]);

  const handleUndoCutout = useCallback(() => {
    setCutoutToolState((current) => {
      if (current.phase === "preview" || current.phase === "saving") URL.revokeObjectURL(current.previewUrl);
      return { phase: "idle" };
    });
  }, []);

  const handleSaveCutout = useCallback(async () => {
    if (cutoutToolState.phase !== "preview" || cutoutBusyRef.current || !selectedProduct) return;
    const { ready, pngBlob, previewUrl } = cutoutToolState;
    cutoutBusyRef.current = true;
    setCutoutToolState({ phase: "saving", previewUrl });
    try {
      const auth = getFirebaseAuth();
      const user = auth?.currentUser;
      if (!user) throw new Error("not-authenticated");
      const token = await user.getIdToken();
      const cutout = await saveApprovedProductCutout({
        uid: user.uid,
        productId: selectedProduct.id,
        pngBlob,
        token,
        composed: ready.composed,
        sourceAssetId: ready.assetId,
      });
      URL.revokeObjectURL(previewUrl);
      setSavedCutoutOverride((current) => new Map(current).set(selectedProduct.id, cutout));
      setCutoutToolState({ phase: "saved" });
    } catch {
      setCutoutToolState({ phase: "error", message: "Não foi possível salvar o recorte agora. Tente novamente." });
    } finally {
      cutoutBusyRef.current = false;
    }
  }, [cutoutToolState, selectedProduct]);

  const previewPreparation = useMemo(() => {
    if (!selectedProduct) return null;
    const previousPrice = selectedProduct.extras?.previousPrice ?? selectedProduct.extras?.originalPrice;
    return prepareMarketingProPreview({
      store: { name: storeName, logoUrl: storeLogoUrl, primaryColor },
      product: {
        id: selectedProduct.id,
        name: selectedProduct.name,
        category: selectedProduct.category,
        imageUrl: getProductImage(selectedProduct) || undefined,
        brand: selectedProduct.brand,
        volume: readProductVolume(selectedProduct),
        description: selectedProduct.description,
      },
      offer: {
        currentPrice: selectedProduct.salePrice,
        previousPrice,
        discountPercent: selectedProduct.discountPercent,
        availability: selectedProduct.stock > 0 ? "available" : "unavailable",
      },
      benefits: readProductBenefits(selectedProduct),
      cta: { label: "Ver no catálogo", action: "catalog" },
      format: "portrait",
      style: selectedStyle,
    });
  }, [primaryColor, selectedProduct, selectedStyle, storeLogoUrl, storeName]);

  // §3/§10: só existe payload V2 quando o PRÓPRIO produto declara um cutout já aprovado
  // (`product.approvedCutout`, PRO-07K) — nenhum produto do catálogo declara isso hoje (nenhum fluxo
  // real escreve esse campo ainda), então este caminho fica sempre inativo em produção, mesmo com a
  // flag ON. Nunca lê disco local, nunca inventa dado sobre o produto.
  // PRO-07: se acabamos de salvar um cutout nesta sessão (savedCutoutOverride), usa ele antes de
  // esperar `selectedProduct.approvedCutout` vir de uma releitura completa da lista de produtos —
  // "Trocar fundo" aparece imediatamente depois de "Usar no anúncio", sem exigir refresh da página.
  const approvedCutoutSource = selectedProduct
    ? savedCutoutOverride.get(selectedProduct.id) ?? readApprovedProductCutoutSource(selectedProduct)
    : undefined;

  // PRO-08: gerar fundo real com IA e compor localmente sobre o cutout já aprovado.
  const handleGenerateRealBackground = useCallback(async () => {
    // Fail closed (§9 da tarefa): sem approvedCutoutSource não existe composição possível.
    if (!selectedProduct || !approvedCutoutSource || realBackgroundBusyRef.current) return;
    realBackgroundBusyRef.current = true;
    setRealBackgroundToolState({ phase: "generating" });
    try {
      const dto: MarketingProGenerationDto = await generateMarketingProBackgroundAndWait({
        generationRequestId: createMarketingProGenerationRequestId(),
        productId: selectedProduct.id,
        style: selectedCreativeFamily,
        format: "portrait",
      });
      if (dto.status !== "ready" || !dto.background) {
        const message = (dto.errorCode && REAL_BACKGROUND_ERROR_MESSAGES[dto.errorCode]) || "Não foi possível gerar o fundo agora. Tente novamente.";
        setRealBackgroundToolState({ phase: "error", message });
        return;
      }
      const canvas = await composeMarketingProRealBackgroundPreview({
        backgroundImageSrc: dto.background.backgroundDownloadUrl || dto.background.backgroundAssetPath,
        cutoutImageSrc: approvedCutoutSource.downloadUrl || approvedCutoutSource.storagePath,
        format: "portrait",
      });
      const pngBlob = await canvasToPngBlob(canvas);
      if (!pngBlob) {
        setRealBackgroundToolState({ phase: "error", message: "Não foi possível gerar a prévia da composição." });
        return;
      }
      const previewUrl = URL.createObjectURL(pngBlob);
      setRealBackgroundToolState({ phase: "preview", previewUrl, pngBlob });
    } catch {
      setRealBackgroundToolState({ phase: "error", message: "Falha inesperada ao gerar o fundo. Tente novamente." });
    } finally {
      realBackgroundBusyRef.current = false;
    }
  }, [approvedCutoutSource, selectedCreativeFamily, selectedProduct]);

  const handleApplyRealBackground = useCallback(() => {
    setRealBackgroundToolState((current) => (current.phase === "preview" ? { phase: "applied", previewUrl: current.previewUrl } : current));
  }, []);

  const handleUndoRealBackground = useCallback(() => {
    setRealBackgroundToolState((current) => {
      if (current.phase === "preview" || current.phase === "applied") URL.revokeObjectURL(current.previewUrl);
      return { phase: "idle" };
    });
  }, []);

  // Trocar de produto descarta qualquer resultado pendente do produto anterior.
  useEffect(() => {
    setRealBackgroundToolState((current) => {
      if (current.phase === "preview" || current.phase === "applied") URL.revokeObjectURL(current.previewUrl);
      return { phase: "idle" };
    });
  }, [selectedProductId]);

  useEffect(() => () => {
    setRealBackgroundToolState((current) => {
      if (current.phase === "preview" || current.phase === "applied") URL.revokeObjectURL(current.previewUrl);
      return current;
    });
  }, []);

  const creativeV2Preparation = useMemo(() => {
    if (!creativeV2Enabled || !proAdsEnabled || !selectedProduct || !approvedCutoutSource) return null;
    try {
      const payload = prepareMarketingProCreativeV2({
        cutout: approvedCutoutSource,
        explicitFamily: selectedCreativeFamily,
        commercial: {
          store: { name: storeName, logoUrl: storeLogoUrl, primaryColor },
          product: { id: selectedProduct.id, name: selectedProduct.name, category: selectedProduct.category, brand: selectedProduct.brand },
          offer: { currentPrice: selectedProduct.salePrice, availability: selectedProduct.stock > 0 ? "available" : "unavailable" },
          benefits: readProductBenefits(selectedProduct),
          cta: { label: "Ver no catálogo", action: "catalog" },
        },
      });
      return { state: "ready" as const, payload };
    } catch (error) {
      // Erro de preservação P0 NUNCA é mascarado: nenhum fallback troca o produto por outro asset.
      return { state: "failed" as const, error: error instanceof MarketingProCutoutPreservationError ? error : new Error("creative-v2-prepare-failed") };
    }
  }, [approvedCutoutSource, creativeV2Enabled, primaryColor, proAdsEnabled, selectedCreativeFamily, selectedProduct, storeLogoUrl, storeName]);

  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3"
      data-testid="marketing-pro-panel"
      data-pro-ads-state={accessState}
    >
      <div className="rounded-2xl border border-border/60 bg-white p-3.5 shadow-sm">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-black text-foreground">Anúncio Pro</h2>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-primary">Pro</span>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Crie anúncios com mais possibilidades de personalização e acabamento profissional.
        </p>
        {planLoading ? (
          <p className="mt-3 text-xs font-semibold text-muted-foreground" data-testid="marketing-pro-access-loading" aria-live="polite">
            Verificando acesso...
          </p>
        ) : proAdsEnabled ? (
          <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700" data-testid="marketing-pro-access-status" aria-live="polite">
            Seu plano inclui Anúncios Pro
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setLocation("/subscribe")}
            className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-xs font-black text-white shadow-sm transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:scale-[0.98]"
            data-testid="button-marketing-pro-upgrade"
          >
            <Sparkles className="h-4 w-4" />
            Conhecer Premium
          </button>
        )}
      </div>

      {proAdsEnabled && (
        <Suspense fallback={<p className="text-xs font-semibold text-muted-foreground" role="status" data-testid="marketing-pro-studio-loading">Carregando o estúdio...</p>}>
          <AdsProStudio
            products={previewProducts}
            selectedProductId={selectedProduct?.id ?? ""}
            onSelectProduct={setSelectedProductId}
            branding={{ storeName, storeLogoUrl, primaryColor }}
          />
        </Suspense>
      )}

      {creativeProfileOnboardingOpen && (
        <CreativeProfileOnboarding
          onClose={handleCreativeProfileClose}
          onSkip={handleCreativeProfileClose}
          onComplete={handleCreativeProfileComplete}
          initialAnswers={creativeProfileInitialAnswers}
        />
      )}

      {proAdsEnabled && (
        <details className="min-w-0 rounded-2xl border border-border/60 bg-white p-3.5 shadow-sm" data-testid="marketing-pro-advanced">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-black text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            Ferramentas avançadas e experimentais
          </summary>
          <div className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
              {proAdsEnabled && creativeProfileState.status !== "loading" && (
                <div className="min-w-0 rounded-2xl border border-primary/20 bg-primary/[0.04] p-3.5" data-testid="marketing-pro-creative-profile-entry">
                  {creativeProfileState.status === "profile" ? (
                    <>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-black text-foreground">Perfil criativo</h3>
                          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                            Pronto — usado como ponto de partida das suas próximas criações.
                          </p>
                        </div>
                        <span className="rounded-full bg-emerald-100 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-emerald-700">pronto</span>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={handleCreativeProfileEdit}
                          className="min-h-11 flex-1 rounded-xl border border-primary/30 bg-white text-xs font-black text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          data-testid="button-creative-profile-entry-edit"
                        >
                          Editar preferências
                        </button>
                        <button
                          type="button"
                          onClick={handleCreativeProfileRetake}
                          className="min-h-11 flex-1 rounded-xl border border-border bg-white text-xs font-black text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          data-testid="button-creative-profile-entry-retake"
                        >
                          Refazer teste de estilo
                        </button>
                      </div>
                    </>
                  ) : creativeProfileState.status === "unavailable" ? (
                    <>
                      <h3 className="text-sm font-black text-foreground">Perfil criativo</h3>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground" role="status" data-testid="text-creative-profile-unavailable">
                        Não foi possível carregar seu perfil criativo agora. Tente novamente em instantes.
                      </p>
                    </>
                  ) : (
                    <>
                      <h3 className="text-sm font-black text-foreground">Perfil criativo</h3>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                        Vamos descobrir seu estilo antes da primeira geração — leva menos de um minuto.
                      </p>
                      <button
                        type="button"
                        onClick={() => setCreativeProfileOnboardingOpen(true)}
                        className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-xs font-black text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        data-testid="button-creative-profile-entry-start"
                      >
                        <Sparkles className="h-4 w-4" />
                        Descobrir meu estilo
                      </button>
                    </>
                  )}
                </div>
              )}

              {proAdsEnabled && selectedProduct && (
                <CreativeConceptsSection
                  product={selectedProduct}
                  approvedCutoutSource={approvedCutoutSource}
                  realBackgroundEnabled={realBackgroundEnabled}
                  branding={{ storeName, storeLogoUrl, primaryColor }}
                />
              )}

              {proAdsEnabled && (
                <div className="min-w-0 rounded-2xl border border-primary/20 bg-primary/[0.04] p-3.5" data-testid="marketing-pro-local-demo">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-black text-foreground">Prévia de estilo</h3>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                        Composição local determinística para demonstrar a direção visual 4:5. Nenhuma imagem é gerada por IA.
                      </p>
                    </div>
                    <span className="rounded-full bg-primary/10 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-primary">
                      demonstração
                    </span>
                  </div>

                  {previewProducts.length > 0 ? (
                    <>
                      <label className="mt-3 block text-[11px] font-bold text-foreground" htmlFor="marketing-pro-preview-product">
                        Produto
                      </label>
                      <select
                        id="marketing-pro-preview-product"
                        value={selectedProduct?.id || ""}
                        onChange={(event) => setSelectedProductId(event.target.value)}
                        className="mt-1 min-h-11 w-full rounded-xl border border-border bg-background px-3 text-xs font-semibold text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-primary"
                        data-testid="marketing-pro-preview-product"
                      >
                        {previewProducts.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                          </option>
                        ))}
                      </select>

                      <div className="mt-3" role="group" aria-label="Estilo da prévia Pro" data-testid="marketing-pro-preview-styles">
                        <p className="text-[11px] font-bold text-foreground">Estilo</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {(Object.keys(PRO_STYLE_LABELS) as MarketingProStyle[]).map((styleId) => {
                            const selected = selectedStyle === styleId;
                            return (
                              <button
                                key={styleId}
                                type="button"
                                aria-pressed={selected}
                                onClick={() => setSelectedStyle(styleId)}
                                className={`min-h-9 rounded-full border px-3 text-[10px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:border-primary/50"}`}
                                data-testid={`marketing-pro-style-${styleId}`}
                              >
                                {PRO_STYLE_LABELS[styleId]}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="mt-3 min-w-0" data-testid="marketing-pro-preview-output">
                        {previewPreparation?.state === "ready" ? (
                          <MarketingProPreview model={previewPreparation.model} />
                        ) : (
                          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800" role="status">
                            {previewPreparation?.error.message || "Não foi possível preparar esta prévia."}
                          </p>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="mt-3 rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-semibold text-muted-foreground" role="status">
                      {products.length === 0
                        ? "Cadastre um produto para começar um anúncio."
                        : "Este produto ainda não tem foto para a prévia. Você pode criar conceitos e adicionar a foto depois."}
                    </p>
                  )}
                </div>
              )}

              {proAdsEnabled && selectedProduct && (
                <div className="min-w-0 rounded-2xl border border-primary/20 bg-primary/[0.04] p-3.5" data-testid="marketing-pro-cutout-tool">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-black text-foreground">Remover fundo</h3>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                        Separa o produto do cenário original desta foto. Funciona melhor com fundo liso/uniforme. O produto nunca é redesenhado.
                      </p>
                    </div>
                  </div>

                  {cutoutToolState.phase === "idle" && (
                    <button
                      type="button"
                      onClick={handleGenerateCutout}
                      className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-white px-4 text-xs font-black text-primary transition hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      data-testid="button-cutout-generate"
                    >
                      <Eraser className="h-4 w-4" />
                      Remover fundo desta foto
                    </button>
                  )}

                  {cutoutToolState.phase === "generating" && (
                    <p className="mt-3 rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-semibold text-muted-foreground" role="status" aria-live="polite" data-testid="text-cutout-generating">
                      Removendo o fundo...
                    </p>
                  )}

                  {(cutoutToolState.phase === "preview" || cutoutToolState.phase === "saving") && (
                    <div className="mt-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="min-w-0">
                          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Antes</p>
                          <div className="aspect-square overflow-hidden rounded-xl border border-border/60 bg-white">
                            <img src={getProductImage(selectedProduct) || ""} alt="Foto original do produto" className="h-full w-full object-contain" />
                          </div>
                        </div>
                        <div className="min-w-0">
                          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Depois</p>
                          <div
                            className="aspect-square overflow-hidden rounded-xl border border-border/60"
                            style={{ backgroundImage: "conic-gradient(#e5e7eb 90deg, #fff 90deg 180deg, #e5e7eb 180deg 270deg, #fff 270deg)", backgroundSize: "16px 16px" }}
                          >
                            <img src={cutoutToolState.previewUrl} alt="Produto com fundo removido" className="h-full w-full object-contain" data-testid="img-cutout-preview" />
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={handleUndoCutout}
                          disabled={cutoutToolState.phase === "saving"}
                          className="min-h-11 flex-1 rounded-xl border border-border bg-white text-xs font-black text-muted-foreground disabled:opacity-50"
                          data-testid="button-cutout-undo"
                        >
                          Desfazer
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveCutout}
                          disabled={cutoutToolState.phase === "saving"}
                          className="min-h-11 flex-1 rounded-xl bg-primary text-xs font-black text-primary-foreground disabled:opacity-60"
                          data-testid="button-cutout-save"
                        >
                          {cutoutToolState.phase === "saving" ? "Salvando..." : "Usar no anúncio"}
                        </button>
                      </div>
                    </div>
                  )}

                  {cutoutToolState.phase === "saved" && (
                    <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700" role="status" data-testid="text-cutout-saved">
                      Recorte salvo neste produto.
                      <button type="button" onClick={handleGenerateCutout} className="ml-2 underline">Gerar novamente</button>
                    </div>
                  )}

                  {cutoutToolState.phase === "error" && (
                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700" role="alert" data-testid="text-cutout-error">
                      {cutoutToolState.message}
                      <button type="button" onClick={handleUndoCutout} className="ml-2 underline">Fechar</button>
                    </div>
                  )}
                </div>
              )}

              {creativeV2Enabled && proAdsEnabled && approvedCutoutSource && (
                <div className="min-w-0 rounded-2xl border border-primary/20 bg-primary/[0.04] p-3.5" data-testid="marketing-pro-creative-v2-section">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-black text-foreground">Composer Premium V2</h3>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                        Direção de arte avançada sobre o cutout já aprovado deste produto. O produto nunca é redesenhado.
                      </p>
                    </div>
                    <span className="rounded-full bg-primary/10 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-primary">beta</span>
                  </div>

                  <div className="mt-3" role="group" aria-label="Fundo do anúncio" data-testid="marketing-pro-creative-v2-family">
                    <p className="text-[11px] font-bold text-foreground">Trocar fundo</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {(Object.keys(CREATIVE_FAMILY_LABELS) as PremiumCreativeFamily[]).map((familyId) => {
                        const selected = selectedCreativeFamily === familyId;
                        return (
                          <button
                            key={familyId}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => setSelectedCreativeFamily(familyId)}
                            className={`min-h-9 rounded-full border px-3 text-[10px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:border-primary/50"}`}
                            data-testid={`marketing-pro-creative-family-${familyId}`}
                          >
                            {CREATIVE_FAMILY_LABELS[familyId]}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-3">
                    {creativeV2Preparation?.state === "ready" ? (
                      <MarketingProCreativeV2Preview payload={creativeV2Preparation.payload} productImageSrc={approvedCutoutSource.downloadUrl || approvedCutoutSource.storagePath} />
                    ) : (
                      <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800" role="status">
                        Este cutout aprovado não pôde ser preparado para o Composer V2.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {realBackgroundEnabled && proAdsEnabled && selectedProduct && (
                <div className="min-w-0 rounded-2xl border border-primary/20 bg-primary/[0.04] p-3.5" data-testid="marketing-pro-real-background-tool">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-black text-foreground">Gerar fundo com IA</h3>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                        Cria um cenário de fundo com IA e compõe localmente com o recorte já aprovado deste produto. Só o fundo é gerado — o produto nunca é enviado nem redesenhado.
                      </p>
                    </div>
                    <span className="rounded-full bg-primary/10 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-primary">beta</span>
                  </div>

                  {!approvedCutoutSource ? (
                    <p className="mt-3 rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-semibold text-muted-foreground" role="status">
                      Gere e salve um recorte em "Remover fundo" antes de gerar um fundo com IA.
                    </p>
                  ) : (
                    <>
                      {realBackgroundToolState.phase === "idle" && (
                        <button
                          type="button"
                          onClick={handleGenerateRealBackground}
                          className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-white px-4 text-xs font-black text-primary transition hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          data-testid="button-real-background-generate"
                        >
                          <ImagePlus className="h-4 w-4" />
                          Gerar fundo
                        </button>
                      )}

                      {realBackgroundToolState.phase === "generating" && (
                        <p className="mt-3 rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-semibold text-muted-foreground" role="status" aria-live="polite" data-testid="text-real-background-generating">
                          Gerando o fundo...
                        </p>
                      )}

                      {(realBackgroundToolState.phase === "preview" || realBackgroundToolState.phase === "applied") && (
                        <div className="mt-3">
                          <div className="aspect-[4/5] max-h-72 overflow-hidden rounded-xl border border-border/60 bg-white">
                            <img src={realBackgroundToolState.previewUrl} alt="Prévia do anúncio com fundo gerado por IA" className="h-full w-full object-contain" data-testid="img-real-background-preview" />
                          </div>
                          {realBackgroundToolState.phase === "preview" ? (
                            <div className="mt-3 flex gap-2">
                              <button
                                type="button"
                                onClick={handleUndoRealBackground}
                                className="min-h-11 flex-1 rounded-xl border border-border bg-white text-xs font-black text-muted-foreground"
                                data-testid="button-real-background-undo"
                              >
                                Desfazer
                              </button>
                              <button
                                type="button"
                                onClick={handleGenerateRealBackground}
                                className="min-h-11 flex-1 rounded-xl border border-border bg-white text-xs font-black text-muted-foreground"
                                data-testid="button-real-background-retry"
                              >
                                Tentar novamente
                              </button>
                              <button
                                type="button"
                                onClick={handleApplyRealBackground}
                                className="min-h-11 flex-1 rounded-xl bg-primary text-xs font-black text-primary-foreground"
                                data-testid="button-real-background-apply"
                              >
                                Aplicar
                              </button>
                            </div>
                          ) : (
                            <div className="mt-3 flex items-center gap-2">
                              <p className="flex-1 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700" role="status" data-testid="text-real-background-applied">
                                Fundo aplicado nesta prévia.
                              </p>
                              <button type="button" onClick={handleUndoRealBackground} className="min-h-11 rounded-xl border border-border bg-white px-4 text-xs font-black text-muted-foreground" data-testid="button-real-background-undo-applied">
                                Desfazer
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {realBackgroundToolState.phase === "error" && (
                        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700" role="alert" data-testid="text-real-background-error">
                          {realBackgroundToolState.message}
                          <button type="button" onClick={handleUndoRealBackground} className="ml-2 underline">Fechar</button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
          </div>
        </details>
      )}

      <p className="rounded-2xl border border-border/60 bg-secondary/25 p-3 text-[11px] leading-relaxed text-muted-foreground">
        O estúdio roda no seu aparelho e não consome créditos. A criação de anúncios continua completa e gratuita na aba <strong className="font-bold text-foreground">Criar anúncio</strong>.
      </p>
    </section>
  );
}
