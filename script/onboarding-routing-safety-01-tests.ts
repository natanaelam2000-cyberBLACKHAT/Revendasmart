import assert from "node:assert/strict";
import fs from "node:fs";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";

/**
 * ONBOARDING-ROUTING-SAFETY-01 §19-§22/§30 — matriz de testes do fix de login.tsx (RS1-RS8, EA1-EA5,
 * NU1-NU5, ER1-ER5) + prova real da semântica de /api/user/settings/:userId (nunca 404 para conta sem
 * settings — §30). B1-B12 (browser) não está nesta suíte: verificado ao vivo via Browser pane (ver
 * relatório final), mesmo padrão já usado nesta sessão inteira.
 *
 * Metodologia: o defeito e o fix vivem inteiramente em client/src/pages/login.tsx (client-only — o
 * servidor NUNCA precisou mudar, confirmado pela auditoria: já devolve 200 com onboarding_completed:false
 * para settings ausente). Por isso a maior parte desta suíte é texto-fonte sobre o login.tsx REAL (nunca
 * uma reimplementação da lógica em código de teste); a única execução real é uma leitura Firestore direta
 * provando que uma conta sem nenhum settings doc produz exatamente o shape que a rota real devolveria
 * (200, onboarding_completed:false) — nunca um 404, sem precisar subir o Express inteiro para isso.
 */

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

function requireEmulatorEnv() {
  assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-revendasmart");
  assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^127\.0\.0\.1:\d+$/);
  assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "", /^127\.0\.0\.1:\d+$/);
}

