/**
 * PLAN-IMPL-07A §7 (autorização explícita do usuário) — backfill OPCIONAL de Client.lastPurchaseAt para
 * clientes com vendas anteriores a esta ticket existir. NUNCA rodado automaticamente (nenhuma rota HTTP,
 * nenhum hook de boot do servidor importa este arquivo) — só via `npx tsx server/backfill-client-last-purchase.ts <uid>`,
 * manual e explícito. NÃO é pré-requisito de corretude desta ticket: sem rodar isto, o comportamento
 * runtime já é correto e seguro (novas vendas populam o campo naturalmente, e a detecção de
 * "cliente inativo" simplesmente não considera quem ainda não tem o campo — nunca um falso positivo).
 *
 * Escopo por tenant (nunca todos os tenants de uma vez), em lote (Firestore batch, máx. 500 escritas),
 * idempotente (rodar duas vezes produz o mesmo estado final — só escreve quando o valor computado é MAIS
 * recente que o já existente, nunca sobrescreve um lastPurchaseAt real e mais novo por um cálculo
 * retroativo mais antigo).
 *
 * Este script FAZ o scan completo de Sales de um tenant que a engine em runtime (server/opportunity-
 * engine.ts) nunca pode fazer — é exatamente o tipo de operação "histórica, uma vez só, explícita" que
 * §7 do pedido do usuário permite; nunca confundir com o caminho runtime, que continua 100% bounded.
 */
import { initializeFirebaseAdmin } from "./firebase-admin-init";
import type { Firestore } from "firebase-admin/firestore";

export interface BackfillClientLastPurchaseSummary {
  readonly totalSales: number;
  readonly clientsWithSales: number;
  readonly written: number;
  readonly skipped: number;
}

/** PLAN-IMPL-07A-VERIFY-FINAL §5/§19 — exportada para ser testável de verdade contra o emulador (a
 * suíte de teste chama esta função diretamente, nunca reimplementa a lógica em código de teste); `db`
 * é opcional (default: initializeFirebaseAdmin().firestore()) só para o teste poder passar a MESMA
 * instância já inicializada, nunca uma segunda conexão. */
export async function backfillClientLastPurchase(uid: string, db: Firestore = initializeFirebaseAdmin().firestore()): Promise<BackfillClientLastPurchaseSummary> {
  const userRef = db.collection("users").doc(uid);

  // PLAN-IMPL-07A-VERIFY-FINAL §4 — antes lia users/{uid}/sales inteiro num único .get() sem paginação;
  // "tenant-scoped" sozinho não bastava (uma loja com histórico grande ainda carregaria tudo de uma vez
  // na memória). Paginado por doc-id (nenhum campo de ordenação extra necessário, nenhum índice novo) —
  // cada página é um read bounded e independente; um crash a qualquer momento só exige rodar o script de
  // novo do zero (idempotente, nunca incorreto, só potencialmente redundante).
  const SALES_PAGE_SIZE = 500;
  console.log(`[backfill] uid=${uid} — lendo Sales em páginas de ${SALES_PAGE_SIZE} (nunca a coleção inteira de uma vez, nunca rodado em runtime)...`);
  const lastPurchaseByClientId = new Map<string, string>();
  let totalSales = 0;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let pageQuery = userRef.collection("sales").orderBy("__name__").limit(SALES_PAGE_SIZE);
    if (cursor) pageQuery = pageQuery.startAfter(cursor);
    const pageSnap = await pageQuery.get();
    if (pageSnap.empty) break;
    for (const doc of pageSnap.docs) {
      const data = doc.data();
      const clientId = typeof data.clientId === "string" ? data.clientId : null;
      const date = typeof data.date === "string" ? data.date : null;
      if (!clientId || !date || Number.isNaN(Date.parse(date))) continue;
      const current = lastPurchaseByClientId.get(clientId);
      if (!current || Date.parse(date) > Date.parse(current)) lastPurchaseByClientId.set(clientId, date);
    }
    totalSales += pageSnap.docs.length;
    cursor = pageSnap.docs[pageSnap.docs.length - 1];
    console.log(`[backfill] +${pageSnap.docs.length} venda(s) lida(s) (total ${totalSales} até agora)...`);
    if (pageSnap.docs.length < SALES_PAGE_SIZE) break;
  }
  console.log(`[backfill] ${totalSales} venda(s) lida(s) no total. ${lastPurchaseByClientId.size} cliente(s) com pelo menos uma venda válida.`);

  const clientIds = Array.from(lastPurchaseByClientId.keys());
  let written = 0;
  let skipped = 0;
  // Lotes de 400 (folga sob o limite de 500 escritas/commit do Firestore) — cada lote é seu próprio
  // commit atômico independente, nunca uma transação única cobrindo todo o tenant.
  const BATCH_SIZE = 400;
  for (let offset = 0; offset < clientIds.length; offset += BATCH_SIZE) {
    const slice = clientIds.slice(offset, offset + BATCH_SIZE);
    const clientRefs = slice.map((clientId) => userRef.collection("clients").doc(clientId));
    const clientSnaps = await db.getAll(...clientRefs);

    const batch = db.batch();
    let batchWrites = 0;
    for (let index = 0; index < slice.length; index += 1) {
      const clientId = slice[index];
      const snapshot = clientSnaps[index];
      if (!snapshot.exists) { skipped += 1; continue; }
      const computedDate = lastPurchaseByClientId.get(clientId)!;
      const existing = snapshot.data()?.lastPurchaseAt;
      const existingMs = typeof existing === "string" ? Date.parse(existing) : NaN;
      // Idempotente: só escreve se ausente OU se o cálculo retroativo é mais recente que o já existente
      // (nunca sobrescreve um valor real, mais novo, gravado por uma venda de verdade nesse meio tempo).
      if (Number.isFinite(existingMs) && existingMs >= Date.parse(computedDate)) { skipped += 1; continue; }
      batch.update(clientRefs[index], { lastPurchaseAt: computedDate });
      batchWrites += 1;
    }
    if (batchWrites > 0) {
      await batch.commit();
      written += batchWrites;
    }
    console.log(`[backfill] lote ${offset}-${offset + slice.length}: ${batchWrites} escrita(s).`);
  }

  console.log(`[backfill] concluído. ${written} cliente(s) atualizado(s), ${skipped} pulado(s) (já em dia ou não encontrado).`);
  return { totalSales, clientsWithSales: lastPurchaseByClientId.size, written, skipped };
}

function runCli(): void {
  const targetUid = process.argv[2];
  if (!targetUid) {
    console.error("Uso: npx tsx server/backfill-client-last-purchase.ts <uid>");
    process.exit(1);
  }
  backfillClientLastPurchase(targetUid)
    .then(() => process.exit(0))
    .catch((error) => { console.error("[backfill] falhou:", error); process.exit(1); });
}

// PLAN-IMPL-07A-VERIFY-FINAL §5/§19 — só roda a CLI quando este arquivo é o entrypoint direto (`npx tsx
// server/backfill-client-last-purchase.ts <uid>`), nunca quando importado por um script de teste — a
// mesma exportação acima precisa continuar segura de importar sem efeito colateral algum.
const isDirectCliInvocation = Boolean(process.argv[1] && (process.argv[1].endsWith("backfill-client-last-purchase.ts") || process.argv[1].endsWith("backfill-client-last-purchase.js")));
if (isDirectCliInvocation) {
  runCli();
}
