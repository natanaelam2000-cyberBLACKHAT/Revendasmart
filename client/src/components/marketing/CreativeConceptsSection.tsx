import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import type { Product } from "@/lib/mock-data";
import type { ApprovedProductCutout } from "@shared/approved-product-cutout";
import { buildCreativeConceptsForProduct, type CreativeConceptsForProductResult, type ProductUnderstandingSource } from "@/lib/marketing-pro-creative-concepts";
import type { CreativeConceptWithScore } from "@shared/marketing-pro-creative-director";
import type { CreativeFamily, MarketingCampaignIntentId } from "@shared/marketing-pro-creative-intelligence";
import { ProAdGenerationPanel } from "./ProAdGenerationPanel";

/**
 * PRO-12B — UI real dos 3 conceitos publicitários produzidos pelo Creative Director local (PRO-12A).
 * Ainda NÃO gera imagem nenhuma: mostra as 3 direções, deixa o usuário escolher uma e deixa o conceito
 * escolhido pronto para a próxima etapa (geração visual, fora do escopo desta tarefa). Nunca expõe
 * decisionTrace/chain-of-thought — só os campos estruturados já pensados para UI (`whyItFits`, scores).
 */

const CREATIVE_FAMILY_LABELS: Record<CreativeFamily, string> = {
  luxury: "Luxo",
  editorial: "Editorial",
  modern: "Moderno",
  minimal: "Minimalista",
  sensory: "Sensorial",
  "fresh-premium": "Fresh Premium",
  "fresh-sport": "Fresh Sport",
  "fresh-commercial": "Fresh Commercial",
};

const PRICE_TREATMENT_LABELS: Record<string, string> = {
  subtle: "discreto",
  standard: "padrão",
  highlight: "em destaque",
};

const PROMOTION_TREATMENT_LABELS: Record<string, string> = {
  none: "sem promoção",
  subtle: "sutil",
  balanced: "equilibrada",
  strong: "forte",
};

const CAMPAIGN_INTENT_OPTIONS: readonly { readonly id: MarketingCampaignIntentId; readonly label: string }[] = [
  { id: "spotlight", label: "Destaque" },
  { id: "promo", label: "Promoção" },
  { id: "last", label: "Últimas unidades" },
  { id: "new", label: "Lançamento" },
];

const UNDERSTANDING_SOURCE_LABELS: Record<ProductUnderstandingSource, string> = {
  gemini: "análise visual real deste produto",
  "server-fallback": "direção local (sem análise visual disponível)",
  "local-fallback": "direção local (sem conexão com a análise visual)",
};

type SectionState =
  | { readonly phase: "idle" }
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly result: CreativeConceptsForProductResult }
  | { readonly phase: "error"; readonly message: string };

type CreativeConceptsSectionProps = {
  product: Product | undefined;
  approvedCutoutSource: ApprovedProductCutout | undefined;
  realBackgroundEnabled: boolean;
  branding: { readonly storeName?: string; readonly storeLogoUrl?: string; readonly primaryColor?: string };
};

function sellerAdapted(concept: CreativeConceptWithScore): boolean {
  return concept.scores.sellerPreferenceFitScore >= 1;
}

