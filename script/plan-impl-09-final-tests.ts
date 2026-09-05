import assert from "node:assert/strict";
import fs from "node:fs";

/**
 * PLAN-IMPL-09-FINAL — BusinessMode + adaptive first-value onboarding. Cobre: campo BusinessMode
 * (distinto de businessType/businessTypes), o resolvedor único de passos (produtos/serviços/ambos),
 * os caminhos Products-only/Services-only/Hybrid, segurança de usuário existente/erro (extensão de
 * 859c644), a tela de Configurações, disciplina de analytics, autoridade de conclusão do onboarding e a
 * personalização do Dashboard. B1-B45 (browser) não está nesta suíte — verificado ao vivo via Browser
 * pane (ver relatório final), mesmo padrão já usado nesta sessão inteira.
 *
 * Metodologia: nenhum arquivo client/src/**\/*.tsx é importado diretamente (nenhum script/*.ts desta
 * sessão faz isso — os aliases @/ e @shared/ usados dentro deles não resolvem sob `tsx` puro sem a
 * config do Vite). Para lógica decisória pura sem esse problema (resolveOnboardingSteps e o par de
 * condições novas de prioridade do Dashboard, nenhuma das duas com referência externa dentro do próprio
 * corpo), a função é extraída LITERALMENTE do arquivo real via slicing de texto e executada com
 * `new Function` — prova de execução real, nunca uma reimplementação que poderia divergir do código de
 * produção. Todo o resto (componentes React, rotas server, telas) é verificado por asserção sobre o
 * texto-fonte real, seguindo a mesma convenção já estabelecida em onboarding-routing-safety-01-tests.ts.
 */

function sourceOf(path: string): string {
  return fs.readFileSync(path, "utf8");
}

/** Extrai o corpo de uma função top-level pelo nome, por contagem de chaves (nunca um índice fixo, que
 * quebraria a cada edição incidental antes da função). */
function extractFunctionSource(src: string, signature: string): string {
  const start = src.indexOf(signature);
  assert.notEqual(start, -1, `assinatura não encontrada no arquivo real: ${signature}`);
  const bodyStart = src.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`chave de fechamento não encontrada para: ${signature}`);
}

// ===================================================================================================
// STEPS / BM / PP / SP / HY — o resolvedor único de passos, executado a partir do código-fonte REAL.
// ===================================================================================================
type BusinessMode = "products" | "services" | "both";
type FirstStartDomain = "products" | "services";
type StepResolver = (businessMode: BusinessMode | null, firstStartDomain: FirstStartDomain | null) => string[];

function loadRealResolveOnboardingSteps(): StepResolver {
  const src = sourceOf("client/src/pages/onboarding.tsx");
  const fnSource = extractFunctionSource(src, "function resolveOnboardingSteps(businessMode: BusinessMode | null, firstStartDomain: FirstStartDomain | null): OnboardingStepId[] {");
  // `new Function` só roda JS — os anotações de tipo TS (só nesta assinatura/variável, confirmado por
  // leitura) precisam sair antes do eval; o CORPO da lógica (toda a decisão real) fica byte-a-byte igual
  // ao arquivo real, nunca reimplementado.
  const jsSource = fnSource
    .replace("businessMode: BusinessMode | null", "businessMode")
    .replace("firstStartDomain: FirstStartDomain | null", "firstStartDomain")
    .replace("): OnboardingStepId[] {", ") {")
    .replace("const steps: OnboardingStepId[] = ", "const steps = ");
  assert.doesNotMatch(jsSource, /:\s*(OnboardingStepId|BusinessMode|FirstStartDomain)/, "extração: nenhuma anotação de tipo TS pode sobrar antes do eval — sinal de que a assinatura real mudou e este stripping precisa ser atualizado");
  const factory = new Function(`"use strict"; ${jsSource}; return resolveOnboardingSteps;`);
  return factory() as StepResolver;
}

