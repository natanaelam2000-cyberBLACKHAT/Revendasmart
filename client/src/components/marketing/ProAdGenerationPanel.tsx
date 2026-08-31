import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, RefreshCw, Sparkles } from "lucide-react";
import type { Product } from "@/lib/mock-data";
import type { ApprovedProductCutout } from "@shared/approved-product-cutout";
import type { CreativeConceptWithScore } from "@shared/marketing-pro-creative-director";
import type { ProductTruth, ProductVisualUnderstanding } from "@shared/marketing-pro-creative-intelligence";
import {
  createMarketingProGenerationRequestId,
  generateMarketingProBackgroundAndWait,
  getMarketingProCapability,
  type MarketingProGenerationDto,
} from "@/lib/marketing-pro-real-background";
import {
  composeMarketingProProfessionalAdPreview,
  canvasToPngBlob,
} from "@/lib/marketing-pro-real-background-composer";
import {
  resolveMarketingProBackground,
  renderMarketingProBackgroundSource,
  type MarketingProResolvedBackground,
} from "@shared/marketing-pro-background-library";
import { resolveMarketingProCategory, type MarketingProCategory } from "@shared/marketing-pro-contract";
import { formatCurrency } from "@/lib/product-pricing";
import { buildProductTruthFromProduct } from "@/lib/product-truth-adapter";

/**
 * PRO-13UI — preview final do Anúncios Pro (produto → conceito escolhido → arte real → export).
 *
 * ADS-PRO-02: library-first, IA opcional. O caminho PADRÃO (`sourceMode === "library"`) resolve um
 * background determinístico de `shared/marketing-pro-background-library.ts` — zero chamada de rede, zero
 * dependência de Gemini — e compõe com o MESMO composer canônico de sempre
 * (`composeMarketingProProfessionalAdPreview`). O caminho de IA real (`generateMarketingProBackgroundAndWait`
 * → Gemini, com todos os safety gates/cost guard/rate limit já implementados em `server/marketing-pro*.ts`)
 * continua existindo e funcional, mas só roda se o usuário ativar `sourceMode === "ai"` explicitamente —
 * nunca é chamado por padrão, nunca bloqueia a geração quando indisponível. O client envia somente o id e
 * a família fechada do conceito; o backend deriva a BackgroundSpec e o prompt proprietário, sem aceitar
 * texto livre do usuário.
 */
const CONCEPT_FAMILY_LABELS: Record<CreativeConceptWithScore["concept"]["creativeFamily"], string> = {
  luxury: "Luxo",
  editorial: "Editorial",
  modern: "Moderno",
  minimal: "Minimalista",
  sensory: "Sensorial",
  "fresh-premium": "Fresh Premium",
  "fresh-sport": "Fresh Sport",
  "fresh-commercial": "Fresh Commercial",
};

/** Resumos curtos e honestos por família — só direção de estilo, nunca um dado factual do produto. */
const CONCEPT_FAMILY_SUMMARY: Record<CreativeConceptWithScore["concept"]["creativeFamily"], string> = {
  luxury: "Visual sofisticado, com destaque forte e acabamento premium.",
  editorial: "Visual limpo e equilibrado, com foco claro no produto.",
  modern: "Visual estruturado e dinâmico, com energia gráfica.",
  minimal: "Visual calmo, com bastante espaço em branco ao redor do produto.",
  sensory: "Visual acolhedor, com luz suave e textura orgânica.",
  "fresh-premium": "Visual claro, sofisticado e com foco no produto.",
  "fresh-sport": "Visual enérgico, com luz dinâmica e ângulo de movimento.",
  "fresh-commercial": "Visual direto, feito para vender, com informação equilibrada.",
};

