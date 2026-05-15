import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";

import {
  getFirestore,
  doc,
  onSnapshot,
} from "firebase/firestore";

import { onAuthStateChanged } from "firebase/auth";

import { getFirebaseAuth } from "@/lib/firebase";

interface PlanData {
  plan?: string;
  status?: string;
  premiumActive?: boolean;
  premiumExpiresAt?: string | null;
}

interface PlanContextType {
  planData: PlanData | null;
  loading: boolean;
}

const PlanContext = createContext<PlanContextType>({
  planData: null,
  loading: true,
});

export function PlanProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [planData, setPlanData] =
    useState<PlanData | null>(null);

  const [loading, setLoading] =
    useState(true);

  useEffect(() => {
    const auth = getFirebaseAuth();

    let unsubFirestore: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(
      auth,
      (user) => {
        if (!user) {
          setPlanData(null);
          setLoading(false);
          return;
        }

        const db = getFirestore();

        const ref = doc(
          db,
          "users",
          user.uid,
          "planData",
          "main"
        );

        unsubFirestore = onSnapshot(
          ref,
          (snap) => {
            if (snap.exists()) {
              setPlanData(
                snap.data() as PlanData
              );
            } else {
              setPlanData(null);
            }

            setLoading(false);
          },
          (err) => {
            console.error(
              "[PlanProvider]",
              err
            );

            setLoading(false);
          }
        );
      }
    );

    return () => {
      unsubAuth();

      if (unsubFirestore) {
        unsubFirestore();
      }
    };
  }, []);

  return (
    <PlanContext.Provider
      value={{
        planData,
        loading,
      }}
    >
      {children}
    </PlanContext.Provider>
  );
}

export function usePlan() {
  return useContext(PlanContext);
}
