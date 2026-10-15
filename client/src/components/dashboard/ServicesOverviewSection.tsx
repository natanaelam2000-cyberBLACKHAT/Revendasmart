import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { CalendarClock, ClipboardList, Users } from "lucide-react";
import { SectionCard, SummaryTile, shortNumber } from "./dashboard-ui";
import { waitForAuthReady } from "@/lib/firebase";
import { listServices, listServiceWorks } from "@/lib/services-persistence";
import { listServiceBookingsForResourceAndRange } from "@/lib/service-bookings-persistence";
import { addDaysToDateKey, computeLocalDayRangeUtc, todayDateKey } from "@/lib/service-agenda-helpers";
import { formatCentsBRL } from "@/lib/service-work-helpers";
import { format as formatLocalDate, ptBR } from "@/lib/date-utils";
import { deriveServiceWorkFinancials } from "@shared/services";
import type { Booking } from "@shared/service-bookings";
import type { Service, ServiceWork } from "@shared/services";
import type { Client } from "@/lib/mock-data";

const DEFAULT_SERVICE_RESOURCE_ID = "default";
const UPCOMING_BOOKINGS_WINDOW_DAYS = 14;
const UPCOMING_BOOKINGS_DISPLAY_LIMIT = 3;

/** Contagem usada pelo dashboard; vive aqui para compartilhar o mesmo chunk lazy da seção (um só download). */
export async function fetchDashboardServicesCount(): Promise<number> {
  await waitForAuthReady();
  const list = await listServices();
  return list ? list.length : 0;
}

/**
 * HOTFIX-P0-D (rodada 2, code-split) — extraído de dashboard.tsx (que estourou o orçamento de bundle,
 * 18.06/15 kB) para um chunk lazy próprio: quem vende só produto (a maioria) nunca baixa nada deste
 * arquivo, já que o import() abaixo só resolve quando needsServicesCount é true (mesmo gate de antes,
 * só que agora também controla o carregamento do CÓDIGO, não só da renderização). Reaproveita 100% dos
 * mesmos dados/derivações já usados no resto do app (services-persistence.ts, service-bookings-
 * persistence.ts, deriveServiceWorkFinancials) — nenhuma leitura ou cálculo novo além do que já existia
 * antes deste code-split.
 */
export default function ServicesOverviewSection({ clients }: { clients: Client[] }) {
  const [, setLocation] = useLocation();
  const [servicesList, setServicesList] = useState<Service[]>([]);
  const [serviceWorks, setServiceWorks] = useState<ServiceWork[]>([]);
  const [upcomingBookings, setUpcomingBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // PRODUCT-QA-02 — mesmo motivo de service-agenda.tsx/dashboard.tsx: espera o Firebase Auth
    // confirmar a sessão restaurada antes de ler dados dependentes de uid.
    waitForAuthReady()
      .then(() => {
        if (cancelled) return null;
        const timeZone = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
        const today = todayDateKey(timeZone);
        const { rangeStartAt } = computeLocalDayRangeUtc(today, timeZone);
        const { rangeEndAt } = computeLocalDayRangeUtc(addDaysToDateKey(today, UPCOMING_BOOKINGS_WINDOW_DAYS), timeZone);
        return Promise.all([
          listServices(),
          listServiceWorks(),
          listServiceBookingsForResourceAndRange(DEFAULT_SERVICE_RESOURCE_ID, rangeStartAt, rangeEndAt),
        ]);
      })
      .then((result) => {
        if (cancelled || !result) return;
        const [services, works, bookings] = result;
        setServicesList(services);
        setServiceWorks(works);
        setUpcomingBookings(bookings.filter((booking) => booking.status === "confirmed").sort((a, b) => a.startAt.localeCompare(b.startAt)));
      })
      .catch((err) => { console.error("[dashboard] Failed to load services overview:", err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const servicesById = useMemo(() => new Map(servicesList.map((service) => [service.id, service])), [servicesList]);
  const activeServicesCount = useMemo(() => servicesList.filter((service) => service.active).length, [servicesList]);
  const clientNameById = useMemo(() => new Map(clients.map((client) => [client.id, client.name])), [clients]);
  const servicesFinancials = useMemo(() => {
    let receivedCents = 0;
    let balanceCents = 0;
    for (const work of serviceWorks) {
      if (work.status === "cancelled") continue;
      const financials = deriveServiceWorkFinancials(work);
      receivedCents += financials.netReceivedCents;
      balanceCents += financials.balanceCents;
    }
    return { receivedCents, balanceCents };
  }, [serviceWorks]);

  return (
    <SectionCard title="Visão de serviços" eyebrow="Agenda e atendimentos">
      {loading ? (
        <div className="h-24 animate-pulse rounded-2xl bg-secondary/30" />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3" data-testid="services-overview-kpis">
            <SummaryTile label="Serviços ativos" value={shortNumber(activeServicesCount)} detail={`${shortNumber(servicesList.length)} cadastrados`} />
            <SummaryTile label="Clientes" value={shortNumber(clients.length)} />
            <SummaryTile label="Atendimentos" value={shortNumber(serviceWorks.length)} detail="Total registrado" />
            <SummaryTile label="Próximos agendamentos" value={shortNumber(upcomingBookings.length)} detail={`Próximos ${UPCOMING_BOOKINGS_WINDOW_DAYS} dias`} />
            <SummaryTile label="Receita recebida" value={formatCentsBRL(servicesFinancials.receivedCents)} />
            <SummaryTile label="A receber" value={formatCentsBRL(servicesFinancials.balanceCents)} />
          </div>

          {upcomingBookings.length > 0 && (
            <div className="space-y-2">
              {upcomingBookings.slice(0, UPCOMING_BOOKINGS_DISPLAY_LIMIT).map((booking) => (
                <button
                  key={booking.id}
                  type="button"
                  onClick={() => setLocation("/servicos/agenda")}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl bg-secondary/35 px-3 py-2.5 text-left text-sm"
                  data-testid={`upcoming-booking-${booking.id}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-black text-foreground">{servicesById.get(booking.serviceId)?.name || "Serviço"}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{(booking.customerId && clientNameById.get(booking.customerId)) || "Cliente"}</span>
                  </span>
                  <span className="shrink-0 text-xs font-bold text-primary">{formatLocalDate(new Date(booking.startAt), "dd/MM HH:mm", { locale: ptBR })}</span>
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <button type="button" onClick={() => setLocation("/servicos/novo")} className="flex flex-col items-center gap-1.5 rounded-2xl border border-primary/20 bg-primary/[0.04] px-2 py-3 text-primary" data-testid="button-quick-new-service">
              <ClipboardList className="h-4 w-4" />
              <span className="text-[10px] font-black">Novo serviço</span>
            </button>
            <button type="button" onClick={() => setLocation("/servicos/agenda")} className="flex flex-col items-center gap-1.5 rounded-2xl border border-primary/20 bg-primary/[0.04] px-2 py-3 text-primary" data-testid="button-quick-agenda">
              <CalendarClock className="h-4 w-4" />
              <span className="text-[10px] font-black">Ver agenda</span>
            </button>
            <button type="button" onClick={() => setLocation("/clients")} className="flex flex-col items-center gap-1.5 rounded-2xl border border-primary/20 bg-primary/[0.04] px-2 py-3 text-primary" data-testid="button-quick-new-client">
              <Users className="h-4 w-4" />
              <span className="text-[10px] font-black">Clientes</span>
            </button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
