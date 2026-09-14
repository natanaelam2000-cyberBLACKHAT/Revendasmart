import { useState, useMemo, useEffect, useRef } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Layout } from "@/components/layout";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import {
  Receipt, Calendar, CheckCircle, Clock, AlertCircle, MessageSquare,
  Download, Bell, Link2, Copy, Check, RefreshCw, ExternalLink, Plus
} from "lucide-react";
import { Installment, defaultSettings } from "@/lib/mock-data";
import { format, isToday, isBefore, addDays, parseISO, isSameDay, startOfDay } from "@/lib/date-utils";
import { getFirebaseAuth, logError, logEvent, logTelemetryEvent, trackAnalyticsEvent } from "@/lib/firebase";
import { collection, query, onSnapshot, doc, updateDoc, orderBy, where, limit, startAfter, getDocs, getFirestore, documentId, type DocumentData, type QueryConstraint, type QueryDocumentSnapshot } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useCharges, CHARGE_STATUS_LABELS, CHARGE_STATUS_COLORS, CHARGE_MODE_LABELS } from "@/hooks/useCharges";
import { useUserSettings } from "@/providers/UserSettingsProvider";
import { PaymentLinkModal } from "@/components/PaymentLinkModal";
import { PartialPaymentModal } from "@/components/PartialPaymentModal";
import { getApiUrl } from "@/lib/api-config";
import { notifyError, notifyInfo, notifySuccess } from "@/lib/notify";
import { toCsvRow } from "@/lib/export-security";
import { formatCurrency } from "@/lib/product-pricing";
import type { Charge } from "../../../shared/charges";

type BillingTab = "installments" | "charges";
type InstallmentFilter = "today" | "late" | "next" | "all";
const INSTALLMENTS_PAGE_SIZE = 30;
const CLIENT_LOOKUP_BATCH_SIZE = 10;

interface BillingClient { id: string; name: string; phone?: string }
type ClientSnapshotFields = { clientName?: string; clientPhone?: string };
type InstallmentWithClientSnapshot = Installment & ClientSnapshotFields;
type ChargeWithClientSnapshot = Charge & ClientSnapshotFields;

function mapClientDoc(doc: QueryDocumentSnapshot<DocumentData>): BillingClient {
  const data = doc.data() as { name?: string; phone?: string };
  return { id: doc.id, name: data.name || "Cliente", phone: data.phone };
}

function shouldLookupClient(record: { clientId?: string; clientName?: string; clientPhone?: string }): boolean {
  return Boolean(record.clientId && (!record.clientName || !record.clientPhone));
}

function collectClientIdsForLookup(installments: InstallmentWithClientSnapshot[], charges: ChargeWithClientSnapshot[]): string[] {
  const ids = new Set<string>();
  for (const installment of installments) {
    if (shouldLookupClient(installment)) ids.add(installment.clientId);
  }
  for (const charge of charges) {
    if (shouldLookupClient(charge)) ids.add(charge.clientId);
  }
  return Array.from(ids);
}

async function fetchClientsByIds(uid: string, clientIds: string[]): Promise<BillingClient[]> {
  if (clientIds.length === 0) return [];

  const db = getFirestore();
  const clients: BillingClient[] = [];
  for (let index = 0; index < clientIds.length; index += CLIENT_LOOKUP_BATCH_SIZE) {
    const batch = clientIds.slice(index, index + CLIENT_LOOKUP_BATCH_SIZE);
    const snapshot = await getDocs(
      query(
        collection(db, "users", uid, "clients"),
        where(documentId(), "in", batch)
      )
    );
    clients.push(...snapshot.docs.map(mapClientDoc));
  }
  return clients;
}

