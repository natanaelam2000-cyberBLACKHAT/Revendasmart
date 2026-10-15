import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { Ticket, Plus, ChevronRight, ArrowLeft, Share2, Copy, Play, Pause, CheckCircle2, Ban } from "lucide-react";
import { Layout } from "@/components/layout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { useClientsLiteData } from "@/hooks/useClientsLiteData";
import { apiRequest, ApiError } from "@/lib/api-client";
import { buildSorteioPublicUrl, copySorteioLink, shareSorteioLink } from "@/lib/sorteios-link";
import { notifyError, notifySuccess } from "@/lib/notify";
import type { PromotionalCampaign, PromotionalCampaignStatus } from "@shared/promotional-campaigns";

/**
 * PROMOTIONAL-CAMPAIGNS-01B §2 — listagem + detalhe/participantes/link num único chunk (evita pagar
 * duas vezes o custo fixo de Layout/useAdminAccess/PageSkeleton, que medimos ser mais caro do que o
 * "code splitting" economiza no orçamento TOTAL de JS — ver §2 do relatório: `performance:bundle-check`
 * soma TODOS os chunks emitidos, não só o carregado no boot, então dividir em mais arquivos não reduz
 * esse número, só desloca quando cada pedaço baixa; medido ao vivo antes de decidir). Só a criação
 * (`sorteios-create.tsx`) fica em chunk PRÓPRIO de verdade — só é aberta sob demanda (clique em "Criar
 * campanha"), então separá-la é economia real de carregamento sem custo de duplicar o gate de admin.
 */
const SorteiosCreate = lazy(() => import("./sorteios-create"));

const CARD = "rounded-2xl border border-border/60 bg-card text-card-foreground p-4";
const LABEL = "text-xs font-black uppercase tracking-wide text-muted-foreground";
const STATUS_LABEL: Record<PromotionalCampaignStatus, string> = { draft: "Rascunho", active: "Ativo", paused: "Pausado", finished: "Finalizado" };
const STATUS_COLOR: Record<PromotionalCampaignStatus, string> = {
  draft: "bg-slate-100 text-slate-700", active: "bg-emerald-100 text-emerald-700",
  paused: "bg-amber-100 text-amber-700", finished: "bg-slate-200 text-slate-600",
};
function formatDateRange(startsAt: string, endsAt: string): string {
  const fmt = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");
  return `${fmt(startsAt)} – ${fmt(endsAt)}`;
}
function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type CampaignWithMetrics = PromotionalCampaign & {
  numbersTotal: number; numbersClaimed: number; numbersAvailable: number; participantsCount: number;
};

