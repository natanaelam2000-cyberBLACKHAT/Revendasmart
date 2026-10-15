import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "wouter";
import { Calendar, CalendarClock } from "lucide-react";
import { PageSkeleton } from "@/components/PageSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { Button } from "@/components/ui/button";
import {
  cancelPublicManagedBooking,
  getPublicManagedBooking,
  getPublicManagedBookingAvailability,
  publicBookingErrorMessage,
  reschedulePublicManagedBooking,
  type PublicManagedBookingResponse,
  type PublicServiceAvailabilityResponse,
} from "@/lib/service-public-booking-commands";
import { addDaysToDateKey, computeLocalDayRangeUtc, formatTimeInTimezone, todayDateKey } from "@/lib/service-agenda-helpers";
import { format as formatLocalDate, ptBR } from "@/lib/date-utils";

/**
 * SERV-PUBLIC-02 — /agendar/:storeSlug/gerenciar/:token: gerenciamento seguro do próprio agendamento
 * público, autorizado só pelo token opaco na URL (nunca bookingId sozinho — a rota nem aceita um). Mesmo
 * padrão de wrappers públicos sem auth:true (§UI11), mesma disciplina de timezone-do-resource-nunca-do-
 * navegador (§29) e mesma ausência total de escrita direta no Firestore (§UI12) já estabelecidas em
 * public-service-booking.tsx.
 */
const DAYS_AHEAD = 14;

