/**
 * PLAN-IMPL-02B1 — motor canônico de reconciliação de acesso pós-mudança de plano: decide quais Products/
 * Services existentes permanecem "active" (operáveis) vs "preserved" (excedente do novo limite,
 * preservado/histórico, nunca apagado) quando o total já criado excede o novo limite do plano. Nunca
 * cria, nunca apaga documento algum — só alterna `planAccessState` em documentos já existentes.
 *
 * Uma ÚNICA função cobre downgrade, upgrade e replay no mesmo plano (§20 do ticket): o alvo é sempre
 * recalculado do zero a partir dos documentos atuais + `newPlan`, nunca de um diff armazenado — então
 * chamar de novo com os mesmos argumentos é idempotente por construção (nenhum handler duplicado por
 * transição, ver reconcilePlanAccess abaixo).
 *
 * Fora de escopo deste ticket (§25/§37): nenhuma rota HTTP chama esta função ainda — cancelamento,
 * expiração de trial, falha de pagamento e o webhook do Mercado Pago continuam sem tocar aqui.
 * PLAN-IMPL-03 é quem conecta um chamador real a este engine.
 */
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { logError, logInfo } from "./logger";
import {
  PLAN_CONFIG,
  UNLIMITED,
  resolvePlanAccessSelectionSource,
  resolvePlanAccessState,
  type PlanAccessState,
  type PlanType,
} from "../shared/monetization";

const FETCH_BATCH_SIZE = 500;
/** Firestore permite até 500 mutações por transação/batch — 400 deixa margem para as demais operações
 * (nenhuma outra escrita concorre aqui hoje, mas evita colar exatamente no teto). */
const TRANSACTION_SAFE_MUTATION_THRESHOLD = 400;
const CHUNK_SIZE = 400;

export type DomainName = "products" | "services";

type AccessCandidate = {
  readonly id: string;
  readonly currentState: PlanAccessState;
  readonly priorityRank: number;
  readonly updatedAtMs: number;
  readonly createdAtMs: number;
};

export type PlanAccessDomainResult = {
  readonly total: number;
  readonly allowed: number;
  readonly preserved: number;
};

export type PlanAccessReconciliationResult = {
  readonly products: PlanAccessDomainResult;
  readonly services: PlanAccessDomainResult;
  readonly selectionRequired: boolean;
};

function resolveComparableTimeMs(value: unknown): number {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  }
  if (value && typeof value === "object" && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return Number.NEGATIVE_INFINITY;
}

/**
 * PLAN-IMPL-02B1 §10 — ordem de prioridade para quem fica "active": priorityRank menor primeiro, depois
 * updatedAt/createdAt mais recentes, e id como desempate final (sempre presente e único — garante ordem
 * total mesmo quando todos os outros critérios empatam). `priorityRank` é o único critério específico de
 * domínio (products vs services); o resto do comparador é compartilhado entre os dois.
 *
 * PLAN-IMPL-02B2 §12 — dentro de `priorityRank`, um documento com `planAccessSelectionSource === "user"`
 * E `planAccessState === "active"` (isto é: a última coisa que aconteceu a ele foi o DONO escolher
 * explicitamente mantê-lo ativo, via setActiveProductSelection/setActiveServiceSelection) sempre vence
 * qualquer critério automático — é isso que faz uma escolha manual sobreviver a um replay de
 * reconciliação (mesmo plano, upgrade parcial, downgrade): o próprio documento já é sua memória, sem
 * precisar de um histórico de seleção separado.
 */
