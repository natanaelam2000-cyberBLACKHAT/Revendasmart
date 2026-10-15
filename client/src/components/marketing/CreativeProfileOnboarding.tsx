import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AlertTriangle, ArrowLeft, Check, Loader2, Sparkles, X } from "lucide-react";
import {
  mapCreativeProfileOnboardingToSellerProfile,
  EMPTY_CREATIVE_PROFILE_ANSWERS,
  type CreativeProfileColorTendencyUiId,
  type CreativeProfileEmphasisUiId,
  type CreativeProfileExampleUiId,
  type CreativeProfileInformationDensityUiId,
  type CreativeProfileVisualStyleUiId,
  type CreativeProfileWizardAnswers,
} from "@/lib/creative-profile-mapper";
import type { SellerCreativeProfile } from "@shared/marketing-pro-creative-intelligence";
import { useDismissibleOnBack } from "@/hooks/useDismissibleOnBack";

/**
 * PRO-10A/PRO-10B — "Vamos descobrir seu estilo": onboarding visual de 5 etapas do Anúncios Pro.
 *
 * PRO-10B: o resultado final é sempre um `SellerCreativeProfile` de verdade (contrato central), montado
 * por `mapCreativeProfileOnboardingToSellerProfile`. Este componente não fala com Firestore/rede
 * diretamente — `onComplete` é fornecido por quem monta o componente e devolve uma Promise<boolean>
 * (true = salvou de verdade no servidor). Enquanto isso está pendente/falhou, as respostas continuam
 * na tela — nunca finge sucesso (§12 da tarefa: "Nunca fingir sucesso").
 */

const TOTAL_STEPS = 5;

const VISUAL_STYLE_OPTIONS: { id: CreativeProfileVisualStyleUiId; label: string; gradient: string }[] = [
  { id: "luxury", label: "Premium / Luxo", gradient: "linear-gradient(135deg, #2A1B3D, #C026D3)" },
  { id: "clean", label: "Clean / Minimalista", gradient: "linear-gradient(135deg, #F1F5F9, #94A3B8)" },
  { id: "modern", label: "Moderno / Impactante", gradient: "linear-gradient(135deg, #1E293B, #2563EB)" },
  { id: "promotional", label: "Comercial / Promocional", gradient: "linear-gradient(135deg, #B91C1C, #F59E0B)" },
];

const DENSITY_OPTIONS: { id: CreativeProfileInformationDensityUiId; label: string; detail: string }[] = [
  { id: "minimal", label: "Poucas informações", detail: "Só o essencial em destaque." },
  { id: "balanced", label: "Equilibrado", detail: "Produto, preço e um diferencial." },
  { id: "detailed", label: "Mais completo", detail: "Nome, benefícios, preço e CTA." },
];

const EMPHASIS_OPTIONS: { id: CreativeProfileEmphasisUiId; label: string }[] = [
  { id: "product", label: "Produto" },
  { id: "price", label: "Preço" },
  { id: "promotion", label: "Oferta" },
  { id: "balanced", label: "Equilíbrio entre todos" },
];

const COLOR_TENDENCY_OPTIONS: { id: CreativeProfileColorTendencyUiId; label: string; gradient: string }[] = [
  { id: "light", label: "Clara / leve", gradient: "linear-gradient(135deg, #FFFFFF, #E2E8F0)" },
  { id: "dark", label: "Escura / sofisticada", gradient: "linear-gradient(135deg, #0F172A, #334155)" },
  { id: "vibrant", label: "Colorida / vibrante", gradient: "linear-gradient(135deg, #F472B6, #FBBF24, #34D399)" },
  { id: "neutral", label: "Neutra / elegante", gradient: "linear-gradient(135deg, #E7E2D8, #A8A29E)" },
];

