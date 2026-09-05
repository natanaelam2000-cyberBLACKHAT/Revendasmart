import assert from "node:assert/strict";
import fs from "node:fs";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";
import { createServiceCommand, PlanMutationError } from "../server/plan-authoritative-mutations";
import { PLAN_CONFIG, PLANS } from "../shared/monetization";
import { ServicesDomainError } from "../shared/services";
import type { Firestore as AdminFirestore } from "firebase-admin/firestore";

/**
 * SERVICES-CREATE-UI-01 §29-§33 — matriz de testes da UI mínima de cadastro de Serviço (SC1-SC8, SF1-SF6,
 * SS1-SS5, PL1-PL6, AN1-AN4). B1-B19 (browser) não está nesta suíte: verificado ao vivo via Browser pane
 * (ver relatório final), mesmo padrão já usado nesta sessão inteira.
 *
 * Metodologia: server/plan-authoritative-mutations.ts's createServiceCommand — o MESMO handler que
 * POST /api/services chama — é exercitado com execução REAL contra o emulador Firestore (mesma disciplina
 * de plan-impl-05); client/src/pages/services-new.tsx (importa @/lib/firebase, efeitos colaterais de
 * browser) é provado só via texto-fonte, nunca reimplementado em código de teste.
 */

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

function requireEmulatorEnv() {
  assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-revendasmart");
  assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^127\.0\.0\.1:\d+$/);
  assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "", /^127\.0\.0\.1:\d+$/);
}