function compareCandidates(a: AccessCandidate, b: AccessCandidate): number {
  if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank;
  if (a.updatedAtMs !== b.updatedAtMs) return b.updatedAtMs - a.updatedAtMs;
  if (a.createdAtMs !== b.createdAtMs) return b.createdAtMs - a.createdAtMs;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** PLAN-IMPL-02B2 §12 — true só quando a ÚLTIMA decisão sobre este documento foi uma escolha explícita do
 * dono para mantê-lo ativo. Um documento `user`+`preserved` (o dono escolheu EXCLUIR) não recebe prioridade
 * negativa aqui de propósito: quando sobra espaço (upgrade), ele volta a competir normalmente pelos
 * critérios automáticos, em vez de carregar uma exclusão permanente que nenhuma parte do ticket pediu —
 * `U26/U27/U32` (upgrade com espaço suficiente restaura todos) dependem exatamente deste comportamento. */
function isUserSelectedActive(data: Record<string, unknown>): boolean {
  return resolvePlanAccessSelectionSource(data.planAccessSelectionSource) === "user"
    && resolvePlanAccessState(data.planAccessState) === "active";
}

/**
 * PLAN-IMPL-02B1 §10 — Product não tem NENHUM campo real de "já publicado/visível" (auditado: nem o
 * schema TS nem os dois allowlists de escrita — client em product-payload.ts e Rules em
 * productAllowedFields — têm tal campo) e `createdAt`/`updatedAt` estão nos allowlists mas NUNCA são
 * escritos por nenhum caminho de criação real hoje (buildProductCreatePayload/cleanProductPayload
 * auditados, nenhum dos dois seta esses campos). Fora da prioridade nova de seleção manual (§12 acima,
 * PLAN-IMPL-02B2), `priorityRank` fica fixo numa única faixa para todos os demais (sem sinal real para
 * diferenciar) e o comparador cai, na prática, em id ascendente puro dentro dela. Isso É uma ordem
 * determinística válida (sempre a mesma para os mesmos dados, nunca instável) — só não é uma priorização
 * rica. Documentado explicitamente no relatório final em vez de inventar um campo novo para simular
 * relevância que os dados não têm (§10 do ticket original proíbe isso). Se um caminho de criação futuro
 * passar a popular createdAt/updatedAt, o comparador já os usa automaticamente, sem precisar mudar este
 * arquivo.
 */
function toProductCandidate(id: string, data: Record<string, unknown>): AccessCandidate {
  return {
    id,
    currentState: resolvePlanAccessState(data.planAccessState),
    priorityRank: isUserSelectedActive(data) ? 0 : 1,
    updatedAtMs: resolveComparableTimeMs(data.updatedAt),
    createdAtMs: resolveComparableTimeMs(data.createdAt),
  };
}

/** PLAN-IMPL-02B1 §10 — Service tem active/published/createdAt/updatedAt reais e sempre presentes
 * (exigidos por assertValidService, shared/services.ts) — um serviço já pronto para reserva pública
 * (active && published) tem prioridade sobre um em rascunho, abaixo da prioridade de seleção manual
 * (§12, PLAN-IMPL-02B2). */
function toServiceCandidate(id: string, data: Record<string, unknown>): AccessCandidate {
  return {
    id,
    currentState: resolvePlanAccessState(data.planAccessState),
    priorityRank: isUserSelectedActive(data) ? 0 : data.active === true && data.published === true ? 1 : 2,
    updatedAtMs: resolveComparableTimeMs(data.updatedAt),
    createdAtMs: resolveComparableTimeMs(data.createdAt),
  };
}

/** Mesmo padrão de paginação já usado em server/routes.ts (loadPublicCatalogPresentationInputs) para ler
 * uma coleção inteira sem depender de um único `.get()` sem limite. Exportado — PLAN-IMPL-02B2
 * (server/plan-access-selection.ts) reusa esta MESMA função para validar `selectedIds` contra o conjunto
 * real de documentos do tenant, em vez de reimplementar a paginação. */
export async function fetchAllDocs(db: Firestore, uid: string, domain: DomainName): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const admin = getFirebaseAdmin();
  const documentId = admin.firestore.FieldPath.documentId();
  const results: Array<{ id: string; data: Record<string, unknown> }> = [];
  let lastId: string | null = null;
  do {
    let queryRef: any = db.collection("users").doc(uid).collection(domain)
      .orderBy(documentId)
      .limit(FETCH_BATCH_SIZE);
    if (lastId) queryRef = queryRef.startAfter(lastId);
    const snapshot = await queryRef.get();
    for (const doc of snapshot.docs) results.push({ id: doc.id, data: doc.data() ?? {} });
    lastId = snapshot.docs.length === FETCH_BATCH_SIZE ? snapshot.docs[snapshot.docs.length - 1].id : null;
  } while (lastId);
  return results;
}

/** PLAN-IMPL-02B2 §11 — `extra` é opcional e nunca usado por `reconcilePlanAccess` (que só alterna
 * `planAccessState`); `setActiveProductSelection`/`setActiveServiceSelection`
 * (server/plan-access-selection.ts) o usa para gravar `planAccessSelectionSource: "user"` JUNTO da mesma
 * escrita seletiva, reusando esta mesma estrutura em vez de uma segunda forma de PlannedChange. */
export type PlannedChange = { readonly id: string; readonly target: PlanAccessState; readonly extra?: Readonly<Record<string, unknown>> };