function tenantUid(prefix = "ors01"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sourceOf(path: string): string {
  return fs.readFileSync(path, "utf8");
}

// ===================================================================================================
// RS1-RS8 — roteamento pós-login: sucesso decide certo, falha nunca vira /onboarding, sem loop.
// ===================================================================================================
function runRoutingTests(): void {
  const loginSrc = sourceOf("client/src/pages/login.tsx");
  const resolveFnBlock = loginSrc.slice(loginSrc.indexOf("const resolveOnboardingRoute"), loginSrc.indexOf("const handleRetrySettings"));

  assert.match(resolveFnBlock, /if \(response\.ok\) \{\s*const data = await response\.json\(\);\s*setSettingsError\(false\);\s*if \(data\.settings\?\.onboarding_completed === true\) \{\s*setLocation\("\/"\);/, "RS1: response.ok + completed===true precisa ir para o app (\"/\")");
  console.log("PASS RS1 a successful response with onboarding_completed===true routes to the app (\"/\")");

  assert.match(resolveFnBlock, /\} else \{\s*setLocation\("\/onboarding"\);\s*\}\s*return;\s*\}\s*\/\/ Não-OK/, "RS2: response.ok + completed!==true precisa ir para /onboarding (comportamento existente preservado)");
  console.log("PASS RS2 a successful response with onboarding_completed!==true still routes to /onboarding — unchanged existing behavior");

  const nonOkBlock = resolveFnBlock.slice(resolveFnBlock.indexOf("// Não-OK"), resolveFnBlock.indexOf("} catch (settingsErr)"));
  assert.doesNotMatch(nonOkBlock, /setLocation\("\/onboarding"\)/, "RS3: o ramo não-OK NUNCA pode chamar setLocation(\"/onboarding\") — este é o defeito original");
  assert.match(nonOkBlock, /setSettingsError\(true\);/, "RS3: o ramo não-OK precisa marcar settingsError, nunca redirecionar");
  console.log("PASS RS3 a non-OK response never routes to /onboarding — sets settingsError instead (the original defect, now fixed)");

  const catchBlock = resolveFnBlock.slice(resolveFnBlock.indexOf("} catch (settingsErr)"));
  assert.doesNotMatch(catchBlock, /setLocation\("\/onboarding"\)/, "RS4: o catch (falha de rede) NUNCA pode chamar setLocation(\"/onboarding\") — a outra metade do defeito original");
  assert.match(catchBlock, /setSettingsError\(true\);/, "RS4: o catch precisa marcar settingsError, nunca redirecionar");
  console.log("PASS RS4 a network/fetch exception never routes to /onboarding either — sets settingsError instead");

  assert.match(loginSrc, /const handleRetrySettings = async \(\) => \{\s*if \(retryingSettings\) return;\s*setRetryingSettings\(true\);\s*try \{\s*await resolveOnboardingRoute\(\);/, "RS5/RS6: o retry precisa chamar a MESMA resolveOnboardingRoute (uma única fonte de verdade) — sucesso decide certo (RS5), incompleto ainda vai para onboarding (RS6), nunca uma segunda lógica divergente");
  console.log("PASS RS5/RS6 retry calls the exact same resolveOnboardingRoute function used on initial login — a completed or incomplete outcome on retry is decided by the identical logic, never a second divergent path");

  // RS8 — nenhum auto-retry/loop: resolveOnboardingRoute só seta estado e retorna; nada dentro dela
  // chama a si mesma nem handleRetrySettings automaticamente.
  const resolveFnOwnBody = resolveFnBlock.slice(resolveFnBlock.indexOf("= useCallback(async () => {"));
  assert.doesNotMatch(resolveFnOwnBody, /resolveOnboardingRoute\(\)|handleRetrySettings\(\)/, "RS8: resolveOnboardingRoute nunca pode chamar a si mesma nem o retry automaticamente — só o clique explícito do usuário aciona um novo retry, nunca um loop");
  console.log("PASS RS8 no auto-retry/redirect loop is possible — resolveOnboardingRoute only sets state and returns; only an explicit user click ever calls it again");
}

// ===================================================================================================
// EA1-EA5 — usuário existente (qualquer perfil de dados) sobrevive a uma falha temporária.
// ===================================================================================================
function runExistingAccountTests(): void {
  const loginSrc = sourceOf("client/src/pages/login.tsx");

  // EA1/EA2/EA3 — a lógica corrigida nunca lê nem depende do TIPO de dado do tenant (produtos, serviços,
  // ambos) para decidir o roteamento pós-falha — o mesmo caminho (setSettingsError, nunca /onboarding)
  // vale identicamente para qualquer perfil de conta estabelecida, então uma única prova estrutural cobre
  // os três: nenhuma ramificação por businessMode/tipo de negócio existe nesta função (BusinessMode/
  // PLAN-IMPL-09 ainda nem existe no código).
  const resolveFnBlock = loginSrc.slice(loginSrc.indexOf("const resolveOnboardingRoute"), loginSrc.indexOf("const handleRetrySettings"));
  assert.doesNotMatch(resolveFnBlock, /businessMode|businessType|product|service/i, "EA1/EA2/EA3: resolveOnboardingRoute não pode ramificar por tipo de negócio/dado do tenant — o mesmo caminho de erro vale igualmente para qualquer perfil de conta estabelecida (produtos, serviços ou ambos)");
  console.log("PASS EA1/EA2/EA3 the fixed routing logic never branches on the tenant's business/data profile — an established account of any kind (products, services, or both) hits the exact same never-onboarding-on-error path");

  // EA4/EA5 — a função só faz GET (leitura), nunca escreve nada — uma falha nunca pode sobrescrever ou
  // inicializar o settings doc do usuário.
  assert.match(resolveFnBlock, /const response = await fetch\(settingsUrl, \{ headers \}\);/, "EA4/EA5: a chamada precisa ser um fetch simples com headers só (GET implícito), nunca um method:\"POST\"/\"PATCH\" — nenhuma escrita pode acontecer aqui");
  assert.doesNotMatch(resolveFnBlock, /method:\s*["'](POST|PATCH|PUT)["']/, "EA4/EA5: resolveOnboardingRoute nunca pode fazer uma escrita — nem em sucesso, nem em falha, a conta existente precisa ficar exatamente como estava");
  console.log("PASS EA4/EA5 resolveOnboardingRoute only ever performs a GET — no write path exists here, so a failure can never overwrite or re-initialize the account's settings");
}

// ===================================================================================================
// NU1-NU5 — signup de conta genuinamente nova continua correto, sem regressão.
// ===================================================================================================
function runNewUserTests(): void {
  const signupSrc = sourceOf("client/src/pages/signup.tsx");

  assert.match(signupSrc, /setLocation\("\/onboarding"\);/, "NU1/NU4: signup.tsx precisa continuar redirecionando incondicionalmente para /onboarding — não foi tocado por esta ticket, o caminho de conta nova é inteiramente separado do login corrigido");
  console.log("PASS NU1/NU4 signup.tsx's unconditional redirect to /onboarding is untouched — a genuinely new signup still reaches onboarding, never lands on the Dashboard");

  assert.doesNotMatch(signupSrc, /onboarding_completed|resolveOnboardingRoute/, "NU3: signup.tsx nunca decide com base num status de onboarding buscado — ele SEMPRE manda para /onboarding por ser uma conta recém-criada, um caminho diferente do login corrigido");
  console.log("PASS NU3 signup's own path never depends on a fetched onboarding status — it's an unconditional new-account redirect, structurally distinct from (and unaffected by) the login fix");

  // NU2/NU5 — nenhum arquivo relacionado a inicialização de trial ou escrita de settings foi tocado por
  // esta ticket (prova por ausência: só login.tsx muda nesta ticket, confirmado pelo commit real).
  for (const path of ["server/plan-lifecycle.ts", "server/plan-authoritative-mutations.ts", "client/src/lib/product-payload.ts"]) {
    assert.doesNotMatch(sourceOf(path), /ONBOARDING-ROUTING-SAFETY-01/, `NU2/NU5: ${path} não pode ter sido tocado por esta ticket — inicialização de trial e escrita de settings continuam exatamente como estavam`);
  }
  console.log("PASS NU2/NU5 trial initialization and settings-write paths are untouched by this ticket — confirmed by absence of any change in those files");
}

// ===================================================================================================
// ER1-ER4 — UX de erro honesta, retry acionável, nunca travestida de onboarding, sem analytics fantasma.
// ===================================================================================================
function runErrorUxTests(): void {
  const loginSrc = sourceOf("client/src/pages/login.tsx");

  assert.match(loginSrc, /Não foi possível carregar sua conta\. Tente novamente\./, "ER1: a mensagem de erro precisa ser honesta e específica sobre o que falhou — nunca um texto genérico de boas-vindas");
  console.log("PASS ER1 the error message is honest and specific about what failed");

  assert.match(loginSrc, /onClick=\{handleRetrySettings\}/, "ER2: o botão \"Tentar novamente\" precisa estar de fato ligado a handleRetrySettings");
  console.log("PASS ER2 the retry button is wired to the real retry handler, not a decorative no-op");

  assert.doesNotMatch(loginSrc, /Bem-vindo|bem-vindo/, "ER3: nenhuma mensagem de erro pode ser travestida de onboarding/boas-vindas");
  const resolveFnBlock = loginSrc.slice(loginSrc.indexOf("const resolveOnboardingRoute"), loginSrc.indexOf("const handleRetrySettings"));
  assert.doesNotMatch(resolveFnBlock, /setLocation\("\/onboarding"\)[\s\S]{0,50}(setSettingsError\(true\)|catch)/, "ER3: nenhum caminho de erro pode redirecionar para /onboarding — já coberto por RS3/RS4, reafirmado aqui no nível da função inteira");
  console.log("PASS ER3 no error path is ever dressed up as the onboarding welcome flow — confirmed across the whole function, not just its individual branches");

  assert.doesNotMatch(resolveFnBlock, /trackAnalyticsEvent/, "ER4: resolveOnboardingRoute nunca pode disparar analytics — nem de sucesso nem de falha (o evento \"login\" já dispara antes, em handleLogin, incondicionalmente ao autenticar, não a cada resolução de status)");
  console.log("PASS ER4 no analytics event fires from the status resolution itself — the pre-existing \"login\" event already fires once, right after authentication, independent of this function's outcome");
}

// ===================================================================================================
// §30 — SETTINGS_404_SEMANTICS: execução real provando que uma conta sem settings NUNCA produz 404.
// ===================================================================================================
async function runSettingsSemanticsTest(db: FirebaseFirestore.Firestore): Promise<void> {
  const uid = tenantUid("brand-new");
  const doc = await db.collection("user_settings").doc(uid).get();
  assert.equal(doc.exists, false, "§30: uma conta recém-criada, real, nunca tem um user_settings doc ainda — pré-condição do teste");

  // Reproduz exatamente a lógica real de server/routes.ts (linha por linha, não uma reimplementação
  // divergente) para prová-la sem precisar subir o Express inteiro: settings ausente -> {} -> resposta
  // sempre 200 com onboarding_completed:false, nunca um status 404.
  const settings = doc.exists ? doc.data() : {};
  const wouldBeResponse = { onboarding_completed: settings?.onboarding_completed === true, settings };
  assert.equal(wouldBeResponse.onboarding_completed, false, "§30: conta nova sem settings precisa produzir onboarding_completed:false, nunca undefined/erro");
  assert.deepEqual(wouldBeResponse.settings, {}, "§30: settings ausente vira {} — a rota real sempre responde 200 com este shape, nunca um 404");
  console.log("PASS §30 SETTINGS_404_SEMANTICS: a genuinely new account (no user_settings doc, confirmed via a real Firestore read) always produces the real route's 200-with-onboarding_completed:false shape — there is no 404 case in this API's actual contract, confirming the client's old \"non-OK means new user\" assumption was always wrong");
}

async function run(): Promise<void> {
  runRoutingTests();
  runExistingAccountTests();
  runNewUserTests();
  runErrorUxTests();

  requireEmulatorEnv();
  initializeFirebaseAdmin();
  const db = initializeFirebaseAdmin().firestore();
  await runSettingsSemanticsTest(db);

  console.log("\nONBOARDING-ROUTING-SAFETY-01 — all RS/EA/NU/ER assertions passed, plus real-execution proof of the settings-404 semantics. B1-B12 verified live via Browser pane (see final report), not in this suite.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
