import { apiRequest } from "./api-client";

export type RecordServicePaymentResponse = {
  action: "record_payment";
  workId: string;
  paymentId: string;
  amountCents: number;
  method: "cash" | "pix" | "card" | "manual";
  recordedAt: string;
  idempotentReplay: boolean;
};

export type RefundServicePaymentResponse = {
  action: "refund_payment";
  workId: string;
  paymentId: string;
  refundId: string;
  amountCents: number;
  refundedAt: string;
  reason?: string;
  idempotentReplay: boolean;
};

function generateIdempotencyKey(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function recordServicePayment(
  workId: string,
  input: {
    amountCents: number;
    method: "cash" | "pix" | "card" | "manual";
    idempotencyKey?: string;
  },
): Promise<RecordServicePaymentResponse> {
  return await apiRequest<RecordServicePaymentResponse>(`/api/services/works/${encodeURIComponent(workId)}/payments`, {
    method: "POST",
    auth: true,
    body: {
      amountCents: input.amountCents,
      method: input.method,
      idempotencyKey: input.idempotencyKey ?? generateIdempotencyKey("service-payment"),
    },
  });
}

export async function refundServicePayment(
  workId: string,
  paymentId: string,
  input: {
    amountCents: number;
    reason?: string;
    idempotencyKey?: string;
  },
): Promise<RefundServicePaymentResponse> {
  return await apiRequest<RefundServicePaymentResponse>(`/api/services/works/${encodeURIComponent(workId)}/payments/${encodeURIComponent(paymentId)}/refunds`, {
    method: "POST",
    auth: true,
    body: {
      amountCents: input.amountCents,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey ?? generateIdempotencyKey("service-refund"),
    },
  });
}