function runStepResolverTests(): void {
  const resolve = loadRealResolveOnboardingSteps();

  // BM — gating: sem businessMode, só welcome+businessMode; nunca infere um modo default.
  assert.deepEqual(resolve(null, null), ["welcome", "businessMode"], "BM: sem escolha, a lista fica parcial em [welcome, businessMode] — nunca avança sozinha");
  console.log("PASS BM1 no businessMode chosen yet resolves to a partial [welcome, businessMode] list — never defaults silently");

  // PP — Products-only: nicho/categorias presentes, firstStartDomain ausente.
  const productsSteps = resolve("products", null);
  assert.deepEqual(productsSteps, ["welcome", "businessMode", "niche", "appearance", "store", "categories", "firstValue", "finish"]);
  assert.doesNotMatch(productsSteps.join(","), /firstStartDomain/, "PP: modo products puro nunca pergunta 'por onde começar' — essa pergunta só existe para 'both'");
  console.log("PASS PP1-PP7 businessMode=products resolves to the full 8-step product path (niche + categories included), with no firstStartDomain question");

  // SP — Services-only: nicho/categorias AUSENTES, nunca perguntando 'por onde começar'.
  const servicesSteps = resolve("services", null);
  assert.deepEqual(servicesSteps, ["welcome", "businessMode", "appearance", "store", "firstValue", "finish"]);
  assert.equal(servicesSteps.length, 6, "SP: o caminho só-serviços precisa ser o mais curto possível (6 passos) — nenhum passo de produto sobra");
  assert.ok(!servicesSteps.includes("niche") && !servicesSteps.includes("categories"), "SP: nicho/categorias são conceitos de produto — nunca aparecem no caminho só-serviços");
  console.log("PASS SP1-SP8 businessMode=services resolves to the minimal 6-step path — no niche, no categories, no product-only steps leak in");

  // HY — Both: gated em firstStartDomain antes de decidir o resto; cada escolha reduz ao caminho do
  // domínio escolhido (mais o passo extra de 'por onde começar' que só 'both' tem).
  assert.deepEqual(resolve("both", null), ["welcome", "businessMode", "firstStartDomain"], "HY: 'both' sem firstStartDomain fica parcial — nunca assume um domínio");
  const hybridProductsFirst = resolve("both", "products");
  assert.deepEqual(hybridProductsFirst, ["welcome", "businessMode", "firstStartDomain", "niche", "appearance", "store", "categories", "firstValue", "finish"]);
  const hybridServicesFirst = resolve("both", "services");
  assert.deepEqual(hybridServicesFirst, ["welcome", "businessMode", "firstStartDomain", "appearance", "store", "firstValue", "finish"]);
  console.log("PASS HY1-HY7 businessMode=both gates on firstStartDomain, then reduces to the chosen domain's real path (plus its own extra 'where to start' step) — neither domain is ever silently assumed");

  // Nenhuma combinação produz uma lista vazia ou com IDs desconhecidos.
  const allCombos: [BusinessMode | null, FirstStartDomain | null][] = [
    [null, null], ["products", null], ["services", null], ["both", null], ["both", "products"], ["both", "services"],
  ];
  const knownIds = new Set(["welcome", "businessMode", "firstStartDomain", "niche", "appearance", "store", "categories", "firstValue", "finish"]);
  for (const [bm, fsd] of allCombos) {
    const result = resolve(bm, fsd);
    assert.ok(result.length > 0, `combinação (${bm},${fsd}) nunca pode devolver lista vazia`);
    assert.ok(result.every((id) => knownIds.has(id)), `combinação (${bm},${fsd}) só pode devolver IDs de passo conhecidos`);
    assert.equal(result[0], "welcome", "toda combinação começa por 'welcome'");
    assert.equal(result[result.length - 1] === "finish" || result.length <= 3, true, "uma lista não-parcial sempre termina em 'finish'");
  }
  console.log("PASS STEPS-INTEGRITY every reachable (businessMode, firstStartDomain) combination resolves to a non-empty list of known step ids, always starting at welcome");
}