export default function Billings() {
  const { settings: firestoreSettings } = useUserSettings();
  const settings = firestoreSettings || defaultSettings;
  const [billings, setBillings] = useState<Installment[]>([]);
  const [clientLookup, setClientLookup] = useState<BillingClient[]>([]);
  const [modalClients, setModalClients] = useState<BillingClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<BillingTab>("charges");
  const [filter, setFilter] = useState<InstallmentFilter>("all");
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [resyncingId, setResyncingId] = useState<string | null>(null);
  const [partialPaymentId, setPartialPaymentId] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [hasMoreInstallments, setHasMoreInstallments] = useState(false);
  const [loadingMoreInstallments, setLoadingMoreInstallments] = useState(false);
  const lastInstallmentDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);

  // Charges hook (real-time from Firestore users/{uid}/charges)
  const { charges, loading: chargesLoading, loadingMoreCharges, hasMoreCharges, loadMoreCharges } = useCharges();

  const createInstallmentsQuery = (uid: string, selectedFilter: InstallmentFilter, cursor?: QueryDocumentSnapshot<DocumentData> | null) => {
    const db = getFirestore();
    const installmentsRef = collection(db, "users", uid, "installments");
    const constraints: QueryConstraint[] = [];
    const today = startOfDay(new Date());

    if (selectedFilter === "today") {
      constraints.push(where("dueDate", ">=", today.toISOString()));
      constraints.push(where("dueDate", "<", addDays(today, 1).toISOString()));
    } else if (selectedFilter === "late") {
      constraints.push(where("status", "in", ["pending", "partial", "overdue"]));
      constraints.push(where("dueDate", "<", today.toISOString()));
    } else if (selectedFilter === "next") {
      constraints.push(where("status", "in", ["pending", "partial", "overdue"]));
      constraints.push(where("dueDate", ">=", today.toISOString()));
      constraints.push(where("dueDate", "<", addDays(today, 7).toISOString()));
    }

    constraints.push(orderBy("dueDate", "asc"));
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(INSTALLMENTS_PAGE_SIZE));
    return query(installmentsRef, ...constraints);
  };

  // Load installments from Firestore by active filter.
  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) { setLoading(false); return; }

    let unsubInstallments: (() => void) | undefined;
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      unsubInstallments?.();
      lastInstallmentDocRef.current = null;
      if (!user) {
        setBillings([]);
        setHasMoreInstallments(false);
        setLoading(false);
        return;
      }

      setLoading(true);
      unsubInstallments = onSnapshot(
        createInstallmentsQuery(user.uid, filter),
        (snap) => {
          const data = snap.docs.map((d) => ({ ...d.data(), id: d.id })) as Installment[];
          lastInstallmentDocRef.current = snap.docs[snap.docs.length - 1] ?? null;
          setBillings(data);
          setHasMoreInstallments(snap.docs.length === INSTALLMENTS_PAGE_SIZE);
          setLoading(false);
        },
        (err) => {
          console.error("[billings] Failed to load installments:", err);
          setHasMoreInstallments(false);
          setLoading(false);
        }
      );
    });

    return () => {
      unsubInstallments?.();
      unsubAuth();
    };
  }, [filter]);

  // Load only clients referenced by the current page of charges/installments.
  // New documents may carry clientName/clientPhone; old documents fall back to this point lookup.
  useEffect(() => {
    const auth = getFirebaseAuth();
    const user = auth?.currentUser;
    if (!user) {
      setClientLookup([]);
      return;
    }

    const ids = collectClientIdsForLookup(billings as InstallmentWithClientSnapshot[], charges as ChargeWithClientSnapshot[]);
    if (ids.length === 0) {
      setClientLookup([]);
      return;
    }

    let cancelled = false;
    fetchClientsByIds(user.uid, ids)
      .then((clients) => {
        if (!cancelled) setClientLookup(clients);
      })
      .catch((err) => {
        console.error("[billings] Failed to resolve referenced clients:", err);
        if (!cancelled) setClientLookup([]);
      });

    return () => { cancelled = true; };
  }, [billings, charges]);

  // Load the full clients list only while the payment-link modal needs it.
  useEffect(() => {
    if (!showPaymentModal) {
      setModalClients([]);
      return;
    }

    const auth = getFirebaseAuth();
    if (!auth) return;

    let unsubClients: (() => void) | undefined;
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      unsubClients?.();
      if (!user) { setModalClients([]); return; }

      const db = getFirestore();
      unsubClients = onSnapshot(
        query(collection(db, "users", user.uid, "clients"), orderBy("name")),
        (snap) => {
          setModalClients(snap.docs.map(mapClientDoc));
        },
        (err) => {
          console.error("[billings] Failed to load clients for payment modal:", err);
          setModalClients([]);
        }
      );
    });

    return () => {
      unsubClients?.();
      unsubAuth();
    };
  }, [showPaymentModal]);

  const clientById = useMemo(() => new Map(clientLookup.map((client) => [client.id, client])), [clientLookup]);
  const billingById = useMemo(() => new Map(billings.map((billing) => [billing.id, billing])), [billings]);
  const getRecordClient = (record?: { clientId?: string; clientName?: string; clientPhone?: string }): BillingClient | undefined => {
    if (!record?.clientId) return undefined;
    const fallback = clientById.get(record.clientId);
    return {
      id: record.clientId,
      name: record.clientName || fallback?.name || "Cliente",
      phone: record.clientPhone || fallback?.phone,
    };
  };

  const loadMoreInstallments = async () => {
    const auth = getFirebaseAuth();
    const user = auth?.currentUser;
    if (!user || loadingMoreInstallments || !hasMoreInstallments || !lastInstallmentDocRef.current) return;

    setLoadingMoreInstallments(true);
    try {
      const snap = await getDocs(createInstallmentsQuery(user.uid, filter, lastInstallmentDocRef.current));
      const nextData = snap.docs.map((d) => ({ ...d.data(), id: d.id })) as Installment[];
      lastInstallmentDocRef.current = snap.docs[snap.docs.length - 1] ?? lastInstallmentDocRef.current;
      setBillings((current) => {
        const byId = new Map<string, Installment>();
        for (const billing of current) byId.set(billing.id, billing);
        for (const billing of nextData) byId.set(billing.id, billing);
        return Array.from(byId.values()).sort((a, b) => parseISO(a.dueDate).getTime() - parseISO(b.dueDate).getTime());
      });
      setHasMoreInstallments(snap.docs.length === INSTALLMENTS_PAGE_SIZE);
    } catch (err) {
      console.error("[billings] Failed to load more installments:", err);
      notifyError("Não foi possível carregar mais parcelas.");
    } finally {
      setLoadingMoreInstallments(false);
    }
  };

  // ── Installment filter ──────────────────────────────────────────────────
  const filteredInstallments = useMemo(() => {
    return billings
      .filter((b) => {
        const date = parseISO(b.dueDate);
        if (filter === "today") return isToday(date);
        if (filter === "late") return isBefore(date, new Date()) && b.status !== "paid" && !isToday(date);
        if (filter === "next") return isBefore(date, addDays(new Date(), 7)) && !isBefore(date, new Date()) && b.status !== "paid";
        return true;
      })
      .sort((a, b) => parseISO(a.dueDate).getTime() - parseISO(b.dueDate).getTime());
  }, [billings, filter]);

  // ── Installment handlers ────────────────────────────────────────────────
  const handlePay = async (id: string, partial: boolean = false) => {
    if (!partial) {
      // Full payment
      const billing = billingById.get(id);
      if (!billing) return;
      
      const auth = getFirebaseAuth();
      const user = auth?.currentUser;
      if (!user) {
        setPaymentError("Usuário não autenticado");
        return;
      }

      try {
        const db = getFirestore();
        await updateDoc(doc(db, "users", user.uid, "installments", id), {
          status: "paid",
          paidAmount: billing.amount,
        });
        logTelemetryEvent("installment_paid", { installmentId: id, amount: billing.amount }, user.uid);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro ao atualizar pagamento";
        setPaymentError(msg);
        logError("installment_payment_failed", msg, { context: { installmentId: id } });
      }
    } else {
      // Partial payment — show modal
      setPartialPaymentId(id);
    }
  };

  const handlePartialPaymentSubmit = async (amount: number) => {
    if (!partialPaymentId) return;

    const billing = billingById.get(partialPaymentId);
    if (!billing) return;

    const auth = getFirebaseAuth();
    const user = auth?.currentUser;
    if (!user) {
      setPaymentError("Usuário não autenticado");
      return;
    }

    try {
      const db = getFirestore();
      const newPaidAmount = billing.paidAmount + amount;
      const newStatus = newPaidAmount >= billing.amount ? "paid" : "partial";

      await updateDoc(doc(db, "users", user.uid, "installments", partialPaymentId), {
        status: newStatus,
        paidAmount: newPaidAmount,
      });

      logTelemetryEvent("installment_partial_payment", {
        installmentId: partialPaymentId,
        amount,
        totalPaid: newPaidAmount,
      }, user.uid);

      setPartialPaymentId(null);
      setPaymentError("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao registrar pagamento";
      setPaymentError(msg);
      logError("installment_partial_payment_failed", msg, { context: { installmentId: partialPaymentId } });
    }
  };

  const sendWhatsApp = (billing: Installment, type: "reminder" | "received" | "thanks") => {
    const client = getRecordClient(billing as InstallmentWithClientSnapshot);
    if (!client?.phone) return;
    const amount = formatCurrency(billing.amount - billing.paidAmount);
    const date = format(parseISO(billing.dueDate), "dd/MM");
    let message: string;
if (type === "reminder") {
      message = `Olá ${client.name}! Passando para lembrar da sua parcela de ${amount} que vence dia ${date}. Pode enviar o comprovante por aqui? ✨`;
    } else if (type === "received") {
      message = `Olá ${client.name}! Recebi seu pagamento de ${formatCurrency(billing.paidAmount)}. Saldo atualizado com sucesso! ✅`;
    } else {
      message = `Olá ${client.name}! Passando para agradecer pela preferência. Espero que esteja amando seus produtinhos! 💖`;
    }
    window.open(`https://wa.me/${client.phone}?text=${encodeURIComponent(message)}`, "_blank");
  };

  const exportCSV = () => {
    const headers = toCsvRow(["Data", "Cliente", "Valor", "Status"]) + "\n";
    const rows = billings
      .map((b) => toCsvRow([format(parseISO(b.dueDate), "dd/MM/yyyy"), getRecordClient(b as InstallmentWithClientSnapshot)?.name || "N/A", b.amount, b.status]))
      .join("\n");
    const blob = new Blob([`\uFEFF${headers}${rows}`], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cobrancas.csv";
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const reminderInfo = useMemo(() => {
    if (!settings?.notification_settings?.enable_billing_reminders) return null;
    const days = settings.notification_settings.reminder_days_before_due || 1;
    const today = new Date();
    const targetDate = addDays(today, days);
    const count = billings.filter((b) => {
      if (b.status === "paid") return false;
      try {
        const dueDate = parseISO(b.dueDate);
        return isToday(dueDate) || (isBefore(dueDate, targetDate) && !isBefore(dueDate, today)) || isSameDay(dueDate, targetDate);
      } catch { return false; }
    }).length;
    return count > 0 ? count : null;
  }, [billings, settings]);

  // ── Charge handlers ─────────────────────────────────────────────────────
  const copyChargeLink = async (charge: Charge) => {
    try {
      await navigator.clipboard.writeText(charge.paymentUrl);
      setCopiedId(charge.id);
      notifySuccess("Link copiado.");
      setTimeout(() => setCopiedId(null), 2000);
      
      // Track copy event (both telemetry and analytics)
      const user = getFirebaseAuth()?.currentUser;
      logTelemetryEvent("payment_link_copied", { chargeId: charge.id }, user?.uid);
      trackAnalyticsEvent("payment_link_copied", { value: charge.amount });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Erro desconhecido";
      notifyError("Não foi possível copiar o link.");
      logError("copy_charge_link_error", errorMsg, {
        error: err instanceof Error ? err : undefined,
        context: { chargeId: charge.id },
        severity: "warning",
      });
    }
  };

  const shareChargeWhatsApp = (charge: Charge) => {
    const client = getRecordClient(charge as ChargeWithClientSnapshot);
    const name = client?.name ?? "cliente";
    const msg = `Olá ${name}! Segue o link para pagamento de ${formatCurrency(charge.amount)}: ${charge.paymentUrl} 💳`;
    window.open(`https://wa.me/${client?.phone ?? ""}?text=${encodeURIComponent(msg)}`, "_blank");
    notifyInfo("Cobrança aberta no WhatsApp.");
  };

  const partialPaymentBilling = partialPaymentId ? billingById.get(partialPaymentId) : undefined;

  const resyncCharge = async (charge: Charge) => {
    const auth = getFirebaseAuth();
    const user = auth?.currentUser;
    if (!user) return;
    setResyncingId(charge.id);
    try {
      const token = await user.getIdToken();
      await fetch(getApiUrl(`/api/payments/resync/${charge.id}`), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      notifySuccess("Cobrança sincronizada.");
    } catch (err) {
      notifyError("Não foi possível sincronizar a cobrança.");
      console.error("[billings] resync error:", err);
    } finally {
      setResyncingId(null);
    }
  };

  const deleteCharge = async (charge: Charge) => {
    const auth = getFirebaseAuth();
    const user = auth?.currentUser;
    if (!user) return;

    setDeletingId(charge.id);
    try {
      const token = await user.getIdToken();
      const response = await fetch(getApiUrl(`/api/payments/${charge.id}`), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (!response.ok) {
        throw new Error("Erro ao remover link de pagamento");
      }
      
      logTelemetryEvent("payment_link_deleted", { chargeId: charge.id }, user?.uid);
      notifySuccess("Cobrança removida.");
      setPaymentError("");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Erro desconhecido";
      console.error("[billings] delete error:", err);
      notifyError("Não foi possível remover a cobrança.");
      setPaymentError(errorMsg);
      setTimeout(() => setPaymentError(""), 5000);
    } finally {
      setDeletingId(null);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────
  const isLoading = loading || chargesLoading;

  if (isLoading) {
    return <Layout title="Cobranças"><PageSkeleton variant="list" /></Layout>;
  }

  return (
    <Layout title="Cobranças" hideBottomNav={showPaymentModal}>
      <div className="p-6">
        {/* Reminder banner */}
        {reminderInfo && (
          <div className="mb-6 p-4 bg-primary/10 border border-primary/20 rounded-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4">
            <div className="w-10 h-10 bg-primary/20 rounded-xl flex items-center justify-center text-primary">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-primary">Lembrete de Cobrança</p>
              <p className="text-[10px] text-primary/80">
                Você tem {reminderInfo} {reminderInfo === 1 ? "recebível" : "recebíveis"} vencendo em breve.
              </p>
            </div>
          </div>
        )}

        {/* Tab switcher */}
        <div className="flex gap-2 mb-6">
          <button
            data-testid="tab-charges"
            onClick={() => setActiveTab("charges")}
            className={`flex-1 py-2.5 rounded-2xl text-xs font-semibold transition-all ${
              activeTab === "charges" ? "bg-primary text-white shadow-sm" : "bg-secondary text-muted-foreground"
            }`}
          >
            💳 Links de Pag.
          </button>
          <button
            data-testid="tab-installments"
            onClick={() => setActiveTab("installments")}
            className={`flex-1 py-2.5 rounded-2xl text-xs font-semibold transition-all ${
              activeTab === "installments" ? "bg-primary text-white shadow-md" : "bg-secondary text-muted-foreground"
            }`}
          >
            📅 Parcelas
          </button>
        </div>

        {/* ═══════════════════════════════════════════════
            TAB: CHARGES (Mercado Pago)
        ═══════════════════════════════════════════════ */}
        {activeTab === "charges" && (
          <div>
            {/* Header row */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs text-muted-foreground font-medium">
                  {charges.length} {charges.length === 1 ? "cobrança" : "cobranças"}
                </p>
              </div>
              <button
                data-testid="button-open-payment-modal"
                onClick={() => setShowPaymentModal(true)}
                className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-2xl text-xs font-semibold shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" /> Novo link
              </button>
            </div>

            {/* Charge cards */}
            <div className="space-y-3">
              {charges.length === 0 ? (
                <div className="rounded-[2rem] border border-dashed border-border/60 bg-white px-6 py-16 text-center flex flex-col items-center">
                  <div className="w-20 h-20 bg-primary/10 rounded-[2rem] flex items-center justify-center mb-4">
                    <Link2 className="w-8 h-8 text-primary/45" />
                  </div>
                  <p className="font-semibold text-sm text-foreground">Nenhuma cobrança criada</p>
                  <p className="text-xs leading-relaxed text-muted-foreground mt-2 max-w-[240px]">
                    Crie um link de pagamento para cobrar clientes por Pix ou cartão.
                  </p>
                  <button
                    data-testid="button-open-payment-modal-empty"
                    onClick={() => setShowPaymentModal(true)}
                    className="rs-pressable mt-5 bg-primary text-white px-6 py-3 rounded-2xl text-xs font-semibold shadow-sm"
                  >
                    Criar cobrança
                  </button>
                </div>
              ) : (
                charges.map((charge) => {
                  const client = getRecordClient(charge as ChargeWithClientSnapshot);
                  const statusLabel = CHARGE_STATUS_LABELS[charge.status] ?? charge.status;
                  const statusColor = CHARGE_STATUS_COLORS[charge.status] ?? "bg-gray-100 text-gray-600";

                  return (
                    <div
                      key={charge.id}
                      data-testid={`card-charge-${charge.id}`}
                      className="bg-white rounded-[2rem] p-5 border border-border/50 shadow-sm relative overflow-hidden"
                    >
                      {/* Left accent bar by status */}
                      <div
                        className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-[2rem] ${
                          charge.status === "paid"
                            ? "bg-green-500"
                            : charge.status === "failed" || charge.status === "cancelled"
                            ? "bg-destructive"
                            : "bg-primary"
                        }`}
                      />

                      {/* Top row */}
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <h3 className="font-bold text-sm">{client?.name ?? "Cliente"}</h3>
                          <p className="text-[10px] text-muted-foreground font-medium mt-0.5">
                            {format(new Date(charge.createdAt), "dd/MM/yyyy")}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span
                            data-testid={`status-charge-${charge.id}`}
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusColor}`}
                          >
                            {statusLabel}
                          </span>
                          <span className="text-[9px] text-muted-foreground font-medium">
                            {CHARGE_MODE_LABELS[charge.mode] ?? charge.mode}
                          </span>
                        </div>
                      </div>

                      {/* Amount + title */}
                      <div className="mb-3">
                        <p className="text-xl font-semibold">{formatCurrency(charge.amount)}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{charge.title}</p>
                        {charge.paidAt && (
                          <p className="text-[10px] text-green-600 font-bold mt-0.5">
                            ✓ Pago em {format(new Date(charge.paidAt), "dd/MM/yyyy")}
                          </p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 flex-wrap">
                        {/* Open link */}
                        <a
                          data-testid={`button-open-link-${charge.id}`}
                          href={charge.paymentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 bg-secondary text-foreground text-[10px] font-semibold px-3 py-1.5 rounded-xl"
                        >
                          <ExternalLink className="w-3 h-3" /> Abrir
                        </a>

                        {/* Copy link */}
                        <button
                          data-testid={`button-copy-link-${charge.id}`}
                          onClick={() => copyChargeLink(charge)}
                          className={`flex items-center gap-1.5 text-[10px] font-semibold px-3 py-1.5 rounded-xl transition-all ${
                            copiedId === charge.id
                              ? "bg-green-500 text-white"
                              : "bg-secondary text-foreground"
                          }`}
                        >
                          {copiedId === charge.id ? (
                            <><Check className="w-3 h-3" /> Copiado!</>
                          ) : (
                            <><Copy className="w-3 h-3" /> Copiar</>
                          )}
                        </button>

                        {/* WhatsApp */}
                        <button
                          data-testid={`button-whatsapp-charge-${charge.id}`}
                          onClick={() => shareChargeWhatsApp(charge)}
                          className="flex items-center gap-1.5 bg-[#25D366]/10 text-[#25D366] text-[10px] font-semibold px-3 py-1.5 rounded-xl"
                        >
                          <MessageSquare className="w-3 h-3" /> WhatsApp
                        </button>

                        {/* Resync */}
                        {charge.mercadoPagoPaymentId && charge.status !== "paid" && (
                          <button
                            data-testid={`button-resync-${charge.id}`}
                            onClick={() => resyncCharge(charge)}
                            disabled={resyncingId === charge.id}
                            className="flex items-center gap-1.5 bg-secondary text-foreground text-[10px] font-semibold px-3 py-1.5 rounded-xl disabled:opacity-50"
                          >
                            <RefreshCw className={`w-3 h-3 ${resyncingId === charge.id ? "animate-spin" : ""}`} />
                            Atualizar
                          </button>
                        )}

                        {/* Delete/Remove link */}
                        <button
                          data-testid={`button-delete-link-${charge.id}`}
                          onClick={() => deleteCharge(charge)}
                          disabled={deletingId === charge.id}
                          className="flex items-center gap-1.5 bg-destructive/10 text-destructive text-[10px] font-semibold px-3 py-1.5 rounded-xl disabled:opacity-50 ml-auto"
                        >
                          ✕ Remover
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
              {hasMoreCharges && (
                <div className="flex justify-center pt-2">
                  <button type="button" onClick={loadMoreCharges} disabled={loadingMoreCharges} className="rs-pressable rounded-2xl bg-white px-5 py-3 text-xs font-semibold text-primary border border-primary/20 shadow-sm disabled:opacity-60">
                    {loadingMoreCharges ? "Carregando..." : "Carregar mais"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════
            TAB: INSTALLMENTS (parcelas existentes)
        ═══════════════════════════════════════════════ */}
        {activeTab === "installments" && (
          <div>
            {/* Filter + export */}
            <div className="flex justify-between items-center mb-4">
              <div className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
                {[
                  { id: "today", label: "Hoje", icon: Clock },
                  { id: "late", label: "Atrasadas", icon: AlertCircle },
                  { id: "next", label: "Próximas", icon: Calendar },
                  { id: "all", label: "Todas", icon: Receipt },
                ].map((f) => (
                  <button
                    key={f.id}
                    data-testid={`filter-${f.id}`}
                    onClick={() => setFilter(f.id as InstallmentFilter)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-full whitespace-nowrap text-[10px] font-bold uppercase transition-all ${
                      filter === f.id
                        ? "bg-primary text-white shadow-md"
                        : "bg-white border border-border text-muted-foreground"
                    }`}
                  >
                    <f.icon className="w-3 h-3" /> {f.label}
                  </button>
                ))}
              </div>
              <button
                data-testid="button-export-csv"
                onClick={exportCSV}
                className="bg-secondary text-foreground p-2 rounded-xl border border-border ml-2"
              >
                <Download className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              {filteredInstallments.map((b) => {
                const client = getRecordClient(b as InstallmentWithClientSnapshot);
                const isLate =
                  isBefore(parseISO(b.dueDate), new Date()) &&
                  b.status !== "paid" &&
                  !isToday(parseISO(b.dueDate));

                return (
                  <div
                    key={b.id}
                    data-testid={`card-installment-${b.id}`}
                    className="bg-white rounded-[2rem] p-5 border border-border/50 shadow-sm relative overflow-hidden group"
                  >
                    <div
                      className={`absolute left-0 top-0 bottom-0 w-1 ${
                        b.status === "paid"
                          ? "bg-green-500"
                          : isLate
                          ? "bg-destructive"
                          : "bg-primary"
                      }`}
                    />
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="font-bold text-sm">{client?.name ?? "Desconhecido"}</h3>
                        <p className="text-[10px] text-muted-foreground font-medium mt-0.5">
                          Vence {format(parseISO(b.dueDate), "dd/MM/yyyy")}
                        </p>
                      </div>
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          b.status === "paid"
                            ? "bg-green-100 text-green-700"
                            : b.status === "partial"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-orange-100 text-orange-700"
                        }`}
                      >
                        {b.status === "paid" ? "Pago" : b.status === "partial" ? "Parcial" : "Pendente"}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xl font-semibold">{formatCurrency(b.status === "paid" ? b.amount : b.amount - b.paidAmount)}</p>
                        {b.paidAmount > 0 && b.status !== "paid" && (
                          <p className="text-[9px] text-muted-foreground">Pago: {formatCurrency(b.paidAmount)}</p>
                        )}
                        {b.status === "paid" && (
                          <p className="text-[9px] text-green-600 font-bold">Pagamento confirmado</p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          data-testid={`button-whatsapp-installment-${b.id}`}
                          onClick={() => sendWhatsApp(b, "reminder")}
                          className="w-10 h-10 rounded-2xl bg-[#25D366]/10 text-[#25D366] flex items-center justify-center active:scale-90 transition-all"
                        >
                          <MessageSquare className="w-5 h-5" />
                        </button>
                        <div className="flex flex-col gap-1">
                          {b.status !== "paid" && (
                            <>
                              <button
                                data-testid={`button-pay-${b.id}`}
                                onClick={() => handlePay(b.id)}
                                className="bg-primary text-white text-[10px] font-semibold px-4 py-1.5 rounded-xl shadow-sm"
                              >
                                Pago
                              </button>
                              <button
                                data-testid={`button-partial-${b.id}`}
                                onClick={() => handlePay(b.id, true)}
                                className="bg-secondary text-foreground text-[10px] font-semibold px-4 py-1.5 rounded-xl"
                              >
                                Parcial
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {filteredInstallments.length === 0 && (
                <p className="text-center py-20 text-muted-foreground text-sm font-medium">
                  Tudo em dia por aqui! ✨
                </p>
              )}
              {hasMoreInstallments && (
                <div className="flex justify-center pt-2">
                  <button type="button" onClick={loadMoreInstallments} disabled={loadingMoreInstallments} className="rs-pressable rounded-2xl bg-white px-5 py-3 text-xs font-semibold text-primary border border-primary/20 shadow-sm disabled:opacity-60">
                    {loadingMoreInstallments ? "Carregando..." : "Carregar mais"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Partial Payment Modal */}
      {partialPaymentId && (
        <PartialPaymentModal
          billingId={partialPaymentId}
          remainingAmount={(partialPaymentBilling?.amount || 0) - (partialPaymentBilling?.paidAmount || 0)}
          clientName={getRecordClient(partialPaymentBilling as InstallmentWithClientSnapshot | undefined)?.name || "Cliente"}
          onSubmit={handlePartialPaymentSubmit}
          onClose={() => setPartialPaymentId(null)}
        />
      )}

      {/* Payment link modal */}
      {showPaymentModal && (
        <PaymentLinkModal
          clients={modalClients.length > 0 ? modalClients : clientLookup}
          onClose={() => setShowPaymentModal(false)}
          onSuccess={() => setShowPaymentModal(false)}
        />
      )}
    </Layout>
  );
}