/** Função pura: decide o alvo (active/preserved) de cada documento e devolve só os que REALMENTE
 * precisam mudar (§8/§21 — replay sem excesso não gera nenhuma escrita, já que o alvo recalculado bate
 * com o `planAccessState` atual de todo mundo). */
function planDomainChanges(
  docs: Array<{ id: string; data: Record<string, unknown> }>,
  limit: number,
  toCandidate: (id: string, data: Record<string, unknown>) => AccessCandidate,
): { readonly result: PlanAccessDomainResult; readonly changes: readonly PlannedChange[] } {
  const candidates = docs.map(({ id, data }) => toCandidate(id, data));
  candidates.sort(compareCandidates);
  const total = candidates.length;
  const activeCount = limit === UNLIMITED ? total : Math.min(limit, total);
  const activeIds = new Set(candidates.slice(0, activeCount).map((candidate) => candidate.id));
  const changes: PlannedChange[] = [];
  for (const candidate of candidates) {
    const target: PlanAccessState = activeIds.has(candidate.id) ? "active" : "preserved";
    if (target !== candidate.currentState) changes.push({ id: candidate.id, target });
  }
  return {
    result: { total, allowed: activeCount, preserved: total - activeCount },
    changes,
  };
}

/**
 * PLAN-IMPL-02B1 — núcleo puro exportado para teste direto (script/plan-impl-02b1-downgrade-access-
 * tests.ts): dado um domínio, uma lista de documentos já carregada e um limite, devolve exatamente a
 * mesma decisão que `reconcilePlanAccess` aplicaria, sem tocar Firestore. Também é o que
 * `reconcilePlanAccess` usa internamente — nunca uma segunda implementação da mesma lógica.
 */
export function computeReconciliationPlan(
  domain: DomainName,
  docs: ReadonlyArray<{ readonly id: string; readonly data: Record<string, unknown> }>,
  limit: number,
): { readonly result: PlanAccessDomainResult; readonly changes: readonly PlannedChange[] } {
  return planDomainChanges(docs.slice(), limit, domain === "products" ? toProductCandidate : toServiceCandidate);
}

function chunkList<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function reconciliationStatusRef(db: Firestore, uid: string) {
  return db.collection("users").doc(uid).collection("planAccessReconciliation").doc("status");
}

/**
 * PLAN-IMPL-02B1 §22 — reaplica o diff PRÉ-CALCULADO dentro de uma única transação: cada doc afetado é
 * relido (tx.getAll) e só escrito se ainda existir (um delete concorrente — só Products têm comando de
 * delete, deleteProductCommand — é ignorado com segurança, nunca lança). A contagem TOTAL ativa nunca pode
 * ultrapassar o limite por causa desta escrita: reconciliação só alterna active<->preserved entre
 * documentos JÁ existentes, nunca cria nenhum — quem impede exceder o limite é o próprio comando de
 * criação (assertWithinLimit em server/plan-authoritative-mutations.ts, inalterado por este ticket), que
 * lê a contagem TOTAL atual antes de qualquer novo Product/Service. Uma leitura ligeiramente desatualizada
 * aqui só poderia, no pior caso, preservar/ativar um documento "diferente do ideal" nesta reconciliação —
 * autocorrigido no próximo replay (idempotente) — nunca ultrapassar o limite.
 */
async function applyChangesTransactional(db: Firestore, uid: string, domain: DomainName, changes: readonly PlannedChange[]): Promise<void> {
  if (changes.length === 0) return;
  await db.runTransaction(async (tx: Transaction) => {
    const refs = changes.map((change) => db.collection("users").doc(uid).collection(domain).doc(change.id));
    const snaps = await tx.getAll(...refs);
    for (let i = 0; i < changes.length; i += 1) {
      if (!snaps[i].exists) continue;
      tx.update(refs[i], { planAccessState: changes[i].target, ...changes[i].extra });
    }
  });
}

/**
 * PLAN-IMPL-02B1 §23/§24 — fallback para tenants grandes demais para uma única transação (>400
 * mutações): chunks sequenciais de `db.batch()` (mesmo mecanismo já usado no repo — server/routes.ts,
 * server/mercadopago-connections.ts —, só que em loop). Cada chunk é atômico em si; ENTRE chunks não é
 * atômico — por isso o status doc em reconcilePlanAccess: uma falha no meio marca "failed" e propaga o
 * erro (nunca deixa o restante em estado incoerente sem sinalização), e um novo replay com os mesmos
 * argumentos é sempre seguro — recalcula do zero e só reenvia o que ainda não convergiu.
 */
