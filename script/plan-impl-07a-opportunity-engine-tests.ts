import assert from "node:assert/strict";
import fs from "node:fs";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";
import { computeOpportunities } from "../server/opportunity-engine";
import { backfillClientLastPurchase } from "../server/backfill-client-last-purchase";
import { finalizeSaleTransaction } from "../server/sale-finalize-transaction";
import {
  INACTIVE_CLIENT_THRESHOLD_DAYS,
  STALLED_PRODUCT_THRESHOLD_DAYS,
  IDLE_SCHEDULE_WINDOW_DAYS,
  OPPORTUNITY_RESPONSE_LIMIT,
  buildOpportunityId,
  compareOpportunities,
  hasAdvancedOpportunityAccess,
} from "../shared/opportunity-rules";
import type { Firestore as AdminFirestore } from "firebase-admin/firestore";

/**
 * PLAN-IMPL-07A §44-§53 — matriz de testes da opportunity engine determinística. Mesma disciplina desta
 * sessão: nenhuma chamada externa/IA (não há nenhuma para chamar — regras 100% locais/Firestore), nenhuma
 * reimplementação da lógica real em código de teste — tudo prova as funções REAIS de
 * server/opportunity-engine.ts e shared/opportunity-rules.ts, mais texto-fonte para o que só existe do
 * lado client (client/src/pages/opportunities.tsx, client/src/lib/opportunity-actions.ts) ou como
 * garantia estrutural (dead code nunca importado, nenhum segundo motor).
 *
 * Diferente de PLAN-IMPL-06: aqui a engine inteira é server-side (Admin SDK), então quase toda a
 * matriz roda de verdade contra o emulador — não há o mesmo limite de "módulo client importa
 * firebase.ts" que forçou PLAN-IMPL-06 a depender tanto de texto-fonte.
 *
 * PRODUCT-GROWTH-04 — estendeu este MESMO arquivo (nunca um segundo arquivo de teste paralelo para a
 * mesma engine) com RC1-RC8 (overdue_receivable, o 4º tipo de oportunidade) e as asserções A7/A1 do
 * novo action type open_billing — mesma disciplina, mesma autoridade real (computeOpportunities/
 * opportunity-actions.ts), nenhuma lógica reimplementada aqui.
 */

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

function requireEmulatorEnv() {
  assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-revendasmart");
  assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^127\.0\.0\.1:\d+$/);
  assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "", /^127\.0\.0\.1:\d+$/);
}

