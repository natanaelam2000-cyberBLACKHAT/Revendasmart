import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, Archive, Plus, Power, Search, Share2 } from "lucide-react";
import { Layout } from "@/components/layout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { useUserSettings } from "@/providers/UserSettingsProvider";
import { archiveService, listServices, updateService } from "@/lib/services-persistence";
import { formatCentsBRL } from "@/lib/service-work-helpers";
import { buildPublicServiceBookingUrl } from "@/lib/public-url";
import { waitForAuthReady } from "@/lib/firebase";
import { notifyError, notifySuccess } from "@/lib/notify";
import type { Service } from "@shared/services";

/**
 * HOTFIX-P0-D (rodada 2) — antes, não existia NENHUMA tela para ver/gerenciar os serviços já
 * cadastrados: /servicos/novo cria um, mas o dono nunca conseguia revisitar, desativar ou arquivar o
 * que já existe (o mesmo gap que travou a verificação ao vivo do P0-C: "reaparece na lista" não tinha
 * lista nenhuma para reaparecer). Espelha a estrutura de products.tsx (busca, filtro, card com ações
 * rápidas) reaproveitando 100% do domínio já existente (services-persistence.ts) — nenhuma escrita nova
 * no Firestore, nenhuma rota de servidor nova.
 */

type StatusFilter = "todos" | "ativos" | "inativos";

const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  todos: "Todos",
  ativos: "Ativos",
  inativos: "Inativos",
};

function pricingLabel(service: Service): string {
  if (service.pricing.mode === "fixed") return formatCentsBRL(service.pricing.priceCents);
  if (service.pricing.mode === "starting_at") return `A partir de ${formatCentsBRL(service.pricing.startingAtPriceCents)}`;
  return "Sob consulta";
}

