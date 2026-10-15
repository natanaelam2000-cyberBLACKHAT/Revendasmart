import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  Star,
  Zap,
  ShoppingBag,
  Users,
  CreditCard,
  Infinity as InfinityIcon,
  AlertTriangle,
  Calendar,
  Gift, 
  Sparkles,
  Loader2,
  XCircle,
  CheckCircle,
  ChevronLeft,
} from "lucide-react";
import { apiRequest, buildApiErrorDisplayMessage } from "@/lib/api-client";
import { usePlanData } from "@/hooks/usePlanData";
import { isPremiumFromGlobalAccess, resolveLegacyBillingProvider, PLANS, type GlobalConfig, type PlanData as MonetizationPlanData } from "@shared/monetization";
import { getFirebaseAuth, trackAnalyticsEvent } from "@/lib/firebase";
import {
  isAndroidNativeApp,
  recoverPendingGooglePlayPurchases,
  restoreAndroidPurchases,
  openAndroidSubscriptionManagement,
  type PlayBillingProductOffer,
} from "@/lib/play-billing";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type PageStatus = "idle" | "loading" | "redirecting" | "success" | "error" | "cancelling" | "cancelled";

type AndroidBillingStatus = "idle" | "loading" | "pending" | "restoring" | "error";

// ---------------------------------------------------------------------------
// Helper: format date for PT-BR
// ---------------------------------------------------------------------------
function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "Data não disponível";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "Data não disponível";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Premium Feature List
// ---------------------------------------------------------------------------
const PREMIUM_FEATURES = [
  {
    icon: <InfinityIcon className="w-4 h-4 text-amber-600" />,
    text: "Produtos ilimitados",
  },
  {
    icon: <Users className="w-4 h-4 text-amber-600" />,
    text: "Clientes ilimitados",
  },
  {
    icon: <CreditCard className="w-4 h-4 text-amber-600" />,
    text: "Cobranças via Mercado Pago",
  },
  {
    icon: <ShoppingBag className="w-4 h-4 text-amber-600" />,
    text: "Múltiplos nichos de negócio",
  },
  {
    icon: <Star className="w-4 h-4 text-amber-600" />,
    text: "Destaque de produtos",
  },
  {
    icon: <Zap className="w-4 h-4 text-amber-600" />,
    text: "Catálogo profissional",
  },
  {
    icon: <Gift className="w-4 h-4 text-amber-600" />,
    text: "Funções premium futuras",
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function Subscribe() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<PageStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // RELEASE-07B: Android nativo usa Google Play Billing; Web/PWA continua no Mercado Pago (abaixo).
  const [isAndroid, setIsAndroid] = useState(false);
  // New Play offers await the canonical product mapping; restore/management stay available.
  const androidOffers: PlayBillingProductOffer[] = [];
  const [androidStatus, setAndroidStatus] = useState<AndroidBillingStatus>("idle");
  const [androidErrorMsg, setAndroidErrorMsg] = useState("");

  const {
    planData,
    globalConfig: rawGlobalConfig,
    hasPremiumAccess,
    premiumPeriodEndsAt,
    isCancelledWithinPaidPeriod,
    loading: planLoading,
    refresh,
    error: planError,
    isTester,
    isPremiumPlus,
  } = usePlanData();
  const globalConfig = rawGlobalConfig as GlobalConfig | null;
  // RELEASE-16 §6/§7: quem concedeu a assinatura ATUAL decide para onde o cancelamento vai — nunca o
  // dispositivo atual sozinho, para não chamar Mercado Pago para uma conta assinada via Play ou
  // vice-versa. `resolveLegacyBillingProvider` só resolve "google_play" com evidência server-owned
  // (billingProvider explícito ou campos playXxx já persistidos) — uma assinatura legada sem nenhum
  // desses nunca abre o fluxo de gestão da Play só por estar rodando em Android.
  const resolvedBillingProvider = resolveLegacyBillingProvider(planData as MonetizationPlanData | null);
  const managesSubscriptionViaGooglePlay = isAndroid && resolvedBillingProvider === "google_play";
  // OWNER-ACCESS-02 §15 — só existe algo para "gerenciar/cancelar" quando há uma assinatura paga real
  // por trás. Tester/Premium+ têm hasPremiumAccess=true sem nunca gerar subscriptionId/billingProvider —
  // mesmo guard já usado pelo card "Status da Assinatura" (`planData?.subscriptionId`) logo abaixo.
  const hasPaidSubscription = Boolean(planData?.subscriptionId || resolvedBillingProvider);
  const isGlobalPremiumActive = isPremiumFromGlobalAccess(planData as MonetizationPlanData | null, globalConfig);
  const subscriptionUiState = useMemo(() => {
    const subscriptionStatus = (planData?.subscriptionStatus ?? "").toLowerCase();
    const paymentStatus = (planData?.paymentStatus ?? "").toLowerCase();
    // RELEASE-16 §3: nunca reintroduzir uma leitura paralela do booleano cru — `hasPremiumAccess` (via
    // `usePlanData`) já é a decisão canônica de `isPremiumActive()`.
    const premiumActive = hasPremiumAccess;
    const hasValidSubscription = hasPremiumAccess || ["authorized", "active", "approved"].includes(subscriptionStatus) || paymentStatus === "approved";
    const isPending = subscriptionStatus === "pending";
    const hasRecentPending = isPending && !!planData?.subscriptionId;
    const showBuyButton = !hasValidSubscription && !hasRecentPending && !isGlobalPremiumActive;
    return { premiumActive, hasValidSubscription, isPending, hasRecentPending, showBuyButton, subscriptionStatus };
  }, [planData, isGlobalPremiumActive, hasPremiumAccess]);
  const isActiveSubscriber = subscriptionUiState.hasValidSubscription;
  const isPendingPayment = subscriptionUiState.isPending;
  const isCancelledSubscriber = planData?.subscriptionStatus === "cancelled";
  const showBuyButton = subscriptionUiState.showBuyButton && !hasPremiumAccess;

  // Handle return from Mercado Pago checkout
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const returnStatus = params.get("status");

    if (returnStatus === "success") {
      // Clean URL
      window.history.replaceState({}, "", "/subscribe");
      (async () => {
      try {
  setStatus("loading");

  await refresh?.();

  setStatus("success");
} catch {
          setStatus("success");
          await refresh?.();
        }
      })();
    } else if (returnStatus === "error" || returnStatus === "failure") {
      setStatus("error");
      setErrorMsg("O pagamento não foi concluído. Tente novamente.");
      window.history.replaceState({}, "", "/subscribe");
    }
  }, []);

  // Detecta Android nativo, carrega os produtos com preço localizado da Play, e roda a recuperação de
  // compras pendentes (§9: app aberto/retomado após uma compra aprovada mas o /verify não rodou ainda).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const android = await isAndroidNativeApp();
      if (cancelled) return;
      setIsAndroid(android);
      if (!android) return;


      const auth = getFirebaseAuth();
      const user = auth?.currentUser;
      if (user) {
        const idToken = await user.getIdToken();
        await recoverPendingGooglePlayPurchases(idToken, user.uid);
        if (!cancelled) await refresh?.();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  function handleSubscribe() {
    setLocation("/plans");
  }

  async function handleCancel() {
    setStatus("cancelling");
    setErrorMsg("");
    try {
      await apiRequest("/api/app-subscription/cancel", {
        method: "POST",
        auth: true,
      });

      setStatus("cancelled");
      setShowCancelConfirm(false);
      // PLAN-IMPL-06 §33/§34 — só o resultado aceito pelo provider conta como "completed"; esta seção
      // inteira já é gated a hasPremiumAccess (linha ~720), então o plano cancelado é sempre Premium.
      trackAnalyticsEvent("cancellation_completed", { plan: PLANS.PREMIUM });
      refresh?.();
    } catch (err) {
      setErrorMsg(buildApiErrorDisplayMessage(err, "Erro inesperado."));
      setStatus("error");
    }
  }

  // ---------------------------------------------------------------------------
  // Actions — Android (Google Play Billing)
  // ---------------------------------------------------------------------------
  function handleSubscribeAndroid() {
    setLocation("/plans");
  }

  async function handleRestoreAndroid() {
    setAndroidStatus("restoring");
    setAndroidErrorMsg("");
    const auth = getFirebaseAuth();
    const user = auth?.currentUser;
    if (!user) {
      setAndroidStatus("error");
      setAndroidErrorMsg("Faça login novamente.");
      return;
    }
    try {
      const idToken = await user.getIdToken();
      await restoreAndroidPurchases(idToken, user.uid);
      await refresh?.();
      setAndroidStatus("idle");
    } catch (err) {
      setAndroidStatus("error");
      setAndroidErrorMsg(err instanceof Error ? err.message : "Erro ao restaurar compras.");
    }
  }

  async function handleManageAndroidSubscription() {
    try {
      await openAndroidSubscriptionManagement();
    } catch (err) {
      setAndroidStatus("error");
      setAndroidErrorMsg(err instanceof Error ? err.message : "Não foi possível abrir a gestão de assinatura da Play.");
    }
  }

  // ---------------------------------------------------------------------------
  // Render States
  // ---------------------------------------------------------------------------

  // P1-04: `planLoading` é uma espera de rede real (status do plano) antes do primeiro render — trocado
  // o spinner genérico pelo mesmo `PageSkeleton` usado nas outras telas de configurações/conta.
  if (planLoading) {
    return (
      <Layout title="Premium">
        <PageSkeleton variant="settings" />
      </Layout>
    );
  }

  // Success state (after payment)
  if (status === "success") {
    return (
      <Layout title="Premium Ativo">
        <div className="px-6 py-10 flex flex-col items-center justify-center min-h-[80vh] gap-6 text-center">
          <div className="w-24 h-24 bg-amber-100 rounded-full flex items-center justify-center shadow-lg">
            <Sparkles className="w-12 h-12 text-amber-500" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-black text-foreground">Bem-vinda ao Premium! ✨</h1>
            <p className="text-muted-foreground text-sm max-w-xs">
              Seu plano está sendo ativado. Em alguns instantes todos os recursos estarão disponíveis.
            </p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-3xl p-4 w-full space-y-2">
            {PREMIUM_FEATURES.map((f, i) => (
              <div key={i} className="flex items-center gap-3">
                {f.icon}
                <span className="text-sm text-foreground font-medium">{f.text}</span>
              </div>
            ))}
          </div>
          <button
            onClick={() => setLocation("/")}
            className="w-full bg-primary text-white font-bold py-4 rounded-2xl text-base active:scale-95 transition-all shadow-md"
            data-testid="button-go-dashboard"
          >
            Ir para o Dashboard
          </button>
        </div>
      </Layout>
    );
  }

  // Cancelled state
  if (status === "cancelled") {
    return (
      <Layout title="Assinatura Cancelada">
        <div className="px-6 py-10 flex flex-col items-center justify-center min-h-[80vh] gap-6 text-center">
          <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center">
            <XCircle className="w-12 h-12 text-gray-400" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-black text-foreground">Renovação cancelada</h1>
            {/* RELEASE-09: cancelar interrompe a renovação, não o período já pago. */}
            <p className="text-muted-foreground text-sm max-w-xs" data-testid="text-cancelled-until">
              {premiumPeriodEndsAt
                ? `Seu Premium permanece ativo até ${fmtDate(premiumPeriodEndsAt)}. Depois dessa data você volta ao plano Grátis.`
                : "Sua assinatura não será renovada. Você permanecerá no plano Grátis a partir de agora."}
            </p>
          </div>
          <button
            onClick={() => setLocation("/")}
            className="w-full bg-secondary text-foreground font-bold py-4 rounded-2xl text-base"
            data-testid="button-back-dashboard-cancelled"
          >
            Voltar ao Dashboard
          </button>
          <button
            onClick={() => setStatus("idle")}
            className="text-primary text-sm font-bold underline"
            data-testid="button-resubscribe"
          >
            Quero assinar novamente
          </button>
        </div>
      </Layout>
    );
  }

  // Redirecting state
  if (status === "redirecting") {
    return (
      <Layout title="Abrindo pagamento...">
        <div className="flex flex-col items-center justify-center min-h-[80vh] gap-6 px-6 text-center">
          <Loader2 className="w-14 h-14 text-primary animate-spin" />
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-foreground">Abrindo o Mercado Pago...</h2>
            <p className="text-sm text-muted-foreground">Você será redirecionada para concluir o pagamento.</p>
          </div>
        </div>
      </Layout>
    );
  }

  // ---------------------------------------------------------------------------
  // Main view — subscription management
  // ---------------------------------------------------------------------------
  return (
    <Layout title="Plano Premium">
      <div className="px-6 pt-6 pb-32 max-w-lg mx-auto">

        {/* Back */}
        <button
          onClick={() => setLocation("/")}
          className="flex items-center gap-2 text-muted-foreground mb-6 font-medium"
          data-testid="button-back-subscribe"
        >
          <ChevronLeft className="w-4 h-4" /> Voltar
        </button>

        {/* NOVO HEADER PREMIUM (mais forte pra conversão) */}
<div className="text-center space-y-3 mb-6">

  <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto shadow-md">
    <Sparkles className="w-10 h-10 text-amber-500" />
  </div>

  <h1 className="text-2xl font-black text-foreground">
    Desbloqueie o Premium 🚀
  </h1>

  <p className="text-sm text-muted-foreground max-w-xs mx-auto">
    Venda mais, organize melhor e cresça sem limites
  </p>

</div>

{/* BLOCO DE PREÇO + CTA MELHORADO (Web/PWA — Mercado Pago) */}
{!isAndroid && showBuyButton && !isGlobalPremiumActive && !hasPremiumAccess && (
  <div className="bg-green-50 border border-green-200 rounded-2xl p-5 text-center space-y-3 mb-6">

    <p className="text-lg font-black text-green-700">
      Consulte os planos e valores disponíveis
    </p>

    <button
      onClick={handleSubscribe}
      disabled={status === "loading"}
      className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-4 rounded-xl shadow-md transition-all active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2"
    >
      {status === "loading" ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          Iniciando...
        </>
      ) : (
        <>
          🚀 Assinar Agora
        </>
      )}
    </button>

    <p className="text-[11px] text-muted-foreground">
      Cancelamento a qualquer momento
    </p>

  </div>
)}

{/* BLOCO DE PREÇO + CTA (Android nativo — Google Play Billing) */}
{isAndroid && showBuyButton && !isGlobalPremiumActive && !hasPremiumAccess && (
  <div className="bg-green-50 border border-green-200 rounded-2xl p-5 text-center space-y-3 mb-6" data-testid="android-billing-card">
    <p className="text-lg font-black text-green-700">
      {androidOffers.length > 0
        ? androidOffers.map((offer) => offer.formattedPrice).join(" · ")
        : "Preço exibido pela Play Store ao assinar"}
    </p>

    <button
      onClick={() => handleSubscribeAndroid()}
      disabled={androidStatus === "loading"}
      className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-4 rounded-xl shadow-md transition-all active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2"
      data-testid="button-subscribe-google-play"
    >
      {androidStatus === "loading" ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          Iniciando...
        </>
      ) : (
        <>🚀 Assinar via Google Play</>
      )}
    </button>

    {androidStatus === "pending" && (
      <p className="text-xs font-bold text-blue-600 bg-blue-50 rounded-xl p-3" data-testid="android-billing-pending">
        Pagamento em processamento pela Google Play. Assim que for confirmado, o Premium é ativado automaticamente.
      </p>
    )}
    {androidStatus === "error" && androidErrorMsg && (
      <p className="text-xs font-bold text-red-600 bg-red-50 rounded-xl p-3" data-testid="android-billing-error">{androidErrorMsg}</p>
    )}

    <button
      onClick={handleRestoreAndroid}
      disabled={androidStatus === "restoring"}
      className="text-primary text-xs font-bold underline disabled:opacity-60"
      data-testid="button-restore-google-play"
    >
      {androidStatus === "restoring" ? "Restaurando..." : "Já assinei — restaurar compras"}
    </button>

    <p className="text-[11px] text-muted-foreground">
      Cancelamento a qualquer momento pela Google Play
    </p>
  </div>
)}
        <div className="bg-white border border-border/60 rounded-3xl p-5 mb-6 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Plano atual</p>
          <div className="flex items-center justify-between mt-2"><div><p className="text-lg font-black">{isPremiumPlus ? "Premium+" : isTester ? "Tester" : hasPremiumAccess ? "Premium" : "Grátis"}</p><p className={`text-xs font-bold ${hasPremiumAccess ? "text-green-600" : "text-muted-foreground"}`}>{isPremiumPlus ? "Premium+ concedido" : isTester ? "Acesso de testadora" : hasPremiumAccess ? "Premium ativo" : "Plano gratuito"}</p></div><CreditCard className="w-6 h-6 text-primary" /></div>
          {planError && <p className="text-xs text-amber-700 bg-amber-50 rounded-xl p-3 mt-3">Dados de cobrança temporariamente indisponíveis. Seu acesso continua funcionando.</p>}
        </div>

        {/* Current Status Card (if has subscription) */}
        {planData?.subscriptionId && (
          <div className={`rounded-3xl p-4 mb-6 border ${
            isActiveSubscriber
              ? "bg-amber-50 border-amber-200"
              : isPendingPayment
              ? "bg-blue-50 border-blue-200"
              : "bg-muted border-border"
          }`} data-testid="card-subscription-status">
            <p className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-2">
              Status da Assinatura
            </p>
            <div className="flex items-center gap-2 mb-3">
              {isActiveSubscriber && <CheckCircle className="w-5 h-5 text-green-500" />}
              {isPendingPayment && <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />}
              {isCancelledSubscriber && <XCircle className="w-5 h-5 text-gray-400" />}
              {/* RELEASE-09: "cancelada mas ainda paga" é um estado próprio — nunca rotular como
                  "Renovação automática" (a renovação já parou) nem como Free (o acesso continua). */}
              <span className={`font-bold text-sm ${
                isCancelledWithinPaidPeriod ? "text-amber-600" :
                isActiveSubscriber ? "text-green-600" :
                isPendingPayment ? "text-blue-600" :
                "text-gray-500"
              }`} data-testid="text-subscription-status">
                {isCancelledWithinPaidPeriod ? "Renovação cancelada — ativa até o fim do período" :
                 isActiveSubscriber ? "Ativa — Renovação automática" :
                 isPendingPayment ? "Aguardando pagamento" :
                 "Cancelada"}
              </span>
            </div>
            {isCancelledWithinPaidPeriod && premiumPeriodEndsAt && (
              <div className="flex items-center gap-2 text-xs text-amber-700">
                <Calendar className="w-3.5 h-3.5" />
                <span>Premium ativo até: {fmtDate(premiumPeriodEndsAt)}</span>
              </div>
            )}
            {planData.nextBillingAt && isActiveSubscriber && !isCancelledWithinPaidPeriod && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Calendar className="w-3.5 h-3.5" />
                <span>Próxima cobrança: {fmtDate(planData.nextBillingAt)}</span>
              </div>
            )}
            {planData.lastPaymentAt && isActiveSubscriber && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                <span>Último pagamento: {fmtDate(planData.lastPaymentAt)}</span>
              </div>
            )}
            {isCancelledSubscriber && planData.canceledAt && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <XCircle className="w-3.5 h-3.5" />
                <span>Cancelada em: {fmtDate(planData.canceledAt)}</span>
              </div>
            )}
          </div>
        )}

        {/* Price Card — Web/PWA (Mercado Pago). Nunca mostrado no Android: o preço lá vem da Play. */}
        {!isAndroid && !hasPremiumAccess && !isActiveSubscriber && !isGlobalPremiumActive && (
          <div className="bg-gradient-to-br from-amber-50 to-amber-100 border border-amber-200 rounded-3xl p-6 mb-6 text-center shadow-sm">
            <p className="text-xs font-black text-amber-700 uppercase tracking-widest mb-1">Valor mensal</p>
            <div className="flex items-baseline justify-center gap-1 mb-1">
              <span className="text-lg text-amber-700 font-bold">R$</span>
              <span className="text-5xl font-black text-amber-700">19</span>
              <span className="text-2xl font-black text-amber-700">,90</span>
            </div>
            <p className="text-xs text-amber-600 font-medium">por mês · renova automaticamente</p>
            <p className="text-xs text-amber-500 mt-1">cancele quando quiser</p>
          </div>
        )}

        {/* Global Premium Access Banner */}
        {isGlobalPremiumActive && (
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-300 rounded-3xl p-5 mb-6 flex items-start gap-3" data-testid="banner-global-premium">
            <Gift className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-black text-green-700">🎉 Premium temporariamente liberado!</p>
              <p className="text-xs text-green-600 mt-1">
                {globalConfig?.premiumOpenAccessMessage || "Todos os recursos premium estão disponíveis por tempo limitado. Aproveite!"}
              </p>
              {globalConfig?.premiumOpenAccessUntil && (
                <p className="text-xs text-green-500 mt-2 font-medium">
                  ⏰ Válido até {new Date(globalConfig.premiumOpenAccessUntil).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Feature list */}
        <div className="bg-white border border-gray-100 rounded-3xl p-5 mb-6 space-y-3 shadow-sm">
          <p className="text-xs font-black text-muted-foreground uppercase tracking-widest">
            {isActiveSubscriber ? "Seus benefícios ativos" : isGlobalPremiumActive ? "Seus benefícios (temporários)" : "O que você terá"}
          </p>
          {PREMIUM_FEATURES.map((f, i) => (
            <div key={i} className="flex items-center gap-3" data-testid={`feature-item-${i}`}>
              <div className="w-8 h-8 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                {f.icon}
              </div>
              <span className="text-sm text-foreground font-medium">{f.text}</span>
            </div>
          ))}
        </div>

       
        {/* Subscription Creation Error Message */}
        {status === "error" && errorMsg && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-4 flex items-start gap-3" data-testid="error-subscription">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-red-600">Erro</p>
              <p className="text-xs text-red-500">{errorMsg}</p>
            </div>
          </div>
        )}

        {/* CTA Button — Web/PWA (Mercado Pago) */}
        {!isAndroid && showBuyButton && !isGlobalPremiumActive && !hasPremiumAccess && (
          <button
            onClick={handleSubscribe}
            disabled={status === "loading"}
            className="w-full bg-amber-500 hover:bg-amber-600 text-white font-black py-4 rounded-2xl text-base active:scale-95 transition-all shadow-md disabled:opacity-60 flex items-center justify-center gap-2"
            data-testid="button-subscribe-premium"
          >
            {status === "loading" ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Preparando pagamento...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5" />
                Ver planos e preços
              </>
            )}
          </button>
        )}

        {/* CTA Button — Android nativo (Google Play Billing), preço vem da Play, nunca hardcoded */}
        {isAndroid && showBuyButton && !isGlobalPremiumActive && !hasPremiumAccess && (
          <button
            onClick={() => handleSubscribeAndroid()}
            disabled={androidStatus === "loading"}
            className="w-full bg-amber-500 hover:bg-amber-600 text-white font-black py-4 rounded-2xl text-base active:scale-95 transition-all shadow-md disabled:opacity-60 flex items-center justify-center gap-2"
            data-testid="button-subscribe-premium-android"
          >
            {androidStatus === "loading" ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Preparando compra...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5" />
                Assinar Premium{androidOffers[0] ? ` — ${androidOffers[0].formattedPrice}/mês` : ""}
              </>
            )}
          </button>
        )}

        {/* Message when global premium is active */}
        {hasPremiumAccess && (
          <div className="bg-green-50 border border-green-300 rounded-2xl p-4 text-center">
            <CheckCircle className="w-6 h-6 text-green-600 mx-auto mb-2" />
            <p className="text-sm font-bold text-green-700">Premium ativo</p>
            <p className="text-xs text-green-600 mt-1">Gerencie sua assinatura no dashboard.</p>
          </div>
        )}

        {/* Active subscriber — cancel option. Google Play nunca é cancelado pelo nosso endpoint MP:
            §13 provider isolation — quem gerencia é sempre a tela nativa da própria Play. */}
        {hasPremiumAccess && managesSubscriptionViaGooglePlay && (
          <div className="mt-4">
            <button
              onClick={handleManageAndroidSubscription}
              className="w-full text-muted-foreground text-sm font-medium py-3 border border-gray-200 rounded-2xl active:scale-95 transition-all"
              data-testid="button-manage-google-play-subscription"
            >
              Gerenciar assinatura na Google Play
            </button>
            {androidStatus === "error" && androidErrorMsg && (
              <p className="text-xs font-bold text-red-600 bg-red-50 rounded-xl p-3 mt-2" data-testid="android-manage-error">{androidErrorMsg}</p>
            )}
          </div>
        )}
        {/* RELEASE-09: já cancelada e ainda dentro do período pago — não há mais o que cancelar,
            então o botão dá lugar ao estado "renovação cancelada, ativo até DD/MM". */}
        {hasPremiumAccess && !managesSubscriptionViaGooglePlay && isCancelledWithinPaidPeriod && (
          <div className="mt-4 bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center" data-testid="card-cancelled-until">
            <p className="text-sm font-bold text-amber-700">Renovação cancelada</p>
            <p className="text-xs text-amber-600 mt-1">
              Seu Premium permanece ativo até {fmtDate(premiumPeriodEndsAt)}.
            </p>
          </div>
        )}

        {(hasPremiumAccess || isActiveSubscriber) && hasPaidSubscription && !managesSubscriptionViaGooglePlay && !isCancelledWithinPaidPeriod && !isCancelledSubscriber && (
          <div className="mt-4">
            {!showCancelConfirm ? (
              <button
                onClick={() => {
                  // PLAN-IMPL-06 §33/§34 — intenção declarada de cancelar (abre o painel de confirmação),
                  // não o cancelamento em si; "Manter Premium" não dispara nada (não é abandono de intenção
                  // relevante para o funil, só fechar o painel).
                  trackAnalyticsEvent("cancellation_started", { plan: PLANS.PREMIUM });
                  setShowCancelConfirm(true);
                }}
                className="w-full text-muted-foreground text-sm font-medium py-3 border border-gray-200 rounded-2xl active:scale-95 transition-all"
                data-testid="button-show-cancel"
              >
                Cancelar assinatura
              </button>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-3xl p-5 space-y-4" data-testid="confirm-cancel-dialog">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-red-700 text-sm">Tem certeza?</p>
                    {/* RELEASE-09: o texto precisa refletir o que realmente acontece — a renovação
                        para, mas o período já pago continua valendo. */}
                    <p className="text-xs text-red-500 mt-1">
                      {premiumPeriodEndsAt
                        ? `Sua assinatura não será renovada. Você continua com o Premium até ${fmtDate(premiumPeriodEndsAt)} e depois volta ao plano Grátis.`
                        : "Sua assinatura não será renovada e você voltará para o plano Grátis ao fim do período já pago."}
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowCancelConfirm(false)}
                    className="flex-1 bg-white border border-gray-200 text-foreground font-bold py-3 rounded-xl text-sm active:scale-95 transition-all"
                    data-testid="button-cancel-no"
                    disabled={status === "cancelling"}
                  >
                    Manter Premium
                  </button>
                  <button
                    onClick={handleCancel}
                    className="flex-1 bg-red-500 text-white font-bold py-3 rounded-xl text-sm active:scale-95 transition-all flex items-center justify-center gap-1 disabled:opacity-60"
                    data-testid="button-cancel-confirm"
                    disabled={status === "cancelling"}
                  >
                    {status === "cancelling" ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "Cancelar mesmo assim"
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Security notice */}
        <div className="mt-6 text-center">
          <p className="text-xs text-muted-foreground">
            {isAndroid ? "🔒 Pagamento seguro pela Google Play · Cancele quando quiser" : "🔒 Pagamento seguro pelo Mercado Pago · Cancele quando quiser"}
          </p>
        </div>
      </div>
    </Layout>
  );
}
