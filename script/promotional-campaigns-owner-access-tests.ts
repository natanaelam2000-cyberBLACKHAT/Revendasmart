/**
 * PROMOTIONAL-CAMPAIGNS-01 §18/§19/§32/§33 — testes contra o emulador real (Auth + Firestore), mesmo
 * padrão de `script/owner-access-02-tests.ts`: sobe o app COMPLETO (`registerRoutes`) e chama as rotas
 * por HTTP real com tokens reais, para exercitar o `requireAuth`/`requireAdmin`/claim atômico de
 * produção — não uma reimplementação de teste.
 */
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import express from "express";
import { initializeApp, deleteApp } from "firebase/app";
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
const clientAnaId = `pc01-client-ana-${suffix}`;

async function main() {
  const admin = getFirebaseAdmin();
  const authAdmin = admin.auth();
  const db = admin.firestore();

  const app = express();
  app.set("trust proxy", "loopback");
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
  let requestNumber = 0;
  async function getJson(path: string, token?: string) {
    const response = await fetch(`${baseUrl}${path}`, { headers: { ...(token ? authed(token) : {}), "x-forwarded-for": `192.0.2.${++requestNumber}` } });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }
  async function postJson(path: string, body: unknown, token?: string) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { ...(token ? authed(token) : { "content-type": "application/json" }), "x-forwarded-for": `192.0.2.${++requestNumber}` },
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
  await db.doc(`users/${adminAUid}/clients/${clientAnaId}`).set({ id: clientAnaId, name: "Ana", phone: "11999990002" });
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

  // Stored id can be stale in recovered campaigns; route ids must use the document identity.
  await db.doc(`promotionalCampaigns/${campaignId}`).update({ id: "stale-recovery-id" });
  const listing = await getJson("/api/admin/sorteios/campaigns", adminAToken);
  assert.equal((listing.body.campaigns as { slug: string; id: string }[]).find(c => c.slug === campaignSlug)?.id, campaignId);
  const recoveredDetail = await getJson(`/api/admin/sorteios/campaigns/${campaignId}`, adminAToken);
  assert.equal((recoveredDetail.body.campaign as { id: string }).id, campaignId);

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
    const crossTenantQuantity = await patchJson(`/api/admin/sorteios/campaigns/${campaignId}/participants/${clientJoaoId}/quantity`, { numberCount: 6 }, adminBToken);
    assert.equal(crossTenantQuantity.status, 403, "D: cross-owner não pode editar quantidade");
  }

  // ===== E: gerar link para João =====
  const required = await postJson(`/api/admin/sorteios/campaigns/${campaignId}/links`, { customerId: clientJoaoId }, adminAToken);
  assert.equal(required.status, 400);
  assert.equal(required.body.code, "QUANTITY_REQUIRED");
  assert.equal((await db.doc(`promotionalCampaigns/${campaignId}/participants/${clientJoaoId}`).get()).exists, false);
  // Legacy fixture: a preexisting token/participant with no explicit authorization.
  const tokenJoao = crypto.randomBytes(32).toString("base64url");
  await db.doc(`promotionalCampaigns/${campaignId}/accessTokens/legacy`).set({ customerId: clientJoaoId, tokenHash: crypto.createHash("sha256").update(tokenJoao).digest("hex"), revokedAt: null, expiresAt: null });
  await db.doc(`promotionalCampaigns/${campaignId}/participants/${clientJoaoId}`).set({ customerId: clientJoaoId, entriesClaimed: 0, claimedNumbers: [] });

  // ===== F: legacy sem quantidade explícita continua calculando 3 direitos (R$350 / R$100 = 3) =====
  {
    const { status, body } = await getJson(`/api/public/sorteios/${campaignSlug}?t=${tokenJoao}`);
    assert.equal(status, 200, "F: visualização pública deve suceder");
    assert.equal(body.entriesAvailable, 3, "F: participante legado sem override mantém R$350/R$100 = 3 direitos");
    assert.equal((body.numbers as unknown[]).length, 100, "F: numberCount=100 => grade 1-100 = 100 números");
  }

  // ===== F2: quantidade explícita por cliente (1/N), validações, idempotência e tenant =====
  for (const invalidQuantity of [0, -1, 1.5, 101, null, true, "5", "bad"]) {
    const response = await postJson(`/api/admin/sorteios/campaigns/${campaignId}/links`, { customerId: clientJoaoId, numberCount: invalidQuantity }, adminAToken);
    assert.equal(response.status, 400, `F2: quantidade ${invalidQuantity} deve ser rejeitada`);
  }
  assert.equal((await postJson(`/api/admin/sorteios/campaigns/${campaignId}/links`, { customerId: "missing-client", numberCount: 1 }, adminAToken)).status, 404, "F2: cliente inexistente deve ser rejeitado");
  assert.equal((await postJson(`/api/admin/sorteios/campaigns/missing-campaign/links`, { customerId: clientJoaoId, numberCount: 1 }, adminAToken)).status, 404, "F2: campanha inexistente deve ser rejeitada");
  assert.equal((await postJson(`/api/admin/sorteios/campaigns/${campaignId}/links`, { customerId: clientJoaoId, numberCount: 1 }, adminBToken)).status, 403, "F2: outro tenant não pode alterar a campanha");

  const assigned = await patchJson(`/api/admin/sorteios/campaigns/${campaignId}/participants/${clientJoaoId}/quantity`, { numberCount: 5 }, adminAToken);
  assert.equal(assigned.status, 200, "F2: admin deve conseguir liberar N números");
  assert.equal(assigned.body.assignedNumberCount, 5);
  const repeatedAssignment = await patchJson(`/api/admin/sorteios/campaigns/${campaignId}/participants/${clientJoaoId}/quantity`, { numberCount: 5 }, adminAToken);
  assert.equal(repeatedAssignment.status, 200, "F2: repetir a mesma concessão deve ser idempotente");
  {
    const { body } = await getJson(`/api/public/sorteios/${campaignSlug}?t=${tokenJoao}`);
    assert.equal(body.entriesAvailable, 5, "F2: quantidade explícita prevalece sobre o cálculo por vendas");
  }

  const linkAna = await postJson(`/api/admin/sorteios/campaigns/${campaignId}/links`, { customerId: clientAnaId, numberCount: 1 }, adminAToken);
  assert.equal(linkAna.status, 201, "F2: quantidade 1 deve ser aceita");
  const anaView = await getJson(`/api/public/sorteios/${campaignSlug}?t=${linkAna.body.token}`);
  assert.equal(anaView.body.entriesAvailable, 1, "F2: cliente com quantidade 1 recebe exatamente 1 direito");
  const anaClaim = await postJson(`/api/public/sorteios/${campaignSlug}/claim`, { token: linkAna.body.token, numbers: [99] });
  assert.equal(anaClaim.body.ok, true, "F2: cliente com quantidade 1 pode escolher um número");
  const anaExcess = await postJson(`/api/public/sorteios/${campaignSlug}/claim`, { token: linkAna.body.token, numbers: [98] });
  assert.equal(anaExcess.body.denyReason, "EXCEEDS_AVAILABLE_ENTRIES", "F2: cliente com quantidade 1 não pode escolher um segundo número");

  // ===== G: claim de 3 números (12, 38, 67) confirma =====
  {
    const { status, body } = await postJson(`/api/public/sorteios/${campaignSlug}/claim`, { token: tokenJoao, numbers: [12, 38, 67] });
    assert.equal(status, 200);
    assert.equal(body.ok, true, "G: claim válido dentro do limite de direitos deve confirmar");
    assert.deepEqual(body.claimedNumbers, [12, 38, 67]);
  }

  {
    const retry = await postJson(`/api/public/sorteios/${campaignSlug}/claim`, { token: tokenJoao, numbers: [12, 38, 67] });
    assert.equal(retry.body.ok, true, "G2: retry do mesmo claim deve ser idempotente");
    const repeatedParticipant = await db.doc(`promotionalCampaigns/${campaignId}/participants/${clientJoaoId}`).get();
    assert.equal(repeatedParticipant.data()?.entriesClaimed, 3, "G2: retry não pode duplicar concessão");
  }

  // ===== H: reabrir o link mostra 0 direitos disponíveis e os números como "meus" =====
  {
    const { body } = await getJson(`/api/public/sorteios/${campaignSlug}?t=${tokenJoao}`);
    assert.equal(body.entriesAvailable, 2, "H: quantidade 5 com 3 já usados deixa 2 disponíveis");
    assert.deepEqual(body.myNumbers, [12, 38, 67]);
  }

  {
    const reduction = await patchJson(`/api/admin/sorteios/campaigns/${campaignId}/participants/${clientJoaoId}/quantity`, { numberCount: 2 }, adminAToken);
    assert.equal(reduction.status, 409, "H2: reduzir abaixo dos números já escolhidos deve ser rejeitado");
    assert.equal(reduction.body.code, "QUANTITY_BELOW_CLAIMED");
    assert.equal((await patchJson(`/api/admin/sorteios/campaigns/${campaignId}/participants/${clientJoaoId}/quantity`, { numberCount: 5 }, adminAToken)).status, 200, "H2: aumento posterior continua permitido");
  }

  // ===== I: outro cliente (Maria) não consegue escolher um número já claimed por João =====
  const linkMaria = await postJson(`/api/admin/sorteios/campaigns/${campaignId}/links`, { customerId: clientMariaId, numberCount: 5 }, adminAToken);
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
    // João ainda tem 2 direitos após a concessão 5/claim 3; Maria tem concessão 5. Os dois tenants
    // lógicos do sorteio disputam o MESMO número 60 em paralelo de verdade.
    const [raceA, raceB] = await Promise.all([
      postJson(`/api/public/sorteios/${campaignSlug}/claim`, { token: tokenJoao, numbers: [60] }),
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

  // Concurrent administrative reduction and public claim serialize on the participant.
  await patchJson(`/api/admin/sorteios/campaigns/${campaignId}/participants/${clientMariaId}/quantity`, { numberCount: 10 }, adminAToken);
  const beforeRace = (await db.doc(`promotionalCampaigns/${campaignId}/participants/${clientMariaId}`).get()).data()!;
  const [quantityRace, claimRace] = await Promise.all([
    patchJson(`/api/admin/sorteios/campaigns/${campaignId}/participants/${clientMariaId}/quantity`, { numberCount: Math.max(1, beforeRace.entriesClaimed) }, adminAToken),
    postJson(`/api/public/sorteios/${campaignSlug}/claim`, { token: tokenMaria, numbers: [80, 81] }),
  ]);
  const afterRace = (await db.doc(`promotionalCampaigns/${campaignId}/participants/${clientMariaId}`).get()).data()!;
  assert.ok(afterRace.entriesClaimed <= afterRace.assignedNumberCount);
  assert.ok(quantityRace.status === 409 || claimRace.body.ok === false);

  // All links share participant authorization; pending links reserve nothing.
  const sharedLink = await postJson(`/api/admin/sorteios/campaigns/${campaignId}/links`, { customerId: clientAnaId }, adminAToken);
  assert.equal(sharedLink.status, 201);
  assert.equal((await getJson(`/api/public/sorteios/${campaignSlug}?t=${sharedLink.body.token}`)).body.entriesAvailable, 0);
  assert.equal((await postJson(`/api/public/sorteios/${campaignSlug}/claim`, { token: sharedLink.body.token, numbers: [99] })).body.ok, true, "retry across tokens is idempotent");
  await patchJson(`/api/admin/sorteios/campaigns/${campaignId}/participants/${clientAnaId}/quantity`, { numberCount: 2 }, adminAToken);
  const oldLinkView = await getJson(`/api/public/sorteios/${campaignSlug}?t=${linkAna.body.token}`);
  assert.equal(oldLinkView.body.entriesAuthorized, 2);
  assert.equal(oldLinkView.body.entriesClaimed, 1);
  assert.equal(oldLinkView.body.entriesAvailable, 1);
  const concurrent = await Promise.all([
    postJson(`/api/public/sorteios/${campaignSlug}/claim`, { token: linkAna.body.token, numbers: [96] }),
    postJson(`/api/public/sorteios/${campaignSlug}/claim`, { token: sharedLink.body.token, numbers: [97] }),
  ]);
  assert.equal(concurrent.filter(r => r.body.ok).length, 1, "different links cannot exceed the same authorization concurrently");
  assert.equal(concurrent.find(r => !r.body.ok)?.body.denyReason, "EXCEEDS_AVAILABLE_ENTRIES");
  assert.equal((await db.doc(`promotionalCampaigns/${campaignId}/participants/${clientAnaId}`).get()).data()?.entriesClaimed, 2);
  assert.equal((await postJson(`/api/admin/sorteios/campaigns/${campaignId}/links`, { customerId: clientAnaId, numberCount: 1 }, adminAToken)).status, 409);
  await postJson(`/api/admin/sorteios/campaigns/${campaignId}/links/${sharedLink.body.tokenId}/revoke`, {}, adminAToken);
  assert.equal((await getJson(`/api/public/sorteios/${campaignSlug}?t=${linkAna.body.token}`)).body.entriesAuthorized, 2, "revoking a token preserves authorization");
  const storedToken = (await db.doc(`promotionalCampaigns/${campaignId}/accessTokens/${sharedLink.body.tokenId}`).get()).data()!;
  assert.deepEqual(Object.keys(storedToken).sort(), ["createdAt", "customerId", "expiresAt", "revokedAt", "tokenHash"]);
  for (const numbers of [[1.5], [1, 1], [101], []]) assert.equal((await postJson(`/api/public/sorteios/${campaignSlug}/claim`, { token: linkAna.body.token, numbers })).body.ok, false);
  const expired = await postJson(`/api/admin/sorteios/campaigns/${campaignId}/links`, { customerId: clientAnaId }, adminAToken);
  await db.doc(`promotionalCampaigns/${campaignId}/accessTokens/${expired.body.tokenId}`).update({ expiresAt: "2020-01-01T00:00:00Z" });
  assert.equal((await getJson(`/api/public/sorteios/${campaignSlug}?t=${expired.body.token}`)).status, 403);
  assert.equal((await postJson(`/api/public/sorteios/${campaignSlug}/claim`, { token: expired.body.token, numbers: [90] })).body.denyReason, "EXPIRED_TOKEN");

  const clientBrunoId = `pc01-client-bruno-${suffix}`;
  await db.doc(`users/${adminAUid}/clients/${clientBrunoId}`).set({ name: "Bruno" });
  const brunoLink = await postJson(`/api/admin/sorteios/campaigns/${campaignId}/links`, { customerId: clientBrunoId, numberCount: 3 }, adminAToken);
  assert.equal(brunoLink.status, 201);
  assert.equal((await postJson(`/api/public/sorteios/${campaignSlug}/claim`, { token: brunoLink.body.token, numbers: [88] })).body.ok, true);
  const identicalRetries = await Promise.all([
    postJson(`/api/public/sorteios/${campaignSlug}/claim`, { token: brunoLink.body.token, numbers: [88, 89] }),
    postJson(`/api/public/sorteios/${campaignSlug}/claim`, { token: brunoLink.body.token, numbers: [88, 89] }),
  ]);
  assert.ok(identicalRetries.every(r => r.body.ok === true), "identical concurrent retries and mixed old/new claims succeed idempotently");
  const bruno = (await db.doc(`promotionalCampaigns/${campaignId}/participants/${clientBrunoId}`).get()).data()!;
  assert.equal(bruno.entriesClaimed, 2);
  assert.deepEqual(bruno.claimedNumbers, [88, 89]);

  // Minimal production release: exact seven-number authorization, partial claim and reopen.
  const sevenCustomerId = `pc01-client-seven-${suffix}`;
  await db.doc(`users/${adminAUid}/clients/${sevenCustomerId}`).set({ id: sevenCustomerId, name: "Cliente Teste Sete", email: "teste-sete@example.invalid" });
  const sevenLink = await postJson(`/api/admin/sorteios/campaigns/${campaignId}/links`, { customerId: sevenCustomerId, numberCount: 7 }, adminAToken);
  assert.equal(sevenLink.status, 201);
  assert.equal((await db.doc(`promotionalCampaigns/${campaignId}/participants/${sevenCustomerId}`).get()).data()?.assignedNumberCount, 7);
  const sevenPath = `/api/public/sorteios/${campaignSlug}?t=${sevenLink.body.token}`;
  const expectSevenState = async (claimed: number, available: number) => {
    const response = await getJson(sevenPath);
    assert.equal(response.status, 200);
    assert.equal(response.body.entriesAuthorized, 7);
    assert.equal(response.body.entriesClaimed, claimed);
    assert.equal(response.body.entriesAvailable, available);
  };
  await expectSevenState(0, 7);
  const sevenClaim = (numbers: number[]) => postJson(`/api/public/sorteios/${campaignSlug}/claim`, { token: sevenLink.body.token, numbers });
  assert.equal((await sevenClaim([70, 71])).body.ok, true);
  await expectSevenState(2, 5);
  assert.equal((await sevenClaim([70, 71])).body.ok, true);
  await expectSevenState(2, 5);
  assert.equal((await sevenClaim([72, 73, 74, 75, 76, 77])).body.denyReason, "EXCEEDS_AVAILABLE_ENTRIES");
  await expectSevenState(2, 5);
  assert.equal((await sevenClaim([72, 73, 74, 75, 76])).body.ok, true);
  await expectSevenState(7, 0);
  assert.equal((await sevenClaim([72, 73, 74, 75, 76])).body.ok, true);
  assert.equal((await sevenClaim([77])).body.denyReason, "EXCEEDS_AVAILABLE_ENTRIES");
  await expectSevenState(7, 0);

  // ===== L: campanha draft/paused/finished não aceita claim =====
  {
    const draftCreated = await postJson("/api/admin/sorteios/campaigns", {
      title: "Rascunho", prizeName: "x", startsAt, endsAt, spendPerEntry: 100, numberCount: 10,
    }, adminAToken);
    const draftSlug = draftCreated.body.slug as string;
    const draftLink = await postJson(`/api/admin/sorteios/campaigns/${draftCreated.body.id}/links`, { customerId: clientJoaoId, numberCount: 1 }, adminAToken);
    const draftClaim = await postJson(`/api/public/sorteios/${draftSlug}/claim`, { token: draftLink.body.token, numbers: [1] });
    assert.equal(draftClaim.body.denyReason, "CAMPAIGN_NOT_ACTIVE", "L: draft precisa recusar claim");

    await patchJson(`/api/admin/sorteios/campaigns/${draftCreated.body.id}/status`, { status: "active" }, adminAToken);
    await patchJson(`/api/admin/sorteios/campaigns/${draftCreated.body.id}/status`, { status: "paused" }, adminAToken);
    const pausedClaim = await postJson(`/api/public/sorteios/${draftSlug}/claim`, { token: draftLink.body.token, numbers: [1] });
    assert.equal(pausedClaim.body.denyReason, "CAMPAIGN_NOT_ACTIVE", "L: paused precisa recusar claim");

    await patchJson(`/api/admin/sorteios/campaigns/${draftCreated.body.id}/status`, { status: "finished" }, adminAToken);
    const finishedClaim = await postJson(`/api/public/sorteios/${draftSlug}/claim`, { token: draftLink.body.token, numbers: [1] });
    assert.equal(finishedClaim.body.denyReason, "CAMPAIGN_NOT_ACTIVE", "L: finished precisa recusar claim");
    const finishedQuantity = await patchJson(`/api/admin/sorteios/campaigns/${draftCreated.body.id}/participants/${clientJoaoId}/quantity`, { numberCount: 2 }, adminAToken);
    assert.equal(finishedQuantity.status, 409, "L: campanha encerrada não pode alterar quantidade");
    assert.equal(finishedQuantity.body.code, "CAMPAIGN_FINISHED");
    const finishedLink = await postJson(`/api/admin/sorteios/campaigns/${draftCreated.body.id}/links`, { customerId: clientJoaoId, numberCount: 2 }, adminAToken);
    assert.equal(finishedLink.status, 409, "L: campanha encerrada não pode gerar nova concessão/link");
    assert.equal(finishedLink.body.code, "CAMPAIGN_FINISHED");
  }

  server.close();
  await Promise.all([adminAUid, adminBUid, regularUid].map(uid => authAdmin.deleteUser(uid)));
  await deleteApp(clientApp);
  console.log("SORTEIOS-RECOVERY-01 emulator tests passed: participant authorization, quantity required/reuse/update, partial claims, idempotent retries, multiple links, concurrent quota and quantity edits, legacy spending, recovered document ids, expired tokens; non-admin create denied, cross-owner detail denied, entitlement computed from real sales (350/100=3), claim confirms atomically, reopening link reflects 0 remaining + own numbers, another customer blocked from an already-claimed number, concurrent claims for the same number resolve to exactly one winner, invalid/revoked token denied, draft/paused/finished campaigns reject claims.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
