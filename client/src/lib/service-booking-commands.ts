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

/** SERV-BOOK-02 — wrappers finos, mesmo padrão acima: nenhuma transaction/resolução de lock no client. */
export type ReleaseServiceBookingHoldResponse = {
  action: "release_hold";
  holdId: string;
  idempotentReplay: boolean;
};

export type CancelServiceBookingResponse = {
  action: "cancel_booking";
  bookingId: string;
  workId: string;
  cancelledAt: string;
  idempotentReplay: boolean;
};

export type RescheduleServiceBookingResponse = {
  action: "reschedule_booking";
  bookingId: string;
  workId: string;
  startAt: string;
  endAt: string;
  idempotentReplay: boolean;
};

export async function releaseServiceBookingHold(
  holdId: string,
  input: { idempotencyKey?: string } = {},
): Promise<ReleaseServiceBookingHoldResponse> {
  return await apiRequest<ReleaseServiceBookingHoldResponse>(`/api/services/bookings/holds/${encodeURIComponent(holdId)}/release`, {
    method: "POST",
    auth: true,
    body: {
      idempotencyKey: input.idempotencyKey ?? generateIdempotencyKey("service-booking-release"),
    },
  });
}

export async function cancelServiceBooking(
  bookingId: string,
  input: { idempotencyKey?: string } = {},
): Promise<CancelServiceBookingResponse> {
  return await apiRequest<CancelServiceBookingResponse>(`/api/services/bookings/${encodeURIComponent(bookingId)}/cancel`, {
    method: "POST",
    auth: true,
    body: {
      idempotencyKey: input.idempotencyKey ?? generateIdempotencyKey("service-booking-cancel"),
    },
  });
}



export type AssociateServiceBookingCustomerResponse = {
  action: "associate_booking_customer";
  bookingId: string;
  workId?: string;
  customerId?: string;
  idempotentReplay: boolean;
};

export type CreateClientFromServiceBookingResponse = {
  action: "create_client_from_booking";
  bookingId: string;
  workId?: string;
  customerId: string;
  idempotentReplay: boolean;
};

export async function associateServiceBookingCustomer(
  bookingId: string,
  input: { customerId: string | null; expectedCurrentCustomerId: string | null; idempotencyKey?: string },
): Promise<AssociateServiceBookingCustomerResponse> {
  return await apiRequest<AssociateServiceBookingCustomerResponse>(`/api/services/bookings/${encodeURIComponent(bookingId)}/customer-association`, {
    method: "POST",
    auth: true,
    body: {
      customerId: input.customerId,
      expectedCurrentCustomerId: input.expectedCurrentCustomerId,
      idempotencyKey: input.idempotencyKey ?? generateIdempotencyKey("service-booking-associate-customer"),
    },
  });
}

export async function createClientFromServiceBooking(
  bookingId: string,
  input: { expectedCurrentCustomerId: string | null; idempotencyKey?: string },
): Promise<CreateClientFromServiceBookingResponse> {
  return await apiRequest<CreateClientFromServiceBookingResponse>(`/api/services/bookings/${encodeURIComponent(bookingId)}/create-client`, {
    method: "POST",
    auth: true,
    body: {
      expectedCurrentCustomerId: input.expectedCurrentCustomerId,
      idempotencyKey: input.idempotencyKey ?? generateIdempotencyKey("service-booking-create-client"),
    },
  });
}

export async function rescheduleServiceBooking(
  bookingId: string,
  input: { startAt: string; idempotencyKey?: string },
): Promise<RescheduleServiceBookingResponse> {
  return await apiRequest<RescheduleServiceBookingResponse>(`/api/services/bookings/${encodeURIComponent(bookingId)}/reschedule`, {
    method: "POST",
    auth: true,
    body: {
      startAt: input.startAt,
      idempotencyKey: input.idempotencyKey ?? generateIdempotencyKey("service-booking-reschedule"),
    },
  });
}
