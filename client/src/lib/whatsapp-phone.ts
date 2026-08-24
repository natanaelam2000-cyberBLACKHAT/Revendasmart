/**
 * RELEASE-32: normalização determinística de número de WhatsApp para uso em links `wa.me`.
 *
 * Sem country detection sofisticada de propósito (§4 da tarefa) — a regra é a mesma que qualquer
 * revendedora brasileira já entende intuitivamente: um número com DDD só (10-11 dígitos) É um número
 * BR sem DDI, então ganha o prefixo 55. Isso é ambíguo em teoria (um número americano completo com
 * DDI também pode ter 11 dígitos), mas o público desta função é majoritariamente BR e a tarefa pede
 * explicitamente para não inventar detecção complexa de país.
 */

const E164_MIN_DIGITS = 8;
const E164_MAX_DIGITS = 15;
const BR_LOCAL_MIN_DIGITS = 10; // DDD (2) + fixo (8)
const BR_LOCAL_MAX_DIGITS = 11; // DDD (2) + celular com 9 (9)
const BR_COUNTRY_CODE = "55";

/**
 * Normaliza um número de WhatsApp para dígitos puros, prontos para `https://wa.me/<numero>`.
 * Retorna `null` (fail closed) quando o valor é vazio, tem lixo demais, ou não tem tamanho plausível
 * de telefone — nunca produz um link `wa.me` com um número inválido.
 */
export function normalizeWhatsappPhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  // Já tem DDI do Brasil (55 + DDD + número) — preserva como está, nunca dobra o prefixo.
  if (digits.startsWith(BR_COUNTRY_CODE) && digits.length >= 12 && digits.length <= 13) {
    return digits;
  }

  // BR sem DDI, com DDD — o caso mais comum de cadastro manual da revendedora.
  if (digits.length >= BR_LOCAL_MIN_DIGITS && digits.length <= BR_LOCAL_MAX_DIGITS) {
    return `${BR_COUNTRY_CODE}${digits}`;
  }

  // Número internacional já completo e plausível (E.164: 8 a 15 dígitos) — preservado sem alteração.
  if (digits.length >= E164_MIN_DIGITS && digits.length <= E164_MAX_DIGITS) {
    return digits;
  }

  return null;
}

/** Só para exibição/feedback — nunca usado para montar o link em si. */
export function isWhatsappPhonePlausible(raw: unknown): boolean {
  return normalizeWhatsappPhone(raw) !== null;
}