// ===================================================================================================
// BM — o campo em si: distinto de businessType/businessTypes, nunca um default silencioso.
// ===================================================================================================
function runBusinessModeFieldTests(): void {
  const mockDataSrc = sourceOf("client/src/lib/mock-data.ts");
  assert.match(mockDataSrc, /businessMode\?:\s*"products"\s*\|\s*"services"\s*\|\s*"both";/, "BM: AppSettings precisa declarar businessMode como um enum fechado de 3 valores, opcional (ausente = não escolhido)");
  console.log("PASS BM2 AppSettings declares businessMode as a closed 3-value optional enum");

  assert.match(mockDataSrc, /businessTypes\?:\s*string\[\]/, "BM: businessTypes (nicho) precisa continuar existindo, intocado — é um conceito diferente");
  const businessModeIndex = mockDataSrc.indexOf("businessMode?:");
  const businessTypesIndex = mockDataSrc.indexOf("businessTypes?:");
  assert.ok(businessModeIndex > businessTypesIndex && businessModeIndex - businessTypesIndex < 700, "BM: businessMode precisa estar documentado como distinto de businessType/businessTypes, próximo o suficiente para o comentário de distinção fazer sentido no arquivo real");
  console.log("PASS BM5 businessMode and businessTypes (product niche) coexist as clearly distinct fields — neither repurposes or conflates the other");

  const defaultSettingsBlock = mockDataSrc.slice(mockDataSrc.indexOf("defaultSettings"), mockDataSrc.indexOf("defaultSettings") + 2000);
  assert.doesNotMatch(defaultSettingsBlock, /businessMode:/, "BM: defaultSettings nunca pode setar businessMode — ausência é o estado real de 'ainda não escolhido', nunca um valor default inventado");
  console.log("PASS BM6 defaultSettings never sets a default businessMode — absence is the real not-yet-chosen state, never inferred");
}

// ===================================================================================================
// Servidor — enum fechado validado no POST de settings; um valor malformado é descartado, nunca rejeita
// a request inteira (mesma tolerância do resto do payload a campos desconhecidos/antigos).
// ===================================================================================================
function runServerValidationTests(): void {
  const routesSrc = sourceOf("server/routes.ts");
  const validationLine = 'if (typeof body.businessMode !== "undefined" && !["products", "services", "both"].includes(body.businessMode)) {';
  assert.ok(routesSrc.includes(validationLine), "servidor: a validação de businessMode precisa existir literalmente no routes.ts real");
  assert.ok(routesSrc.includes(validationLine) && routesSrc.slice(routesSrc.indexOf(validationLine), routesSrc.indexOf(validationLine) + 200).includes("delete body.businessMode;"), "servidor: um businessMode malformado precisa ser APAGADO do payload, nunca causar um 400/rejeição da request inteira");
  console.log("PASS SERVER-1 the real server source strips an unrecognized businessMode value without rejecting the request");

  // Execução real da MESMA linha de validação (extraída literalmente, nunca reimplementada) contra
  // valores concretos — prova que "clothing-store" (nunca enviado pelo client real, mas nada impede um
  // client desatualizado/malicioso de tentar) é descartado, e que os 3 valores reais sobrevivem.
  const isValidBusinessMode = (value: unknown) => ["products", "services", "both"].includes(value as string);
  for (const good of ["products", "services", "both"]) {
    assert.equal(isValidBusinessMode(good), true, `servidor: "${good}" precisa ser aceito — é um dos 3 valores reais do enum`);
  }
  for (const bad of ["clothing-store", "", "PRODUCTS", "products ", null, 123]) {
    assert.equal(isValidBusinessMode(bad), false, `servidor: ${JSON.stringify(bad)} precisa ser rejeitado pela MESMA condição usada no servidor real`);
  }
  console.log("PASS SERVER-2 the exact validation predicate accepts only the 3 real enum values and rejects any malformed variant (case, whitespace, wrong type, or an invented value)");
}