const GENERATION_ERROR_MESSAGES: Record<string, string> = {
  PRO_ADS_REQUIRED: "Anúncios Pro requer o plano Premium.",
  APPROVED_CUTOUT_REQUIRED: "Prepare o recorte do produto antes de gerar o anúncio.",
  RATE_LIMITED: "Aguarde um pouco antes de gerar outro anúncio.",
  BUDGET_EXCEEDED: "O gerador de anúncios está indisponível no momento. Tente novamente mais tarde.",
  BUDGET_STATE_CORRUPTED: "O gerador de anúncios está temporariamente indisponível.",
  SAFE_ZONE_REJECTED: "O cenário gerado ficou ocupado demais para destacar este produto.",
  SEMANTIC_CONTENT_REJECTED: "O cenário gerado trouxe elementos que não são seguros para este anúncio.",
  SEMANTIC_INVALID_OUTPUT: "A inspeção de segurança do cenário não retornou um resultado confiável.",
  SEMANTIC_TIMEOUT: "A inspeção de segurança demorou demais para responder.",
  SEMANTIC_GATE_UNAVAILABLE: "A inspeção de segurança do cenário está indisponível no momento.",
  GENERATION_TIMEOUT: "A geração demorou demais para responder. Tente novamente.",
  GENERATION_FAILED: "Não foi possível gerar o anúncio agora. Tente novamente.",
};

/** ADS-PRO-02 §24/§25 — identidade suficiente para reproduzir o criativo depois, mesmo sem History
 * implementado ainda neste ticket: quem for persistir no futuro só precisa ler estes campos. */
interface ProAdCreativeIdentity {
  readonly composerVersion: 1;
  readonly format: "square";
  readonly creativeConceptId: string;
  readonly creativeFamily: CreativeConceptWithScore["concept"]["creativeFamily"];
  readonly background:
    | { readonly sourceType: "GENERATED_DETERMINISTIC" | "STATIC_ASSET"; readonly backgroundId: string; readonly backgroundVersion: number; readonly backgroundFamily: string }
    | { readonly sourceType: "AI_GENERATED"; readonly generationId: string };
}

interface ReadyArt {
  readonly generationId: string;
  readonly previewUrl: string;
  readonly pngBlob: Blob;
  readonly identity: ProAdCreativeIdentity;
}

type GenerationState =
  | { readonly phase: "concept-selected" }
  | { readonly phase: "generating"; readonly lastReady?: ReadyArt }
  | { readonly phase: "ready"; readonly current: ReadyArt; readonly previous?: ReadyArt }
  | { readonly phase: "failed"; readonly message: string; readonly lastReady?: ReadyArt };

/** §3: mensagens de UX progressiva — o backend não expõe etapas reais, então isto é só ritmo visual,
 * nunca uma etapa fingida do pipeline de verdade. */
const LOADING_MESSAGES = [
  "Preparando seu anúncio...",
  "Entendendo a direção visual...",
  "Criando o cenário...",
  "Montando seu produto...",
];

/**
 * ADS-PRO-02 §27 — se um background falhar ao carregar (hoje só alcançável para um futuro STATIC_ASSET;
 * os 12 seeds atuais são GENERATED_DETERMINISTIC e nunca fazem rede), tenta outro asset determinístico
 * antes de desistir — nunca deixa a arte quebrada quando outro background está disponível. Duas
 * tentativas no máximo: se a segunda também falhar, o erro real (ex.: cutout inválido) propaga normal.
 */
