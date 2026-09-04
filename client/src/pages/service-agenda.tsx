import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, CalendarClock, ChevronLeft, ChevronRight, Copy, Settings } from "lucide-react";
import { Layout } from "@/components/layout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useClientsLiteData } from "@/hooks/useClientsLiteData";
import { useUserSettings } from "@/providers/UserSettingsProvider";
import { buildPublicServiceBookingUrl } from "@/lib/public-url";
import { getServiceResourceSchedule, listServiceAvailabilityBlocksForResource } from "@/lib/service-availability-persistence";
import { createServiceAvailabilityBlock, deleteServiceAvailabilityBlock, getServiceAvailability, type ServiceAvailabilityResponse } from "@/lib/service-availability-commands";
import { listServiceBookingsForResourceAndRange } from "@/lib/service-bookings-persistence";
import { cancelServiceBooking, rescheduleServiceBooking } from "@/lib/service-booking-commands";
import { listServices, getServiceWork } from "@/lib/services-persistence";
import { notifyError, notifySuccess } from "@/lib/notify";
import { getFirebaseAuth } from "@/lib/firebase";
import { fireServerCountedFirstOccurrence } from "@/lib/analytics-milestones";
import { collection, getCountFromServer, getFirestore } from "firebase/firestore";
import { format as formatLocalDate, ptBR } from "@/lib/date-utils";
import {
  addDaysToDateKey,
  buildAgendaSegments,
  collapseAdjacentSegments,
  agendaErrorMessage,
  computeLocalDayRangeUtc,
  formatTimeInTimezone,
  todayDateKey,
  zonedWallClockToUtcInstant,
  type AgendaSegment,
} from "@/lib/service-agenda-helpers";
import type { Booking } from "@shared/service-bookings";
import type { ServiceAvailabilityBlock, ServiceResourceSchedule } from "@shared/service-availability";
import type { Service, ServiceWork } from "@shared/services";

/**
 * SERV-UI-01 — Agenda operacional V1: um único resource (§6 — nenhum CRUD de equipe/profissional nesta
 * rodada; "default" é o resourceId convencional até a Agenda V1 crescer para múltiplos profissionais).
 * Booking/lock continuam 100% server-authoritative (SERV-BOOK-01/02) — esta tela só lê e delega comandos
 * já existentes, nunca decide concorrência nem escreve Booking/Block diretamente no Firestore.
 */
const DEFAULT_RESOURCE_ID = "default";
const browserTimeZone = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";

function statusLabel(status: AgendaSegment["status"]): string {
  if (status === "booked") return "Ocupado";
  if (status === "blocked") return "Bloqueado";
  return "Disponível";
}

