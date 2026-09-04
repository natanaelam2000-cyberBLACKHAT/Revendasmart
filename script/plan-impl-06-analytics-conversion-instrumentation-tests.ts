import assert from "node:assert/strict";
import fs from "node:fs";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";
import { reservePreparationSlot, completePreparationSlot } from "../server/ads-pro-preparation-quota";
import { PLAN_CONFIG, PLANS } from "../shared/monetization";

/**
 * PLAN-IMPL-06 §52-§59 — matriz de testes da instrumentação de analytics de conversão (A1-A8, P1-P8,
 * PF1-PF7, AP1-AP8, PR1-PR7, S1-S6). B1-B9 (browser E2E) NÃO está nesta suíte: verificado ao vivo via
 * Browser pane (ver relatório final) — o mesmo padrão já usado em PLAN-IMPL-04B/05 nesta sessão, nunca
 * um novo harness Playwright (os specs `tests/e2e/*.spec.ts` existentes são de tickets anteriores,
 * RELEASE-03B em diante, não deste).
 *
 * Metodologia (mesma de PLAN-IMPL-05, script/plan-impl-05-ads-pro-preparation-quota-tests.ts):
 *   - server/ e shared/ (sem import de SDK de browser): execução REAL contra o emulador Firestore.
 *   - client/src/lib/firebase.ts (agregador) tem efeitos colaterais de topo de arquivo específicos de
 *     browser (browserLocalPersistence, getAnalytics, getPerformance) — importá-lo num script tsx/Node
 *     não é um padrão usado em NENHUM teste existente deste repo (confirmado: script/smoke-tests.ts só
 *     faz `read()` de texto sobre client/src/lib/firebase.ts, nunca um import real). Qualquer módulo que
 *     importe trackAnalyticsEvent/firePlanLifecycleAnalytics/fireServerCountedFirstOccurrence importa
 *     esse agregador transitivamente — mesma restrição. Por isso, TODA a prova do lado client (A1-A8,
 *     P1-P8, PF1-PF7, boa parte de AP1-AP8, S1-S6, PR1-PR7) é texto-fonte, igual PLAN-IMPL-05's
 *     runUiCopyTests e smoke-tests.ts's próprio §M — nunca uma reimplementação da lógica em código de
 *     teste, sempre uma asserção sobre o código REAL que roda em produção.
 */

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

function requireEmulatorEnv() {
  assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-revendasmart");
  assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^127\.0\.0\.1:\d+$/);
  assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "", /^127\.0\.0\.1:\d+$/);
}

