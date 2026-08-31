import { apiRequest } from "./api-client";
import type { QuoteStatus } from "@shared/service-quotes";

export type ServiceQuoteCommandResponse = {
  quoteId: string;
  action: "send" | "revise" | "accept" | "reject" | "cancel" | "convert";
  resultingStatus: QuoteStatus;
  transitionedAt: string;
  idempotentReplay: boolean;
  currentVersionId?: string;
  currentVersionNumber?: number;
  acceptedVersionId?: string;
  convertedWorkId?: string;
};

function generateIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `service-quote-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function postServiceQuoteCommand(
  quoteId: string,
  action: ServiceQuoteCommandResponse["action"],
  body: Record<string, unknown>,
): Promise<ServiceQuoteCommandResponse> {
  return await apiRequest<ServiceQuoteCommandResponse>(`/api/services/quotes/${encodeURIComponent(quoteId)}/${action}`, {
    method: "POST",
    auth: true,
    body,
  });
}

export async function sendQuote(quoteId: string, idempotencyKey = generateIdempotencyKey()) {
  return await postServiceQuoteCommand(quoteId, "send", { idempotencyKey });
}

export async function beginQuoteRevision(quoteId: string, expectedVersionId: string, idempotencyKey = generateIdempotencyKey()) {
  return await postServiceQuoteCommand(quoteId, "revise", { expectedVersionId, idempotencyKey });
}

export async function acceptQuote(quoteId: string, versionId: string, idempotencyKey = generateIdempotencyKey()) {
  return await postServiceQuoteCommand(quoteId, "accept", { versionId, idempotencyKey });
}

export async function rejectQuote(quoteId: string, versionId: string, idempotencyKey = generateIdempotencyKey()) {
  return await postServiceQuoteCommand(quoteId, "reject", { versionId, idempotencyKey });
}

export async function cancelQuote(quoteId: string, idempotencyKey = generateIdempotencyKey()) {
  return await postServiceQuoteCommand(quoteId, "cancel", { idempotencyKey });
}

export async function convertAcceptedQuoteToWork(quoteId: string, idempotencyKey = generateIdempotencyKey()) {
  return await postServiceQuoteCommand(quoteId, "convert", { idempotencyKey });
}

export type CreateServiceQuoteForWorkResponse = {
  action: "create_quote_for_work";
  workId: string;
  quoteId: string;
  idempotentReplay: boolean;
};

/** SERV-QUOTE-LINK-01 — cria um Quote (rascunho) para um ServiceWork já existente sem orçamento, ligando
 * os dois atomicamente no servidor (nunca uma escrita direta de ServiceWork.quoteId pelo client). */
export async function createServiceQuoteForWork(
  workId: string,
  input: { customerMessage?: string; validUntil?: string } = {},
  idempotencyKey = generateIdempotencyKey(),
): Promise<CreateServiceQuoteForWorkResponse> {
  return await apiRequest<CreateServiceQuoteForWorkResponse>(`/api/services/works/${encodeURIComponent(workId)}/quote`, {
    method: "POST",
    auth: true,
    body: { customerMessage: input.customerMessage, validUntil: input.validUntil, idempotencyKey },
  });
}