export default function ServiceAgenda() {
  const [selectedDate, setSelectedDate] = useState(() => todayDateKey());
  const [schedule, setSchedule] = useState<ServiceResourceSchedule | null | undefined>(undefined);
  const [scheduleError, setScheduleError] = useState("");
  const [services, setServices] = useState<Map<string, Service>>(new Map());
  const [blocks, setBlocks] = useState<ServiceAvailabilityBlock[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loadingAgenda, setLoadingAgenda] = useState(true);
  const [agendaError, setAgendaError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const { clients } = useClientsLiteData();
  // SERV-E2E-01 §19 — mesmo catalogSlug já usado por /u/:slug (client/src/pages/settings.tsx, aba
  // "Compartilhar Catálogo"); nunca gera um slug novo aqui, só reaproveita o já existente.
  const { settings: userSettings } = useUserSettings();
  const bookingLinkUrl = useMemo(() => buildPublicServiceBookingUrl(userSettings.catalogSlug), [userSettings.catalogSlug]);
  const handleCopyBookingLink = useCallback(() => {
    if (!bookingLinkUrl) return;
    navigator.clipboard.writeText(bookingLinkUrl);
    notifySuccess("Link de agendamento copiado!");
  }, [bookingLinkUrl]);

  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [selectedWork, setSelectedWork] = useState<ServiceWork | null>(null);
  const [workLoading, setWorkLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState(selectedDate);
  const [rescheduleCandidates, setRescheduleCandidates] = useState<ServiceAvailabilityResponse | null>(null);
  const [rescheduleLoading, setRescheduleLoading] = useState(false);
  const [reschedulingSlot, setReschedulingSlot] = useState(false);
  const [rescheduleError, setRescheduleError] = useState("");

  const [selectedBlock, setSelectedBlock] = useState<ServiceAvailabilityBlock | null>(null);
  const [deletingBlock, setDeletingBlock] = useState(false);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [blockStart, setBlockStart] = useState("09:00");
  const [blockEnd, setBlockEnd] = useState("10:00");
  const [blockReason, setBlockReason] = useState("");
  const [creatingBlock, setCreatingBlock] = useState(false);

  const timeZone = schedule?.timezone || browserTimeZone;
  const clientNameById = useMemo(() => new Map(clients.map((client) => [client.id, client.name])), [clients]);

  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  // PLAN-IMPL-06 §13 — a confirmação em si acontece na sessão ANÔNIMA do cliente público
  // (client/src/lib/service-public-booking-commands.ts, sem tenant logado — nunca atribuível ao dono
  // via Analytics). Esta é a primeira sessão REAL do próprio dono onde um Booking confirmado pode ser
  // observado (lifetime, não por dia — nunca o `bookings` do dia selecionado abaixo), então é aqui que
  // first_booking_created dispara, uma vez por tenant, via a mesma contagem real de servidor de
  // fireServerCountedFirstOccurrence (nunca inferido do cache do dia).
  useEffect(() => {
    const uid = getFirebaseAuth()?.currentUser?.uid;
    if (!uid) return;
    void fireServerCountedFirstOccurrence(
      uid,
      "first_booking_created",
      "first_booking_created",
      async () => (await getCountFromServer(collection(getFirestore(), "users", uid, "bookings"))).data().count,
    );
  }, []);

  // Carrega schedule + services + blocks uma vez (não dependem da data selecionada, só do resource).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [resourceSchedule, serviceList, blockList] = await Promise.all([
          getServiceResourceSchedule(DEFAULT_RESOURCE_ID),
          listServices(),
          listServiceAvailabilityBlocksForResource(DEFAULT_RESOURCE_ID),
        ]);
        if (cancelled) return;
        setSchedule(resourceSchedule);
        setServices(new Map(serviceList.map((service) => [service.id, service])));
        setBlocks(blockList);
        setScheduleError("");
      } catch (error) {
        if (cancelled) return;
        setSchedule(null);
        setScheduleError(agendaErrorMessage(error));
      }
    })();
    return () => { cancelled = true; };
  }, [reloadToken]);

  // §19 — busca só o dia selecionado (nunca um range maior); depende do timezone real do resource.
  useEffect(() => {
    if (schedule === undefined) return;
    let cancelled = false;
    setLoadingAgenda(true);
    setAgendaError("");
    (async () => {
      try {
        const { rangeStartAt, rangeEndAt } = computeLocalDayRangeUtc(selectedDate, timeZone);
        const dayBookings = await listServiceBookingsForResourceAndRange(DEFAULT_RESOURCE_ID, rangeStartAt, rangeEndAt);
        if (cancelled) return;
        setBookings(dayBookings);
      } catch (error) {
        if (cancelled) return;
        setAgendaError(agendaErrorMessage(error));
      } finally {
        if (!cancelled) setLoadingAgenda(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedDate, schedule, timeZone, reloadToken]);

  const dayBlocks = useMemo(() => {
    const { rangeStartAt, rangeEndAt } = computeLocalDayRangeUtc(selectedDate, timeZone);
    return blocks.filter((block) => Date.parse(block.startAt) < Date.parse(rangeEndAt) && Date.parse(rangeStartAt) < Date.parse(block.endAt));
  }, [blocks, selectedDate, timeZone]);

  const segments = useMemo(
    () => collapseAdjacentSegments(buildAgendaSegments(selectedDate, timeZone, schedule?.weeklyHours, bookings, dayBlocks)),
    [selectedDate, timeZone, schedule, bookings, dayBlocks],
  );

  const openBookingDetails = useCallback(async (booking: Booking) => {
    setSelectedBooking(booking);
    setSelectedWork(null);
    setWorkLoading(true);
    try {
      const work = await getServiceWork(booking.workId);
      setSelectedWork(work);
    } catch {
      // Work não carregou — detalhe ainda mostra os dados do Booking; §8 não exige dado financeiro aqui.
    } finally {
      setWorkLoading(false);
    }
  }, []);

  const handleCancelBooking = useCallback(async () => {
    if (!selectedBooking) return;
    setCancelling(true);
    try {
      await cancelServiceBooking(selectedBooking.id);
      notifySuccess("Agendamento cancelado.");
      setSelectedBooking(null);
      refresh();
    } catch (error) {
      notifyError(agendaErrorMessage(error));
    } finally {
      setCancelling(false);
    }
  }, [selectedBooking, refresh]);

  const openReschedule = useCallback(() => {
    if (!selectedBooking) return;
    setRescheduleDate(selectedDate);
    setRescheduleCandidates(null);
    setRescheduleError("");
    setRescheduleOpen(true);
  }, [selectedBooking, selectedDate]);

  // §11 — consulta disponibilidade REAL (getServiceAvailability) para o serviço do próprio Booking, nunca
  // uma segunda lógica de disponibilidade inventada no client (§5).
  useEffect(() => {
    if (!rescheduleOpen || !selectedBooking) return;
    let cancelled = false;
    setRescheduleLoading(true);
    setRescheduleError("");
    (async () => {
      try {
        const { rangeStartAt, rangeEndAt } = computeLocalDayRangeUtc(rescheduleDate, timeZone);
        const response = await getServiceAvailability({
          serviceId: selectedBooking.serviceId, resourceId: selectedBooking.resourceId, rangeStartAt, rangeEndAt,
        });
        if (cancelled) return;
        setRescheduleCandidates(response);
      } catch (error) {
        if (cancelled) return;
        setRescheduleError(agendaErrorMessage(error));
      } finally {
        if (!cancelled) setRescheduleLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [rescheduleOpen, rescheduleDate, selectedBooking, timeZone]);

  const handlePickRescheduleSlot = useCallback(async (candidateStartAt: string) => {
    if (!selectedBooking) return;
    setReschedulingSlot(true);
    setRescheduleError("");
    try {
      await rescheduleServiceBooking(selectedBooking.id, { startAt: candidateStartAt });
      notifySuccess("Agendamento reagendado.");
      setRescheduleOpen(false);
      setSelectedBooking(null);
      setSelectedDate(rescheduleDate);
      refresh();
    } catch (error) {
      // §11 — race: o horário pode ter sumido entre a consulta e a confirmação; mostra erro e atualiza
      // a lista de horários em vez de deixar a UI presa num candidato que não existe mais.
      setRescheduleError(agendaErrorMessage(error));
      setRescheduleCandidates((current) => current);
      try {
        const { rangeStartAt, rangeEndAt } = computeLocalDayRangeUtc(rescheduleDate, timeZone);
        const refreshed = await getServiceAvailability({ serviceId: selectedBooking.serviceId, resourceId: selectedBooking.resourceId, rangeStartAt, rangeEndAt });
        setRescheduleCandidates(refreshed);
      } catch {
        // silencioso — o erro principal já foi mostrado acima.
      }
    } finally {
      setReschedulingSlot(false);
    }
  }, [selectedBooking, rescheduleDate, timeZone, refresh]);

  const openCreateBlock = useCallback(() => {
    setBlockStart("09:00");
    setBlockEnd("10:00");
    setBlockReason("");
    setBlockDialogOpen(true);
  }, []);

  const handleCreateBlock = useCallback(async () => {
    setCreatingBlock(true);
    try {
      const [startHour, startMinute] = blockStart.split(":").map(Number);
      const [endHour, endMinute] = blockEnd.split(":").map(Number);
      const startAt = zonedWallClockToUtcInstant(selectedDate, startHour * 60 + startMinute, timeZone).toISOString();
      const endAt = zonedWallClockToUtcInstant(selectedDate, endHour * 60 + endMinute, timeZone).toISOString();
      await createServiceAvailabilityBlock({ resourceId: DEFAULT_RESOURCE_ID, startAt, endAt, reason: blockReason || undefined });
      notifySuccess("Horário bloqueado.");
      setBlockDialogOpen(false);
      refresh();
    } catch (error) {
      notifyError(agendaErrorMessage(error));
    } finally {
      setCreatingBlock(false);
    }
  }, [selectedDate, timeZone, blockStart, blockEnd, blockReason, refresh]);

  const handleDeleteBlock = useCallback(async () => {
    if (!selectedBlock) return;
    setDeletingBlock(true);
    try {
      await deleteServiceAvailabilityBlock(selectedBlock.id);
      notifySuccess("Bloqueio removido.");
      setSelectedBlock(null);
      refresh();
    } catch (error) {
      notifyError(agendaErrorMessage(error));
    } finally {
      setDeletingBlock(false);
    }
  }, [selectedBlock, refresh]);

  const headerLabel = formatLocalDate(new Date(`${selectedDate}T00:00:00`), "dd 'de' MMMM 'de' yyyy", { locale: ptBR });

  return (
    <Layout title="Agenda">
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-4">
        <div className="flex items-center justify-between gap-2 rounded-3xl bg-white p-3 shadow-sm">
          <button type="button" onClick={() => setSelectedDate((current) => addDaysToDateKey(current, -1))} aria-label="Dia anterior" data-testid="button-agenda-prev-day" className="rs-icon-press flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex flex-col items-center">
            <span className="text-sm font-black capitalize text-foreground" data-testid="text-agenda-date">{headerLabel}</span>
            <button type="button" onClick={() => setSelectedDate(todayDateKey())} className="text-xs font-bold text-primary">Hoje</button>
          </div>
          <button type="button" onClick={() => setSelectedDate((current) => addDaysToDateKey(current, 1))} aria-label="Próximo dia" data-testid="button-agenda-next-day" className="rs-icon-press flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={openCreateBlock} data-testid="button-agenda-create-block" className="rounded-full">
            <Ban className="mr-1.5 h-4 w-4" /> Bloquear horário
          </Button>
          <Button type="button" variant="outline" size="sm" asChild className="rounded-full">
            <a href="/servicos/disponibilidade" data-testid="link-agenda-availability-settings">
              <Settings className="mr-1.5 h-4 w-4" /> Configurar horários
            </a>
          </Button>
          {bookingLinkUrl && (
            <Button type="button" variant="outline" size="sm" onClick={handleCopyBookingLink} data-testid="button-copy-booking-link" className="rounded-full">
              <Copy className="mr-1.5 h-4 w-4" /> Copiar link de agendamento
            </Button>
          )}
        </div>

        {schedule === undefined || loadingAgenda ? (
          <PageSkeleton variant="cards" />
        ) : scheduleError ? (
          <EmptyState title="Não foi possível carregar a agenda" description={scheduleError} />
        ) : agendaError ? (
          <EmptyState title="Não foi possível carregar a agenda" description={agendaError} />
        ) : !schedule ? (
          <EmptyState
            icon={<CalendarClock className="h-12 w-12 text-muted-foreground/30" />}
            title="Nenhum expediente configurado"
            description="Configure os horários de funcionamento para começar a usar a Agenda."
            action={<Button asChild className="rounded-full"><a href="/servicos/disponibilidade" data-testid="link-agenda-empty-availability-settings">Configurar horários</a></Button>}
          />
        ) : segments.length === 0 ? (
          <EmptyState
            icon={<CalendarClock className="h-12 w-12 text-muted-foreground/30" />}
            title="Fechado neste dia"
            description="Não há expediente configurado para esta data."
          />
        ) : (
          <ul className="space-y-2" data-testid="list-agenda-segments">
            {segments.map((segment) => {
              const key = `${segment.startAt}-${segment.status}`;
              const timeLabel = `${formatTimeInTimezone(segment.startAt, timeZone)} - ${formatTimeInTimezone(segment.endAt, timeZone)}`;
              if (segment.status === "booked" && segment.booking) {
                const booking = segment.booking;
                const service = services.get(booking.serviceId);
                const clientName = booking.customerId ? clientNameById.get(booking.customerId) : undefined;
                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => openBookingDetails(booking)}
                      data-testid={`card-agenda-booking-${booking.id}`}
                      className="rs-pressable flex w-full items-center justify-between gap-3 rounded-3xl border border-primary/20 bg-primary/5 p-4 text-left"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-primary">{timeLabel}</p>
                        <p className="truncate text-sm font-black text-foreground">{service?.name || "Serviço"}</p>
                        {clientName && <p className="truncate text-xs text-muted-foreground">{clientName}</p>}
                      </div>
                      <span className="shrink-0 rounded-full bg-primary/15 px-3 py-1 text-[10px] font-black text-primary">{statusLabel("booked")}</span>
                    </button>
                  </li>
                );
              }
              if (segment.status === "blocked" && segment.block) {
                const block = segment.block;
                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => setSelectedBlock(block)}
                      data-testid={`card-agenda-block-${block.id}`}
                      className="rs-pressable flex w-full items-center justify-between gap-3 rounded-3xl border border-border bg-secondary/60 p-4 text-left"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-muted-foreground">{timeLabel}</p>
                        <p className="truncate text-sm font-black text-foreground">{block.reason || "Horário bloqueado"}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-slate-200 px-3 py-1 text-[10px] font-black text-slate-600">{statusLabel("blocked")}</span>
                    </button>
                  </li>
                );
              }
              return (
                <li key={key} className="flex items-center justify-between gap-3 rounded-3xl border border-dashed border-border/60 bg-white p-4" data-testid="card-agenda-available">
                  <p className="text-xs font-bold text-muted-foreground">{timeLabel}</p>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black text-emerald-700">{statusLabel("available")}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* §9 — detalhe do Booking selecionado */}
      <Sheet open={Boolean(selectedBooking)} onOpenChange={(open) => { if (!open) setSelectedBooking(null); }}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-[2rem]" data-testid="sheet-booking-details">
          {selectedBooking && (
            <>
              <SheetHeader className="text-left">
                <SheetTitle>{services.get(selectedBooking.serviceId)?.name || "Agendamento"}</SheetTitle>
                <SheetDescription>
                  {formatTimeInTimezone(selectedBooking.startAt, timeZone)} - {formatTimeInTimezone(selectedBooking.endAt, timeZone)}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-2 text-sm">
                <p><span className="font-bold">Status:</span> {selectedBooking.status === "confirmed" ? "Confirmado" : "Cancelado"}</p>
                {selectedBooking.customerId && (
                  <p><span className="font-bold">Cliente:</span> {clientNameById.get(selectedBooking.customerId) || selectedBooking.customerId}</p>
                )}
                <p><span className="font-bold">Recurso:</span> {selectedBooking.resourceId}</p>
                {workLoading ? (
                  <p className="text-muted-foreground">Carregando atendimento…</p>
                ) : selectedWork ? (
                  <p><span className="font-bold">Atendimento:</span> {selectedWork.status}</p>
                ) : null}
              </div>
              <div className="mt-4">
                <Button type="button" variant="outline" asChild className="w-full rounded-full">
                  <a href={`/servicos/atendimentos/${selectedBooking.workId}`} data-testid="link-booking-open-work">Ver atendimento completo</a>
                </Button>
              </div>
              {selectedBooking.status === "confirmed" && (
                <div className="mt-6 flex flex-col gap-2">
                  <Button type="button" onClick={openReschedule} data-testid="button-booking-reschedule" className="rounded-full">Reagendar</Button>
                  <ConfirmActionDialog
                    trigger={<Button type="button" variant="outline" data-testid="button-booking-cancel" className="rounded-full border-red-200 text-red-600">Cancelar agendamento</Button>}
                    title="Cancelar agendamento?"
                    description="Esta ação não pode ser desfeita. O cliente precisará ser avisado separadamente."
                    confirmLabel="Cancelar agendamento"
                    onConfirm={handleCancelBooking}
                    disabled={cancelling}
                  />
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* §11 — reagendamento: escolhe nova data, sistema mostra só horários realmente disponíveis */}
      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent className="max-w-sm rounded-[2rem]" data-testid="dialog-reschedule">
          <DialogHeader>
            <DialogTitle>Reagendar</DialogTitle>
            <DialogDescription>Escolha uma nova data e horário disponível.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="reschedule-date">Nova data</Label>
            <Input id="reschedule-date" type="date" value={rescheduleDate} onChange={(event) => setRescheduleDate(event.target.value)} data-testid="input-reschedule-date" />
            {rescheduleError && <p className="text-sm font-semibold text-red-600" data-testid="text-reschedule-error">{rescheduleError}</p>}
            {rescheduleLoading ? (
              <p className="text-sm text-muted-foreground">Carregando horários…</p>
            ) : rescheduleCandidates && rescheduleCandidates.candidates.length > 0 ? (
              <div className="grid grid-cols-3 gap-2" data-testid="grid-reschedule-slots">
                {rescheduleCandidates.candidates.map((candidate) => (
                  <button
                    key={candidate.startAt}
                    type="button"
                    disabled={reschedulingSlot}
                    onClick={() => handlePickRescheduleSlot(candidate.startAt)}
                    data-testid={`button-reschedule-slot-${candidate.startAt}`}
                    className="rs-pressable rounded-xl border border-border bg-white py-2 text-xs font-bold text-foreground disabled:opacity-50"
                  >
                    {formatTimeInTimezone(candidate.startAt, timeZone)}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum horário disponível nesta data.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* §12 — criar bloqueio */}
      <Dialog open={blockDialogOpen} onOpenChange={setBlockDialogOpen}>
        <DialogContent className="max-w-sm rounded-[2rem]" data-testid="dialog-create-block">
          <DialogHeader>
            <DialogTitle>Bloquear horário</DialogTitle>
            <DialogDescription>O período ficará indisponível para novos agendamentos.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="block-start">Início</Label>
                <Input id="block-start" type="time" value={blockStart} onChange={(event) => setBlockStart(event.target.value)} data-testid="input-block-start" />
              </div>
              <div>
                <Label htmlFor="block-end">Fim</Label>
                <Input id="block-end" type="time" value={blockEnd} onChange={(event) => setBlockEnd(event.target.value)} data-testid="input-block-end" />
              </div>
            </div>
            <div>
              <Label htmlFor="block-reason">Motivo (opcional)</Label>
              <Input id="block-reason" value={blockReason} onChange={(event) => setBlockReason(event.target.value)} placeholder="Ex.: almoço, consulta" data-testid="input-block-reason" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" onClick={handleCreateBlock} disabled={creatingBlock} data-testid="button-confirm-create-block" className="w-full rounded-full">
              {creatingBlock ? "Bloqueando…" : "Bloquear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* §13 — remover bloqueio */}
      <ConfirmActionDialog
        open={Boolean(selectedBlock)}
        onOpenChange={(open) => { if (!open) setSelectedBlock(null); }}
        title="Remover bloqueio?"
        description="O horário voltará a ficar disponível imediatamente."
        confirmLabel="Remover bloqueio"
        onConfirm={handleDeleteBlock}
        disabled={deletingBlock}
      />
    </Layout>
  );
}
