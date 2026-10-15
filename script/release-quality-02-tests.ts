/**
 * RELEASE-QUALITY-02 — testes dos 6 itens cirúrgicos: subscription compartilhada de dados (§1),
 * hardware back do Android (§3), safe-area (§4), falha silenciosa de venda/cobrança (§5), falha
 * silenciosa de save do onboarding (§6) e Remote Config lazy no startup (§7). Item §2 (queries não
 * limitadas) não produziu mudança de código — a classificação concluiu que nenhum dos 3 datasets
 * (products/sales/clients) pode ser limitado com segurança sem redesenhar o modelo de dados (fora de
 * escopo), então não há teste de regressão de query aqui além dos que já cobrem a subscription
 * compartilhada em si.
 */
import assert from "node:assert/strict";
import fs from "node:fs";

function read(path: string): string {
  return fs.readFileSync(path, "utf8");
}

async function run(): Promise<void> {
  // ===== §1 — subscribeShared (multiplexador puro, sem Firebase) =====
  {
    const { subscribeShared, __resetSharedSubscriptionsForTests, __getSharedSubscriptionRefCountForTests, __hasSharedSubscriptionForTests } =
      await import("../client/src/lib/shared-subscription.ts");
    __resetSharedSubscriptionsForTests();

    // A. dois consumers da MESMA chave não abrem duas fontes reais — só 1 startSource é chamado.
    let startCalls = 0;
    const updatesA: number[][] = [];
    const updatesB: number[][] = [];
    let emit: ((data: number[]) => void) | undefined;
    const startSource = (onData: (data: number[]) => void) => {
      startCalls += 1;
      emit = onData;
      onData([1, 2, 3]);
      return () => { emit = undefined; };
    };
    const unsubA = subscribeShared("products:tenant-1", startSource, (data) => updatesA.push(data));
    const unsubB = subscribeShared("products:tenant-1", startSource, (data) => updatesB.push(data));
    assert.equal(startCalls, 1, "A: dois consumers da mesma chave devem compartilhar UMA fonte real");
    assert.equal(__getSharedSubscriptionRefCountForTests("products:tenant-1"), 2, "A: refCount reflete os 2 consumers vivos");
    // Consumer que chega depois do primeiro dado já recebe o valor em cache imediatamente (replay).
    assert.deepEqual(updatesB[0], [1, 2, 3], "A: consumer tardio recebe o último snapshot já conhecido");
    emit?.([4, 5]);
    assert.deepEqual(updatesA.at(-1), [4, 5], "A: ambos os consumers recebem updates novos");
    assert.deepEqual(updatesB.at(-1), [4, 5], "A: ambos os consumers recebem updates novos");

    // B. cleanup remove a subscription — só quando o ÚLTIMO consumer sai a fonte real é desligada.
    unsubA();
    assert.equal(__hasSharedSubscriptionForTests("products:tenant-1"), true, "B: ainda há 1 consumer vivo, a entrada continua");
    assert.equal(startCalls, 1, "B: sair 1 de 2 consumers nunca reabre a fonte");
    unsubB();
    assert.equal(__hasSharedSubscriptionForTests("products:tenant-1"), false, "B: o ÚLTIMO consumer sair desliga a fonte real e remove a entrada");

    // C. troca de tenant nunca vaza cache — chaves diferentes são universos totalmente separados.
    __resetSharedSubscriptionsForTests();
    const dataByTenant: Record<string, number[]> = { "tenant-a": [1], "tenant-b": [2] };
    const startForTenant = (tenant: string) => (onData: (data: number[]) => void) => {
      onData(dataByTenant[tenant]);
      return () => {};
    };
    let sawForA: number[] | undefined;
    let sawForB: number[] | undefined;
    subscribeShared("clients:tenant-a", startForTenant("tenant-a"), (data) => { sawForA = data; });
    subscribeShared("clients:tenant-b", startForTenant("tenant-b"), (data) => { sawForB = data; });
    assert.deepEqual(sawForA, [1], "C: tenant-a nunca vê dado de tenant-b");
    assert.deepEqual(sawForB, [2], "C: tenant-b nunca vê dado de tenant-a");
    assert.notEqual(sawForA, sawForB, "C: os dois tenants têm entradas de cache totalmente distintas");

    __resetSharedSubscriptionsForTests();
  }

  // D. sales/clients seguem o MESMO padrão compartilhado que products (não uma solução ad-hoc só para um).
  const productsHookSource = read("client/src/hooks/useProductsData.ts");
  const salesHookSource = read("client/src/hooks/useSalesData.ts");
  const clientsLiteHookSource = read("client/src/hooks/useClientsLiteData.ts");
  const dashboardHookSource = read("client/src/hooks/useDashboardData.ts");
  for (const [nome, fonte] of [["products", productsHookSource], ["sales", salesHookSource], ["clientsLite", clientsLiteHookSource]] as const) {
    assert.match(fonte, /subscribeSharedUserCollection/, `D: ${nome} precisa usar a subscription compartilhada, não onSnapshot direto`);
    assert.doesNotMatch(fonte, /\bonSnapshot\(/, `D: ${nome} não deve chamar onSnapshot diretamente mais — isso pertence só ao wrapper compartilhado`);
  }
  assert.doesNotMatch(dashboardHookSource, /\bonSnapshot\(/, "D: useDashboardData não pode mais abrir listeners próprios — só compõe os hooks compartilhados");
  assert.match(dashboardHookSource, /useProductsData/, "D: useDashboardData reaproveita useProductsData");
  assert.match(dashboardHookSource, /useSalesData/, "D: useDashboardData reaproveita useSalesData");
  assert.match(dashboardHookSource, /useClientsLiteData/, "D: useDashboardData reaproveita useClientsLiteData");

  // ===== §3 — hardware back (dismissible stack, puro) =====
  {
    const { pushDismissible, dismissTopmost, __resetDismissibleStackForTests, __getDismissibleStackSizeForTests } =
      await import("../client/src/lib/android-back-button.ts");
    __resetDismissibleStackForTests();

    // E. overlay aberto → back fecha ELE, não navega (dismissTopmost devolve true e não mexe em nada além do overlay).
    let closedA = false;
    let closedB = false;
    const popA = pushDismissible(() => { closedA = true; });
    const popB = pushDismissible(() => { closedB = true; });
    assert.equal(__getDismissibleStackSizeForTests(), 2, "E: os 2 overlays abertos estão registrados");
    const handled = dismissTopmost();
    assert.equal(handled, true, "E: back com overlay aberto é tratado (não deve cair para navegação)");
    assert.equal(closedB, true, "E: fecha o overlay mais RECENTE primeiro (pilha LIFO)");
    assert.equal(closedA, false, "E: o overlay de baixo continua aberto — só um por toque de voltar");
    assert.equal(__getDismissibleStackSizeForTests(), 1, "E: a pilha perde 1 entrada ao fechar o topo");
    popA(); popB();
    assert.equal(dismissTopmost(), false, "E: sem overlay nenhum, back devolve false (deixa a navegação normal acontecer)");

    // E.2. cleanup de um overlay aberto remove sua entrada e impede callback residual após unmount.
    __resetDismissibleStackForTests();
    let residualCallbackCalled = false;
    const cleanupOpenOverlay = pushDismissible(() => { residualCallbackCalled = true; });
    assert.equal(__getDismissibleStackSizeForTests(), 1, "E.2: overlay aberto registra uma entrada");
    cleanupOpenOverlay();
    assert.equal(__getDismissibleStackSizeForTests(), 0, "E.2: unmount/close executa cleanup e remove a entrada");
    assert.equal(dismissTopmost(), false, "E.2: back após unmount não encontra overlay residual");
    assert.equal(residualCallbackCalled, false, "E.2: callback de overlay desmontado não é chamado");

    // E.3. abrir/fechar repetidamente não acumula entradas; a entrada corrente continua topmost.
    let closeCount = 0;
    const cleanupFirstOpen = pushDismissible(() => { closeCount += 1; });
    cleanupFirstOpen();
    const cleanupSecondOpen = pushDismissible(() => { closeCount += 10; });
    assert.equal(__getDismissibleStackSizeForTests(), 1, "E.3: reabertura mantém uma única entrada ativa");
    assert.equal(dismissTopmost(), true, "E.3: back trata a abertura corrente");
    assert.equal(closeCount, 10, "E.3: callback corrente é o único callback chamado");
    cleanupSecondOpen();
    __resetDismissibleStackForTests();
  }

  const backButtonSource = read("client/src/lib/android-back-button.ts");
  const dismissibleHookSource = read("client/src/hooks/useDismissibleOnBack.ts");
  assert.match(dismissibleHookSource, /onDismissRef\.current = onDismiss/, "E: callback atualiza a ref sem recriar a entrada a cada render");
  assert.match(dismissibleHookSource, /pushDismissible\(\(\) => onDismissRef\.current\(\)\)/, "E: a entrada chama o callback mais recente, sem callback residual");
  assert.match(backButtonSource, /if \(dismissTopmost\(\)\) return;/, "E: o handler real checa overlays abertos ANTES de navegar/sair");
  assert.match(backButtonSource, /canGoBack/, "E: distingue navegar (canGoBack) de sair do app (exitApp)");
  assert.match(backButtonSource, /App\.exitApp\(\)/, "E: só sai do app quando não há mais para onde voltar");
  assert.match(backButtonSource, /await import\("@capacitor\/app"\)/, "E: o plugin @capacitor/app é carregado sob demanda, não no boot");
  assert.match(backButtonSource, /catch \{/, "E: falha ao instalar o plugin (fora de um WebView Android) nunca quebra o boot");

  const sellSource = read("client/src/pages/sell.tsx");
  for (const testid of ["showNewClientModal", "isSummaryOpen"]) {
    assert.match(sellSource, new RegExp(`useDismissibleOnBack\\(${testid},`), `E: ${testid} está registrado — back fecha o modal/sheet aberto na tela de venda`);
  }
  // RELEASE-QUALITY-03 P1-01: showClientPicker passou a ser registrado DENTRO do ClientPickerSheet
  // compartilhado (não mais em sell.tsx) — cobre sell.tsx E NewOrderSheet com uma única wiring.
  assert.doesNotMatch(sellSource, /useDismissibleOnBack\(showClientPicker,/, "E: sell.tsx não registra showClientPicker de novo — isso duplicaria a entrada que o ClientPickerSheet já registra");

  const mainSource = read("client/src/main.tsx");
  assert.match(mainSource, /installAndroidBackButtonHandler/, "E: o handler é instalado no bootstrap do app");

  // ===== §4 — safe-area =====
  const indexCssSource = read("client/src/index.css");
  assert.match(indexCssSource, /\.rs-overlay-safe-top\s*\{[^}]*env\(safe-area-inset-top\)/s, "F: token de topo existe e usa env() real");
  assert.match(indexCssSource, /\.rs-overlay-safe-bottom\s*\{[^}]*env\(safe-area-inset-bottom\)/s, "F: token de fundo existe e usa env() real");
  // F: os tokens do shell principal continuam intactos — nada foi duplicado/substituído por engano.
  for (const tokenExistente of [".rs-safe-x", ".rs-app-header", ".rs-bottom-nav-edge", ".rs-sidebar-safe"]) {
    assert.ok(indexCssSource.includes(tokenExistente), `F: token pré-existente ${tokenExistente} continua no arquivo, não foi removido`);
  }
  const creativeProfileSource = read("client/src/components/marketing/CreativeProfileOnboarding.tsx");
  assert.match(creativeProfileSource, /rs-overlay-safe-top/, "F: header do wizard Marketing Pro ganhou o inset de topo (item 4 cita Marketing Pro explicitamente)");
  assert.match(creativeProfileSource, /rs-overlay-safe-bottom/, "F: rodapé do wizard Marketing Pro ganhou o inset de fundo");
  // F: sell.tsx já tinha tratamento próprio (env() inline) nos 2 overlays — não pode ganhar um SEGUNDO padding duplicado por cima.
  assert.doesNotMatch(sellSource, /rs-overlay-safe-(top|bottom)/, "F: sell.tsx já tem safe-area própria — não duplicar com os novos tokens genéricos");

  // ===== §5 — falha silenciosa de venda/cobrança =====
  assert.match(sellSource, /interface ChargeFailureState/, "G: existe um estado dedicado para a falha de cobrança");
  assert.match(sellSource, /data-testid="text-sale-charge-failure"/, "G: a falha aparece na tela de sucesso, não só como toast que some");
  assert.match(sellSource, /if \(!chargeFailed\) setTimeout\(\(\) => setLocation\("\/"\), 2000\);/, "G: só redireciona automaticamente quando NÃO houve falha de cobrança pendente");
  assert.match(sellSource, /data-testid="button-sale-charge-retry"/, "G: existe um botão de retry explícito");
  assert.doesNotMatch(
    sellSource.slice(sellSource.indexOf("if (!saleResponse.ok)"), sellSource.indexOf("const handleRetryCharge")),
    /\/api\/sales\/finalize/,
    "G: uma falha de cobrança NUNCA refaz/desfaz a venda já confirmada — só a cobrança é reenviada",
  );

  assert.match(sellSource, /async function createSaleCharge\(/, "H: existe uma função reutilizável de criação de cobrança (usada tanto na tentativa inicial quanto no retry)");
  const retryFnSource = sellSource.slice(sellSource.indexOf("const handleRetryCharge"), sellSource.indexOf("if (productsLoading || clientsLoading)"));
  assert.match(retryFnSource, /createSaleCharge\(token, chargeFailure\.payload\)/, "H: o retry reenvia o MESMO payload (mesmo saleId) — nunca gera um saleId novo");

  const paymentsSource = read("server/payments.ts");
  assert.match(paymentsSource, /where\("saleId", "==", body\.saleId\)/, "H: o servidor procura uma cobrança já existente para o mesmo saleId antes de criar outra");
  assert.match(paymentsSource, /reused: true/, "H: uma cobrança reaproveitada é sinalizada explicitamente, nunca criada de novo");
  const idempotencyBlock = paymentsSource.slice(paymentsSource.indexOf("check_existing_charge_for_sale"), paymentsSource.indexOf("Generate stable chargeId"));
  assert.doesNotMatch(idempotencyBlock, /chargeRef\.set\(/, "H: o caminho de reaproveitamento nunca grava uma cobrança nova no Firestore");
  assert.doesNotMatch(idempotencyBlock, /preferenceClient\.create/, "H: o caminho de reaproveitamento nunca chama o Mercado Pago de novo");

  // ===== §6 — falha silenciosa de save do onboarding =====
  const onboardingSource = read("client/src/pages/onboarding.tsx");
  const runSaveActionSource = onboardingSource.slice(
    onboardingSource.indexOf("const runSaveAction"),
    onboardingSource.indexOf("const handleComplete"),
  );
  assert.match(runSaveActionSource, /setError\(friendlyError\);/, "I: o erro de save é sempre exposto no estado que a UI já renderiza");
  assert.doesNotMatch(runSaveActionSource, /setLocation\(/, "I: falha de save NUNCA navega para longe — isso escondia o erro e fingia conclusão");
  assert.match(onboardingSource, /\{error && <p[^}]*>\{error\}<\/p>\}/, "I: o banner de erro realmente renderiza na tela, não é só estado morto");
  // J: nenhuma resposta do wizard é limpa dentro do fluxo de save/erro — só saveProgress lê o estado, nunca o reseta.
  assert.doesNotMatch(runSaveActionSource, /set(BusinessType|StoreName|SelectedTheme|SelectedNicho|Categories|AppTheme)\(/, "J: retry precisa preservar as respostas já dadas — o catch não pode resetar nenhum campo do wizard");
  assert.match(onboardingSource, /disabled=\{isSaving\}/, "J: os mesmos botões continuam clicáveis para retry assim que isSaving volta a false");

  // ===== §7 — Remote Config lazy no startup =====
  const remoteConfigSource = read("client/src/lib/remote-config.ts");
  assert.doesNotMatch(
    remoteConfigSource.slice(0, remoteConfigSource.indexOf("function loadRemoteConfigModule")),
    /from "firebase\/remote-config"/,
    "K: nenhum import ESTÁTICO de firebase/remote-config sobra no topo do arquivo",
  );
  assert.match(remoteConfigSource, /import\("firebase\/remote-config"\)/, "K: o SDK é carregado via import() dinâmico");
  assert.match(remoteConfigSource, /export async function initializeRemoteConfig/, "K: initializeRemoteConfig passou a ser assíncrono (await do import dinâmico)");

  // K: sem chamar initializeRemoteConfig (simula um boot onde o SDK ainda não foi tocado), fetchRemoteConfig
  // continua funcionando via fallback — a mudança para import() dinâmico não quebra o caminho padrão sem rede.
  // `isFeatureEnabled`/`getFlag` chamam `import.meta.env` (só existe sob Vite, não sob tsx) — usamos
  // `getAllFlags()` diretamente, que lê só o estado em memória já resolvido pelo fetch/fallback.
  const remoteConfigModule = await import("../client/src/lib/remote-config.ts");
  remoteConfigModule.resetToDefaults();
  await remoteConfigModule.fetchRemoteConfig();
  const flagsAfterFallback = remoteConfigModule.getAllFlags();
  assert.equal(flagsAfterFallback.sales_dashboard_enabled, true, "K: flag default continua correta depois do fetch (SDK não inicializado -> fallback)");
  assert.equal(flagsAfterFallback.insights_enabled, false, "K: outra flag default também intacta");
  assert.deepEqual(Object.keys(flagsAfterFallback).sort(), [
    "insights_enabled", "maintenance_message", "maintenance_mode_enabled", "marketing_pro_creative_v2_enabled",
    "marketing_pro_real_background_enabled", "marketing_templates_v2_enabled", "onboarding_v2_enabled",
    "referral_program_enabled", "sales_dashboard_enabled",
  ].sort(), "K: o shape de RemoteFlags não mudou — nenhuma flag sumiu por causa do lazy load");

  // L: o bootstrap de Auth não foi tocado — a única mudança é remote config virar fire-and-forget assíncrono.
  const firebaseSource = read("client/src/lib/firebase.ts");
  assert.match(firebaseSource, /void initializeRemoteConfig\(app\);/, "L: a chamada agora é explicitamente fire-and-forget (void), nunca bloqueia o resto do boot");
  assert.doesNotMatch(firebaseSource, /await initializeRemoteConfig/, "L: initializeRemoteConfig nunca passa a bloquear initializeFirebase — Auth continua síncrono em relação a ele");
  assert.match(firebaseSource, /return \{ app, auth: authInstance, error: null \};/, "L: initializeFirebase continua devolvendo app/auth imediatamente, sem esperar remote config");

  console.log("RELEASE-QUALITY-02: A-L invariants passed (subscription sharing, Android back, safe-area, sale/charge retry, onboarding retry, lazy Remote Config).");
}

void run();