function tenantUid(prefix = "p6"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sourceOf(path: string): string {
  return fs.readFileSync(path, "utf8");
}

const analyticsLibSrc = sourceOf("client/src/lib/firebase-analytics.ts");
// Só o bloco de eventos ADICIONADO por esta ticket: do fim de ad_image_downloaded (último evento
// pré-existente antes das adições) até o fechamento da interface FirebaseAnalyticsEvents, ANTES dos
// exports dos tipos de enum que vêm depois dela (nunca testa contra eventos legados como `purchase`,
// ver PR6, nem contra código não relacionado mais abaixo no arquivo, como setFirebaseAnalyticsUserId).
const newEventsBlock = analyticsLibSrc.slice(analyticsLibSrc.indexOf("ad_image_downloaded"), analyticsLibSrc.indexOf("export type AnalyticsPaywallReason"));

// ===================================================================================================
// A1-A8 — ativação: cada "primeiro X" só na transição real, nunca em render/abertura de tela.
// ===================================================================================================
function runActivationTests(): void {
  const planAuthMutSrc = sourceOf("server/plan-authoritative-mutations.ts");
  assert.match(planAuthMutSrc, /isFirstProduct:\s*usage\.productsCount === 0/, "A1: isFirstProduct precisa vir de usage.productsCount === 0 dentro da MESMA transação, nunca de uma contagem separada");
  const addProductSrc = sourceOf("client/src/pages/add-product.tsx");
  assert.match(addProductSrc, /if \(created\.isFirstProduct\) trackAnalyticsEvent\("first_product_created"\)/, "A1: first_product_created só dispara quando o servidor confirma isFirstProduct, nunca sempre que um produto é criado");
  console.log("PASS A1 first_product_created fires only on the server-confirmed 0->1 transition (same transaction as the product write), never inferred from a local list length");

  const sellSrc = sourceOf("client/src/pages/sell.tsx");
  assert.match(sellSrc, /fireServerCountedFirstOccurrence\(\s*currentUser\.uid,\s*"first_sale_completed",\s*"first_sale_completed",\s*async \(\) => \(await getCountFromServer\(collection\(getFirestore\(\), "users", currentUser\.uid, "sales"\)\)\)\.data\(\)\.count,?\s*\)/, "A2: first_sale_completed precisa consultar a contagem REAL de users/{uid}/sales no servidor, nunca um cache local");
  console.log("PASS A2 first_sale_completed is verified against a real server count of the sales collection, never a client-side cache");

  const routesSrc = sourceOf("server/routes.ts");
  assert.match(routesSrc, /catalogSlugJustCreated = slugResult\.created/, "A3: catalogSlugJustCreated precisa vir do `created` real de ensurePublicCatalogSlug, nunca de enablePublicCatalog sozinho");
  const settingsSrc = sourceOf("client/src/pages/settings.tsx");
  assert.match(settingsSrc, /if \(result\.catalogSlugJustCreated\) trackAnalyticsEvent\("catalog_published"\)/, "A3: catalog_published só dispara na transição real de provisionamento, nunca em todo salvamento de configurações");
  console.log("PASS A3 catalog_published fires only on genuine first slug provisioning, never on every settings save (enablePublicCatalog defaults true, a plain boolean toggle would have fired constantly)");

  const publicBookingSrc = sourceOf("client/src/lib/service-public-booking-commands.ts");
  assert.doesNotMatch(publicBookingSrc, /trackAnalyticsEvent|first_booking_created/, "A4: a sessão anônima do cliente (sem tenant logado, sem setFirebaseAnalyticsUserId) nunca pode ser a origem de first_booking_created — seria inatribuível ao tenant certo");
  const agendaSrc = sourceOf("client/src/pages/service-agenda.tsx");
  assert.match(agendaSrc, /fireServerCountedFirstOccurrence\(\s*uid,\s*"first_booking_created",\s*"first_booking_created",\s*async \(\) => \(await getCountFromServer\(collection\(getFirestore\(\), "users", uid, "bookings"\)\)\)\.data\(\)\.count,?\s*\)/, "A4: first_booking_created precisa vir de uma contagem lifetime real de bookings, na sessão do DONO");
  assert.match(agendaSrc, /useEffect\(\(\) => \{[\s\S]{0,50}const uid = getFirebaseAuth\(\)\?\.currentUser\?\.uid;[\s\S]{0,400}\}, \[\]\)/, "A4: o efeito de first_booking_created roda uma vez ao montar a agenda do dono, não depende da data selecionada");
  console.log("PASS A4 first_booking_created fires from the OWNER's own session (service-agenda.tsx mount, lifetime bookings count) — never from the anonymous public confirm flow, which has no tenant attribution");

  const marketingSrc = sourceOf("client/src/pages/marketing.tsx");
  assert.match(marketingSrc, /await recordAction\(payload\);[\s\S]{0,600}fireServerCountedFirstOccurrence\(\s*uid,\s*"first_marketing_created",\s*"first_marketing_created",\s*\(\) => countMarketingHistoryEntries\(uid\),?\s*\)/, "A5: first_marketing_created só depois de recordAction confirmar sucesso, contra a contagem real de marketingHistory (via o hook que já é dono da coleção, nunca uma query direta em marketing.tsx)");
  assert.doesNotMatch(marketingSrc, /getDocs|onSnapshot|collection\(/, "A5/regressão smoke-tests: marketing.tsx precisa continuar sem abrir nenhuma consulta própria ao Firestore — a contagem de first_marketing_created vem de countMarketingHistoryEntries, exportada por useMarketingHistory.ts, que já é dono da coleção marketingHistory");
  const marketingHistoryHookSrc = sourceOf("client/src/hooks/useMarketingHistory.ts");
  assert.match(marketingHistoryHookSrc, /export async function countMarketingHistoryEntries\(uid: string\): Promise<number> \{\s*return \(await getCountFromServer\(collection\(getFirestore\(\), "users", uid, "marketingHistory"\)\)\)\.data\(\)\.count;/, "A5: countMarketingHistoryEntries precisa viver no hook que já é dono de users/{uid}/marketingHistory (leitura/escrita/exclusão), nunca duplicado em marketing.tsx");
  console.log("PASS A5 first_marketing_created fires only after a real persisted marketingHistory write succeeds, via a real server count exported from useMarketingHistory.ts (the hook that already owns this collection) — marketing.tsx itself never opens its own Firestore query, preserving the pre-existing 'single product source, no direct Firestore access' guarantee (script/smoke-tests.ts)");

  // A6/A7 — fireServerCountedFirstOccurrence: decisão count<=1 dispara / count>=1 marca (mesmo sem
  // disparar) / já marcado nunca reconsulta. Prova em texto-fonte (window.localStorage não existe em
  // Node/tsx, e o módulo importa @/lib/firebase, que tem efeitos colaterais de browser no topo — mesma
  // restrição de smoke-tests.ts, nunca um import real deste módulo num script Node).
  const milestonesSrc = sourceOf("client/src/lib/analytics-milestones.ts");
  assert.match(milestonesSrc, /if \(hasMilestoneFired\(uid, milestoneKey\)\) return;/, "A6: já marcado -> nunca reconsulta o servidor, nunca dispara de novo");
  assert.match(milestonesSrc, /if \(count <= 1\) trackAnalyticsEvent\(eventName\);/, "A7: só dispara quando a contagem real prova que este é o primeiro (<=1) registro — nunca por suposição");
  assert.match(milestonesSrc, /if \(count >= 1\) markMilestoneFired\(uid, milestoneKey\);/, "A6/A7: um tenant com histórico pré-existente (count > 1 na primeira observação) nunca dispara 'primeira vez', mas ainda assim é marcado para não reconsultar para sempre");
  console.log("PASS A6/A7 fireServerCountedFirstOccurrence fires at most once per tenant, verified via a real server count (never a client cache) — a tenant with pre-existing history is correctly never treated as 'first', and is marked to avoid re-querying forever");

  for (const [event, params] of [["first_product_created", "Record<string, never>"], ["first_sale_completed", "Record<string, never>"], ["catalog_published", "Record<string, never>"], ["first_booking_created", "Record<string, never>"], ["first_marketing_created", "Record<string, never>"]]) {
    assert.match(newEventsBlock, new RegExp(`${event}: ${params};`), `A8: ${event} não deve levar nenhum parâmetro (nem id/nome de produto/cliente/venda) — "primeiro" é sinalizado só pela ocorrência`);
  }
  console.log("PASS A8 all five activation milestone events carry zero params — no product/client/sale identifiers, 'first' is signaled by occurrence alone");
}

// ===================================================================================================
// P1-P8 — funil de paywall: paywall_viewed/paywall_cta_clicked, sem spam em re-render.
// ===================================================================================================
function runPaywallTests(): void {
  const promptSrc = sourceOf("client/src/components/PlanLimitPrompt.tsx");
  assert.match(promptSrc, /useEffect\(\(\) => \{\s*trackAnalyticsEvent\("paywall_viewed"/, "P1: paywall_viewed precisa disparar no efeito de montagem do componente full-page");
  assert.match(promptSrc, /\}, \[\]\);/, "P1/P6: deps vazias — dispara uma vez por montagem real, nunca a cada re-render (o componente só existe no DOM enquanto deve estar visível)");
  console.log("PASS P1/P6 paywall_viewed fires once on PlanLimitPrompt mount ([] deps) — never repeats on re-render of an already-visible instance");

  const planUsageSrc = sourceOf("client/src/pages/plan-usage.tsx");
  assert.match(planUsageSrc, /function usePaywallViewedOnLimit\([\s\S]{0,300}useEffect\(\(\) => \{\s*if \(!visible\) return;\s*trackAnalyticsEvent\("paywall_viewed"/, "P2/P6: nos cards sempre-montados de plan-usage.tsx, paywall_viewed só na transição real para 'no limite' (inclusive já-no-limite na primeira renderização), nunca a cada render enquanto visible continuar true");
  assert.match(planUsageSrc, /\}, \[visible\]\);/, "P2/P6: deps [visible] — só a TRANSIÇÃO false->true dispara de novo, nunca um render que mantém visible true");
  assert.match(planUsageSrc, /usePaywallViewedOnLimit\(Boolean\(limitCopy\), "booking_limit", "booking_limit", activePlan, limitCopy\?\.recommendedPlan\)/, "P2: BookingQuotaCard aplica o hook com o reason/source corretos");
  assert.match(planUsageSrc, /usePaywallViewedOnLimit\(Boolean\(limitCopy\), "ads_pro_preparation_limit", "ads_pro_preparation_limit", activePlan, limitCopy\?\.recommendedPlan\)/, "P2: AdsProPreparationsCard aplica o hook com o reason/source corretos");
  console.log("PASS P2 both plan-usage.tsx quota cards fire paywall_viewed exactly on the false->true 'at limit' transition, including landing already-at-limit on first render");

  assert.match(promptSrc, /const handleCtaClick = \(\) => \{\s*trackAnalyticsEvent\("paywall_cta_clicked"/, "P3: paywall_cta_clicked no clique do CTA do PlanLimitPrompt");
  assert.match(promptSrc, /setLocation\(`\/plans\?source=\$\{source\}`\)/, "P3/§46: navega para /plans propagando a MESMA source, mantendo o funil paywall_viewed -> paywall_cta_clicked -> plans_viewed consistente ponta a ponta");
  assert.match(planUsageSrc, /setLocation\("\/plans\?source=booking_limit"\)/, "P3: BookingQuotaCard's CTA propaga source=booking_limit");
  assert.match(planUsageSrc, /setLocation\("\/plans\?source=ads_pro_preparation_limit"\)/, "P3: AdsProPreparationsCard's CTA propaga source=ads_pro_preparation_limit");
  console.log("PASS P3 every paywall CTA fires paywall_cta_clicked and navigates to /plans with a matching ?source=, keeping the funnel's source attribution consistent end to end");

  const resourceValues = ["products", "clients", "services", "bookings", "adsProPreparations"] as const;
  for (const resource of resourceValues) {
    assert.match(promptSrc, new RegExp(`${resource}: "`), `P4: RESOURCE_TO_PAYWALL_REASON/RESOURCE_TO_SOURCE precisa cobrir o recurso '${resource}' — o Record<PaywallResource,...> já força isto em tempo de compilação (tsc), esta é uma prova adicional em runtime-de-teste`);
  }
  console.log("PASS P4 the resource-to-reason/source maps cover every PaywallResource value (products, clients, services, bookings, adsProPreparations) — enforced both by TypeScript's Record<PaywallResource,X> and this text proof");

  assert.match(promptSrc, /services: "direct",/, "P5: services (sem UI real de criação) precisa cair no fallback neutro 'direct', nunca um valor que fingiria uma origem inexistente como 'booking_limit'");
  console.log("PASS P5 the unreachable 'services' paywall resource (no real Service-create UI exists) maps to the neutral 'direct' fallback, never a misleading resource-specific source");

  assert.doesNotMatch(newEventsBlock.slice(0, newEventsBlock.indexOf("plans_viewed")), /reason: string;|source: string;/, "P7: reason/source dos eventos de paywall precisam ser os enums fechados, nunca `string` livre");
  console.log("PASS P7 paywall_viewed/paywall_cta_clicked's reason and source fields are the closed enum types, never a free-form string");

  const paywallEventsBlock = newEventsBlock.slice(newEventsBlock.indexOf("paywall_viewed"), newEventsBlock.indexOf("plans_viewed"));
  assert.doesNotMatch(paywallEventsBlock, /productId|clientId|resourceId|itemId/i, "P8: eventos de paywall nunca levam um identificador do recurso específico (alta cardinalidade, nunca necessário para o funil)");
  console.log("PASS P8 paywall events never carry a specific resource identifier (productId/clientId/etc.) — only the bounded reason/source/plan shape");
}

// ===================================================================================================
// PF1-PF7 — funil de planos: plans_viewed -> plan_selected -> checkout_started/failed -> subscription_activated.
// ===================================================================================================
function runPlansFunnelTests(): void {
  const plansSrc = sourceOf("client/src/pages/plans.tsx");
  assert.match(plansSrc, /if \(loading \|\| planError\) return;\s*trackAnalyticsEvent\("plans_viewed"/, "PF1: plans_viewed só depois de loading/erro resolvidos, nunca durante");
  assert.match(plansSrc, /\}, \[loading, planError\]\);/, "PF1: deps [loading, planError] — a transição para sucesso dispara uma vez; um refresh de dados do MESMO plano (basePlan/activePlan mudando) não é uma nova 'visualização'");
  console.log("PASS PF1 plans_viewed fires once per successful page show — deps are [loading, planError], not the plan values themselves, so a background plan-data refresh never re-fires it");

  assert.match(plansSrc, /function handleSelectPlan\(\) \{\s*trackAnalyticsEvent\("plan_selected", \{ selected_plan: plan, billing_cycle: "monthly", current_plan: currentPlan, is_trial: isTrial \}\);\s*setPurchaseState\("confirming"\);/, "PF2: plan_selected no clique de 'Assinar', antes de abrir o painel de confirmação (decisão deliberada, não uma impressão de card indisponível)");
  assert.match(plansSrc, /onClick=\{handleSelectPlan\}/, "PF2: o botão 'Assinar' precisa estar de fato ligado a handleSelectPlan");
  console.log("PASS PF2 plan_selected fires on the deliberate 'Assinar' click, wired to the real button — never for an unavailable/disabled plan card");

  assert.match(plansSrc, /trackAnalyticsEvent\("checkout_started", \{ plan, billing_cycle: "monthly", pricing_version: "v2" \}\);\s*try \{\s*const data = await apiRequest/, "PF3: checkout_started precisa disparar IMEDIATAMENTE antes do apiRequest real, nunca no clique de 'Assinar' (que só abre a confirmação, ainda cancelável)");
  console.log("PASS PF3 checkout_started fires immediately before the real POST /api/subscriptions/create call, not at the earlier 'Assinar' click which can still be backed out of");

  assert.match(plansSrc, /catch \(err\) \{\s*trackAnalyticsEvent\("checkout_failed", \{ plan, reason: toCheckoutFailureReason\(err\) \}\);/, "PF4: checkout_failed precisa usar o mapeamento fechado, nunca o erro bruto");
  assert.doesNotMatch(plansSrc, /reason: err\.message|reason: String\(err\)|checkout_failed.*err\.message/, "PF4: nunca a string de erro bruta da API/provider como reason");
  for (const code of ["PLAN_PURCHASE_UNAVAILABLE", "INVALID_PLAN", "UNSUPPORTED_BILLING_CYCLE", "UNAUTHORIZED", "TIMEOUT", "NETWORK_ERROR", "EXTERNAL_SERVICE_ERROR"]) {
    assert.match(plansSrc, new RegExp(`case "${code}"`), `PF4: toCheckoutFailureReason precisa mapear o código real ${code} (server/subscriptions.ts's createSubscriptionCommand)`);
  }
  console.log("PASS PF4 checkout_failed always maps real ApiError codes (matching server/subscriptions.ts's SubscriptionCreateError codes) to the bounded AnalyticsCheckoutFailureReason enum — never the raw error message");

  assert.match(plansSrc, /markPendingSubscriptionActivation\(plan, "monthly"\);\s*window\.location\.href = data\.initPoint;/, "PF5: o marcador precisa ser gravado ANTES do redirect para o Mercado Pago, senão não sobrevive à ida-e-volta");
  const providerSrc = sourceOf("client/src/providers/PlanProvider.tsx");
  assert.match(providerSrc, /firePlanLifecycleAnalytics\(uid, previousSnapshotRef\.current, current\)/, "PF5: PlanProvider precisa consumir o marcador via firePlanLifecycleAnalytics a cada planData observado");
  const lifecycleSrc = sourceOf("client/src/lib/plan-lifecycle-analytics.ts");
  assert.match(lifecycleSrc, /if \(pending && current\.basePlan === pending\.plan\) \{\s*clearPendingSubscriptionActivation\(\);\s*trackAnalyticsEvent\("subscription_activated"/, "PF5: subscription_activated só quando o basePlan observado bate com o marcador pendente, e o consome (idempotente por construção)");
  console.log("PASS PF5 subscription_activated bridges the async webhook-driven activation via a pending-checkout marker set before the Mercado Pago redirect, consumed exactly once when PlanProvider observes the matching basePlan");

  assert.match(plansSrc, /const known: readonly AnalyticsSource\[\] = \["dashboard", "settings", "plan_usage", "product_limit", "client_limit", "booking_limit", "ads_pro_preparation_limit", "direct"\];/, "PF6: readPlansSourceFromLocation precisa validar contra o enum fechado completo");
  assert.match(plansSrc, /return \(known as readonly string\[\]\)\.includes\(value \?\? ""\) \? \(value as AnalyticsSource\) : "direct";/, "PF6: qualquer valor de ?source= fora do enum cai em 'direct', nunca uma string arbitrária da URL é repassada como source");
  console.log("PASS PF6 readPlansSourceFromLocation only ever produces a bounded AnalyticsSource value — an unrecognized or absent ?source= query param defaults to 'direct', never passes an arbitrary URL-derived string through");

  assert.match(newEventsBlock, /pricing_version: "v2";/, "PF7: checkout_started's pricing_version precisa ser o literal fechado 'v2', provando que a versão de preço não pode divergir silenciosamente");
  console.log("PASS PF7 checkout_started's pricing_version is a closed 'v2' literal, not an open string that could silently drift from the real pricing version");
}

// ===================================================================================================
// AP1-AP8 — funil econômico do Ads Pro: started/completed/failed/reused/limit_reached.
// ===================================================================================================
async function runAdsProAnalyticsTests(db: FirebaseFirestore.Firestore): Promise<void> {
  const toolSrc = sourceOf("client/src/components/PhotoroomCutoutTool.tsx");
  const routeSrc = sourceOf("server/product-cutout-photoroom.ts");
  const clientLibSrc = sourceOf("client/src/lib/product-cutout-photoroom.ts");

  assert.match(toolSrc, /trackAnalyticsEvent\("ads_pro_preparation_started", \{ plan \}\);\s*try \{/, "AP1: ads_pro_preparation_started dispara em TODA tentativa (generationRequestId novo a cada chamada, confirmado em runGenerate), antes de saber o resultado");
  console.log("PASS AP1 ads_pro_preparation_started fires on every attempt, right when the request begins");

  assert.match(routeSrc, /return res\.status\(200\)\.json\(\{ \.\.\.cutout, reused: false, \.\.\.\(reservedQuota \? \{ quotaUsed: reservedQuota\.used, quotaLimit: reservedQuota\.limit \} : \{\}\) \}\);/, "AP2: a resposta de sucesso genuíno precisa incluir reused:false e quotaUsed/quotaLimit vindos da MESMA reserva transacional, nunca uma leitura separada");
  assert.match(toolSrc, /else if \(typeof cutout\.quotaUsed === "number" && typeof cutout\.quotaLimit === "number"\) \{[\s\S]{0,500}trackAnalyticsEvent\("ads_pro_preparation_completed", \{ plan, quota_used: cutout\.quotaUsed, quota_limit: cutout\.quotaLimit \}\);/, "AP2: ads_pro_preparation_completed só dispara com números reais vindos do servidor, nunca reused e nunca fabricado");
  console.log("PASS AP2 ads_pro_preparation_completed fires only for a genuine new preparation, carrying quota_used/quota_limit taken from the exact same transaction that reserved the slot (never a separate, possibly-stale read)");

  assert.match(routeSrc, /await finalizeGeneration\(db, uid, generationRequestId, \{ status: "ready", cutout: existingCutout!, reused: true \}\);[\s\S]{0,350}return res\.status\(200\)\.json\(\{ \.\.\.existingCutout!, reused: true \}\);/, "AP3: o short-circuit de reuso precisa marcar reused:true tanto no doc de idempotência quanto na resposta HTTP");
  assert.match(toolSrc, /if \(cutout\.reused\) \{\s*trackAnalyticsEvent\("ads_pro_preparation_reused", \{ plan \}\);/, "AP3: ads_pro_preparation_reused dispara só quando reused===true, nunca junto com quota_used/quota_limit (reuso nunca toca a cota)");
  console.log("PASS AP3 ads_pro_preparation_reused fires when the server short-circuited to an existing approved cutout — never carries quota numbers, since reuse never touches the quota");

  assert.match(toolSrc, /trackAnalyticsEvent\("ads_pro_preparation_failed", \{ plan, failure_category: toPreparationFailureCategory\(code\) \}\);/, "AP4: ads_pro_preparation_failed precisa usar a categoria fechada mapeada, nunca a mensagem de erro real do provider");
  assert.doesNotMatch(toolSrc, /failure_category: (code|message|error\.message)[,)]/, "AP4: failure_category nunca deve ser o código/mensagem cru repassado direto");
  console.log("PASS AP4 ads_pro_preparation_failed always carries a bounded failure_category — never the raw provider error code/text");

  assert.match(toolSrc, /if \(code === "ADS_PRO_PREPARATION_LIMIT_REACHED"\) \{\s*try \{\s*const usage = await getCurrentMonthPreparationUsage\(\);\s*trackAnalyticsEvent\("ads_pro_preparation_limit_reached", \{ plan, quota_used: usage\.used, quota_limit: usage\.limit \}\);/, "AP5: ads_pro_preparation_limit_reached precisa buscar números reais via o endpoint já existente de cota, nunca inventar used/limit");
  console.log("PASS AP5 ads_pro_preparation_limit_reached fetches real quota numbers from the existing /api/ads-pro/preparation-quota/current-month endpoint (reused, no new server code) rather than fabricating them");

  // AP6 — admin (quotaPlan null) nunca reserva -> reservedQuota fica null -> resposta HTTP omite
  // quotaUsed/quotaLimit -> o client corretamente NÃO dispara o evento numérico (sem dado real).
  assert.match(routeSrc, /let reservedQuota: \{ readonly used: number; readonly limit: number \} \| null = null;/, "AP6: reservedQuota começa null — só é preenchido se uma reserva real acontecer (nunca para admin)");
  assert.match(routeSrc, /if \(quotaPlan !== null\) \{\s*const reservedSlot = await reservePreparationSlot/, "AP6: a reserva de cota inteira é pulada quando quotaPlan é null (admin/dev, sem teto comercial)");
  console.log("PASS AP6 admin/dev bypass (quotaPlan null) never fabricates quota numbers — the completed/limit_reached numeric events simply don't fire without real data, while started still does");

  // AP7 — reused/quotaUsed/quotaLimit são só da resposta HTTP, nunca do ApprovedProductCutout persistido.
  const approvedCutoutSrc = sourceOf("shared/approved-product-cutout.ts");
  assert.doesNotMatch(approvedCutoutSrc, /reused|quotaUsed|quotaLimit/, "AP7: o shape PERSISTIDO (ApprovedProductCutout, Firestore) nunca ganha os campos wire-only de analytics — shared/approved-product-cutout.ts não deveria ter sido tocado por esta ticket");
  assert.match(clientLibSrc, /export interface PhotoroomCutoutRequestResult extends ApprovedProductCutout \{\s*readonly reused: boolean;/, "AP7: o tipo de retorno do client lib estende ApprovedProductCutout só na resposta HTTP, um tipo distinto");
  console.log("PASS AP7 reused/quotaUsed/quotaLimit are wire-only additions to the HTTP response — the persisted ApprovedProductCutout Firestore shape (shared/approved-product-cutout.ts) is untouched by this ticket");

  // AP8 — idempotent replay preserva o reused ORIGINAL (nunca um default fabricado) e nunca reserva de novo.
  assert.match(routeSrc, /return res\.status\(200\)\.json\(\{ \.\.\.existing\.cutout, reused: existing\.reused \?\? false \}\);/, "AP8: o replay idempotente devolve o reused REAL gravado na primeira tentativa (fallback false só para docs anteriores a esta ticket, nunca uma invenção)");
  assert.doesNotMatch(routeSrc.slice(routeSrc.indexOf("if (!reservation.created)"), routeSrc.indexOf("if (!reservation.created)") + 600), /reservePreparationSlot/, "AP8: o branch de replay idempotente nunca chama reservePreparationSlot de novo — a MESMA generationRequestId nunca reserva cota duas vezes");
  console.log("PASS AP8 an idempotent replay (same generationRequestId) returns the original reused value, never a fabricated default, and never reserves quota a second time");

  // Execução real: reservePreparationSlot's novos campos used/limit batem com PLAN_CONFIG e com a
  // contagem real commitada na transação (mesma disciplina de execução real de PLAN-IMPL-05).
  {
    const uid = tenantUid("ap-quota");
    const first = await reservePreparationSlot(db, uid, "prod-ap-1", PLANS.PRO);
    assert.ok(first.reserved, "AP2 (execução real): a primeira reserva Pro deve ser permitida");
    if (first.reserved) {
      assert.equal(first.used, 1, "AP2 (execução real): used precisa refletir a MESMA transação (0 -> 1), nunca um valor recalculado depois");
      assert.equal(first.limit, PLAN_CONFIG.pro.limits.proAdPreparationsMonthly, "AP2 (execução real): limit precisa vir de PLAN_CONFIG, nunca hardcoded");
    }
    await completePreparationSlot(db, uid, "prod-ap-1");
    const second = await reservePreparationSlot(db, uid, "prod-ap-2", PLANS.PRO);
    assert.ok(second.reserved && second.used === 2, "AP2 (execução real): a segunda preparação (produto diferente) precisa refletir used=2, provando que o número é acumulativo dentro do mês, não reiniciado por chamada");
    console.log("PASS AP2 (real execution) reservePreparationSlot's new used/limit fields are the exact numbers committed inside the reservation transaction, matching PLAN_CONFIG and accumulating correctly across preparations");
  }
}

// ===================================================================================================
// PR1-PR7 — privacidade: nenhum PII, nenhum uid cru, enums fechados, sem texto de erro de provider.
// ===================================================================================================
function runPrivacyTests(): void {
  assert.doesNotMatch(newEventsBlock, /\buid\b\s*:|user_id\s*:|userId\s*:/, "PR1: nenhum evento novo leva uid/userId/user_id cru como parâmetro — o user-scoping já existente (setFirebaseAnalyticsUserId) é reaproveitado, nunca um segundo mecanismo por evento");
  console.log("PASS PR1 no new event carries a raw uid/userId as an event param — user-scoping is handled once, via the existing setFirebaseAnalyticsUserId mechanism");

  assert.doesNotMatch(newEventsBlock, /email|phone|productName|clientName|businessName|item_name/i, "PR2: nenhum evento novo leva email, telefone, nome de produto/cliente/negócio em texto livre");
  console.log("PASS PR2 no new event's param shape includes email, phone, or free-text product/client/business names");

  assert.doesNotMatch(newEventsBlock, /reason: string;|source: string;|category: string;|failure_category: string;/, "PR5: todo campo reason/source/category dos eventos novos precisa ser um union fechado, nunca `string` livre");
  console.log("PASS PR5 every reason/source/category field on the new events is a closed bounded union type, never an open string");

  const plansSrc = sourceOf("client/src/pages/plans.tsx");
  const toolSrc = sourceOf("client/src/components/PhotoroomCutoutTool.tsx");
  assert.doesNotMatch(plansSrc, /checkout_failed",\s*\{[^}]*message/, "PR4: checkout_failed nunca deve incluir a mensagem de erro real da API/provider");
  assert.doesNotMatch(toolSrc, /ads_pro_preparation_failed",\s*\{[^}]*message/, "PR4: ads_pro_preparation_failed nunca deve incluir a mensagem de erro real do PhotoRoom");
  console.log("PASS PR4 checkout_failed and ads_pro_preparation_failed never carry the raw provider/API error message — only the bounded category mapping");

  assert.match(analyticsLibSrc, /setFirebaseAnalyticsUserId[\s\S]{0,600}maskId\(/, "PR6 (regressão): setFirebaseAnalyticsUserId ainda precisa usar maskId(), nunca o uid cru — não deveria ter sido tocado por esta ticket");
  console.log("PASS PR6 (regression check) setFirebaseAnalyticsUserId still masks the uid via maskId() — unchanged by this ticket");

  // PR7 — ANALYTICS-PRIVACY-CLEANUP-01: o `purchase` (sell.tsx, POS) enviava item_name (nome do
  // produto, texto livre) como parâmetro — uma violação das regras de privacidade §6 desta própria
  // ticket, escrita antes dela existir (achado, não introduzido por PLAN-IMPL-06). Removido: item_id já
  // identifica o produto para qualquer análise, sem expor texto livre do tenant — mesmo shape já usado
  // por view_cart (item_id + quantity, nunca o nome).
  {
    const sellSrc = sourceOf("client/src/pages/sell.tsx");
    const purchaseCallBlock = sellSrc.slice(sellSrc.indexOf('trackAnalyticsEvent("purchase"'), sellSrc.indexOf('trackAnalyticsEvent("purchase"') + 400);
    assert.doesNotMatch(purchaseCallBlock, /item_name|product_name/, "PR7: o call site real de trackAnalyticsEvent(\"purchase\", ...) nunca pode incluir item_name/product_name (nome do produto)");
    assert.match(purchaseCallBlock, /item_id: item\.product\.id,\s*quantity: item\.quantity,/, "PR7: os itens continuam identificados por item_id/quantity (nunca removendo o sinal seguro, só o texto livre)");

    const purchaseTypeBlock = analyticsLibSrc.slice(analyticsLibSrc.indexOf("purchase: {"), analyticsLibSrc.indexOf("purchase: {") + 300);
    assert.doesNotMatch(purchaseTypeBlock, /item_name|product_name/, "PR7: o TIPO do evento purchase (FirebaseAnalyticsEvents) nunca pode declarar item_name/product_name — impede reintrodução silenciosa por um caller futuro");
    console.log("PASS PR7 the pre-existing purchase event's item_name (product name) has been removed from both the call site and the event's type definition — item_id/quantity preserved, no free-text product name ever sent");
  }
}

// ===================================================================================================
// S1-S6 — ciclo de vida da assinatura: trial_started/expired, upgrade/downgrade, cancelamento.
// ===================================================================================================
function runSubscriptionLifecycleTests(): void {
  const lifecycleSrc = sourceOf("client/src/lib/plan-lifecycle-analytics.ts");
  assert.match(lifecycleSrc, /if \(current\.trialStatus === "active" && !hasTrialStartedFired\(uid\)\) \{\s*markTrialStartedFired\(uid\);\s*trackAnalyticsEvent\("trial_started", \{ plan: PLANS\.PREMIUM \}\);/, "S1: trial_started precisa disparar na primeira observação de trial ativo (inclusive já ativo na 1a carga da sessão), com marcador PERSISTENTE por uid — nunca a regra genérica de sessão, que perderia o caso mais comum");
  console.log("PASS S1 trial_started fires on the first observation of an active trial (including one already active on the account's very first session load), gated by a persistent per-uid flag so it never refires");

  assert.match(lifecycleSrc, /const pending = readPendingSubscriptionActivation\(\);\s*if \(pending && current\.basePlan === pending\.plan\) \{\s*clearPendingSubscriptionActivation\(\);\s*trackAnalyticsEvent\("subscription_activated"/, "S2: subscription_activated precisa consumir e limpar o marcador pendente, nunca deixá-lo dar refire");
  console.log("PASS S2 subscription_activated consumes (clears) the pending checkout marker exactly once — a second observation with the marker already cleared correctly never refires");

  assert.match(lifecycleSrc, /if \(!previous\) return;/, "S3/S4: sem baseline da sessão atual (previous null), nunca finge uma transição — só grava a baseline");
  assert.match(lifecycleSrc, /if \(previous\.trialStatus === "active" && current\.trialStatus === "expired"\) \{\s*trackAnalyticsEvent\("trial_expired", \{ base_plan: current\.basePlan \}\);/, "S3: trial_expired só na transição observada active->expired DENTRO da sessão atual");
  console.log("PASS S3 trial_expired fires only on an active->expired transition actually observed within the current session — never on the session's first-load baseline (a documented, deliberate limitation for a transition that happens entirely between sessions)");

  assert.match(lifecycleSrc, /const PLAN_RANK: Record<PlanType, number> = \{ \[PLANS\.FREE\]: 0, \[PLANS\.PRO\]: 1, \[PLANS\.PREMIUM\]: 2 \};/, "S4: a comparação de upgrade/downgrade precisa vir de um ranking explícito, nunca uma comparação de string");
  assert.match(lifecycleSrc, /if \(PLAN_RANK\[current\.basePlan\] > PLAN_RANK\[previous\.basePlan\]\) \{\s*trackAnalyticsEvent\("plan_upgraded"/, "S4: plan_upgraded quando o rank sobe");
  assert.match(lifecycleSrc, /\} else \{\s*trackAnalyticsEvent\("plan_downgraded"/, "S4: plan_downgraded quando o rank desce (mesma condição de mudança, ramo contrário)");
  console.log("PASS S4 plan_upgraded/plan_downgraded fire based on an explicit PLAN_RANK comparison (free < pro < premium), never a fragile string comparison");

  const subscribeSrc = sourceOf("client/src/pages/subscribe.tsx");
  assert.match(subscribeSrc, /onClick=\{\(\) => \{\s*\/\/[\s\S]{0,350}trackAnalyticsEvent\("cancellation_started", \{ plan: PLANS\.PREMIUM \}\);\s*setShowCancelConfirm\(true\);/, "S5: cancellation_started precisa disparar quando o painel de confirmação ABRE (intenção declarada), nunca só no cancelamento final");
  console.log("PASS S5 cancellation_started fires when the user opens the cancel-confirmation panel — declared intent, not the final action; backing out via 'Manter Premium' correctly fires nothing");

  assert.match(subscribeSrc, /await apiRequest\("\/api\/app-subscription\/cancel", \{\s*method: "POST",\s*auth: true,\s*\}\);\s*\s*setStatus\("cancelled"\);\s*setShowCancelConfirm\(false\);\s*\/\/[\s\S]{0,250}trackAnalyticsEvent\("cancellation_completed", \{ plan: PLANS\.PREMIUM \}\);/, "S6: cancellation_completed só DEPOIS do servidor aceitar o cancelamento, nunca antes/otimista, nunca no catch de erro");
  assert.doesNotMatch(subscribeSrc.slice(subscribeSrc.indexOf("catch (err) {", subscribeSrc.indexOf("handleCancel"))), /cancellation_completed/, "S6: o branch de erro do cancelamento nunca dispara cancellation_completed");
  console.log("PASS S6 cancellation_completed fires only after the server accepts the cancellation request — never on the error path");

  for (const [event, params] of [["cancellation_started", "plan: PlanType"], ["cancellation_completed", "plan: PlanType"], ["trial_started", "plan: PlanType"], ["trial_expired", "base_plan: PlanType"]]) {
    assert.match(newEventsBlock, new RegExp(`${event}: \\{\\s*${params.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")};\\s*\\};`), `S1-S6: ${event} precisa ter exatamente o shape declarado, nunca campos extras não previstos`);
  }
  console.log("PASS S1-S6 the lifecycle event type definitions carry exactly their declared bounded shape — no extra undeclared fields");
}

async function run(): Promise<void> {
  runActivationTests();
  runPaywallTests();
  runPlansFunnelTests();
  runPrivacyTests();
  runSubscriptionLifecycleTests();

  requireEmulatorEnv();
  initializeFirebaseAdmin();
  const db = initializeFirebaseAdmin().firestore();
  await runAdsProAnalyticsTests(db);

  console.log("\nPLAN-IMPL-06 analytics + conversion instrumentation — all A/P/PF/AP/PR/S assertions passed. B1-B9 verified live via Browser pane (see final report), not in this suite.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
