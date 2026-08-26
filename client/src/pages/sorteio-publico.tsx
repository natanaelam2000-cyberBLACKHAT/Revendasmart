import { useEffect, useMemo, useState } from "react";
import { useParams } from "wouter";
import { CheckCircle2, Ticket } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import { formatCampaignNumber } from "@shared/promotional-campaigns";

/**
 * PROMOTIONAL-CAMPAIGNS-01 §15-§21 — página pública do sorteio: SEM login, SEM bottom nav
 * administrativa, SEM acesso a dados privados. Autorização vem do token (`?t=`) da URL, nunca de uma
 * sessão Firebase — mesmo raciocínio de página pública que `public-catalog.tsx` já usa para o catálogo
 * compartilhável, mas aqui nem o slug da loja é necessário: o token já resolve campanha + cliente.
 */
interface PublicCampaignView {
  campaign: {
    title: string;
    description: string;
    prizeName: string;
    prizeImageUrl: string | null;
    startsAt: string;
    endsAt: string;
    numberStart: number;
    numberEnd: number;
  };
  claimable: boolean;
  entriesAvailable: number;
  myNumbers: number[];
  numbers: { number: number; status: "available" | "claimed" }[];
}

type ClaimDenyReason =
  | "INVALID_TOKEN" | "REVOKED_TOKEN" | "EXPIRED_TOKEN" | "CAMPAIGN_NOT_FOUND" | "CAMPAIGN_NOT_ACTIVE"
  | "OUTSIDE_CAMPAIGN_PERIOD" | "NO_NUMBERS_SELECTED" | "DUPLICATE_NUMBER_IN_PAYLOAD" | "NUMBER_OUT_OF_RANGE"
  | "EXCEEDS_AVAILABLE_ENTRIES" | "NUMBER_ALREADY_CLAIMED";

const DENY_MESSAGES: Record<ClaimDenyReason, string> = {
  INVALID_TOKEN: "Este link não é mais válido.",
  REVOKED_TOKEN: "Este link foi revogado.",
  EXPIRED_TOKEN: "Este link expirou.",
  CAMPAIGN_NOT_FOUND: "Sorteio não encontrado.",
  CAMPAIGN_NOT_ACTIVE: "Este sorteio não está ativo no momento.",
  OUTSIDE_CAMPAIGN_PERIOD: "Este sorteio não está no período de participação.",
  NO_NUMBERS_SELECTED: "Selecione ao menos um número.",
  DUPLICATE_NUMBER_IN_PAYLOAD: "Você selecionou o mesmo número mais de uma vez.",
  NUMBER_OUT_OF_RANGE: "Um dos números selecionados é inválido.",
  EXCEEDS_AVAILABLE_ENTRIES: "Você selecionou mais números do que os seus direitos disponíveis.",
  NUMBER_ALREADY_CLAIMED: "Um dos números escolhidos acabou de ser pego. Escolha outro número.",
};

function useTokenFromUrl(): string {
  return useMemo(() => new URLSearchParams(window.location.search).get("t") ?? "", []);
}

