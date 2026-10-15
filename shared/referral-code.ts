/**
 * Formato canônico do código público de indicação (USER-XXXXXXXXX).
 * Isolado para permitir consumo direto pelo router e rotas públicas sem puxar
 * o grafo completo de monetização e regras comerciais.
 */
export const REFERRAL_CODE_FORMAT = /^USER-[A-Z0-9]{9}$/;

export function isReferralCodeFormat(value: unknown): value is string {
  return typeof value === "string" && REFERRAL_CODE_FORMAT.test(value);
}
