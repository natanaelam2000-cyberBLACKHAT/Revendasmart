/**
 * Detecção de credenciais — PRO-06B1 §4. Só existência, NUNCA valor. Nenhuma função aqui retorna o
 * conteúdo de uma variável de ambiente; só um booleano "configured/missing" e, quando ausente, o NOME
 * exato da variável que precisa ser configurada.
 */

import type { MarketingProBenchmarkProviderId } from "./types";

export interface MarketingProBenchmarkCredentialCheck {
  readonly provider: MarketingProBenchmarkProviderId;
  readonly displayName: string;
  readonly envVarName: string;
  readonly configured: boolean;
}

/**
 * GEMINI_API_KEY é a variável documentada oficialmente pelo Google AI Studio/Gemini API;
 * GOOGLE_API_KEY é aceita como alias por várias integrações (inclusive SDKs oficiais) — checamos as
 * duas e reportamos qual delas (se alguma) está configurada, sem inventar uma terceira.
 */
export function checkMarketingProBenchmarkCredentials(): readonly MarketingProBenchmarkCredentialCheck[] {
  const googleVar = process.env.GEMINI_API_KEY ? "GEMINI_API_KEY" : process.env.GOOGLE_API_KEY ? "GOOGLE_API_KEY" : "GEMINI_API_KEY";
  return [
    { provider: "google", displayName: "Google Gemini (Nano Banana)", envVarName: googleVar, configured: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) },
    { provider: "openai", displayName: "OpenAI GPT Image", envVarName: "OPENAI_API_KEY", configured: Boolean(process.env.OPENAI_API_KEY) },
    { provider: "bfl", displayName: "Black Forest Labs FLUX.2", envVarName: "BFL_API_KEY", configured: Boolean(process.env.BFL_API_KEY) },
  ];
}
