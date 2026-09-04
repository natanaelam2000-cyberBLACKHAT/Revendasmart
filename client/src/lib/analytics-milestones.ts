import { trackAnalyticsEvent } from "@/lib/firebase";

/**
 * PLAN-IMPL-06 §11/§13/§14 — "primeiro X" (venda/agendamento/marketing) não tem uma autoridade
 * transacional pronta como first_product_created tem (PLAN-IMPL-01/06 §10, usage.productsCount === 0
 * dentro da própria transação de criação) — nem vendas nem agendamentos mantêm um contador de "total
 * histórico" em nenhum lugar hoje (só cotas MENSAIS, que resetam e por isso não servem para "alguma vez
 * na vida"). O Marketing clássico, por outro lado, JÁ persiste cada ação real em
 * users/{uid}/marketingHistory (useMarketingHistory.ts, auditado antes de assumir o contrário) — os três
 * reaproveitam o MESMO padrão de contagem leve já estabelecido (getCountFromServer, o MESMO usado por
 * usePlanUsageSnapshot.ts) em vez de criar um novo contador/coleção só para analytics (proibido por
 * §11 — "do not build an elaborate new milestone database... without evidence").
 *
 * `localStorage`, não um novo campo em Firestore: é só um "já disparei isto" por navegador/dispositivo,
 * nunca a fonte de verdade do PRÓPRIO marco (que continua sendo a contagem real do servidor sempre que
 * uma existe) — só evita repetir a consulta/o evento a cada carregamento subsequente. Um dispositivo
 * novo do mesmo tenant pode, no pior caso, re-confirmar via contagem real e corretamente decidir "não,
 * não foi a primeira" — nunca dispara duas vezes o evento de "primeira", porque a contagem real (quando
 * existe) sempre desempata a favor da verdade.
 */

const STORAGE_PREFIX = "rs:analytics_milestone:";

function storageKey(uid: string, milestoneKey: string): string {
  return `${STORAGE_PREFIX}${uid}:${milestoneKey}`;
}

function hasMilestoneFired(uid: string, milestoneKey: string): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(storageKey(uid, milestoneKey)) === "1";
  } catch {
    return false;
  }
}

function markMilestoneFired(uid: string, milestoneKey: string): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(storageKey(uid, milestoneKey), "1");
  } catch {
    // fail-open — nunca deixa uma falha de localStorage (modo privado, quota cheia) quebrar o fluxo.
  }
}

/**
 * Dispara `eventName` no máximo uma vez por tenant, confirmando com uma contagem REAL do servidor
 * (nunca client cache/lista local) na primeira vez que este marco ainda não foi visto neste
 * dispositivo. `countQuery` deve devolver a contagem TOTAL (histórica) do recurso relevante — o
 * chamador decide a consulta exata (ex.: getCountFromServer numa coleção).
 */
export async function fireServerCountedFirstOccurrence(
  uid: string,
  milestoneKey: string,
  eventName: "first_sale_completed" | "first_booking_created" | "first_marketing_created",
  countQuery: () => Promise<number>,
): Promise<void> {
  if (hasMilestoneFired(uid, milestoneKey)) return;
  try {
    const count = await countQuery();
    if (count <= 1) trackAnalyticsEvent(eventName);
    // count >= 1 já prova que isto nunca mais será "a primeira vez" — não precisa reconsultar de novo,
    // com ou sem ter disparado agora (pode já ter sido a segunda+ ocorrência vista pela primeira vez
    // neste dispositivo, ex. depois de limpar dados do navegador).
    if (count >= 1) markMilestoneFired(uid, milestoneKey);
  } catch {
    // §37 — analytics nunca pode quebrar o fluxo principal; simplesmente não marca nem dispara, e tenta
    // de novo na próxima ocorrência.
  }
}
