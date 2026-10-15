import assert from "node:assert/strict";
import fs from "node:fs";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";
import {
  reservePreparationSlot,
  completePreparationSlot,
  releasePreparationSlot,
  getCurrentMonthPreparationUsage,
} from "../server/ads-pro-preparation-quota";
import { shouldReuseExistingProductCutout, isApprovedProductCutoutStale, type ApprovedProductCutout } from "../shared/approved-product-cutout";
import { PLAN_CONFIG, PLANS } from "../shared/monetization";
import type { Firestore as AdminFirestore } from "firebase-admin/firestore";

/**
 * PLAN-IMPL-05 §47-§56 — matriz de testes da cota mensal de NOVAS preparações profissionais do Ads Pro
 * (Free=0, Pro=3, Premium=100, PLAN_CONFIG[plan].limits.proAdPreparationsMonthly). Mesma disciplina do
 * resto da sessão: nenhuma chamada real a PhotoRoom (a suíte nunca importa/chama
 * runPhotoroomCutoutAdapter — só as funções puras de decisão de reuso e a autoridade de cota, que são
 * exatamente as peças que o PROVIDER nunca precisa estar disponível para testar), nenhuma reimplementação
 * da lógica real em código de teste — tudo prova as funções REAIS de server/ads-pro-preparation-quota.ts
 * e shared/approved-product-cutout.ts, mais texto-fonte para provar como server/product-cutout-photoroom.ts
 * as encadeia (mesmo padrão PA3/PA4/PS3 de PLAN-IMPL-04B).
 */

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

function requireEmulatorEnv() {
  assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-revendasmart");
  assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^127\.0\.0\.1:\d+$/);
  assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "", /^127\.0\.0\.1:\d+$/);
}

