import { apiRequest } from "./api-client";

/** PLAN-IMPL-02C §46/§47 — a única forma do client saber `used`/`monthKey`: o doc mensal é
 * server-only (firestore.rules), então isto sempre vem de server/booking-quota.ts via HTTP, nunca de
 * uma leitura Firestore direta. */
export type CurrentMonthBookingUsage = {
  readonly used: number;
  readonly limit: number;
  readonly monthKey: string;
  readonly timezone: string;
};

export async function getCurrentMonthBookingUsage(): Promise<CurrentMonthBookingUsage> {
  return await apiRequest<CurrentMonthBookingUsage>("/api/booking-quota/current-month", { auth: true });
}
