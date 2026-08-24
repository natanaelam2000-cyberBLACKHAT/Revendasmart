/**
 * PRO-09 §10 — rate limit DISTRIBUÍDO, Firestore-backed. Substitui a AUTORIDADE de enforcement do Map em
 * memória do PRO-06A (`checkMarketingProNewGenerationRateLimit`, server/marketing-pro.ts) — aquele Map é
 * por INSTÂNCIA de processo (documentado como best-effort desde a criação), inútil como limite real
 * quando Cloud Run escala horizontalmente. A função antiga continua exportada/testada (não é dead code —
 * outros callers/testes a usam), só deixou de ser chamada pela rota real.
 *
 * Estrutura por doc (§10): `users/{uid}/marketingProRateLimits/minute_<bucket>` e `.../day_<date>`, com
 * `count`/`windowStartAt`/`expiresAt`/`updatedAt`. "Não depender do TTL para enforcement" — o TTL do
 * Firestore (se configurado) é só limpeza de custo de armazenamento; a decisão de permitir/negar SEMPRE
 * compara `count` contra o limite dentro da MESMA transação que cria a geração (ver server/marketing-pro.ts),
 * nunca confia em o documento "já não existir mais" por causa do TTL.
 */
export const MARKETING_PRO_RATE_LIMIT_COLLECTION = "marketingProRateLimits";

/** Valores internos de teste (§10) — não é regra comercial definitiva. */
export const MARKETING_PRO_RATE_LIMIT_PER_MINUTE = 1;
export const MARKETING_PRO_RATE_LIMIT_PER_DAY = 3;

function resolvePositiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 10_000 ? parsed : fallback;
}

export function resolveMarketingProRateLimitPerMinute(): number {
  return resolvePositiveIntegerEnv("MARKETING_PRO_RATE_LIMIT_PER_MINUTE", MARKETING_PRO_RATE_LIMIT_PER_MINUTE);
}

export function resolveMarketingProRateLimitPerDay(): number {
  return resolvePositiveIntegerEnv("MARKETING_PRO_RATE_LIMIT_PER_DAY", MARKETING_PRO_RATE_LIMIT_PER_DAY);
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function minuteBucketId(nowMs: number): string {
  return `minute_${Math.floor(nowMs / MINUTE_MS)}`;
}

export function dayBucketId(nowMs: number): string {
  return `day_${new Date(nowMs).toISOString().slice(0, 10)}`;
}

export interface MarketingProRateLimitWindowState {
  /** `null` = documento não existe ainda (primeira geração desta janela) — nunca confundido com "count: 0" corrompido. */
  readonly count: number | null;
}

export type MarketingProRateLimitDecision =
  | { readonly allowed: true; readonly nextCount: number }
  | { readonly allowed: false; readonly reason: "corrupted-state" | "limit-exceeded" };

/**
 * Função pura — testável sem Firestore. `count` corrompido (existe mas não é inteiro não-negativo) falha
 * FECHADO (§11): NUNCA tratado como 0, que reabriria a janela e permitiria mais chamadas que o limite.
 */
export function decideMarketingProRateLimitWindow(state: MarketingProRateLimitWindowState, max: number): MarketingProRateLimitDecision {
  if (state.count === null) return { allowed: true, nextCount: 1 };
  if (!Number.isInteger(state.count) || state.count < 0) return { allowed: false, reason: "corrupted-state" };
  if (state.count >= max) return { allowed: false, reason: "limit-exceeded" };
  return { allowed: true, nextCount: state.count + 1 };
}

export interface MarketingProRateLimitTransactionPlan {
  readonly minuteDocPath: readonly [string, string, string];
  readonly dayDocPath: readonly [string, string, string];
  readonly minuteExpiresAtMs: number;
  readonly dayExpiresAtMs: number;
}

/** Caminho + expiração dos dois documentos de janela para um uid/momento — puro, sem Firestore. */
export function buildMarketingProRateLimitPlan(uid: string, nowMs: number): MarketingProRateLimitTransactionPlan {
  return {
    minuteDocPath: ["users", uid, `${MARKETING_PRO_RATE_LIMIT_COLLECTION}/${minuteBucketId(nowMs)}`] as const,
    dayDocPath: ["users", uid, `${MARKETING_PRO_RATE_LIMIT_COLLECTION}/${dayBucketId(nowMs)}`] as const,
    minuteExpiresAtMs: nowMs + MINUTE_MS,
    dayExpiresAtMs: nowMs + DAY_MS,
  };
}

export function readWindowStateFromDocData(data: Record<string, unknown> | null): MarketingProRateLimitWindowState {
  if (!data) return { count: null };
  return { count: typeof data.count === "number" ? data.count : Number.NaN };
}