export default function ServicesList() {
  const { settings } = useUserSettings();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // HOTFIX-P0-C (rodada 3) — distingue a primeira carga (sem dados prévios: um erro precisa bloquear
  // a tela toda) de um refresh que falhou depois de já ter carregado a lista real uma vez (mais seguro
  // manter os serviços já conhecidos visíveis do que trocar a tela inteira por um erro).
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todos");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [archiveConfirmId, setArchiveConfirmId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        // PRODUCT-QA-02 — mesmo motivo de service-agenda.tsx/service-work-detail.tsx: espera o Firebase
        // Auth confirmar o estado inicial da sessão antes de buscar dados dependentes de uid, para não
        // lançar UNAUTHENTICATED numa navegação de página cheia para /servicos antes da sessão
        // persistida restaurar.
        await waitForAuthReady();
        if (cancelled) return;
        const list = await listServices();
        if (!cancelled) {
          setServices(list);
          setHasLoadedOnce(true);
        }
      } catch (err) {
        if (cancelled) return;
        console.error("[services-list] Failed to load services:", err);
        setError("Não foi possível carregar seus serviços.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [reloadToken]);

  const normalizedSearch = useMemo(() => search.trim().toLowerCase(), [search]);

  const filteredServices = useMemo(() => {
    return services.filter((service) => {
      const matchesSearch = !normalizedSearch || service.name.toLowerCase().includes(normalizedSearch);
      const matchesStatus =
        statusFilter === "todos" ? true : statusFilter === "ativos" ? service.active : !service.active;
      return matchesSearch && matchesStatus;
    });
  }, [services, normalizedSearch, statusFilter]);

  const bookingLinkUrl = useMemo(() => buildPublicServiceBookingUrl(settings.catalogSlug), [settings.catalogSlug]);

  const handleToggleActive = async (service: Service) => {
    setPendingId(service.id);
    try {
      await updateService(service.id, { active: !service.active });
      notifySuccess(service.active ? "Serviço desativado." : "Serviço ativado.");
      refresh();
    } catch (err) {
      console.error("[services-list] Failed to toggle active:", err);
      notifyError("Não foi possível atualizar o serviço.");
    } finally {
      setPendingId(null);
    }
  };

  const handleShare = (service: Service) => {
    if (!bookingLinkUrl) {
      notifyError("Configure o link do seu catálogo em Configurações antes de compartilhar.");
      return;
    }
    const msg = `Olá! Este é um dos meus serviços:\n\n*${service.name}*\nValor: ${pricingLabel(service)}\n\nAgende pelo link:\n${bookingLinkUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const handleArchiveConfirm = async (serviceId: string) => {
    setPendingId(serviceId);
    try {
      await archiveService(serviceId);
      notifySuccess("Serviço arquivado.");
      setArchiveConfirmId(null);
      refresh();
    } catch (err) {
      console.error("[services-list] Failed to archive service:", err);
      notifyError("Não foi possível arquivar o serviço.");
    } finally {
      setPendingId(null);
    }
  };

  const archiveTarget = useMemo(() => services.find((service) => service.id === archiveConfirmId), [services, archiveConfirmId]);

  return (
    <Layout>
      <div className="min-h-full bg-background pb-28 lg:pb-8">
        <div className="border-b border-border/50 bg-white">
          <div className="mx-auto max-w-6xl space-y-4 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-primary">Serviços</p>
                <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">Meus serviços</h1>
                <p className="mt-1 text-sm text-muted-foreground">{services.length} serviço{services.length === 1 ? "" : "s"} cadastrado{services.length === 1 ? "" : "s"}</p>
              </div>
              <Link href="/servicos/novo">
                <a className="rs-pressable flex items-center gap-2 whitespace-nowrap rounded-xl bg-primary px-4 py-3 text-xs font-semibold text-white shadow-sm">
                  <Plus className="h-4 w-4" /> Novo serviço
                </a>
              </Link>
            </div>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
              <input
                type="text"
                placeholder="Buscar por nome..."
                className="w-full rounded-xl border border-border/60 bg-muted py-3 pl-11 pr-4 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                data-testid="input-services-search"
              />
            </div>
            <div className="flex gap-1.5 overflow-x-auto hide-scrollbar">
              {(Object.keys(STATUS_FILTER_LABEL) as StatusFilter[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStatusFilter(value)}
                  aria-pressed={statusFilter === value}
                  data-testid={`filter-services-${value}`}
                  className={`min-h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-[11px] font-bold transition-colors ${
                    statusFilter === value ? "border-primary bg-primary/10 text-primary" : "border-border bg-white text-muted-foreground"
                  }`}
                >
                  {STATUS_FILTER_LABEL[value]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:px-8">
          {/* HOTFIX-P0-C (rodada 3) — erro só substitui a lista inteira quando não há dados prévios
              para preservar; se já existia uma carga real antes (ex.: refresh que falhou por
              instabilidade transitória de rede/WebChannel), o erro vira um aviso acima da lista
              existente, nunca uma troca silenciosa para "0 serviços". */}
          {error && hasLoadedOnce && services.length > 0 && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" data-testid="banner-load-error-stale-data">
              <span>Não foi possível atualizar agora. Mostrando os últimos serviços carregados. {error}</span>
              <button type="button" onClick={refresh} disabled={loading} className="rs-pressable shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-red-800 shadow-sm disabled:opacity-50">Tentar novamente</button>
            </div>
          )}
          {loading && !hasLoadedOnce ? (
            <PageSkeleton variant="products" count={4} />
          ) : error && (!hasLoadedOnce || services.length === 0) ? (
            <EmptyState
              icon={<AlertTriangle className="h-12 w-12 text-red-400" />}
              title="Ocorreu um erro temporário."
              description={error}
              action={<button type="button" onClick={refresh} disabled={loading} className="rs-pressable w-full rounded-2xl bg-primary py-3 text-center text-xs font-semibold text-white hover:shadow-lg disabled:opacity-50">Tentar novamente</button>}
            />
          ) : filteredServices.length === 0 ? (
            <EmptyState
              icon={<Search className="h-12 w-12 text-primary/40" />}
              title={services.length === 0 ? "Nenhum serviço cadastrado" : "Nenhum serviço encontrado"}
              description={services.length === 0 ? "Cadastre seu primeiro serviço para começar a receber agendamentos." : "Tente outro termo ou limpe os filtros."}
              action={
                services.length === 0 ? (
                  <Link href="/servicos/novo">
                    <a className="rs-pressable w-full rounded-2xl bg-primary py-3 text-center text-xs font-semibold text-white hover:shadow-lg">Cadastrar serviço</a>
                  </Link>
                ) : (
                  <button type="button" onClick={() => { setSearch(""); setStatusFilter("todos"); }} className="rs-pressable w-full rounded-2xl bg-secondary py-3 text-xs font-semibold text-foreground hover:bg-secondary/80">
                    Limpar filtros
                  </button>
                )
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredServices.map((service) => (
                <article key={service.id} className="rs-card-interactive flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-white shadow-sm" data-testid={`card-service-${service.id}`}>
                  <div className="flex-1 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-2 text-sm font-bold text-foreground">{service.name}</p>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${service.active ? "bg-emerald-100 text-emerald-700" : "bg-secondary text-muted-foreground"}`}>
                        {service.active ? "Ativo" : "Inativo"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-black text-primary">{pricingLabel(service)}</p>
                    {typeof service.durationMinutes === "number" && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{service.durationMinutes} min</p>
                    )}
                    {!service.published && (
                      <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-amber-600">Oculto no link de agendamento</p>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 border-t border-border/40 p-2">
                    <button
                      type="button"
                      onClick={() => handleShare(service)}
                      className="flex min-w-0 items-center justify-center gap-1 rounded-xl bg-green-50 px-1 py-2 text-[10px] font-semibold text-green-700"
                      title="Compartilhar WhatsApp"
                      data-testid={`button-share-service-${service.id}`}
                    >
                      <Share2 className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">Compartilhar</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleActive(service)}
                      disabled={pendingId === service.id}
                      className="flex min-w-0 items-center justify-center gap-1 rounded-xl bg-primary/10 px-1 py-2 text-[10px] font-semibold text-primary disabled:opacity-60"
                      title={service.active ? "Desativar" : "Ativar"}
                      data-testid={`button-toggle-service-${service.id}`}
                    >
                      <Power className="h-3.5 w-3.5 shrink-0" /> <span>{service.active ? "Desativar" : "Ativar"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setArchiveConfirmId(service.id)}
                      className="flex min-w-0 items-center justify-center gap-1 rounded-xl bg-red-50 px-1 py-2 text-[10px] font-semibold text-red-600"
                      title="Arquivar"
                      data-testid={`button-archive-service-${service.id}`}
                    >
                      <Archive className="h-3.5 w-3.5 shrink-0" /> <span>Arquivar</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        {archiveTarget && (
          <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/70 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,calc(env(safe-area-inset-bottom)+1rem))] backdrop-blur-sm">
            <div className="rs-sheet-enter flex w-full max-w-md flex-col overflow-hidden rounded-t-[2rem] bg-white shadow-2xl sm:rounded-[2rem]">
              <div className="px-6 pt-6 pb-4 text-center">
                <h2 className="text-xl font-semibold text-foreground">Arquivar serviço?</h2>
                <p className="mt-1 text-sm text-muted-foreground">"{archiveTarget.name}" deixa de aparecer no link de agendamento e na agenda. Você pode reativar depois em Serviços.</p>
              </div>
              <div className="flex shrink-0 gap-3 border-t border-border/60 bg-white/95 px-6 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] backdrop-blur">
                <button onClick={() => setArchiveConfirmId(null)} className="min-h-12 flex-1 rounded-2xl bg-secondary text-xs font-semibold text-foreground transition-colors hover:bg-secondary/80">
                  Cancelar
                </button>
                <button
                  onClick={() => handleArchiveConfirm(archiveTarget.id)}
                  disabled={pendingId === archiveTarget.id}
                  className="min-h-12 flex-1 rounded-2xl bg-red-500 text-xs font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-60"
                  data-testid="button-confirm-archive-service"
                >
                  {pendingId === archiveTarget.id ? "Arquivando..." : "Arquivar"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
