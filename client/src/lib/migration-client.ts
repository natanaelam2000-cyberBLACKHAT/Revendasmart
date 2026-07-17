/**
 * Client-side migration API wrapper
 * Safe to use - all endpoints are in preparation mode
 */

import { getFirebaseIdToken } from "@/lib/firebase";
import { getApiUrl } from "@/lib/api-config";

/**
 * Call the validation endpoint with local data
 * This is a DRY RUN - no data is modified
 */
export async function validateLegacyData(
  userId: string,
  data: {
    products: any[];
    clients: any[];
    sales: any[];
    installments: any[];
    posts: any[];
    imageIds: string[];
  }
): Promise<{
  success: boolean;
  validation?: any;
  error?: string;
  dryRun: boolean;
}> {
  try {
    const token = await getFirebaseIdToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const response = await fetch(getApiUrl(`/api/user/data/validate/${userId}`), {
      method: "POST",
      headers,
      body: JSON.stringify({ data }),
    });

    if (!response.ok) {
      const error = await response.json();
      return {
        success: false,
        error: error.error || "Validation failed",
        dryRun: true,
      };
    }

    const result = await response.json();
    return {
      success: true,
      validation: result.validation,
      dryRun: result.dryRun || false,
    };
  } catch (err) {
    console.error("[migration-client] Validation error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
      dryRun: true,
    };
  }
}

/**
 * Check if all migration preparations are complete
 * Safe - only reads status
 */
export async function checkMigrationReadiness(userId: string): Promise<{
  ready: boolean;
  message?: string;
  error?: string;
}> {
  try {
    const token = await getFirebaseIdToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const response = await fetch(getApiUrl(`/api/user/migration-status/${userId}`), { headers });

    if (!response.ok) {
      return {
        ready: false,
        error: `HTTP ${response.status}`,
      };
    }

    const data = await response.json();
    return {
      ready: data.ready,
      message: data.message,
    };
  } catch (err) {
    console.error("[migration-client] Readiness check error:", err);
    return {
      ready: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * List of migration endpoints (currently in preparation mode)
 */
export const MIGRATION_ENDPOINTS = {
  images: "/api/user/images/migrate",
  products: "/api/user/products/migrate",
  clients: "/api/user/clients/migrate",
  sales: "/api/user/sales/migrate",
  installments: "/api/user/installments/migrate",
  posts: "/api/user/posts/migrate",
};

/**
 * Get endpoint status (all are currently in preparation mode)
 */
export function getMigrationEndpointStatus(): {
  [key: string]: {
    enabled: boolean;
    status: string;
  };
} {
  return {
    images: { enabled: false, status: "preparation" },
    products: { enabled: false, status: "preparation" },
    clients: { enabled: false, status: "preparation" },
    sales: { enabled: false, status: "preparation" },
    installments: { enabled: false, status: "preparation" },
    posts: { enabled: false, status: "preparation" },
  };
}
