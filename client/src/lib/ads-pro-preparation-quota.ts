import { apiRequest } from "./api-client";

/** PLAN-IMPL-05 §31 — mesmo padrão de client/src/lib/booking-quota.ts: o doc mensal é server-only
 * (firestore.rules), então isto sempre vem de server/ads-pro-preparation-quota.ts via HTTP, nunca de
 * uma leitura Firestore direta. */
export type CurrentMonthPreparationUsage = {
  readonly used: number;
  readonly limit: number;
  readonly monthKey: string;
  readonly timezone: string;
};

export async function getCurrentMonthPreparationUsage(): Promise<CurrentMonthPreparationUsage> {
  return await apiRequest<CurrentMonthPreparationUsage>("/api/ads-pro/preparation-quota/current-month", { auth: true });
}
