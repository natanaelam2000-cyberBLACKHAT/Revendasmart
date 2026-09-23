import { bookingContactName } from "@shared/service-contact";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, ClipboardList, Search } from "lucide-react";
import { Layout } from "@/components/layout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { useClientsLiteData } from "@/hooks/useClientsLiteData";
import { listServiceWorks } from "@/lib/services-persistence";
import { financialStatusLabel, formatCentsBRL, serviceWorkStatusLabel } from "@/lib/service-work-helpers";
import { waitForAuthReady } from "@/lib/firebase";
import { deriveServiceWorkFinancials } from "@shared/services";
import type { ServiceWork, ServiceWorkStatus } from "@shared/services";

/**
 * HOTFIX-P0-D (rodada 2) — "Orçamentos/Ordens/Atendimentos" da nav de SERVICES/HYBRID: antes só existia
 * o detalhe de UM atendimento (/servicos/atendimentos/:workId, service-work-detail.tsx), nunca uma lista.
 * Reaproveita listServiceWorks (já existente em services-persistence.ts) e deriveServiceWorkFinancials
 * (shared/services.ts) — nenhum cálculo financeiro novo, só leitura e exibição do que o domínio já produz.
 */

type StatusFilter = "todos" | ServiceWorkStatus;

const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  todos: "Todos",
  planned: "Planejado",
  in_progress: "Em andamento",
  completed: "Concluído",
  cancelled: "Cancelado",
};

export default function ServiceWorksList() {
  const [works, setWorks] = useState<ServiceWork[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todos");
  const { clients } = useClientsLiteData();

  const clientNameById = useMemo(() => new Map(clients.map((client) => [client.id, client.name])), [clients]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        // PRODUCT-QA-02 — mesmo motivo de service-agenda.tsx/service-work-detail.tsx: espera o Firebase
        // Auth confirmar o estado inicial da sessão antes de buscar dados dependentes de uid, para não
        // lançar UNAUTHENTICATED numa navegação de página cheia para /servicos/atendimentos antes da
        // sessão persistida restaurar.
        await waitForAuthReady();
        if (cancelled) return;
        const list = await listServiceWorks();
        if (!cancelled) setWorks(list);
      } catch (err) {
        if (cancelled) return;
        console.error("[service-works-list] Failed to load service works:", err);
        setError("Não foi possível carregar seus atendimentos.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  const normalizedSearch = useMemo(() => search.trim().toLowerCase(), [search]);

  const filteredWorks = useMemo(() => {
    return works.filter((work) => {
      const clientName = bookingContactName(work, clientNameById);
      const matchesSearch = !normalizedSearch || clientName.toLowerCase().includes(normalizedSearch) || work.id.toLowerCase().includes(normalizedSearch);
      const matchesStatus = statusFilter === "todos" || work.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [works, normalizedSearch, statusFilter, clientNameById]);

  return (
    <Layout>
      <div className="min-h-full bg-background pb-28 lg:pb-8">
        <div className="border-b border-border/50 bg-white">
          <div className="mx-auto max-w-6xl space-y-4 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
            <div>
              <p className="text-xs font-semibold text-primary">Atendimentos</p>
              <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">Orçamentos e atendimentos</h1>
              <p className="mt-1 text-sm text-muted-foreground">{works.length} registro{works.length === 1 ? "" : "s"}</p>
            </div>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
              <input
                type="text"
                placeholder="Buscar por cliente..."
                className="w-full rounded-xl border border-border/60 bg-muted py-3 pl-11 pr-4 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                data-testid="input-service-works-search"
              />
            </div>
            <div className="flex gap-1.5 overflow-x-auto hide-scrollbar">
              {(Object.keys(STATUS_FILTER_LABEL) as StatusFilter[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStatusFilter(value)}
                  aria-pressed={statusFilter === value}
                  data-testid={`filter-service-works-${value}`}
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
          {loading ? (
            <PageSkeleton variant="products" count={4} />
          ) : error ? (
            <EmptyState icon={<AlertTriangle className="h-12 w-12 text-red-400" />} title="Ocorreu um erro temporário." description={error} />
          ) : filteredWorks.length === 0 ? (
            <EmptyState
              icon={<ClipboardList className="h-12 w-12 text-primary/40" />}
              title={works.length === 0 ? "Nenhum atendimento ainda" : "Nenhum atendimento encontrado"}
              description={works.length === 0 ? "Atendimentos aparecem aqui assim que você registrar um agendamento ou um atendimento manual." : "Tente outro termo ou limpe os filtros."}
              action={
                works.length > 0 ? (
                  <button type="button" onClick={() => { setSearch(""); setStatusFilter("todos"); }} className="rs-pressable w-full rounded-2xl bg-secondary py-3 text-xs font-semibold text-foreground hover:bg-secondary/80">
                    Limpar filtros
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-2.5">
              {filteredWorks.map((work) => {
                const financials = deriveServiceWorkFinancials(work);
                const clientName = bookingContactName(work, clientNameById);
                return (
                  <Link key={work.id} href={`/servicos/atendimentos/${work.id}`}>
                    <a className="rs-card-interactive flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-white p-4 shadow-sm" data-testid={`card-service-work-${work.id}`}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-foreground">{clientName}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{serviceWorkStatusLabel(work.status)} · {financialStatusLabel(financials.financialStatus)}</p>
                        <p className="mt-0.5 text-[10px] font-semibold text-muted-foreground">{work.customerId ? "Cliente associado" : "Não associado ao cadastro"}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-black text-primary">{formatCentsBRL(financials.netReceivedCents)}</p>
                        {financials.balanceCents > 0 && <p className="text-[10px] font-semibold text-amber-600">Falta {formatCentsBRL(financials.balanceCents)}</p>}
                      </div>
                    </a>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