function CampaignCard({ campaign, onOpen }: { campaign: CampaignWithMetrics; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} data-testid={`card-campaign-${campaign.id}`} className={`flex w-full items-center gap-3 ${CARD} text-left shadow-sm`}>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700"><Ticket className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-black text-foreground">{campaign.title}</span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${STATUS_COLOR[campaign.status]}`}>{STATUS_LABEL[campaign.status]}</span>
        </span>
        <span className="block truncate text-xs text-muted-foreground">{campaign.prizeName}</span>
        <span className="block text-[11px] text-muted-foreground">{formatDateRange(campaign.startsAt, campaign.endsAt)}</span>
        <span className="mt-1 block text-[11px] font-bold text-foreground">
          {campaign.numbersClaimed}/{campaign.numbersTotal} escolhidos · {campaign.numbersAvailable} disponíveis · {campaign.participantsCount} participantes
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function CampaignList() {
  const [, setLocation] = useLocation();
  const [campaigns, setCampaigns] = useState<CampaignWithMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiRequest<{ campaigns: CampaignWithMetrics[] }>("/api/admin/sorteios/campaigns", { auth: true });
      setCampaigns(data.campaigns);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Não foi possível carregar os sorteios.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  return (
    <Layout title="Sorteios Promocionais">
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <div className="flex items-center justify-end">
          <button type="button" onClick={() => setShowCreate(true)} data-testid="button-create-campaign" className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-black text-white">
            <Plus className="h-4 w-4" /> Criar campanha
          </button>
        </div>
        {loading && <PageSkeleton variant="cards" />}
        {!loading && campaigns.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border/60 bg-card p-8 text-center">
            <Ticket className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-bold text-muted-foreground">Você ainda não criou nenhum sorteio promocional.</p>
          </div>
        )}
        <div className="space-y-3">
          {campaigns.map((campaign) => (
            <CampaignCard key={campaign.id} campaign={campaign} onOpen={() => setLocation(`/sorteios/${campaign.id}`)} />
          ))}
        </div>
      </div>
      {showCreate && (
        <Suspense fallback={null}>
          <SorteiosCreate onClose={() => setShowCreate(false)} onCreated={load} />
        </Suspense>
      )}
    </Layout>
  );
}

interface Participant {
  customerId: string; clientName: string; clientPhone: string | null; qualifyingSpend: number;
  assignedNumberCount: number | null; entriesAuthorized: number; entriesClaimed: number; claimedNumbers: number[]; entriesAvailable: number;
}
interface Metrics {
  numbersTotal: number; numbersClaimed: number; numbersAvailable: number;
  participantsCount: number; qualifiedSalesTotal: number; utilizationRate: number;
}
interface DetailResponse { campaign: PromotionalCampaign; metrics: Metrics; participants: Participant[] }

const STATUS_ACTIONS: { status: PromotionalCampaignStatus; label: string; icon: typeof Play }[] = [
  { status: "active", label: "Ativar", icon: Play },
  { status: "paused", label: "Pausar", icon: Pause },
  { status: "finished", label: "Finalizar", icon: CheckCircle2 },
];

function GenerateLinkSection({ campaignId, participants, maxCount, onChanged }: { campaignId: string; participants: Participant[]; maxCount: number; onChanged: () => Promise<void> }) {
  const { clients } = useClientsLiteData();
  const [customerId, setCustomerId] = useState("");
  const [numberCount, setNumberCount] = useState("");
  const participant = participants.find((item) => item.customerId === customerId);
  const [generating, setGenerating] = useState(false);
  const [link, setLink] = useState<{ tokenId: string; url: string } | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [shareFallback, setShareFallback] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!customerId) { notifyError("Selecione um cliente."); return; }
    setGenerating(true);
    if (numberCount && (!Number.isInteger(Number(numberCount)) || Number(numberCount) < 1 || Number(numberCount) > maxCount)) { notifyError("Informe uma quantidade válida."); setGenerating(false); return; }
    if (!numberCount && participant?.assignedNumberCount == null) { notifyError("Defina a quantidade autorizada."); setGenerating(false); return; }
    try {
      const result = await apiRequest<{ tokenId: string; path: string }>(`/api/admin/sorteios/campaigns/${campaignId}/links`, { auth: true, method: "POST", body: { customerId, ...(numberCount ? { numberCount: Number(numberCount) } : {}) } });
      setLink({ tokenId: result.tokenId, url: buildSorteioPublicUrl(result.path) });
      setRevoked(false);
      setShareFallback(null);
      await onChanged();
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Não foi possível gerar o link.");
    } finally {
      setGenerating(false);
    }
  };
  const handleCopy = async () => {
    if (!link) return;
    try { await copySorteioLink(link.url); notifySuccess("Link copiado."); }
    catch { setShareFallback("Não foi possível copiar. Selecione o URL abaixo e copie manualmente."); }
  };
  const handleShare = async () => {
    if (!link) return;
    setShareFallback(null);
    const outcome = await shareSorteioLink(link.url);
    if (outcome === "unavailable") setShareFallback("Compartilhamento indisponível. Use Copiar link ou selecione o URL abaixo.");
    if (outcome === "failed") setShareFallback("Não foi possível compartilhar. Use Copiar link ou selecione o URL abaixo.");
  };
  const handleRevoke = async () => {
    if (!link || !window.confirm("Revogar este link? O cliente não conseguirá mais abri-lo.")) return;
    setRevoking(true);
    try {
      await apiRequest(`/api/admin/sorteios/campaigns/${campaignId}/links/${link.tokenId}/revoke`, { auth: true, method: "POST" });
      setRevoked(true);
      notifySuccess("Link revogado.");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Não foi possível revogar o link.");
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div className={`space-y-3 ${CARD}`}>
      <h3 className={LABEL}>Autorizar números e gerar link</h3>
      <select value={customerId} onChange={(event) => { setCustomerId(event.target.value); setNumberCount(""); }} className="rs-input flex h-9 w-full rounded-md border border-input bg-background text-foreground [color-scheme:light] dark:[color-scheme:dark] px-3 text-sm" data-testid="select-link-customer">
        <option className="bg-background text-foreground" value="">Selecione um cliente…</option>
        {clients.map((client) => <option className="bg-background text-foreground" key={client.id} value={client.id}>{client.name}</option>)}
      </select>
      {customerId && <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Autorizados: {participant?.entriesAuthorized ?? 0} · Escolhidos: {participant?.entriesClaimed ?? 0} · Restantes: {participant?.entriesAvailable ?? 0}</p>
        <label className="block text-sm font-bold text-foreground">Quantidade total autorizada
          <input type="number" min={Math.max(1, participant?.entriesClaimed ?? 0)} max={maxCount} value={numberCount} onChange={(event) => setNumberCount(event.target.value)} placeholder={participant?.assignedNumberCount != null ? `Manter ${participant.assignedNumberCount}` : "Informe a quantidade"} data-testid="input-authorized-number-count" className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-foreground" />
        </label>
        <p className="text-xs text-muted-foreground">O cliente pode confirmar parcialmente e voltar depois. Esta autorização vale para todos os links dele.</p>
      </div>}
      <button type="button" onClick={handleGenerate} disabled={generating} data-testid="button-generate-link" className="flex w-full items-center justify-center rounded-full bg-primary py-2.5 text-xs font-black text-white disabled:opacity-60">
        {generating ? "Gerando…" : "Gerar link"}
      </button>
      {link && !revoked && (
        <div className="flex items-center gap-2 rounded-xl bg-muted p-2.5">
          <a href={link.url} className="min-w-0 flex-1 select-text break-all text-[11px] text-foreground underline" data-testid="sorteio-public-link">{link.url}</a>
          <button type="button" onClick={handleShare} aria-label="Compartilhar link" className="shrink-0 rounded-full bg-primary p-2 text-white"><Share2 className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={handleCopy} aria-label="Copiar link" className="shrink-0 rounded-full bg-slate-200 p-2 text-slate-700"><Copy className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={handleRevoke} disabled={revoking} aria-label="Revogar link" data-testid="button-revoke-link" className="shrink-0 rounded-full bg-rose-100 p-2 text-rose-700 disabled:opacity-60"><Ban className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {shareFallback && <p role="alert" className="text-xs text-foreground">{shareFallback}</p>}
      {revoked && <p className="text-[11px] font-bold text-rose-700" data-testid="text-link-revoked">Link revogado — gere um novo se precisar.</p>}
    </div>
  );
}

function ParticipantQuantityEditor({
  campaignId,
  customerId,
  initialValue,
  maxNumberCount,
  onSaved,
}: {
  campaignId: string;
  customerId: string;
  initialValue: number | null;
  maxNumberCount: number;
  onSaved: () => Promise<void>;
}) {
  const [value, setValue] = useState(initialValue === null ? "" : String(initialValue));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const numberCount = Number(value);
    if (!Number.isInteger(numberCount) || numberCount <= 0 || numberCount > maxNumberCount) {
      notifyError(`Informe uma quantidade inteira entre 1 e ${maxNumberCount}.`);
      return;
    }
    setSaving(true);
    try {
      await apiRequest(`/api/admin/sorteios/campaigns/${campaignId}/participants/${encodeURIComponent(customerId)}/quantity`, {
        auth: true,
        method: "PATCH",
        body: { numberCount },
      });
      notifySuccess("Quantidade liberada atualizada.");
      await onSaved();
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Não foi possível atualizar a quantidade.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 flex items-end gap-2 rounded-xl bg-muted p-2">
      <label className="min-w-0 flex-1">
        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Liberados pelo admin</span>
        <input type="number" min="1" max={maxNumberCount} step="1" value={value} placeholder="Definir" onChange={(event) => setValue(event.target.value)} className="rs-input flex h-11 w-full rounded-md border border-input bg-background text-foreground px-2 text-xs" data-testid={`input-participant-number-count-${customerId}`} />
      </label>
      <button type="button" onClick={handleSave} disabled={saving} className="h-11 rounded-full bg-primary px-3 text-[11px] font-black text-white disabled:opacity-60" data-testid={`button-save-participant-number-count-${customerId}`}>
        {saving ? "Salvando…" : "Salvar"}
      </button>
    </div>
  );
}

function CampaignDetail({ campaignId }: { campaignId: string }) {
  const [, setLocation] = useLocation();
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [changingStatus, setChangingStatus] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setData(await apiRequest<DetailResponse>(`/api/admin/sorteios/campaigns/${campaignId}`, { auth: true }));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Não foi possível carregar a campanha.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, [campaignId]);

  const refreshParticipants = async () => {
    try { setData(await apiRequest<DetailResponse>(`/api/admin/sorteios/campaigns/${campaignId}`, { auth: true })); }
    catch { notifyError("Não foi possível atualizar os participantes; recarregue a página."); }
  };

  const handleStatusChange = async (status: PromotionalCampaignStatus) => {
    setChangingStatus(true);
    try {
      await apiRequest(`/api/admin/sorteios/campaigns/${campaignId}/status`, { auth: true, method: "PATCH", body: { status } });
      notifySuccess("Status atualizado.");
      await refreshParticipants();
    } catch (error) {
      if (error instanceof ApiError) {
        console.error("[sorteios-admin] falha ao mudar status da campanha", { status, httpStatus: error.status, code: error.code, requestId: error.requestId });
      } else {
        console.error("[sorteios-admin] falha inesperada ao mudar status da campanha", { status, error });
      }
      notifyError(error instanceof Error ? error.message : "Não foi possível atualizar o status.");
    } finally {
      setChangingStatus(false);
    }
  };

  if (loadError) return <Layout title="Sorteio"><div className="p-6 text-foreground"><p role="alert">{loadError}</p><button type="button" onClick={() => setLocation("/sorteios")} className="mt-3 underline">Voltar aos sorteios</button></div></Layout>;
  if (loading || !data) return <Layout title="Sorteio"><PageSkeleton variant="cards" /></Layout>;

  const { campaign, metrics, participants } = data;
  const numbersRemainingLow = metrics.numbersAvailable > 0 && metrics.numbersAvailable <= Math.max(3, Math.round(metrics.numbersTotal * 0.1));

  return (
    <Layout title={campaign.title}>
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <button type="button" onClick={() => setLocation("/sorteios")} className="flex items-center gap-1 text-xs font-bold text-muted-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Sorteios Promocionais
        </button>

        <div className={CARD}>
          {campaign.prizeImageUrl ? (
            <div className="mb-3 flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-secondary/50 to-secondary/10 p-3">
              <img src={campaign.prizeImageUrl} alt={campaign.prizeName} className="h-full w-full object-contain" />
            </div>
          ) : (
            <div
              className="mb-3 flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-secondary/50 to-secondary/10"
              data-testid="placeholder-no-prize-image"
            >
              <Ticket className="h-8 w-8 text-muted-foreground/50" />
              <p className="px-6 text-center text-xs font-bold text-muted-foreground">Nenhuma imagem de divulgação enviada</p>
            </div>
          )}
          <h1 className="text-lg font-black text-foreground">{campaign.title}</h1>
          <p className="text-sm text-muted-foreground">{campaign.prizeName}</p>
          {campaign.description && <p className="mt-1 text-xs text-muted-foreground">{campaign.description}</p>}
          {numbersRemainingLow && (
            <p className="mt-2 rounded-xl bg-amber-50 p-2 text-xs font-bold text-amber-700" data-testid="alert-numbers-low">
              Restam apenas {metrics.numbersAvailable} números disponíveis.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {STATUS_ACTIONS.filter((action) => action.status !== campaign.status).map(({ status, label, icon: Icon }) => (
              <button key={status} type="button" disabled={changingStatus} onClick={() => handleStatusChange(status)} data-testid={`button-status-${status}`} className="flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1.5 text-xs font-bold disabled:opacity-60">
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[
            ["Escolhidos", `${metrics.numbersClaimed}/${metrics.numbersTotal}`],
            ["Disponíveis", String(metrics.numbersAvailable)],
            ["Participantes", String(metrics.participantsCount)],
            ["Vendas qualificadas", formatBRL(metrics.qualifiedSalesTotal)],
            ["Taxa de utilização", `${metrics.utilizationRate}%`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-border/60 bg-card p-3">
              <div className="text-lg font-black text-foreground">{value}</div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>

        <GenerateLinkSection campaignId={campaignId} participants={participants} maxCount={campaign.numberEnd - campaign.numberStart + 1} onChanged={refreshParticipants} />

        <div className={CARD}>
          <h3 className={`mb-3 ${LABEL}`}>Participantes</h3>
          {participants.length === 0 && <p className="text-xs text-muted-foreground">Nenhum participante ainda.</p>}
          <div className="divide-y divide-border/50">
            {participants.map((participant) => (
              <div key={participant.customerId} className="py-2.5" data-testid={`row-participant-${participant.customerId}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-black text-foreground">{participant.clientName}</span>
                  <span className="text-xs text-muted-foreground">{formatBRL(participant.qualifyingSpend)}</span>
                </div>
                {participant.clientPhone && <div className="text-[11px] text-muted-foreground">{participant.clientPhone}</div>}
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="font-bold text-foreground">Autorizados: {participant.entriesAuthorized} · Escolhidos: {participant.entriesClaimed}</span>
                  {participant.claimedNumbers.length > 0 && (
                    <span className="text-muted-foreground">Números: {participant.claimedNumbers.slice().sort((a, b) => a - b).join(", ")}</span>
                  )}
                  <span className="text-muted-foreground">Restantes: {participant.entriesAvailable}</span>
                </div>
                <ParticipantQuantityEditor key={`${participant.customerId}-${participant.assignedNumberCount}`} campaignId={campaignId} customerId={participant.customerId} initialValue={participant.assignedNumberCount} maxNumberCount={campaign.numberEnd - campaign.numberStart + 1} onSaved={refreshParticipants} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default function SorteiosAdmin() {
  const { isAdmin, loading: adminLoading } = useAdminAccess();
  const { campaignId } = useParams<{ campaignId?: string }>();

  if (adminLoading) return <Layout title="Sorteios Promocionais"><PageSkeleton variant="cards" /></Layout>;
  if (!isAdmin) {
    return (
      <Layout title="Sorteios Promocionais">
        <div className="mx-auto max-w-md px-4 py-16 text-center">
          <p className="text-sm font-bold text-muted-foreground">Esta área é restrita a administradores.</p>
        </div>
      </Layout>
    );
  }
  return campaignId ? <CampaignDetail campaignId={campaignId} /> : <CampaignList />;
}
