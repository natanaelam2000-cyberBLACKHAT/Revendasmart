import type { PendingSaleDoc } from "./offline-sales-queue";

export const PENDING_SALE_LEASE_MS = 60_000;

/** Legacy syncing documents use updatedAt as their lease start. Invalid dates
 * must not turn a recoverable item into a permanent syncing tombstone. */
export function isPendingSaleReady(record: PendingSaleDoc, nowMs = Date.now()): boolean {
  if (record.status === "pending") return true;
  if (record.status !== "syncing") return false;
  const expiresAt = record.syncLeaseExpiresAt
    ? Date.parse(record.syncLeaseExpiresAt)
    : Date.parse(record.updatedAt) + PENDING_SALE_LEASE_MS;
  return !Number.isFinite(expiresAt) || expiresAt <= nowMs;
}