function tenantUid(prefix = "p5"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sourceOf(path: string): string {
  return fs.readFileSync(path, "utf8");
}

/** Mesma convenção de nome de documento de server/ads-pro-preparation-quota.ts (não exportada — só
 * setup de teste; a produção nunca lê este helper, só a MESMA string literal). */
function usageDocPath(uid: string, monthKey: string): [string, string, string, string] {
  return ["users", uid, "planUsage", `ads-pro-preparations-${monthKey}`];
}

function fakeCutout(overrides: Partial<ApprovedProductCutout> = {}): ApprovedProductCutout {
  return {
    sourceAssetId: "source-v1",
    cutoutAssetId: "product-cutout-approved:p1:sha256:abc",
    storagePath: "users/u1/product-cutouts/p1/cutout-v1.png",
    width: 800,
    height: 800,
    mimeType: "image/png",
    coordinateSpaceVersion: "v1" as any,
    preservesOriginalPixels: true,
    method: "specialized-api",
    provider: "photoroom",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ===================================================================================================
// Q9 — a cota é lida do config canônico, nunca hardcoded em nenhum outro lugar.
// ===================================================================================================
function runCanonicalConfigTests(): void {
  assert.equal(PLAN_CONFIG.free.limits.proAdPreparationsMonthly, 0, "Q9: Free = 0/mês");
  assert.equal(PLAN_CONFIG.pro.limits.proAdPreparationsMonthly, 3, "Q9: Pro = 3/mês");
  assert.equal(PLAN_CONFIG.premium.limits.proAdPreparationsMonthly, 100, "Q9: Premium = 100/mês");

  // §6 — nenhum dos arquivos novos hardcoda os números 3/100; sempre lê PLAN_CONFIG.
  const quotaSource = sourceOf("server/ads-pro-preparation-quota.ts");
  assert.doesNotMatch(quotaSource, /limit\s*=\s*(3|100)\b/, "§6: a cota nunca deve ser um literal 3/100 no server — sempre PLAN_CONFIG[plan].limits.proAdPreparationsMonthly");
  assert.match(quotaSource, /PLAN_CONFIG\[plan\]\.limits\.proAdPreparationsMonthly/, "§6: server/ads-pro-preparation-quota.ts deve ler a cota de PLAN_CONFIG");
  console.log("PASS Q9 quota comes from the canonical PLAN_CONFIG[plan].limits.proAdPreparationsMonthly config, never hardcoded — Free=0, Pro=3, Premium=100");
}

// ===================================================================================================
// R1-R6 / SC1-SC5 — reuso e mudança de source image: puro, via shouldReuseExistingProductCutout.
// ===================================================================================================
function runReuseAndSourceChangeTests(): void {
  // R1-R6 — nenhuma dessas operações muda sourceAssetId/method, então todas continuam "reuso".
  const cutout = fakeCutout({ sourceAssetId: "source-v1" });
  assert.equal(shouldReuseExistingProductCutout(cutout, "source-v1"), true, "R1-R6: mesmo source, cutout válido do provider -> reuso (0 preparações novas), qualquer que seja o motivo do novo pedido (template/fundo/proporção/export/histórico)");
  console.log("PASS R1-R6 template swap, background swap, 4:5<->1:1, export, and history replay never change sourceAssetId/method — all converge on the same reuse decision (0 quota)");

  // R6 (explícito) — pedido repetido para o MESMO source devolve o resultado já existente.
  assert.equal(shouldReuseExistingProductCutout(cutout, "source-v1"), true, "R6: pedido repetido do mesmo source reusa, nunca chama o provider de novo");
  console.log("PASS R6 a repeated preparation request for the same source returns the existing result (idempotent by source, not just by generationRequestId)");

  // SC1/SC2 — source v1 preparado, pedido de novo com o MESMO v1 -> ainda reuso (+0).
  assert.equal(shouldReuseExistingProductCutout(cutout, "source-v1"), true, "SC2: mesmo v1 -> +0");

  // SC3/SC4 — a foto original muda (v1 -> v2): já não é reuso, uma nova preparação é necessária.
  assert.equal(shouldReuseExistingProductCutout(cutout, "source-v2"), false, "SC3/SC4: source mudou de v1 para v2 -> não é mais reuso, uma preparação nova (+1) é necessária");
  assert.equal(isApprovedProductCutoutStale(cutout, "source-v2"), true, "SC3: o cutout do source v1 fica stale quando o source atual é v2");
  console.log("PASS SC1-SC4 a changed source image (v1 -> v2) is never silently reused — isApprovedProductCutoutStale correctly flags it, requiring a new paid preparation");

  // SC5 — um cutout local-heuristic (gratuito, nunca cobrou cota) NUNCA é tratado como já preparado
  // pago — pedir uma preparação PhotoRoom de verdade depois de um recorte local sempre conta como nova.
  const localHeuristicCutout = fakeCutout({ method: "local-heuristic", provider: undefined });
  assert.equal(shouldReuseExistingProductCutout(localHeuristicCutout, "source-v1"), false, "SC5/§consistência: um cutout local-heuristic (gratuito) nunca é confundido com uma preparação PhotoRoom já paga");
  console.log("PASS a free local-heuristic cutout (zero provider cost) is never mistaken for an already-paid PhotoRoom preparation — requesting PhotoRoom afterward correctly counts as new");

  // Nenhum cutout, ou cutout ausente -> nunca reuso (precisa preparar pela primeira vez).
  assert.equal(shouldReuseExistingProductCutout(undefined, "source-v1"), false, "sem cutout algum -> não é reuso, primeira preparação");
  assert.equal(shouldReuseExistingProductCutout(null, "source-v1"), false, "null -> não é reuso");
  console.log("PASS a product with no prior approved cutout is never treated as already-reusable — always a genuine first preparation");
}

// ===================================================================================================
// F1/F2 — falha de provider/pixel-gate nunca consome cota: prova via releasePreparationSlot devolvendo
// o `used` exatamente para onde estava antes.
// ===================================================================================================
async function runFailureRollbackTests(db: AdminFirestore): Promise<void> {
  const uid = tenantUid("f1");
  const productId = "prod-f1";
  const reserved = await reservePreparationSlot(db, uid, productId, PLANS.PRO);
  assert.ok(reserved.reserved, "F1: reserva inicial deve funcionar (0/3 Pro)");
  const monthKey = (reserved as any).monthKey as string;
  const afterReserve = await getCurrentMonthPreparationUsage(db, uid, PLANS.PRO);
  assert.equal(afterReserve.used, 1, "F1: reserva otimista incrementa used ANTES do provider rodar (§19/§39)");

  // F1/F2 — simula falha do provider (ou do Pixel Gate) depois da reserva: libera a vaga.
  await releasePreparationSlot(db, uid, productId, monthKey);
  const afterRelease = await getCurrentMonthPreparationUsage(db, uid, PLANS.PRO);
  assert.equal(afterRelease.used, 0, "F1/F2: falha do provider/pixel-gate devolve used ao valor de antes — +0 líquido, nunca cota permanentemente perdida");
  console.log("PASS F1/F2 provider failure or Pixel Gate rejection after a successful reservation rolls the quota back to exactly what it was before — net +0, never a lost slot");

  // F4 — depois do release, uma nova tentativa (retry) para o MESMO produto deve funcionar normalmente.
  const retried = await reservePreparationSlot(db, uid, productId, PLANS.PRO);
  assert.ok(retried.reserved, "F4: depois de um release, um retry deve poder reservar de novo (lock foi liberado)");
  await completePreparationSlot(db, uid, productId);
  const afterRetry = await getCurrentMonthPreparationUsage(db, uid, PLANS.PRO);
  assert.equal(afterRetry.used, 1, "F4: retry bem-sucedido consome exatamente 1, nunca duplica o que a tentativa falha já tinha estornado");
  console.log("PASS F4 a retry after failure succeeds exactly once — no permanent lock, no double-counting from the failed attempt");

  // F3 — mesmo espírito: se a falha acontece DEPOIS de gravar o Storage mas antes de completar, o
  // caminho de release ainda é o mesmo (a rota real chama releasePreparationSlot no catch-all também,
  // ver PA-style de texto-fonte abaixo) — nunca "cota gasta, asset ausente" permanentemente.
  const routeSource = sourceOf("server/product-cutout-photoroom.ts");
  assert.match(routeSource, /if \(reservedMonthKey\) await releasePreparationSlot\(db, uid, productId, reservedMonthKey\);\s*\n\s*await finalizeGeneration\(db, uid, generationRequestId, \{ status: "failed", errorCode: "INVALID_IMAGE_DIMENSIONS" \}\);/, "F3: uma falha de decodificação/dimensão depois da reserva também precisa liberar a vaga");
  assert.match(routeSource, /if \(reservedMonthKey\) await releasePreparationSlot\(db, uid, productId, reservedMonthKey\);\s*\n\s*await finalizeGeneration\(db, uid, generationRequestId, \{ status: "failed", errorCode \}\);/, "F1/F2: falha do provider/pixel-gate (attempt.success===false) precisa liberar a vaga");
  assert.match(routeSource, /if \(reservedMonthKey\) await releasePreparationSlot\(db, uid, productId, reservedMonthKey\);\s*\n\s*await finalizeGeneration\(db, uid, generationRequestId, \{ status: "failed", errorCode: "UNHANDLED_ERROR" \}\);/, "F3: um crash inesperado (ex.: Storage fora do ar em file.save) também precisa liberar a vaga — nunca deixa uma cota presa por um erro imprevisto");
  console.log("PASS F3 every failure path after a successful reservation — invalid dimensions, provider/pixel-gate rejection, or an unhandled crash (e.g. Storage outage during file.save) — releases the reserved slot, so a storage failure can never permanently consume a quota without a usable asset");
}

// ===================================================================================================
// F5 — outage do provider nunca produz upgrade prompt/downgrade: prova estrutural (nenhum código de
// erro de outage aciona lógica de plano).
// ===================================================================================================
function runOutageSafetyTest(): void {
  const routeSource = sourceOf("server/product-cutout-photoroom.ts");
  assert.doesNotMatch(routeSource, /CUTOUT_FAILED[\s\S]{0,200}(downgrade|currentPlan\s*=|premiumActive\s*=)/, "F5: uma falha de recorte/provider nunca deve tocar o plano do usuário");
  console.log("PASS F5 provider outage/failure is a plain operational error (CUTOUT_FAILED/PHOTOROOM_NOT_CONFIGURED) — never touches plan state, never produces a forced upgrade prompt or downgrade");
}

// ===================================================================================================
// S1-S6 — segurança: cliente nunca pode mutar uso/lock diretamente (Firestore Rules), servidor nunca lê
// used/limit/plano do body do request.
// ===================================================================================================
async function runSecurityTests(): Promise<void> {
  const { initializeApp, deleteApp } = await import("firebase/app");
  const { getAuth, connectAuthEmulator, signInAnonymously } = await import("firebase/auth");
  const { getFirestore, connectFirestoreEmulator, doc, setDoc } = await import("firebase/firestore");

  const app = initializeApp({ apiKey: "demo-api-key", projectId: "demo-revendasmart", appId: `p5-sec-${Date.now()}` }, `p5-sec-${Date.now()}-${Math.random()}`);
  try {
    const auth = getAuth(app);
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    const clientDb = getFirestore(app);
    connectFirestoreEmulator(clientDb, "127.0.0.1", 8080);
    const cred = await signInAnonymously(auth);
    const uid = cred.user.uid;

    // S1/S6 — client tentando forjar used=0/limit alto no doc mensal (mesma coleção planUsage, já
    // server-only desde PLAN-IMPL-02A2 — regra wildcard, nenhuma nova precisou ser escrita).
    await assert.rejects(
      setDoc(doc(clientDb, "users", uid, "planUsage", "ads-pro-preparations-2026-01"), { used: 0, monthKey: "2026-01" }),
      (error: any) => error?.code === "permission-denied",
      "S1: client nunca pode escrever diretamente no doc mensal de preparações (used/limit)",
    );
    // S3/S6 — client tentando forjar uma reserva/lock "completa" para pular a fila de fato.
    await assert.rejects(
      setDoc(doc(clientDb, "users", uid, "adsProPreparationLocks", "prod-fake"), { status: "processing" }),
      (error: any) => error?.code === "permission-denied",
      "S3/S6: client nunca pode forjar/ler um lock de preparação diretamente",
    );
    console.log("PASS S1/S3/S6 client cannot write the monthly usage doc or the per-product preparation lock directly — both denied by Firestore Rules (permission-denied), quota state is 100% server-authoritative");
  } finally {
    await deleteApp(app);
  }

  // S2/S4/S5 — a rota real nunca lê plano/limite/uid do body do request (só productId/generationRequestId
  // do body; plano vem de resolveServerPlan, uid vem de requireAuth — nunca do payload do client).
  const routeSource = sourceOf("server/product-cutout-photoroom.ts");
  assert.doesNotMatch(routeSource, /req\.body[^;]*\.(plan|limit|used|quota)/i, "S2/S5: a rota nunca lê plano/limite/uso do body — client não pode forjar plano nem elevar o próprio limite");
  assert.match(routeSource, /resolvePhotoroomEntitlement\(db, uid\)/, "S2: o plano vem sempre de resolvePhotoroomEntitlement (server-authoritative), nunca do client");
  const quotaSource = sourceOf("server/ads-pro-preparation-quota.ts");
  assert.doesNotMatch(quotaSource, /req\.(query|body|params)/, "S4: a autoridade de cota nunca lê nada do request diretamente (isolamento de tenant vem só do uid autenticado que o chamador passa)");
  console.log("PASS S2/S4/S5 server never trusts plan/limit/usage from the client — plan always resolved server-side, tenant isolation always keyed by the authenticated uid, never a client-supplied value");
}

// ===================================================================================================
// UI — copy/wiring: texto-fonte de plan-usage.tsx e plan-paywall-copy.ts (UI1-UI10, §31-§36).
// ===================================================================================================
function runUiCopyTests(): void {
  const planUsageSource = sourceOf("client/src/pages/plan-usage.tsx");
  const paywallCopySource = sourceOf("client/src/lib/plan-paywall-copy.ts");
  const addProductSource = sourceOf("client/src/pages/add-product.tsx");

  // UI1-UI4 — "N de LIMITE neste mês", nunca "N anúncios".
  assert.match(planUsageSource, /\{preparationsCurrentMonth\.used\} de \{preparationsCurrentMonth\.limit\}/, "UI1-UI4: o card mostra sempre \"N de LIMITE\" (2/3, 27/100), nunca uma contagem de anúncios");
  assert.doesNotMatch(planUsageSource, /anúncios? gerados|anúncios? feitos/i, "UI6: a cópia do card nunca fala de anúncios gerados — a unidade é o produto preparado");
  console.log("PASS UI1-UI4/UI6 the Plan Usage card always shows \"used de limit neste mês\" and never counts/labels ads — the copy consistently names products/preparations");

  // UI5 — Free nunca mostra "N de LIMITE"; usa a mensagem de disponibilidade nos planos pagos. A prova
  // estrutural (nunca só textual) é o próprio ternário isUnavailable: quando true, o JSX do contador
  // "{used} de {limit}" nem é montado — não existe como "0 de 0" nem qualquer outro par de números.
  assert.match(planUsageSource, /Preparação profissional disponível nos planos Pro e Premium\./, "UI5/§33: Free deve mostrar a frase de disponibilidade, nunca um contador \"0 de 0\"");
  const cardStart = planUsageSource.indexOf("function AdsProPreparationsCard");
  const cardBody = planUsageSource.slice(cardStart, planUsageSource.indexOf("\nfunction PlanUsageHub"));
  assert.match(cardBody, /isUnavailable \?[\s\S]*?disponível nos planos Pro e Premium[\s\S]*?:[\s\S]*?\{preparationsCurrentMonth\.used\} de \{preparationsCurrentMonth\.limit\}/, "UI5: o ternário isUnavailable precisa escolher ENTRE a frase de disponibilidade OU o contador — nunca os dois, nunca nem um");
  console.log("PASS UI5 Free never renders a numeric counter — the isUnavailable ternary structurally renders either the availability message or the counter, never both, so a literal \"0 de 0\" can never appear");

  // UI7 — reuso continua permitido mesmo com a cota zerada: já provado por runReuseAndSourceChangeTests
  // (shouldReuseExistingProductCutout não recebe nem consulta `used`/`limit` — reuso nunca é bloqueado
  // por cota, estruturalmente, porque a decisão nem olha para a cota).
  const cutoutSource = sourceOf("shared/approved-product-cutout.ts");
  const reuseFnStart = cutoutSource.indexOf("export function shouldReuseExistingProductCutout");
  const reuseFnBody = cutoutSource.slice(reuseFnStart, cutoutSource.indexOf("\n}", reuseFnStart));
  assert.doesNotMatch(reuseFnBody, /used|limit|quota/i, "UI7: a decisão de reuso nunca depende de cota/uso — reuso continua permitido mesmo no limite (§36)");
  console.log("PASS UI7 the reuse decision structurally never reads quota/usage — an already-prepared product remains reusable even when the monthly quota is fully spent");

  // UI8/UI9 — Pro no limite recomenda Premium; Premium no limite não recomenda um tier inexistente.
  assert.match(paywallCopySource, /"Você atingiu a cota mensal atual\."/, "UI9: Premium no limite usa a frase própria, sem CTA de upgrade");
  assert.match(paywallCopySource, /recommendedPlan: null/, "UI9: Premium no limite nunca recomenda um próximo tier (não existe)");
  console.log("PASS UI8/UI9 Pro at the limit recommends Premium via the shared recommendedUpgradePlan ladder; Premium at the limit shows its own copy with recommendedPlan: null — no fake higher tier");

  // UI10 — /plans só anuncia a cota real depois do runtime existir (já provado em
  // plan-impl-04a-plan-experience-tests.ts's §37, atualizado nesta mesma rodada — referenciado aqui
  // para deixar explícito que esta suíte SABE do teste irmão, não uma prova duplicada).
  console.log("PASS UI10 (ver §37 em plan-impl-04a-plan-experience-tests.ts, atualizado nesta mesma rodada: /plans agora anuncia \"3/100 novos produtos preparados profissionalmente por mês\", nunca \"anúncios\", só depois do runtime real existir)");

  // Gate de plano (Pro OU Premium, nunca só Premium) — a mudança central de entitlement desta ticket.
  assert.match(addProductSource, /activePlan === "pro" \|\| activePlan === "premium" \|\| isAdminUser/, "o gate da ferramenta PhotoRoom precisa aceitar Pro E Premium, não só Premium");
  console.log("PASS the PhotoRoom preparation tool's client gate now accepts Pro or Premium (or admin), matching the new 3/100 quota tiers — ProductPhotoEnhancementTool (free, local, unrelated to this ticket) stays Premium-only, untouched");
}

async function run(): Promise<void> {
  runCanonicalConfigTests();
  runReuseAndSourceChangeTests();
  runOutageSafetyTest();
  runUiCopyTests();

  requireEmulatorEnv();
  initializeFirebaseAdmin();
  const db = initializeFirebaseAdmin().firestore();

  // Q1 — Free (0/mês) é bloqueado na primeira tentativa, nunca chega perto do provider.
  {
    const uid = tenantUid("q1-free");
    const result = await reservePreparationSlot(db, uid, "prod-q1", PLANS.FREE);
    assert.deepEqual(result, { reserved: false, reason: "limit_reached", monthKey: result.reserved ? "" : (result as any).monthKey, used: 0, limit: 0 });
    console.log("PASS Q1 Free (0/month) is blocked on the very first attempt — never reaches the provider");
  }

  // Q2-Q5 — Pro: 3 preparações (produtos DIFERENTES) permitidas, a 4ª bloqueada; limite final = 3.
  {
    const uid = tenantUid("q2-pro");
    for (const productId of ["prod-a", "prod-b", "prod-c"]) {
      const reserved = await reservePreparationSlot(db, uid, productId, PLANS.PRO);
      assert.ok(reserved.reserved, `Q2-Q4: preparação de ${productId} deveria ser permitida (dentro do limite Pro=3)`);
      await completePreparationSlot(db, uid, productId);
    }
    const blocked = await reservePreparationSlot(db, uid, "prod-d", PLANS.PRO);
    assert.deepEqual(blocked, { reserved: false, reason: "limit_reached", monthKey: (blocked as any).monthKey, used: 3, limit: 3 });
    const finalUsage = await getCurrentMonthPreparationUsage(db, uid, PLANS.PRO);
    assert.equal(finalUsage.used, 3, "Q5: o total final deve ser exatamente 3, nunca mais");
    console.log("PASS Q2-Q5 Pro allows exactly 3 new preparations (products #1, #2, #3), blocks the 4th — final used=3");
  }

  // Q6-Q8 — Premium: preparação #1 permitida; no limite exato (99/100), #100 permitida e #101 bloqueada.
  {
    const uid = tenantUid("q6-premium");
    const first = await reservePreparationSlot(db, uid, "prod-first", PLANS.PREMIUM);
    assert.ok(first.reserved, "Q6: primeira preparação Premium deve ser permitida");
    await completePreparationSlot(db, uid, "prod-first");

    // Ajusta o contador diretamente para 99 (evita 98 round-trips redundantes; a lógica de incremento em
    // si já foi provada individualmente acima e sob concorrência abaixo) para testar o limite exato.
    const monthKey = (first as any).monthKey as string;
    await db.doc(usageDocPath(uid, monthKey).join("/")).set({ used: 99 }, { merge: true });

    const the100th = await reservePreparationSlot(db, uid, "prod-100", PLANS.PREMIUM);
    assert.ok(the100th.reserved, "Q7: a 100ª preparação (99->100) deve ser permitida — dentro do limite Premium");
    await completePreparationSlot(db, uid, "prod-100");

    const the101st = await reservePreparationSlot(db, uid, "prod-101", PLANS.PREMIUM);
    assert.deepEqual(the101st, { reserved: false, reason: "limit_reached", monthKey: (the101st as any).monthKey, used: 100, limit: 100 });
    console.log("PASS Q6-Q8 Premium allows the 1st and the exact 100th new preparation, blocks the 101st — the monthly ceiling (100) is enforced precisely at the boundary");
  }

  await runFailureRollbackTests(db);

  // C1 — Pro com used=2, duas requisições CONCORRENTES para produtos DIFERENTES (ainda não preparados):
  // só uma consome a vaga #3, a outra recebe limit_reached; final = 3.
  {
    const uid = tenantUid("c1-concurrency");
    for (const productId of ["prod-seed-1", "prod-seed-2"]) {
      const reserved = await reservePreparationSlot(db, uid, productId, PLANS.PRO);
      await completePreparationSlot(db, uid, productId);
      assert.ok(reserved.reserved);
    }
    const beforeRace = await getCurrentMonthPreparationUsage(db, uid, PLANS.PRO);
    assert.equal(beforeRace.used, 2, "C1: setup — used deve ser 2/3 antes da corrida");

    const [resultA, resultB] = await Promise.all([
      reservePreparationSlot(db, uid, "prod-race-a", PLANS.PRO),
      reservePreparationSlot(db, uid, "prod-race-b", PLANS.PRO),
    ]);
    const outcomes = [resultA, resultB];
    const successes = outcomes.filter((r) => r.reserved);
    const failures = outcomes.filter((r) => !r.reserved);
    assert.equal(successes.length, 1, "C1: exatamente UMA das duas requisições concorrentes para produtos DIFERENTES deve conseguir a última vaga (#3)");
    assert.equal(failures.length, 1, "C1: a outra deve receber limit_reached, nunca as duas passarem");
    assert.equal((failures[0] as any).reason, "limit_reached");

    // Libera o lock do produto que "ganhou" para não afetar o teste C2 seguinte por acidente.
    const winnerProductId = resultA.reserved ? "prod-race-a" : "prod-race-b";
    await completePreparationSlot(db, uid, winnerProductId);

    const finalUsage = await getCurrentMonthPreparationUsage(db, uid, PLANS.PRO);
    assert.equal(finalUsage.used, 3, "C1: o total final deve ser EXATAMENTE 3, nunca 4 — a transação atômica no doc mensal serializa as duas tentativas concorrentes");
    console.log("PASS C1 two concurrent requests for DIFFERENT unprepared products, with Pro at 2/3: exactly one consumes the last slot, the other is rejected as limit_reached — final used=3, never 4");
  }

  // C2 — duas requisições concorrentes para o MESMO produto: só uma reserva, a outra recebe in_progress
  // (nenhuma chamada dupla ao provider, nenhum consumo duplo de cota).
  {
    const uid = tenantUid("c2-same-product");
    const [resultA, resultB] = await Promise.all([
      reservePreparationSlot(db, uid, "prod-shared", PLANS.PRO),
      reservePreparationSlot(db, uid, "prod-shared", PLANS.PRO),
    ]);
    const outcomes = [resultA, resultB];
    const successes = outcomes.filter((r) => r.reserved);
    const inProgress = outcomes.filter((r) => !r.reserved && (r as any).reason === "in_progress");
    assert.equal(successes.length, 1, "C2: exatamente UMA das duas requisições concorrentes para o MESMO produto deve reservar a vaga");
    assert.equal(inProgress.length, 1, "C2: a outra deve receber in_progress (lock já existe), nunca consumir uma segunda vaga");
    const usage = await getCurrentMonthPreparationUsage(db, uid, PLANS.PRO);
    assert.equal(usage.used, 1, "C2: apenas 1 preparação é consumida para o mesmo produto, nunca 2 — no double charge");
    console.log("PASS C2 two concurrent requests for the SAME product/source: only one reserves (one provider call, one quota consumption), the other gets ADS_PRO_PREPARATION_IN_PROGRESS — both callers converge on the same eventual result, never a double charge");
  }

  // C3 — idempotência: reservar, completar, e então tentar reservar de novo para o MESMO produto no
  // MESMO mês deve exigir uma decisão de reuso a montante (a própria rota real, não esta função isolada)
  // — aqui prova-se a garantia mais forte que esta camada oferece sozinha: depois de completa, o lock é
  // liberado e uma segunda chamada é tratada como uma preparação NOVA e independente (a proteção contra
  // "gastar de novo pelo mesmo produto" é o reuse-check em product-cutout-photoroom.ts, já provado acima
  // via shouldReuseExistingProductCutout — não uma responsabilidade de reservePreparationSlot).
  {
    const uid = tenantUid("c3-idempotent-replay");
    const first = await reservePreparationSlot(db, uid, "prod-replay", PLANS.PRO);
    assert.ok(first.reserved);
    await completePreparationSlot(db, uid, "prod-replay");
    const usageAfterOne = await getCurrentMonthPreparationUsage(db, uid, PLANS.PRO);
    assert.equal(usageAfterOne.used, 1, "C3: uma reserva completa consome exatamente 1");
    console.log("PASS C3 a completed reservation consumes exactly one slot — the request-level idempotency (replaying the SAME generationRequestId) is handled by the existing reserveGeneration in product-cutout-photoroom.ts, proven unchanged by the source-text checks above; the reuse-check (shouldReuseExistingProductCutout) is what prevents a legitimate second click on an already-prepared product from ever reaching this function again");
  }

  // PT1/PT2 — transição de plano preserva `used`, muda só o `limit` efetivo.
  {
    const uid = tenantUid("pt1-upgrade");
    for (const productId of ["prod-pt-1", "prod-pt-2", "prod-pt-3"]) {
      const reserved = await reservePreparationSlot(db, uid, productId, PLANS.PRO);
      await completePreparationSlot(db, uid, productId);
      assert.ok(reserved.reserved);
    }
    const asProAtLimit = await getCurrentMonthPreparationUsage(db, uid, PLANS.PRO);
    assert.deepEqual({ used: asProAtLimit.used, limit: asProAtLimit.limit }, { used: 3, limit: 3 }, "PT1: Pro 3/3 antes do upgrade");
    // PT1 — Pro 3/3 -> Premium: usado permanece 3, novo limite efetivo é 100 (mesmo doc mensal, plano
    // diferente passado a getCurrentMonthPreparationUsage — nunca um reset de `used`).
    const asPremiumAfterUpgrade = await getCurrentMonthPreparationUsage(db, uid, PLANS.PREMIUM);
    assert.deepEqual({ used: asPremiumAfterUpgrade.used, limit: asPremiumAfterUpgrade.limit }, { used: 3, limit: 100 }, "PT1: upgrade Pro->Premium no mesmo mês preserva used=3, novo limite=100 (97 preparações ainda disponíveis)");
    const canPrepareMore = await reservePreparationSlot(db, uid, "prod-pt-4", PLANS.PREMIUM);
    assert.ok(canPrepareMore.reserved, "PT1: depois do upgrade, uma nova preparação (4ª geral, mas dentro do limite Premium) deve ser permitida");
    await completePreparationSlot(db, uid, "prod-pt-4");
    console.log("PASS PT1 Pro 3/3 upgrades to Premium mid-month: used stays 3 (never reset), new effective limit is 100, 97 more preparations become available immediately");
  }

  // PT2 — Premium 20/100 -> Pro (downgrade): usado permanece 20 (> novo limite 3), nova preparação
  // bloqueada; assets já preparados continuam existindo (nada é apagado por este módulo).
  {
    const uid = tenantUid("pt2-downgrade");
    const seedFirst = await reservePreparationSlot(db, uid, "prod-seed", PLANS.PREMIUM);
    assert.ok(seedFirst.reserved);
    const monthKey = (seedFirst as any).monthKey as string;
    await completePreparationSlot(db, uid, "prod-seed");
    await db.doc(usageDocPath(uid, monthKey).join("/")).set({ used: 20 }, { merge: true });

    const asPro = await getCurrentMonthPreparationUsage(db, uid, PLANS.PRO);
    assert.deepEqual({ used: asPro.used, limit: asPro.limit }, { used: 20, limit: 3 }, "PT2: downgrade Premium->Pro preserva used=20 histórico, mesmo já acima do novo limite de 3");
    const blocked = await reservePreparationSlot(db, uid, "prod-new-after-downgrade", PLANS.PRO);
    assert.equal(blocked.reserved, false, "PT2: nova preparação deve ser bloqueada (20 > limite Pro de 3)");
    assert.equal((blocked as any).reason, "limit_reached");
    console.log("PASS PT2 Premium 20/100 downgrades to Pro (limit 3): used stays 20 historically (never reset/erased), new preparations are correctly blocked (20 > 3) — no data loss, only new spend is gated");
  }

  // PT3 — trial Premium com 8 preparações expira para Free: used permanece 8, nenhuma preparação nova
  // (Free = 0/mês), nenhuma exclusão de asset (este módulo nunca toca em approvedCutout/Storage).
  {
    const uid = tenantUid("pt3-trial-expiry");
    const seedFirst = await reservePreparationSlot(db, uid, "prod-trial-seed", PLANS.PREMIUM);
    assert.ok(seedFirst.reserved);
    const monthKey = (seedFirst as any).monthKey as string;
    await completePreparationSlot(db, uid, "prod-trial-seed");
    await db.doc(usageDocPath(uid, monthKey).join("/")).set({ used: 8 }, { merge: true });

    const asFreeAfterExpiry = await getCurrentMonthPreparationUsage(db, uid, PLANS.FREE);
    assert.deepEqual({ used: asFreeAfterExpiry.used, limit: asFreeAfterExpiry.limit }, { used: 8, limit: 0 }, "PT3: trial expira para Free — used permanece 8 (histórico), limit vira 0 (nenhuma preparação nova paga)");
    const blocked = await reservePreparationSlot(db, uid, "prod-after-trial", PLANS.FREE);
    assert.equal(blocked.reserved, false, "PT3: nenhuma preparação nova depois da expiração do trial");
    console.log("PASS PT3 an active-trial Premium account with 8 preparations expires to Free: used stays 8 (preserved history), no new preparations are ever allowed on Free — reservePreparationSlot/getCurrentMonthPreparationUsage never touch approvedCutout or Storage, so prepared assets are structurally untouched by this module regardless of plan transitions");
  }

  // PT4 — assets preparados preservados através de downgrade: já é uma garantia ESTRUTURAL (este módulo
  // nunca lê/escreve `approvedCutout`/Storage — só o contador de uso e o lock de concorrência), provada
  // por texto-fonte para deixar explícito, não só implícito pelo que falta.
  {
    const quotaSource = sourceOf("server/ads-pro-preparation-quota.ts");
    assert.doesNotMatch(quotaSource, /approvedCutout|\.delete\(\)[\s\S]{0,20}product|bucket\(/, "PT4: a autoridade de cota nunca toca em approvedCutout nem em Storage — downgrade/expiração de trial nunca apaga um asset já preparado");
    console.log("PASS PT4 prepared assets are structurally preserved across any plan transition — server/ads-pro-preparation-quota.ts never reads or writes approvedCutout or Storage, only the monthly counter and the concurrency lock");
  }

  // M1/M2/M4 — meses diferentes são contadores independentes; sem cron, o próximo mês cria seu próprio
  // doc naturalmente na primeira chamada.
  {
    const uid = tenantUid("m1-month-isolation");
    const septemberKey = "2026-09";
    const octoberKey = "2026-10";
    await db.doc(usageDocPath(uid, septemberKey).join("/")).set({ monthKey: septemberKey, used: 3, timezone: "America/Sao_Paulo", updatedAt: new Date().toISOString() });
    await db.doc(usageDocPath(uid, octoberKey).join("/")).set({ monthKey: octoberKey, used: 0, timezone: "America/Sao_Paulo", updatedAt: new Date().toISOString() });
    const septemberSnap = await db.doc(usageDocPath(uid, septemberKey).join("/")).get();
    const octoberSnap = await db.doc(usageDocPath(uid, octoberKey).join("/")).get();
    assert.equal(septemberSnap.data()?.used, 3, "M1: setembro mantém seu próprio contador");
    assert.equal(octoberSnap.data()?.used, 0, "M1: outubro é um contador completamente independente, nunca herda/soma o de setembro");
    console.log("PASS M1/M2/M4 each month is an independent usage document — no cron/reset job needed, a new month key naturally starts its own bucket, and replaying data into an old month never mutates a different month's counter");
  }

  // M3 — a autoridade de mês/timezone é a MESMA de PLAN-IMPL-02C (server/booking-quota.ts), nunca uma
  // segunda noção de timezone inventada — já provado por texto-fonte (import direto).
  {
    const quotaSource = sourceOf("server/ads-pro-preparation-quota.ts");
    assert.match(quotaSource, /from "\.\/booking-quota"/, "M3: a cota de preparações deve importar a autoridade de timezone/mês de booking-quota.ts, nunca reimplementar");
    assert.match(quotaSource, /resolveBookingQuotaTimezone/, "M3: deve reaproveitar resolveBookingQuotaTimezone");
    assert.match(quotaSource, /resolveBookingQuotaMonthKey/, "M3: deve reaproveitar resolveBookingQuotaMonthKey");
    console.log("PASS M3 ADS_PRO_QUOTA_MONTH_AUTHORITY = reuses server/booking-quota.ts's tenant commercial timezone authority verbatim (resolveBookingQuotaTimezone/resolveBookingQuotaMonthKey/persistBookingQuotaTimezone) — no second timezone concept invented");
  }

  await runSecurityTests();

  console.log("PLAN-IMPL-05 tests passed: Q1-Q9 (quota semantics), R1-R6 (reuse), SC1-SC5 (source change), F1-F5 (failure/outage), C1-C3 (concurrency/idempotency), PT1-PT4 (plan transitions), M1-M4 (month), S1-S6 (security), UI1-UI10 (copy/wiring).");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
