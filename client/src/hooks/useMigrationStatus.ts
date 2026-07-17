import { useEffect, useState } from "react";
import { getFirebaseIdToken } from "@/lib/firebase";
import { getCurrentUserId } from "@/lib/mock-data";
import { getApiUrl } from "@/lib/api-config";

interface MigrationStatus {
  ready: boolean;
  firebaseSetup: {
    projectId?: string;
    bucket?: string;
    valid: boolean;
  };
  firestore: {
    hasSettings: boolean;
  };
  message: string;
  dryRunAvailable: boolean;
  nextStep: string;
  loading: boolean;
  error?: string;
}

/**
 * Hook to check migration readiness status
 * Safe to call - only reads status, doesn't modify anything
 */
export function useMigrationStatus(): MigrationStatus {
  const userId = getCurrentUserId();
  const [status, setStatus] = useState<MigrationStatus>({
    ready: false,
    firebaseSetup: { valid: false },
    firestore: { hasSettings: false },
    message: "",
    dryRunAvailable: false,
    nextStep: "",
    loading: true,
  });

  useEffect(() => {
    if (!userId) {
      setStatus(prev => ({
        ...prev,
        loading: false,
        error: "User not authenticated",
      }));
      return;
    }

    let isMounted = true;

    (async () => {
      try {
        const token = await getFirebaseIdToken();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const response = await fetch(getApiUrl(`/api/user/migration-status/${userId}`), { headers });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (isMounted) {
          setStatus({
            ready: data.ready,
            firebaseSetup: data.firebaseSetup || { valid: false },
            firestore: data.firestore || { hasSettings: false },
            message: data.message || "",
            dryRunAvailable: data.dryRunAvailable || false,
            nextStep: data.nextStep || "",
            loading: false,
          });
        }
      } catch (err) {
        console.error("[useMigrationStatus] Error:", err);
        if (isMounted) {
          setStatus(prev => ({
            ...prev,
            loading: false,
            error: err instanceof Error ? err.message : "Unknown error",
          }));
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [userId]);

  return status;
}
