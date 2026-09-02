import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { PLAN_CONFIG, PLANS, isPremiumActive, type PlanType, type PlanLimits, type PlanData as MonetizationPlanData } from "@shared/monetization";
import { apiRequest, buildApiErrorDisplayMessage } from "@/lib/api-client";
import { getFirebaseAuth } from "@/lib/firebase";

type ActivePlan = PlanType;

type TrialInfo = {
  status: "active" | "expired" | "converted";
  startedAt: string | null;
  endsAt: string | null;
};

type PlanData = {
  currentPlan?: string;
  premiumActive?: boolean;
  premiumExpiresAt?: string | null;
  referralCount?: number;
  referralCode?: string | null;
  subscriptionStatus?: string;
  subscriptionId?: string | null;
  paymentStatus?: string | null;
  nextBillingAt?: string | null;
  lastPaymentAt?: string | null;
  canceledAt?: string | null;
  premiumSource?: string | null;
  billingProvider?: "mercado_pago" | "google_play" | null;
  // OWNER-ACCESS-02 — computados pelo servidor (GET /api/plan/data/:userId), nunca pelo client:
  // composição de planData (comercial) + internalGrants (Tester/Premium+), via resolveEntitlements
  // (shared/monetization.ts). O client só lê, nunca recalcula "quem tem Premium" com regra própria.
  hasPremiumAccess?: boolean;
  isTester?: boolean;
  isPremiumPlus?: boolean;
  entitlementSource?: "commercial" | "tester_grant" | "premium_plus_grant" | "none";
  // PLAN-IMPL-03 §17/§18 — também computados pelo servidor (ensurePlanLifecycleCurrent, server/
  // plan-lifecycle.ts): basePlan ignora trial (o que o tenant tem "de verdade"), effectivePlan já inclui
  // o boost de trial (o que vale para limites/entitlements agora). `trial` é só para exibição
  // (banner/contador) — nunca usado para decidir acesso, que já está embutido em hasPremiumAccess/
  // effectivePlan.
  basePlan?: string;
  effectivePlan?: string;
  trial?: TrialInfo | null;
};

interface PlanProviderValue {
  plan: PlanData | null;
  planData: PlanData | null;
  activePlan: ActivePlan;
  limits: PlanLimits;
  loading: boolean;
  refresh: () => Promise<void>;
  hasPremiumAccess: boolean;
  isPremium: boolean;
  premiumActive: boolean;
  isTester: boolean;
  isPremiumPlus: boolean;
  globalConfig: null;
  referralCode: string | null;
  referralCount: number;
  shareLink: string | null;
  error: string | null;
  basePlan: ActivePlan;
  trial: TrialInfo | null;
}

const PlanContext = createContext<PlanProviderValue | null>(null);

// RELEASE-16 §3/§4, estendido em OWNER-ACCESS-02, PLAN-IMPL-01 §3 e PLAN-IMPL-03 §17/§18: única fonte
// de verdade para "qual plano vale agora" — preferencialmente `data.effectivePlan`, já computado pelo
// servidor (ensurePlanLifecycleCurrent, server/plan-lifecycle.ts) considerando trial. `hasPremiumAccess`
// (também já trial-aware, via resolveEntitlements) é o fallback para um payload mais antigo sem
// `effectivePlan`; `isPremiumActive()` local é o último fallback, só para um shape cru/incompleto (nunca
// deveria acontecer com o servidor atual).
function resolveActivePlan(data: PlanData | null): ActivePlan {
  if (data?.effectivePlan === PLANS.FREE || data?.effectivePlan === PLANS.PRO || data?.effectivePlan === PLANS.PREMIUM) {
    return data.effectivePlan;
  }
  const hasAccess = typeof data?.hasPremiumAccess === "boolean"
    ? data.hasPremiumAccess
    : isPremiumActive(data as unknown as MonetizationPlanData | null);
  if (hasAccess) return PLANS.PREMIUM;
  if (data?.currentPlan === PLANS.PRO) return PLANS.PRO;
  return PLANS.FREE;
}

