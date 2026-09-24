import { useCallback, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Check, Loader2, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ADS_PRO_STYLE_QUIZ_DEFINITION_V1,
  resolveCreativeProfileFromQuiz,
  type AdsProStyleQuizAnswer,
  type QuizQuestionId,
} from "@shared/ads-pro/style-quiz";
import type { AdsProCreativeProfileV1 } from "@shared/ads-pro/creative-profile";
import { saveAdsProCreativeProfile } from "@/lib/ads-pro-profile-persistence";
import {
  getAdsProStyleDescription,
  getAdsProStyleLabel,
} from "@/lib/ads-pro-style-presentation";

export interface AdsProStyleQuizModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onComplete?: (profile: AdsProCreativeProfileV1) => void;
  /** Injeção para testes sem Firestore */
  readonly saveProfileImpl?: (profile: unknown) => Promise<AdsProCreativeProfileV1>;
}

export function AdsProStyleQuizModal({
  isOpen,
  onClose,
  onComplete,
  saveProfileImpl = saveAdsProCreativeProfile,
}: AdsProStyleQuizModalProps) {
  const questions = ADS_PRO_STYLE_QUIZ_DEFINITION_V1.questions;
  const totalQuestions = questions.length; // 5

  const [currentStep, setCurrentStep] = useState<number>(0);
  const [answers, setAnswers] = useState<Partial<Record<QuizQuestionId, string>>>({});
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Reinicia o quiz de forma limpa
  const resetQuizState = useCallback(() => {
    setCurrentStep(0);
    setAnswers({});
    setIsSaving(false);
    setSaveError(null);
  }, []);

  const handleClose = useCallback(() => {
    if (isSaving) return; // Bloqueia fechamento durante gravação crítica
    resetQuizState();
    onClose();
  }, [isSaving, onClose, resetQuizState]);

  // Pergunta atual (quando currentStep < totalQuestions)
  const currentQuestion = questions[currentStep];

  // Seleção de opção para a pergunta atual (uma por pergunta, substituindo a anterior)
  const handleSelectOption = useCallback((optionId: string) => {
    if (!currentQuestion) return;
    setAnswers((prev) => ({
      ...prev,
      [currentQuestion.id]: optionId,
    }));
  }, [currentQuestion]);

  const handleNext = useCallback(() => {
    if (currentStep < totalQuestions) {
      setCurrentStep((prev) => prev + 1);
    }
  }, [currentStep, totalQuestions]);

  const handleBack = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
      setSaveError(null);
    }
  }, [currentStep]);

  // Cálculo do perfil derivado usando estritamente o engine determinístico 03B
  const derivedProfile: AdsProCreativeProfileV1 = useMemo(() => {
    const formattedAnswers: AdsProStyleQuizAnswer[] = Object.entries(answers)
      .filter(([, optId]) => Boolean(optId))
      .map(([qId, optId]) => ({
        questionId: qId,
        optionId: optId as string,
      }));

    return resolveCreativeProfileFromQuiz({ answers: formattedAnswers });
  }, [answers]);

  // Salvamento autoritativo via camada 03C
  const handleSave = useCallback(async () => {
    if (isSaving) return; // Guarda anti-double submit

    setIsSaving(true);
    setSaveError(null);

    try {
      const saved = await saveProfileImpl(derivedProfile);
      setIsSaving(false);
      resetQuizState();
      onComplete?.(saved);
      onClose();
    } catch (err: unknown) {
      setIsSaving(false);
      const msg = err instanceof Error ? err.message : "Erro ao salvar preferências";
      setSaveError(`Não foi possível salvar suas preferências: ${msg}`);
    }
  }, [derivedProfile, isSaving, onClose, onComplete, resetQuizState, saveProfileImpl]);

  const isResultStep = currentStep >= totalQuestions;
  const primaryStyle = derivedProfile.preferredStyles[0];
  const secondaryStyles = derivedProfile.preferredStyles.slice(1);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto overscroll-contain p-4 sm:p-6"
        data-testid="ads-pro-style-quiz-dialog"
      >
        <DialogHeader className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
              <Sparkles className="h-3 w-3" />
              Estilo Visual Ads Pro
            </span>
            {!isResultStep && (
              <span
                className="text-xs font-semibold text-muted-foreground"
                data-testid="text-ads-pro-quiz-step-indicator"
              >
                Pergunta {currentStep + 1} de {totalQuestions}
              </span>
            )}
          </div>
          <DialogTitle className="text-base sm:text-lg font-black text-foreground">
            {isResultStep
              ? "Resultado da sua Direção Visual"
              : currentQuestion?.title ?? "Pergunta do Quiz"}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {isResultStep
              ? "Confira o estilo derivado das suas escolhas para seus anúncios."
              : currentQuestion?.subtitle ?? ""}
          </DialogDescription>
        </DialogHeader>

        {/* Barra de Progresso visual */}
        {!isResultStep && (
          <div className="mt-2 space-y-1">
            <div
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={totalQuestions}
              aria-valuenow={currentStep + 1}
              className="h-1.5 overflow-hidden rounded-full bg-muted"
              data-testid="progress-ads-pro-quiz"
            >
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${((currentStep + 1) / totalQuestions) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* ETAPA DE PERGUNTA */}
        {!isResultStep && currentQuestion && (
          <div className="mt-4 space-y-3" role="radiogroup" aria-label={currentQuestion.title}>
            {currentQuestion.options.map((option) => {
              const isSelected = answers[currentQuestion.id] === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  tabIndex={isSelected || (!Object.prototype.hasOwnProperty.call(answers, currentQuestion.id) && option.id === currentQuestion.options[0]?.id) ? 0 : -1}
                  onKeyDown={(event) => {
                    const optionIndex = currentQuestion.options.findIndex((candidate) => candidate.id === option.id);
                    if (event.key === " " || event.key === "Enter") {
                      event.preventDefault();
                      handleSelectOption(option.id);
                      return;
                    }
                    if (event.key !== "ArrowRight" && event.key !== "ArrowDown" && event.key !== "ArrowLeft" && event.key !== "ArrowUp") return;
                    event.preventDefault();
                    const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
                    const nextOption = currentQuestion.options[(optionIndex + direction + currentQuestion.options.length) % currentQuestion.options.length];
                    handleSelectOption(nextOption.id);
                    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-testid="button-ads-pro-quiz-option-${nextOption.id}"]`)?.focus());
                  }}
                  aria-label={`${option.label}: ${option.description}`}
                  onClick={() => handleSelectOption(option.id)}
                  data-testid={`button-ads-pro-quiz-option-${option.id}`}
                  className={`flex min-h-12 w-full items-start gap-3 rounded-2xl border-2 p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 active:scale-95 ${
                    isSelected
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border/70 bg-card hover:border-primary/40 hover:bg-muted/30"
                  }`}
                >
                  <div
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition ${
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-muted-foreground/40 bg-background"
                    }`}
                    aria-hidden="true"
                  >
                    {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-xs sm:text-sm font-bold leading-tight ${
                        isSelected ? "text-primary" : "text-foreground"
                      }`}
                    >
                      {option.label}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                      {option.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* ETAPA DE RESULTADO */}
        {isResultStep && (
          <div className="mt-4 space-y-4" data-testid="ads-pro-quiz-result-screen">
            {primaryStyle ? (
              <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 text-left">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Estilo Principal
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <span
                    className="inline-flex items-center rounded-xl bg-primary px-3 py-1 text-sm font-black text-primary-foreground shadow-xs"
                    data-testid="badge-primary-style"
                  >
                    {getAdsProStyleLabel(primaryStyle)}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-foreground">
                  {getAdsProStyleDescription(primaryStyle)}
                </p>

                {secondaryStyles.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border/50">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Afinidades Secundárias:
                    </span>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {secondaryStyles.map((style) => (
                        <span
                          key={style}
                          className="rounded-lg border border-border bg-background px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"
                          data-testid="badge-secondary-style"
                        >
                          {getAdsProStyleLabel(style)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div
                className="rounded-2xl border border-dashed border-border p-4 text-center"
                data-testid="text-no-preference"
              >
                <p className="text-sm font-bold text-foreground">
                  Sem preferência definida
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Você optou por pular as perguntas. Nenhum estilo fixo será imposto; seus anúncios
                  utilizarão a composição neutra e equilibrada recomendada para cada produto.
                </p>
              </div>
            )}

            {saveError && (
              <div
                className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
                role="alert"
                data-testid="text-ads-pro-quiz-save-error"
              >
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-semibold">{saveError}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* NAVEGAÇÃO / FOOTER */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          {!isResultStep ? (
            <>
              <button
                type="button"
                onClick={handleBack}
                disabled={currentStep === 0}
                className="min-h-11 inline-flex items-center gap-1.5 rounded-xl border border-border px-3.5 text-xs font-bold text-foreground transition hover:bg-muted disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                data-testid="button-ads-pro-quiz-back"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Voltar
              </button>

              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={handleNext}
                  className="min-h-11 rounded-xl px-3 text-xs font-semibold text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  data-testid="button-ads-pro-quiz-skip"
                >
                  Pular pergunta
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  className="min-h-11 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-black text-primary-foreground shadow-sm transition hover:brightness-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  data-testid="button-ads-pro-quiz-next"
                >
                  {currentStep === totalQuestions - 1 ? "Ver resultado" : "Continuar"}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setCurrentStep(totalQuestions - 1)}
                disabled={isSaving}
                className="min-h-11 inline-flex items-center gap-1.5 rounded-xl border border-border px-3.5 text-xs font-bold text-foreground transition hover:bg-muted disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                data-testid="button-ads-pro-quiz-review"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Revisar respostas
              </button>

              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isSaving}
                  className="min-h-11 rounded-xl px-3 text-xs font-semibold text-muted-foreground transition hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  data-testid="button-ads-pro-quiz-cancel"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving}
                  className="min-h-11 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 text-xs font-black text-primary-foreground shadow-md transition hover:brightness-105 active:scale-95 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  data-testid="button-ads-pro-quiz-save"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      <span>Salvar preferências</span>
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
