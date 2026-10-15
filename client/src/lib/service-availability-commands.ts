import { apiRequest } from "./api-client";

/**
 * SERV-AVAIL-01 — wrappers finos de API, mesmo padrão de client/src/lib/service-booking-commands.ts: nenhuma
 * regra de expediente/bloqueio/timezone roda no client, o servidor é sempre a autoridade. Nenhuma UI
 * conectada nesta rodada (AVAILABILITY_UI_WIRED=NO).
 */
export type WeeklyHoursInput = Record<string, ReadonlyArray<{ start: string; end: string }>>;

export type UpsertServiceResourceScheduleResponse = {
  action: "upsert_schedule";
  resourceId: string;
  idempotentReplay: boolean;
};

export type CreateServiceAvailabilityBlockResponse = {
  action: "create_block";
  blockId: string;
  resourceId: string;
  startAt: string;
  endAt: string;
  idempotentReplay: boolean;
};

export type DeleteServiceAvailabilityBlockResponse = {
  action: "delete_block";
  blockId: string;
  idempotentReplay: boolean;
};

export type ServiceAvailabilityResponse = {
  timezone: string;
  slotStepMinutes: number;
  durationMinutes: number;
  candidates: ReadonlyArray<{ startAt: string; endAt: string }>;
};

function generateIdempotencyKey(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function upsertServiceResourceSchedule(
  resourceId: string,
  input: {
    timezone: string;
    slotStepMinutes: number;
    minAdvanceMinutes?: number;
    maxAdvanceDays?: number;
    weeklyHours: WeeklyHoursInput;
    idempotencyKey?: string;
  },
): Promise<UpsertServiceResourceScheduleResponse> {
  return await apiRequest<UpsertServiceResourceScheduleResponse>(`/api/services/availability/schedules/${encodeURIComponent(resourceId)}`, {
    method: "POST",
    auth: true,
    body: {
      timezone: input.timezone,
      slotStepMinutes: input.slotStepMinutes,
      minAdvanceMinutes: input.minAdvanceMinutes,
      maxAdvanceDays: input.maxAdvanceDays,
      weeklyHours: input.weeklyHours,
      idempotencyKey: input.idempotencyKey ?? generateIdempotencyKey("service-availability-schedule"),
    },
  });
}

export async function createServiceAvailabilityBlock(
  input: { resourceId: string; startAt: string; endAt: string; reason?: string; idempotencyKey?: string },
): Promise<CreateServiceAvailabilityBlockResponse> {
  return await apiRequest<CreateServiceAvailabilityBlockResponse>("/api/services/availability/blocks", {
    method: "POST",
    auth: true,
    body: {
      resourceId: input.resourceId,
      startAt: input.startAt,
      endAt: input.endAt,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey ?? generateIdempotencyKey("service-availability-block"),
    },
  });
}

export async function deleteServiceAvailabilityBlock(
  blockId: string,
  input: { idempotencyKey?: string } = {},
): Promise<DeleteServiceAvailabilityBlockResponse> {
  return await apiRequest<DeleteServiceAvailabilityBlockResponse>(`/api/services/availability/blocks/${encodeURIComponent(blockId)}/delete`, {
    method: "POST",
    auth: true,
    body: {
      idempotencyKey: input.idempotencyKey ?? generateIdempotencyKey("service-availability-block-delete"),
    },
  });
}

export async function getServiceAvailability(
  input: { serviceId: string; resourceId: string; rangeStartAt: string; rangeEndAt: string },
): Promise<ServiceAvailabilityResponse> {
  const query = new URLSearchParams({
    serviceId: input.serviceId,
    resourceId: input.resourceId,
    rangeStartAt: input.rangeStartAt,
    rangeEndAt: input.rangeEndAt,
  });
  return await apiRequest<ServiceAvailabilityResponse>(`/api/services/availability?${query.toString()}`, {
    method: "GET",
    auth: true,
  });
}