export function CreativeConceptsSection({ product, approvedCutoutSource, realBackgroundEnabled, branding }: CreativeConceptsSectionProps) {
  const [campaignIntentId, setCampaignIntentId] = useState<MarketingCampaignIntentId>("spotlight");
  const [state, setState] = useState<SectionState>({ phase: "idle" });
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);
  const [confirmedConceptId, setConfirmedConceptId] = useState<string | null>(null);
  const busyRef = useRef(false);
  const productId = product?.id;

  const runGeneration = useCallback(async (intentId: MarketingCampaignIntentId) => {
    if (!product || busyRef.current) return;
    busyRef.current = true;
    setState({ phase: "loading" });
    try {
      const result = await buildCreativeConceptsForProduct({ product, campaignIntentId: intentId });
      setSelectedConceptId(null);
      setConfirmedConceptId(null);
      setState({ phase: "ready", result });
    } catch {
      setState({ phase: "error", message: "Não foi possível gerar conceitos para este produto agora. Tente novamente." });
    } finally {
      busyRef.current = false;
    }
  }, [product]);

  // Trocar de produto descarta qualquer resultado pendente do produto anterior — nunca aplica o conceito
  // de um produto em outro.
  useEffect(() => {
    setState({ phase: "idle" });
    setSelectedConceptId(null);
    setConfirmedConceptId(null);
  }, [productId]);

  const handleCampaignIntentChange = useCallback((intentId: MarketingCampaignIntentId) => {
    setCampaignIntentId(intentId);
    // Só recalcula depois que o usuário já iniciou o fluxo; o primeiro clique continua explícito.
    if (state.phase === "ready" || state.phase === "error") void runGeneration(intentId);
  }, [runGeneration, state.phase]);

  const handleGenerateClick = useCallback(() => {
    void runGeneration(campaignIntentId);
  }, [campaignIntentId, runGeneration]);

  const handleSelectConcept = useCallback((conceptId: string) => {
    setConfirmedConceptId(null);
    setSelectedConceptId((current) => (current === conceptId ? null : conceptId));
  }, []);

  const handleUseConcept = useCallback(() => {
    if (selectedConceptId) setConfirmedConceptId(selectedConceptId);
  }, [selectedConceptId]);

  if (!product) return null;

  const readyResult = state.phase === "ready" ? state.result : null;
  const sortedConcepts = readyResult
    ? [...readyResult.direction.concepts].sort((first, second) => second.scores.overallScore - first.scores.overallScore)
    : [];

  return (
    <div className="min-w-0 rounded-2xl border border-primary/20 bg-primary/[0.04] p-3.5" data-testid="marketing-pro-creative-concepts-section">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-foreground">Conceitos criativos</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Gera 3 direções publicitárias diferentes para este produto. Nenhuma imagem é criada ainda.
          </p>
        </div>
        <span className="rounded-full bg-primary/10 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-primary">beta</span>
      </div>

      <div className="mt-3" role="group" aria-label="Objetivo da campanha" data-testid="creative-concepts-campaign-intent">
        <p className="text-[11px] font-bold text-foreground">Objetivo</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {CAMPAIGN_INTENT_OPTIONS.map((option) => {
            const selected = campaignIntentId === option.id;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={selected}
                onClick={() => handleCampaignIntentChange(option.id)}
                className={`min-h-9 rounded-full border px-3 text-[10px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:border-primary/50"}`}
                data-testid={`creative-concepts-campaign-intent-${option.id}`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {state.phase === "idle" && (
        <button
          type="button"
          onClick={handleGenerateClick}
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-white px-4 text-xs font-black text-primary transition hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          data-testid="button-creative-concepts-generate"
        >
          <Sparkles className="h-4 w-4" />
          Criar conceitos para este produto
        </button>
      )}

      {state.phase === "loading" && (
        <p className="mt-3 rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-semibold text-muted-foreground" role="status" aria-live="polite" data-testid="text-creative-concepts-loading">
          Criando conceitos para este produto...
        </p>
      )}

      {state.phase === "error" && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700" role="alert" data-testid="text-creative-concepts-error">
          {state.message}
          <button type="button" onClick={handleGenerateClick} className="ml-2 underline">Tentar novamente</button>
        </div>
      )}

      {readyResult && confirmedConceptId && (
        <div className="mt-3">
          <ProAdGenerationPanel
            product={product}
            concept={sortedConcepts.find((entry) => entry.concept.id === confirmedConceptId)!}
            approvedCutoutSource={approvedCutoutSource}
            productUnderstanding={readyResult.visualUnderstanding}
            realBackgroundEnabled={realBackgroundEnabled}
            branding={branding}
            onBackToConcepts={() => setConfirmedConceptId(null)}
          />
        </div>
      )}

      {readyResult && !confirmedConceptId && (
        <div className="mt-3">
          <p className="text-[10px] font-semibold text-muted-foreground" data-testid="text-creative-concepts-understanding-source">
            Baseado em {UNDERSTANDING_SOURCE_LABELS[readyResult.understandingSource]}.
          </p>

          <div className="mt-2 grid min-w-0 grid-cols-1 gap-2.5" data-testid="creative-concepts-cards">
            {sortedConcepts.map((entry, index) => {
              const selected = selectedConceptId === entry.concept.id;
              return (
                <div
                  key={entry.concept.id}
                  className={`min-w-0 rounded-2xl border-2 bg-white p-3 transition ${selected ? "border-primary shadow-sm" : "border-border/60"}`}
                  data-testid={`creative-concept-card-${entry.concept.id}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-xs font-black text-foreground">{entry.concept.label}</p>
                        {index === 0 && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-emerald-700" data-testid={`badge-creative-concept-recommended-${entry.concept.id}`}>
                            Mais recomendado
                          </span>
                        )}
                        {sellerAdapted(entry) && (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-primary" data-testid={`badge-creative-concept-adapted-${entry.concept.id}`}>
                            Adaptado ao seu estilo
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        {CREATIVE_FAMILY_LABELS[entry.concept.creativeFamily]}
                      </p>
                    </div>
                    <span className="rounded-full bg-secondary/60 px-2 py-1 text-[9px] font-black text-foreground" data-testid={`text-creative-concept-score-${entry.concept.id}`}>
                      {Math.round(entry.scores.overallScore * 100)}
                    </span>
                  </div>

                  <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1.5 text-[11px] leading-snug">
                    <div className="min-w-0">
                      <dt className="font-bold text-foreground">Paleta</dt>
                      <dd className="text-muted-foreground">{entry.concept.palette.join(", ")}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="font-bold text-foreground">Ambiente</dt>
                      <dd className="text-muted-foreground">{entry.concept.environment.join(", ")}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="font-bold text-foreground">Iluminação</dt>
                      <dd className="text-muted-foreground">{entry.concept.lighting}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="font-bold text-foreground">Composição</dt>
                      <dd className="text-muted-foreground">{entry.concept.composition}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="font-bold text-foreground">Preço</dt>
                      <dd className="text-muted-foreground">{PRICE_TREATMENT_LABELS[entry.concept.priceTreatment] || entry.concept.priceTreatment}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="font-bold text-foreground">Promoção</dt>
                      <dd className="text-muted-foreground">{PROMOTION_TREATMENT_LABELS[entry.concept.promotionTreatment] || entry.concept.promotionTreatment}</dd>
                    </div>
                  </dl>

                  <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
                    <span className="font-bold text-foreground">Por que combina: </span>
                    {entry.whyItFits.join(" · ")}
                  </p>

                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => handleSelectConcept(entry.concept.id)}
                    className={`mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border px-4 text-xs font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${selected ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:border-primary/50"}`}
                    data-testid={`button-creative-concept-select-${entry.concept.id}`}
                  >
                    {selected ? "Selecionado" : "Escolher este conceito"}
                  </button>
                </div>
              );
            })}
          </div>

          {selectedConceptId && !confirmedConceptId && (
            <button
              type="button"
              onClick={handleUseConcept}
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-xs font-black text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              data-testid="button-creative-concepts-use-selected"
            >
              Usar este conceito
            </button>
          )}

          <button
            type="button"
            disabled
            title="Novas ideias estarão disponíveis na geração com IA."
            className="mt-3 inline-flex min-h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-secondary/20 px-4 text-xs font-black text-muted-foreground opacity-70"
            data-testid="button-creative-concepts-regenerate"
          >
            <RefreshCw className="h-4 w-4" />
            Gerar novas ideias — em breve
          </button>
        </div>
      )}
    </div>
  );
}
