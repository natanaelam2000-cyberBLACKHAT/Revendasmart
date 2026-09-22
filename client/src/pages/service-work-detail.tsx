import { bookingContactName } from "@shared/service-contact";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "wouter";
import { CalendarClock, Receipt, Wallet } from "lucide-react";
import { Layout } from "@/components/layout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useClientsLiteData } from "@/hooks/useClientsLiteData";
import { waitForAuthReady } from "@/lib/firebase";
import { getServiceWork } from "@/lib/services-persistence";
import { startServiceWork, completeServiceWork, cancelServiceWork } from "@/lib/service-work-commands";
import { listServiceBookingsForWork } from "@/lib/service-bookings-persistence";
import { cancelServiceBooking } from "@/lib/service-booking-commands";
import { getServiceResourceSchedule } from "@/lib/service-availability-persistence";
import { getQuote, updateQuoteDraft } from "@/lib/service-quotes-persistence";
import { createServiceQuoteForWork } from "@/lib/service-quote-commands";
import { listServicePayments, listServiceRefunds } from "@/lib/service-payments-persistence";
import { recordServicePayment, refundServicePayment } from "@/lib/service-payment-commands";
import { notifyError, notifySuccess } from "@/lib/notify";
import { format as formatLocalDate, ptBR } from "@/lib/date-utils";
import { formatTimeInTimezone, zonedWallClockToUtcInstant } from "@/lib/service-agenda-helpers";
import {
  financialStatusLabel,
  formatCentsBRL,
  paymentMethodLabel,
  reaisInputToCents,
  refundStatusLabel,
  serviceWorkErrorMessage,
  serviceWorkStatusLabel,
} from "@/lib/service-work-helpers";
import { deriveServiceWorkFinancials, type ServicePaymentRecord, type ServiceRefundRecord, type ServiceWork } from "@shared/services";
import type { Booking } from "@shared/service-bookings";
import type { Quote } from "@shared/service-quotes";

/**
 * SERV-UI-03 — tela operacional de um único ServiceWork: lifecycle (iniciar/concluir/cancelar via commands
 * já existentes), orçamento relacionado (Quote, quando existe) e financeiro (derivado de
 * deriveServiceWorkFinancials, nunca recalculado à mão aqui). Nenhuma escrita direta de Payment/Refund —
 * tudo passa pelos commands server-side já aprovados (service-payment-commands.ts / service-work-commands.ts).
 */
type Movement =
  | { readonly kind: "payment"; readonly at: string; readonly amountCents: number; readonly method: ServicePaymentRecord["method"] }
  | { readonly kind: "refund"; readonly at: string; readonly amountCents: number };

/** "YYYY-MM-DD" (do input de data "válido até") -> instante UTC do fim daquele dia NO TIMEZONE informado —
 * nunca `T23:59:59.000Z` fixo (23:59:59 UTC é ~21h em São Paulo, expirando o orçamento ~3h antes do fim do
 * dia que o vendedor escolheu). Mesma técnica DST-safe de zonedWallClockToUtcInstant (service-agenda-helpers). */
function endOfLocalDayIso(dateKey: string, timeZone: string): string {
  return zonedWallClockToUtcInstant(dateKey, 23 * 60 + 59, timeZone).toISOString();
}

