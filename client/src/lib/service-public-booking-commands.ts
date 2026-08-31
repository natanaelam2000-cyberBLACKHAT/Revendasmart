import { apiRequest } from "./api-client";

/**
 * SERV-PUBLIC-01 — wrappers finos para a superfície pública de agendamento (/agendar/:storeSlug). Nunca
 * pede autenticação ao apiRequest (que só anexa Authorization quando isso é explicitamente pedido) — o
 * visitante público nunca tem conta/token, exatamente como o resto do catálogo público
 * (client/src/lib/public-catalog-*). Mesmo padrão de idempotencyKey client-gerada já usado pelos wrappers
 * internos de Services.
 */
export type PublicBookingStoreResponse = {
  store: { name: string; description?: string; logoUrl?: string };
  services: readonly { id: string; name: string; description?: string; durationMinutes: number; priceCents: number }[];
};

export type PublicServiceAvailabilityResponse = {
  timezone: string;
  slotStepMinutes: number;
  durationMinutes: number;
  candidates: readonly { startAt: string; endAt: string }[];
};

export type PublicCreateHoldResponse = { holdId: string; startAt: string; endAt: string; expiresAt: string };
export type PublicConfirmHoldResponse = { confirmed: true; startAt: string; endAt: string };

function generateIdempotencyKey(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function getPublicBookingStore(storeSlug: string): Promise<PublicBookingStoreResponse> {
  return await apiRequest<PublicBookingStoreResponse>(`/api/public/services/${encodeURIComponent(storeSlug)}`, {
    method: "GET",
  });
}

export async function getPublicServiceAvailability(
  storeSlug: string,
  input: { serviceId: string; rangeStartAt: string; rangeEndAt: string },
): Promise<PublicServiceAvailabilityResponse> {
  const query = new URLSearchParams({ serviceId: input.serviceId, rangeStartAt: input.rangeStartAt, rangeEndAt: input.rangeEndAt });
  return await apiRequest<PublicServiceAvailabilityResponse>(`/api/public/services/${encodeURIComponent(storeSlug)}/availability?${query.toString()}`, {
    method: "GET",
  });
}

export async function createPublicBookingHold(
  storeSlug: string,
  input: { serviceId: string; startAt: string; idempotencyKey?: string },
): Promise<PublicCreateHoldResponse> {
  return await apiRequest<PublicCreateHoldResponse>(`/api/public/services/${encodeURIComponent(storeSlug)}/bookings/holds`, {
    method: "POST",
    body: {
      serviceId: input.serviceId,
      startAt: input.startAt,
      idempotencyKey: input.idempotencyKey ?? generateIdempotencyKey("public-booking-hold"),
    },
  });
}

export async function confirmPublicBookingHold(
  storeSlug: string,
  holdId: string,
  input: { customerName: string; customerPhone: string; idempotencyKey?: string },
): Promise<PublicConfirmHoldResponse> {
  return await apiRequest<PublicConfirmHoldResponse>(`/api/public/services/${encodeURIComponent(storeSlug)}/bookings/holds/${encodeURIComponent(holdId)}/confirm`, {
    method: "POST",
    body: {
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      idempotencyKey: input.idempotencyKey ?? generateIdempotencyKey("public-booking-confirm"),
    },
  });
}

/** §33 — mapeia os códigos públicos conhecidos (nunca um code/stack cru) para mensagens amigáveis. */
export function publicBookingErrorMessage(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
  if (code === "STORE_NOT_FOUND") return "Página de agendamento indisponível.";
  if (code === "SERVICE_NOT_AVAILABLE") return "Este serviço não está disponível para agendamento no momento.";
  if (code === "OUTSIDE_WORKING_HOURS") return "Este horário está fora do expediente configurado.";
  if (code === "SLOT_CONFLICT") return "Esse horário acabou de ser reservado. Escolha outro.";
  if (code === "HOLD_EXPIRED") return "Esse horário não está mais reservado. Escolha outro horário.";
  if (code === "HOLD_NOT_FOUND") return "Esta reserva temporária não foi encontrada. Escolha um horário novamente.";
  if (code === "RESOURCE_NOT_AVAILABLE") return "Não há horários disponíveis neste dia.";
  if (code === "INVALID_PAYLOAD") return "Confira os dados enviados e tente novamente.";
  return "Não foi possível concluir o agendamento agora. Tente novamente.";
}
