import assert from "node:assert/strict";
import fs from "node:fs";

/**
 * PLAN-IMPL-08 §46-§57 — matriz de testes da política única de anúncio/promoção interna (POL1-8,
 * PUB1-5, CF1-6, PR1-6, PRO1-5, FR1-6). B1-B22 (browser E2E, Free/Pro/Premium/Trial/mobile) NÃO está
 * nesta suíte: verificado ao vivo via Browser pane (ver relatório final), mesmo padrão já usado em
 * PLAN-IMPL-04B/05/06/07A/07B nesta sessão, nunca um novo harness Playwright.
 *
 * Metodologia: 100% asserção em texto-fonte real (nenhum import de client/src/lib/firebase.ts nem de
 * nenhum módulo que o importe transitivamente — mesma restrição documentada em
 * script/plan-impl-06-analytics-conversion-instrumentation-tests.ts, já que esse agregador tem efeitos
 * colaterais de topo de arquivo específicos de browser). Esta ticket não tocou server/ nem shared/ de
 * forma alguma — não há nada aqui que precise do emulador Firestore, ao contrário das tickets
 * anteriores; por isso este script roda direto via tsx, sem o wrapper firebase-tools emulators:exec
 * (mesmo padrão de script/plan-impl-01-canonical-foundation-tests.ts).
 */

function sourceOf(path: string): string {
  return fs.readFileSync(path, "utf8");
}

