import { useEffect, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebase";
import { getApiUrl } from "@/lib/api-config";

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

      const token = await user.getIdToken();

      const res = await fetch(
        getApiUrl(`/api/plan/data/${user.uid}`),
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      console.log("[usePlanData] loaded:", json);

      setData(json);
    } catch (e) {
      console.error("[usePlanData] error:", e);
      setError(e instanceof Error ? e.message : "Erro ao carregar assinatura");
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