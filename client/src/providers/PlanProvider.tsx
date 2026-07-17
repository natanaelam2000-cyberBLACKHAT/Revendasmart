import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { PLAN_CONFIG, type PlanType } from "@shared/monetization";
import { apiRequest, buildApiErrorDisplayMessage } from "@/lib/api-client";
import { getFirebaseAuth } from "@/lib/firebase";

type ActivePlan = PlanType | "admin";

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
};

type PlanLimits = {
  products: number;
  clients: number;
  charges: boolean;
  productHighlight: boolean;
  categories: boolean;
  niches: number;
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
  globalConfig: null;
  referralCode: string | null;
  referralCount: number;
  shareLink: string | null;
  error: string | null;
}

const FREE_LIMITS = PLAN_CONFIG.free.limits;
const PlanContext = createContext<PlanProviderValue | null>(null);

function resolveActivePlan(data: PlanData | null): ActivePlan {
  return data?.premiumActive === true || data?.currentPlan === "premium" ? "premium" : "free";
}

function resolveLimits(activePlan: ActivePlan): PlanLimits {
  if (activePlan === "premium" || activePlan === "admin") {
    return {
      products: Infinity,
      clients: Infinity,
      charges: true,
      productHighlight: true,
      categories: true,
      niches: Infinity,
    };
  }

  return {
    products: FREE_LIMITS.products,
    clients: FREE_LIMITS.clients,
    charges: Boolean(FREE_LIMITS.charges),
    productHighlight: Boolean(FREE_LIMITS.productHighlight),
    categories: Boolean(FREE_LIMITS.categories),
    niches: FREE_LIMITS.niches,
  };
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
  const hasPremiumAccess = activePlan === "premium" || activePlan === "admin";
  const limits = useMemo(() => resolveLimits(activePlan), [activePlan]);
  const shareLink = useMemo(() => {
    if (!planData?.referralCode || typeof window === "undefined") return null;
    return `${window.location.origin}/signup?ref=${planData.referralCode}`;
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
    globalConfig: null,
    referralCode: planData?.referralCode ?? null,
    referralCount: planData?.referralCount ?? 0,
    shareLink,
    error,
  }), [activePlan, error, hasPremiumAccess, limits, loading, planData, refresh, shareLink]);

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlan() {
  const context = useContext(PlanContext);
  if (!context) {
    throw new Error("usePlan must be used within PlanProvider");
  }
  return context;
}
