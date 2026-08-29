import { apiRequest } from "./api-client";

/**
 * SERV-BOOK-01 — wrappers finos de API, mesmo padrão de client/src/lib/service-payment-commands.ts. O
 * client nunca resolve concorrência aqui: só solicita, o servidor decide (§22 — "Cliente pode: solicitar;
 * consultar; exibir estado. Mas nunca resolver concorrência."). Nenhuma UI conectada nesta rodada.
 */
export type CreateServiceBookingHoldResponse = {
  action: "create_hold";
  holdId: string;
  serviceId: string;
  resourceId: string;
  startAt: string;
  endAt: string;
  expiresAt: string;
  idempotentReplay: boolean;
};

export type ConfirmServiceBookingHoldResponse = {
  action: "confirm_hold";
  holdId: string;
  bookingId: string;
  workId: string;
  serviceId: string;
  resourceId: string;
  startAt: string;
  endAt: string;
  idempotentReplay: boolean;
};

function generateIdempotencyKey(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function createServiceBookingHold(
  input: {
    serviceId: string;
    resourceId: string;
    startAt: string;
    customerId?: string;
    idempotencyKey?: string;
  },
): Promise<CreateServiceBookingHoldResponse> {
  return await apiRequest<CreateServiceBookingHoldResponse>("/api/services/bookings/holds", {
    method: "POST",
    auth: true,
    body: {
      serviceId: input.serviceId,
      resourceId: input.resourceId,
      startAt: input.startAt,
      customerId: input.customerId,
      idempotencyKey: input.idempotencyKey ?? generateIdempotencyKey("service-booking-hold"),
    },
  });
}

export async function confirmServiceBookingHold(
  holdId: string,
  input: { idempotencyKey?: string } = {},
): Promise<ConfirmServiceBookingHoldResponse> {
  return await apiRequest<ConfirmServiceBookingHoldResponse>(`/api/services/bookings/holds/${encodeURIComponent(holdId)}/confirm`, {
    method: "POST",
    auth: true,
    body: {
      idempotencyKey: input.idempotencyKey ?? generateIdempotencyKey("service-booking-confirm"),
    },
  });
}