export default function SorteioPublico() {
  const { campaignSlug } = useParams<{ campaignSlug: string }>();
  const token = useTokenFromUrl();
  const [view, setView] = useState<PublicCampaignView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [justConfirmedNumbers, setJustConfirmedNumbers] = useState<number[] | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiRequest<PublicCampaignView>(`/api/public/sorteios/${campaignSlug}?t=${encodeURIComponent(token)}`);
      setView(data);
      setSelected([]);
    } catch {
      setLoadError("Este sorteio não foi encontrado ou o link não é mais válido.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) {
      setLoadError("Link inválido.");
      setLoading(false);
      return;
    }
    void load();
  }, [campaignSlug, token]);

  const toggleNumber = (number: number, status: "available" | "claimed") => {
    if (status === "claimed") return;
    setSelected((prev) => {
      if (prev.includes(number)) return prev.filter((value) => value !== number);
      if (!view || prev.length >= view.entriesAvailable) return prev;
      return [...prev, number];
    });
  };

  const handleConfirm = async () => {
    if (!view || selected.length === 0) return;
    setConfirming(true);
    setConfirmError(null);
    try {
      const result = await apiRequest<{ ok: boolean; denyReason?: ClaimDenyReason }>(`/api/public/sorteios/${campaignSlug}/claim`, {
        method: "POST",
        body: { token, numbers: selected },
      });
      if (!result.ok) {
        setConfirmError(result.denyReason ? DENY_MESSAGES[result.denyReason] : "Não foi possível confirmar. Tente novamente.");
        // §18/§19 — se um número acabou de ser pego, recarrega a grade para refletir o estado real.
        if (result.denyReason === "NUMBER_ALREADY_CLAIMED") await load();
        return;
      }
      setJustConfirmedNumbers([...selected].sort((a, b) => a - b));
      await load();
    } catch {
      setConfirmError("Não foi possível confirmar. Verifique sua conexão e tente novamente.");
    } finally {
      setConfirming(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Ticket className="h-8 w-8 animate-pulse text-primary" />
      </div>
    );
  }

  if (loadError || !view) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="text-center">
          <Ticket className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-sm font-bold text-muted-foreground">{loadError ?? "Sorteio indisponível."}</p>
        </div>
      </div>
    );
  }

  const { campaign } = view;

  return (
    <div className="min-h-screen bg-slate-50 pb-28">
      <div className="mx-auto max-w-md px-4 py-6">
        {campaign.prizeImageUrl && (
          <img src={campaign.prizeImageUrl} alt={campaign.prizeName} className="mb-4 aspect-square w-full rounded-3xl object-cover" />
        )}
        <h1 className="text-xl font-black text-foreground">{campaign.title}</h1>
        <p className="text-sm font-bold text-primary">{campaign.prizeName}</p>
        {campaign.description && <p className="mt-1 text-sm text-muted-foreground">{campaign.description}</p>}
        <p className="mt-1 text-xs text-muted-foreground">
          {new Date(campaign.startsAt).toLocaleDateString("pt-BR")} – {new Date(campaign.endsAt).toLocaleDateString("pt-BR")}
        </p>

        {!view.claimable && (
          <div className="mt-4 rounded-2xl bg-amber-50 p-3 text-xs font-bold text-amber-700">
            Este sorteio não está disponível para participação no momento.
          </div>
        )}

        {justConfirmedNumbers && (
          <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 p-3" data-testid="banner-participation-confirmed">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div>
              <p className="text-sm font-black text-emerald-700">Participação confirmada!</p>
              <p className="mt-1 text-xs font-black uppercase tracking-wide text-emerald-700/80">Seus números</p>
              <p className="text-sm font-bold text-foreground">{justConfirmedNumbers.map(formatCampaignNumber).join(" • ")}</p>
            </div>
          </div>
        )}
        {!justConfirmedNumbers && view.myNumbers.length > 0 && (
          <div className="mt-4 rounded-2xl border border-primary/20 bg-primary/5 p-3">
            <p className="text-xs font-black uppercase tracking-wide text-primary">Seus números</p>
            <p className="text-sm font-bold text-foreground">
              {view.myNumbers.map(formatCampaignNumber).join(" • ")}
            </p>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs font-bold text-muted-foreground">
            Você tem {view.entriesAvailable} {view.entriesAvailable === 1 ? "direito disponível" : "direitos disponíveis"}
          </p>
          {view.entriesAvailable > 0 && (
            <p className="text-xs font-black text-foreground" data-testid="text-selection-count">
              {selected.length} de {view.entriesAvailable} selecionados
            </p>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-bold text-muted-foreground" data-testid="legend-number-states">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-md border border-border/60 bg-white" /> Disponível</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-md border border-primary bg-primary" /> Selecionado</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-md bg-slate-200" /> Indisponível</span>
        </div>

        <div className="mt-2 grid grid-cols-6 gap-2 sm:grid-cols-8">
          {view.numbers.map(({ number, status }) => {
            const isSelected = selected.includes(number);
            const disabled = status === "claimed" || (!isSelected && !view.claimable) || (!isSelected && selected.length >= view.entriesAvailable);
            return (
              <button
                key={number}
                type="button"
                disabled={disabled}
                onClick={() => toggleNumber(number, status)}
                aria-label={`Número ${formatCampaignNumber(number)}${status === "claimed" ? ", já escolhido" : isSelected ? ", selecionado" : ", disponível"}`}
                aria-pressed={isSelected}
                data-testid={`button-number-${number}`}
                className={[
                  "flex h-11 min-w-11 items-center justify-center rounded-xl border text-sm font-black transition-colors",
                  status === "claimed"
                    ? "cursor-not-allowed border-transparent bg-slate-200 text-slate-400"
                    : isSelected
                      ? "border-primary bg-primary text-white"
                      : disabled
                        ? "cursor-not-allowed border-border/40 bg-white text-slate-300"
                        : "border-border/60 bg-white text-foreground active:scale-95",
                ].join(" ")}
              >
                {formatCampaignNumber(number)}
              </button>
            );
          })}
        </div>
      </div>

      {selected.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border/60 bg-white/95 p-4 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur">
          <div className="mx-auto max-w-md">
            {confirmError && <p className="mb-2 text-xs font-bold text-rose-600">{confirmError}</p>}
            <button
              type="button"
              onClick={handleConfirm}
              disabled={confirming}
              data-testid="button-confirm-numbers"
              className="flex w-full items-center justify-center rounded-full bg-primary py-3.5 text-sm font-black text-white disabled:opacity-60"
            >
              {confirming ? "Confirmando…" : `Confirmar ${selected.length} ${selected.length === 1 ? "número" : "números"}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