// PLAN-IMPL-01 §2: antes, esta função reconstruía um subconjunto dos limites à mão (com `Infinity`
// hardcoded para Premium) — uma segunda configuração paralela a `PLAN_CONFIG`, e já divergente dele
// mesmo antes deste ticket (Premium era `UNLIMITED` aqui e `Infinity` lá). Nenhum consumidor real lê
// `usePlan().limits.<campo>` hoje (confirmado antes desta mudança) — delegar direto para
// `PLAN_CONFIG[activePlan].limits` elimina a duplicação e já cobre `pro` e os campos novos
// (`services`/`bookingsMonthly`/`proAdPreparationsMonthly`) sem precisar de um terceiro branch manual.
function resolveLimits(activePlan: ActivePlan): PlanLimits {
  return PLAN_CONFIG[activePlan].limits;
}

async function fetchPlanData(user: User): Promise<PlanData> {
  return await apiRequest<PlanData>(`/api/plan/data/${user.uid}`, {
    auth: true,
    getAuthToken: () => user.getIdToken(),
  });
}

export function PlanProvider({ children }: { children: ReactNode }) {
  const currentUserRef = useRef<User | null>(null);
  const [planData, setPlanData] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPlan = useCallback(async (user = currentUserRef.current) => {
    if (!user) {
      setPlanData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await fetchPlanData(user);
      setPlanData(data);
    } catch (err) {
      setError(buildApiErrorDisplayMessage(err, "Erro ao carregar assinatura"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      currentUserRef.current = null;
      setPlanData(null);
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      currentUserRef.current = user ?? null;
      void loadPlan(user ?? null);
    });

    return () => unsubscribe();
  }, [loadPlan]);

  const activePlan = useMemo(() => resolveActivePlan(planData), [planData]);
  const hasPremiumAccess = activePlan === "premium";
  const limits = useMemo(() => resolveLimits(activePlan), [activePlan]);
  // PLAN-IMPL-03 §4/§18 — basePlan ignora trial (mesma validação de shape do effectivePlan acima);
  // documento sem o campo (payload antigo) cai no próprio activePlan já resolvido, nunca undefined.
  const basePlan: ActivePlan = planData?.basePlan === PLANS.FREE || planData?.basePlan === PLANS.PRO || planData?.basePlan === PLANS.PREMIUM
    ? planData.basePlan
    : activePlan;
  const trial = planData?.trial ?? null;
  // RELEASE-28: `/signup?ref=` nunca era capturado — `/signup` é rota PÚBLICA (App.tsx), fora do
  // PrivateRouter, que é onde a captura de `?referral=` roda. Corrigido para o mesmo formato que
  // settings.tsx já usa e que de fato é capturado: origem + `?referral=<código>`.
  const shareLink = useMemo(() => {
    if (!planData?.referralCode || typeof window === "undefined") return null;
    return `${window.location.origin}/?referral=${planData.referralCode}`;
  }, [planData?.referralCode]);

  const refresh = useCallback(() => loadPlan(), [loadPlan]);

  const value = useMemo<PlanProviderValue>(() => ({
    plan: planData,
    planData,
    activePlan,
    limits,
    loading,
    refresh,
    hasPremiumAccess,
    isPremium: hasPremiumAccess,
    premiumActive: hasPremiumAccess,
    isTester: planData?.isTester ?? false,
    isPremiumPlus: planData?.isPremiumPlus ?? false,
    globalConfig: null,
    referralCode: planData?.referralCode ?? null,
    referralCount: planData?.referralCount ?? 0,
    shareLink,
    error,
    basePlan,
    trial,
  }), [activePlan, basePlan, error, hasPremiumAccess, limits, loading, planData, refresh, shareLink, trial]);

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlan() {
  const context = useContext(PlanContext);
  if (!context) {
    throw new Error("usePlan must be used within PlanProvider");
  }
  return context;
}