/** As 3 artes demonstrativas — mesmo produto fictício, direções visuais diferentes, tudo CSS. */
const EXAMPLE_ARTS: { id: CreativeProfileExampleUiId; label: string; background: string; text: string; accent: string }[] = [
  { id: "a", label: "Direção clara e minimalista", background: "linear-gradient(160deg, #FDFCFB, #EDE7DD)", text: "#1F2937", accent: "#B08D57" },
  { id: "b", label: "Direção escura e premium", background: "linear-gradient(160deg, #1A1025, #3B0764)", text: "#F5E9FF", accent: "#D946EF" },
  { id: "c", label: "Direção vibrante e promocional", background: "linear-gradient(160deg, #FF7A18, #AF0064)", text: "#FFFFFF", accent: "#FFE066" },
];

function DemoAdCard({ art, selected, onSelect }: { art: (typeof EXAMPLE_ARTS)[number]; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid={`button-creative-profile-example-${art.id}`}
      className={`flex w-full items-stretch gap-3 rounded-2xl border-2 p-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ${selected ? "border-primary" : "border-border/60"}`}
    >
      <div
        className="relative flex h-24 w-20 shrink-0 flex-col justify-between overflow-hidden rounded-xl p-2"
        style={{ background: art.background, color: art.text }}
        aria-hidden="true"
      >
        <span className="text-[8px] font-black uppercase tracking-wide" style={{ color: art.accent }}>Produto Demo</span>
        <div className="mx-auto h-9 w-9 rounded-full" style={{ background: art.accent, opacity: 0.85 }} />
        <span className="text-[9px] font-black">R$ 129,90</span>
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <p className="text-xs font-bold text-foreground">{art.label}</p>
        {selected && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
      </div>
    </button>
  );
}

function ChoiceCard({ label, detail, selected, onSelect, testId, swatch }: {
  label: string;
  detail?: string;
  selected: boolean;
  onSelect: () => void;
  testId: string;
  swatch?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid={testId}
      className={`flex min-h-20 w-full flex-col items-start gap-1.5 rounded-2xl border-2 p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ${selected ? "border-primary bg-primary/5" : "border-border/60 bg-white"}`}
    >
      {swatch && <span className="h-6 w-full rounded-lg" style={{ background: swatch }} aria-hidden="true" />}
      <div className="flex w-full items-center justify-between gap-2">
        <span className="text-xs font-black text-foreground">{label}</span>
        {selected && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
      </div>
      {detail && <span className="text-[10px] leading-snug text-muted-foreground">{detail}</span>}
    </button>
  );
}

export interface CreativeProfileOnboardingProps {
  readonly onClose: () => void;
  readonly onSkip: () => void;
  /** Devolve `true` só quando o servidor confirmou a gravação — nunca assumido pelo componente. */
  readonly onComplete: (profile: SellerCreativeProfile) => Promise<boolean>;
  /** §10 "Editar preferências": prefill real a partir do perfil já salvo (via mapSellerProfileToOnboardingAnswers). */
  readonly initialAnswers?: CreativeProfileWizardAnswers;
}

export function CreativeProfileOnboarding({ onClose, onSkip, onComplete, initialAnswers }: CreativeProfileOnboardingProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<CreativeProfileWizardAnswers>(initialAnswers ?? EMPTY_CREATIVE_PROFILE_ANSWERS);
  const [finished, setFinished] = useState<SellerCreativeProfile | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");

  const handleDismiss = useCallback(() => {
    if (saveState === "saving") return;
    onClose();
  }, [onClose, saveState]);

  useDismissibleOnBack(true, handleDismiss);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => closeButtonRef.current?.focus());

    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocusedRef.current?.focus();
    };
  }, []);

  const handleOverlayKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      handleDismiss();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      overlayRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) || [],
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, [handleDismiss]);

  const canContinue = (
    (stepIndex === 0 && answers.visualStyle !== null)
    || (stepIndex === 1 && answers.informationDensity !== null)
    || (stepIndex === 2 && answers.emphasis !== null)
    || (stepIndex === 3 && answers.colorTendency !== null)
    || (stepIndex === 4 && answers.selectedExample !== null)
  );

  const attemptSave = useCallback(async (profile: SellerCreativeProfile) => {
    setSaveState("saving");
    const ok = await onComplete(profile);
    setSaveState(ok ? "idle" : "error");
  }, [onComplete]);

  const handleContinue = useCallback(() => {
    if (stepIndex < TOTAL_STEPS - 1) {
      setStepIndex((current) => current + 1);
      return;
    }
    const profile = mapCreativeProfileOnboardingToSellerProfile(answers);
    if (!profile) return;
    setFinished(profile);
    void attemptSave(profile);
  }, [answers, attemptSave, stepIndex]);

  const handleRetrySave = useCallback(() => {
    if (finished) void attemptSave(finished);
  }, [attemptSave, finished]);

  const handleBack = useCallback(() => {
    setStepIndex((current) => Math.max(0, current - 1));
  }, []);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[80] flex items-stretch justify-center overflow-hidden bg-black/70 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Perfil criativo"
      onKeyDown={handleOverlayKeyDown}
      data-testid="creative-profile-onboarding"
    >
      <div className="flex h-full w-full max-w-md flex-col overflow-y-auto overscroll-contain bg-white sm:max-h-[90vh] sm:h-auto sm:rounded-3xl sm:shadow-xl">
        <div className="rs-overlay-safe-top flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
          {finished ? (
            <span className="text-xs font-black text-foreground">Pronto</span>
          ) : (
            <span className="text-xs font-black text-foreground" data-testid="text-creative-profile-progress">
              Etapa {stepIndex + 1}/{TOTAL_STEPS}
            </span>
          )}
          <button
            type="button"
            onClick={handleDismiss}
            ref={closeButtonRef}
            disabled={saveState === "saving"}
            aria-label="Fechar"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            data-testid="button-creative-profile-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!finished && (
          <div className="h-1 w-full bg-secondary/40" aria-hidden="true">
            <div className="h-1 bg-primary transition-all" style={{ width: `${((stepIndex + 1) / TOTAL_STEPS) * 100}%` }} />
          </div>
        )}

        <div className="min-w-0 flex-1 px-4 py-4">
          {!finished && stepIndex === 0 && (
            <>
              <h2 className="text-base font-black text-foreground">Qual estilo mais combina com você?</h2>
              <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Estilo visual">
                {VISUAL_STYLE_OPTIONS.map((option) => (
                  <ChoiceCard
                    key={option.id}
                    label={option.label}
                    swatch={option.gradient}
                    selected={answers.visualStyle === option.id}
                    onSelect={() => setAnswers((current) => ({ ...current, visualStyle: option.id }))}
                    testId={`button-creative-profile-style-${option.id}`}
                  />
                ))}
              </div>
            </>
          )}

          {!finished && stepIndex === 1 && (
            <>
              <h2 className="text-base font-black text-foreground">Como você gosta de mostrar as informações?</h2>
              <div className="mt-3 flex flex-col gap-2" role="group" aria-label="Densidade de informação">
                {DENSITY_OPTIONS.map((option) => (
                  <ChoiceCard
                    key={option.id}
                    label={option.label}
                    detail={option.detail}
                    selected={answers.informationDensity === option.id}
                    onSelect={() => setAnswers((current) => ({ ...current, informationDensity: option.id }))}
                    testId={`button-creative-profile-density-${option.id}`}
                  />
                ))}
              </div>
            </>
          )}

          {!finished && stepIndex === 2 && (
            <>
              <h2 className="text-base font-black text-foreground">O que deve chamar mais atenção?</h2>
              <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Ênfase do anúncio">
                {EMPHASIS_OPTIONS.map((option) => (
                  <ChoiceCard
                    key={option.id}
                    label={option.label}
                    selected={answers.emphasis === option.id}
                    onSelect={() => setAnswers((current) => ({ ...current, emphasis: option.id }))}
                    testId={`button-creative-profile-emphasis-${option.id}`}
                  />
                ))}
              </div>
            </>
          )}

          {!finished && stepIndex === 3 && (
            <>
              <h2 className="text-base font-black text-foreground">Qual direção visual você prefere?</h2>
              <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Paleta de cor">
                {COLOR_TENDENCY_OPTIONS.map((option) => (
                  <ChoiceCard
                    key={option.id}
                    label={option.label}
                    swatch={option.gradient}
                    selected={answers.colorTendency === option.id}
                    onSelect={() => setAnswers((current) => ({ ...current, colorTendency: option.id }))}
                    testId={`button-creative-profile-color-${option.id}`}
                  />
                ))}
              </div>
            </>
          )}

          {!finished && stepIndex === 4 && (
            <>
              <h2 className="text-base font-black text-foreground">Qual dessas artes você publicaria?</h2>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Exemplos demonstrativos de um produto fictício — nenhuma imagem foi gerada por IA.</p>
              <div className="mt-3 flex flex-col gap-2" role="group" aria-label="Arte demonstrativa">
                {EXAMPLE_ARTS.map((art) => (
                  <DemoAdCard key={art.id} art={art} selected={answers.selectedExample === art.id} onSelect={() => setAnswers((current) => ({ ...current, selectedExample: art.id }))} />
                ))}
              </div>
            </>
          )}

          {finished && saveState === "saving" && (
            <div className="flex flex-col items-center py-6 text-center" data-testid="text-creative-profile-saving">
              <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
              <p className="mt-3 text-xs font-bold text-muted-foreground">Salvando seu perfil...</p>
            </div>
          )}

          {finished && saveState === "error" && (
            <div className="flex flex-col items-center py-4 text-center" data-testid="text-creative-profile-save-error">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
                <AlertTriangle className="h-6 w-6 text-red-600" />
              </span>
              <h2 className="mt-3 text-base font-black text-foreground">Não foi possível salvar agora</h2>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                Suas respostas continuam aqui — tente novamente quando quiser.
              </p>
            </div>
          )}

          {finished && saveState === "idle" && (
            <div className="flex flex-col items-center py-4 text-center" data-testid="text-creative-profile-done">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Sparkles className="h-6 w-6 text-primary" />
              </span>
              <h2 className="mt-3 text-base font-black text-foreground">Seu estilo inicial está pronto</h2>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                O RevendaSmart vai usar essas escolhas como ponto de partida e aprender com suas próximas criações.
              </p>
              <p className="mt-3 rounded-xl bg-secondary/40 px-3 py-2 text-[11px] leading-relaxed text-foreground">
                Essas preferências são um ponto de partida. O RevendaSmart adapta o estilo ao produto anunciado.
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                Seu estilo ajuda a personalizar as artes, mas o RevendaSmart também considera o produto, contraste e o
                objetivo da campanha para criar anúncios mais adequados.
              </p>
            </div>
          )}
        </div>

        <div className="rs-overlay-safe-bottom flex items-center gap-2 border-t border-border/60 px-4 py-3">
          {!finished && stepIndex > 0 && (
            <button
              type="button"
              onClick={handleBack}
              className="flex min-h-11 items-center gap-1 rounded-xl border border-border bg-white px-4 text-xs font-black text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              data-testid="button-creative-profile-back"
            >
              <ArrowLeft className="h-4 w-4" />
              Voltar
            </button>
          )}
          {!finished && stepIndex === 0 && (
            <button
              type="button"
              onClick={onSkip}
              className="min-h-11 rounded-xl px-3 text-xs font-bold text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              data-testid="button-creative-profile-skip"
            >
              Pular por enquanto
            </button>
          )}
          <span className="flex-1" />
          {!finished && (
            <button
              type="button"
              onClick={handleContinue}
              disabled={!canContinue}
              className="min-h-11 flex-1 rounded-xl bg-primary px-4 text-xs font-black text-primary-foreground transition disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:flex-none"
              data-testid="button-creative-profile-continue"
            >
              {stepIndex === TOTAL_STEPS - 1 ? "Concluir" : "Continuar"}
            </button>
          )}
          {finished && saveState === "error" && (
            <button
              type="button"
              onClick={handleRetrySave}
              className="min-h-11 flex-1 rounded-xl bg-primary px-4 text-xs font-black text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              data-testid="button-creative-profile-retry-save"
            >
              Tentar novamente
            </button>
          )}
          {finished && saveState === "idle" && (
            <button
              type="button"
              onClick={handleDismiss}
              className="min-h-11 flex-1 rounded-xl bg-primary px-4 text-xs font-black text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              data-testid="button-creative-profile-finish"
            >
              Continuar para o Anúncios Pro
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
