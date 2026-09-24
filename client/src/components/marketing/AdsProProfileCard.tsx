import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { AlertCircle, Palette, RefreshCw, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import type { AdsProCreativeProfileV1 } from "@shared/ads-pro/creative-profile";
import {
  clearAdsProCreativeProfile,
  getAdsProCreativeProfile,
  saveAdsProCreativeProfile,
} from "@/lib/ads-pro-profile-persistence";
import { getFirebaseAuth } from "@/lib/firebase";
import {
  getAdsProStyleDescription,
  getAdsProStyleLabel,
} from "@/lib/ads-pro-style-presentation";

const AdsProStyleQuizModal = lazy(() =>
  import("./AdsProStyleQuizModal").then((m) => ({ default: m.AdsProStyleQuizModal }))
);

export interface AdsProProfileCardProps {
  readonly getProfileImpl?: () => Promise<AdsProCreativeProfileV1 | null>;
  readonly saveProfileImpl?: (profile: unknown) => Promise<AdsProCreativeProfileV1>;
  readonly clearProfileImpl?: () => Promise<void>;
  readonly onProfileChange?: (profile: AdsProCreativeProfileV1 | null) => void;
  readonly className?: string;
}

type CardState =
  | { readonly phase: "loading" }
  | { readonly phase: "loaded"; readonly profile: AdsProCreativeProfileV1 | null }
  | { readonly phase: "error"; readonly message: string };

export function AdsProProfileCard({
  getProfileImpl = getAdsProCreativeProfile,
  saveProfileImpl = saveAdsProCreativeProfile,
  clearProfileImpl = clearAdsProCreativeProfile,
  onProfileChange,
  className = "",
}: AdsProProfileCardProps) {
  const [state, setState] = useState<CardState>({ phase: "loading" });
  const [isQuizOpen, setIsQuizOpen] = useState<boolean>(false);
  const [isClearing, setIsClearing] = useState<boolean>(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState<boolean>(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const isMountedRef = useRef<boolean>(true);

  const loadProfile = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const profile = await getProfileImpl();
      if (!isMountedRef.current) return;
      setState({ phase: "loaded", profile });
      onProfileChange?.(profile);
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      const message =
        err instanceof Error
          ? err.message
          : "Não foi possível carregar seu estilo visual.";
      setState({ phase: "error", message });
    }
  }, [getProfileImpl, onProfileChange]);

  useEffect(() => {
    isMountedRef.current = true;
    const isInjectedProfileLoader = getProfileImpl !== getAdsProCreativeProfile;
    if (isInjectedProfileLoader) {
      void loadProfile();
      return () => {
        isMountedRef.current = false;
      };
    }

    const auth = getFirebaseAuth();
    if (!auth) {
      setState({ phase: "error", message: "Autenticação indisponível." });
      return () => {
        isMountedRef.current = false;
      };
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!isMountedRef.current) return;
      if (!user) {
        setState({ phase: "loaded", profile: null });
        onProfileChange?.(null);
        return;
      }
      void loadProfile();
    });

    return () => {
      isMountedRef.current = false;
      unsubscribe?.();
    };
  }, [getProfileImpl, loadProfile, onProfileChange]);

  const handleOpenQuiz = useCallback(() => {
    setIsQuizOpen(true);
  }, []);

  const handleCloseQuiz = useCallback(() => {
    setIsQuizOpen(false);
  }, []);

  const handleQuizComplete = useCallback(
    (newProfile: AdsProCreativeProfileV1) => {
      setState({ phase: "loaded", profile: newProfile });
      setIsQuizOpen(false);
      onProfileChange?.(newProfile);
    },
    [onProfileChange]
  );

  const handleConfirmClear = useCallback(async () => {
    setIsClearing(true);
    setClearError(null);
    try {
      await clearProfileImpl();
      if (!isMountedRef.current) return;
      setIsClearing(false);
      setConfirmClearOpen(false);
      setState({ phase: "loaded", profile: null });
      onProfileChange?.(null);
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      setIsClearing(false);
      setClearError(
        err instanceof Error ? err.message : "Não foi possível remover sua preferência de estilo.",
      );
    }
  }, [clearProfileImpl, onProfileChange]);

  return (
    <div
      className={`min-w-0 rounded-2xl border border-primary/20 bg-primary/5 p-3.5 sm:p-4 ${className}`}
      data-testid="ads-pro-profile-card"
    >
      {/* ESTADO 1: LOADING */}
      {state.phase === "loading" && (
        <div
          className="flex min-h-24 items-center justify-center gap-2 py-4"
          data-testid="ads-pro-profile-loading"
        >
          <RefreshCw className="h-4 w-4 animate-spin text-primary" />
          <span className="text-xs font-semibold text-muted-foreground">
            Carregando preferências de estilo...
          </span>
        </div>
      )}

      {/* ESTADO 2: ERRO DE CARREGAMENTO */}
      {state.phase === "error" && (
        <div className="space-y-3" data-testid="ads-pro-profile-card-error">
          <div className="flex items-start gap-2 text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-black">Estilo Visual Ads Pro</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Não foi possível carregar seu estilo visual neste momento.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={loadProfile}
            className="min-h-11 inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-4 text-xs font-bold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            data-testid="button-ads-pro-retry-load"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Tentar novamente
          </button>
        </div>
      )}

      {/* ESTADO 3: PROFILE CARREGADO */}
      {state.phase === "loaded" && (
        <>
          {/* 3A: SEM PERFIL (NULL) */}
          {state.profile === null && (
            <div data-testid="ads-pro-profile-none">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <Palette className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-black text-foreground">
                      Estilo Visual Ads Pro
                    </h3>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    Defina sua preferência estética para guiar a direção de arte dos seus anúncios Pro.
                    Leva menos de um minuto e é 100% opcional.
                  </p>
                </div>
              </div>

              <div className="mt-3.5">
                <button
                  type="button"
                  onClick={handleOpenQuiz}
                  className="min-h-11 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-black text-primary-foreground shadow-sm transition hover:brightness-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  data-testid="button-ads-pro-define-style"
                >
                  <Sparkles className="h-4 w-4" />
                  Definir meu estilo visual
                </button>
              </div>
            </div>
          )}

          {/* 3B: COM PERFIL DEFINIDO */}
          {state.profile !== null && (
            <div data-testid="ads-pro-profile-defined">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <Palette className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-black text-foreground">
                      Estilo Visual Ads Pro
                    </h3>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    Sua identidade visual configurada direciona a harmonia estética dos seus anúncios.
                  </p>
                </div>
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-emerald-800">
                  ativo
                </span>
              </div>

              {state.profile.preferredStyles.length > 0 ? (
                <div className="mt-3 rounded-xl border border-primary/20 bg-background/80 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-bold text-muted-foreground">
                      Estilo principal:
                    </span>
                    <span
                      className="inline-flex items-center rounded-lg bg-primary px-2.5 py-0.5 text-xs font-black text-primary-foreground"
                      data-testid="badge-card-primary-style"
                    >
                      {getAdsProStyleLabel(state.profile.preferredStyles[0])}
                    </span>
                  </div>

                  <p className="mt-1.5 text-[11px] leading-relaxed text-foreground">
                    {getAdsProStyleDescription(state.profile.preferredStyles[0])}
                  </p>

                  {state.profile.preferredStyles.length > 1 && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pt-2 border-t border-border/40">
                      <span className="text-[10px] font-bold text-muted-foreground">
                        Afinidades secundárias:
                      </span>
                      {state.profile.preferredStyles.slice(1).map((style) => (
                        <span
                          key={style}
                          className="rounded-md border border-border bg-card px-2 py-0.5 text-[10px] font-semibold text-muted-foreground"
                          data-testid="badge-card-secondary-style"
                        >
                          {getAdsProStyleLabel(style)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div
                  className="mt-3 rounded-xl border border-dashed border-border bg-background/60 p-3"
                  data-testid="text-card-neutral-style"
                >
                  <p className="text-xs font-bold text-foreground">
                    Preferência neutra configurada
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Nenhum estilo visual prioritário fixado. As composições seguirão a estética padrão do produto.
                  </p>
                </div>
              )}

              {/* Ações: Refazer Quiz e Remover */}
              {!confirmClearOpen ? (
                <div className="mt-3.5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleOpenQuiz}
                    className="min-h-11 flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-primary/30 bg-background px-3 text-xs font-black text-primary transition hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    data-testid="button-ads-pro-retake-quiz"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Refazer teste de estilo
                  </button>

                  <button
                    type="button"
                    onClick={() => setConfirmClearOpen(true)}
                    className="min-h-11 inline-flex items-center justify-center gap-1 rounded-xl border border-transparent px-3 text-xs font-semibold text-muted-foreground transition hover:text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                    data-testid="button-ads-pro-clear-profile"
                    title="Remover preferência estética"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span className="sr-only sm:not-sr-only">Remover</span>
                  </button>
                </div>
              ) : (
                <div
                  className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-left space-y-2"
                  data-testid="confirm-clear-banner"
                >
                  <p className="text-xs font-bold text-destructive">
                    Remover preferências de estilo?
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Seus anúncios voltarão a usar o estilo neutro recomendado para cada produto.
                  </p>
                  {clearError && (
                    <p className="text-[11px] text-destructive" role="alert" data-testid="text-ads-pro-clear-error">
                      {clearError}
                    </p>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      disabled={isClearing}
                      onClick={handleConfirmClear}
                      className="min-h-10 rounded-lg bg-destructive px-3 text-xs font-black text-destructive-foreground transition hover:brightness-110 disabled:opacity-50"
                      data-testid="button-ads-pro-confirm-clear"
                    >
                      {isClearing ? "Removendo..." : "Sim, remover"}
                    </button>
                    <button
                      type="button"
                      disabled={isClearing}
                      onClick={() => setConfirmClearOpen(false)}
                      className="min-h-10 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground hover:bg-muted"
                      data-testid="button-ads-pro-cancel-clear"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* MODAL DO QUIZ DE ESTILO */}
      {isQuizOpen && (
        <Suspense fallback={null}>
          <AdsProStyleQuizModal
            isOpen={isQuizOpen}
            onClose={handleCloseQuiz}
            onComplete={handleQuizComplete}
            saveProfileImpl={saveProfileImpl}
          />
        </Suspense>
      )}
    </div>
  );
}