export default function ServiceWorkDetail() {
  const { workId } = useParams<{ workId: string }>();
  const { clients } = useClientsLiteData();
  const clientNameById = useMemo(() => new Map(clients.map((client) => [client.id, client.name])), [clients]);

  const [work, setWork] = useState<ServiceWork | null | undefined>(undefined);
  const [workError, setWorkError] = useState("");
  const [booking, setBooking] = useState<Booking | null>(null);
  const [bookingTimeZone, setBookingTimeZone] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  const [transitioning, setTransitioning] = useState(false);

  // SERV-QUOTE-LINK-01 — agora que ServiceWork.quoteId formaliza o vínculo (server-authoritative), criar/
  // editar orçamento voltou a ser suportado: criar usa createServiceQuoteForWorkCommand (transaction que
  // impede mais de 1 Quote por Work, §7/§18); editar reaproveita updateQuoteDraft (já existente, só válido
  // para status "draft", validado tanto no client quanto nas Rules — nunca edita uma versão histórica).
  const [quote, setQuote] = useState<Quote | null | undefined>(undefined);
  const [quoteError, setQuoteError] = useState("");
  const [quoteDialogOpen, setQuoteDialogOpen] = useState(false);
  const [quoteMessage, setQuoteMessage] = useState("");
  const [quoteValidUntil, setQuoteValidUntil] = useState("");
  const [creatingQuote, setCreatingQuote] = useState(false);
  const [savingQuoteDraft, setSavingQuoteDraft] = useState(false);

  const [payments, setPayments] = useState<ServicePaymentRecord[]>([]);
  const [refundsByPayment, setRefundsByPayment] = useState<Map<string, ServiceRefundRecord[]>>(new Map());
  const [financialLoading, setFinancialLoading] = useState(true);
  const [financialError, setFinancialError] = useState("");

  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "pix" | "card" | "manual">("cash");
  const [recordingPayment, setRecordingPayment] = useState(false);

  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  const [refundPaymentId, setRefundPaymentId] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundingPayment, setRefundingPayment] = useState(false);

  // Work + Booking ligado (se existir) — necessário para saber se o cancelamento deve passar pelo Booking.
  useEffect(() => {
    if (!workId) return;
    let cancelled = false;
    (async () => {
      try {
        // PRODUCT-QA-02 — espera o Firebase Auth confirmar o estado INICIAL da sessão antes de buscar
        // dados dependentes de uid. Sem isto, uma navegação de página cheia (ex.: o link "Ver atendimento
        // completo" da Agenda, ou um refresh/link direto) chega aqui antes da sessão persistida terminar
        // de ser restaurada — requireCurrentUid() via getServiceWork() lança UNAUTHENTICATED e mostra
        // "Sessão inválida" para um usuário genuinamente autenticado.
        await waitForAuthReady();
        if (cancelled) return;
        const [loadedWork, relatedBookings] = await Promise.all([
          getServiceWork(workId),
          listServiceBookingsForWork(workId),
        ]);
        if (cancelled) return;
        setWork(loadedWork);
        const activeBooking = relatedBookings.find((item) => item.status === "confirmed") ?? relatedBookings[0] ?? null;
        setBooking(activeBooking);
        setWorkError(loadedWork ? "" : "Atendimento não encontrado.");
        if (activeBooking) {
          const schedule = await getServiceResourceSchedule(activeBooking.resourceId);
          if (!cancelled) setBookingTimeZone(schedule?.timezone ?? null);
        }
      } catch (error) {
        if (cancelled) return;
        setWork(null);
        setWorkError(serviceWorkErrorMessage(error));
      }
    })();
    return () => { cancelled = true; };
  }, [workId, reloadToken]);

  // SERV-QUOTE-LINK-01 — quoteId é a fonte de verdade única; work.sourceQuoteId permanece como fallback
  // só para Works de origin="quote" criados ANTES deste ticket (legados sem quoteId, §22 — continuam
  // legíveis, nunca migrados/persistidos retroativamente aqui).
  const relatedQuoteId = work?.quoteId ?? work?.sourceQuoteId;
  useEffect(() => {
    if (!work) { setQuote(work === null ? null : undefined); return; }
    if (!relatedQuoteId) { setQuote(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const loadedQuote = await getQuote(relatedQuoteId);
        if (!cancelled) setQuote(loadedQuote);
      } catch (error) {
        if (!cancelled) { setQuote(null); setQuoteError(serviceWorkErrorMessage(error)); }
      }
    })();
    return () => { cancelled = true; };
  }, [work, relatedQuoteId]);

  // Financeiro: histórico de pagamentos/reembolsos (só para a lista de movimentações, §23 — os totais
  // exibidos vêm de deriveServiceWorkFinancials(work), nunca recalculados aqui a partir dessa lista).
  useEffect(() => {
    if (!workId || !work) return;
    let cancelled = false;
    setFinancialLoading(true);
    setFinancialError("");
    (async () => {
      try {
        const paymentList = await listServicePayments(workId);
        if (cancelled) return;
        setPayments(paymentList);
        const refundEntries = await Promise.all(
          paymentList.map(async (payment) => [payment.id, await listServiceRefunds(workId, payment.id)] as const),
        );
        if (cancelled) return;
        setRefundsByPayment(new Map(refundEntries));
      } catch (error) {
        if (cancelled) return;
        setFinancialError(serviceWorkErrorMessage(error));
      } finally {
        if (!cancelled) setFinancialLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [workId, work, reloadToken]);

  const financials = useMemo(() => (work ? deriveServiceWorkFinancials(work) : null), [work]);

  const movements = useMemo<Movement[]>(() => {
    const items: Movement[] = [];
    for (const payment of payments) {
      items.push({ kind: "payment", at: payment.recordedAt, amountCents: payment.amountCents, method: payment.method });
      for (const refund of refundsByPayment.get(payment.id) ?? []) {
        items.push({ kind: "refund", at: refund.refundedAt, amountCents: refund.amountCents });
      }
    }
    return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }, [payments, refundsByPayment]);

  const refundablePayments = useMemo(
    () => payments.filter((payment) => payment.amountCents - payment.refundedTotalCents > 0),
    [payments],
  );

  const serviceName = work?.items.find((item) => item.kind === "service")?.snapshot.name
    ?? (work?.origin === "manual" ? "Atendimento avulso" : "Atendimento");
  const customerName = work ? bookingContactName(work, clientNameById) : null;
  // §10/UI8 — espelha a mesma regra do servidor (WORK_NOT_ELIGIBLE_FOR_QUOTE): completed/cancelled não
  // oferece a ação de criar um novo orçamento, evitando uma tentativa fadada a ser rejeitada.
  const workCanReceiveQuote = work?.status === "planned" || work?.status === "in_progress";

  const handleStart = useCallback(async () => {
    if (!work) return;
    setTransitioning(true);
    try {
      await startServiceWork(work.id);
      notifySuccess("Atendimento iniciado.");
      refresh();
    } catch (error) {
      notifyError(serviceWorkErrorMessage(error));
    } finally {
      setTransitioning(false);
    }
  }, [work, refresh]);

  const handleComplete = useCallback(async () => {
    if (!work) return;
    setTransitioning(true);
    try {
      await completeServiceWork(work.id);
      notifySuccess("Atendimento concluído.");
      refresh();
    } catch (error) {
      notifyError(serviceWorkErrorMessage(error));
    } finally {
      setTransitioning(false);
    }
  }, [work, refresh]);

  // §9 — Work com Booking confirmado cancela via fluxo de Booking (libera locks corretamente); Work manual
  // (ou cujo Booking já não está confirmado) cancela diretamente. Nunca deixa um Booking ativo órfão.
  const handleCancel = useCallback(async () => {
    if (!work) return;
    setTransitioning(true);
    try {
      if (booking && booking.status === "confirmed") {
        await cancelServiceBooking(booking.id);
      } else {
        await cancelServiceWork(work.id);
      }
      notifySuccess("Atendimento cancelado.");
      refresh();
    } catch (error) {
      notifyError(serviceWorkErrorMessage(error));
    } finally {
      setTransitioning(false);
    }
  }, [work, booking, refresh]);

  const openCreateQuoteDialog = useCallback(() => {
    setQuoteMessage("");
    setQuoteValidUntil("");
    setQuoteDialogOpen(true);
  }, []);

  const handleCreateQuote = useCallback(async () => {
    if (!work) return;
    setCreatingQuote(true);
    try {
      const nextValidUntil = quoteValidUntil ? endOfLocalDayIso(quoteValidUntil, bookingTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone) : undefined;
      await createServiceQuoteForWork(work.id, { customerMessage: quoteMessage || undefined, validUntil: nextValidUntil });
      notifySuccess("Orçamento criado a partir dos itens deste atendimento.");
      setQuoteDialogOpen(false);
      refresh();
    } catch (error) {
      notifyError(serviceWorkErrorMessage(error));
    } finally {
      setCreatingQuote(false);
    }
  }, [work, quoteMessage, quoteValidUntil, refresh]);

  const openEditQuoteDialog = useCallback(() => {
    if (!quote) return;
    setQuoteMessage(quote.draftCustomerMessage ?? "");
    setQuoteValidUntil(quote.draftValidUntil ? quote.draftValidUntil.slice(0, 10) : "");
    setQuoteDialogOpen(true);
  }, [quote]);

  const handleSaveQuoteDraft = useCallback(async () => {
    if (!quote || quote.status !== "draft") return;
    setSavingQuoteDraft(true);
    try {
      const nextValidUntil = quoteValidUntil ? endOfLocalDayIso(quoteValidUntil, bookingTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone) : undefined;
      const updated = await updateQuoteDraft(quote.id, {
        customerId: quote.customerId,
        items: quote.draftItems,
        customerMessage: quoteMessage || undefined,
        validUntil: nextValidUntil,
      });
      setQuote(updated);
      notifySuccess("Orçamento atualizado.");
      setQuoteDialogOpen(false);
    } catch (error) {
      notifyError(serviceWorkErrorMessage(error));
    } finally {
      setSavingQuoteDraft(false);
    }
  }, [quote, quoteMessage, quoteValidUntil]);

  const openPaymentDialog = useCallback(() => {
    setPaymentAmount("");
    setPaymentMethod("cash");
    setPaymentDialogOpen(true);
  }, []);

  const handleRecordPayment = useCallback(async () => {
    if (!work) return;
    const amountCents = reaisInputToCents(paymentAmount);
    if (amountCents <= 0) {
      notifyError("Informe um valor de pagamento maior que zero.");
      return;
    }
    setRecordingPayment(true);
    try {
      await recordServicePayment(work.id, { amountCents, method: paymentMethod });
      notifySuccess("Recebimento registrado.");
      setPaymentDialogOpen(false);
      refresh();
    } catch (error) {
      notifyError(serviceWorkErrorMessage(error));
    } finally {
      setRecordingPayment(false);
    }
  }, [work, paymentAmount, paymentMethod, refresh]);

  const openRefundDialog = useCallback(() => {
    setRefundPaymentId(refundablePayments[0]?.id ?? "");
    setRefundAmount("");
    setRefundReason("");
    setRefundDialogOpen(true);
  }, [refundablePayments]);

  const handleRefundPayment = useCallback(async () => {
    if (!work || !refundPaymentId) return;
    const amountCents = reaisInputToCents(refundAmount);
    if (amountCents <= 0) {
      notifyError("Informe um valor de reembolso maior que zero.");
      return;
    }
    setRefundingPayment(true);
    try {
      await refundServicePayment(work.id, refundPaymentId, { amountCents, reason: refundReason || undefined });
      notifySuccess("Reembolso registrado.");
      setRefundDialogOpen(false);
      refresh();
    } catch (error) {
      notifyError(serviceWorkErrorMessage(error));
    } finally {
      setRefundingPayment(false);
    }
  }, [work, refundPaymentId, refundAmount, refundReason, refresh]);

  if (work === undefined) {
    return (
      <Layout title="Atendimento">
        <div className="mx-auto max-w-3xl px-4 py-4"><PageSkeleton variant="cards" /></div>
      </Layout>
    );
  }

  if (!work) {
    return (
      <Layout title="Atendimento">
        <div className="mx-auto max-w-3xl px-4 py-4">
          <EmptyState
            icon={<CalendarClock className="h-12 w-12 text-muted-foreground/30" />}
            title="Atendimento não encontrado"
            description={workError || "Este atendimento pode ter sido removido."}
          />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Atendimento">
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-4">
        {/* Header */}
        <div className="space-y-2 rounded-3xl bg-white p-4 shadow-sm">
          <p className="text-lg font-black text-foreground" data-testid="text-work-service-name">{serviceName}</p>
          {customerName && <p className="text-sm text-muted-foreground" data-testid="text-work-customer">{customerName}</p>}
          {work.customerContactSnapshot && <p className="text-sm text-muted-foreground">Telefone: {work.customerContactSnapshot.phone}</p>}
          {booking && (
            <p className="text-sm text-muted-foreground" data-testid="text-work-schedule">
              {formatLocalDate(new Date(booking.startAt), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })} · {formatTimeInTimezone(booking.startAt, bookingTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone)} - {formatTimeInTimezone(booking.endAt, bookingTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone)}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="rounded-full bg-primary/15 px-3 py-1 text-[10px] font-black text-primary" data-testid="text-work-status">
              {serviceWorkStatusLabel(work.status)}
            </span>
            <span className="text-sm font-bold text-foreground">{formatCentsBRL(work.totals.contractedTotalCents)}</span>
          </div>
        </div>

        {/* Lifecycle actions */}
        {(work.status === "planned" || work.status === "in_progress") && (
          <div className="flex flex-col gap-2" data-testid="section-work-actions">
            {work.status === "planned" && (
              <Button type="button" onClick={handleStart} disabled={transitioning} data-testid="button-work-start" className="rounded-full">
                {transitioning ? "Iniciando…" : "Iniciar atendimento"}
              </Button>
            )}
            {work.status === "in_progress" && (
              <Button type="button" onClick={handleComplete} disabled={transitioning} data-testid="button-work-complete" className="rounded-full">
                {transitioning ? "Concluindo…" : "Concluir atendimento"}
              </Button>
            )}
            <ConfirmActionDialog
              trigger={<Button type="button" variant="outline" disabled={transitioning} data-testid="button-work-cancel" className="rounded-full border-red-200 text-red-600">Cancelar atendimento</Button>}
              title="Cancelar atendimento?"
              description="Esta ação não pode ser desfeita."
              confirmLabel="Cancelar atendimento"
              onConfirm={handleCancel}
              disabled={transitioning}
            />
          </div>
        )}

        {/* Orçamento */}
        <div className="space-y-3 rounded-3xl bg-white p-4 shadow-sm" data-testid="section-work-quote">
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-black text-foreground">Orçamento</p>
          </div>
          {quote === undefined ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : quoteError ? (
            <p className="text-sm text-red-600">{quoteError}</p>
          ) : quote ? (
            <div className="space-y-3" data-testid="card-work-quote">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Status</span>
                <span className="font-bold text-foreground">{quoteStatusLabel(quote.status)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total</span>
                <span className="font-bold text-foreground">{formatCentsBRL(quote.draftTotals.contractedTotalCents)}</span>
              </div>
              {quote.draftValidUntil && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Válido até</span>
                  <span className="font-bold text-foreground">{formatLocalDate(new Date(quote.draftValidUntil), "dd/MM/yyyy", { locale: ptBR })}</span>
                </div>
              )}
              {quote.status === "draft" && (
                <Button type="button" variant="outline" size="sm" onClick={openEditQuoteDialog} data-testid="button-work-edit-quote" className="rounded-full">
                  Editar orçamento
                </Button>
              )}
            </div>
          ) : (
            <EmptyState
              title="Nenhum orçamento vinculado a este atendimento."
              description={
                workCanReceiveQuote
                  ? "Você pode criar um orçamento com os itens deste atendimento."
                  : "Este atendimento não pode mais receber um novo orçamento."
              }
              action={workCanReceiveQuote
                ? <Button type="button" onClick={openCreateQuoteDialog} data-testid="button-work-create-quote" className="rounded-full">Criar orçamento</Button>
                : undefined}
            />
          )}
        </div>

        {/* Financeiro */}
        <div className="space-y-3 rounded-3xl bg-white p-4 shadow-sm" data-testid="section-work-financial">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-black text-foreground">Financeiro</p>
          </div>
          {financials && (
            <div className="space-y-1.5 text-sm" data-testid="card-work-financial-summary">
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Valor do serviço</span><span className="font-bold text-foreground">{formatCentsBRL(financials.contractedTotalCents)}</span></div>
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Total recebido</span><span className="font-bold text-foreground" data-testid="text-financial-gross">{formatCentsBRL(financials.grossReceivedCents)}</span></div>
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Total reembolsado</span><span className="font-bold text-foreground" data-testid="text-financial-refunded">{formatCentsBRL(financials.refundedTotalCents)}</span></div>
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Recebido líquido</span><span className="font-bold text-foreground" data-testid="text-financial-net">{formatCentsBRL(financials.netReceivedCents)}</span></div>
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Saldo a receber</span><span className="font-bold text-foreground" data-testid="text-financial-balance">{formatCentsBRL(financials.balanceCents)}</span></div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-muted-foreground">Situação</span>
                <span className="rounded-full bg-secondary px-3 py-1 text-[10px] font-black text-foreground" data-testid="text-financial-status">{financialStatusLabel(financials.financialStatus)}</span>
              </div>
              {financials.refundedTotalCents > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Reembolso</span>
                  <span className="text-xs font-bold text-foreground" data-testid="text-financial-refund-status">{refundStatusLabel(financials.refundStatus)}</span>
                </div>
              )}
            </div>
          )}

          {work.status !== "cancelled" && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" size="sm" onClick={openPaymentDialog} data-testid="button-open-record-payment" className="rounded-full">Registrar recebimento</Button>
              {refundablePayments.length > 0 && (
                <Button type="button" size="sm" variant="outline" onClick={openRefundDialog} data-testid="button-open-record-refund" className="rounded-full">Registrar reembolso</Button>
              )}
            </div>
          )}

          <div className="space-y-2 border-t border-border/60 pt-3">
            <p className="text-xs font-bold text-muted-foreground">Movimentações</p>
            {financialLoading ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : financialError ? (
              <p className="text-sm text-red-600">{financialError}</p>
            ) : movements.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-financial-empty">Nenhuma movimentação registrada ainda.</p>
            ) : (
              <ul className="space-y-1.5" data-testid="list-financial-movements">
                {movements.map((movement, index) => (
                  <li key={`${movement.kind}-${movement.at}-${index}`} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {movement.kind === "payment" ? `Recebimento — ${paymentMethodLabel(movement.method)}` : "Reembolso"} · {formatLocalDate(new Date(movement.at), "dd/MM/yyyy", { locale: ptBR })}
                    </span>
                    <span className={`font-bold ${movement.kind === "refund" ? "text-red-600" : "text-foreground"}`}>
                      {movement.kind === "refund" ? "-" : ""}{formatCentsBRL(movement.amountCents)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Criar/editar orçamento */}
      <Dialog open={quoteDialogOpen} onOpenChange={setQuoteDialogOpen}>
        <DialogContent className="max-w-sm rounded-[2rem]" data-testid="dialog-quote">
          <DialogHeader>
            <DialogTitle>{quote ? "Editar orçamento" : "Criar orçamento"}</DialogTitle>
            <DialogDescription>
              {quote ? "Atualize a mensagem e a validade do orçamento." : "Um orçamento será criado com os itens deste atendimento."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="quote-message">Mensagem para o cliente (opcional)</Label>
              <Textarea id="quote-message" value={quoteMessage} onChange={(event) => setQuoteMessage(event.target.value)} data-testid="input-quote-message" />
            </div>
            <div>
              <Label htmlFor="quote-valid-until">Válido até (opcional)</Label>
              <Input id="quote-valid-until" type="date" value={quoteValidUntil} onChange={(event) => setQuoteValidUntil(event.target.value)} data-testid="input-quote-valid-until" />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              onClick={quote ? handleSaveQuoteDraft : handleCreateQuote}
              disabled={quote ? savingQuoteDraft : creatingQuote}
              data-testid="button-confirm-quote"
              className="w-full rounded-full"
            >
              {quote ? (savingQuoteDraft ? "Salvando…" : "Salvar orçamento") : (creatingQuote ? "Criando…" : "Criar orçamento")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Registrar recebimento */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="max-w-sm rounded-[2rem]" data-testid="dialog-record-payment">
          <DialogHeader>
            <DialogTitle>Registrar recebimento</DialogTitle>
            <DialogDescription>Informe o valor recebido e a forma de pagamento.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="payment-amount">Valor</Label>
              <Input id="payment-amount" type="number" inputMode="decimal" min={0} step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} data-testid="input-payment-amount" />
            </div>
            <div>
              <Label htmlFor="payment-method">Forma de pagamento</Label>
              <select
                id="payment-method"
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)}
                data-testid="select-payment-method"
                className="rs-input w-full rounded-xl border border-border bg-white px-3 py-2 text-sm"
              >
                <option value="cash">Dinheiro</option>
                <option value="pix">Pix</option>
                <option value="card">Cartão</option>
                <option value="manual">Outro</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" onClick={handleRecordPayment} disabled={recordingPayment} data-testid="button-confirm-record-payment" className="w-full rounded-full">
              {recordingPayment ? "Registrando…" : "Registrar recebimento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Registrar reembolso */}
      <Dialog open={refundDialogOpen} onOpenChange={setRefundDialogOpen}>
        <DialogContent className="max-w-sm rounded-[2rem]" data-testid="dialog-record-refund">
          <DialogHeader>
            <DialogTitle>Registrar reembolso</DialogTitle>
            <DialogDescription>Escolha o pagamento e informe o valor a reembolsar.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="refund-payment">Pagamento</Label>
              <select
                id="refund-payment"
                value={refundPaymentId}
                onChange={(event) => setRefundPaymentId(event.target.value)}
                data-testid="select-refund-payment"
                className="rs-input w-full rounded-xl border border-border bg-white px-3 py-2 text-sm"
              >
                {refundablePayments.map((payment) => (
                  <option key={payment.id} value={payment.id}>
                    {paymentMethodLabel(payment.method)} — recebido {formatCentsBRL(payment.amountCents)} — disponível {formatCentsBRL(payment.amountCents - payment.refundedTotalCents)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="refund-amount">Valor a reembolsar</Label>
              <Input id="refund-amount" type="number" inputMode="decimal" min={0} step="0.01" value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} data-testid="input-refund-amount" />
            </div>
            <div>
              <Label htmlFor="refund-reason">Motivo (opcional)</Label>
              <Input id="refund-reason" value={refundReason} onChange={(event) => setRefundReason(event.target.value)} data-testid="input-refund-reason" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" onClick={handleRefundPayment} disabled={refundingPayment || !refundPaymentId} data-testid="button-confirm-record-refund" className="w-full rounded-full">
              {refundingPayment ? "Registrando…" : "Registrar reembolso"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

function quoteStatusLabel(status: Quote["status"]): string {
  if (status === "draft") return "Rascunho";
  if (status === "sent") return "Enviado";
  if (status === "accepted") return "Aceito";
  if (status === "rejected") return "Recusado";
  return "Cancelado";
}
