import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "wouter";
import { Calendar, CheckCircle2, Clock, MapPin } from "lucide-react";
import { PageSkeleton } from "@/components/PageSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  confirmPublicBookingHold,
  createPublicBookingHold,
  getPublicBookingStore,
  getPublicServiceAvailability,
  publicBookingErrorMessage,
  type PublicBookingStoreResponse,
  type PublicServiceAvailabilityResponse,
} from "@/lib/service-public-booking-commands";
import { addDaysToDateKey, computeLocalDayRangeUtc, formatTimeInTimezone, todayDateKey } from "@/lib/service-agenda-helpers";
import { format as formatLocalDate, ptBR } from "@/lib/date-utils";

/**
 * SERV-PUBLIC-01 — /agendar/:storeSlug: fluxo público de agendamento, mobile-first, uma página progressiva
 * (§30/§31 — nunca um wizard modal pesado). Nunca importa nada de PrivateRouter/páginas administrativas;
 * toda leitura/escrita passa pelos wrappers públicos dedicados (service-public-booking-commands.ts), que
 * nunca anexam Authorization (visitante público não tem conta, §5/UI13). O timezone da disponibilidade
 * exibida é sempre o do resource (respondido pelo servidor), nunca decidido pelo navegador (§11) — o
 * timezone do navegador só bootstrapa a PRIMEIRA consulta antes de sabermos o real, corrigido/refeito assim
 * que a resposta chega (mesma técnica seria custosa duplicar; formatTimeInTimezone/computeLocalDayRangeUtc
 * são reaproveitados do módulo já usado pela Agenda interna).
 */
const DAYS_AHEAD = 14;

function formatPriceCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function PublicServiceBooking() {
  const { storeSlug } = useParams<{ storeSlug: string }>();

  const [store, setStore] = useState<PublicBookingStoreResponse | null | undefined>(undefined);
  const [storeError, setStoreError] = useState("");

  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [selectedDateKey, setSelectedDateKey] = useState(() => todayDateKey());
  const [resourceTimeZone, setResourceTimeZone] = useState<string | null>(null);
  const [availability, setAvailability] = useState<PublicServiceAvailabilityResponse | null | undefined>(undefined);
  const [availabilityError, setAvailabilityError] = useState("");

  const [selectedSlot, setSelectedSlot] = useState<{ startAt: string; endAt: string } | null>(null);
  const [creatingHold, setCreatingHold] = useState(false);
  const [holdError, setHoldError] = useState("");
  const [hold, setHold] = useState<{ holdId: string; startAt: string; endAt: string } | null>(null);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const [success, setSuccess] = useState<{ startAt: string; endAt: string; manageToken?: string } | null>(null);

  // Etapa 1 — estabelecimento + Etapa 2 — serviços (mesma resposta, um round-trip só).
  useEffect(() => {
    if (!storeSlug) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await getPublicBookingStore(storeSlug);
        if (!cancelled) setStore(response);
      } catch (error) {
        if (cancelled) return;
        setStore(null);
        setStoreError(publicBookingErrorMessage(error));
      }
    })();
    return () => { cancelled = true; };
  }, [storeSlug]);

  const selectedService = useMemo(
    () => store?.services.find((service) => service.id === selectedServiceId) ?? null,
    [store, selectedServiceId],
  );

  // Etapa 4 — horários disponíveis para o serviço+dia selecionados.
  useEffect(() => {
    if (!storeSlug || !selectedServiceId) { setAvailability(undefined); return; }
    let cancelled = false;
    setAvailability(undefined);
    setAvailabilityError("");
    (async () => {
      try {
        const bootstrapTimeZone = resourceTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const range = computeLocalDayRangeUtc(selectedDateKey, bootstrapTimeZone);
        const response = await getPublicServiceAvailability(storeSlug, { serviceId: selectedServiceId, rangeStartAt: range.rangeStartAt, rangeEndAt: range.rangeEndAt });
        if (cancelled) return;
        if (response.timezone !== bootstrapTimeZone) {
          // §11 — o timezone real do resource nunca é o do navegador: corrige e refaz a consulta antes de exibir.
          setResourceTimeZone(response.timezone);
          const corrected = computeLocalDayRangeUtc(selectedDateKey, response.timezone);
          const response2 = await getPublicServiceAvailability(storeSlug, { serviceId: selectedServiceId, rangeStartAt: corrected.rangeStartAt, rangeEndAt: corrected.rangeEndAt });
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
  }, [storeSlug, selectedServiceId, selectedDateKey, resourceTimeZone]);

  // §14/§20 — após um conflito de horário (Hold expirado ou slot perdido para outro cliente), refaz a
  // consulta de disponibilidade manualmente (o efeito acima não dispara sozinho para o mesmo dia/serviço).
  const refreshAvailability = useCallback(() => {
    if (!storeSlug || !selectedServiceId || !resourceTimeZone) return;
    const range = computeLocalDayRangeUtc(selectedDateKey, resourceTimeZone);
    getPublicServiceAvailability(storeSlug, { serviceId: selectedServiceId, rangeStartAt: range.rangeStartAt, rangeEndAt: range.rangeEndAt })
      .then((response) => setAvailability(response))
      .catch((error) => setAvailabilityError(publicBookingErrorMessage(error)));
  }, [storeSlug, selectedServiceId, selectedDateKey, resourceTimeZone]);

  const handleSelectService = useCallback((serviceId: string) => {
    setSelectedServiceId(serviceId);
    setSelectedSlot(null);
    setHold(null);
    setHoldError("");
  }, []);

  const handleSelectSlot = useCallback(async (candidate: { startAt: string; endAt: string }) => {
    if (!storeSlug || !selectedServiceId) return;
    setSelectedSlot(candidate);
    setCreatingHold(true);
    setHoldError("");
    try {
      const result = await createPublicBookingHold(storeSlug, { serviceId: selectedServiceId, startAt: candidate.startAt });
      setHold({ holdId: result.holdId, startAt: result.startAt, endAt: result.endAt });
    } catch (error) {
      setSelectedSlot(null);
      setHoldError(publicBookingErrorMessage(error));
      refreshAvailability();
    } finally {
      setCreatingHold(false);
    }
  }, [storeSlug, selectedServiceId, refreshAvailability]);

  const handleConfirm = useCallback(async () => {
    if (!storeSlug || !hold) return;
    const name = customerName.trim();
    const phone = customerPhone.trim();
    if (!name) { setConfirmError("Informe seu nome."); return; }
    if (!phone) { setConfirmError("Informe seu WhatsApp/telefone."); return; }
    setConfirming(true);
    setConfirmError("");
    try {
      const result = await confirmPublicBookingHold(storeSlug, hold.holdId, { customerName: name, customerPhone: phone });
      setSuccess({ startAt: result.startAt, endAt: result.endAt, manageToken: result.manageToken });
    } catch (error) {
      setConfirmError(publicBookingErrorMessage(error));
      setHold(null);
      setSelectedSlot(null);
      refreshAvailability();
    } finally {
      setConfirming(false);
    }
  }, [storeSlug, hold, customerName, customerPhone, refreshAvailability]);

  const dayOptions = useMemo(() => Array.from({ length: DAYS_AHEAD }, (_, index) => addDaysToDateKey(todayDateKey(), index)), []);
  const timeZoneForDisplay = resourceTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (store === undefined) {
    return <div className="mx-auto max-w-lg px-4 py-6"><PageSkeleton variant="cards" /></div>;
  }

  if (!store) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <EmptyState
          icon={<MapPin className="h-12 w-12 text-muted-foreground/30" />}
          title="Página de agendamento indisponível."
          description={storeError}
        />
      </div>
    );
  }

  if (success) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-4 py-10 text-center" data-testid="section-booking-success">
        <CheckCircle2 className="mx-auto h-16 w-16 text-emerald-500" />
        <h1 className="text-xl font-black text-foreground">Agendamento confirmado</h1>
        <div className="mx-auto max-w-xs space-y-1 rounded-3xl bg-white p-4 text-left shadow-sm">
          <p className="text-sm text-muted-foreground">Serviço</p>
          <p className="text-sm font-bold text-foreground">{selectedService?.name}</p>
          <p className="pt-2 text-sm text-muted-foreground">Data e horário</p>
          <p className="text-sm font-bold text-foreground">
            {formatLocalDate(new Date(success.startAt), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })} · {formatTimeInTimezone(success.startAt, timeZoneForDisplay)}
          </p>
          <p className="pt-2 text-sm text-muted-foreground">Estabelecimento</p>
          <p className="text-sm font-bold text-foreground">{store.store.name}</p>
        </div>
        {/* SERV-PUBLIC-02 §7 — o token só existe em memória nesta resposta; nunca exibido como texto, nunca
         * logado, nunca persistido além da navegação em si. */}
        {success.manageToken && (
          <Button type="button" variant="outline" asChild className="mx-auto w-full max-w-xs rounded-full">
            <a href={`/agendar/${storeSlug}/gerenciar/${success.manageToken}`} data-testid="link-manage-booking">Gerenciar agendamento</a>
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-5 px-4 py-6 pb-16">
      {/* Etapa 1 */}
      <div className="flex items-center gap-3" data-testid="section-store-header">
        {store.store.logoUrl && <img src={store.store.logoUrl} alt="" className="h-12 w-12 rounded-full object-cover" />}
        <div>
          <h1 className="text-lg font-black text-foreground" data-testid="text-store-name">{store.store.name}</h1>
          {store.store.description && <p className="text-sm text-muted-foreground">{store.store.description}</p>}
        </div>
      </div>

      {/* Etapa 2 */}
      <section className="space-y-2">
        <p className="text-sm font-black text-foreground">Escolha o serviço</p>
        {store.services.length === 0 ? (
          <EmptyState title="Nenhum serviço disponível" description="Nenhum serviço disponível para agendamento no momento." />
        ) : (
          <ul className="space-y-2" data-testid="list-public-services">
            {store.services.map((service) => (
              <li key={service.id}>
                <button
                  type="button"
                  onClick={() => handleSelectService(service.id)}
                  data-testid={`button-select-service-${service.id}`}
                  className={`rs-pressable flex w-full items-center justify-between gap-3 rounded-3xl border p-4 text-left ${selectedServiceId === service.id ? "border-primary bg-primary/5" : "border-border bg-white"}`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-foreground">{service.name}</p>
                    {service.description && <p className="truncate text-xs text-muted-foreground">{service.description}</p>}
                    <p className="text-xs text-muted-foreground">{service.durationMinutes} min</p>
                  </div>
                  <span className="shrink-0 text-sm font-black text-primary">{formatPriceCents(service.priceCents)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selectedServiceId && (
        <>
          {/* Etapa 3 */}
          <section className="space-y-2">
            <p className="text-sm font-black text-foreground">Escolha o dia</p>
            <div className="flex gap-2 overflow-x-auto pb-1" data-testid="list-public-days">
              {dayOptions.map((dateKey) => {
                const date = new Date(`${dateKey}T12:00:00`);
                return (
                  <button
                    key={dateKey}
                    type="button"
                    onClick={() => { setSelectedDateKey(dateKey); setSelectedSlot(null); setHold(null); }}
                    data-testid={`button-select-day-${dateKey}`}
                    className={`rs-pressable flex shrink-0 flex-col items-center rounded-2xl border px-3 py-2 ${selectedDateKey === dateKey ? "border-primary bg-primary/5" : "border-border bg-white"}`}
                  >
                    <span className="text-[10px] font-bold uppercase text-muted-foreground">{formatLocalDate(date, "EEE", { locale: ptBR })}</span>
                    <span className="text-sm font-black text-foreground">{formatLocalDate(date, "dd", { locale: ptBR })}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Etapa 4 */}
          <section className="space-y-2">
            <p className="text-sm font-black text-foreground">Escolha o horário</p>
            {availability === undefined ? (
              <p className="text-sm text-muted-foreground">Carregando horários…</p>
            ) : availabilityError ? (
              <p className="text-sm text-red-600" data-testid="text-availability-error">{availabilityError}</p>
            ) : !availability || availability.candidates.length === 0 ? (
              <EmptyState icon={<Calendar className="h-10 w-10 text-muted-foreground/30" />} title="Sem horários" description="Não há horários disponíveis neste dia." />
            ) : (
              <div className="grid grid-cols-3 gap-2" data-testid="grid-public-slots">
                {availability.candidates.map((candidate) => (
                  <button
                    key={candidate.startAt}
                    type="button"
                    disabled={creatingHold}
                    onClick={() => handleSelectSlot(candidate)}
                    data-testid={`button-select-slot-${candidate.startAt}`}
                    className={`rs-pressable rounded-xl border py-2 text-xs font-bold disabled:opacity-50 ${selectedSlot?.startAt === candidate.startAt ? "border-primary bg-primary/5 text-primary" : "border-border bg-white text-foreground"}`}
                  >
                    {formatTimeInTimezone(candidate.startAt, timeZoneForDisplay)}
                  </button>
                ))}
              </div>
            )}
            {holdError && <p className="text-sm text-red-600" data-testid="text-hold-error">{holdError}</p>}
          </section>
        </>
      )}

      {/* Etapa 5 — dados do cliente + confirmação */}
      {hold && (
        <section className="space-y-3 rounded-3xl bg-white p-4 shadow-sm" data-testid="section-customer-form">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>Este horário ficará reservado por alguns minutos enquanto você conclui.</span>
          </div>
          <p className="text-sm font-black text-foreground">Seus dados</p>
          <div>
            <Label htmlFor="public-customer-name">Nome</Label>
            <Input id="public-customer-name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} data-testid="input-customer-name" />
          </div>
          <div>
            <Label htmlFor="public-customer-phone">WhatsApp</Label>
            <Input id="public-customer-phone" type="tel" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} data-testid="input-customer-phone" />
          </div>
          {confirmError && <p className="text-sm text-red-600" data-testid="text-confirm-error">{confirmError}</p>}
          <Button type="button" onClick={handleConfirm} disabled={confirming} data-testid="button-confirm-booking" className="w-full rounded-full">
            {confirming ? "Confirmando…" : "Confirmar agendamento"}
          </Button>
        </section>
      )}
    </div>
  );
}