async function applyChangesChunked(db: Firestore, uid: string, domain: DomainName, changes: readonly PlannedChange[]): Promise<void> {
  if (changes.length === 0) return;
  const chunks = chunkList(changes, CHUNK_SIZE);
  for (const group of chunks) {
    const batch = db.batch();
    for (const change of group) {
      batch.update(db.collection("users").doc(uid).collection(domain).doc(change.id), { planAccessState: change.target, ...change.extra });
    }
    await batch.commit();
  }
}

/**
 * PLAN-IMPL-02B2 §11 — exportada para setActiveProductSelection/setActiveServiceSelection
 * (server/plan-access-selection.ts) reusarem a MESMA estratégia segura de escrita (transação para poucos
 * documentos afetados, chunks de `db.batch()` para tenants grandes) em vez de uma segunda implementação
 * incompatível — exatamente o que o ticket pede ("reutilizar a estratégia segura do B1").
 */
export async function applyDomainChanges(db: Firestore, uid: string, domain: DomainName, changes: readonly PlannedChange[]): Promise<void> {
  if (changes.length <= TRANSACTION_SAFE_MUTATION_THRESHOLD) {
    await applyChangesTransactional(db, uid, domain, changes);
  } else {
    await applyChangesChunked(db, uid, domain, changes);
  }
}

/**
 * PLAN-IMPL-02B1 §7/§20 — engine canônico único para downgrade, upgrade e replay no mesmo plano.
 * `previousPlan` não participa do CÁLCULO (o alvo é sempre função só de `newPlan` + documentos atuais —
 * é isso que torna a função idempotente e reutilizável para as três transições sem lógica duplicada) —
 * existe no contrato de entrada (§7 do ticket) só para contexto/observabilidade (log ao final).
 *
 * NUNCA apaga ou cria Product/Service — só alterna `planAccessState` em documentos já existentes.
 * Clients NUNCA são tocados aqui (§26 do ticket — histórico de clientes nunca é dividido em active/
 * preserved, só a criação de novos continua bloqueada acima do limite, comportamento já existente desde
 * PLAN-IMPL-02A e inalterado por este arquivo).
 */
export async function reconcilePlanAccess(
  db: Firestore,
  uid: string,
  previousPlan: PlanType,
  newPlan: PlanType,
): Promise<PlanAccessReconciliationResult> {
  const limits = PLAN_CONFIG[newPlan].limits;
  const [productDocs, serviceDocs] = await Promise.all([
    fetchAllDocs(db, uid, "products"),
    fetchAllDocs(db, uid, "services"),
  ]);

  const productsPlan = planDomainChanges(productDocs, limits.products, toProductCandidate);
  const servicesPlan = planDomainChanges(serviceDocs, limits.services, toServiceCandidate);

  // §24 — status de reconciliação só existe quando pelo menos um domínio realmente precisa do caminho em
  // chunks (múltiplas operações não-atômicas). Para o caso comum (poucos documentos afetados, cabe numa
  // transação só), nenhum status é escrito — nada a overengineer para conjuntos pequenos.
  const isLargeRun = productsPlan.changes.length > TRANSACTION_SAFE_MUTATION_THRESHOLD
    || servicesPlan.changes.length > TRANSACTION_SAFE_MUTATION_THRESHOLD;
  const statusRef = isLargeRun ? reconciliationStatusRef(db, uid) : null;

  if (statusRef) {
    await statusRef.set({ status: "running", previousPlan, newPlan, startedAt: new Date().toISOString() });
  }
  try {
    await applyDomainChanges(db, uid, "products", productsPlan.changes);
    await applyDomainChanges(db, uid, "services", servicesPlan.changes);
  } catch (error) {
    logError("plan_access_reconciliation.run_failed", error, { uid, previousPlan, newPlan });
    if (statusRef) {
      await statusRef.set({
        status: "failed",
        failedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      }, { merge: true }).catch(() => {});
    }
    throw error;
  }
  if (statusRef) {
    await statusRef.set({ status: "completed", completedAt: new Date().toISOString() }, { merge: true });
  }

  if (productsPlan.changes.length > 0 || servicesPlan.changes.length > 0) {
    logInfo("plan_access_reconciliation.applied", {
      uid, previousPlan, newPlan,
      productsChanged: productsPlan.changes.length, servicesChanged: servicesPlan.changes.length,
    });
  }

  return {
    products: productsPlan.result,
    services: servicesPlan.result,
    selectionRequired: productsPlan.result.preserved > 0 || servicesPlan.result.preserved > 0,
  };
}