async function composeLibraryBackground(input: {
  readonly creativeFamily: CreativeConceptWithScore["concept"]["creativeFamily"];
  readonly category: MarketingProCategory;
  readonly format: "square";
  readonly seed: string;
  readonly variantIndex: number;
  readonly cutoutImageSrc: string;
  readonly concept: CreativeConceptWithScore["concept"];
  readonly productTruth: ProductTruth;
  readonly productUnderstanding?: Pick<ProductVisualUnderstanding, "observed">;
  readonly branding?: { readonly storeName?: string; readonly logoUrl?: string; readonly primaryColor?: string };
}): Promise<{ readonly canvas: HTMLCanvasElement; readonly resolved: MarketingProResolvedBackground }> {
  const attempted: string[] = [];
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const resolved = resolveMarketingProBackground({
      creativeFamily: input.creativeFamily,
      category: input.category,
      format: input.format,
      seed: input.seed,
      variantIndex: input.variantIndex,
      excludeIds: attempted,
    });
    attempted.push(resolved.backgroundId);
    try {
      const backgroundImageSrc = renderMarketingProBackgroundSource(resolved.asset, input.format);
      const canvas = await composeMarketingProProfessionalAdPreview({
        backgroundImageSrc,
        cutoutImageSrc: input.cutoutImageSrc,
        concept: input.concept,
        productTruth: input.productTruth,
        productUnderstanding: input.productUnderstanding,
        branding: input.branding,
      });
      return { canvas, resolved };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

type ProAdGenerationPanelProps = {
  product: Product;
  concept: CreativeConceptWithScore;
  approvedCutoutSource: ApprovedProductCutout | undefined;
  productUnderstanding?: ProductVisualUnderstanding;
  realBackgroundEnabled: boolean;
  branding: { readonly storeName?: string; readonly storeLogoUrl?: string; readonly primaryColor?: string };
  onBackToConcepts: () => void;
};

export function ProAdGenerationPanel({ product, concept, approvedCutoutSource, productUnderstanding, realBackgroundEnabled, branding, onBackToConcepts }: ProAdGenerationPanelProps) {
  const [state, setState] = useState<GenerationState>({ phase: "concept-selected" });
  const [serverCapabilityReady, setServerCapabilityReady] = useState(false);
  const [viewing, setViewing] = useState<"current" | "previous">("current");
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  // ADS-PRO-02 §14/§15 — "library" é o caminho padrão (zero rede, zero IA); "ai" é opt-in explícito do
  // usuário, nunca ligado sozinho mesmo quando a capability real está disponível.
  const [sourceMode, setSourceMode] = useState<"library" | "ai">("library");
  const busyRef = useRef(false);
  const objectUrlsRef = useRef(new Set<string>());
  // §12/§13 — cada geração consecutiva do MESMO conceito avança um variantIndex explícito e
  // determinístico ("Outra opção" reaproveitando o botão "Gerar novamente" já existente), nunca aleatório.
  const libraryVariantRef = useRef(0);

  useEffect(() => {
    if (state.phase !== "generating") return;
    const interval = setInterval(() => {
      setLoadingMessageIndex((current) => (current + 1) % LOADING_MESSAGES.length);
    }, 1800);
    return () => clearInterval(interval);
  }, [state.phase]);

  useEffect(() => {
    let active = true;
    setServerCapabilityReady(false);
    if (!realBackgroundEnabled) return () => { active = false; };
    void getMarketingProCapability()
      .then((capability) => { if (active) setServerCapabilityReady(Boolean(capability.realBackgroundAvailable && capability.semanticGateReady)); })
      .catch(() => { if (active) setServerCapabilityReady(false); });
    return () => { active = false; };
  }, [realBackgroundEnabled]);

  // Descarta qualquer objectURL pendente ao desmontar — nunca vaza memória entre trocas de conceito.
  useEffect(() => () => { objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url)); objectUrlsRef.current.clear(); }, []);

  const handleGenerate = useCallback(async () => {
    // §8: fail closed — sem approvedCutoutSource não existe composição possível, nunca um fallback que
    // altere o produto. ADS-PRO-02: diferente do modo IA, o modo library nunca depende de
    // realBackgroundEnabled/serverCapabilityReady — é o caminho padrão, sempre disponível.
    if (!approvedCutoutSource || busyRef.current) return;
    if (sourceMode === "ai" && (!realBackgroundEnabled || !serverCapabilityReady)) return;
    busyRef.current = true;
    setLoadingMessageIndex(0);
    setState((current) => {
      if (current.phase === "ready" && current.previous) {
        URL.revokeObjectURL(current.previous.previewUrl);
        objectUrlsRef.current.delete(current.previous.previewUrl);
      }
      return { phase: "generating", lastReady: current.phase === "ready" ? current.current : current.phase === "failed" ? current.lastReady : current.phase === "generating" ? current.lastReady : undefined };
    });
    try {
      const cutoutImageSrc = approvedCutoutSource.downloadUrl || approvedCutoutSource.storagePath;
      const productTruth = buildProductTruthFromProduct(product);
      const brandingInput = { storeName: branding.storeName, logoUrl: branding.storeLogoUrl, primaryColor: branding.primaryColor };

      let canvas: HTMLCanvasElement;
      let generationId: string;
      let identity: ProAdCreativeIdentity;

      if (sourceMode === "ai") {
        const dto: MarketingProGenerationDto = await generateMarketingProBackgroundAndWait({
          generationRequestId: createMarketingProGenerationRequestId(),
          productId: product.id,
          format: "square",
          creativeConceptId: concept.concept.id,
          creativeFamily: concept.concept.creativeFamily,
        });
        if (dto.status !== "ready" || !dto.background) {
          const message = (dto.errorCode && GENERATION_ERROR_MESSAGES[dto.errorCode]) || "Não foi possível gerar o anúncio agora. Tente novamente.";
          setState((current) => ({ phase: "failed", message, lastReady: current.phase === "generating" ? current.lastReady : current.phase === "ready" ? current.current : current.phase === "failed" ? current.lastReady : undefined }));
          return;
        }
        canvas = await composeMarketingProProfessionalAdPreview({
          backgroundImageSrc: dto.background.backgroundDownloadUrl || dto.background.backgroundAssetPath,
          cutoutImageSrc,
          concept: concept.concept,
          productTruth,
          productUnderstanding,
          branding: brandingInput,
        });
        generationId = dto.generationId;
        identity = { composerVersion: 1, format: "square", creativeConceptId: concept.concept.id, creativeFamily: concept.concept.creativeFamily, background: { sourceType: "AI_GENERATED", generationId: dto.generationId } };
      } else {
        const category = resolveMarketingProCategory(product.category);
        const variantIndex = libraryVariantRef.current;
        libraryVariantRef.current += 1;
        const { canvas: libraryCanvas, resolved } = await composeLibraryBackground({
          creativeFamily: concept.concept.creativeFamily,
          category,
          format: "square",
          seed: product.id,
          variantIndex,
          cutoutImageSrc,
          concept: concept.concept,
          productTruth,
          productUnderstanding,
          branding: brandingInput,
        });
        canvas = libraryCanvas;
        generationId = `library:${product.id}:${resolved.backgroundId}:${variantIndex}`;
        identity = { composerVersion: 1, format: "square", creativeConceptId: concept.concept.id, creativeFamily: concept.concept.creativeFamily, background: { sourceType: resolved.sourceType, backgroundId: resolved.backgroundId, backgroundVersion: resolved.backgroundVersion, backgroundFamily: resolved.backgroundFamily } };
      }

      const pngBlob = await canvasToPngBlob(canvas);
      if (!pngBlob) {
        setState((current) => ({ phase: "failed", message: "Não foi possível gerar a prévia da arte.", lastReady: current.phase === "generating" ? current.lastReady : undefined }));
        return;
      }
      const previewUrl = URL.createObjectURL(pngBlob);
      objectUrlsRef.current.add(previewUrl);
      setState((current) => {
        const previous = current.phase === "generating" ? current.lastReady : current.phase === "ready" ? current.current : undefined;
        return { phase: "ready", current: { generationId, previewUrl, pngBlob, identity }, previous };
      });
      setViewing("current");
    } catch {
      setState((current) => ({ phase: "failed", message: "Falha inesperada ao gerar o anúncio. Tente novamente.", lastReady: current.phase === "generating" ? current.lastReady : current.phase === "ready" ? current.current : current.phase === "failed" ? current.lastReady : undefined }));
    } finally {
      busyRef.current = false;
    }
  }, [approvedCutoutSource, branding.primaryColor, branding.storeLogoUrl, branding.storeName, concept, product, productUnderstanding, realBackgroundEnabled, serverCapabilityReady, sourceMode]);

  const handleUndo = useCallback(() => {
    setState((current) => {
      if (current.phase !== "ready" || !current.previous) return current;
      URL.revokeObjectURL(current.current.previewUrl);
      objectUrlsRef.current.delete(current.current.previewUrl);
      return { phase: "ready", current: current.previous };
    });
    setViewing("current");
  }, []);

  const handleDownload = useCallback(() => {
    if (state.phase !== "ready") return;
    const art = viewing === "previous" && state.previous ? state.previous : state.current;
    const link = document.createElement("a");
    link.href = art.previewUrl;
    link.download = `anuncio-${product.id}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [product.id, state, viewing]);

  const noCutout = !approvedCutoutSource;
  const generating = state.phase === "generating";
  const familyLabel = CONCEPT_FAMILY_LABELS[concept.concept.creativeFamily];
  const familySummary = CONCEPT_FAMILY_SUMMARY[concept.concept.creativeFamily];
  const previousPrice = product.extras?.previousPrice ?? product.extras?.originalPrice;
  const hasPromotion = typeof product.discountPercent === "number" && product.discountPercent > 0;

  const displayedArt = state.phase === "ready" ? (viewing === "previous" && state.previous ? state.previous : state.current) : null;

  return (
    <div className="min-w-0 rounded-2xl border border-primary/20 bg-primary/[0.04] p-3.5" data-testid="pro-ad-generation-panel">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-foreground">Gerar anúncio</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Cria a arte final a partir do conceito escolhido, usando a biblioteca de fundos Pro. Só o fundo muda — o produto nunca é redesenhado.
          </p>
        </div>
        <span className="rounded-full bg-primary/10 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-primary">beta</span>
      </div>

      {/* §10: resumo do conceito escolhido — nunca expõe score técnico. */}
      <div className="mt-3 rounded-xl border border-border/60 bg-white px-3 py-2" data-testid="pro-ad-concept-summary">
        <p className="text-xs font-black text-foreground">{concept.concept.label}</p>
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{familyLabel}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{familySummary}</p>
      </div>

      {/* §9: dados do produto, discretamente — nunca renderizados como a arte final. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground" data-testid="pro-ad-product-summary">
        <span className="font-bold text-foreground">{product.name}</span>
        <span>{formatCurrency(product.salePrice)}</span>
        {hasPromotion && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-emerald-700">
            {previousPrice ? `Antes ${formatCurrency(Number(previousPrice))}` : "Promoção"}
          </span>
        )}
      </div>

      {noCutout ? (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800" role="status" data-testid="text-pro-ad-cutout-blocker">
          Prepare o recorte do produto antes de gerar o anúncio.
        </p>
      ) : (
        <>
          {/* ADS-PRO-02 §15/§16 — IA continua opcional/experimental, nunca ligada por padrão nem exigida
              para gerar. Só aparece quando a flag de ambiente está ligada; se a capability real não
              estiver pronta, a opção fica visível mas desabilitada, com o motivo explicado — o caminho
              library nunca é bloqueado por isso. */}
          {realBackgroundEnabled && (
            <label className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background px-3 py-2 text-[11px] font-semibold text-muted-foreground" data-testid="toggle-pro-ad-source-mode">
              <span>
                Usar fundo gerado por IA (experimental)
                {!serverCapabilityReady && <span className="block text-[10px] font-normal text-muted-foreground/80">Indisponível neste ambiente agora — a biblioteca de fundos continua funcionando normalmente.</span>}
              </span>
              <input
                type="checkbox"
                checked={sourceMode === "ai"}
                disabled={!serverCapabilityReady || generating}
                onChange={(event) => setSourceMode(event.target.checked ? "ai" : "library")}
                className="h-4 w-4 shrink-0 accent-primary"
                data-testid="checkbox-pro-ad-source-mode-ai"
              />
            </label>
          )}

          {state.phase === "concept-selected" && (
            <button
              type="button"
              onClick={handleGenerate}
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-xs font-black text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              data-testid="button-pro-ad-generate"
            >
              <Sparkles className="h-4 w-4" />
              Gerar este anúncio
            </button>
          )}

          {generating && (
            <p
              className="mt-3 rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-semibold text-muted-foreground"
              role="status"
              aria-live="polite"
              aria-busy="true"
              data-testid="text-pro-ad-generating"
            >
              {LOADING_MESSAGES[loadingMessageIndex]}
            </p>
          )}

          {state.phase === "failed" && (
            <div className="mt-3">
              {state.lastReady && (
                <div className="aspect-square max-h-80 overflow-hidden rounded-xl border border-border/60 bg-white">
                  <img src={state.lastReady.previewUrl} alt="Última arte gerada com sucesso para este produto" className="h-full w-full object-contain" data-testid="img-pro-ad-last-ready" />
                </div>
              )}
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700" role="alert" data-testid="text-pro-ad-error">
                {state.message}
              </div>
              <button
                type="button"
                onClick={handleGenerate}
                className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-white px-4 text-xs font-black text-primary transition hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                data-testid="button-pro-ad-retry"
              >
                <RefreshCw className="h-4 w-4" />
                Tentar novamente
              </button>
            </div>
          )}

          {state.phase === "ready" && displayedArt && (
            <div className="mt-3">
              {state.previous && (
                <div className="flex gap-1.5" role="group" aria-label="Comparar versões" data-testid="pro-ad-compare-toggle">
                  <button
                    type="button"
                    aria-pressed={viewing === "previous"}
                    onClick={() => setViewing("previous")}
                    className={`min-h-9 flex-1 rounded-full border px-3 text-[10px] font-bold transition ${viewing === "previous" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground"}`}
                    data-testid="button-pro-ad-view-previous"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    aria-pressed={viewing === "current"}
                    onClick={() => setViewing("current")}
                    className={`min-h-9 flex-1 rounded-full border px-3 text-[10px] font-bold transition ${viewing === "current" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground"}`}
                    data-testid="button-pro-ad-view-current"
                  >
                    Atual
                  </button>
                </div>
              )}

              <div className="mt-2 aspect-square w-full overflow-hidden rounded-xl border border-border/60 bg-white">
                <img
                  src={displayedArt.previewUrl}
                  alt={`Anúncio final de ${product.name}, formato 1080x1080`}
                  className="h-full w-full object-contain"
                  data-testid="img-pro-ad-preview"
                />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleDownload}
                  className="min-h-11 rounded-xl bg-primary text-xs font-black text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  data-testid="button-pro-ad-download"
                >
                  <span className="inline-flex items-center justify-center gap-1.5"><Download className="h-4 w-4" /> Baixar PNG</span>
                </button>
                <button
                  type="button"
                  onClick={handleGenerate}
                  className="min-h-11 rounded-xl border border-border bg-white text-xs font-black text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  data-testid="button-pro-ad-regenerate"
                >
                  <span className="inline-flex items-center justify-center gap-1.5"><RefreshCw className="h-4 w-4" /> Gerar novamente</span>
                </button>
                {state.previous && (
                  <button
                    type="button"
                    onClick={handleUndo}
                    className="min-h-11 rounded-xl border border-border bg-white text-xs font-black text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    data-testid="button-pro-ad-undo"
                  >
                    Desfazer background novo
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onBackToConcepts}
          className="min-h-11 flex-1 rounded-xl border border-border bg-white text-xs font-black text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          data-testid="button-pro-ad-choose-another"
        >
          <span className="inline-flex items-center justify-center gap-1.5"><ArrowLeft className="h-4 w-4" /> Escolher outro conceito</span>
        </button>
        <button
          type="button"
          onClick={onBackToConcepts}
          className="min-h-11 flex-1 rounded-xl border border-border bg-white text-xs font-black text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          data-testid="button-pro-ad-back"
        >
          Voltar aos conceitos
        </button>
      </div>
    </div>
  );
}