export default function PublicServiceBookingManage() {
  const { storeSlug, token } = useParams<{ storeSlug: string; token: string }>();

  const [booking, setBooking] = useState<PublicManagedBookingResponse | null | undefined>(undefined);
  const [loadError, setLoadError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const refresh = useCallback(() => setReloadToken((value) => value + 1), []);

  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");

  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [selectedDateKey, setSelectedDateKey] = useState(() => todayDateKey());
  const [resourceTimeZone, setResourceTimeZone] = useState<string | null>(null);
  const [availability, setAvailability] = useState<PublicServiceAvailabilityResponse | null | undefined>(undefined);
  const [availabilityError, setAvailabilityError] = useState("");
  const [rescheduling, setRescheduling] = useState(false);
  const [rescheduleError, setRescheduleError] = useState("");

  useEffect(() => {
    if (!storeSlug || !token) return;
    let cancelled = false;
    setBooking(undefined);
    (async () => {
      try {
        const response = await getPublicManagedBooking(storeSlug, token);
        if (!cancelled) setBooking(response);
      } catch (error) {
        if (cancelled) return;
        setBooking(null);
        setLoadError(publicBookingErrorMessage(error));
      }
    })();
    return () => { cancelled = true; };
  }, [storeSlug, token, reloadToken]);

  const timeZoneForDisplay = resourceTimeZone || booking?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Disponibilidade para reagendar — só carrega quando a seção está aberta.
  useEffect(() => {
    if (!rescheduleOpen || !storeSlug || !token) return;
    let cancelled = false;
    setAvailability(undefined);
    setAvailabilityError("");
    (async () => {
      try {
        const bootstrapTimeZone = resourceTimeZone || booking?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const range = computeLocalDayRangeUtc(selectedDateKey, bootstrapTimeZone);
        const response = await getPublicManagedBookingAvailability(storeSlug, token, { rangeStartAt: range.rangeStartAt, rangeEndAt: range.rangeEndAt });
        if (cancelled) return;
        if (response.timezone !== bootstrapTimeZone) {
          setResourceTimeZone(response.timezone);
          const corrected = computeLocalDayRangeUtc(selectedDateKey, response.timezone);
          const response2 = await getPublicManagedBookingAvailability(storeSlug, token, { rangeStartAt: corrected.rangeStartAt, rangeEndAt: corrected.rangeEndAt });
          if (!cancelled) setAvailability(response2);
        } else {
          setAvailability(response);
        }
      } catch (error) {
        if (cancelled) return;
        setAvailability(null);
        setAvailabilityError(publicBookingErrorMessage(error));
      }
    })();
    return () => { cancelled = true; };
  }, [rescheduleOpen, storeSlug, token, selectedDateKey, resourceTimeZone, booking?.timezone]);

  const refreshRescheduleAvailability = useCallback(() => {
    if (!storeSlug || !token || !resourceTimeZone) return;
    const range = computeLocalDayRangeUtc(selectedDateKey, resourceTimeZone);
    getPublicManagedBookingAvailability(storeSlug, token, { rangeStartAt: range.rangeStartAt, rangeEndAt: range.rangeEndAt })
      .then((response) => setAvailability(response))
      .catch((error) => setAvailabilityError(publicBookingErrorMessage(error)));
  }, [storeSlug, token, selectedDateKey, resourceTimeZone]);

  const handleCancel = useCallback(async () => {
    if (!storeSlug || !token) return;
    setCancelling(true);
    setCancelError("");
    try {
      await cancelPublicManagedBooking(storeSlug, token);
      refresh();
    } catch (error) {
      setCancelError(publicBookingErrorMessage(error));
    } finally {
      setCancelling(false);
    }
  }, [storeSlug, token, refresh]);

  const handlePickRescheduleSlot = useCallback(async (candidate: { startAt: string }) => {
    if (!storeSlug || !token) return;
    setRescheduling(true);
    setRescheduleError("");
    try {
      await reschedulePublicManagedBooking(storeSlug, token, { startAt: candidate.startAt });
      setRescheduleOpen(false);
      refresh();
    } catch (error) {
      // §18 — conflito: horário antigo permanece válido (o servidor nunca o libera numa falha), mostra
      // mensagem amigável e atualiza a disponibilidade em vez de deixar a UI presa num candidato morto.
      setRescheduleError(publicBookingErrorMessage(error));
      refreshRescheduleAvailability();
    } finally {
      setRescheduling(false);
    }
  }, [storeSlug, token, refresh, refreshRescheduleAvailability]);

  const dayOptions = useMemo(() => Array.from({ length: DAYS_AHEAD }, (_, index) => addDaysToDateKey(todayDateKey(), index)), []);

  if (booking === undefined) {
    return <div className="mx-auto max-w-lg px-4 py-6"><PageSkeleton variant="cards" /></div>;
  }

  if (!booking) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <EmptyState
          icon={<CalendarClock className="h-12 w-12 text-muted-foreground/30" />}
          title="Não foi possível localizar este agendamento."
          description={loadError}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-5 px-4 py-6 pb-16">
      <div>
        <h1 className="text-lg font-black text-foreground">Seu agendamento</h1>
        <p className="text-sm text-muted-foreground">{booking.storeName}</p>
      </div>

      <div className="space-y-2 rounded-3xl bg-white p-4 shadow-sm" data-testid="section-managed-booking">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Serviço</span>
          <span className="font-bold text-foreground" data-testid="text-managed-service-name">{booking.serviceName}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Data</span>
          <span className="font-bold text-foreground">{formatLocalDate(new Date(booking.startAt), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Horário</span>
          <span className="font-bold text-foreground" data-testid="text-managed-time">{formatTimeInTimezone(booking.startAt, timeZoneForDisplay)} - {formatTimeInTimezone(booking.endAt, timeZoneForDisplay)}</span>
        </div>
        <div className="flex items-center justify-between pt-1 text-sm">
          <span className="text-muted-foreground">Status</span>
          <span className="rounded-full bg-secondary px-3 py-1 text-[10px] font-black text-foreground" data-testid="text-managed-status">
            {booking.status === "confirmed" ? "Confirmado" : "Cancelado"}
          </span>
        </div>
      </div>

      {booking.status === "cancelled" ? (
        <p className="text-center text-sm text-muted-foreground" data-testid="text-managed-cancelled">Agendamento cancelado.</p>
      ) : booking.canCancel || booking.canReschedule ? (
        <div className="flex flex-col gap-2" data-testid="section-managed-actions">
          {booking.canReschedule && (
            <Button type="button" onClick={() => setRescheduleOpen((open) => !open)} data-testid="button-manage-reschedule" className="rounded-full">
              Reagendar
            </Button>
          )}
          {booking.canCancel && (
            <ConfirmActionDialog
              trigger={<Button type="button" variant="outline" disabled={cancelling} data-testid="button-manage-cancel" className="rounded-full border-red-200 text-red-600">Cancelar agendamento</Button>}
              title="Deseja cancelar este agendamento?"
              description="Esta ação não pode ser desfeita."
              confirmLabel="Cancelar agendamento"
              onConfirm={handleCancel}
              disabled={cancelling}
            />
          )}
          {cancelError && <p className="text-sm text-red-600" data-testid="text-manage-cancel-error">{cancelError}</p>}
        </div>
      ) : null}

      {rescheduleOpen && (
        <section className="space-y-3 rounded-3xl bg-white p-4 shadow-sm" data-testid="section-reschedule">
          <p className="text-sm font-black text-foreground">Escolha um novo dia</p>
          <div className="flex gap-2 overflow-x-auto pb-1" data-testid="list-reschedule-days">
            {dayOptions.map((dateKey) => {
              const date = new Date(`${dateKey}T12:00:00`);
              return (
                <button
                  key={dateKey}
                  type="button"
                  onClick={() => setSelectedDateKey(dateKey)}
                  data-testid={`button-reschedule-day-${dateKey}`}
                  className={`rs-pressable flex shrink-0 flex-col items-center rounded-2xl border px-3 py-2 ${selectedDateKey === dateKey ? "border-primary bg-primary/5" : "border-border bg-white"}`}
                >
                  <span className="text-[10px] font-bold uppercase text-muted-foreground">{formatLocalDate(date, "EEE", { locale: ptBR })}</span>
                  <span className="text-sm font-black text-foreground">{formatLocalDate(date, "dd", { locale: ptBR })}</span>
                </button>
              );
            })}
          </div>

          <p className="text-sm font-black text-foreground">Escolha um novo horário</p>
          {availability === undefined ? (
            <p className="text-sm text-muted-foreground">Carregando horários…</p>
          ) : availabilityError ? (
            <p className="text-sm text-red-600" data-testid="text-reschedule-availability-error">{availabilityError}</p>
          ) : !availability || availability.candidates.length === 0 ? (
            <EmptyState icon={<Calendar className="h-10 w-10 text-muted-foreground/30" />} title="Sem horários" description="Não há horários disponíveis neste dia." />
          ) : (
            <div className="grid grid-cols-3 gap-2" data-testid="grid-reschedule-slots">
              {availability.candidates.map((candidate) => (
                <button
                  key={candidate.startAt}
                  type="button"
                  disabled={rescheduling}
                  onClick={() => handlePickRescheduleSlot(candidate)}
                  data-testid={`button-reschedule-slot-${candidate.startAt}`}
                  className="rs-pressable rounded-xl border border-border bg-white py-2 text-xs font-bold text-foreground disabled:opacity-50"
                >
                  {formatTimeInTimezone(candidate.startAt, timeZoneForDisplay)}
                </button>
              ))}
            </div>
          )}
          {rescheduleError && <p className="text-sm text-red-600" data-testid="text-reschedule-error">{rescheduleError}</p>}
        </section>
      )}
    </div>
  );
}
