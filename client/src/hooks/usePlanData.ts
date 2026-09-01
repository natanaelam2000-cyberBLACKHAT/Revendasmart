import { useEffect, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebase";
import { apiRequest, buildApiErrorDisplayMessage } from "@/lib/api-client";
import { isPremiumActive, toEntitlementDate, PLANS, type PlanType, type PlanData as MonetizationPlanData } from "@shared/monetization";

interface PlanData {
  currentPlan?: string;
  premiumActive?: boolean;
  /** Timestamp do Firestore serializado (`{_seconds}`) ou string ISO — normalizado por
   * `toEntitlementDate()` antes de qualquer comparação. */
  premiumExpiresAt?: unknown;
  premiumSource?: string | null;
  referralCount?: number;
  referralCode?: string | null;
  subscriptionStatus?: string;
  subscriptionId?: string | null;
  paymentStatus?: string | null;
  nextBillingAt?: string | null;
  lastPaymentAt?: string | null;
  canceledAt?: string | null;
  /** RELEASE-09: false = renovação cancelada (o acesso ainda vale até premiumExpiresAt). */
  autoRenew?: boolean | null;
  /** RELEASE-07B: qual provider concedeu a assinatura atual — decide se o cancelamento vai para a
   * gestão de assinatura da Play ou para o endpoint /api/app-subscription/cancel (Mercado Pago). */
  billingProvider?: "mercado_pago" | "google_play" | null;
  // OWNER-ACCESS-02 — ver PlanProvider.tsx: computado pelo servidor, nunca pelo client.
  hasPremiumAccess?: boolean;
  isTester?: boolean;
  isPremiumPlus?: boolean;
}

export function usePlanData() {
  const [data, setData] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadPlanData() {
    try {
      setError(null);
      const auth = getFirebaseAuth();
      const user = auth?.currentUser;

      if (!user) {
        setLoading(false);
        return;
      }

      const json = await apiRequest<PlanData>(`/api/plan/data/${user.uid}`, {
        auth: true,
        getAuthToken: () => user.getIdToken(),
      });

      setData(json);
    } catch (e) {
      setError(buildApiErrorDisplayMessage(e, "Erro ao carregar assinatura"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPlanData();
  }, []);

  // RELEASE-16 §3/§4: única fonte de verdade — `isPremiumActive()` (shared/monetization.ts), a MESMA
  // função usada pelo servidor e por `PlanProvider`. Antes, este hook reimplementava a regra em
  // paralelo (só `premiumActive`/`currentPlan` + expiry, sem considerar `subscriptionStatus` nem
  // `premiumSource`) — podia divergir do `PlanProvider` para o mesmo documento.
  const premiumPeriodEndsAt = toEntitlementDate(data?.premiumExpiresAt);
  const hasPremiumAccess = typeof data?.hasPremiumAccess === "boolean"
    ? data.hasPremiumAccess
    : isPremiumActive(data as unknown as MonetizationPlanData | null);

  // PLAN-IMPL-01 §3: mesma regra de resolveCommercialPlan/resolveActivePlan (PlanProvider.tsx) —
  // Premium sempre vence; um `currentPlan` gravado como "pro" é preservado; qualquer outro valor
  // (incluindo documentos antigos que só conheciam "free"/"premium") cai em "free" sem migração.
  const activePlan: PlanType = hasPremiumAccess ? PLANS.PREMIUM : data?.currentPlan === PLANS.PRO ? PLANS.PRO : PLANS.FREE;

  // "Cancelada, mas ainda paga até DD/MM": renovação desligada com acesso ainda válido.
  const isCancelledWithinPaidPeriod =
    hasPremiumAccess && data?.autoRenew === false && Boolean(premiumPeriodEndsAt);

  return {
    planData: data,
    plan: data,
    activePlan,
    hasPremiumAccess,
    premiumPeriodEndsAt,
    isCancelledWithinPaidPeriod,
    isPremium: hasPremiumAccess,
    premiumActive: hasPremiumAccess,
    isTester: data?.isTester ?? false,
    isPremiumPlus: data?.isPremiumPlus ?? false,
    loading,
    refresh: loadPlanData,
    globalConfig: null,
    referralCode: data?.referralCode ?? null,
    referralCount: data?.referralCount ?? 0,
    // RELEASE-28: mesmo formato que PlanProvider.tsx e settings.tsx — origem + `?referral=<código>`,
    // o único capturado de verdade (PrivateRouter.tsx). `/signup?ref=` nunca era capturado (`/signup`
    // é rota pública, fora do PrivateRouter).
    shareLink: data?.referralCode
      ? `${window.location.origin}/?referral=${data.referralCode}`
      : null,
    error,
  };
}