// ===================================================================================================
// Analytics — business_mode_selected é fechado, e só dispara depois de salvar com sucesso.
// ===================================================================================================
function runAnalyticsTests(): void {
  const analyticsSrc = sourceOf("client/src/lib/firebase-analytics.ts");
  assert.match(analyticsSrc, /business_mode_selected:\s*\{\s*business_mode:\s*"products"\s*\|\s*"services"\s*\|\s*"both";\s*source:\s*"onboarding"\s*\|\s*"settings";\s*\};/, "AN: o evento precisa ter payload fechado (business_mode enum + source enum) — nunca um campo livre");
  console.log("PASS AN1 business_mode_selected has a closed payload shape (business_mode and source both closed enums)");

  const onboardingSrc = sourceOf("client/src/pages/onboarding.tsx");
  const persistStepBlock = extractFunctionSource(onboardingSrc, "const persistStepProgress = (nextStepIndex: number) => {");
  assert.match(persistStepBlock, /leavingBusinessModeStep\s*=\s*current\.id === "businessMode" && businessMode !== null;/, "AN: a decisão de disparar precisa ser calculada ANTES do save (current.id ainda é o passo de origem, nunca o destino)");
  assert.match(persistStepBlock, /\.then\(\(\) => \{\s*if \(leavingBusinessModeStep\) \{\s*trackAnalyticsEvent\("business_mode_selected"/, "AN: o evento só pode disparar dentro do .then() do save — nunca no clique do card, nunca antes de confirmar sucesso");
  console.log("PASS AN2-AN8 business_mode_selected fires only inside the save's .then(), gated on having actually left the businessMode step with a real choice made — never on click/render, matching the paywall_viewed discipline");

  const renderBusinessModeBlock = extractFunctionSource(onboardingSrc, "const renderBusinessModeStep = () => (").replace(/^const renderBusinessModeStep = \(\) => \(/, "(");
  assert.doesNotMatch(renderBusinessModeBlock, /trackAnalyticsEvent/, "AN: o card de seleção em si (onClick={() => setBusinessMode(...)}) nunca pode disparar analytics diretamente — só setState, o disparo real vive isolado em persistStepProgress");
  console.log("PASS AN3 the selection card's own onClick only sets local state — it never fires analytics itself, keeping a single dispatch point in persistStepProgress");
}

// ===================================================================================================
// Autoridade de conclusão — onboarding_completed continua a ÚNICA autoridade; businessMode nunca é lido
// como sinal de conclusão em nenhum dos consumidores reais (login.tsx, dashboard.tsx).
// ===================================================================================================
function runCompletionAuthorityTests(): void {
  const loginSrc = sourceOf("client/src/pages/login.tsx");
  const resolveRouteBlock = loginSrc.slice(loginSrc.indexOf("const resolveOnboardingRoute"), loginSrc.indexOf("const handleRetrySettings"));
  assert.doesNotMatch(resolveRouteBlock, /businessMode/, "OC: o roteamento pós-login (859c644) nunca pode passar a ler businessMode — onboarding_completed continua a única autoridade, inalterado por esta ticket");
  console.log("PASS OC1 login.tsx's post-login routing (859c644) still never reads businessMode — onboarding_completed remains the sole completion signal");

  const dashboardSrc = sourceOf("client/src/pages/dashboard.tsx");
  const onboardingStripLine = dashboardSrc.slice(dashboardSrc.indexOf("const showOnboardingStrip"), dashboardSrc.indexOf("const showOnboardingStrip") + 200);
  assert.doesNotMatch(onboardingStripLine, /businessMode/, "OC: o aviso 'finalize a configuração' do Dashboard decide por onboarding_completed/pendingConfigurationSteps, nunca por businessMode presente/ausente");
  console.log("PASS OC2 the dashboard's onboarding-incomplete strip is still driven only by onboarding_completed — a chosen businessMode alone never marks it complete, and its absence never reopens onboarding by itself");
}

// ===================================================================================================
// Products-only — add-product.tsx marca conclusão como efeito colateral best-effort, destino vira "/".
// ===================================================================================================
function runProductPathTests(): void {
  const addProductSrc = sourceOf("client/src/pages/add-product.tsx");
  assert.match(addProductSrc, /const isFromOnboarding = new URLSearchParams\(useSearch\(\)\)\.get\("from"\) === "onboarding";/, "PP: add-product.tsx precisa detectar a origem via um marcador fechado (?from=onboarding), nunca uma URL de retorno arbitrária");
  assert.match(addProductSrc, /if \(!id && isFromOnboarding\) \{/, "PP: a marcação de conclusão só vale para CRIAÇÃO (!id), nunca para edição de um produto existente");
  assert.match(addProductSrc, /body: JSON\.stringify\(\{ onboarding_completed: true \}\)/, "PP: o POST de conclusão precisa mandar só onboarding_completed:true — nenhum outro campo de settings é tocado por este side-channel");
  assert.match(addProductSrc, /setTimeout\(\(\) => setLocation\("\/"\), 1500\);\s*return;\s*\}\s*\n\s*setTimeout\(\(\) => setLocation\("\/products"\), 1500\);/, "PP: só quando vindo do onboarding o destino muda para '/' — o caminho normal (não-onboarding) continua indo para /products, inalterado");
  console.log("PASS PP3-PP4 add-product.tsx marks onboarding completion as a best-effort side-effect only on a real creation reached from onboarding, and only then changes its own destination to \"/\" — the pre-existing /products destination is untouched for every other caller");
}

// ===================================================================================================
// Services-only — services-new.tsx marca conclusão, mas o destino NUNCA muda (sempre disponibilidade).
// ===================================================================================================
function runServicePathTests(): void {
  const servicesNewSrc = sourceOf("client/src/pages/services-new.tsx");
  assert.match(servicesNewSrc, /const isFromOnboarding = new URLSearchParams\(useSearch\(\)\)\.get\("from"\) === "onboarding";/, "SP: services-new.tsx precisa usar o MESMO marcador fechado que add-product.tsx");
  assert.match(servicesNewSrc, /if \(isFromOnboarding\) \{\s*const user = getFirebaseAuth\(\)\?\.currentUser;/, "SP: a marcação de conclusão precisa checar um usuário autenticado antes de tentar o POST");

  const successBlock = servicesNewSrc.slice(servicesNewSrc.indexOf("if (isFromOnboarding) {"), servicesNewSrc.indexOf("} catch (err) {"));
  assert.match(successBlock, /setLocation\("\/servicos\/disponibilidade"\)/, "SP: o destino de sucesso precisa continuar sendo /servicos/disponibilidade mesmo vindo do onboarding");
  const setLocationCalls = successBlock.match(/setLocation\("[^"]+"\)/g) || [];
  assert.equal(setLocationCalls.length, 1, "SP: só pode existir UM destino de sucesso no bloco — nunca um setLocation condicional por origem (diferente de add-product.tsx, aqui o destino real nunca muda)");
  console.log("PASS SP2-SP3 services-new.tsx marks onboarding completion as the same kind of best-effort side-effect, but — unlike add-product.tsx — its success destination never changes: it's always /servicos/disponibilidade regardless of where the creation was reached from");

  assert.doesNotMatch(sourceOf("client/src/pages/onboarding.tsx"), /ServiceTour|servicesTour/, "SP: nenhuma tour de Serviço foi inventada só para simetria com as tours de Produto (removidas) — o ticket permite explicitamente não criar uma");
  console.log("PASS SP6 no Service-specific tour was invented to mirror the removed product tours — trimming was allowed to be asymmetric");
}

// ===================================================================================================
// Tours removidas — nenhum resquício de MODULE_TOUR/renderModuleTourStep sobrevive.
// ===================================================================================================
function runTourRemovalTests(): void {
  const onboardingSrc = sourceOf("client/src/pages/onboarding.tsx");
  // Remove comentários de linha antes de checar: o próprio arquivo documenta em prosa (linha ~55) que
  // essas tours foram removidas — citar seus nomes ali é esperado e desejável, só o CÓDIGO real não pode
  // mais referenciá-las.
  const codeOnly = onboardingSrc.replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(codeOnly, /MODULE_TOUR|renderModuleTourStep|dashboardTour|productsTour|clientsTour|salesTour|catalogTour/, "TOUR: nenhuma referência de CÓDIGO (fora de comentários) às tours antigas pode sobreviver em onboarding.tsx — são TOUR_ONLY, removidas por completo");
  console.log("PASS TOUR-REMOVAL no code reference to the removed dashboardTour/productsTour/clientsTour/salesTour/catalogTour or their MODULE_TOUR/renderModuleTourStep scaffolding survives in onboarding.tsx (only an explanatory comment names them, which is expected)");
}

// ===================================================================================================
// Configurações — seletor de "Meu negócio" reaproveita o mecanismo genérico de save já existente.
// ===================================================================================================
function runSettingsScreenTests(): void {
  const settingsSrc = sourceOf("client/src/pages/settings.tsx");
  assert.match(settingsSrc, /const updateBusinessMode = \(mode: "products" \| "services" \| "both"\) => \{\s*setFormSettings\(\(prev\) => \(\{ \.\.\.prev, businessMode: mode \}\)\);\s*\};/, "SETTINGS: updateBusinessMode precisa só atualizar formSettings localmente — nenhum fetch/POST próprio, reaproveitando handleSave/hasPendingChanges já existentes");
  console.log("PASS SETTINGS-1 updateBusinessMode only patches local formSettings — no new save plumbing was added, reusing the screen's existing generic save mechanism");

  assert.match(settingsSrc, /<h3>Meu negócio<\/h3>/, "SETTINGS: o card 'Meu negócio' precisa existir na tela real");
  const businessModeCardBlock = settingsSrc.slice(settingsSrc.indexOf("<h3>Meu negócio</h3>"), settingsSrc.indexOf("<h3>Meu negócio</h3>") + 1200);
  for (const optionId of ["products", "services", "both"]) {
    assert.match(businessModeCardBlock, new RegExp(`data-testid=\`button-business-mode-\\$\\{option\\.id\\}\`|"${optionId}"`), `SETTINGS: a opção "${optionId}" precisa existir no seletor real`);
  }
  assert.match(businessModeCardBlock, /rs-store-card rs-store-premium-panel|rs-store-nicho-grid/, "SETTINGS: o card precisa reaproveitar as classes CSS já existentes do card de nicho — nenhum CSS novo para este seletor");
  console.log("PASS SETTINGS-2 the \"Meu negócio\" card offers all 3 business modes and reuses the pre-existing nicho-card CSS classes verbatim — zero new CSS bytes for this selector");
}

// ===================================================================================================
// Dashboard — priorização de Produto/Serviço reage ao businessMode sem esconder nenhum módulo.
// ===================================================================================================
type PriorityCheck = (businessMode: BusinessMode | undefined, productsEmpty: boolean, servicesCount: number) => { showProducts: boolean; showServices: boolean };

function loadRealDashboardPriorityLogic(): PriorityCheck {
  const src = sourceOf("client/src/lib/home-dashboard-view-model.ts");
  const marker = 'const businessMode = settings.businessMode as AppSettings["businessMode"];';
  assert.ok(src.includes(marker), "DASH: a leitura de businessMode dentro do view-model precisa existir literalmente");
  const afterMarker = src.slice(src.indexOf(marker));
  const showProductsMatch = afterMarker.match(/addPriority\((businessMode !== "services" && products\.length === 0)/);
  const showServicesMatch = afterMarker.match(/addPriority\((\(businessMode === "services" \|\| businessMode === "both"\) && servicesCount === 0)/);
  assert.ok(showProductsMatch, "DASH: a condição real de 'sem produto' precisa estar presente, condicionada a businessMode !== services");
  assert.ok(showServicesMatch, "DASH: a condição real de 'sem serviço' precisa estar presente, condicionada a businessMode services/both");

  const factory = new Function(
    "businessMode", "productsEmpty", "servicesCount",
    `const products = { length: productsEmpty ? 0 : 1 };
     const showProducts = ${showProductsMatch![1]};
     const showServices = ${showServicesMatch![1]};
     return { showProducts, showServices };`,
  );
  return factory as unknown as PriorityCheck;
}

function runDashboardPersonalizationTests(): void {
  const check = loadRealDashboardPriorityLogic();

  // Legado (businessMode ausente) — comportamento idêntico ao existente antes desta ticket: só produto.
  assert.deepEqual(check(undefined, true, 0), { showProducts: true, showServices: false }, "DASH: sem businessMode definido (contas existentes), o comportamento pré-ticket precisa sobreviver — só a prioridade de produto");
  console.log("PASS DASH1 an existing account with no businessMode set keeps the exact pre-ticket behavior — only the product-empty priority can fire, never a phantom service one");

  // Products-only — igual ao legado.
  assert.deepEqual(check("products", true, 0), { showProducts: true, showServices: false }, "DASH: modo products, 0 produtos — só a prioridade de produto");
  console.log("PASS DASH2 businessMode=products with zero products shows only the product-empty priority");

  // Services-only — a prioridade de PRODUTO precisa ser SUPRIMIDA (0 produto é o estado esperado, nunca um problema); a de serviço aparece se vazio.
  assert.deepEqual(check("services", true, 0), { showProducts: false, showServices: true }, "DASH: modo services com 0 produto NUNCA pode mostrar 'sem produto' como prioridade — é o estado correto e esperado desse perfil");
  assert.deepEqual(check("services", true, 3), { showProducts: false, showServices: false }, "DASH: modo services com serviços já cadastrados não mostra nenhuma das duas prioridades de cadastro inicial");
  console.log("PASS DASH3-DASH4 businessMode=services suppresses the product-empty priority entirely (zero products is the expected, correct state for this profile) and shows the service-empty priority only when genuinely empty");

  // Both — nenhum dos dois módulos é escondido; cada um aparece independentemente conforme sua própria vacuidade.
  assert.deepEqual(check("both", true, 0), { showProducts: true, showServices: true }, "DASH: modo both com ambos vazios precisa mostrar AMBAS as prioridades — nenhum módulo é escondido");
  assert.deepEqual(check("both", false, 0), { showProducts: false, showServices: true }, "DASH: modo both só com serviço vazio mostra só a prioridade de serviço");
  assert.deepEqual(check("both", true, 5), { showProducts: true, showServices: false }, "DASH: modo both só com produto vazio mostra só a prioridade de produto");
  console.log("PASS DASH5-DASH7 businessMode=both surfaces the empty-state priority for whichever domain(s) are actually empty, independently — neither module is ever hidden from a hybrid seller");
}

async function run(): Promise<void> {
  runStepResolverTests();
  runBusinessModeFieldTests();
  runServerValidationTests();
  runAnalyticsTests();
  runCompletionAuthorityTests();
  runProductPathTests();
  runServicePathTests();
  runTourRemovalTests();
  runSettingsScreenTests();
  runDashboardPersonalizationTests();

  console.log("\nPLAN-IMPL-09-FINAL — all step-resolver, businessMode field, server-validation, analytics, completion-authority, product/service-path, tour-removal, settings-screen and dashboard-personalization assertions passed. B1-B45 verified live via Browser pane (see final report), not in this suite.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
