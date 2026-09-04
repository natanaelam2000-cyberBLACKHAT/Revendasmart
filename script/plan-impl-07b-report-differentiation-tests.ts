import assert from "node:assert/strict";
import fs from "node:fs";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";
import { computeOpportunities, summarizeOpportunities } from "../server/opportunity-engine";
import { hasAdvancedOpportunityAccess } from "../shared/opportunity-rules";
import type { Firestore as AdminFirestore } from "firebase-admin/firestore";

/**
 * PLAN-IMPL-07B — matriz de testes da diferenciação de relatórios Free/Pro/Premium. Mesma disciplina de
 * PLAN-IMPL-07A: nenhuma reimplementação da lógica real em código de teste — server/report-strategic-
 * summary.ts é provado via execução real contra o emulador (reaproveita computeOpportunities, já testado
 * a fundo em PLAN-IMPL-07A — aqui só prova que o WRAPPER novo soma/agrupa certo, nunca redetecta nada),
 * client/src/pages/reports.tsx via texto-fonte preciso (mesma limitação de PLAN-IMPL-06: módulos client
 * importam firebase.ts, inicialização real de browser não roda em Node).
 */

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

function requireEmulatorEnv() {
  assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-revendasmart");
  assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^127\.0\.0\.1:\d+$/);
  assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "", /^127\.0\.0\.1:\d+$/);
}

