/**
 * LGPD/segurança (REVENDASMART-LGPD-ANPD-REMEDIATION-01, Fase 10) — rate limit DISTRIBUÍDO,
 * Firestore-backed, para endpoints públicos que criam efeito financeiro (pedido do catálogo público,
 * criação de cobrança). Mesmo padrão já usado em `marketing-pro-rate-limit-firestore.ts` (PRO-09 §10),
 * generalizado aqui para chaves arbitrárias (IP, IP+slug) em vez de só `uid` — o Map em memória usado
 * pelos limitadores públicos (`server/routes.ts`) é por INSTÂNCIA de processo: sob N instâncias do
 * Cloud Run, o limite efetivo vira `limite_configurado × N`, e reseta a cada cold start. Este módulo
 * fecha esse gap para os caminhos de maior risco de abuso financeiro; os GETs de leitura do catálogo
 * público continuam no Map em memória de propósito — já são protegidos por cache de CDN de 60s
 * (`Cache-Control: public, max-age=60`), então a maior parte do tráfego repetido nunca chega a este
 * middleware de qualquer forma, e não haveria ganho de segurança proporcional ao custo de leitura extra
 * no Firestore em toda visualização de página pública.
 */
import type { Firestore } from "firebase-admin/firestore";

export const PUBLIC_RATE_LIMIT_COLLECTION = "publicRateLimits";

function sanitizeRateLimitKeySegment(value: string): string {
  // Documento do Firestore não aceita "/" — troca por um separador seguro. Mantém o resto legível para
  // depuração (não é um dado sensível: é IP/slug, já usados como chave do Map em memória equivalente).
  return value.replace(/[/]/g, "_").slice(0, 300) || "unknown";
}

export function buildPublicRateLimitDocId(key: string, windowMs: number, nowMs: number): string {
  const bucket = Math.floor(nowMs / windowMs);
  return `${sanitizeRateLimitKeySegment(key)}__${bucket}`;
}

export interface PublicRateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

/**
 * Falha ABERTA de propósito em erro de infraestrutura (Firestore indisponível): um rate limiter que
 * bloqueia o serviço inteiro quando o próprio banco está fora do ar transformaria uma falha de
 * disponibilidade em uma negação total de um fluxo financeiro legítimo — pior do que aceitar o risco
 * residual de abuso durante uma janela curta de indisponibilidade real do Firestore (que já afetaria o
 * resto do endpoint de qualquer forma).
 */
export async function checkDistributedRateLimit(
  db: Firestore,
  key: string,
  options: { windowMs: number; max: number },
  nowMs = Date.now(),
): Promise<PublicRateLimitDecision> {
  const { windowMs, max } = options;
  const docId = buildPublicRateLimitDocId(key, windowMs, nowMs);
  const ref = db.collection(PUBLIC_RATE_LIMIT_COLLECTION).doc(docId);
  const retryAfterSeconds = Math.max(1, Math.ceil(windowMs / 1000));

  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data();
      const rawCount = typeof data?.count === "number" ? data.count : 0;
      // Estado corrompido (existe mas não é inteiro não-negativo) falha FECHADO — nunca tratado como 0,
      // que reabriria a janela e permitiria mais chamadas que o limite (mesma regra do PRO-09 §11).
      const count = Number.isInteger(rawCount) && rawCount >= 0 ? rawCount : Number.POSITIVE_INFINITY;
      if (count >= max) {
        return { allowed: false, remaining: 0, retryAfterSeconds };
      }
      tx.set(ref, {
        count: count + 1,
        windowMs,
        updatedAt: new Date(nowMs).toISOString(),
        // TTL best-effort de limpeza de custo de armazenamento — nunca a autoridade de enforcement, que
        // é sempre o `count` lido dentro desta mesma transação.
        expiresAt: new Date(nowMs + windowMs * 4).toISOString(),
      }, { merge: true });
      return { allowed: true, remaining: Math.max(0, max - (count + 1)), retryAfterSeconds };
    });
  } catch {
    return { allowed: true, remaining: max, retryAfterSeconds };
  }
}
