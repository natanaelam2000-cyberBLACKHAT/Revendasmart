import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import {
  Sparkles, CheckCircle, XCircle, Loader2, ChevronLeft,
  Star, Zap, ShoppingBag, Users, CreditCard, Infinity, AlertTriangle, Calendar, Gift
} from "lucide-react";
import { getFirebaseIdToken, getCurrentFirebaseUser } from "@/lib/firebase";
import { getApiUrl } from "@/lib/api-config";
import { usePlanData } from "@/hooks/usePlanData";
import { isPremiumFromGlobalAccess } from "@shared/monetization";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type PageStatus = "idle" | "loading" | "redirecting" | "success" | "error" | "cancelling" | "cancelled";

// ---------------------------------------------------------------------------
// Helper: format date for PT-BR
// ---------------------------------------------------------------------------
function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Premium Feature List
// ---------------------------------------------------------------------------
const PREMIUM_FEATURES = [
  { icon: <Infinity className="w-4 h-4 text-amber-600" />, text: "Produtos ilimitados" },
  { icon: <Users className="w-4 h-4 text-amber-600" />, text: "Clientes ilimitados" },
  { icon: <CreditCard className="w-4 h-4 text-amber-600" />, text: "Cobranças via Mercado Pago" },
  { icon: <ShoppingBag className="w-4 h-4 text-amber-600" />, text: "Múltiplos nichos de negócio" },
  { icon: <Star className="w-4 h-4 text-amber-600" />, text: "Destaque de produtos" },
  { icon: <Zap className="w-4 h-4 text-amber-600" />, text: "Catálogo profissional" },
  { icon: <Sparkles className="w-4 h-4 text-amber-600" />, text: "Funções premium futuras" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function Subscribe() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<PageStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [diagnoseLoading, setDiagnoseLoading] = useState(false);
  const [diagnoseMsg, setDiagnoseMsg] = useState<string>("");

  const { planData, globalConfig, isPremium, hasPremiumAccess, loading: planLoading, refresh, error: planError } = usePlanData();
  const isGlobalPremiumActive = isPremiumFromGlobalAccess(globalConfig);
  const subscriptionUiState = useMemo(() => {
    const subscriptionStatus = (planData?.subscriptionStatus ?? "").toLowerCase();
    const paymentStatus = (planData?.paymentStatus ?? "").toLowerCase();
    const premiumActive = !!planData?.premiumActive || isPremium || hasPremiumAccess;
    const hasValidSubscription = hasPremiumAccess || premiumActive || ["authorized", "active", "approved"].includes(subscriptionStatus) || paymentStatus === "approved";
    const isPending = subscriptionStatus === "pending";
    const hasRecentPending = isPending && !!planData?.subscriptionId;
    const showBuyButton = !hasValidSubscription && !hasRecentPending && !isGlobalPremiumActive;
    return { premiumActive, hasValidSubscription, isPending, hasRecentPending, showBuyButton, subscriptionStatus };
  }, [planData, isPremium, isGlobalPremiumActive, hasPremiumAccess]);
  const isActiveSubscriber = subscriptionUiState.hasValidSubscription;
  const isPendingPayment = subscriptionUiState.isPending;
  const isRecentPending = subscriptionUiState.hasRecentPending;
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
          await handleSyncNow();
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

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  async function handleSubscribe() {
    setStatus("loading");
    setErrorMsg("");
    try {
      const token = await getFirebaseIdToken();
      if (!token) throw new Error("Sessão expirada. Faça login novamente.");

      console.log("[subscribe/handleSubscribe] Token obtained, calling /api/app-subscription/create");

      const apiUrl = getApiUrl("/api/app-subscription/create");
      console.log("[subscribe/handleSubscribe] API URL:", apiUrl);

      const res = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      console.log("[subscribe/handleSubscribe] Response status:", res.status);

      const data = await res.json();
      console.log("[subscribe/handleSubscribe] Response data:", data);

      if (!res.ok) {
        console.error("[subscribe/handleSubscribe] Error response:", data);
        if (data.error === "ALREADY_SUBSCRIBED") {
          // Already subscribed — just refresh and go to success view
          setStatus("success");
          refresh?.();
          return;
        }
        
        // Extract message from response (ALWAYS STRING)
        let errorMsg = "Erro ao criar assinatura";
        
        // Priority order: message (string) > details.message > details.error > error field
        if (typeof data.message === 'string' && data.message.length > 0) {
          errorMsg = data.message;
          console.log("[subscribe/handleSubscribe] Using string message:", errorMsg);
        } else if (typeof data.message === 'object' && data.message !== null) {
          // Message is object — try to extract string from it
          console.warn("[subscribe/handleSubscribe] Message is object, attempting to extract:", data.message);
          
          if (data.message.message && typeof data.message.message === 'string') {
            errorMsg = data.message.message;
          } else if (data.message.error && typeof data.message.error === 'string') {
            errorMsg = data.message.error;
          } else if (data.message.details && typeof data.message.details === 'string') {
            errorMsg = data.message.details;
          } else {
            // Last resort: serialize only if reasonable size
            const serialized = JSON.stringify(data.message);
            if (serialized.length < 200) {
              errorMsg = `Erro: ${serialized}`;
            }
          }
        }
        
        // Try details field if message didn't work
        if (errorMsg === "Erro ao criar assinatura" && data.details) {
          console.log("[subscribe/handleSubscribe] Checking details:", data.details);
          if (data.details.message && typeof data.details.message === 'string') {
            errorMsg = data.details.message;
          } else if (data.details.error && typeof data.details.error === 'string') {
            errorMsg = data.details.error;
          }
        }
        
        // Add error code if available and not already in message
        if (data.error && typeof data.error === 'string' && !errorMsg.includes(data.error)) {
          errorMsg = `${errorMsg} (${data.error})`;
        }
        
        // Final validation — never return [object Object]
        if (errorMsg === "[object Object]" || errorMsg.includes("[object Object]")) {
          console.error("[subscribe/handleSubscribe] ⚠️ DETECTED [object Object]! Full data:", data);
          errorMsg = "Erro ao criar assinatura. Verifique os logs.";
        }
        
        console.error("[subscribe/handleSubscribe] FINAL ERROR MESSAGE:", errorMsg);
        throw new Error(errorMsg);
      }

      if (!data.initPoint) throw new Error("Link de checkout não retornado pela API.");

      console.log("[subscribe/handleSubscribe] Redirecting to checkout:", data.initPoint.substring(0, 50));
      setStatus("redirecting");
      // Redirect to Mercado Pago checkout
      window.location.href = data.initPoint;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro inesperado. Tente novamente.";
      console.error("[subscribe/handleSubscribe] Caught error:", msg);
      setErrorMsg(msg);
      setStatus("error");
    }
  }

  async function handleDiagnose() {
    setDiagnoseLoading(true);
    setDiagnoseMsg("");
    try {
      const token = await getFirebaseIdToken();
      if (!token) throw new Error("Sessão expirada. Faça login novamente.");

      const apiUrl = getApiUrl("/api/app-subscription/diagnose");
      const res = await fetch(apiUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();
      console.log("[subscribe/handleDiagnose] Response:", data);

      let msg = data.message || "Diagnóstico executado";
      if (data.diagnosis) {
        msg = `${msg}\n\nDiagnóstico: ${data.diagnosis}`;
      }
      if (data.analysis?.message) {
        msg = `${msg}\n\n${data.analysis.message}`;
      }

      setDiagnoseMsg(msg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao diagnosticar.";
      console.error("[subscribe/handleDiagnose] Error:", msg);
      setDiagnoseMsg(`❌ Erro: ${msg}`);
    } finally {
      setDiagnoseLoading(false);
    }
  }

  async function handleSyncNow() {
    setSyncLoading(true);
    setErrorMsg("");
    try {
      const token = await getFirebaseIdToken();
      if (!token) throw new Error("Sessão expirada. Faça login novamente.");

      console.log("[subscribe/handleSyncNow] Starting sync...");

      const apiUrl = getApiUrl("/api/app-subscription/sync-now");
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      const data = await res.json();
      console.log("[subscribe/handleSyncNow] Response:", data);

      if (!res.ok) {
        const errorMsg = data.message ?? `Erro: ${data.error || "desconhecido"}`;
        throw new Error(errorMsg);
      }

      console.log("[subscribe/handleSyncNow] ✅ SUCCESS - Premium activated");
      setStatus("success");
      setErrorMsg("");
      refresh?.();
      
      // Scroll to top to see status
      setTimeout(() => {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }, 500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao sincronizar. Tente novamente.";
      console.error("[subscribe/handleSyncNow] Error:", msg);
      setErrorMsg(msg);
    } finally {
      setSyncLoading(false);
    }
  }

  async function handleRecover() {
    setSyncLoading(true);
    setErrorMsg("");
    try {
      const token = await getFirebaseIdToken();
      if (!token) throw new Error("Sessão expirada. Faça login novamente.");

      console.log("[subscribe/handleRecover] Starting recovery...");

      const apiUrl = getApiUrl("/api/app-subscription/recover");
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      const data = await res.json();
      console.log("[subscribe/handleRecover] Response:", data);

      if (!res.ok) {
        const errorMsg = data.message ?? `Erro: ${data.error || "desconhecido"}`;
        throw new Error(errorMsg);
      }

      console.log("[subscribe/handleRecover] ✅ SUCCESS - Subscription recovered");
      setStatus("success");
      setErrorMsg("");
      refresh?.();
      
      // Scroll to top to see status
      setTimeout(() => {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }, 500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao recuperar. Tente novamente.";
      console.error("[subscribe/handleRecover] Error:", msg);
      setErrorMsg(msg);
    } finally {
      setSyncLoading(false);
    }
  }

  async function handleCancel() {
    setStatus("cancelling");
    setErrorMsg("");
    try {
      const token = await getFirebaseIdToken();
      if (!token) throw new Error("Sessão expirada. Faça login novamente.");

      const res = await fetch(getApiUrl("/api/app-subscription/cancel"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.message ?? "Erro ao cancelar assinatura.");

      setStatus("cancelled");
      setShowCancelConfirm(false);
      refresh?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro inesperado.";
      setErrorMsg(msg);
      setStatus("error");
    }
  }

  // ---------------------------------------------------------------------------
  // Render States
  // ---------------------------------------------------------------------------

  if (planLoading) {
    return (
      <Layout title="Premium">
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
          <Loader2 className="w-10 h-10 text-primary animate-spin" />
          <p className="text-muted-foreground text-sm">Carregando...</p>
        </div>
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
            onClick={() => setLocation("/dashboard")}
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
            <h1 className="text-2xl font-black text-foreground">Assinatura cancelada</h1>
            <p className="text-muted-foreground text-sm max-w-xs">
              Sua assinatura foi cancelada. Você permanecerá no plano Grátis a partir de agora.
            </p>
          </div>
          <button
            onClick={() => setLocation("/dashboard")}
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
          onClick={() => setLocation("/dashboard")}
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

{/* BLOCO DE PREÇO + CTA MELHORADO */}
{showBuyButton && !isGlobalPremiumActive && !hasPremiumAccess && (
  <div className="bg-green-50 border border-green-200 rounded-2xl p-5 text-center space-y-3 mb-6">

    <p className="text-lg font-black text-green-700">
      Apenas R$ {import.meta.env.VITE_PREMIUM_PRICE_BRL || "19,90"} / mês
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
        {/* Current Status Card (if has subscription) */}
        {planData?.subscriptionId && (
          <div className={`rounded-3xl p-4 mb-6 border ${
            isActiveSubscriber
              ? "bg-amber-50 border-amber-200"
              : isPendingPayment
              ? "bg-blue-50 border-blue-200"
              : "bg-gray-50 border-gray-200"
          }`} data-testid="card-subscription-status">
            <p className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-2">
              Status da Assinatura
            </p>
            <div className="flex items-center gap-2 mb-3">
              {isActiveSubscriber && <CheckCircle className="w-5 h-5 text-green-500" />}
              {isPendingPayment && <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />}
              {isCancelledSubscriber && <XCircle className="w-5 h-5 text-gray-400" />}
              <span className={`font-bold text-sm ${
                isActiveSubscriber ? "text-green-600" :
                isPendingPayment ? "text-blue-600" :
                "text-gray-500"
              }`}>
                {isActiveSubscriber ? "Ativa — Renovação automática" :
                 isPendingPayment ? "Aguardando pagamento" :
                 "Cancelada"}
              </span>
            </div>
            {planData.nextBillingAt && isActiveSubscriber && (
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

        {/* Price Card */}
        {!hasPremiumAccess && !isActiveSubscriber && !isGlobalPremiumActive && (
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

        {/* Firestore Error Message */}
        {planError && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-4 flex items-start gap-3" data-testid="error-plan-data">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-bold text-red-600">Erro ao carregar plano</p>
              <p className="text-xs text-red-500 mt-1">{planError}</p>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={handleDiagnose}
                  disabled={diagnoseLoading}
                  className="text-xs text-red-600 font-bold underline hover:no-underline"
                  data-testid="button-diagnose-error"
                >
                  {diagnoseLoading ? "Diagnosticando..." : "Diagnosticar"}
                </button>
                <button
                  onClick={handleRecover}
                  disabled={diagnoseLoading}
                  className="text-xs text-blue-600 font-bold underline hover:no-underline"
                  data-testid="button-recover-subscription"
                >
                  Recuperar assinatura
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Diagnosis Message */}
        {diagnoseMsg && (
          <div className={`rounded-2xl p-4 mb-4 flex items-start gap-3 border whitespace-pre-wrap text-xs ${
            diagnoseMsg.includes("✅") 
              ? "bg-green-50 border-green-200" 
              : "bg-yellow-50 border-yellow-200"
          }`} data-testid="diagnose-result">
            <AlertTriangle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${
              diagnoseMsg.includes("✅") ? "text-green-500" : "text-yellow-600"
            }`} />
            <p className={diagnoseMsg.includes("✅") ? "text-green-700 font-medium" : "text-yellow-700"}>
              {diagnoseMsg}
            </p>
          </div>
        )}

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

        {/* CTA Button */}
        {showBuyButton && !isGlobalPremiumActive && !hasPremiumAccess && (
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
                Assinar Premium — R$ 19,90/mês
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

        {/* Pending payment state */}
        {isPendingPayment && (
          <div className="space-y-3">
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-center">
              <Loader2 className="w-6 h-6 text-blue-500 animate-spin mx-auto mb-2" />
              <p className="text-sm font-bold text-blue-700">Pagamento pendente</p>
              <p className="text-xs text-blue-500 mt-1">
                Clique em "Sincronizar" se você já pagou, ou "Tentar novamente" se não.
              </p>
            </div>
            
            <button
              onClick={handleSyncNow}
              disabled={syncLoading}
              className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3 rounded-2xl text-sm active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
              data-testid="button-sync-subscription"
            >
              {syncLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sincronizando...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" />
                  Sincronizar Assinatura Paga
                </>
              )}
            </button>
            
            <button
              onClick={handleSubscribe}
              disabled={status === "loading"}
              className="w-full bg-amber-500 text-white font-bold py-3 rounded-2xl text-sm active:scale-95 transition-all disabled:opacity-60"
              data-testid="button-retry-payment"
            >
              Tentar pagar novamente
            </button>
          </div>
        )}

        {/* Active subscriber — cancel option */}
        {hasPremiumAccess && (
          <div className="mt-4">
            {!showCancelConfirm ? (
              <button
                onClick={() => setShowCancelConfirm(true)}
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
                    <p className="text-xs text-red-500 mt-1">
                      Ao cancelar, você voltará para o plano Grátis e perderá acesso aos recursos Premium.
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
            🔒 Pagamento seguro pelo Mercado Pago · Cancele quando quiser
          </p>
        </div>
      </div>
    </Layout>
  );
}
