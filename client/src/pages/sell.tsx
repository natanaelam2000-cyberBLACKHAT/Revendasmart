import { useEffect, useMemo, useState } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Client, Product } from "@/lib/mock-data";
import { Layout } from "@/components/layout";
import { ProductImageCard } from "@/components/ProductImageCard";
import { ClientPickerSheet } from "@/components/sell/ClientPickerSheet";
import { ChevronDown, Search, Plus, Minus, CheckCircle2, UserPlus, X, QrCode, DollarSign, CreditCard, Wallet, type LucideIcon } from "lucide-react";
import { useLocation } from "wouter";
import { collection, doc, getCountFromServer, getFirestore, setDoc } from "firebase/firestore";
import { usePlan } from "@/providers/PlanProvider";
import { checkClientLimit } from "@/lib/plan-helpers";
import { PLAN_CONFIG } from "@shared/monetization";
import { useProductPickerData } from "@/hooks/useProductPickerData";
import { useClientPickerData } from "@/hooks/useClientPickerData";
import { useDismissibleOnBack } from "@/hooks/useDismissibleOnBack";
import { getFirebaseAuth, logError, logTelemetryEvent, trackAnalyticsEvent, measureOperation } from "@/lib/firebase";
import { notifyError, notifySuccess, notifyWarning } from "@/lib/notify";
import { getApiUrl } from "@/lib/api-config";
import { resolveEffectiveProductPrice } from "@/lib/product-pricing";
import { resolveProductGender } from "@/lib/product-gender";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { queuePendingSale, isNetworkFailure } from "@/lib/offline-sales-queue";

const GENDER_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "feminino", label: "Feminino" },
  { value: "masculino", label: "Masculino" },
  { value: "unisex", label: "Unissex" },
];

type PaymentMethod = "pix" | "dinheiro" | "credito" | "debito";

const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string; icon: LucideIcon }[] = [
  { value: "pix", label: "Pix", icon: QrCode },
  { value: "dinheiro", label: "Dinheiro", icon: DollarSign },
  { value: "credito", label: "Crédito", icon: CreditCard },
  { value: "debito", label: "Débito", icon: Wallet },
];

/** Corpo de `/api/payments/create-link` — reutilizado tanto na tentativa inicial quanto no retry. O
 * `saleId` é o que permite o servidor reconhecer um retry e reaproveitar a cobrança já criada em vez de
 * duplicá-la (RELEASE-QUALITY-02 §5). */
interface SaleChargePayload {
  readonly uid: string;
  readonly clientId: string;
  readonly saleId: string;
  readonly title: string;
  readonly description: string;
  readonly amount: number;
  readonly metadata: Record<string, unknown>;
}

interface ChargeFailureState {
  readonly message: string;
  readonly payload: SaleChargePayload;
}

type CreateSaleChargeResult = { readonly ok: true } | { readonly ok: false; readonly message: string; readonly status?: number };

