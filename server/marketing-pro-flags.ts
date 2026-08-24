import { MARKETING_PRO_SEMANTIC_GATE_READY } from "./marketing-pro-semantic-gate";

/**
 * PRO-08 — flag do provider real de background, lida do ambiente (server-side).
 *
 * Não existe hoje nenhum mecanismo de feature flag server-side no projeto: o único que existe
 * (`client/src/lib/remote-config.ts`, Firebase Remote Config) é explicitamente client-only e proibido
 * para decisão de autorização/segurança ("CRITICAL RULE: Do NOT use Remote Config for
 * Authentication/Authorization... Safe use: UI visibility"). A decisão de QUAL provider a rota real
 * chama (mock local vs. Google real) é exatamente esse tipo de decisão — por isso vive aqui, como uma
 * env var simples, nunca no Remote Config.
 *
 * Default (variável ausente ou qualquer valor diferente de "true"): OFF — runtime mock/local atual,
 * seguro por construção, inalterado. Só a string exata "true" liga o provider real.
 *
 * PRO-09: trava adicional, de CÓDIGO, não só de configuração — `MARKETING_PRO_SEMANTIC_GATE_READY`
 * (`marketing-pro-semantic-gate.ts`) precisa ser `true` para a flag valer QUALQUER COISA. O PRO-13
 * implementou esse detector como segunda chamada multimodal somente sobre o background. A habilitação
 * continua exigindo a env var exata; portanto o default de produção permanece OFF.
 */
export function isMarketingProRealBackgroundEnabled(): boolean {
  return MARKETING_PRO_SEMANTIC_GATE_READY && process.env.MARKETING_PRO_REAL_BACKGROUND_ENABLED === "true";
}

/** PRO-11B — opt-in independente; ausente ou diferente da string exata `true` permanece OFF. */
export function isMarketingProProductUnderstandingEnabled(): boolean {
  return process.env.MARKETING_PRO_PRODUCT_UNDERSTANDING_ENABLED === "true";
}