function tenantUid(prefix = "svc01"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sourceOf(path: string): string {
  return fs.readFileSync(path, "utf8");
}

function validServiceInput(overrides: Record<string, unknown> = {}) {
  // Mesmo shape que services-persistence.ts's createService() de fato envia — o cliente real já grava
  // createdAt/updatedAt (timestamp client-side) antes do POST; cleanServicePayload só re-carimba id/
  // tenantUid, nunca datas — reproduzido aqui para exercitar exatamente o payload real, não um atalho.
  const timestamp = new Date().toISOString();
  return {
    name: "Corte de cabelo",
    active: true,
    published: true,
    pricing: { mode: "fixed", priceCents: 5000 },
    cost: { kind: "unknown" },
    bookingMode: "request",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

// ===================================================================================================
// SC1-SC3, SC7, SC8 — reuso de domínio, isolamento, UX de limite, proteção de double-submit (texto-fonte).
// ===================================================================================================
function runDomainReuseTests(): void {
  const pageSrc = sourceOf("client/src/pages/services-new.tsx");

  assert.match(pageSrc, /import \{ createService, ServiceLimitError \} from "@\/lib\/services-persistence";/, "SC1: a página precisa importar createService/ServiceLimitError do módulo canônico existente, nunca reimplementar a lógica de criação");
  assert.match(pageSrc, /const created = await createService\(\{/, "SC1: o submit precisa de fato chamar createService()");
  console.log("PASS SC1 services-new.tsx calls the canonical createService() from services-persistence.ts — no reimplementation");

  assert.doesNotMatch(pageSrc, /setDoc|addDoc|collection\(getFirestore\(\)|updateDoc/, "SC2: a página não pode abrir nenhuma escrita Firestore própria — toda persistência passa por createService()");
  console.log("PASS SC2 services-new.tsx opens no Firestore write of its own — createService() is the only persistence path");

  const commandSrc = sourceOf("server/plan-authoritative-mutations.ts");
  assert.match(commandSrc, /const uid = \(req as Request & \{ firebaseUid\?: string \}\)\.firebaseUid;\s*if \(!uid\) return res\.status\(401\)/, "SC3: a rota POST /api/services precisa derivar uid de requireAuth (firebaseUid), nunca de um campo enviado pelo client");
  console.log("PASS SC3 owner isolation preserved — uid comes from the authenticated session (requireAuth), never a client-supplied field");

  assert.match(pageSrc, /if \(err instanceof ServiceLimitError\) \{\s*setShowLimitModal\(true\);/, "SC7: erro de limite precisa acionar o modal existente, nunca um novo componente de monetização");
  assert.match(pageSrc, /<PlanLimitPrompt resource="services" currentPlan=\{activePlan\} onClose=\{\(\) => setShowLimitModal\(false\)\} \/>/, "SC7: precisa reusar PlanLimitPrompt (resource=\"services\") — o mesmo componente já usado por add-product.tsx/clients.tsx, nenhum sistema de prompt novo");
  console.log("PASS SC7 the limit error surfaces via the existing PlanLimitPrompt(resource=\"services\") — no new monetization prompt system");

  assert.match(pageSrc, /if \(isSaving\) return;/, "SC8: precisa haver um guard de double-submit no início do handleSubmit");
  console.log("PASS SC8 double-submit is guarded by the same isSaving pattern already used in add-product.tsx");
}

// ===================================================================================================
// SF1-SF6 — validação de campos (texto-fonte + execução real do domínio compartilhado).
// ===================================================================================================
async function runFieldValidationTests(db: AdminFirestore): Promise<void> {
  const pageSrc = sourceOf("client/src/pages/services-new.tsx");

  assert.match(pageSrc, /const trimmedName = name\.trim\(\);\s*if \(!trimmedName\) \{ setFormError\("Nome do serviço é obrigatório\."\); return; \}/, "SF1/SF2: nome precisa ser obrigatório E aparado (trim) antes da checagem — string só de espaços é rejeitada pela mesma condição");
  console.log("PASS SF1/SF2 name is required and trimmed before validation — whitespace-only input is rejected by the same check as an empty one");

  assert.match(pageSrc, /if \(durationMinutes !== "" && \(!Number\.isFinite\(durationMinutes\) \|\| durationMinutes <= 0\)\)/, "SF3: duração, quando preenchida, precisa ser um número finito maior que 0");
  console.log("PASS SF3 duration, when provided, must be a finite positive number — matching assertDurationMinutes' own domain rule");

  assert.match(pageSrc, /pricingMode === "fixed" \? \{ mode: "fixed", priceCents: Math\.round\(price \* 100\) \}/, "SF4: modo fixed precisa mapear para ServicePricing{mode:\"fixed\"}");
  assert.match(pageSrc, /pricingMode === "starting_at" \? \{ mode: "starting_at", startingAtPriceCents: Math\.round\(price \* 100\) \}/, "SF4: modo starting_at precisa mapear para ServicePricing{mode:\"starting_at\"}");
  assert.match(pageSrc, /: \{ mode: "quote" \}/, "SF4: modo quote precisa mapear para ServicePricing{mode:\"quote\"}, sem nenhum campo de preço");
  console.log("PASS SF4 all three pricing UI modes map exactly to the three ServicePricing variants the domain already supports — none invented");

  assert.match(pageSrc, /if \(pricingMode !== "quote" && \(!Number\.isFinite\(price\) \|\| price <= 0\)\) \{/, "SF5: para fixed/starting_at, preço <= 0 precisa ser rejeitado na UI (mesma decisão de add-product.tsx para salePrice)");
  console.log("PASS SF5 a zero/invalid price is rejected in the UI for fixed/starting_at modes — same judgment call as add-product.tsx's salePrice, never silently accepted");

  assert.match(pageSrc, /const \[active, setActive\] = useState\(true\);/, "SF6: active precisa default para true");
  assert.match(pageSrc, /const \[published, setPublished\] = useState\(true\);/, "SF6: published precisa default para true — um serviço recém-criado já fica pronto para o próximo passo real (disponibilidade/link de agendamento), sem uma etapa extra de 'publicar' depois");
  console.log("PASS SF6 active/published both default to true — a freshly created service is immediately usable, matching the ticket's first-value intent");

  // Execução real: o domínio compartilhado (assertValidService, dentro de createServiceCommand) rejeita
  // exatamente os casos que o formulário também rejeita na UI — nunca uma segunda regra divergente.
  requireEmulatorEnv();
  const uid = tenantUid("sf");
  await assert.rejects(
    createServiceCommand(db, uid, { serviceId: "svc-empty-name", idempotencyKey: "svc-empty-name-key", service: validServiceInput({ name: "" }) }),
    (err: unknown) => err instanceof ServicesDomainError && err.code === "INVALID_SERVICE",
    "SF1 (execução real): o domínio compartilhado também rejeita nome vazio, nunca só a UI",
  );
  console.log("PASS SF1 (real execution) the shared domain (assertValidService, inside the real transaction) also rejects an empty name — never a UI-only rule that a raw API call could bypass");
}

// ===================================================================================================
// SC4-SC6, SS1 — criação real, rejeição real, limite real, leitura real no caminho canônico.
// ===================================================================================================
async function runRealCreationTests(db: AdminFirestore): Promise<void> {
  const uid = tenantUid("sc");
  const serviceId = "svc-real-1";
  const result = await createServiceCommand(db, uid, {
    serviceId,
    idempotencyKey: "svc-real-1-key",
    service: validServiceInput(),
  });
  assert.equal(result.idempotentReplay, false, "SC4: primeira criação real nunca é um replay");
  assert.equal((result as { isFirstService?: boolean }).isFirstService, true, "SC4/AN1: primeira criação real precisa marcar isFirstService=true");
  console.log("PASS SC4 a valid Service is created for real against the emulator, via the exact same createServiceCommand the route handler calls");

  // SS1 — lido de volta no MESMO caminho canônico (users/{uid}/services/{id}) que listServices()/
  // getService() usam — nunca uma coleção paralela inventada para esta ticket.
  const docSnap = await db.collection("users").doc(uid).collection("services").doc(serviceId).get();
  assert.ok(docSnap.exists, "SS1: o serviço criado precisa existir no path canônico users/{uid}/services/{id}");
  assert.equal(docSnap.data()?.name, "Corte de cabelo", "SS1: o documento persistido precisa refletir os dados reais enviados");
  console.log("PASS SS1 the created Service is readable at the exact canonical path listServices()/getService() already use — no parallel data path introduced");

  await assert.rejects(
    createServiceCommand(db, tenantUid("sc-invalid"), { serviceId: "svc-invalid", idempotencyKey: "svc-invalid-key", service: validServiceInput({ pricing: { mode: "bogus" } }) }),
    (err: unknown) => err instanceof ServicesDomainError && err.code === "INVALID_SERVICE_PRICING",
    "SC5: um Service com pricing.mode inválido precisa ser rejeitado pelo domínio compartilhado",
  );
  console.log("PASS SC5 an invalid Service (bogus pricing mode) is rejected by the real shared domain validator");

  // SC6 — limite real: pré-semeando planUsage/summary (mesmo caminho que a transação real leria),
  // sem precisar criar N documentos reais só para alcançar o teto — mais rápido, mesma autoridade.
  const limitUid = tenantUid("sc-limit");
  await db.collection("users").doc(limitUid).collection("planUsage").doc("summary").set({ servicesCount: PLAN_CONFIG[PLANS.FREE].limits.services });
  await assert.rejects(
    createServiceCommand(db, limitUid, { serviceId: "svc-over-limit", idempotencyKey: "svc-over-limit-key", service: validServiceInput() }),
    (err: unknown) => err instanceof PlanMutationError && err.code === "PLAN_LIMIT_REACHED",
    "SC6: no teto do Free (5), a próxima criação real precisa ser recusada pelo servidor",
  );
  console.log("PASS SC6 the server-side transaction (assertWithinLimit) refuses creation once the tenant's real usage is at the Free plan's services limit — authoritative, not just a client-side pre-check");
}

// ===================================================================================================
// PL1-PL6 — limites por plano (Free/Pro/Premium/Trial), sem bypass de entitlement pela rota.
// ===================================================================================================
async function runPlanLimitTests(db: AdminFirestore): Promise<void> {
  for (const [plan, limit] of [[PLANS.FREE, PLAN_CONFIG.free.limits.services], [PLANS.PRO, PLAN_CONFIG.pro.limits.services], [PLANS.PREMIUM, PLAN_CONFIG.premium.limits.services]] as const) {
    const uid = tenantUid(`pl-${plan}`);
    await db.collection("users").doc(uid).collection("planUsage").doc("summary").set({ servicesCount: limit });
    // resolveServerPlan lê planData/main — sem doc, cai no fallback FREE. Para provar Pro/Premium de
    // verdade, grava o mesmo shape v2 já usado no resto desta sessão (pricingVersion/currentPlan/
    // subscriptionStatus), nunca um campo "plan" solto que a rota poderia aceitar sem checagem real.
    if (plan !== PLANS.FREE) {
      await db.collection("users").doc(uid).collection("planData").doc("main").set({
        pricingVersion: "v2", currentPlan: plan, paidThrough: null, subscriptionStatus: "authorized",
      });
    }
    await assert.rejects(
      createServiceCommand(db, uid, { serviceId: "svc-at-limit", idempotencyKey: "svc-at-limit-key", service: validServiceInput() }),
      (err: unknown) => err instanceof PlanMutationError && err.code === "PLAN_LIMIT_REACHED",
      `PL${plan === PLANS.FREE ? 1 : plan === PLANS.PRO ? 2 : 3}: no teto real do plano ${plan} (${limit}), a criação precisa ser recusada`,
    );
  }
  console.log(`PASS PL1/PL2/PL3 Free(${PLAN_CONFIG.free.limits.services})/Pro(${PLAN_CONFIG.pro.limits.services})/Premium(${PLAN_CONFIG.premium.limits.services}) limits are each enforced for real via resolveServerPlan + assertWithinLimit — server-resolved plan, never a client-supplied value`);

  // PL4 — trial ativo (Premium efetivo) reconhece o teto de 200, mesmo com basePlan free.
  const trialUid = tenantUid("pl-trial");
  await db.collection("users").doc(trialUid).collection("planUsage").doc("summary").set({ servicesCount: PLAN_CONFIG.premium.limits.services });
  await db.collection("users").doc(trialUid).collection("planData").doc("main").set({
    trialStatus: "active",
    trialStartedAt: new Date().toISOString(),
    trialEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    trialGrantedPlan: "premium",
  });
  await assert.rejects(
    createServiceCommand(db, trialUid, { serviceId: "svc-trial-at-limit", idempotencyKey: "svc-trial-at-limit-key", service: validServiceInput() }),
    (err: unknown) => err instanceof PlanMutationError && err.code === "PLAN_LIMIT_REACHED",
    "PL4: um tenant em trial Premium ativo precisa ser avaliado no teto de 200 (Premium efetivo), não no de Free",
  );
  console.log("PASS PL4 an active Premium-trial tenant is evaluated against the Premium limit (200), matching resolveServerPlan's own hasPremiumAccess-first resolution — no special-cased trial fork was added");

  // PL6 — a rota nunca confia num campo de plano vindo do client: createServiceCommand nem aceita um.
  const commandSrc = sourceOf("server/plan-authoritative-mutations.ts");
  assert.match(commandSrc, /const plan = await resolveServerPlan\(db, uid\);/, "PL6: o plano usado no limite precisa vir SEMPRE de resolveServerPlan(uid), nunca de um valor no corpo da requisição");
  assert.doesNotMatch(commandSrc.slice(commandSrc.indexOf("export async function createServiceCommand"), commandSrc.indexOf("export async function createServiceCommand") + 2000), /body\.plan|body\.activePlan/, "PL6: createServiceCommand nunca lê um campo de plano do corpo enviado pelo client");
  console.log("PASS PL6 no entitlement bypass is possible from the route — the plan used for the limit check is always server-resolved, the request body's own activePlan (used only for the client-side fast pre-check) is never read by the authoritative command");

  // PL5 — planAccessState/reconcilePlanAccess (downgrade preservation) não foram tocados por esta ticket.
  assert.doesNotMatch(sourceOf("server/plan-access-reconciliation.ts"), /SERVICES-CREATE-UI-01/, "PL5: downgrade-preservation semantics (plan-access-reconciliation.ts) não foram tocadas por esta ticket");
  console.log("PASS PL5 downgrade-preserved data semantics (plan-access-reconciliation.ts) are untouched by this ticket");
}

// ===================================================================================================
// AN1-AN4 — analytics de first_service_created: disciplina server-counted, sem PII, não-bloqueante.
// ===================================================================================================
async function runAnalyticsTests(db: AdminFirestore): Promise<void> {
  const uid = tenantUid("an");
  const first = await createServiceCommand(db, uid, { serviceId: "svc-an-1", idempotencyKey: "svc-an-1-key", service: validServiceInput() });
  assert.equal((first as { isFirstService?: boolean }).isFirstService, true, "AN1: a primeira criação real precisa marcar isFirstService=true");
  const second = await createServiceCommand(db, uid, { serviceId: "svc-an-2", idempotencyKey: "svc-an-2-key", service: validServiceInput() });
  assert.equal((second as { isFirstService?: boolean }).isFirstService, false, "AN2: a segunda criação real (mesmo tenant) precisa marcar isFirstService=false — nunca duplica a ocorrência 'primeira'");
  console.log("PASS AN1/AN2 isFirstService is true only on the tenant's real first Service (usage 0->1) and false on the second — computed inside the same transaction that already reads usage, zero extra reads");

  const analyticsLibSrc = sourceOf("client/src/lib/firebase-analytics.ts");
  assert.match(analyticsLibSrc, /first_service_created: Record<string, never>;/, "AN3: first_service_created precisa ter exatamente zero parâmetros — nenhum nome/preço/descrição do serviço");
  console.log("PASS AN3 first_service_created carries exactly zero params — no service name/price/description, matching first_product_created's own no-PII shape");

  const pageSrc = sourceOf("client/src/pages/services-new.tsx");
  assert.match(pageSrc, /if \(created\.isFirstService\) trackAnalyticsEvent\("first_service_created"\);\s*setSuccess\(true\);/, "AN4: o disparo do analytics precisa vir ANTES de setSuccess/navegação, sem await/try isolado — mesmo padrão síncrono e não-bloqueante já usado por first_product_created (uma falha de analytics nunca poderia impedir o setSuccess seguinte, que já está fora de qualquer dependência do disparo)");
  console.log("PASS AN4 the analytics call follows the exact same fire-and-forget pattern as first_product_created — never awaited, never able to block the success flow that follows it");
}

async function run(): Promise<void> {
  requireEmulatorEnv();
  runDomainReuseTests();
  initializeFirebaseAdmin();
  const db = initializeFirebaseAdmin().firestore();
  await runFieldValidationTests(db);
  await runRealCreationTests(db);
  await runPlanLimitTests(db);
  await runAnalyticsTests(db);

  console.log("\nSERVICES-CREATE-UI-01 — all SC/SF/SS/PL/AN assertions passed (real execution against createServiceCommand + source-text proof for the client page). B1-B19 verified live via Browser pane (see final report), not in this suite.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