async function createSaleCharge(token: string, payload: SaleChargePayload): Promise<CreateSaleChargeResult> {
  const response = await fetch(getApiUrl("/api/payments/create-link"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const message = errorData.message || errorData.error || `HTTP ${response.status}`;
    return { ok: false, message, status: response.status };
  }
  return { ok: true };
}

export default function Sell() {
  const [, setLocation] = useLocation();
  const { products, loading: productsLoading, loadingMore: productsLoadingMore, error: productsError, hasMore: hasMoreProducts, search, setSearch, loadMore: loadMoreProducts } = useProductPickerData();
  const { clients, loading: clientsLoading, loadingMore: clientsLoadingMore, error: clientsError, hasMore: hasMoreClients, search: clientSearch, setSearch: setClientSearch, loadMore: loadMoreClients } = useClientPickerData();
  const { activePlan } = usePlan();
  const [selectedClient, setSelectedClient] = useState<string>("");
  const [cart, setCart] = useState<{product: Product, quantity: number}[]>([]);
  const [genderFilter, setGenderFilter] = useState("todos");
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [paymentType, setPaymentType] = useState<'cash' | 'installments'>('cash');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix');
  const [downPaymentMethod, setDownPaymentMethod] = useState<PaymentMethod>('pix');
  const [discountType, setDiscountType] = useState<'fixed' | 'percent'>('fixed');
  const [discountValue, setDiscountValue] = useState(0);
  const [installments, setInstallments] = useState(1);
  const [downPayment, setDownPayment] = useState(0);
  const [success, setSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  // §5: falha ao vincular a cobrança de uma venda já confirmada — nunca desfaz a venda, mas precisa
  // continuar visível na tela de sucesso (não só um toast) e oferecer um retry idempotente.
  const [chargeFailure, setChargeFailure] = useState<ChargeFailureState | null>(null);
  // RELEASE-QUALITY-04 §3: venda à vista feita offline vira "salva localmente", nunca um erro.
  const [savedOffline, setSavedOffline] = useState(false);
  const isOnline = useOnlineStatus();
  const [chargeRetrying, setChargeRetrying] = useState(false);
  const [showClientPicker, setShowClientPicker] = useState(false);
  const [showNewClientModal, setShowNewClientModal] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [newClientError, setNewClientError] = useState("");
  const [isCreatingClient, setIsCreatingClient] = useState(false);

  // §3: botão físico "voltar" do Android fecha o overlay aberto em vez de sair da tela/do app. A pilha é
  // LIFO — como o modal de novo cliente só abre POR CIMA da sheet de clientes, ele fica no topo e é
  // fechado primeiro, exatamente como o toque no X de cada um já fecha só o seu próprio overlay.
  // `showClientPicker` NÃO é registrado aqui — `ClientPickerSheet` já se registra sozinho (P1-01), então
  // registrar de novo aqui duplicaria a entrada na pilha para o MESMO overlay.
  useDismissibleOnBack(showNewClientModal, () => setShowNewClientModal(false));
  useDismissibleOnBack(isSummaryOpen, () => setIsSummaryOpen(false));
  const [justCreatedClient, setJustCreatedClient] = useState<Client | null>(null);

  const normalizedProductSearch = search.trim().toLowerCase();
  const availableProducts = useMemo(() => products.filter((product) => product.stock > 0), [products]);
  // Só faz sentido oferecer o filtro de público quando os produtos carregados têm mais de um valor.
  const genderOptionsPresent = useMemo(() => new Set(availableProducts.map((product) => resolveProductGender(product))), [availableProducts]);
  const showGenderFilter = genderOptionsPresent.size > 1;
  const effectiveGenderFilter = genderFilter === "todos" || genderOptionsPresent.has(genderFilter) ? genderFilter : "todos";
  const filteredProducts = useMemo(() => availableProducts.filter((product) =>
    product.name.toLowerCase().includes(normalizedProductSearch)
    && (effectiveGenderFilter === "todos" || resolveProductGender(product) === effectiveGenderFilter)
  ), [availableProducts, normalizedProductSearch, effectiveGenderFilter]);

  const normalizedClientSearch = clientSearch.trim().toLowerCase();
  const filteredClients = useMemo(() => clients.filter((client) =>
    client.name.toLowerCase().includes(normalizedClientSearch) || client.phone?.includes(normalizedClientSearch)
  ), [clients, normalizedClientSearch]);

  // Garante que o cliente recém-criado apareça no seletor mesmo antes do listener em tempo real atualizar a lista.
  const clientOptions = useMemo(() => {
    if (!justCreatedClient || filteredClients.some((client) => client.id === justCreatedClient.id)) return filteredClients;
    return [justCreatedClient, ...filteredClients];
  }, [filteredClients, justCreatedClient]);

  const handleCreateClient = async () => {
    const name = newClientName.trim();
    const phone = newClientPhone.trim();
    if (!name) {
      setNewClientError("Informe o nome do cliente.");
      return;
    }
    const uid = getFirebaseAuth()?.currentUser?.uid;
    if (!uid) {
      setNewClientError("Sua sessão expirou. Entre novamente para cadastrar o cliente.");
      return;
    }
    setIsCreatingClient(true);
    setNewClientError("");
    try {
      // PLAN-IMPL-02A §5 — this "quick add" flow used to write directly to Firestore with no plan-limit
      // check at all, a completely separate path from clients.tsx's own (correctly guarded) creation
      // flow. A fresh server count, matching add-product.tsx's pattern, rather than clients.length from
      // useClientPickerData() — that hook may be paginated/partial, and undercounting here would let a
      // tenant slip past their real limit.
      const clientCountSnapshot = await getCountFromServer(collection(getFirestore(), "users", uid, "clients"));
      if (!checkClientLimit(activePlan, clientCountSnapshot.data().count).allowed) {
        setNewClientError(`Limite de ${PLAN_CONFIG[activePlan].limits.clients} clientes atingido no plano ${PLAN_CONFIG[activePlan].name}.`);
        return;
      }
      const clientId = Math.random().toString(36).slice(2, 11);
      const clientData: Client = { id: clientId, name, phone };
      await setDoc(doc(getFirestore(), "users", uid, "clients", clientId), clientData);
      setJustCreatedClient(clientData);
      setSelectedClient(clientId);
      setShowNewClientModal(false);
      setNewClientName("");
      setNewClientPhone("");
      notifySuccess("Cliente cadastrado.");
      logTelemetryEvent("client_created_from_sale" as any, { clientId }, uid).catch(() => {});
    } catch (error) {
      console.error("[sell/new-client] Failed to create client", error);
      setNewClientError("Não foi possível cadastrar o cliente. Tente novamente.");
    } finally {
      setIsCreatingClient(false);
    }
  };

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) return prev;
        return prev.map(item => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => {
      const existing = prev.find(item => item.product.id === productId);
      if (existing && existing.quantity > 1) {
        return prev.map(item => item.product.id === productId ? { ...item, quantity: item.quantity - 1 } : item);
      }
      return prev.filter(item => item.product.id !== productId);
    });
  };

  const cartQuantities = useMemo(() => new Map(cart.map(item => [item.product.id, item.quantity])), [cart]);
  const productById = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const cartLines = useMemo(() => cart.map(item => {
    const pricing = resolveEffectiveProductPrice(item.product);
    return { ...item, unitPrice: pricing.effectivePrice, hasActivePromotion: pricing.hasActivePromotion, regularPrice: pricing.regularPrice };
  }), [cart]);
  const subtotal = useMemo(() => cartLines.reduce((acc, item) => acc + (item.unitPrice * item.quantity), 0), [cartLines]);
  const discountAmount = useMemo(() => Math.min(subtotal, discountType === 'percent' ? subtotal * Math.min(100, discountValue) / 100 : discountValue), [discountType, discountValue, subtotal]);
  const total = useMemo(() => Math.max(0, subtotal - discountAmount), [discountAmount, subtotal]);
  const remainingBalance = useMemo(() => Math.max(0, total - downPayment), [downPayment, total]);

  // Adicionar produto só engorda o carrinho interno da venda — o usuário continua na tela de
  // seleção e decide quando revisar, tocando em "Carrinho de vendas". O Resumo da Venda nunca
  // abre sozinho ao adicionar o primeiro item (era esse o comportamento indesejado anterior).
  useEffect(() => {
    if (!isSummaryOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsSummaryOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSummaryOpen]);

  const handleCheckout = async () => {
    if (isSaving) return;
    if (cart.length === 0) {
      setSaveError("Adicione produtos ao carrinho");
      return;
    }

    if (!selectedClient) {
      setSaveError("Selecione um cliente para prosseguir");
      return;
    }

    // Validação para venda a prazo
    if (paymentType === 'installments') {
      if (downPayment < 0) {
        setSaveError("Entrada não pode ser negativa");
        return;
      }
      if (downPayment > total) {
        setSaveError("Entrada não pode ser maior que o total");
        return;
      }
      if (installments < 1 || installments > 12) {
        setSaveError("Parcelas deve estar entre 1 e 12");
        return;
      }
      if (remainingBalance > 0 && installments === 0) {
        setSaveError("Defina o número de parcelas");
        return;
      }
    }

    const auth = getFirebaseAuth();
    const currentUser = auth?.currentUser;

    // Checagem explícita antes de qualquer fetch: sem currentUser não há como montar um Authorization
    // válido, e não podemos correr o risco de enviar "Bearer undefined" para o servidor.
    if (!currentUser) {
      setSaveError("Sua sessão expirou. Entre novamente para finalizar a venda.");
      return;
    }

    const uid = currentUser.uid;

    setIsSaving(true);
    setSaveError("");
    setSavedOffline(false);

    const saleId = Math.random().toString(36).substring(2, 11);

    // RELEASE-QUALITY-04 §3/§10: venda a prazo depende de uma cobrança online (Mercado Pago) logo em
    // seguida — nunca inventa parcelamento offline, mensagem clara em vez de deixar o fetch falhar feio.
    if (!isOnline && paymentType === "installments") {
      setIsSaving(false);
      setSaveError("Venda a prazo exige conexão com a internet. Conecte-se e tente novamente, ou registre como à vista.");
      return;
    }

    // §3: sem rede e é uma venda à vista — vira "salva localmente" (fila offline), nunca um erro.
    // Nenhuma baixa de estoque acontece aqui — só quando o servidor processar de verdade, exatamente
    // como no fluxo online (ver `offline-sales-queue.ts`).
    if (!isOnline && paymentType === "cash") {
      try {
        // A Promise do Firestore só resolve quando o ack do servidor chega — offline, isso nunca
        // acontece até reconectar. A escrita já fica durável no cache local (e visível a qualquer
        // onSnapshot) assim que a chamada é disparada, então aguardá-la aqui prenderia o vendedor na
        // tela de carregando até a conexão voltar — o oposto de "aparece imediatamente".
        queuePendingSale(uid, {
          saleId,
          clientId: selectedClient,
          products: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity })),
          discountType,
          discountValue,
          paymentType: "avista",
          paymentMethod,
        }).catch((err) => {
          logError("offline_sale_queue_write_failed", err instanceof Error ? err.message : String(err), {
            context: { saleId, clientId: selectedClient },
          });
        });
        setSavedOffline(true);
        setSuccess(true);
        notifySuccess("Venda salva. Será enviada quando a conexão voltar.");
        setTimeout(() => setLocation("/"), 2000);
      } catch {
        setSaveError("Não foi possível salvar a venda offline. Tente novamente.");
      } finally {
        setIsSaving(false);
      }
      return;
    }

    try {
      // Operação crítica de finalização de venda: força renovação do token aqui (não em todo o app) —
      // um token em cache pode ter expirado se a aba ficou em segundo plano (comum em navegadores mobile).
      const token = await currentUser.getIdToken(true);
      if (!token) throw new Error("Sua sessão expirou. Entre novamente para finalizar a venda.");

      const saleResponse = await measureOperation("sale_registration", () => fetch(getApiUrl("/api/sales/finalize"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          saleId,
          clientId: selectedClient,
          products: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity })),
          discountType,
          discountValue,
          paymentType: paymentType === "cash" ? "avista" : "prazo",
          paymentMethod: paymentType === "cash" ? paymentMethod : null,
          downPayment: paymentType === "installments" ? downPayment : 0,
          downPaymentMethod: paymentType === "installments" && downPayment > 0 ? downPaymentMethod : null,
          installments: paymentType === "installments" ? installments : 0,
        }),
      }));

      const saleResult = await saleResponse.json().catch(() => ({}));
      if (!saleResponse.ok) {
        // requireAuth/requireOwnership no servidor respondem com { error }, não { message } — sem este
        // fallback, uma sessão expirada (401/403) caía sempre na mensagem genérica, escondendo a causa real.
        if (saleResponse.status === 401 || saleResponse.status === 403) {
          throw new Error("Sua sessão expirou. Saia e entre novamente para finalizar a venda.");
        }
        throw new Error(saleResult.message || saleResult.error || "Não foi possível finalizar a venda");
      }

      logTelemetryEvent("sale_registered", {
        saleId: saleResult.saleId,
        clientId: selectedClient,
        amount: saleResult.total,
        itemCount: cart.length,
        paymentType,
      }, uid);

      trackAnalyticsEvent("purchase", {
        transaction_id: saleResult.saleId,
        value: saleResult.total,
        currency: "BRL",
        items: cart.map(item => ({
          item_id: item.product.id,
          item_name: item.product.name,
          quantity: item.quantity,
        })),
      });

      for (const productId of saleResult.depletedProductIds ?? []) {
        const product = productById.get(productId);
        if (product) {
          logTelemetryEvent("product_last_unit_sold", {
            productId,
            productName: product.name,
          }, uid);
        }
      }

      // Generate charges if installments
      let chargeFailed = false;
      if (paymentType === 'installments' && saleResult.remainingBalance > 0) {
        const chargePayload: SaleChargePayload = {
          uid,
          clientId: selectedClient,
          saleId: saleResult.saleId,
          title: `Parcelamento - Venda ${saleResult.saleId}`,
          description: `${installments}x de R$ ${(saleResult.remainingBalance / installments).toFixed(2)}`,
          amount: saleResult.remainingBalance,
          metadata: {
            installmentCount: installments,
            downPayment,
            downPaymentMethod: downPayment > 0 ? downPaymentMethod : null,
            subtotal,
            discountType,
            discountValue,
            discountAmount,
            saleId: saleResult.saleId,
          },
        };
        const chargeResult = await createSaleCharge(token, chargePayload);
        if (!chargeResult.ok) {
          // §5: a venda já está confirmada — nunca desfeita por causa disso — mas a falha da cobrança
          // precisa continuar visível (não só um toast que some) e oferecer um retry idempotente
          // (o servidor reaproveita a cobrança existente pelo saleId em vez de duplicar).
          chargeFailed = true;
          setChargeFailure({ message: chargeResult.message, payload: chargePayload });
          notifyWarning("Venda registrada sem cobrança.", "Crie o link manualmente em Cobranças.");
          logError("sale_charge_creation_failed", chargeResult.message, {
            context: {
              saleId: saleResult.saleId,
              clientId: selectedClient,
              amount: saleResult.remainingBalance,
              status: chargeResult.status,
            },
          });
        }
      }

      setSuccess(true);
      notifySuccess("Venda registrada.");
      // Só afasta o usuário automaticamente quando não há nada pendente para ele ver/agir — uma falha
      // de cobrança precisa ficar na tela até o usuário tentar de novo ou decidir sair por conta própria.
      if (!chargeFailed) setTimeout(() => setLocation("/"), 2000);
    } catch (err) {
      // §3: a conexão caiu NO MEIO da tentativa (não estava offline antes de começar, senão teria
      // caído no branch acima) — para venda à vista, ainda dá pra recuperar guardando na fila em vez
      // de mostrar um erro técnico de rede.
      if (isNetworkFailure(err) && paymentType === "cash") {
        try {
          // Mesmo motivo do branch acima: não aguarda o ack do servidor, só a escrita local (síncrona).
          queuePendingSale(uid, {
            saleId,
            clientId: selectedClient,
            products: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity })),
            discountType,
            discountValue,
            paymentType: "avista",
            paymentMethod,
          }).catch((queueErr) => {
            logError("offline_sale_queue_write_failed", queueErr instanceof Error ? queueErr.message : String(queueErr), {
              context: { saleId, clientId: selectedClient },
            });
          });
          setSavedOffline(true);
          setSuccess(true);
          notifySuccess("Sem conexão — venda salva. Será enviada quando a conexão voltar.");
          setTimeout(() => setLocation("/"), 2000);
          return;
        } catch {
          // não conseguiu nem guardar localmente — cai para o tratamento de erro normal abaixo.
        }
      }

      const errorMsg = err instanceof Error && err.message ? err.message : "Erro desconhecido";
      // Mostra a causa real (já sanitizada pelo servidor ou pelas validações locais) em vez de esconder atrás de um texto genérico.
      const friendlyMessage = errorMsg === "Erro desconhecido" ? "Erro ao registrar venda. Tente novamente." : errorMsg;
      setSaveError(friendlyMessage);
      notifyError(friendlyMessage);
      console.error("[sell] Checkout error:", err);

      // Log to Crashlytics
      logError("sale_checkout_error", errorMsg, {
        error: err instanceof Error ? err : undefined,
        context: {
          clientId: selectedClient,
          cartItems: cart.length,
          paymentType,
          totalAmount: total
        },
        userId: uid,
        severity: "error",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // §5: retry idempotente — reenvia o MESMO payload (mesmo saleId), então o servidor reaproveita a
  // cobrança já criada em vez de duplicar, mesmo que o usuário toque em "Tentar novamente" mais de uma vez.
  const handleRetryCharge = async () => {
    if (!chargeFailure || chargeRetrying) return;
    const auth = getFirebaseAuth();
    const currentUser = auth?.currentUser;
    if (!currentUser) {
      setChargeFailure((current) => current && { ...current, message: "Sua sessão expirou. Entre novamente para tentar de novo." });
      return;
    }
    setChargeRetrying(true);
    try {
      const token = await currentUser.getIdToken(true);
      const result = await createSaleCharge(token, chargeFailure.payload);
      if (result.ok) {
        setChargeFailure(null);
        notifySuccess("Cobrança criada.");
      } else {
        setChargeFailure({ message: result.message, payload: chargeFailure.payload });
        notifyError("Ainda não foi possível criar a cobrança.");
      }
    } catch (err) {
      setChargeFailure({ message: err instanceof Error ? err.message : "Erro desconhecido", payload: chargeFailure.payload });
    } finally {
      setChargeRetrying(false);
    }
  };

  if (productsLoading || clientsLoading) {
    return <Layout title="Registrar Venda"><PageSkeleton variant="cards" count={4} /></Layout>;
  }

  if (success) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-full p-6 text-center animate-in fade-in zoom-in duration-300">
          <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mb-6">
            <CheckCircle2 className="w-12 h-12 text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-2">{savedOffline ? "Venda salva!" : "Venda Registrada!"}</h2>
          <p className="text-muted-foreground mb-4" data-testid={savedOffline ? "text-sale-saved-offline" : undefined}>
            {savedOffline ? "Sem conexão — será enviada automaticamente quando a internet voltar." : "Venda registrada com sucesso."}
          </p>

          {chargeFailure && (
            <div className="w-full max-w-sm rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left" role="alert" data-testid="text-sale-charge-failure">
              <p className="text-xs font-bold text-amber-800">Venda registrada, mas a cobrança não foi criada.</p>
              <p className="mt-1 text-[11px] text-amber-700">{chargeFailure.message}</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleRetryCharge()}
                  disabled={chargeRetrying}
                  className="min-h-11 flex-1 rounded-xl bg-amber-600 text-xs font-black text-white disabled:opacity-60"
                  data-testid="button-sale-charge-retry"
                >
                  {chargeRetrying ? "Tentando..." : "Tentar novamente"}
                </button>
                <button
                  type="button"
                  onClick={() => setLocation("/billings")}
                  className="min-h-11 flex-1 rounded-xl border border-amber-300 bg-white text-xs font-black text-amber-800"
                  data-testid="button-sale-charge-goto-billings"
                >
                  Ir para Cobranças
                </button>
              </div>
              <button
                type="button"
                onClick={() => setLocation("/")}
                className="mt-2 w-full text-center text-[11px] font-bold text-muted-foreground underline"
                data-testid="button-sale-charge-dismiss"
              >
                Continuar sem tentar agora
              </button>
            </div>
          )}
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Registrar Venda">
      <div className="flex flex-col h-full">
        <div className="p-6 bg-white border-b border-border/50 space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">Cliente (Obrigatório)</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowClientPicker(true)}
                className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-2xl bg-secondary/50 p-4 text-left text-sm outline-none focus:ring-2 focus:ring-primary/20"
                data-testid="button-open-client-picker"
              >
                <span className={`truncate ${selectedClient ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                  {clientOptions.find(c => c.id === selectedClient)?.name || "Selecione o cliente..."}
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
              <button
                type="button"
                data-testid="button-new-client"
                onClick={() => { setNewClientError(""); setShowNewClientModal(true); }}
                className="rs-pressable flex shrink-0 items-center gap-1.5 rounded-2xl bg-primary/10 px-4 text-xs font-semibold text-primary"
              >
                <UserPlus className="h-4 w-4" /> Novo
              </button>
            </div>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Pesquisar produto..."
              className="w-full bg-secondary/50 border-none rounded-full py-3 pl-11 pr-4 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {showGenderFilter && (
            <div className="flex gap-1.5 overflow-x-auto hide-scrollbar">
              {GENDER_FILTER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setGenderFilter(option.value)}
                  aria-pressed={effectiveGenderFilter === option.value}
                  className={`min-h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-[11px] font-bold transition-colors ${
                    effectiveGenderFilter === option.value ? "border-primary bg-primary/10 text-primary" : "border-border/60 bg-white text-muted-foreground"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6 pb-48 hide-scrollbar">
          {(productsError || clientsError) && (
            <p className="mb-3 rounded-xl bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">Ocorreu um erro temporário ao carregar dados.</p>
          )}
          <div className="grid grid-cols-2 gap-4">
            {filteredProducts.map(product => {
              const qty = cartQuantities.get(product.id) || 0;
              const pricing = resolveEffectiveProductPrice(product);
              return (
                <div key={product.id} className={`rs-card-interactive bg-white rounded-3xl p-3 border ${qty > 0 ? 'border-primary ring-4 ring-primary/5' : 'border-border/40'}`}>
                  <div className="aspect-square bg-secondary/30 rounded-2xl mb-2 flex items-center justify-center overflow-hidden relative">
                    <ProductImageCard product={product} size="full" objectFit="contain" className="!rounded-none !border-0" />
                    <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-md text-white text-[10px] font-semibold px-2 py-1 rounded-lg">
                      {product.stock} un
                    </div>
                  </div>
                  <h3 className="text-[11px] font-bold truncate">{product.name}</h3>
                  <div className="flex items-center justify-between mt-2">
                    <div>
                      {pricing.hasActivePromotion && <span className="block text-[9px] font-medium text-muted-foreground line-through">R$ {pricing.regularPrice.toFixed(2)}</span>}
                      <span className="text-xs font-semibold">R$ {pricing.effectivePrice.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {qty > 0 && <button onClick={() => removeFromCart(product.id)} className="rs-icon-press w-7 h-7 rounded-full bg-secondary flex items-center justify-center"><Minus className="w-3.5 h-3.5"/></button>}
                      {qty > 0 && <span className="text-xs font-semibold w-4 text-center">{qty}</span>}
                      <button onClick={() => addToCart(product)} className="rs-icon-press w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center shadow-sm"><Plus className="w-3.5 h-3.5"/></button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {hasMoreProducts && (
            <button type="button" onClick={() => void loadMoreProducts()} disabled={productsLoadingMore} className="mt-4 w-full rounded-2xl bg-white border border-border/50 px-4 py-3 text-xs font-semibold text-muted-foreground shadow-sm disabled:opacity-60">
              {productsLoadingMore ? "Carregando..." : "Carregar mais"}
            </button>
          )}
          {search && hasMoreProducts && (
            <p className="mt-2 text-center text-[11px] text-muted-foreground">Carregue mais produtos para ampliar a busca.</p>
          )}
        </div>

        {cart.length > 0 && !isSummaryOpen && (
          <button
            type="button"
            data-testid="button-open-sale-cart"
            onClick={() => setIsSummaryOpen(true)}
            aria-label="Abrir carrinho de vendas"
            className="rs-pressable fixed bottom-[calc(6rem+env(safe-area-inset-bottom)+0.75rem)] left-4 right-4 z-40 mx-auto flex max-w-md items-center justify-between rounded-2xl bg-slate-950 px-5 py-4 text-white shadow-2xl shadow-slate-950/25 transition-transform active:scale-[0.99]"
          >
            <span className="text-xs font-bold">{cart.length} {cart.length === 1 ? 'item' : 'itens'} · R$ {total.toFixed(2)}</span>
            <span className="text-xs font-black">Carrinho de vendas</span>
          </button>
        )}

        {cart.length > 0 && isSummaryOpen && (
          <div
            className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,calc(env(safe-area-inset-bottom)+1rem))] backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sell-summary-title"
            onClick={() => setIsSummaryOpen(false)}
          >
            <div
              className="rs-sheet-enter flex max-h-[calc(100dvh-8rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border/20 bg-white shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
            <div className="min-h-0 flex-1 overflow-y-auto p-5 pb-3">
              <div className="mb-3 flex items-center justify-between">
                <p id="sell-summary-title" className="text-xs text-muted-foreground font-semibold">Resumo da Venda</p>
                <button type="button" onClick={() => setIsSummaryOpen(false)} className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-secondary" aria-label="Fechar resumo"><X className="h-4 w-4" /></button>
              </div>
              {selectedClient && (
                <p className="mb-3 text-xs font-semibold text-foreground">Cliente: <span className="font-bold">{clientOptions.find(c => c.id === selectedClient)?.name || "-"}</span></p>
              )}
              <div className="mb-4 space-y-2">
                {cartLines.map(item => (
                  <div key={item.product.id} className="flex items-center gap-2">
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-secondary/30">
                      <ProductImageCard product={item.product} size="sm" objectFit="contain" className="!rounded-none !border-0" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-semibold">{item.product.name}</p>
                      <p className="text-[10px] text-muted-foreground">{item.quantity} × R$ {item.unitPrice.toFixed(2)}</p>
                    </div>
                    <span className="shrink-0 text-xs font-bold">R$ {(item.unitPrice * item.quantity).toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div className="mb-4 rounded-xl bg-secondary/20 p-3 space-y-3">
                <div className="flex items-center justify-between"><span className="text-[10px] font-bold text-muted-foreground">Subtotal</span><span className="text-sm font-bold">R$ {subtotal.toFixed(2)}</span></div>
                <div className="grid grid-cols-[auto_1fr] gap-2">
                  <div className="flex bg-white rounded-lg p-1 border border-border/40">
                    <button type="button" onClick={() => setDiscountType('fixed')} className={`px-3 py-2 rounded-md text-[10px] font-semibold ${discountType === 'fixed' ? 'bg-primary text-white' : 'text-muted-foreground'}`}>R$</button>
                    <button type="button" onClick={() => setDiscountType('percent')} className={`px-3 py-2 rounded-md text-[10px] font-semibold ${discountType === 'percent' ? 'bg-primary text-white' : 'text-muted-foreground'}`}>%</button>
                  </div>
                  <input type="number" inputMode="decimal" enterKeyHint="done" min="0" max={discountType === 'percent' ? 100 : subtotal} step="0.01" value={discountValue} onChange={e => setDiscountValue(Math.max(0, Number(e.target.value)))} placeholder="Desconto" className="min-w-0 bg-white border border-border/40 rounded-lg px-3 text-sm font-bold outline-none focus:ring-1 focus:ring-primary" />
                </div>
                {discountAmount > 0 && <div className="flex items-center justify-between text-green-700"><span className="text-[10px] font-bold">Desconto aplicado</span><span className="text-sm font-semibold">- R$ {discountAmount.toFixed(2)}</span></div>}
                <div className="flex items-center justify-between border-t border-border/30 pt-2"><span className="text-xs font-semibold text-muted-foreground">Total</span><span className="text-2xl font-semibold">R$ {total.toFixed(2)}</span></div>
              </div>
              {/* Payment Type Toggle */}
              <div className="flex gap-3 mb-4">
                <button
                  data-testid="button-payment-cash"
                  onClick={() => setPaymentType('cash')}
                  className={`flex-1 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    paymentType === 'cash'
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-secondary/40 text-muted-foreground'
                  }`}
                >
                  À Vista
                </button>
                <button
                  data-testid="button-payment-installments"
                  onClick={() => setPaymentType('installments')}
                  className={`flex-1 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    paymentType === 'installments'
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-secondary/40 text-muted-foreground'
                  }`}
                >
                  A Prazo
                </button>
              </div>

              {/* Payment Details - Compact */}
              {paymentType === 'cash' ? (
                <div className="mb-4 pb-4 border-b border-border/20 space-y-2">
                  <p className="text-xs text-muted-foreground font-semibold">Forma de pagamento</p>
                  <div className="grid grid-cols-4 gap-2">
                    {PAYMENT_METHOD_OPTIONS.map(({ value, label, icon: Icon }) => (
                      <button
                        type="button"
                        key={value}
                        data-testid={`button-payment-method-${value}`}
                        onClick={() => setPaymentMethod(value)}
                        aria-pressed={paymentMethod === value}
                        className={`flex flex-col items-center gap-1 rounded-xl border py-2.5 px-1 transition-all ${paymentMethod === value ? 'bg-primary text-white border-primary shadow-sm' : 'bg-white text-muted-foreground border-border/50'}`}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="text-[9px] font-bold">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mb-4 pb-4 border-b border-border/20 space-y-2">
                  {/* Entrada */}
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Entrada (Opcional)</label>
                    <input
                      data-testid="input-installment-down-payment"
                      type="number" inputMode="decimal" enterKeyHint="next"
                      className="w-full bg-secondary/30 border-none rounded-lg p-2 text-sm font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      value={downPayment}
                      onChange={e => setDownPayment(Math.max(0, Number(e.target.value)))}
                      min={0}
                      max={total}
                      placeholder="0"
                    />
                  </div>

                  {downPayment > 0 && <div>
                    <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Forma da entrada</label>
                    <div className="grid grid-cols-4 gap-2">
                      {PAYMENT_METHOD_OPTIONS.map(({ value, label, icon: Icon }) => (
                        <button
                          type="button"
                          key={value}
                          data-testid={`button-down-payment-method-${value}`}
                          onClick={() => setDownPaymentMethod(value)}
                          aria-pressed={downPaymentMethod === value}
                          className={`flex flex-col items-center gap-1 rounded-lg border py-2 px-1 transition-all ${downPaymentMethod === value ? 'bg-primary text-white border-primary shadow-sm' : 'bg-white text-muted-foreground border-border/50'}`}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          <span className="text-[8px] font-bold">{label}</span>
                        </button>
                      ))}
                    </div>
                  </div>}
                  {/* Parcelas + Valor grid */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Parcelas</label>
                      <input
                        data-testid="input-installment-count"
                        type="number" inputMode="decimal" enterKeyHint="next"
                        className="w-full bg-secondary/30 border-none rounded-lg p-2 text-sm font-bold text-foreground text-center focus:outline-none focus:ring-1 focus:ring-primary"
                        value={installments}
                        onChange={e => setInstallments(Math.max(1, Math.min(12, Number(e.target.value))))}
                        min={1}
                        max={12}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Valor/Parc</label>
                      <div className="bg-primary/5 border border-primary/10 rounded-lg p-2 text-xs font-bold text-primary text-center">
                        {remainingBalance > 0 && installments > 0
                          ? `R$ ${(remainingBalance / installments).toFixed(2)}`
                          : '-'
                        }
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Total + CTA - Pinned footer, always visible without scrolling */}
            <div className="shrink-0 border-t border-border/20 bg-white px-5 pt-3 pb-5 space-y-2">
              <div className="flex items-center justify-between"><span className="text-xs font-semibold text-muted-foreground">Total</span><span className="text-xl font-semibold">R$ {total.toFixed(2)}</span></div>

              {!selectedClient && (
                <button
                  type="button"
                  data-testid="button-select-client-warning"
                  onClick={() => setShowClientPicker(true)}
                  className="text-[10px] text-muted-foreground font-medium underline decoration-dotted underline-offset-2"
                >
                  ⚠ Selecione um cliente
                </button>
              )}
              {paymentType === 'installments' && installments < 1 && (
                <p className="text-[10px] text-muted-foreground font-medium">⚠ Defina parcelas</p>
              )}
              {saveError && (
                <p className="text-[10px] text-destructive font-medium">{saveError}</p>
              )}

              <button
                data-testid="button-finalize-sale"
                onClick={handleCheckout}
                disabled={!selectedClient || cart.length === 0 || isSaving || (paymentType === 'installments' && installments < 1)}
                className="rs-pressable w-full bg-gradient-to-r from-primary to-primary/90 text-white font-semibold py-4 rounded-xl shadow-md hover:shadow-lg disabled:opacity-40 disabled:cursor-not-allowed text-sm border border-primary/20"
              >
                {isSaving ? (
                  <>
                    <span className="animate-spin inline-block mr-2">⏳</span>Finalizando...
                  </>
                ) : (
                  "✓ Finalizar Venda"
                )}
              </button>
            </div>
            </div>
          </div>
        )}
      </div>

      <ClientPickerSheet
        open={showClientPicker}
        onClose={() => setShowClientPicker(false)}
        clients={clientOptions}
        selectedClientId={selectedClient}
        onSelect={setSelectedClient}
        search={clientSearch}
        onSearchChange={setClientSearch}
        hasMore={hasMoreClients}
        loadingMore={clientsLoadingMore}
        onLoadMore={() => void loadMoreClients()}
        onCreateNew={() => { setShowClientPicker(false); setNewClientError(""); setShowNewClientModal(true); }}
      />

      {showNewClientModal && (
        <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/60 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,calc(env(safe-area-inset-bottom)+1rem))] backdrop-blur-sm">
          <div className="rs-sheet-enter w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Novo cliente</h3>
              <button type="button" onClick={() => setShowNewClientModal(false)} className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-secondary" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <input
                autoFocus
                type="text"
                placeholder="Nome completo"
                className="w-full bg-secondary/50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                value={newClientName}
                onChange={e => setNewClientName(e.target.value)}
                disabled={isCreatingClient}
              />
              <input
                type="tel"
                inputMode="tel"
                placeholder="Telefone (opcional)"
                className="w-full bg-secondary/50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                value={newClientPhone}
                onChange={e => setNewClientPhone(e.target.value.replace(/[^\d()+\- ]/g, ""))}
                disabled={isCreatingClient}
              />
              {newClientError && <p className="text-xs font-medium text-destructive">{newClientError}</p>}
            </div>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setShowNewClientModal(false)} disabled={isCreatingClient} className="min-h-12 flex-1 rounded-2xl bg-secondary text-xs font-semibold text-foreground disabled:opacity-60">Cancelar</button>
              <button type="button" data-testid="button-save-new-client" onClick={handleCreateClient} disabled={isCreatingClient} className="min-h-12 flex-1 rounded-2xl bg-primary text-xs font-semibold text-white disabled:opacity-60">{isCreatingClient ? "Salvando..." : "Salvar"}</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