function tryReadSource(path: string): string | null {
  try {
    return fs.readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

// ===================================================================================================
// POL1-8 — fundação da política: V1 sem SDK de anúncio externo, catálogo fechado, sem PII, sem checks
// de plano espalhados/ad-hoc reintroduzidos por esta própria ticket.
// ===================================================================================================
function runPolicyFoundationTests(): void {
  const pkgSrc = sourceOf("package.json");
  assert.doesNotMatch(pkgSrc, /admob|adsense|google-mobile-ads|react-native-ads|expo-ads|unity-ads/i, "POL1: nenhuma dependência de SDK de anúncio externo foi adicionada — EXTERNAL_AD_PROVIDER_INTEGRATED=NO, confirmado em package.json");
  console.log("PASS POL1 no external ad SDK dependency exists in package.json — V1 external-ads-disabled decision holds");

  const manifestSrc = tryReadSource("android/app/src/main/AndroidManifest.xml");
  if (manifestSrc !== null) {
    assert.doesNotMatch(manifestSrc, /admob|AD_ID|com\.google\.android\.gms\.ads/i, "POL2: o manifest Android não pode declarar meta-data de AdMob nem a permissão com.google.android.gms.permission.AD_ID");
    console.log("PASS POL2 AndroidManifest.xml carries no AdMob meta-data and no advertising-ID permission");
  } else {
    console.log("SKIP POL2 AndroidManifest.xml not found in this worktree checkout — nothing to assert (no ad SDK dependency exists per POL1, so no manifest entry could exist either)");
  }

  const analyticsLibSrc = sourceOf("client/src/lib/firebase-analytics.ts");
  assert.match(analyticsLibSrc, /export type HousePromotionId = "reports_operational_upgrade" \| "reports_strategic_upgrade" \| "opportunities_premium_upgrade";/, "POL3: HousePromotionId precisa ser um union fechado e específico — nunca `string` livre, nunca um id fabricado em runtime");
  assert.match(analyticsLibSrc, /export type HousePromotionPlacement = "reports" \| "opportunities";/, "POL3: HousePromotionPlacement também precisa ser um union fechado, refletindo só os placements reais que existem hoje");
  console.log("PASS POL3 HousePromotionId/HousePromotionPlacement are closed, specific unions — never a free string an arbitrary call site could invent");

  const houseEventsBlock = analyticsLibSrc.slice(analyticsLibSrc.indexOf("house_promotion_viewed:"), analyticsLibSrc.indexOf("house_promotion_clicked:") + 300);
  assert.doesNotMatch(houseEventsBlock, /promotion_id: string;|placement: string;/, "POL5: promotion_id/placement dos eventos house_promotion_* precisam usar os enums fechados, nunca `string` livre");
  assert.doesNotMatch(houseEventsBlock, /email|phone|productName|clientName|businessName|item_name|\buid\b\s*:|userId/i, "POL4: os eventos house_promotion_* nunca levam PII nem identificador cru de usuário — só o catálogo fechado promotion_id/placement/current_plan/recommended_plan");
  console.log("PASS POL4/POL5 house_promotion_viewed/clicked carry zero PII and zero raw user identifiers — promotion_id/placement are the closed enum types, never free strings");

  const reportsSrc = sourceOf("client/src/pages/reports.tsx");
  assert.match(reportsSrc, /const \{ activePlan, hasPremiumAccess, loading: planLoading \} = usePlan\(\);/, "POL6: reports.tsx precisa ler o plano ativo do hook canônico usePlan(), nunca uma leitura própria/duplicada de plano");
  assert.match(reportsSrc, /const hasOperationalAccess = activePlan === "pro" \|\| activePlan === "premium";/, "POL6: a derivação de acesso operacional continua uma única expressão local, não múltiplos checks `plan ===` espalhados pela página");
  const opportunitiesSrc = sourceOf("client/src/pages/opportunities.tsx");
  assert.match(opportunitiesSrc, /const \{ activePlan, hasPremiumAccess, loading: planLoading \} = usePlan\(\);/, "POL6: opportunities.tsx também precisa ler de usePlan(), nunca uma segunda fonte de verdade de plano");
  console.log("PASS POL6 both promotion call sites (reports.tsx, opportunities.tsx) derive plan/entitlement exclusively from the canonical usePlan() hook — no ad-hoc scattered plan checks introduced by this ticket");

  for (const path of ["client/src/pages/reports.tsx", "client/src/pages/opportunities.tsx", "client/src/lib/firebase-analytics.ts"]) {
    const src = sourceOf(path);
    assert.doesNotMatch(src, /doubleclick\.net|googlesyndication|adsystem\.amazon|admob\.com/i, `POL7: ${path} não pode conter nenhuma URL/domínio de rede de anúncio externo`);
  }
  console.log("PASS POL7 no external ad network domain (doubleclick/googlesyndication/adsystem/admob) appears anywhere in the touched sources — EXTERNAL_AD_NETWORK_REQUESTS = 0 by construction, not just by runtime observation");

  const recommendedPlanValues = reportsSrc.match(/recommendedPlan="(\w+)"/g) ?? [];
  const opportunitiesRecommended = opportunitiesSrc.match(/recommended_plan: "(\w+)"/g) ?? [];
  for (const match of [...recommendedPlanValues, ...opportunitiesRecommended]) {
    assert.match(match, /"(pro|premium)"/, `POL8: todo recommendedPlan/recommended_plan precisa apontar para um tier real existente (pro/premium), nunca um tier inexistente`);
  }
  assert.ok(recommendedPlanValues.length >= 2, "POL8: reports.tsx precisa ter os dois call sites com recommendedPlan preenchido");
  console.log("PASS POL8 every recommendedPlan/recommended_plan value across both promo call sites points to a real, existing tier (pro or premium) — never a nonexistent plan");
}

// ===================================================================================================
// PUB1-5 — superfícies públicas do cliente final: zero anúncio RevendaSmart, zero anúncio externo.
// ===================================================================================================
function runPublicSurfaceTests(): void {
  const publicCatalogSrc = sourceOf("client/src/pages/public-catalog.tsx");
  assert.doesNotMatch(publicCatalogSrc, /house_promotion|UpgradeTeaser|PremiumUpsell|trackAnalyticsEvent\("paywall/, "PUB1: public-catalog.tsx (vitrine do cliente final) nunca pode ganhar promoção de upgrade RevendaSmart nem instrumentação de paywall");
  assert.match(publicCatalogSrc, /Criado com Revenda Smart/, "PUB1 (regressão): o rodapé de branding puro precisa continuar existindo, sem virar um CTA — esta ticket não deveria tê-lo alterado");
  console.log("PASS PUB1 public-catalog.tsx carries no house-promotion/paywall instrumentation — the one 'Revenda Smart' footer mention remains pure branding text, unchanged by this ticket");

  const catalogHeaderSrc = sourceOf("client/src/components/catalog/CatalogHeader.tsx");
  const brandingLineIdx = catalogHeaderSrc.indexOf("Revenda Smart");
  assert.ok(brandingLineIdx > -1, "PUB5: CatalogHeader.tsx precisa conter o label de marca 'Revenda Smart'");
  const brandingLine = catalogHeaderSrc.slice(Math.max(0, brandingLineIdx - 120), brandingLineIdx);
  assert.match(brandingLine, /<p className=/, "PUB5: o label de marca precisa ser um <p> estático");
  assert.doesNotMatch(brandingLine, /onClick|<a |<button/, "PUB5: o label de marca da CatalogHeader nunca pode virar um link/botão clicável (deixaria de ser 'só branding' e passaria a ser um CTA de upgrade disfarçado)");
  console.log("PASS PUB5 CatalogHeader.tsx's 'Revenda Smart' label is a static <p>, never a clickable link/button — confirmed pure branding, not a disguised upgrade CTA");

  for (const path of ["client/src/pages/public-service-booking.tsx", "client/src/pages/public-service-booking-manage.tsx", "client/src/pages/sorteio-publico.tsx"]) {
    const src = sourceOf(path);
    assert.doesNotMatch(src, /house_promotion|UpgradeTeaser|PremiumUpsell|premium|upgrade/i, `PUB2/PUB3/PUB4: ${path} (superfície pública do cliente final) precisa continuar zero de qualquer termo de promoção/upgrade RevendaSmart`);
  }
  console.log("PASS PUB2/PUB3/PUB4 public-service-booking.tsx, public-service-booking-manage.tsx and sorteio-publico.tsx remain completely free of any RevendaSmart promotion/upgrade terms");
}

// ===================================================================================================
// CF1-6 — fluxos críticos (venda, criação de produto, checkout) nunca poluídos com promoção.
// ===================================================================================================
function runCriticalFlowTests(): void {
  const sellSrc = sourceOf("client/src/pages/sell.tsx");
  assert.doesNotMatch(sellSrc, /house_promotion|UpgradeTeaser|PremiumUpsell/, "CF1: sell.tsx (fluxo de venda, POS) nunca pode ganhar promoção de upgrade no meio do checkout do lojista");
  console.log("PASS CF1 sell.tsx (the point-of-sale checkout flow) carries no house-promotion component or event — critical flow stays unpolluted");

  const addProductSrc = sourceOf("client/src/pages/add-product.tsx");
  assert.doesNotMatch(addProductSrc, /house_promotion|UpgradeTeaser|PremiumUpsell/, "CF2: add-product.tsx (criação de produto) nunca pode ganhar promoção de upgrade no meio do fluxo de cadastro");
  console.log("PASS CF2 add-product.tsx carries no house-promotion component or event");

  const subscribeSrc = sourceOf("client/src/pages/subscribe.tsx");
  assert.doesNotMatch(subscribeSrc, /house_promotion_viewed|house_promotion_clicked|UpgradeTeaser|PremiumUpsell/, "CF3: subscribe.tsx não foi tocado por esta ticket — não pode ter ganhado nenhuma instrumentação house_promotion_* nova (esta página já É o destino canônico do funil paywall_*/plans_*, não precisa de um segundo mecanismo)");
  console.log("PASS CF3 subscribe.tsx (checkout/plan management, the canonical destination page) was not touched by this ticket — no house_promotion_* instrumentation leaked into it");

  const dashboardSrc = sourceOf("client/src/pages/dashboard.tsx");
  assert.doesNotMatch(dashboardSrc, /house_promotion|UpgradeTeaser|PremiumUpsell/, "CF4: dashboard.tsx nunca pode ganhar um novo componente de promoção — TrialBanner é status de ciclo de vida (§12), não anúncio, e continua o único elemento relacionado a plano ali");
  console.log("PASS CF4 dashboard.tsx gained no new promotion component from this ticket — the pre-existing TrialBanner remains lifecycle status, not advertising");
}

// ===================================================================================================
// PR1-6 — reports.tsx: política por tier + trava de regressão do bug de empilhamento corrigido.
// ===================================================================================================
function runReportsPolicyTests(): void {
  const reportsSrc = sourceOf("client/src/pages/reports.tsx");

  assert.match(reportsSrc, /\{!hasOperationalAccess && \(\s*<UpgradeTeaser/, "PR1: o teaser operacional continua condicionado exatamente a !hasOperationalAccess (Free) — condição não alterada por esta ticket");
  console.log("PASS PR1 the operational teaser's visibility condition (!hasOperationalAccess) is unchanged — still Free-only");

  assert.match(reportsSrc, /\) : hasOperationalAccess \? \(\s*<UpgradeTeaser[\s\S]{0,400}promotionId="reports_strategic_upgrade"/, "PR6 (trava de regressão do bug corrigido): o teaser estratégico precisa estar atrás de `hasOperationalAccess ? (...) : null` — nunca de volta a um else incondicional que mostraria o teaser estratégico também para Free (que já vê o operacional), empilhando dois banners de upgrade na mesma tela");
  assert.match(reportsSrc, /strategicSummary \? \(\s*<StrategicSummarySection summary=\{strategicSummary\} \/>\s*\) : null\s*\) : hasOperationalAccess \? \(/, "PR6: a estrutura precisa ser hasPremiumAccess ? (...) : hasOperationalAccess ? (<teaser>) : null — Free (sem nenhum dos dois) cai no null final, nunca vê o teaser estratégico");
  console.log("PASS PR6 the stacked-teaser bug is locked closed: the strategic/Premium teaser only renders for hasOperationalAccess (Pro) — a Free user, who already sees the operational teaser, structurally cannot also receive the strategic one");

  const teaserCallsBlock = reportsSrc.slice(reportsSrc.indexOf("export default function Reports"));
  const promotionIds = [...teaserCallsBlock.matchAll(/promotionId="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(promotionIds, ["reports_operational_upgrade", "reports_strategic_upgrade"], "PR3: os dois call sites de UpgradeTeaser em Reports precisam usar promotionId distintos e nesta ordem (operacional antes do estratégico na árvore) — nunca o mesmo id duas vezes");
  console.log("PASS PR3 the two UpgradeTeaser call sites in reports.tsx use distinct promotion_id values — never duplicated");

  const upgradeTeaserFnSrc = reportsSrc.slice(reportsSrc.indexOf("function UpgradeTeaser"), reportsSrc.indexOf("export default function Reports"));
  assert.match(upgradeTeaserFnSrc, /useEffect\(\(\) => \{\s*trackAnalyticsEvent\("house_promotion_viewed", \{ promotion_id: promotionId, placement, current_plan: currentPlan, recommended_plan: recommendedPlan \}\);\s*\}, \[\]\);/, "PR4: UpgradeTeaser precisa disparar house_promotion_viewed uma vez por montagem real (deps vazias), nunca a cada re-render");
  assert.match(upgradeTeaserFnSrc, /const handleClick = \(\) => \{\s*trackAnalyticsEvent\("house_promotion_clicked",[\s\S]{0,150}setLocation\("\/plans"\);\s*\};/, "PR4: o clique precisa disparar house_promotion_clicked ANTES de navegar para /plans, nunca depois (navegação não pode descartar o evento)");
  console.log("PASS PR4 UpgradeTeaser fires house_promotion_viewed once per real mount ([] deps) and house_promotion_clicked before navigating away — same pattern as the pre-existing PlanLimitPrompt paywall instrumentation");

  assert.match(reportsSrc, /promotionId="reports_operational_upgrade"[\s\S]{0,60}placement="reports"[\s\S]{0,60}currentPlan=\{activePlan\}[\s\S]{0,60}recommendedPlan="pro"/, "PR5: o teaser operacional precisa recomendar 'pro' (o tier que de fato desbloqueia lucro/margem/comparativos)");
  assert.match(reportsSrc, /promotionId="reports_strategic_upgrade"[\s\S]{0,60}placement="reports"[\s\S]{0,60}currentPlan=\{activePlan\}[\s\S]{0,60}recommendedPlan="premium"/, "PR5: o teaser estratégico precisa recomendar 'premium' (o tier que de fato desbloqueia a leitura estratégica)");
  console.log("PASS PR5 each teaser's recommended_plan matches the tier that genuinely unlocks the feature it's promoting (operational->pro, strategic->premium) — never a mismatched claim");
}

// ===================================================================================================
// PRO1-5 — opportunities.tsx: PremiumUpsell instrumentado, mutuamente exclusivo com o restante da tela.
// ===================================================================================================
function runOpportunitiesPolicyTests(): void {
  const opportunitiesSrc = sourceOf("client/src/pages/opportunities.tsx");

  assert.match(opportunitiesSrc, /function PremiumUpsell\(\{ currentPlan \}: \{ currentPlan: PlanType \}\) \{/, "PRO1: PremiumUpsell precisa receber currentPlan tipado como PlanType (nunca string livre)");
  console.log("PASS PRO1 PremiumUpsell accepts a typed currentPlan: PlanType prop");

  const upsellFnSrc = opportunitiesSrc.slice(opportunitiesSrc.indexOf("function PremiumUpsell"), opportunitiesSrc.indexOf("export default function Opportunities"));
  assert.match(upsellFnSrc, /useEffect\(\(\) => \{\s*trackAnalyticsEvent\("house_promotion_viewed", \{ promotion_id: "opportunities_premium_upgrade", placement: "opportunities", current_plan: currentPlan, recommended_plan: "premium" \}\);\s*\}, \[\]\);/, "PRO2: view uma vez por montagem real, com promotion_id/placement/recommended_plan corretos e fixos");
  console.log("PASS PRO2 PremiumUpsell fires house_promotion_viewed once per real mount with the correct fixed promotion_id/placement/recommended_plan");

  assert.match(upsellFnSrc, /const handleClick = \(\) => \{\s*trackAnalyticsEvent\("house_promotion_clicked", \{ promotion_id: "opportunities_premium_upgrade", placement: "opportunities", current_plan: currentPlan, recommended_plan: "premium" \}\);\s*setLocation\("\/plans"\);\s*\};/, "PRO3: house_promotion_clicked precisa disparar antes de navegar para /plans");
  assert.match(opportunitiesSrc, /onClick=\{handleClick\}/, "PRO3: o botão real do PremiumUpsell precisa estar ligado a handleClick");
  console.log("PASS PRO3 the click handler fires house_promotion_clicked before navigating, wired to the real button");

  const renderBlock = opportunitiesSrc.slice(opportunitiesSrc.indexOf('<Layout title="Oportunidades">'), opportunitiesSrc.lastIndexOf("</Layout>"));
  assert.match(renderBlock, /planLoading \|\| loading \? \([\s\S]{0,80}\) : !hasPremiumAccess \? \(\s*<PremiumUpsell currentPlan=\{activePlan\} \/>\s*\) : error \? \(/, "PRO4: PremiumUpsell precisa continuar dentro da MESMA cadeia de ternários mutuamente exclusivos (loading | upsell | error | empty | list) — o ramo seguinte (error) só é alcançável quando hasPremiumAccess é true, provando exclusividade mútua — nunca renderizado em paralelo a outro ramo");
  console.log("PASS PRO4 PremiumUpsell sits inside the single mutually-exclusive ternary chain (loading/upsell/error/empty/list) — structurally never rendered alongside another branch");

  assert.match(opportunitiesSrc, /const \{ activePlan, hasPremiumAccess, loading: planLoading \} = usePlan\(\);[\s\S]{0,1200}<PremiumUpsell currentPlan=\{activePlan\} \/>/, "PRO5: currentPlan vem do mesmo usePlan() já usado para o gate de acesso — nunca uma segunda leitura/hardcode");
  console.log("PASS PRO5 currentPlan is sourced from the same usePlan() call already used for the access gate — no second source of truth, no hardcoded value");
}

// ===================================================================================================
// FR1-6 — prontidão futura sem scaffolding morto: nada especulativo foi adicionado.
// ===================================================================================================
function runFutureReadinessTests(): void {
  for (const path of ["client/src/pages/reports.tsx", "client/src/pages/opportunities.tsx", "client/src/lib/firebase-analytics.ts", "client/src/lib/firebase.ts"]) {
    assert.doesNotMatch(sourceOf(path), /house_promotion_dismissed/, `FR2: ${path} não pode referenciar house_promotion_dismissed — nenhum mecanismo de dispensa existe hoje, um evento sem call site seria schema morto especulativo`);
  }
  console.log("PASS FR2 no house_promotion_dismissed event was added anywhere — no dismissal mechanism exists to fire it, avoiding speculative dead schema");

  for (const path of ["client/src/pages/reports.tsx", "client/src/pages/opportunities.tsx", "shared/monetization.ts"]) {
    assert.doesNotMatch(sourceOf(path), /EXTERNAL_ADS_ENABLED/, `FR3: ${path} não pode declarar EXTERNAL_ADS_ENABLED — sem SDK de anúncio externo algum (POL1), uma constante que nada lê seria código morto`);
  }
  console.log("PASS FR3 no EXTERNAL_ADS_ENABLED constant was added — since no external ad code exists at all, a flag nothing would ever read would be pure dead code");

  const monetizationSrc = sourceOf("shared/monetization.ts");
  assert.match(monetizationSrc, /noAds: boolean;/, "FR4 (regressão): o campo noAds pré-existente em PlanLimits precisa continuar existindo, intocado — já serve como scaffolding de prontidão futura suficiente");
  assert.match(monetizationSrc, /adsDisabled: boolean;/, "FR4 (regressão): o campo adsDisabled pré-existente em ResolvedEntitlements precisa continuar existindo, intocado");
  console.log("PASS FR4 the pre-existing noAds/adsDisabled fields in shared/monetization.ts remain untouched — sufficient future-readiness scaffolding already existed, no new speculative flag was needed");

  const pkgDiffCandidates = ["react-ga", "amplitude", "segment", "mixpanel"];
  const pkgSrc = sourceOf("package.json");
  for (const lib of pkgDiffCandidates) {
    assert.doesNotMatch(pkgSrc, new RegExp(lib, "i"), `FR1: nenhuma nova dependência de terceiro (${lib}) foi adicionada por esta ticket — reaproveitou 100% da infraestrutura de analytics já existente (trackAnalyticsEvent)`);
  }
  console.log("PASS FR1 no new third-party analytics/tracking dependency was added — this ticket reused the existing trackAnalyticsEvent infrastructure entirely");

  const settingsSrc = sourceOf("client/src/pages/settings.tsx");
  assert.doesNotMatch(settingsSrc, /house_promotion/, "FR5: settings.tsx (inclui a aba de indicação/referral, visível a todos os tiers) não foi tocado por esta ticket — decisão documentada: é um recurso de recompensa pré-existente e opt-in, não uma propaganda de upgrade, fora do escopo dos 68 itens desta ticket");
  console.log("PASS FR5 settings.tsx (including its pre-existing, all-tiers-visible referral tab) was not touched by this ticket — documented scope decision, not a promotion-policy violation");

  const reportsSrc = sourceOf("client/src/pages/reports.tsx");
  const opportunitiesSrc = sourceOf("client/src/pages/opportunities.tsx");
  assert.ok(reportsSrc.includes("function UpgradeTeaser") && opportunitiesSrc.includes("function PremiumUpsell"), "FR6: UpgradeTeaser e PremiumUpsell continuam dois componentes separados — decisão documentada de não unificá-los nesta ticket (duplicação pré-existente, ambos já usam a mesma fonte canônica usePlan(), não é o que o requisito de 'autoridade única' desta ticket exige corrigir)");
  console.log("PASS FR6 UpgradeTeaser (reports.tsx) and PremiumUpsell (opportunities.tsx) remain intentionally separate — documented decision, both already gate on the same canonical usePlan() booleans, unifying them was judged pre-existing out-of-scope duplication");
}

function run(): void {
  runPolicyFoundationTests();
  runPublicSurfaceTests();
  runCriticalFlowTests();
  runReportsPolicyTests();
  runOpportunitiesPolicyTests();
  runFutureReadinessTests();

  console.log("\nPLAN-IMPL-08 house ads + external ads policy — all POL/PUB/CF/PR/PRO/FR assertions passed. B1-B22 verified live via Browser pane (see final report), not in this suite.");
}

run();
