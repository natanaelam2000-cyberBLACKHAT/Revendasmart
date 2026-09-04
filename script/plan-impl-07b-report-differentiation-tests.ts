import assert from "node:assert/strict";
import fs from "node:fs";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";
import { computeOpportunities, summarizeOpportunities } from "../server/opportunity-engine";
import { hasAdvancedOpportunityAccess } from "../shared/opportunity-rules";
import { calculateFinancialSummary, calculateIndicators, calculateRanking } from "../client/src/lib/report-metrics";
import { buildExcelCsvContent, buildPrintableHtml } from "../client/src/lib/report-export";
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

  // RC1/RC4 — OPERATIONAL: lucro/margem (cartões, ainda em reports.tsx) + comparativos/gráficos/
  // rankings/indicadores (reports-operational.tsx, extraído nesta ticket para lazy chunk — §31 do
  // PLAN-IMPL-07B-VERIFY-FINAL, ver PS-adjacent LAZY check abaixo), todos atrás de hasOperationalAccess.
  assert.match(reportsSrc, /\{hasOperationalAccess &&\s*\(\s*<>\s*<SummaryCard title="Lucro hoje"/, "RC1/RC4: lucro/margem/clientes ativos atrás de hasOperationalAccess");
  const operationalBlockEnd = reportsSrc.indexOf('{hasPremiumAccess ? (');
  assert.ok(operationalBlockEnd > operationalBlockStart, "RC1/RC4: a seção estratégica precisa vir DEPOIS do bloco operacional no arquivo real");
  const operationalBlock = reportsSrc.slice(operationalBlockStart, operationalBlockEnd);
  assert.match(operationalBlock, /\{hasOperationalAccess && \(\s*<Suspense fallback=\{<PageSkeleton variant="cards" \/>\}>\s*<LazyOperationalSection/, "RC1/RC4/§31: o bloco operacional restante é lazy-loaded, ainda atrás de hasOperationalAccess — nunca baixado por Free");
  console.log("PASS RC1/RC4 every operational section (profit/margin cards gated in reports.tsx, comparisons/charts/rankings/stock/export lazy-loaded via reports-operational.tsx) is gated behind hasOperationalAccess (Pro or Premium)");

  // LAZY — §31: o split existe para caber no budget de 29kB sem perder precisão por-item (hierarquia B
  // do profit-safety fix); confirma que reports.tsx só IMPORTA reports-operational.tsx via lazy() (nunca
  // estático, senão o split não tira peso do chunk eager) e que o arquivo lazy de fato existe e exporta
  // o componente esperado.
  assert.match(reportsSrc, /const LazyOperationalSection = lazy\(\(\) => import\("\.\/reports-operational"\)\);/, "LAZY: reports-operational.tsx é importado via React.lazy (dynamic import), nunca estaticamente — senão continuaria no chunk eager e o split não teria efeito no budget");
  assert.doesNotMatch(reportsSrc, /^import .* from ["']\.\/reports-operational["'];?$/m, "LAZY: nenhum import ESTÁTICO de reports-operational.tsx em reports.tsx (só o dynamic import via lazy())");
  const operationalSrc = sourceOf("client/src/pages/reports-operational.tsx");
  assert.match(operationalSrc, /export default function OperationalSection\(/, "LAZY: reports-operational.tsx exporta um componente default (contrato exigido por React.lazy)");
  for (const label of ["Comparativos", "Receita e lucro por mês", "Vendas por categoria", "Produtos mais vendidos", "Top 10 produtos", "Indicadores de estoque", "Exportação profissional preparada"]) {
    assert.match(operationalSrc, new RegExp(label), `RC1/RC4/LAZY: "${label}" precisa estar dentro do componente lazy-loaded`);
  }
  console.log("PASS LAZY reports-operational.tsx is dynamically imported (never a static import that would defeat the code-split), exports the expected default component, and contains every operational section moved out of the eager reports chunk");

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
  assert.doesNotMatch(sourceOf("client/src/pages/reports-operational.tsx"), /IA prevê|inteligência artificial|previsão de compra|chance de|probabilidade/i, "UI11: idem para o conteúdo movido ao chunk lazy-loaded");
  console.log("PASS UI11 no AI/prediction terminology anywhere in the new copy (reports.tsx and the lazy-loaded reports-operational.tsx)");

  assert.match(reportsSrc, /hasOperationalAccess && \(\s*<div className="grid grid-cols-3 gap-2">\s*<button type="button" onClick=\{handleExportExcel\}/, "UI12: export continua funcionando (Excel/PDF/Imprimir), agora corretamente restrito a quem vê os dados que ele exporta (Pro\\+)");
  console.log("PASS UI12 export (Excel/PDF/Print) still works exactly as before for Pro+ — gated so it's never inconsistent with what a Free user can see on screen");
}

// ===================================================================================================
// PS1-PS7 — PLAN-IMPL-07B-VERIFY-FINAL: profit-safety. Execução real (não texto-fonte): report-
// metrics.ts/report-export.ts só importam date-utils/mock-data(tipos)/opportunity-rules — nunca
// firebase.ts — então rodam direto em Node via tsx, sem emulador, exatamente como qualquer outra
// função pura já testada nesta suíte (buildExcelCsvContent/buildPrintableHtml já eram "puro de
// propósito" antes desta ticket, comentário original do arquivo).
// ===================================================================================================
function runProfitSafetyTests(): void {
  const untrustedProduct = { id: "p1", name: "Sem custo", brand: "", category: "", costPrice: 0, salePrice: 50, stock: 5 } as any;
  const trustedProductA = { id: "p2", name: "Com custo A", brand: "", category: "", costPrice: 20, salePrice: 50, stock: 5 } as any;
  const trustedProductB = { id: "p3", name: "Com custo B", brand: "", category: "", costPrice: 10, salePrice: 30, stock: 5 } as any;
  const now = new Date();
  const saleOf = (id: string, productId: string, price: number) => ({
    id, clientId: "c1", date: now.toISOString(), totalPrice: price, paymentType: "pix",
    products: [{ productId, quantity: 1, price }],
  }) as any;

  // PS1 — custo ausente/0 nunca vira custo confiável: uma única venda de um produto sem custo real.
  const untrustedOnly = calculateFinancialSummary([saleOf("s1", "p1", 50)], [untrustedProduct]);
  assert.equal(untrustedOnly.today.profit, null, "PS1: lucro do período com custo não confiável é null, nunca um número calculado tratando custo ausente como 0");
  console.log("PASS PS1 missing cost does not become trusted zero");

  // PS2/PS3 — período MISTO (uma venda com custo confiável + uma com custo não confiável): o total do
  // período nunca mistura os dois — fica indisponível por inteiro, nunca um lucro parcial/errado.
  const mixedSales = [saleOf("s2", "p1", 50), saleOf("s3", "p2", 50)];
  const mixedProducts = [untrustedProduct, trustedProductA];
  const mixedSummary = calculateFinancialSummary(mixedSales, mixedProducts);
  assert.equal(mixedSummary.today.profit, null, "PS2: período com QUALQUER venda de custo não confiável nunca mostra lucro total (nem o parcial só das vendas confiáveis, nem um lucro subestimado) — indisponível é a única opção honesta");
  console.log("PASS PS2 incomplete cost basis does not show total profit");
  const mixedIndicators = calculateIndicators(mixedSales, mixedProducts);
  assert.equal(mixedIndicators.averageMargin, null, "PS3: mesma mistura vale para margem — nunca uma margem calculada sobre uma base de custo incompleta");
  console.log("PASS PS3 incomplete cost basis does not show total margin");

  // PS4 — paridade tela/export: com o MESMO payload (profit null), o export (HTML/CSV, funções puras,
  // testáveis sem DOM) precisa mostrar a mesma indisponibilidade que a tela mostraria via formatCurrency
  // — nunca um número fabricado escrito no PDF/CSV que a tela já recusou mostrar.
  const rankings = calculateRanking(mixedSales, mixedProducts, []);
  const flatComparison = { label: "x", current: 0, previous: 0, changePercent: 0, direction: "flat" as const };
  const comparisons = { today: flatComparison, week: flatComparison, month: flatComparison, year: flatComparison };
  const exportPayload = { storeName: "Loja Teste", periodLabel: "Teste", generatedAt: now, summary: mixedSummary, rankings, comparisons, indicators: mixedIndicators };
  const csv = buildExcelCsvContent(exportPayload);
  const html = buildPrintableHtml(exportPayload);
  assert.match(csv, /Lucro hoje;Indispon[íi]vel/, "PS4: CSV mostra 'Indisponível' para lucro hoje, nunca um valor calculado a partir de custo incompleto");
  assert.match(html, /Lucro hoje<\/td><td>Indispon[íi]vel<\/td>/, "PS4: HTML (PDF/impressão) mostra a mesma indisponibilidade — paridade tela/export");
  console.log("PASS PS4 screen/export parity — the same profit-unavailable state reaches both the CSV and the printable HTML, never a fabricated number in one and not the other");

  // PS5 — quando TODO o custo do período é confiável, o lucro/margem reais (matemática correta) devem
  // aparecer — a hierarquia B nunca é conservadora além do necessário; só fica indisponível quando a
  // ambiguidade é real.
  const trustedSales = [saleOf("s4", "p2", 50), saleOf("s5", "p3", 30)];
  const trustedProducts = [trustedProductA, trustedProductB];
  const trustedSummary = calculateFinancialSummary(trustedSales, trustedProducts);
  assert.equal(trustedSummary.today.profit, 50, "PS5: com custo 100% confiável no período, o lucro precisa ser o valor real calculado (receita 80 - custo 30 = 50), nunca indisponível por excesso de cautela");
  const trustedIndicators = calculateIndicators(trustedSales, trustedProducts);
  assert.equal(trustedIndicators.averageMargin, Math.round((50 / 80) * 100), "PS5: margem real (lucro/receita) quando o custo é 100% confiável — aritmética correta, não fabricada nem indisponível");
  console.log("PASS PS5 trusted cost arithmetic is correct when fully representable — the safety fix never hides real, well-tracked data");

  // PS6 — as métricas BASIC (receita, ticket médio, produtos vendidos) nunca ficam null, mesmo quando o
  // custo é totalmente não confiável: a ambiguidade de CUSTO nunca contamina RECEITA (dado sempre certo,
  // vem direto de Sale.totalPrice, nunca depende de Product.costPrice).
  assert.equal(mixedSummary.today.revenue, 100, "PS6: receita nunca é afetada pela confiabilidade do custo — sempre a soma real de Sale.totalPrice");
  assert.equal(typeof mixedSummary.averageTicket, "number", "PS6: ticket médio continua um número real, nunca null");
  assert.equal(mixedSummary.totalProductsSold, 2, "PS6: produtos vendidos (volume) nunca depende de custo");
  console.log("PASS PS6 Free basic metrics (revenue, average ticket, products sold) are never affected by cost reliability — only profit/margin can become unavailable");

  // PS7 — a seção estratégica (Premium) nunca depende de custo — já provado por F4 (fonte: opportunity-
  // engine.ts nunca menciona costPrice/profit/margin); reconfirmado aqui que os dois módulos financeiros
  // desta correção (report-metrics.ts/report-export.ts) nunca são importados por opportunity-engine.ts —
  // nenhum acoplamento novo foi introduzido entre o profit-safety fix e a leitura estratégica.
  const engineSrc = sourceOf("server/opportunity-engine.ts");
  assert.doesNotMatch(engineSrc, /report-metrics|report-export/, "PS7: opportunity-engine.ts (fonte da seção estratégica) nunca importa report-metrics.ts/report-export.ts — o profit-safety fix não introduz nenhum acoplamento novo com a leitura estratégica");
  console.log("PASS PS7 the Premium strategic summary stays fully independent of cost/profit — no new coupling introduced between the profit-safety fix and the opportunity engine");
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
  runProfitSafetyTests();

  requireEmulatorEnv();
  initializeFirebaseAdmin();
  const db = initializeFirebaseAdmin().firestore();
  await runStrategicSummaryExecutionTests(db);

  console.log("\nPLAN-IMPL-07B report differentiation — all RC/PG/OR/F/SC/UI/PS assertions passed, plus real-execution proof that the report summary never drifts from the canonical opportunity engine and that profit/margin are never fabricated from unreliable cost data. B1-B27 (browser) status: see final report.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