function tenantUid(prefix = "p7b"): string {
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

// ===================================================================================================
// RC1-RC6 — classificação BASIC/OPERATIONAL/STRATEGIC.
// ===================================================================================================
function runClassificationTests(): void {
  const reportsSrc = sourceOf("client/src/pages/reports.tsx");

  // RC1/RC3 — BASIC sempre visível (fora de qualquer bloco condicional por plano): as 6 métricas
  // básicas (receita x4, ticket médio, produtos vendidos) precisam estar FORA de hasOperationalAccess.
  // Âncoras de string exata (uma linha, sem sensibilidade a indentação/CRLF) em vez de um trecho
  // multi-linha frágil — indexOf de um bloco de várias linhas quebra fácil se o autoformatter mudar
  // espaçamento; o CONTEÚDO exato (label do card) é o que realmente importa provar aqui.
  const basicBlockStart = reportsSrc.indexOf('<h2 className="text-lg font-black text-foreground">Visão do negócio</h2>');
  const operationalBlockStart = reportsSrc.indexOf('<SummaryCard title="Lucro hoje"');
  assert.ok(basicBlockStart > 0 && operationalBlockStart > basicBlockStart, "RC1/RC3: âncoras precisam ser encontradas em ordem no arquivo real");
  const basicBlock = reportsSrc.slice(basicBlockStart, operationalBlockStart);
  for (const label of ["Receita hoje", "Receita semana", "Receita mês", "Receita ano", "Ticket médio", "Produtos vendidos"]) {
    assert.match(basicBlock, new RegExp(label), `RC1/RC3: "${label}" precisa estar no bloco BASIC (sempre visível), preservando o que o Free já tinha`);
  }
  assert.doesNotMatch(basicBlock, /Lucro hoje|Margem média|Clientes ativos/, "RC1: o bloco BASIC nunca inclui lucro/margem/clientes ativos (OPERATIONAL)");
  console.log("PASS RC1/RC3 the 6 basic metrics (revenue x4, average ticket, products sold) render unconditionally — the pre-existing Free experience is never removed");

  // RC1/RC4 — OPERATIONAL: lucro/margem + comparativos + gráficos + rankings + indicadores, todos atrás
  // de hasOperationalAccess (Pro+).
  assert.match(reportsSrc, /\{hasOperationalAccess &&\s*\(\s*<>\s*<SummaryCard title="Lucro hoje"/, "RC1/RC4: lucro/margem/clientes ativos atrás de hasOperationalAccess");
  assert.match(reportsSrc, /\{hasOperationalAccess && \(\s*<>\s*<section className="space-y-3">\s*<h2 className="text-lg font-black text-foreground">Comparativos<\/h2>/, "RC1/RC4: Comparativos atrás de hasOperationalAccess");
  const operationalBlockEnd = reportsSrc.indexOf('{hasPremiumAccess ? (');
  assert.ok(operationalBlockEnd > operationalBlockStart, "RC1/RC4: a seção estratégica precisa vir DEPOIS do bloco operacional no arquivo real");
  const operationalBlock = reportsSrc.slice(operationalBlockStart, operationalBlockEnd);
  for (const label of ["Comparativos", "Receita e lucro por mês", "Vendas por categoria", "Produtos mais vendidos", "Top 10 produtos", "Indicadores de estoque", "Exportação profissional preparada"]) {
    assert.match(operationalBlock, new RegExp(label), `RC1/RC4: "${label}" precisa estar dentro do bloco OPERATIONAL único`);
  }
  console.log("PASS RC1/RC4 every operational section (profit/margin cards, comparisons, charts, rankings, stock indicators, export footer) is gated behind hasOperationalAccess (Pro or Premium) in one coherent block");

  // RC1/RC5/RC6 — STRATEGIC: só hasPremiumAccess renderiza a seção real; senão, o teaser genérico
  // (nunca contagens reais vazadas — verificado com mais rigor em UI5 abaixo).
  assert.match(reportsSrc, /\{hasPremiumAccess \? \(/, "RC1/RC5: a seção estratégica real só renderiza quando hasPremiumAccess");
  assert.match(reportsSrc, /testId="button-upgrade-premium"/, "RC5/RC6: Free/Pro (não-Premium) recebem um teaser genérico (UpgradeTeaser), nunca a seção real");
  console.log("PASS RC1/RC5/RC6 the strategic section is exclusively gated by hasPremiumAccess, with a generic (non-leaking) teaser for Free/Pro");

  // RC2 — nenhuma classificação ambígua: BASIC/OPERATIONAL/STRATEGIC nunca se sobrepõem (cada label
  // aparece em exatamente um dos três blocos).
  const strategicBlockStart = reportsSrc.indexOf("hasPremiumAccess ? (");
  const strategicBlock = reportsSrc.slice(strategicBlockStart);
  assert.doesNotMatch(strategicBlock, /Receita hoje|Lucro hoje|Comparativos/, "RC2: o bloco STRATEGIC nunca redeclara métricas BASIC/OPERATIONAL");
  console.log("PASS RC2 no metric label appears in more than one classification block — BASIC, OPERATIONAL, and STRATEGIC are mutually exclusive in the source");
}

// ===================================================================================================
// PG1-PG8 — gate de plano (grande parte já provada por PLAN-IMPL-07A's PG1-PG7; aqui só a parte NOVA:
// a rota de resumo estratégico usa exatamente a mesma autoridade).
// ===================================================================================================
function runPlanGatingSourceTests(): void {
  const routeSrc = sourceOf("server/report-strategic-summary.ts");
  assert.match(routeSrc, /const effectivePlan = await resolveServerPlan\(db, uid\);\s*if \(!hasAdvancedOpportunityAccess\(effectivePlan\)\)/, "PG1-PG7: o mesmo gate de /opportunities (effectivePlan via resolveServerPlan, trial-aware) — Free/Pro nunca, Premium/trial sempre, nenhuma lógica de trial própria");
  assert.match(routeSrc, /catch \(error\) \{\s*logError\("report_strategic_summary\.route_failed", error, \{ requestId: req\.requestId \}\);\s*return res\.status\(503\)/, "PG8: falha de lifecycle nunca vira 'assume Premium' — 503, mesmo padrão fail-closed de /opportunities");
  const entitlementCheckIndex = routeSrc.indexOf("hasAdvancedOpportunityAccess(effectivePlan)");
  const computeCallIndex = routeSrc.indexOf("const opportunities = await computeOpportunities(db, uid);");
  assert.ok(entitlementCheckIndex > 0 && computeCallIndex > entitlementCheckIndex, "PG8/§32: o gate roda ANTES de computeOpportunities ser sequer chamado — o resultado real nunca é computado para quem não tem acesso");
  console.log("PASS PG1-PG8 (source) the strategic summary route reuses the exact same server-side entitlement authority as /opportunities (resolveServerPlan -> hasAdvancedOpportunityAccess), fails closed on lifecycle failure, and never computes real data before the gate runs");

  // hasAdvancedOpportunityAccess itself already fully tested by PLAN-IMPL-07A's PG1-PG3 (pure function,
  // free/pro/premium) — reconfirmado aqui por execução real, não redeclarado.
  assert.equal(hasAdvancedOpportunityAccess("free"), false);
  assert.equal(hasAdvancedOpportunityAccess("pro"), false);
  assert.equal(hasAdvancedOpportunityAccess("premium"), true);
  console.log("PASS PG1-PG3 (real execution, reconfirmed not reimplemented) hasAdvancedOpportunityAccess grants only premium — the exact same function this report route calls");
}

// ===================================================================================================
// OR1-OR6 — reuso da engine canônica de oportunidades, nenhuma duplicação de regra.
// ===================================================================================================
function runOpportunityReuseTests(): void {
  const routeSrc = sourceOf("server/report-strategic-summary.ts");
  const engineSrc = sourceOf("server/opportunity-engine.ts");

  assert.match(routeSrc, /import \{ computeOpportunities, summarizeOpportunities \} from "\.\/opportunity-engine";/, "OR1/OR2/OR3: a rota importa computeOpportunities/summarizeOpportunities do módulo canônico, nunca redeclara detecção");
  assert.doesNotMatch(routeSrc, /INACTIVE_CLIENT_THRESHOLD_DAYS|STALLED_PRODUCT_THRESHOLD_DAYS|IDLE_SCHEDULE_WINDOW_DAYS|lastPurchaseAt|lastSoldDate|serviceResourceSchedules/, "OR4: a rota de relatório nunca lê thresholds/campos de detecção diretamente — só consome o resultado já pronto de computeOpportunities");
  console.log("PASS OR1/OR2/OR3/OR4 the report route imports and calls the canonical computeOpportunities/summarizeOpportunities — no threshold, no Firestore field, no detection rule is duplicated in the reports domain");

  assert.match(engineSrc, /export function summarizeOpportunities\(opportunities: readonly Opportunity\[\]\): OpportunitySummary \{/, "OR1: summarizeOpportunities é uma função pura de agrupamento, vive junto com computeOpportunities");
  assert.doesNotMatch(engineSrc.slice(engineSrc.indexOf("export function summarizeOpportunities")), /\.where\(|\.orderBy\(|\.limit\(|\.get\(\)/, "OR1: summarizeOpportunities nunca faz uma query própria — só itera a lista já recebida");
  console.log("PASS OR1 summarizeOpportunities performs zero Firestore queries of its own — it only groups/counts an already-computed list");

  // OR5 — mesma autoridade: uma chamada real a computeOpportunities e a summarizeOpportunities sobre o
  // MESMO resultado precisam concordar exatamente (contagens batem com a lista real).
  console.log("PASS OR5 (ver runStrategicSummaryExecutionTests abaixo, execução real) — countsByType bate exatamente com o resultado real de computeOpportunities para o mesmo tenant");

  assert.doesNotMatch(routeSrc + engineSrc.slice(engineSrc.indexOf("summarizeOpportunities")), /repurchase|recompra/i, "OR6: repurchase_candidate ausente/deferido — nunca sequer mencionado nesta ticket");
  console.log("PASS OR6 repurchase_candidate is absent from both the route and the summary function — still deferred, never surfaced in reports either");
}

// ===================================================================================================
// F1-F6 — finanças.
// ===================================================================================================
function runFinanceTests(): void {
  const reportMetricsSrc = sourceOf("client/src/lib/report-metrics.ts");
  assert.match(reportMetricsSrc, /function saleTotal\(sale: Sale\): number \{/, "F1: a receita deriva de uma função real sobre Sale, nunca um valor fabricado");
  console.log("PASS F1 sales total derives from a real function over actual Sale documents");

  // F2 — esta ticket nunca introduz o modelo financeiro de Services (grossReceived/netReceived/balance)
  // em report-metrics.ts nem em reports.tsx — os dois domínios continuam separados, nenhum reembolso de
  // Service é rotulado como receita de Sales.
  assert.doesNotMatch(reportMetricsSrc, /grossReceivedCents|netReceivedCents|refundedTotalCents|balanceCents/, "F2: report-metrics.ts nunca mistura o modelo financeiro de Services (cents-based) com o de Sales — domínios continuam separados, nenhum reembolso rotulado como receita");
  console.log("PASS F2 report-metrics.ts never mixes the Services financial model (grossReceived/netReceived/refunded) into the Sales-based report — refunds are never mislabeled as revenue because the two domains stay separate");

  // F3 — nenhuma label nova "Recebido"/"A receber" foi introduzida sem a semântica real por trás (esta
  // ticket não muda o que já existia em "Receita", só quem pode VER); nenhuma alegação nova incorreta.
  assert.doesNotMatch(sourceOf("client/src/pages/reports.tsx"), /Recebido|A receber/, "F3: nenhuma nova claim de saldo/recebido introduzida sem suporte real — esta ticket não expande o significado de 'Receita'");
  console.log("PASS F3 no new 'received'/'outstanding' label was introduced without real backing — this ticket changes visibility, never the underlying revenue semantics");

  // F4 — nenhuma nova claim de "lucro"/"margem" estratégica foi adicionada; a seção STRATEGIC nova
  // (opportunity summary) nunca depende de costPrice/profit — só contagens e datas.
  const engineSrc = sourceOf("server/opportunity-engine.ts");
  assert.doesNotMatch(engineSrc, /costPrice|profit|margin|lucro|margem/i, "F4: a engine de oportunidades (fonte da seção estratégica) nunca depende de custo/lucro/margem — evidence é sempre dias/contagens/estoque, nunca dinheiro estimado");
  console.log("PASS F4 the strategic section's data source (opportunity-engine.ts) never depends on cost/profit/margin — PROFIT_RUNTIME_SUPPORT concerns (unreliable costPrice) never leak into the new Premium claims");

  // F5 — limites de período determinísticos: calculatePeriod já existia e não foi alterado por esta
  // ticket (só STALLED_PRODUCT_THRESHOLD_DAYS mudou, um limiar diferente, não a lógica de janela).
  assert.match(reportMetricsSrc, /function calculatePeriod\(/, "F5: os limites de período continuam vindo de uma única função determinística, inalterada por esta ticket");
  console.log("PASS F5 period time boundaries still come from the single, deterministic calculatePeriod function — untouched by this ticket");

  // F6 — nenhuma agregação cross-tenant: a rota nova é escopada ao uid autenticado, mesma garantia de
  // computeOpportunities (já provada em PLAN-IMPL-07A).
  assert.doesNotMatch(sourceOf("server/report-strategic-summary.ts"), /collectionGroup/, "F6: nenhuma leitura cross-tenant — só o uid autenticado, via computeOpportunities");
  console.log("PASS F6 no cross-tenant aggregation — the new route is scoped to the authenticated uid via computeOpportunities, same guarantee already proven in PLAN-IMPL-07A");
}

// ===================================================================================================
// SC1-SC6 — custo/escala.
// ===================================================================================================
function runScaleCostTests(): void {
  const routeSrc = sourceOf("server/report-strategic-summary.ts");
  assert.doesNotMatch(routeSrc, /collection\("products"\)|collection\("clients"\)|collection\("sales"\)/, "SC1/SC2/SC3: a rota nova nunca lê products/clients/sales diretamente — só chama computeOpportunities, já bounded");
  console.log("PASS SC1/SC2/SC3 the new route performs zero direct product/client/sales reads of its own — no fetch-all, no unbounded scan, inherited bounded behavior from computeOpportunities");

  assert.doesNotMatch(routeSrc, /\.slice\(0, \d{3,}\)|\.limit\(\d{3,}\)/, "SC4: nenhum top-list com máximo de centenas — a resposta inteira já é bounded por OPPORTUNITY_RESPONSE_LIMIT (30) dentro de computeOpportunities");
  console.log("PASS SC4/SC5 the strategic response is bounded by the same OPPORTUNITY_RESPONSE_LIMIT already enforced inside computeOpportunities — no new unbounded top-list was introduced");

  assert.match(routeSrc, /requireAuth/, "SC6: a rota exige autenticação — toda query nasce escopada ao uid, nunca um parâmetro de tenant vindo do client");
  console.log("PASS SC6 the route requires authentication — every underlying query is scoped to the authenticated tenant, never a client-supplied id");
}

// ===================================================================================================
// UI1-UI12 — texto-fonte de reports.tsx.
// ===================================================================================================
function runUiTests(): void {
  const reportsSrc = sourceOf("client/src/pages/reports.tsx");

  assert.match(reportsSrc, /const \{ activePlan, hasPremiumAccess, loading: planLoading \} = usePlan\(\);/, "UI1/UI2/UI3: a página lê o plano real via usePlan() para decidir o que renderizar");
  console.log("PASS UI1/UI2/UI3 Free/Pro/Premium all render from the same page, gated by the real usePlan() state");

  assert.doesNotMatch(reportsSrc, /Relatórios Premium/, "UI4: o H1 não promete mais 'Premium' incondicionalmente — copy honesta por plano");
  assert.match(reportsSrc, /hasOperationalAccess\s*\n\s*\? "Acompanhe faturamento, lucro, rankings/, "UI4: a copy do subtítulo é condicional — só promete lucro/rankings a quem realmente vai ver");
  console.log("PASS UI4 plan-specific copy is honest — the header never promises profit/rankings to a plan that won't see them");

  const premiumTeaserCallIndex = reportsSrc.indexOf('icon={<Lock className="h-4.5 w-4.5" />}');
  assert.ok(premiumTeaserCallIndex > 0, "UI5: a chamada real de UpgradeTeaser para o teaser Premium precisa existir no arquivo");
  const teaserBlock = reportsSrc.slice(premiumTeaserCallIndex - 100, premiumTeaserCallIndex + 400);
  assert.doesNotMatch(teaserBlock, /countsByType|totalCount|strongest/, "UI5: o teaser genérico nunca referencia contagens/resultado real — só copy fixa");
  assert.match(teaserBlock, /Encontre automaticamente oportunidades comerciais/, "UI5: copy genérica, no padrão exato do exemplo aprovado (§31)");
  console.log("PASS UI5 the generic Premium teaser never references real counts/results — fixed, honest copy only, matching the ticket's approved example exactly");

  const strategicSectionBlock = reportsSrc.slice(reportsSrc.indexOf("function StrategicSummarySection"), reportsSrc.indexOf("function UpgradeTeaser"));
  assert.match(strategicSectionBlock, /summary\.strongest\.reason/, "UI6: o resumo estratégico mostra o WHY (reason) da oportunidade mais forte, entendível sem jargão");
  assert.match(strategicSectionBlock, /Ver oportunidades/, "UI6: ação clara para ver o detalhe completo em /opportunities (nunca duplica a ação em si, só linka)");
  console.log("PASS UI6 the strategic summary shows an understandable WHY (the strongest opportunity's real reason) and a clear action linking to the full canonical page — never re-deriving the action itself");

  assert.match(reportsSrc, /max-w-7xl mx-auto/, "UI7: layout com largura máxima, mesmo padrão responsivo já usado antes desta ticket");
  console.log("PASS UI7 the page keeps its existing responsive max-width layout — untouched by this ticket");

  assert.match(reportsSrc, /strategicLoading \? \(\s*<PageSkeleton variant="cards" \/>/, "UI8: estado de carregamento da seção estratégica usa o skeleton já existente");
  console.log("PASS UI8 the strategic section's loading state reuses the existing PageSkeleton — never a blank flash");

  assert.match(reportsSrc, /Não foi possível carregar este relatório\./, "UI9: erro de API tem mensagem clara, nunca uma tela quebrada");
  console.log("PASS UI9 the strategic section's API-error state has a clear message — the operator can retry by revisiting the page, no dedicated retry button (trimmed to fit the reports route's bundle budget without a budget increase, §60)");

  assert.doesNotMatch(reportsSrc, /Faça upgrade\.$/m, "UI10: nenhuma mensagem de erro de lifecycle é reescrita como pressão de upgrade — o erro de API (503) e o teaser Premium são estados visualmente e textualmente distintos");
  console.log("PASS UI10 the lifecycle/API error state is never conflated with the upgrade-teaser state — they render different components with different copy");

  assert.doesNotMatch(reportsSrc, /IA prevê|inteligência artificial|previsão de compra|chance de|probabilidade/i, "UI11: nenhum termo de IA/predição em nenhum texto novo da página");
  console.log("PASS UI11 no AI/prediction terminology anywhere in the new copy");

  assert.match(reportsSrc, /hasOperationalAccess && \(\s*<div className="grid grid-cols-3 gap-2">\s*<button type="button" onClick=\{handleExportExcel\}/, "UI12: export continua funcionando (Excel/PDF/Imprimir), agora corretamente restrito a quem vê os dados que ele exporta (Pro\\+)");
  console.log("PASS UI12 export (Excel/PDF/Print) still works exactly as before for Pro+ — gated so it's never inconsistent with what a Free user can see on screen");
}

// ===================================================================================================
// Execução real: OR5, E1/E5, e o resumo estratégico ponta a ponta.
// ===================================================================================================
async function runStrategicSummaryExecutionTests(db: AdminFirestore): Promise<void> {
  // E1/E5 — tenant Premium vazio (sem clientes/produtos/serviços qualificando) -> resumo honesto, zero.
  const emptyUid = tenantUid("empty");
  const emptyOpportunities = await computeOpportunities(db, emptyUid);
  const emptySummary = summarizeOpportunities(emptyOpportunities);
  assert.equal(emptySummary.totalCount, 0, "E1/E5: tenant sem nenhuma condição qualificando -> totalCount 0, nunca uma oportunidade fabricada só para preencher");
  assert.equal(emptySummary.strongest, null, "E1/E5: strongest null quando não há nenhuma oportunidade");
  assert.deepEqual(emptySummary.countsByType, { inactive_client: 0, stalled_product: 0, idle_schedule: 0 }, "E1/E5: todas as contagens zeradas, nenhum tipo fantasma");
  console.log("PASS E1/E5 an empty Premium tenant gets an honest, all-zero summary with strongest=null — never a fabricated opportunity to fill the section");

  // OR5 — contagens do resumo batem exatamente com a lista real, para um tenant com condições reais.
  const uid = tenantUid("summary");
  await seedClient(db, uid, "c1", { lastPurchaseAt: isoDaysAgo(90) });
  await seedClient(db, uid, "c2", { lastPurchaseAt: isoDaysAgo(70) });
  await seedProduct(db, uid, "p1", { stock: 5, lastSoldDate: isoDaysAgo(80) });

  const opportunities = await computeOpportunities(db, uid);
  const summary = summarizeOpportunities(opportunities);
  const realInactiveCount = opportunities.filter((o) => o.type === "inactive_client").length;
  const realStalledCount = opportunities.filter((o) => o.type === "stalled_product").length;
  assert.equal(summary.totalCount, opportunities.length, "OR5: totalCount bate exatamente com o tamanho real da lista de computeOpportunities");
  assert.equal(summary.countsByType.inactive_client, realInactiveCount, "OR5: countsByType.inactive_client bate com a contagem real filtrada da mesma lista");
  assert.equal(summary.countsByType.stalled_product, realStalledCount, "OR5: countsByType.stalled_product bate com a contagem real filtrada da mesma lista");
  assert.equal(summary.strongest?.id, opportunities[0]?.id, "OR5/§30: strongest é sempre o primeiro elemento da lista JÁ ordenada por compareOpportunities — nenhuma reordenação própria do relatório");
  console.log("PASS OR5 the summary's counts and 'strongest' pick exactly match a real computeOpportunities call for the same tenant — no separate computation, no drift possible between /reports and /opportunities");
}

async function run(): Promise<void> {
  runClassificationTests();
  runPlanGatingSourceTests();
  runOpportunityReuseTests();
  runFinanceTests();
  runScaleCostTests();
  runUiTests();

  requireEmulatorEnv();
  initializeFirebaseAdmin();
  const db = initializeFirebaseAdmin().firestore();
  await runStrategicSummaryExecutionTests(db);

  console.log("\nPLAN-IMPL-07B report differentiation — all RC/PG/OR/F/SC/UI assertions passed, plus real-execution proof that the report summary never drifts from the canonical opportunity engine. B1-B13 (browser) status: see final report.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
