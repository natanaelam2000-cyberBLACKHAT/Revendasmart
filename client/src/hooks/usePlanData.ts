import { useEffect, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebase";
import { apiRequest, buildApiErrorDisplayMessage } from "@/lib/api-client";

interface PlanData {
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

  const activePlan =
    data?.premiumActive === true ||
    data?.currentPlan === "premium"
      ? "premium"
      : "free";

  const hasPremiumAccess =
    data?.premiumActive === true ||
    data?.currentPlan === "premium";

  return {
    planData: data,
    plan: data,
    activePlan,
    hasPremiumAccess,
    isPremium: hasPremiumAccess,
    premiumActive: hasPremiumAccess,
    loading,
    refresh: loadPlanData,
    globalConfig: null,
    referralCode: data?.referralCode ?? null,
    referralCount: data?.referralCount ?? 0,
    shareLink: data?.referralCode
      ? `${window.location.origin}/signup?ref=${data.referralCode}`
      : null,
    error,
  };
}