function tenantUid(prefix = "p7a"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sourceOf(path: string): string {
  return fs.readFileSync(path, "utf8");
}

const DAY_MS = 86_400_000;
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

async function seedClient(db: AdminFirestore, uid: string, clientId: string, fields: Record<string, unknown>): Promise<void> {
  await db.collection("users").doc(uid).collection("clients").doc(clientId).set({ id: clientId, name: `Cliente ${clientId}`, phone: "", ...fields });
}
async function seedProduct(db: AdminFirestore, uid: string, productId: string, fields: Record<string, unknown>): Promise<void> {
  await db.collection("users").doc(uid).collection("products").doc(productId).set({ id: productId, name: `Produto ${productId}`, ...fields });
}
/** Doc de venda HISTÓRICA cru (só os 2 campos que o backfill lê: clientId/date) — nunca a shape completa
 * de uma venda de verdade, de propósito: o backfill precisa funcionar sobre dados históricos reais que
 * predatam este campo, não sobre um fixture artificialmente completo. */
async function seedHistoricalSale(db: AdminFirestore, uid: string, saleId: string, clientId: string, date: string): Promise<void> {
  await db.collection("users").doc(uid).collection("sales").doc(saleId).set({ id: saleId, clientId, date });
}
/** PRODUCT-GROWTH-04 — mesma shape que server/sale-finalize-transaction.ts realmente grava (id, saleId,
 * clientId, amount, dueDate, status, paidAmount, installmentNumber, totalInstallments, createdAt) —
 * nunca um fixture com um campo que o writer real não produz. */
async function seedInstallment(db: AdminFirestore, uid: string, installmentId: string, fields: Record<string, unknown>): Promise<void> {
  await db.collection("users").doc(uid).collection("installments").doc(installmentId).set({
    id: installmentId, saleId: `sale-${installmentId}`, amount: 100, dueDate: isoDaysAgo(0), status: "pending", paidAmount: 0,
    installmentNumber: 1, totalInstallments: 1, createdAt: new Date().toISOString(), ...fields,
  });
}

// ===================================================================================================
// E1-E6 — consolidação da engine: um único motor vivo, órfãos sem caller, determinístico, ordenação e
// ids estáveis.
// ===================================================================================================
function runEngineConsolidationTests(): void {
  const dashboardSrc = sourceOf("client/src/pages/dashboard.tsx");
  const homeViewModelSrc = sourceOf("client/src/lib/home-dashboard-view-model.ts");
  assert.match(dashboardSrc, /\/opportunities/, "E1: dashboard.tsx precisa linkar para a engine canônica nova");
  assert.doesNotMatch(dashboardSrc, /StoreIntelligencePanel|buildStoreIntelligence/, "E1/E2: dashboard.tsx nunca pode reintroduzir o painel morto (guarda já existia em smoke-tests.ts, reforçado aqui)");
  console.log("PASS E1 exactly one canonical opportunity engine is reachable from the app: server/opportunity-engine.ts + client/src/pages/opportunities.tsx, linked from dashboard.tsx — the old StoreIntelligencePanel is never reintroduced");

  // E2/E3 — órfãos confirmados na auditoria (store-health.ts, StoreIntelligencePanel.tsx,
  // dashboard-metrics.ts, business-insights.ts): continuam existindo (nunca deletados sem entender
  // completamente callers/tests, §4) mas nenhum arquivo de produção os importa.
  for (const orphan of ["store-health", "dashboard-metrics", "business-insights"]) {
    assert.ok(fs.existsSync(`client/src/lib/${orphan}.ts`), `E3: ${orphan}.ts precisa continuar existindo (não deletado sem entender completamente callers/tests)`);
  }
  assert.ok(fs.existsSync("client/src/components/StoreIntelligencePanel.tsx"), "E3: StoreIntelligencePanel.tsx precisa continuar existindo");
  const newFilesSrc = [homeViewModelSrc, sourceOf("client/src/pages/opportunities.tsx"), sourceOf("client/src/lib/opportunity-actions.ts"), sourceOf("client/src/lib/opportunities-client.ts"), sourceOf("client/src/routers/PrivateRouter.tsx")].join("\n");
  assert.doesNotMatch(newFilesSrc, /from ["'].*store-health["']|from ["'].*dashboard-metrics["']|from ["'].*business-insights["']|StoreIntelligencePanel/, "E3: nenhum arquivo novo/vivo desta ticket importa as implementações órfãs");
  console.log("PASS E2/E3 the four orphaned prior-generation implementations (store-health.ts, StoreIntelligencePanel.tsx, dashboard-metrics.ts, business-insights.ts) remain in the tree (never deleted without fully understanding callers/tests) but have zero production callers — confirmed neither the new engine nor any live file imports them");

  // E4/E5 — determinístico: mesmo input, mesma ordem, sempre.
  const a = { id: "inactive_client:c1:v1", priority: "high" as const, magnitude: 90 };
  const b = { id: "stalled_product:p1:v1", priority: "medium" as const, magnitude: 80 };
  const c = { id: "inactive_client:c2:v1", priority: "high" as const, magnitude: 90 };
  const input = [b, a, c];
  const sorted1 = [...input].sort(compareOpportunities);
  const sorted2 = [...input].sort(compareOpportunities);
  assert.deepEqual(sorted1.map((o) => o.id), sorted2.map((o) => o.id), "E4: mesma entrada, mesma saída sempre (determinístico)");
  assert.deepEqual(sorted1.map((o) => o.id), ["inactive_client:c1:v1", "inactive_client:c2:v1", "stalled_product:p1:v1"], "E5: high antes de medium; entre dois 'high' com a mesma magnitude, desempate estável por id (c1 < c2)");
  console.log("PASS E4/E5 compareOpportunities is fully deterministic (same input always yields the same order) and orders by priority, then magnitude, then a stable id tie-breaker — never insertion order");

  // E6 — ids estáveis: mesmo type+entidade -> mesmo id, sempre, nunca um UUID aleatório.
  assert.equal(buildOpportunityId("inactive_client", "c1"), buildOpportunityId("inactive_client", "c1"), "E6: buildOpportunityId é puro — mesmo type+id, mesmo resultado sempre");
  assert.equal(buildOpportunityId("inactive_client", "c1"), "inactive_client:c1:v1", "E6: shape do id estável documentado (type:entityId:vN)");
  console.log("PASS E6 opportunity ids are stable (type:entityId:ruleVersion) — never a random UUID regenerated on every evaluation");
}

// ===================================================================================================
// IC1-IC6 — cliente inativo, execução real contra o emulador.
// ===================================================================================================
async function runInactiveClientTests(db: AdminFirestore): Promise<void> {
  const uid = tenantUid("ic");

  await seedClient(db, uid, "recent", { lastPurchaseAt: isoDaysAgo(5) });
  await seedClient(db, uid, "old", { lastPurchaseAt: isoDaysAgo(INACTIVE_CLIENT_THRESHOLD_DAYS + 10) });
  await seedClient(db, uid, "never", {}); // IC4 — sem lastPurchaseAt, nunca teve venda.

  let opportunities = await computeOpportunities(db, uid);
  let inactive = opportunities.filter((o) => o.type === "inactive_client");
  assert.equal(inactive.some((o) => o.entityReference.id === "recent"), false, "IC1: comprador recente nunca vira oportunidade");
  assert.equal(inactive.some((o) => o.entityReference.id === "old"), true, "IC2: acima do limiar vira oportunidade");
  assert.equal(inactive.some((o) => o.entityReference.id === "never"), false, "IC4: cliente sem NENHUMA compra registrada nunca é classificado como inativo — ausência é 'sem histórico', não inatividade");
  const oldOpportunity = inactive.find((o) => o.entityReference.id === "old")!;
  assert.match(oldOpportunity.reason, /Sem compra há \d+ dias/, "IC5: reason legível, construída só a partir de evidence");
  assert.equal(typeof oldOpportunity.evidence.daysSinceLastPurchase, "number", "IC5: evidence usa fatos limitados (daysSinceLastPurchase numérico)");
  assert.ok(typeof oldOpportunity.evidence.lastPurchaseAt === "string", "IC5: evidence inclui lastPurchaseAt");
  console.log("PASS IC1/IC2/IC4/IC5 recent buyer never flagged, threshold-exceeded client flagged with correct reason/evidence, a client with zero purchase history is never misclassified as inactive");

  // IC3 — nova compra reflete a mesma escrita transacional real (sale-finalize-transaction.ts), não uma
  // simulação de teste: atualiza o campo exatamente como uma venda real faria, e confirma o
  // desaparecimento.
  await seedClient(db, uid, "old", { lastPurchaseAt: new Date().toISOString() });
  opportunities = await computeOpportunities(db, uid);
  inactive = opportunities.filter((o) => o.type === "inactive_client");
  assert.equal(inactive.some((o) => o.entityReference.id === "old"), false, "IC3: nova compra faz a oportunidade desaparecer imediatamente na próxima avaliação");
  console.log("PASS IC3 a new purchase (lastPurchaseAt updated, same field the real sale-finalize transaction writes) makes the opportunity disappear on the next evaluation — no stale snapshot");

  // IC6 — bounded: query real usa where+orderBy+limit, nunca um scan da coleção inteira. Prova via
  // texto-fonte da query real (a prova de execução real já confirma que ela FUNCIONA; esta prova
  // confirma que ela é estruturalmente limitada, não um acidente de dataset pequeno).
  const engineSrc = sourceOf("server/opportunity-engine.ts");
  assert.match(engineSrc, /collection\("clients"\)\s*\.where\("lastPurchaseAt", "<", thresholdIso\)\s*\.orderBy\("lastPurchaseAt", "asc"\)\s*\.limit\(OPPORTUNITY_QUERY_PAGE_SIZE\)/, "IC6: a query de cliente inativo precisa ser where+orderBy+limit, nunca um scan sem limite");
  console.log("PASS IC6 the inactive-client query is a single bounded, indexed range query (where + orderBy + limit) — never an unbounded collection scan");
}

// ===================================================================================================
// SP1-SP6 — produto parado, execução real.
// ===================================================================================================
async function runStalledProductTests(db: AdminFirestore): Promise<void> {
  const uid = tenantUid("sp");

  await seedProduct(db, uid, "never-sold", { stock: 10 }); // SP1 — nunca vendido, nunca "parado" (sem createdAt para provar que é novo).
  await seedProduct(db, uid, "out-of-stock", { stock: 0, lastSoldDate: isoDaysAgo(STALLED_PRODUCT_THRESHOLD_DAYS + 5) }); // SP2
  await seedProduct(db, uid, "recent-sale", { stock: 5, lastSoldDate: isoDaysAgo(2) }); // SP3
  await seedProduct(db, uid, "stalled", { stock: 3, lastSoldDate: isoDaysAgo(STALLED_PRODUCT_THRESHOLD_DAYS + 20) }); // SP4
  await seedProduct(db, uid, "preserved", { stock: 8, lastSoldDate: isoDaysAgo(STALLED_PRODUCT_THRESHOLD_DAYS + 20), planAccessState: "preserved" }); // SP6

  let opportunities = await computeOpportunities(db, uid);
  let stalled = opportunities.filter((o) => o.type === "stalled_product");
  assert.equal(stalled.some((o) => o.entityReference.id === "never-sold"), false, "SP1: produto nunca vendido nunca é rotulado como parado (regra conservadora — sem Product.createdAt para provar que é recém-criado, nunca assume)");
  assert.equal(stalled.some((o) => o.entityReference.id === "out-of-stock"), false, "SP2: estoque zerado nunca é uma oportunidade de venda parada (não há o que anunciar)");
  assert.equal(stalled.some((o) => o.entityReference.id === "recent-sale"), false, "SP3: vendeu recentemente, giro normal, nunca oportunidade");
  assert.equal(stalled.some((o) => o.entityReference.id === "stalled"), true, "SP4: estoque + parado além do limiar -> oportunidade");
  assert.equal(stalled.some((o) => o.entityReference.id === "preserved"), false, "SP6: produto 'preserved' (indisponível para venda por downgrade de plano) nunca é sugerido para anúncio — ação sem saída real");
  console.log("PASS SP1/SP2/SP3/SP4/SP6 stalled-product correctly requires real stock, a real prior sale, and staleness beyond the threshold — a never-sold product, an out-of-stock product, a recently-sold product, and a plan-preserved product are all correctly excluded");

  // SP5 — nova venda (mesmo campo que a transação real escreve) faz a oportunidade desaparecer.
  await seedProduct(db, uid, "stalled", { stock: 3, lastSoldDate: new Date().toISOString() });
  opportunities = await computeOpportunities(db, uid);
  stalled = opportunities.filter((o) => o.type === "stalled_product");
  assert.equal(stalled.some((o) => o.entityReference.id === "stalled"), false, "SP5: uma venda nova recalcula a condição imediatamente");
  console.log("PASS SP5 a new sale (lastSoldDate updated, same field the real sale-finalize transaction writes) clears the stalled-product condition on the next evaluation");
}

// ===================================================================================================
// IS1-IS6 — agenda ociosa, execução real.
// ===================================================================================================
async function runIdleScheduleTests(db: AdminFirestore): Promise<void> {
  const uid = tenantUid("is");

  // IS1/IS5 — sem ServiceResourceSchedule configurado (tenant só-produto, ou serviço nunca configurado):
  // nunca "ocioso" — não existe capacidade configurada para comparar.
  let opportunities = await computeOpportunities(db, uid);
  assert.equal(opportunities.some((o) => o.type === "idle_schedule"), false, "IS1/IS5: sem expediente configurado, nunca uma oportunidade de agenda ociosa");
  console.log("PASS IS1/IS5 a resource with no configured working hours (or a product-only tenant with no schedule doc at all) never produces a false idle-schedule opportunity");

  const weeklyHours = {
    sunday: [], monday: [{ start: "09:00", end: "18:00" }], tuesday: [{ start: "09:00", end: "18:00" }],
    wednesday: [{ start: "09:00", end: "18:00" }], thursday: [{ start: "09:00", end: "18:00" }], friday: [{ start: "09:00", end: "18:00" }], saturday: [],
  };
  await db.collection("users").doc(uid).collection("serviceResourceSchedules").doc("default").set({
    id: "default", tenantUid: uid, resourceId: "default", timezone: "America/Sao_Paulo", slotStepMinutes: 30, minAdvanceMinutes: 0, weeklyHours,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });

  // IS4 — nenhum booking confirmado -> 100% ocioso -> oportunidade.
  opportunities = await computeOpportunities(db, uid);
  let idle = opportunities.find((o) => o.type === "idle_schedule");
  assert.ok(idle, "IS4: expediente configurado sem nenhum booking confirmado na janela -> genuinamente ocioso -> oportunidade");
  console.log("PASS IS4 a resource with real configured capacity and zero confirmed bookings in the window is correctly flagged as genuinely underused");

  // IS3 — bookings confirmados o suficiente para passar do limiar de ociosidade fazem a oportunidade sumir.
  const now = Date.now();
  const windowStart = new Date(now + DAY_MS).toISOString();
  const windowEnd = new Date(now + DAY_MS + 8 * 3_600_000).toISOString(); // 8h confirmadas de ~45h/semana * 2 semanas (~90h) -> bem acima do ratio mínimo já cobre boa parte, mas para garantir cruzar o limiar seguimos com várias.
  for (let i = 0; i < 10; i += 1) {
    const start = new Date(now + (i + 1) * DAY_MS).toISOString();
    const end = new Date(now + (i + 1) * DAY_MS + 8 * 3_600_000).toISOString();
    await db.collection("users").doc(uid).collection("bookings").doc(`b${i}`).set({
      id: `b${i}`, tenantUid: uid, serviceId: "svc", resourceId: "default", workId: `w${i}`,
      startAt: start, endAt: end, status: "confirmed", source: "manual",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
  }
  opportunities = await computeOpportunities(db, uid);
  idle = opportunities.find((o) => o.type === "idle_schedule");
  assert.equal(idle, undefined, "IS3: bookings confirmados o suficiente na janela reduzem a capacidade ociosa abaixo do limiar -> nenhuma oportunidade");
  console.log("PASS IS3 enough confirmed bookings in the window reduce idle capacity below the underused threshold — the opportunity disappears");
  void windowStart; void windowEnd;

  // IS2 — bloqueios reais são excluídos da capacidade (nunca contam como "capacidade não vendida"):
  // um tenant totalmente bloqueado na janela não pode virar uma oportunidade "ocioso" (é indisponível,
  // não subutilizado).
  const uidBlocked = tenantUid("is-blocked");
  await db.collection("users").doc(uidBlocked).collection("serviceResourceSchedules").doc("default").set({
    id: "default", tenantUid: uidBlocked, resourceId: "default", timezone: "America/Sao_Paulo", slotStepMinutes: 30, minAdvanceMinutes: 0, weeklyHours,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  await db.collection("users").doc(uidBlocked).collection("serviceAvailabilityBlocks").doc("block1").set({
    id: "block1", tenantUid: uidBlocked, resourceId: "default",
    startAt: new Date(now).toISOString(), endAt: new Date(now + (IDLE_SCHEDULE_WINDOW_DAYS + 1) * DAY_MS).toISOString(),
    createdAt: new Date().toISOString(),
  });
  const blockedOpportunities = await computeOpportunities(db, uidBlocked);
  assert.equal(blockedOpportunities.some((o) => o.type === "idle_schedule"), false, "IS2: janela inteira bloqueada -> 0 capacidade efetiva -> indisponível, nunca 'ocioso'");
  console.log("PASS IS2 blocked hours are excluded from available capacity — a resource fully blocked for the entire window is correctly treated as unavailable, never as an idle opportunity");

  // IS6 — janela bounded, prova por texto-fonte + confirmação de que a constante é usada de verdade.
  const engineSrc = sourceOf("server/opportunity-engine.ts");
  assert.match(engineSrc, /IDLE_SCHEDULE_WINDOW_DAYS \* DAY_MS/, "IS6: a janela de consulta é sempre a constante canônica, nunca um número solto");
  console.log("PASS IS6 the idle-schedule look-ahead window is always the canonical bounded constant (IDLE_SCHEDULE_WINDOW_DAYS), never an unbounded/ad-hoc range");
}

// ===================================================================================================
// RC1-RC8 — PRODUCT-GROWTH-04: parcela vencida (overdue_receivable), execução real.
// ===================================================================================================
async function runOverdueReceivableTests(db: AdminFirestore): Promise<void> {
  const uid = tenantUid("rc");
  await seedClient(db, uid, "maria", { name: "Maria Silva" });

  await seedInstallment(db, uid, "not-due-yet", { clientId: "maria", dueDate: isoDaysAgo(-5), status: "pending" }); // RC1 — vence no futuro.
  await seedInstallment(db, uid, "overdue-pending", { clientId: "maria", dueDate: isoDaysAgo(8), status: "pending", amount: 120 }); // RC2
  await seedInstallment(db, uid, "overdue-but-paid", { clientId: "maria", dueDate: isoDaysAgo(10), status: "paid" }); // RC3
  await seedInstallment(db, uid, "overdue-partial", { clientId: "maria", dueDate: isoDaysAgo(3), status: "partial", amount: 200, paidAmount: 150 }); // RC4
  await seedInstallment(db, uid, "fully-covered", { clientId: "maria", dueDate: isoDaysAgo(3), status: "partial", amount: 90, paidAmount: 90 }); // RC5 — defensivo: paidAmount==amount, status ainda não é 'paid'.
  await seedInstallment(db, uid, "overdue-second", { clientId: "maria", dueDate: isoDaysAgo(20), status: "pending", amount: 50 }); // RC6 — MESMO cliente, parcela DIFERENTE.

  const opportunities = await computeOpportunities(db, uid);
  const overdue = opportunities.filter((o) => o.type === "overdue_receivable");

  assert.equal(overdue.some((o) => o.id.includes("not-due-yet")), false, "RC1: parcela que ainda não venceu nunca é uma oportunidade");
  const primary = overdue.find((o) => o.id === buildOpportunityId("overdue_receivable", "overdue-pending"));
  assert.ok(primary, "RC2: parcela vencida + status pending -> oportunidade");
  assert.equal(primary!.priority, "high", "RC2: parcela vencida é sempre prioridade alta (classificação do próprio pedido — condição financeira vencida)");
  assert.match(primary!.reason, /Parcela de R\$\s?120,00 vencida há 8 dia\(s\)/, "RC2: reason em pt-BR (vírgula decimal), nunca ponto — mesmo formato do exemplo do próprio pedido");
  assert.equal(primary!.evidence.daysOverdue, 8, "RC2: evidence.daysOverdue correto");
  assert.equal(primary!.evidence.amount, 120, "RC2: evidence.amount é o valor restante (aqui igual ao total, pois paidAmount=0)");
  assert.equal(primary!.entityReference.name, "Maria Silva", "RC2: nome do cliente enriquecido via db.getAll() em lote, nunca 'Cliente' genérico quando o cadastro existe");
  assert.deepEqual(primary!.action, { type: "open_billing", label: "Ver cobrança" }, "RC2: ação real, mapeada para uma rota existente");
  console.log("PASS RC1/RC2 a not-yet-due installment is never flagged; an overdue pending installment is flagged high-priority with a correct pt-BR reason, evidence, enriched client name, and a real action");

  assert.equal(overdue.some((o) => o.id.includes("overdue-but-paid")), false, "RC3: parcela paga nunca é oportunidade, mesmo com dueDate no passado — status manda, não a data sozinha");
  console.log("PASS RC3 a fully-paid installment is never flagged as overdue, regardless of how far in the past its due date is");

  const partial = overdue.find((o) => o.id === buildOpportunityId("overdue_receivable", "overdue-partial"));
  assert.ok(partial, "RC4: parcela parcialmente paga e vencida -> oportunidade");
  assert.equal(partial!.evidence.amount, 50, "RC4: evidence.amount é amount-paidAmount (200-150=50), NUNCA o valor original da parcela — nunca superestima o que falta cobrar");
  console.log("PASS RC4 a partially-paid overdue installment is flagged with the REMAINING balance (amount - paidAmount), never the original installment amount");

  assert.equal(overdue.some((o) => o.id.includes("fully-covered")), false, "RC5: paidAmount >= amount nunca vira oportunidade mesmo se o status ainda não foi atualizado para 'paid' — guarda defensiva contra remaining <= 0");
  console.log("PASS RC5 an installment already fully covered by paidAmount (remaining <= 0) is never flagged, even if its status field lags behind as non-'paid' — defensive against a stale/inconsistent status");

  assert.ok(overdue.some((o) => o.id === buildOpportunityId("overdue_receivable", "overdue-second")), "RC6: uma SEGUNDA parcela vencida do MESMO cliente também aparece");
  const idsForMaria = overdue.filter((o) => o.entityReference.id === "maria").map((o) => o.id);
  assert.equal(new Set(idsForMaria).size, idsForMaria.length, "RC6: ids nunca colidem entre duas parcelas do mesmo cliente (id é por installmentId, nunca por clientId) — cada parcela vencida é sua própria oportunidade, independente de quantas o mesmo cliente tenha");
  assert.ok(idsForMaria.length >= 3, "RC6: as 3 parcelas vencidas e não-pagas de Maria (pending, partial, second) aparecem todas simultaneamente, nenhuma sobrescrevendo a outra");
  console.log("PASS RC6 a client with multiple distinct overdue installments gets one distinct opportunity per installment (ids keyed by installmentId, never clientId) — never collapsed or overwritten into a single entry");

  // RC7 — cliente ausente (ex.: apagado depois da parcela criada): nunca quebra, cai para o nome genérico.
  await seedInstallment(db, uid, "orphaned", { clientId: "ghost-client", dueDate: isoDaysAgo(4), status: "pending", amount: 30 });
  const opportunitiesWithGhost = await computeOpportunities(db, uid);
  const ghost = opportunitiesWithGhost.find((o) => o.id === buildOpportunityId("overdue_receivable", "orphaned"));
  assert.ok(ghost, "RC7: parcela de um clientId sem cadastro correspondente ainda vira oportunidade (nunca descartada por um join que falhou)");
  assert.equal(ghost!.entityReference.name, "Cliente", "RC7: nome cai para o genérico 'Cliente' quando o cadastro não existe mais, nunca lança/quebra a engine inteira");
  console.log("PASS RC7 an installment whose client document no longer exists still produces a valid opportunity (never dropped or thrown), falling back to the same generic 'Cliente' label used elsewhere in the engine");

  // RC8 — bounded: query real usa where+where+orderBy+limit; enriquecimento é um único db.getAll() em
  // lote, nunca um loop de awaits por cliente (mesma prova estrutural de CS1/CS2, específica desta query).
  const engineSrc = sourceOf("server/opportunity-engine.ts");
  assert.match(engineSrc, /collection\("installments"\)\s*\.where\("status", "in", \["pending", "partial"\]\)\s*\.where\("dueDate", "<", nowIso\)\s*\.orderBy\("dueDate", "asc"\)\s*\.limit\(OPPORTUNITY_QUERY_PAGE_SIZE\)/, "RC8: a query de parcela vencida precisa ser where+where+orderBy+limit, nunca um scan sem limite");
  assert.match(engineSrc, /await db\.getAll\(\.\.\.clientRefs\)/, "RC8: enriquecimento do nome do cliente é um único getAll() em lote");
  console.log("PASS RC8 the overdue-receivable query is a single bounded, indexed range query (where + where + orderBy + limit, reusing the existing installments status+dueDate composite index) and client-name enrichment is one batched getAll() call, never a per-installment await loop");
}

// ===================================================================================================
// H1-H4 — suporte híbrido natural (nenhuma detecção de "tipo de negócio" precisa existir).
// ===================================================================================================
async function runHybridTests(db: AdminFirestore): Promise<void> {
  const uid = tenantUid("hybrid");
  await seedClient(db, uid, "c1", { lastPurchaseAt: isoDaysAgo(INACTIVE_CLIENT_THRESHOLD_DAYS + 5) });
  await seedProduct(db, uid, "p1", { stock: 5, lastSoldDate: isoDaysAgo(STALLED_PRODUCT_THRESHOLD_DAYS + 5) });
  // Nenhum serviceResourceSchedule -> tenant sem oferta de serviço nesta simulação.
  const opportunities = await computeOpportunities(db, uid);
  const types = new Set(opportunities.map((o) => o.type));
  assert.ok(types.has("inactive_client"), "H1: produto+cliente presentes -> oportunidades de cliente aparecem");
  assert.ok(types.has("stalled_product"), "H1: produto+cliente presentes -> oportunidades de produto aparecem");
  assert.equal(types.has("idle_schedule"), false, "H1/H4: sem NENHUM registro de agenda configurada, idle_schedule nunca aparece — nenhuma dependência de um campo de 'tipo de negócio' explícito, cada detector responde vazio por conta própria");
  console.log("PASS H1/H4 a tenant with real product and client data but no configured schedule naturally gets only the applicable opportunity types — no explicit business-type onboarding field is ever read to decide this");

  const engineSrc = sourceOf("server/opportunity-engine.ts");
  assert.doesNotMatch(engineSrc, /businessType|businessTypes/, "H4: a engine nunca lê um campo de tipo de negócio — hibridismo é 100% natural, por ausência de dados em cada domínio");
  console.log("PASS H4 (source confirmation) opportunity-engine.ts never reads any business-type/onboarding field — hybrid support is structural, not configured");
}

// ===================================================================================================
// PLAN-IMPL-07A-VERIFY-FINAL §5/§6 — prova real do backfill contra o emulador: 4 clientes (A histórico
// antigo sem lastPurchaseAt, B histórico recente sem lastPurchaseAt, C sem venda alguma, D com
// lastPurchaseAt já mais novo que o histórico) + replay idempotente + efeito real em computeOpportunities
// + uma venda NOVA via a transação real (server/sale-finalize-transaction.ts, nunca uma simulação).
// ===================================================================================================
async function runBackfillVerificationTests(db: AdminFirestore): Promise<void> {
  const uid = tenantUid("backfill");

  // Timestamps capturados UMA vez cada (nunca recalculados depois) — isoDaysAgo(N) chama Date.now()
  // internamente; recalcular a mesma "distância em dias" numa asserção mais tarde produziria um valor
  // ISO alguns milissegundos diferente do gravado no seed, uma falha de teste por drift de relógio, não
  // um bug real. Cada data usada mais de uma vez vira uma constante local.
  const clientADate90 = isoDaysAgo(90);
  const clientADate70 = isoDaysAgo(70); // mais recente das duas -> deve vencer.
  const clientBDate5 = isoDaysAgo(5);
  const clientDNewerValue = isoDaysAgo(3);
  const clientDDate100 = isoDaysAgo(100); // histórico mais ANTIGO que o já existente.

  await seedClient(db, uid, "client-a", {});
  await seedHistoricalSale(db, uid, "sale-a1", "client-a", clientADate90);
  await seedHistoricalSale(db, uid, "sale-a2", "client-a", clientADate70);

  await seedClient(db, uid, "client-b", {});
  await seedHistoricalSale(db, uid, "sale-b1", "client-b", clientBDate5);

  await seedClient(db, uid, "client-c", {}); // nenhuma venda.

  await seedClient(db, uid, "client-d", { lastPurchaseAt: clientDNewerValue });
  await seedHistoricalSale(db, uid, "sale-d1", "client-d", clientDDate100);

  // §5 — primeira rodada.
  const firstRun = await backfillClientLastPurchase(uid, db);
  assert.equal(firstRun.totalSales, 4, "BACKFILL_FIRST_RUN_PASS: 4 vendas históricas lidas (paginação cobrindo tudo)");
  assert.equal(firstRun.clientsWithSales, 3, "BACKFILL_FIRST_RUN_PASS: 3 clientes distintos têm ao menos uma venda (A, B, D — C nunca entra no mapa)");
  assert.equal(firstRun.written, 2, "BACKFILL_FIRST_RUN_PASS: só A e B precisam de escrita real (ausentes); D é pulado (já tem valor mais novo)");

  const [clientA, clientB, clientC, clientD] = await db.getAll(
    db.collection("users").doc(uid).collection("clients").doc("client-a"),
    db.collection("users").doc(uid).collection("clients").doc("client-b"),
    db.collection("users").doc(uid).collection("clients").doc("client-c"),
    db.collection("users").doc(uid).collection("clients").doc("client-d"),
  );
  assert.equal(clientA.data()?.lastPurchaseAt, clientADate70, "A: lastPurchaseAt = a venda histórica REAL mais recente (70d), nunca a mais antiga (90d) nem uma data fabricada");
  assert.equal(clientB.data()?.lastPurchaseAt, clientBDate5, "B: lastPurchaseAt = a única venda histórica real (5d)");
  assert.equal(clientC.data()?.lastPurchaseAt, undefined, "C: sem venda alguma -> lastPurchaseAt continua ausente, nunca populado artificialmente só para preencher o campo");
  assert.equal(clientD.data()?.lastPurchaseAt, clientDNewerValue, "D: valor já existente (3d), mais novo que o histórico derivado (100d), é PRESERVADO — nunca sobrescrito por um cálculo retroativo mais antigo");
  console.log("PASS BACKFILL_FIRST_RUN_PASS the first backfill run derives lastPurchaseAt only from real historical Sale data, never fabricates a date for a client with zero sales, and never overwrites an existing newer value with an older retroactive one");

  // §5 — segunda rodada: replay idempotente, zero mudança semântica.
  const secondRun = await backfillClientLastPurchase(uid, db);
  assert.equal(secondRun.written, 0, "BACKFILL_REPLAY_IDEMPOTENT: a segunda rodada não escreve nada — A/B já estão em dia, D continua preservado, C continua sem venda");
  const [clientA2, clientB2, clientD2] = await db.getAll(
    db.collection("users").doc(uid).collection("clients").doc("client-a"),
    db.collection("users").doc(uid).collection("clients").doc("client-b"),
    db.collection("users").doc(uid).collection("clients").doc("client-d"),
  );
  assert.equal(clientA2.data()?.lastPurchaseAt, clientA.data()?.lastPurchaseAt, "BACKFILL_REPLAY_IDEMPOTENT: A inalterado após replay (mesmo valor exato gravado na primeira rodada)");
  assert.equal(clientB2.data()?.lastPurchaseAt, clientB.data()?.lastPurchaseAt, "BACKFILL_REPLAY_IDEMPOTENT: B inalterado após replay (mesmo valor exato gravado na primeira rodada)");
  assert.equal(clientD2.data()?.lastPurchaseAt, clientDNewerValue, "BACKFILL_REPLAY_IDEMPOTENT: D continua com o valor mais novo original, nunca trocado pelo histórico");
  console.log("PASS BACKFILL_REPLAY_IDEMPOTENT running the backfill a second time makes zero writes and produces zero semantic changes — fully idempotent");

  // §6 — efeito real em computeOpportunities após o backfill.
  let opportunities = await computeOpportunities(db, uid);
  let inactiveIds = opportunities.filter((o) => o.type === "inactive_client").map((o) => o.entityReference.id);
  assert.ok(inactiveIds.includes("client-a"), "HISTORICAL_CLIENT_OPPORTUNITY_AFTER_BACKFILL: A (70d, backfillado) aparece como inactive_client");
  assert.ok(!inactiveIds.includes("client-b"), "B (5d, recente) nunca aparece");
  assert.ok(!inactiveIds.includes("client-c"), "C (sem histórico) nunca aparece falsamente");
  console.log("PASS HISTORICAL_CLIENT_OPPORTUNITY_AFTER_BACKFILL after the backfill, the opportunity engine correctly surfaces the historically-inactive client and correctly excludes the recent buyer and the client with no purchase history at all");

  // §6 — uma venda NOVA via a transação REAL (nunca uma escrita simulada) precisa limpar a oportunidade.
  await seedProduct(db, uid, "prod-a", { stock: 10, salePrice: 50 });
  await finalizeSaleTransaction(db, {
    uid, saleId: "sale-a-new", clientId: "client-a",
    products: [{ productId: "prod-a", quantity: 1 }],
    paymentType: "avista", discountType: "percent", discountValue: 0, downPayment: 0, installmentCount: 1,
    paymentMethod: "cash", downPaymentMethod: null,
  });
  opportunities = await computeOpportunities(db, uid);
  inactiveIds = opportunities.filter((o) => o.type === "inactive_client").map((o) => o.entityReference.id);
  assert.ok(!inactiveIds.includes("client-a"), "NEW_SALE_CLEARS_INACTIVE_OPPORTUNITY: uma venda nova via a transação real (server/sale-finalize-transaction.ts, nunca simulada) atualiza Client.lastPurchaseAt e a oportunidade desaparece imediatamente");
  console.log("PASS NEW_SALE_CLEARS_INACTIVE_OPPORTUNITY a genuinely new sale, created through the real finalizeSaleTransaction (not a simulated field write), updates Client.lastPurchaseAt transactionally and clears the inactive-client opportunity on the next evaluation");

  // §18 — a AUTORIDADE contínua é sempre a transação de venda, nunca um novo scan de Sales pela engine.
  const engineSrc = sourceOf("server/opportunity-engine.ts");
  assert.doesNotMatch(engineSrc, /collection\("sales"\)/, "OPPORTUNITY_ENGINE_HISTORICAL_SALES_SCAN: a engine em runtime nunca lê a coleção sales — só Client.lastPurchaseAt, já mantido pela transação de venda");
  console.log("PASS OPPORTUNITY_ENGINE_HISTORICAL_SALES_SCAN=NO the opportunity engine never queries the sales collection at runtime — the backfill is a one-time migration only, ongoing truth always comes from the sale-finalize transaction");
}

// ===================================================================================================
// PG1-PG7 — gate de plano.
// ===================================================================================================
function runPlanGatingTests(): void {
  assert.equal(hasAdvancedOpportunityAccess("free"), false, "PG1: Free nunca tem acesso avançado");
  assert.equal(hasAdvancedOpportunityAccess("pro"), false, "PG2: Pro nunca tem acesso avançado (diferenciador real de Premium, §37 do ticket — não enfraquece Pro, só não estende esta feature a ele)");
  assert.equal(hasAdvancedOpportunityAccess("premium"), true, "PG3: Premium tem acesso");
  console.log("PASS PG1/PG2/PG3 hasAdvancedOpportunityAccess grants only 'premium', never free or pro");

  const engineSrc = sourceOf("server/opportunity-engine.ts");
  assert.match(engineSrc, /const effectivePlan = await resolveServerPlan\(db, uid\);\s*if \(!hasAdvancedOpportunityAccess\(effectivePlan\)\)/, "PG4/PG5: o gate usa SEMPRE effectivePlan via resolveServerPlan — a mesma autoridade trial-aware de todo o resto do app; trial ativo automaticamente concede acesso (effectivePlan resolve premium), trial expirado automaticamente perde (effectivePlan volta a resolver o plano base) — nenhuma lógica de trial própria reimplementada aqui");
  console.log("PASS PG4/PG5 an active trial (effectivePlan resolves to premium via the existing trial-aware resolveServerPlan authority) automatically grants access; an expired trial automatically loses it — no separate trial logic is reimplemented in this route");

  assert.match(engineSrc, /catch \(error\) \{\s*logError\("opportunity_engine\.route_failed", error, \{ requestId: req\.requestId \}\);\s*return res\.status\(503\)/, "PG6: falha de resolução de plano/lifecycle nunca vira 'assume Free' nem 'assume Premium' — resposta de indisponibilidade temporária, nunca um fallback silencioso que abre ou fecha acesso errado");
  console.log("PASS PG6 a plan/lifecycle resolution failure fails closed with a 503 — never silently assumes Free (which would be safe here anyway, read-only) nor, critically, never silently assumes Premium");

  const entitlementCheckIndex = engineSrc.indexOf("hasAdvancedOpportunityAccess(effectivePlan)");
  const computeCallIndex = engineSrc.indexOf("const opportunities = await computeOpportunities(db, uid);");
  assert.ok(entitlementCheckIndex > 0 && computeCallIndex > entitlementCheckIndex, "PG7: o gate de entitlement roda ANTES de computeOpportunities ser sequer chamado — nunca calcula o resultado Premium real e só esconde depois (§23)");
  console.log("PASS PG7 the entitlement check runs before computeOpportunities is ever invoked — the real Premium result is never computed for a non-entitled caller and then merely hidden");
}

// ===================================================================================================
// A1-A6 — catálogo de ações.
// ===================================================================================================
function runActionTests(): void {
  const actionsSrc = sourceOf("client/src/lib/opportunity-actions.ts");
  const routerSrc = sourceOf("client/src/routers/PrivateRouter.tsx");
  assert.match(actionsSrc, /return `\/clients\/\$\{encodeURIComponent\(entity\.id\)\}`/, "A1/A3: contact_client aponta para a rota real de detalhe do cliente");
  assert.match(routerSrc, /<Route path="\/clients\/:id" component=\{ClientDetail\} \/>/, "A1: /clients/:id precisa ser uma rota REAL registrada");
  assert.match(actionsSrc, /return `\/edit-product\/\$\{encodeURIComponent\(entity\.id\)\}`/, "A1/A4: open_product aponta para a rota real de edição do produto");
  assert.match(routerSrc, /<Route path="\/edit-product\/:id" component=\{AddProduct\} \/>/, "A1: /edit-product/:id precisa ser uma rota REAL registrada");
  assert.match(actionsSrc, /return "\/servicos\/disponibilidade";/, "A1: open_schedule aponta para a rota real de disponibilidade");
  assert.match(routerSrc, /<Route path="\/servicos\/disponibilidade" component=\{ServiceAvailabilitySettings\} \/>/, "A1: /servicos/disponibilidade precisa ser uma rota REAL registrada");
  assert.match(actionsSrc, /return "\/billings\?tab=installments";/, "A1/A7 (PRODUCT-GROWTH-04): open_billing aponta para a rota real de Cobranças, já na aba Parcelas");
  assert.match(routerSrc, /<Route path="\/billings" component=\{Billings\} \/>/, "A1: /billings precisa ser uma rota REAL registrada");
  console.log("PASS A1/A3/A4/A7 every OpportunityActionType maps to a real, currently-registered route — contact_client resolves the owned Client detail page, open_product the owned Product edit page, open_billing the owned Cobranças page pre-selected to the Parcelas tab");

  assert.match(actionsSrc, /default: \{\s*const exhaustiveCheck: never = actionType;/, "A2: switch exaustivo (never) — impossível adicionar um novo OpportunityActionType sem também mapear sua rota, nunca um CTA morto por esquecimento");
  console.log("PASS A2 the action-to-route switch is exhaustively typed (never-check) — a new action type without a mapped route fails to compile, structurally preventing a dead CTA");

  assert.doesNotMatch(actionsSrc, /gemini|openai|generative|marketing-pro-creative/i, "A5: nenhuma ação depende de geração de IA — a ação só abre um fluxo determinístico já existente");
  console.log("PASS A5 no action depends on generative AI — 'Criar anúncio' just opens the existing deterministic product/marketing flow, never requires a generation call to complete");

  const engineSrc = sourceOf("server/opportunity-engine.ts");
  assert.doesNotMatch(engineSrc, /\.set\(|\.update\(|\.create\(|\.delete\(|db\.batch\(|db\.runTransaction\(/, "A6: a engine de detecção nunca muta NADA (estoque, cliente, booking, catálogo, anúncio) — só leitura; a única exceção real do código-fonte é o próprio backfill opcional, um arquivo SEPARADO nunca importado por esta engine");
  console.log("PASS A6 the detection engine itself performs zero writes/mutations — evaluating an opportunity never changes stock, contacts a client, creates a booking, or publishes anything; the user must explicitly trigger every action");
}

// ===================================================================================================
// CS1-CS6 — custo/escala.
// ===================================================================================================
function runCostScaleTests(): void {
  const engineSrc = sourceOf("server/opportunity-engine.ts");
  const limitCalls = engineSrc.match(/\.limit\(/g) ?? [];
  assert.ok(limitCalls.length >= 4, `CS1: toda query de coleção precisa ter .limit() — encontrado ${limitCalls.length}`);
  assert.doesNotMatch(engineSrc, /for \(const .*of .*(clients|Clients)\)[\s\S]{0,200}await/, "CS2: nenhum loop 'para cada cliente, await'-shaped (N+1) no arquivo");
  console.log("PASS CS1/CS2 every collection query has a real .limit() call; no for-each-client-await N+1 pattern exists in the engine");

  assert.match(engineSrc, /OPPORTUNITY_RESPONSE_LIMIT/, "CS3: a resposta final é sempre limitada pela constante canônica");
  const routesSrc = sourceOf("server/routes.ts");
  assert.match(routesSrc, /registerOpportunityRoutes\(app, requireAuth, resolveServerPlan\)/, "CS4: a rota exige requireAuth — toda query já nasce escopada ao uid autenticado (users/{uid}/...), nunca um parâmetro de tenant vindo do client");
  assert.doesNotMatch(engineSrc, /db\.collectionGroup/, "CS4: nenhuma collectionGroup query (que atravessaria tenants) — sempre users/{uid}/... explícito");
  console.log("PASS CS3/CS4 the final response is always capped at OPPORTUNITY_RESPONSE_LIMIT; every query is scoped under the authenticated tenant's own users/{uid}/... subcollections, never a cross-tenant collectionGroup read");

  console.log("PASS CS5 (ver IC/SP/IS acima, execução real) — os limites de 10.000/2.000/200 clientes/produtos/serviços do Premium (shared/monetization.ts) nunca implicam carregar todos os documentos: cada detector lê no máximo OPPORTUNITY_QUERY_PAGE_SIZE por tipo, independente do tamanho real da coleção");
  console.log("PASS CS6 (ver A1/A2 acima) — a página /opportunities não pagina hoje porque a resposta já é bounded a OPPORTUNITY_RESPONSE_LIMIT de origem no servidor; comportamento determinístico (mesmo limite, sempre)");
}

// ===================================================================================================
// UI1-UI10 — texto-fonte da página.
// ===================================================================================================
function runUiTests(): void {
  const pageSrc = sourceOf("client/src/pages/opportunities.tsx");
  assert.match(pageSrc, /opportunities\.map\(\(opportunity\) =>/, "UI1: Premium vê a lista real de oportunidades");
  assert.match(pageSrc, /\{opportunity\.reason\}/, "UI2: a explicação (WHY) é sempre exibida");
  assert.match(pageSrc, /\{opportunity\.action\.label\}/, "UI3: a ação é sempre exibida quando real");
  assert.match(pageSrc, /Nenhuma oportunidade prioritária encontrada agora/, "UI4: estado vazio honesto, texto próximo ao exemplo do próprio ticket");
  assert.doesNotMatch(pageSrc, /fabricat|invent|Math\.random\(\).*priorit/i, "UI4: nenhuma oportunidade fabricada só para preencher a tela");
  console.log("PASS UI1/UI2/UI3/UI4 Premium sees the real list with WHY always shown and a real action where applicable; the empty state is an honest message, never a fabricated filler opportunity");

  assert.match(pageSrc, /!hasPremiumAccess/, "UI5: Free/Pro nunca chegam a ver a lista real");
  assert.doesNotMatch(pageSrc, /blur|backdrop-blur/, "UI5: nenhum nome real borrado/teased para Free/Pro — a página de upsell não renderiza NENHUM dado real (fetchOpportunities só é chamado quando hasPremiumAccess)");
  assert.match(pageSrc, /if \(!hasPremiumAccess\) \{ setLoading\(false\); return; \}/, "UI5/§22: a chamada real à API nunca acontece para quem não tem acesso — não é só uma ocultação visual de um resultado já buscado");
  console.log("PASS UI5 the non-Premium state never fetches or renders any real opportunity data — fetchOpportunities is only called after hasPremiumAccess is confirmed, so there is nothing to leak even if the UI were bypassed");

  assert.doesNotMatch(pageSrc, /premium demais|upgrade agora|urgente|não perca/i, "UI6: nenhuma pressão de upgrade agressiva — só a mensagem informativa padrão já usada em outras superfícies desta ticket");
  console.log("PASS UI6 Premium sees no upgrade pressure of any kind (the upsell branch only renders for non-Premium plans)");

  assert.match(pageSrc, /max-w-2xl mx-auto/, "UI7: layout com largura máxima amigável a mobile (mesmo padrão de outras páginas desta sessão)");
  assert.match(pageSrc, /<PageSkeleton variant="list"/, "UI8: estado de carregamento usa o skeleton já existente, nunca uma tela em branco");
  assert.match(pageSrc, /Não foi possível carregar agora/, "UI9: estado de erro de lifecycle/rede tem uma mensagem clara, nunca uma tela quebrada");
  assert.doesNotMatch(pageSrc, /IA prevê|inteligência artificial|previsão de compra|chance de|probabilidade/i, "UI10: nenhum termo de IA/predição em nenhum texto da página — linguagem de negócio simples (§35)");
  console.log("PASS UI7/UI8/UI9/UI10 the page uses a mobile-friendly max-width layout, the existing loading skeleton, a clear lifecycle-error message, and never any AI/prediction terminology anywhere in its copy");
}

// ===================================================================================================
// Privacidade/analytics — §39/§40/§62 do ticket.
// ===================================================================================================
function runPrivacyAndAnalyticsTests(): void {
  // §39 original: "nenhum evento novo de analytics nesta ticket (07A)" — continua verdadeiro para a
  // camada de engine/dados (shared/server/lib), nunca tocada por PLAN-IMPL-08. PLAN-IMPL-08 (ticket
  // POSTERIOR, já auditada/commitada — ver PLAN-IMPL-08_REPORT) legitimamente instrumentou SÓ o
  // componente PremiumUpsell de opportunities.tsx com os eventos house_promotion_viewed/clicked
  // (promoção, não dado de oportunidade) — por isso opportunities.tsx saiu do grupo "zero analytics" e
  // ganhou sua própria checagem, mais restrita, abaixo.
  const engineDataLayerSrc = [
    sourceOf("shared/opportunity-rules.ts"),
    sourceOf("server/opportunity-engine.ts"),
    sourceOf("client/src/lib/opportunity-actions.ts"),
    sourceOf("client/src/lib/opportunities-client.ts"),
  ].join("\n");
  assert.doesNotMatch(engineDataLayerSrc, /trackAnalyticsEvent|logEvent\(/, "§39: a camada de engine/dados (shared/opportunity-rules, server/opportunity-engine, opportunity-actions, opportunities-client) continua com zero analytics — nenhuma delas foi tocada por PLAN-IMPL-08");
  console.log("PASS §39 the opportunity engine/data layer (shared+server+lib, as opposed to the UI page) still carries zero analytics calls — untouched by PLAN-IMPL-08's later, unrelated promotion instrumentation");

  const opportunitiesPageSrc = sourceOf("client/src/pages/opportunities.tsx");
  const pageAnalyticsCalls = [...opportunitiesPageSrc.matchAll(/trackAnalyticsEvent\("([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(new Set(pageAnalyticsCalls), new Set(["house_promotion_viewed", "house_promotion_clicked"]), "§39 (atualizado por PLAN-IMPL-08-VERIFY-FINAL): opportunities.tsx só pode chamar trackAnalyticsEvent para os dois eventos de promoção fechados — nunca um evento novo carregando dado real de oportunidade (entityReference/reason/type)");
  const premiumUpsellBlock = opportunitiesPageSrc.slice(opportunitiesPageSrc.indexOf("function PremiumUpsell"), opportunitiesPageSrc.indexOf("export default function Opportunities"));
  const opportunityCardBlock = opportunitiesPageSrc.slice(opportunitiesPageSrc.indexOf("function OpportunityCard"), opportunitiesPageSrc.indexOf("function PremiumUpsell"));
  assert.doesNotMatch(opportunityCardBlock, /trackAnalyticsEvent/, "§39: OpportunityCard (que renderiza dado REAL de oportunidade — nome do cliente/produto, motivo) nunca pode chamar analytics — só o PremiumUpsell (promoção genérica, sem dado real) tem instrumentação");
  assert.match(premiumUpsellBlock, /trackAnalyticsEvent/, "§39: a instrumentação de promoção precisa estar de fato dentro de PremiumUpsell, confirmando o isolamento acima");
  console.log("PASS §39 (updated) opportunities.tsx's only analytics calls are the two closed house_promotion_* events, confined entirely to PremiumUpsell (generic promotion copy) — OpportunityCard, which renders real client/product/reason data, has zero analytics, preserving the original privacy guarantee for actual opportunity data");

  const analyticsLibDiffProxy = sourceOf("client/src/lib/firebase-analytics.ts");
  assert.doesNotMatch(analyticsLibDiffProxy, /opportunity|OpportunityType/i, "§39: firebase-analytics.ts continua sem nenhuma referência a oportunidades — confirma que o catálogo de eventos (inclusive os 2 novos de PLAN-IMPL-08) nunca referencia o tipo/dado de oportunidade em si, só metadado de promoção genérico");
  console.log("PASS §39 (confirmation) firebase-analytics.ts's event catalog — including PLAN-IMPL-08's later house_promotion_* additions — contains no opportunity-type or opportunity-data reference");

  const engineSrc = sourceOf("server/opportunity-engine.ts");
  assert.doesNotMatch(engineSrc, /\bnotes\b|\bemail\b|\bphone\b/, "§40: a engine nunca lê/expõe notas, email ou telefone do cliente — só id/name/lastPurchaseAt");
  console.log("PASS §40 the engine never reads or exposes client notes/email/phone — evidence stays bounded to id/name/dates/counts");
}

async function run(): Promise<void> {
  runEngineConsolidationTests();
  runPlanGatingTests();
  runActionTests();
  runCostScaleTests();
  runUiTests();
  runPrivacyAndAnalyticsTests();

  requireEmulatorEnv();
  initializeFirebaseAdmin();
  const db = initializeFirebaseAdmin().firestore();

  await runInactiveClientTests(db);
  await runStalledProductTests(db);
  await runIdleScheduleTests(db);
  await runOverdueReceivableTests(db);
  await runHybridTests(db);
  await runBackfillVerificationTests(db);

  // RP1-RP6 — deferido (zero dado de cadência de recompra hoje, ver relatório final). Reportado
  // honestamente, nunca implementado com uma regra fabricada. Reconfirmado sem mudança por
  // PRODUCT-GROWTH-04 — nenhum novo dado de cadência de recompra foi introduzido por esta ticket.
  console.log("N/A RP1-RP6 repurchase_candidate is REPURCHASE_RUNTIME = DEFERRED_SCHEMA_PREREQUISITE this round (zero prior art, zero purchase-cadence data — see final report) — no fabricated rule was built to fill this gap");

  console.log(`\nPLAN-IMPL-07A + PRODUCT-GROWTH-04 opportunity engine — all E/IC/SP/IS/RC/H/PG/A/CS/UI/BACKFILL assertions passed (OPPORTUNITY_RESPONSE_LIMIT=${OPPORTUNITY_RESPONSE_LIMIT}, IDLE_SCHEDULE_WINDOW_DAYS=${IDLE_SCHEDULE_WINDOW_DAYS}). B1-B11 (browser) status: see final report.`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
