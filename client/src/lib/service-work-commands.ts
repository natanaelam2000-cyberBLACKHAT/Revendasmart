import { apiRequest } from "./api-client";
import type { ServiceWorkStatus } from "@shared/services";

export type ServiceWorkCommandResponse = {
  workId: string;
  action: "start" | "complete" | "cancel";
  resultingStatus: ServiceWorkStatus;
  transitionedAt: string;
  idempotentReplay: boolean;
};

function generateIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `service-work-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function postServiceWorkCommand(
  workId: string,
  action: "start" | "complete" | "cancel",
  idempotencyKey = generateIdempotencyKey(),
): Promise<ServiceWorkCommandResponse> {
  return await apiRequest<ServiceWorkCommandResponse>(`/api/services/works/${encodeURIComponent(workId)}/${action}`, {
    method: "POST",
    auth: true,
    body: { idempotencyKey },
  });
}

export async function startServiceWork(workId: string, idempotencyKey?: string): Promise<ServiceWorkCommandResponse> {
  return await postServiceWorkCommand(workId, "start", idempotencyKey);
}

export async function completeServiceWork(workId: string, idempotencyKey?: string): Promise<ServiceWorkCommandResponse> {
  return await postServiceWorkCommand(workId, "complete", idempotencyKey);
}

export async function cancelServiceWork(workId: string, idempotencyKey?: string): Promise<ServiceWorkCommandResponse> {
  return await postServiceWorkCommand(workId, "cancel", idempotencyKey);
}
