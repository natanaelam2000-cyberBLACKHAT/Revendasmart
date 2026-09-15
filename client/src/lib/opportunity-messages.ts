/**
 * PRODUCT-GROWTH-06 §7 — construtor de mensagem comercial determinístico e puro (sem IO, sem IA, sem
 * chamada externa): dado o tipo/evidence/entityReference de uma Opportunity já computada pelo server
 * (server/opportunity-engine.ts), monta o texto pt-BR pronto para WhatsApp/copiar. Nunca inventa
 * produto comprado, nunca promete um benefício comercial inexistente, nunca soa excessivamente pessoal —
 * cada mensagem usa só fatos já presentes em `evidence`/`entityReference` (os mesmos que a engine já
 * expôs para a UI, §5 do 07A), nunca um novo campo/leitura.
 *
 * §5/§6 — stalled_product e idle_schedule são ações self-service do VENDEDOR (criar anúncio, divulgar
 * agenda), nunca outreach para um cliente específico — retornam null aqui de propósito, e a UI
 * (opportunities.tsx) usa esse null para decidir que não há painel de mensagem para esses tipos.
 */
import { formatCurrency } from "./product-pricing";
import type { Opportunity } from "@shared/opportunity-rules";

const GENERIC_CLIENT_NAME = "Cliente";

/** §7 — fallback seguro para nome ausente/genérico: nunca produz "Olá, Cliente!" (soa robótico/errado
 * quando o nome real não foi identificado) nem "Olá, !" (espaço em branco malformado). */
function greetingFor(rawName: string): string {
  const trimmed = (rawName ?? "").trim();
  if (!trimmed || trimmed === GENERIC_CLIENT_NAME) return "Olá! Tudo bem?";
  return `Olá, ${trimmed}! Tudo bem?`;
}

/** §7 — `evidence` é `Record<string, number | string>` (tipo genérico compartilhado por todos os
 * tipos de oportunidade); nunca confia que `amount` é de fato um number válido sem checar — um valor
 * ausente/corrompido vira 0 (nunca "R$ NaN" nem "R$ undefined"). */
function safeEvidenceAmount(evidence: Opportunity["evidence"]): number {
  const value = evidence.amount;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export type OpportunityMessageInput = Pick<Opportunity, "type" | "evidence" | "entityReference">;

/**
 * Mensagem comercial pronta para o tipo, ou `null` para tipos sem ação de mensagem (stalled_product/
 * idle_schedule). Nunca contém "undefined"/"null" literal nem espaço duplo/malformado — cada campo
 * interpolado já passa por um fallback seguro antes de entrar no template.
 */
export function buildOpportunityMessage(opportunity: OpportunityMessageInput): string | null {
  switch (opportunity.type) {
    case "repeat_purchase":
      return `${greetingFor(opportunity.entityReference.name)} Passando para saber se você está precisando de ${opportunity.evidence.productName || "seu produto"} novamente. Se quiser, posso te ajudar 😊`;
    case "inactive_client":
      // §3 — nunca cita produto específico comprado, nunca promete um benefício comercial inexistente:
      // só oferece ajuda genérica, igual ao próprio exemplo do pedido.
      return `${greetingFor(opportunity.entityReference.name)} Faz um tempinho que não nos falamos. Passando para saber se você precisa de algum produto ou atendimento. Se quiser, posso te mostrar as opções disponíveis 😊`;
    case "overdue_receivable":
      // §4 — respeitoso, nunca linguagem de cobrança agressiva; usa o valor RESTANTE já calculado pela
      // engine (evidence.amount = amount - paidAmount, nunca o valor original da parcela — mesmo dado
      // já usado no `reason`); nunca expõe installmentId/status interno, nunca inventa Pix/dados de
      // pagamento.
      return `${greetingFor(opportunity.entityReference.name)} Identificamos uma parcela em aberto no valor de ${formatCurrency(safeEvidenceAmount(opportunity.evidence))}. Se precisar confirmar os dados ou combinar o pagamento, estou à disposição.`;
    case "stalled_product":
    case "idle_schedule":
      return null;
    default: {
      const exhaustiveCheck: never = opportunity.type;
      throw new Error(`Unhandled opportunity type for message: ${String(exhaustiveCheck)}`);
    }
  }
}

/** §11 — mesmo one-liner já usado em billings.tsx/client-detail.tsx (window.open com o link `wa.me`),
 * extraído aqui só para ser testável em isolamento — nunca uma segunda lógica de montagem de link. */
export function buildWhatsAppUrl(phoneDigits: string, message: string): string {
  return `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`;
}
