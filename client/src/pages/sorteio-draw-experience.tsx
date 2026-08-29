import { useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import {
  buildDrawAnimationBalls, DRAW_ANIMATION_PHASE_MS, DRAW_ANIMATION_REDUCED_PHASE_MS,
  formatCampaignNumber, resolveInitialDrawAnimationResult,
} from "@shared/promotional-campaigns";
import type { OfficialDrawResult } from "@shared/promotional-campaigns";

/**
 * PROMOTIONAL-CAMPAIGNS-SECURE-DRAW-VISUAL-07 — camada de APRESENTAÇÃO do sorteio, full-screen. NUNCA
 * decide o vencedor: em modo "new" chama POST /draw e só entra em cena depois que o backend já persistiu
 * o resultado oficial (§1); em modo "replay" nem chama a API — só reproduz a apresentação em cima de um
 * `existingDraw` que já existe (§11/§12, nunca cria um segundo drawId). As bolinhas decorativas do globo
 * usam Math.random() só para POSIÇÃO/ordem visual — o número final revelado é sempre
 * `result.winningNumber`, nunca calculado aqui (§2).
 */
type DrawPhase = "requesting" | "countdown" | "spinning" | "decelerating" | "reveal_number" | "reveal_winner" | "complete" | "error";

const MAX_DECORATIVE_BALLS = 24;

interface SorteioDrawExperienceProps {
  readonly campaignId: string;
  readonly campaignTitle: string;
  readonly numberStart: number;
  readonly numberEnd: number;
  readonly mode: "new" | "replay";
  /** Obrigatório em modo "replay"; ignorado (sempre null) em modo "new". */
  readonly existingDraw: OfficialDrawResult | null;
  readonly onClose: () => void;
  /** Chamado só em modo "new", uma vez, com o resultado oficial recém-persistido. */
  readonly onDrawComplete: (draw: OfficialDrawResult) => void;
}

export default function SorteioDrawExperience({
  campaignId, campaignTitle, numberStart, numberEnd, mode, existingDraw, onClose, onDrawComplete,
}: SorteioDrawExperienceProps) {
  const [phase, setPhase] = useState<DrawPhase>(mode === "new" ? "requesting" : "countdown");
  const [result, setResult] = useState<OfficialDrawResult | null>(resolveInitialDrawAnimationResult(mode, existingDraw));
  const [countdownValue, setCountdownValue] = useState(3);
  const [errorMessage, setErrorMessage] = useState("");
  const requestStartedRef = useRef(false);
  const reducedMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const timings = reducedMotion ? DRAW_ANIMATION_REDUCED_PHASE_MS : DRAW_ANIMATION_PHASE_MS;

  // §1 — a ÚNICA chamada de rede desta tela: acontece uma vez, antes de qualquer fase visual iniciar.
  useEffect(() => {
    if (mode !== "new" || requestStartedRef.current) return;
    requestStartedRef.current = true;
    apiRequest<{ draw: OfficialDrawResult }>(`/api/admin/sorteios/campaigns/${campaignId}/draw`, { auth: true, method: "POST" })
      .then((data) => {
        setResult(data.draw);
        onDrawComplete(data.draw);
        setPhase("countdown");
      })
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : "Não foi possível realizar o sorteio.");
        setPhase("error");
      });
  }, [mode, campaignId, onDrawComplete]);

  useEffect(() => {
    if (phase !== "countdown") return;
    if (reducedMotion) {
      const timeout = setTimeout(() => setPhase("reveal_number"), timings.countdown);
      return () => clearTimeout(timeout);
    }
    setCountdownValue(3);
    const interval = setInterval(() => setCountdownValue((value) => Math.max(0, value - 1)), 1000);
    const timeout = setTimeout(() => { clearInterval(interval); setPhase("spinning"); }, timings.countdown);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, [phase, reducedMotion, timings.countdown]);

  useEffect(() => {
    if (phase !== "spinning") return;
    const timeout = setTimeout(() => setPhase("decelerating"), timings.spinning);
    return () => clearTimeout(timeout);
  }, [phase, timings.spinning]);

  useEffect(() => {
    if (phase !== "decelerating") return;
    const timeout = setTimeout(() => setPhase("reveal_number"), timings.decelerating);
    return () => clearTimeout(timeout);
  }, [phase, timings.decelerating]);

  useEffect(() => {
    if (phase !== "reveal_number") return;
    const timeout = setTimeout(() => setPhase("reveal_winner"), timings.revealNumber);
    return () => clearTimeout(timeout);
  }, [phase, timings.revealNumber]);

  useEffect(() => {
    if (phase !== "reveal_winner") return;
    const timeout = setTimeout(() => setPhase("complete"), timings.revealWinner);
    return () => clearTimeout(timeout);
  }, [phase, timings.revealWinner]);

  // §7 — subconjunto decorativo do range da campanha; o número vencedor SEMPRE está incluído (§2/§20: a
  // bolinha final revelada tem que corresponder a um número realmente renderizado no globo). Só é
  // calculado depois que `result` existe — nunca antes de o backend confirmar o vencedor.
  const balls = useMemo(
    () => (result ? buildDrawAnimationBalls(numberStart, numberEnd, result.winningNumber, MAX_DECORATIVE_BALLS) : []),
    [result, numberStart, numberEnd],
  );

  const canClose = phase === "complete" || phase === "error";

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-1 overflow-hidden bg-background p-6 text-center"
      data-testid="draw-experience-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Apuração do sorteio"
    >
      <button
        type="button"
        onClick={onClose}
        disabled={!canClose}
        aria-label="Fechar"
        data-testid="button-close-draw-experience-x"
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-sm font-black text-muted-foreground disabled:opacity-30"
      >
        ✕
      </button>
      <p className="mb-2 max-w-xs truncate text-xs font-black uppercase tracking-wide text-muted-foreground">{campaignTitle}</p>

      {phase === "requesting" && (
        <div data-testid="phase-requesting" className="space-y-2">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
          <p className="text-sm font-bold text-muted-foreground">Preparando o sorteio…</p>
        </div>
      )}

      {phase === "error" && (
        <div data-testid="phase-error" className="space-y-3">
          <p className="text-sm font-bold text-rose-600" data-testid="text-draw-error">{errorMessage}</p>
          <button type="button" onClick={onClose} data-testid="button-close-draw-experience" className="rounded-full bg-secondary px-5 py-2 text-xs font-black text-foreground">
            Fechar
          </button>
        </div>
      )}

      {phase === "countdown" && (
        <div data-testid="phase-countdown">
          <p className="mb-3 text-xs font-black uppercase tracking-wide text-muted-foreground">Preparando o sorteio</p>
          {reducedMotion ? (
            <p className="text-2xl font-black text-primary">Sorteando…</p>
          ) : (
            <p className="text-7xl font-black text-primary" data-testid="text-countdown">{countdownValue > 0 ? countdownValue : ""}</p>
          )}
        </div>
      )}

      {(phase === "spinning" || phase === "decelerating") && (
        <div data-testid={`phase-${phase}`} className="flex flex-col items-center gap-4">
          <div
            className={`relative flex h-56 w-56 items-center justify-center rounded-full border-4 border-primary/30 bg-secondary/40 ${phase === "spinning" ? "rs-draw-spin" : "rs-draw-decelerate"}`}
            data-testid="draw-globe"
          >
            {balls.map((number, index) => {
              const angle = (360 / balls.length) * index;
              return (
                <span
                  key={number}
                  className="absolute flex h-9 w-9 items-center justify-center rounded-full bg-white text-[11px] font-black text-foreground shadow"
                  style={{ transform: `rotate(${angle}deg) translate(96px) rotate(-${angle}deg)` }}
                >
                  {formatCampaignNumber(number)}
                </span>
              );
            })}
          </div>
          <p className="text-sm font-bold text-muted-foreground">{phase === "spinning" ? "Sorteando…" : "Definindo o número…"}</p>
        </div>
      )}

      {(phase === "reveal_number" || phase === "reveal_winner" || phase === "complete") && result && (
        <div className="flex flex-col items-center gap-1.5" data-testid="phase-reveal">
          <p className="text-xs font-black uppercase tracking-wide text-primary">Número sorteado</p>
          <p className="rs-draw-pulse text-7xl font-black text-primary" data-testid="text-drawn-number">
            {formatCampaignNumber(result.winningNumber)}
          </p>
          {(phase === "reveal_winner" || phase === "complete") && (
            <>
              <p className="mt-2 text-lg font-black text-foreground" data-testid="text-drawn-winner">🎉 {result.winnerDisplayNameSnapshot}</p>
              {phase === "complete" && (
                <>
                  <p className="text-sm text-muted-foreground" data-testid="text-drawn-prize">{result.prizeNameSnapshot}</p>
                  <button
                    type="button"
                    onClick={onClose}
                    data-testid="button-close-draw-experience"
                    className="mt-5 rounded-full bg-primary px-6 py-2.5 text-xs font-black text-white"
                  >
                    Ver resultado
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
