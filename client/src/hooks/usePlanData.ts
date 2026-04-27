import { useEffect, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebase";
import { getApiUrl } from "@/lib/api-config";

interface PlanData {
  currentPlan: string;
  premiumActive: boolean;
  premiumExpiresAt: string | null;
  referralCount: number;
}

export function usePlanData() {
  const [data, setData] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const auth = getFirebaseAuth();
    const user = auth?.currentUser;

    if (!user) {
      setLoading(false);
      return;
    }

    user.getIdToken().then(async (token) => {
      try {
        const res = await fetch(
          getApiUrl(`/api/plan/data/${user.uid}`),
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        const json = await res.json();
        setData(json);
      } catch (e) {
        console.error("[usePlanData] error:", e);
      } finally {
        setLoading(false);
      }
    });
  }, []);

  return {
    plan: data,
    loading,
    isPremium: data?.premiumActive === true,
  };
}


