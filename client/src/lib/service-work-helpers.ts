import { buildApiErrorDisplayMessage, ApiError } from "./api-client";
import { formatCurrency } from "./product-pricing";
import type { FinancialStatus, RefundStatus, ServicePaymentMethod, ServiceWorkStatus } from "@shared/services";

/**
 * SERV-UI-03 — helpers puros para a tela de atendimento (/servicos/atendimentos/:workId): formatação de
 * dinheiro a partir de cents (nunca float como fonte, §16 — a conversão para reais só acontece aqui, na
 * borda de exibição) e labels/mensagens em português simples, sem termos técnicos do domínio (§15/§27).
 */
export function formatCentsBRL(cents: number): string {
  return formatCurrency(cents / 100);
}

/** Converte um valor em reais digitado pelo usuário (ex.: "150,00" ou "150.00") para cents inteiros —
 * única conversão float->cents da tela, sempre arredondada antes de sair para o command server-side. */
export function reaisInputToCents(value: string | number): number {
  const normalized = typeof value === "string" ? value.replace(",", ".") : value;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(amount * 100);
}

export function serviceWorkStatusLabel(status: ServiceWorkStatus): string {
  if (status === "planned") return "Planejado";
  if (status === "in_progress") return "Em andamento";
  if (status === "completed") return "Concluído";
  return "Cancelado";
}

export function financialStatusLabel(status: FinancialStatus): string {
  if (status === "paid") return "Pago";
  if (status === "partial") return "Parcialmente pago";
  return "Pendente";
}

export function refundStatusLabel(status: RefundStatus): string {
  if (status === "full") return "Totalmente reembolsado";
  if (status === "partial") return "Parcialmente reembolsado";
  return "Sem reembolso";
}

export function paymentMethodLabel(method: ServicePaymentMethod): string {
  if (method === "cash") return "Dinheiro";
  if (method === "pix") return "Pix";
  if (method === "card") return "Cartão";
  if (method === "provider_charge") return "Cobrança online";
  return "Outro";
}

/** Mapeia erros conhecidos (comandos server-side de Work/Quote/Payment/Refund, e os poucos erros lançados
 * como Error simples pelas escritas diretas de rascunho de orçamento) para mensagens úteis em português —
 * nunca expõe code/stack cru ao usuário (§27). Reaproveita buildApiErrorDisplayMessage (já usado em
 * subscribe.tsx/PlanProvider.tsx/account-deletion.tsx/usePlanData.ts/AdminGrantsPanel.tsx) para qualquer
 * ApiError, cujo `message` já vem do COMMAND_ERROR_MESSAGES do servidor, específico e correto por código. */
export function serviceWorkErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return buildApiErrorDisplayMessage(error);
  }
  const raw = error instanceof Error ? error.message : "";
  if (raw === "UNAUTHENTICATED") return "Sessão inválida. Faça login novamente.";
  if (raw === "SERVICE_WORK_NOT_FOUND") return "Atendimento não encontrado.";
  if (raw === "QUOTE_NOT_FOUND") return "Orçamento não encontrado.";
  if (raw === "QUOTE_NOT_DRAFT") return "Esse orçamento já foi enviado e não pode mais ser editado como rascunho.";
  return buildApiErrorDisplayMessage(error, "Não foi possível concluir a ação agora. Tente novamente.");
}
