/**
 * PROMOTIONAL-CAMPAIGNS-01 §18/§19/§32/§33 — testes contra o emulador real (Auth + Firestore), mesmo
 * padrão de `script/owner-access-02-tests.ts`: sobe o app COMPLETO (`registerRoutes`) e chama as rotas
 * por HTTP real com tokens reais, para exercitar o `requireAuth`/`requireAdmin`/claim atômico de
 * produção — não uma reimplementação de teste.
 */
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
process.env.FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || "demo-revendasmart.appspot.com";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:9199";

const [{ initializeFirebaseAdmin, getFirebaseAdmin }, { registerRoutes }] = await Promise.all([
  import("../server/firebase-admin-init"),
  import("../server/routes"),
]);

initializeFirebaseAdmin();

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const suffix = Date.now();
const PASSWORD = "PromoCampaigns01-test-password!";

const adminAUid = `pc01-admin-a-${suffix}`;
const adminBUid = `pc01-admin-b-${suffix}`;
const regularUid = `pc01-user-${suffix}`;
const clientJoaoId = `pc01-client-joao-${suffix}`;
const clientMariaId = `pc01-client-maria-${suffix}`;

async function main() {
  const admin = getFirebaseAdmin();
  const authAdmin = admin.auth();
  const db = admin.firestore();

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${(address as { port: number }).port}`;

  const clientApp = initializeApp(
    { apiKey: "demo-api-key", authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID, appId: "1:0:web:pc01" },
    `pc01-${suffix}`,
  );
  connectAuthEmulator(getAuth(clientApp), "http://127.0.0.1:9099", { disableWarnings: true });

  async function createAdminAndToken(uid: string): Promise<string> {
    const email = `${uid}@example.test`;
    await authAdmin.createUser({ uid, email, password: PASSWORD });
    await authAdmin.setCustomUserClaims(uid, { admin: true });
    return (await signInWithEmailAndPassword(getAuth(clientApp), email, PASSWORD)).user.getIdToken(true);
  }
  async function createUserAndToken(uid: string): Promise<string> {
    const email = `${uid}@example.test`;
    await authAdmin.createUser({ uid, email, password: PASSWORD });
    return (await signInWithEmailAndPassword(getAuth(clientApp), email, PASSWORD)).user.getIdToken();
  }

  const adminAToken = await createAdminAndToken(adminAUid);
  const adminBToken = await createAdminAndToken(adminBUid);
  const regularToken = await createUserAndToken(regularUid);

  function authed(token: string) {
    return { authorization: `Bearer ${token}`, "content-type": "application/json" };
  }
  async function getJson(path: string, token?: string) {
    const response = await fetch(`${baseUrl}${path}`, { headers: token ? authed(token) : undefined });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }
  async function postJson(path: string, body: unknown, token?: string) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: token ? authed(token) : { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }
  async function patchJson(path: string, body: unknown, token: string) {
    const response = await fetch(`${baseUrl}${path}`, { method: "PATCH", headers: authed(token), body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  // ===== Fixture: cliente João, R$350 em vendas (§33 do ticket) =====
  await db.doc(`users/${adminAUid}/clients/${clientJoaoId}`).set({ id: clientJoaoId, name: "João", phone: "11999990000" });
  await db.doc(`users/${adminAUid}/clients/${clientMariaId}`).set({ id: clientMariaId, name: "Maria", phone: "11999990001" });
  const now = new Date();
  const startsAt = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const endsAt = new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString();
  const saleDate = new Date(now.getTime() - 3600 * 1000).toISOString();
  for (const [id, total] of [["pc01-sale-1", 150], ["pc01-sale-2", 200]] as const) {
    await db.doc(`users/${adminAUid}/sales/${id}`).set({ id, clientId: clientJoaoId, total, totalPrice: total, date: saleDate, products: [] });
  }

  // ===== A: não-admin não pode criar campanha =====
  {
    const { status } = await postJson("/api/admin/sorteios/campaigns", { title: "x", prizeName: "x", startsAt, endsAt }, regularToken);
    assert.equal(status, 403, "A: não-admin criando campanha precisa ser DENY");
  }

  // ===== B: admin cria campanha (Sorteio Malbec EDP, R$100, 0-100) =====
  const created = await postJson("/api/admin/sorteios/campaigns", {
    title: "Sorteio Malbec EDP", prizeName: "Garrafa de vinho Malbec", description: "Teste",
    startsAt, endsAt, spendPerEntry: 100, numberCount: 100, allocationMode: "customer_choice",
  }, adminAToken);
  assert.equal(created.status, 201, "B: criação de campanha deve suceder");
  const campaignId = created.body.id as string;
  const campaignSlug = created.body.slug as string;
  assert.equal(created.body.status, "draft", "B: campanha nasce em draft");

  // ===== C: ativação =====
  {
    const { status, body } = await patchJson(`/api/admin/sorteios/campaigns/${campaignId}/status`, { status: "active" }, adminAToken);
    assert.equal(status, 200, "C: ativação deve suceder");
    assert.equal(body.status, "active");
  }

  // ===== D: cross-owner — admin B não enxerga a campanha de admin A =====
  {
    const { status } = await getJson(`/api/admin/sorteios/campaigns/${campaignId}`, adminBToken);
    assert.equal(status, 403, "D: cross-owner precisa ser DENY");
  }

  // ===== E: gerar link para João =====
  const linkJoao = await postJson(`/api/admin/sorteios/campaigns/${campaignId}/links`, { customerId: clientJoaoId }, adminAToken);
  assert.equal(linkJoao.status, 201, "E: geração de link deve suceder");
  const tokenJoao = linkJoao.body.token as string;
  assert.equal(linkJoao.body.slug, campaignSlug);

  // ===== F: página pública calcula 3 direitos (R$350 / R$100 = 3) =====
  {
    const { status, body } = await getJson(`/api/public/sorteios/${campaignSlug}?t=${tokenJoao}`);
    assert.equal(status, 200, "F: visualização pública deve suceder");
    assert.equal(body.entriesAvailable, 3, "F: R$350/R$100 = 3 direitos");
    assert.equal((body.numbers as unknown[]).length, 100, "F: numberCount=100 => grade 1-100 = 100 números");
  }

  // ===== G: claim de 3 números (12, 38, 67) confirma =====
  {
    const { status, body } = await postJson(`/api/public/sorteios/${campaignSlug}/claim`, { token: tokenJoao, numbers: [12, 38, 67] });
    assert.equal(status, 200);
    assert.equal(body.ok, true, "G: claim válido dentro do limite de direitos deve confirmar");
    assert.deepEqual(body.claimedNumbers, [12, 38, 67]);
  }

  // ===== H: reabrir o link mostra 0 direitos disponíveis e os números como "meus" =====
  {
    const { body } = await getJson(`/api/public/sorteios/${campaignSlug}?t=${tokenJoao}`);
    assert.equal(body.entriesAvailable, 0, "H: sem direitos restantes após usar os 3");
    assert.deepEqual(body.myNumbers, [12, 38, 67]);
  }

  // ===== I: outro cliente (Maria) não consegue escolher um número já claimed por João =====
  const linkMaria = await postJson(`/api/admin/sorteios/campaigns/${campaignId}/links`, { customerId: clientMariaId }, adminAToken);
  const tokenMaria = linkMaria.body.token as string;
  await db.doc(`users/${adminAUid}/sales/pc01-sale-maria`).set({ id: "pc01-sale-maria", clientId: clientMariaId, total: 500, totalPrice: 500, date: saleDate, products: [] });
  {
    const { body } = await postJson(`/api/public/sorteios/${campaignSlug}/claim`, { token: tokenMaria, numbers: [38] });
    assert.equal(body.ok, false, "I: número já claimed por outro cliente precisa ser DENY");
    assert.equal(body.denyReason, "NUMBER_ALREADY_CLAIMED");
    assert.equal(body.conflictingNumber, 38);
  }

  // ===== J: concorrência — João e Maria tentam confirmar o MESMO número livre (55) simultaneamente;
  // exatamente um vence, o outro recebe conflito; 55 nunca pertence aos dois. =====
  {
    // João já usou seus 3 direitos — usamos duas claims de Maria (que ainda tem direitos de R$500)
    // para o MESMO número 60, disparadas em paralelo de verdade.
    const [raceA, raceB] = await Promise.all([
      postJson(`/api/public/sorteios/${campaignSlug}/claim`, { token: tokenMaria, numbers: [60] }),
      postJson(`/api/public/sorteios/${campaignSlug}/claim`, { token: tokenMaria, numbers: [60] }),
    ]);
    const oks = [raceA, raceB].filter((r) => r.body.ok === true);
    const denies = [raceA, raceB].filter((r) => r.body.ok === false);
    assert.equal(oks.length, 1, "J: exatamente uma das duas claims concorrentes para o número 60 deve vencer");
    assert.equal(denies.length, 1, "J: a outra precisa receber conflito");
    assert.equal(denies[0].body.denyReason, "NUMBER_ALREADY_CLAIMED");
    const numberSnap = await db.doc(`promotionalCampaigns/${campaignId}/numbers/60`).get();
    assert.equal(numberSnap.data()?.status, "claimed", "J: número 60 precisa terminar claimed por exatamente um customerId");
  }

  // ===== K: token inválido/revogado =====
  {
    const invalid = await getJson(`/api/public/sorteios/${campaignSlug}?t=token-que-nao-existe`);
    assert.equal(invalid.status, 403, "K: token inválido precisa ser DENY");

    const linkToRevoke = await postJson(`/api/admin/sorteios/campaigns/${campaignId}/links`, { customerId: clientJoaoId }, adminAToken);
    await postJson(`/api/admin/sorteios/campaigns/${campaignId}/links/${linkToRevoke.body.tokenId}/revoke`, {}, adminAToken);
    const revokedClaim = await postJson(`/api/public/sorteios/${campaignSlug}/claim`, { token: linkToRevoke.body.token, numbers: [70] });
    assert.equal(revokedClaim.body.ok, false, "K: token revogado precisa ser DENY");
    assert.equal(revokedClaim.body.denyReason, "REVOKED_TOKEN");
  }

  // ===== L: campanha draft/paused/finished não aceita claim =====
  {
    const draftCreated = await postJson("/api/admin/sorteios/campaigns", {
      title: "Rascunho", prizeName: "x", startsAt, endsAt, spendPerEntry: 100, numberCount: 10,
    }, adminAToken);
    const draftSlug = draftCreated.body.slug as string;
    const draftLink = await postJson(`/api/admin/sorteios/campaigns/${draftCreated.body.id}/links`, { customerId: clientJoaoId }, adminAToken);
    const draftClaim = await postJson(`/api/public/sorteios/${draftSlug}/claim`, { token: draftLink.body.token, numbers: [1] });
    assert.equal(draftClaim.body.denyReason, "CAMPAIGN_NOT_ACTIVE", "L: draft precisa recusar claim");

    await patchJson(`/api/admin/sorteios/campaigns/${draftCreated.body.id}/status`, { status: "active" }, adminAToken);
    await patchJson(`/api/admin/sorteios/campaigns/${draftCreated.body.id}/status`, { status: "paused" }, adminAToken);
    const pausedClaim = await postJson(`/api/public/sorteios/${draftSlug}/claim`, { token: draftLink.body.token, numbers: [1] });
    assert.equal(pausedClaim.body.denyReason, "CAMPAIGN_NOT_ACTIVE", "L: paused precisa recusar claim");

    await patchJson(`/api/admin/sorteios/campaigns/${draftCreated.body.id}/status`, { status: "finished" }, adminAToken);
    const finishedClaim = await postJson(`/api/public/sorteios/${draftSlug}/claim`, { token: draftLink.body.token, numbers: [1] });
    assert.equal(finishedClaim.body.denyReason, "CAMPAIGN_NOT_ACTIVE", "L: finished precisa recusar claim");
  }

  server.close();
  console.log("PROMOTIONAL-CAMPAIGNS-01 owner-access/concurrency tests passed: non-admin create denied, cross-owner detail denied, entitlement computed from real sales (350/100=3), claim confirms atomically, reopening link reflects 0 remaining + own numbers, another customer blocked from an already-claimed number, concurrent claims for the same number resolve to exactly one winner, invalid/revoked token denied, draft/paused/finished campaigns reject claims.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
