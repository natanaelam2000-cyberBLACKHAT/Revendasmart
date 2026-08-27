/**
 * PROMOTIONAL-CAMPAIGNS-01 §18/§19/§32/§33 — testes contra o emulador real (Auth + Firestore), mesmo
 * padrão de `script/owner-access-02-tests.ts`: sobe o app COMPLETO (`registerRoutes`) e chama as rotas
 * por HTTP real com tokens reais, para exercitar o `requireAuth`/`requireAdmin`/claim atômico de
 * produção — não uma reimplementação de teste.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import express from "express";
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { buildEligibleEntries, canonicalEligibleSetString } from "../shared/promotional-campaigns";

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
  // A venda precisa existir ANTES da geração do link: LINK-SELECTION-LIMIT-04 passou a exigir
  // entriesAvailable > 0 no momento de gerar o link (teste G do novo ticket).
  await db.doc(`users/${adminAUid}/sales/pc01-sale-maria`).set({ id: "pc01-sale-maria", clientId: clientMariaId, total: 500, totalPrice: 500, date: saleDate, products: [] });
  const linkMaria = await postJson(`/api/admin/sorteios/campaigns/${campaignId}/links`, { customerId: clientMariaId }, adminAToken);
  const tokenMaria = linkMaria.body.token as string;
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

    // clientMariaId (não clientJoaoId): João já esgotou seus 3 direitos no teste G — LINK-SELECTION-LIMIT-04
    // passou a exigir entriesAvailable > 0 para gerar um link, então precisamos de um cliente com saldo.
    const linkToRevoke = await postJson(`/api/admin/sorteios/campaigns/${campaignId}/links`, { customerId: clientMariaId }, adminAToken);
    assert.equal(linkToRevoke.status, 201, "K: geração do link a ser revogado deve suceder (cliente ainda tem saldo)");
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

  // ==================================================================================================
  // PROMOTIONAL-CAMPAIGNS-LINK-SELECTION-LIMIT-04 — admin escolhe quantos dos direitos JÁ EXISTENTES
  // um link específico libera; nunca cria direitos novos; servidor é autoridade sobre o teto real.
  // ==================================================================================================
  function hashTokenForTest(rawToken: string): string {
    return crypto.createHash("sha256").update(rawToken).digest("hex");
  }
  function entitlementEventsRefForTest(firestore: FirebaseFirestore.Firestore, campaignId: string, customerId: string) {
    return firestore.collection(`promotionalCampaigns/${campaignId}/participants/${customerId}/entitlementEvents`);
  }
  async function makeClientWithSales(name: string, saleTotal: number): Promise<string> {
    const id = `pc04-client-${name}-${suffix}`;
    await db.doc(`users/${adminAUid}/clients/${id}`).set({ id, name, phone: null });
    if (saleTotal > 0) {
      await db.doc(`users/${adminAUid}/sales/pc04-sale-${name}-${suffix}`).set({
        id: `pc04-sale-${name}-${suffix}`, clientId: id, total: saleTotal, totalPrice: saleTotal, date: saleDate, products: [],
      });
    }
    return id;
  }

  const limitCampaign = await postJson("/api/admin/sorteios/campaigns", {
    title: "Sorteio Selection Limit", prizeName: "Prêmio", startsAt, endsAt, spendPerEntry: 100, numberCount: 100,
  }, adminAToken);
  const limitCampaignId = limitCampaign.body.id as string;
  const limitSlug = limitCampaign.body.slug as string;
  await patchJson(`/api/admin/sorteios/campaigns/${limitCampaignId}/status`, { status: "active" }, adminAToken);

  // ===== M (ticket §12 test G): cliente sem available => link não pode ser criado =====
  {
    const semVendasId = await makeClientWithSales("sem-vendas", 0);
    const { status, body } = await postJson(`/api/admin/sorteios/campaigns/${limitCampaignId}/links`, { customerId: semVendasId }, adminAToken);
    assert.equal(status, 400, "M: cliente sem direitos disponíveis não pode ter link criado");
    assert.equal(body.code, "NO_ENTRIES_AVAILABLE");
  }

  // ===== N: endpoint de preview de entitlement (usado pela UI admin ANTES de gerar o link) =====
  {
    const carlaId = await makeClientWithSales("carla", 500);
    const { status, body } = await getJson(`/api/admin/sorteios/campaigns/${limitCampaignId}/clients/${carlaId}/entitlement`, adminAToken);
    assert.equal(status, 200, "N: preview de entitlement deve suceder");
    assert.equal(body.qualifyingSpend, 500);
    assert.equal(body.entriesEarned, 5);
    assert.equal(body.entriesAvailable, 5, "N: R$500/R$100 = 5 direitos, nenhum ainda usado");

    // ===== N2 (ticket §12 testes A/B): limit=3 de um available=5; uso parcial; reabertura =====
    const link1 = await postJson(`/api/admin/sorteios/campaigns/${limitCampaignId}/links`, { customerId: carlaId, selectionLimit: 3 }, adminAToken);
    assert.equal(link1.status, 201);
    assert.equal(link1.body.selectionLimit, 3);
    const tokenCarla1 = link1.body.token as string;

    {
      const view = await getJson(`/api/public/sorteios/${limitSlug}?t=${tokenCarla1}`);
      assert.equal(view.body.entriesAvailable, 3, "N2: teto do link (3) é menor que o saldo global (5) => 3");
    }

    const claim1 = await postJson(`/api/public/sorteios/${limitSlug}/claim`, { token: tokenCarla1, numbers: [1] });
    assert.equal(claim1.body.ok, true, "N2: primeira claim (1 número) deve confirmar");

    {
      // B: available global agora 4, token remaining agora 2 => min = 2
      const view = await getJson(`/api/public/sorteios/${limitSlug}?t=${tokenCarla1}`);
      assert.equal(view.body.entriesAvailable, 2, "N2/B: token remaining=2 após usar 1 dos 3 liberados neste link");
    }

    const claim2 = await postJson(`/api/public/sorteios/${limitSlug}/claim`, { token: tokenCarla1, numbers: [2, 3] });
    assert.equal(claim2.body.ok, true, "N2: segunda claim (2 números) deve confirmar, completando o teto do token");

    {
      // A: global remaining=2, token remaining=0 => min = 0
      const view = await getJson(`/api/public/sorteios/${limitSlug}?t=${tokenCarla1}`);
      assert.equal(view.body.entriesAvailable, 0, "N2/A: token esgotado (0), mesmo com saldo global ainda em 2");
    }

    const claim3 = await postJson(`/api/public/sorteios/${limitSlug}/claim`, { token: tokenCarla1, numbers: [4] });
    assert.equal(claim3.body.ok, false, "N2: quarto número pelo MESMO link precisa ser recusado — teto do token esgotado");
    assert.equal(claim3.body.denyReason, "EXCEEDS_AVAILABLE_ENTRIES");

    // Novo link sem selectionLimit explícito => default é o saldo ATUAL (2), nunca o original (5)
    const link2 = await postJson(`/api/admin/sorteios/campaigns/${limitCampaignId}/links`, { customerId: carlaId }, adminAToken);
    assert.equal(link2.body.selectionLimit, 2, "N2: default do novo link é o saldo global restante (2), não o original (5)");
    const view2 = await getJson(`/api/public/sorteios/${limitSlug}?t=${link2.body.token}`);
    assert.equal(view2.body.entriesAvailable, 2);
  }

  // ===== O (ticket §12 test H): dois links simultâneos nunca somam mais que o saldo real =====
  {
    const diegoId = await makeClientWithSales("diego", 500); // available = 5
    const linkA = await postJson(`/api/admin/sorteios/campaigns/${limitCampaignId}/links`, { customerId: diegoId, selectionLimit: 3 }, adminAToken);
    const linkB = await postJson(`/api/admin/sorteios/campaigns/${limitCampaignId}/links`, { customerId: diegoId, selectionLimit: 4 }, adminAToken);
    assert.equal(linkA.status, 201);
    assert.equal(linkB.status, 201, "O: os dois links PODEM existir — gerar link não reserva/consome nada");

    const claimA = await postJson(`/api/public/sorteios/${limitSlug}/claim`, { token: linkA.body.token, numbers: [10, 11, 12] });
    assert.equal(claimA.body.ok, true, "O: claim de 3 via link A (teto 3) deve confirmar");

    const claimBOver = await postJson(`/api/public/sorteios/${limitSlug}/claim`, { token: linkB.body.token, numbers: [13, 14, 15] });
    assert.equal(claimBOver.body.ok, false, "O: link B pede 3, mas só resta 2 de saldo GLOBAL real — precisa recusar mesmo com teto próprio de 4");
    assert.equal(claimBOver.body.denyReason, "EXCEEDS_AVAILABLE_ENTRIES");

    const claimB = await postJson(`/api/public/sorteios/${limitSlug}/claim`, { token: linkB.body.token, numbers: [13, 14] });
    assert.equal(claimB.body.ok, true, "O: claim de 2 via link B (o que realmente resta) deve confirmar");

    const participantSnap = await db.doc(`promotionalCampaigns/${limitCampaignId}/participants/${diegoId}`).get();
    assert.equal(participantSnap.data()?.entriesClaimed, 5, "O: total confirmado através dos dois links juntos nunca excede os 5 direitos reais");
  }

  // ===== P (ticket §12 test I): claims concorrentes nunca causam overspend de entitlement =====
  {
    const elisId = await makeClientWithSales("elis", 200); // available = 2
    const linkP1 = await postJson(`/api/admin/sorteios/campaigns/${limitCampaignId}/links`, { customerId: elisId }, adminAToken); // default limit = 2
    const linkP2 = await postJson(`/api/admin/sorteios/campaigns/${limitCampaignId}/links`, { customerId: elisId }, adminAToken); // default limit = 2

    const [raceA, raceB] = await Promise.all([
      postJson(`/api/public/sorteios/${limitSlug}/claim`, { token: linkP1.body.token, numbers: [20, 21] }),
      postJson(`/api/public/sorteios/${limitSlug}/claim`, { token: linkP2.body.token, numbers: [22, 23] }),
    ]);
    const oks = [raceA, raceB].filter((r) => r.body.ok === true);
    const denies = [raceA, raceB].filter((r) => r.body.ok === false);
    assert.equal(oks.length, 1, "P: só uma das duas claims concorrentes (2+2 pedidos, 2 disponíveis) pode confirmar por completo");
    assert.equal(denies.length, 1, "P: a outra precisa ser recusada por completo — nunca uma confirmação parcial que causaria overspend");
    assert.equal(denies[0].body.denyReason, "EXCEEDS_AVAILABLE_ENTRIES");

    const participantSnap = await db.doc(`promotionalCampaigns/${limitCampaignId}/participants/${elisId}`).get();
    assert.equal(participantSnap.data()?.entriesClaimed, 2, "P: exatamente 2 confirmados no total — nunca mais do que o saldo real, mesmo sob concorrência real");
  }

  // ===== Q (ticket §12 test J): revogar um link preserva os direitos NÃO utilizados por ele =====
  {
    const fabioId = await makeClientWithSales("fabio", 500); // available = 5
    const linkToRevoke = await postJson(`/api/admin/sorteios/campaigns/${limitCampaignId}/links`, { customerId: fabioId, selectionLimit: 3 }, adminAToken);
    const claimBeforeRevoke = await postJson(`/api/public/sorteios/${limitSlug}/claim`, { token: linkToRevoke.body.token, numbers: [30] });
    assert.equal(claimBeforeRevoke.body.ok, true);
    // global remaining = 4 (5 - 1); os 2 restantes do teto deste link (3 - 1) NUNCA foram consumidos.

    await postJson(`/api/admin/sorteios/campaigns/${limitCampaignId}/links/${linkToRevoke.body.tokenId}/revoke`, {}, adminAToken);
    const claimAfterRevoke = await postJson(`/api/public/sorteios/${limitSlug}/claim`, { token: linkToRevoke.body.token, numbers: [31] });
    assert.equal(claimAfterRevoke.body.ok, false, "Q: link revogado precisa continuar bloqueado");
    assert.equal(claimAfterRevoke.body.denyReason, "REVOKED_TOKEN");

    // Novo link reflete o saldo GLOBAL real (4) — nada do teto do link revogado ficou "preso".
    const newLink = await postJson(`/api/admin/sorteios/campaigns/${limitCampaignId}/links`, { customerId: fabioId }, adminAToken);
    assert.equal(newLink.body.selectionLimit, 4, "Q: revogar preserva o saldo NÃO utilizado — disponível para um novo link");
  }

  // ===== R (ticket §12 test K): link LEGADO (criado antes desta feature, sem selectionLimit) continua
  // funcionando exatamente como antes — capado só pelo saldo global. =====
  {
    const gustavoId = await makeClientWithSales("gustavo", 300); // available = 3
    const legacyRawToken = crypto.randomBytes(32).toString("base64url");
    await db.collection(`promotionalCampaigns/${limitCampaignId}/accessTokens`).add({
      customerId: gustavoId,
      tokenHash: hashTokenForTest(legacyRawToken),
      createdAt: new Date().toISOString(),
      expiresAt: null,
      revokedAt: null,
      // Deliberadamente SEM selectionLimit/claimedThroughToken — simula um token criado antes desta feature.
    });

    const view = await getJson(`/api/public/sorteios/${limitSlug}?t=${legacyRawToken}`);
    assert.equal(view.body.entriesAvailable, 3, "R: link legado sem selectionLimit é capado só pelo saldo global (3)");

    const claim = await postJson(`/api/public/sorteios/${limitSlug}/claim`, { token: legacyRawToken, numbers: [40, 41, 42] });
    assert.equal(claim.body.ok, true, "R: claim completa através de um link legado precisa continuar funcionando");
  }

  // ===== S (ticket §12 test L): tenant isolation — admin B não gera link numa campanha de admin A =====
  {
    const { status, body } = await postJson(`/api/admin/sorteios/campaigns/${limitCampaignId}/links`, { customerId: clientJoaoId }, adminBToken);
    assert.equal(status, 403, "S: admin B não pode gerar link numa campanha que não é dele");
    assert.equal(body.code, "FORBIDDEN");
  }

  // ==================================================================================================
  // PROMOTIONAL-CAMPAIGNS-MANUAL-INTERNAL-05 — concessão manual interna (venda externa/revista nunca
  // registrada), sem criar venda fictícia, auditável, server-authoritative.
  //
  // publicSorteioRateLimit (server/promotional-campaigns.ts) é 30 req/60s por IP, compartilhado entre
  // GET view e POST claim de TODOS os testes deste arquivo (todos batem do mesmo "IP" local). Os blocos
  // acima (G-S) já usam boa parte desse orçamento na mesma janela — não é seguro simplesmente confiar em
  // sobrar espaço. Aguardar a janela reabrir aqui é mais correto do que afrouxar o rate limit real só
  // para o teste passar (isso mascararia o comportamento de produção, não o testaria).
  // ==================================================================================================
  await new Promise((resolve) => setTimeout(resolve, 61_000));

  const manualCampaign = await postJson("/api/admin/sorteios/campaigns", {
    title: "Sorteio Manual Internal", prizeName: "Prêmio", startsAt, endsAt, spendPerEntry: 100, numberCount: 100,
  }, adminAToken);
  const manualCampaignId = manualCampaign.body.id as string;
  const manualSlug = manualCampaign.body.slug as string;
  assert.equal(manualCampaign.body.entitlementPolicy, "INTERNAL_ADMIN", "toda campanha nasce INTERNAL_ADMIN — único modo existente hoje");
  await patchJson(`/api/admin/sorteios/campaigns/${manualCampaignId}/status`, { status: "active" }, adminAToken);

  // ===== T (§15 test 1): usuário não-admin tentando manual grant => 403 =====
  {
    const helenaId = await makeClientWithSales("helena", 0);
    const { status } = await postJson(`/api/admin/sorteios/campaigns/${manualCampaignId}/clients/${helenaId}/manual-entries`, { quantity: 1, idempotencyKey: crypto.randomUUID() }, regularToken);
    assert.equal(status, 403, "T: não-admin concedendo manual precisa ser DENY");
  }

  // ===== U (§15 test 2): spoof de policy no corpo é ignorado — servidor só confia no campo salvo na campanha =====
  {
    const publicPolicyCampaignRef = db.collection("promotionalCampaigns").doc();
    await publicPolicyCampaignRef.set({
      id: publicPolicyCampaignRef.id, ownerId: adminAUid, slug: `future-public-${suffix}`, title: "Futuro Público",
      description: "", prizeName: "x", prizeImageUrl: null, status: "active", startsAt, endsAt, drawAt: null,
      spendPerEntry: 100, numberStart: 1, numberEnd: 100, allocationMode: "customer_choice",
      entitlementPolicy: "REGISTERED_SALES_ONLY", winningNumber: null, resultSource: null, finishedAt: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const irisId = await makeClientWithSales("iris", 0);
    const { status, body } = await postJson(
      `/api/admin/sorteios/campaigns/${publicPolicyCampaignRef.id}/clients/${irisId}/manual-entries`,
      { quantity: 5, policy: "INTERNAL_ADMIN", isInternal: true, idempotencyKey: crypto.randomUUID() },
      adminAToken,
    );
    assert.equal(status, 403, "U: REGISTERED_SALES_ONLY nega concessão manual mesmo com policy/isInternal forjados no corpo");
    assert.equal(body.code, "MANUAL_GRANT_NOT_ALLOWED");
  }

  // ===== V (§15 test 3): admin B tentando conceder numa campanha de admin A => 403 =====
  {
    const { status } = await postJson(`/api/admin/sorteios/campaigns/${manualCampaignId}/clients/${clientJoaoId}/manual-entries`, { quantity: 1, idempotencyKey: crypto.randomUUID() }, adminBToken);
    assert.equal(status, 403, "V: cross-owner na campanha precisa ser DENY");
  }

  // ===== W (§15 test 4): admin A tentando conceder para cliente de admin B => DENY (cliente não existe no tenant de A) =====
  {
    const clientOfBId = `pc05-client-of-b-${suffix}`;
    await db.doc(`users/${adminBUid}/clients/${clientOfBId}`).set({ id: clientOfBId, name: "Cliente de B", phone: null });
    const { status } = await postJson(`/api/admin/sorteios/campaigns/${manualCampaignId}/clients/${clientOfBId}/manual-entries`, { quantity: 1, idempotencyKey: crypto.randomUUID() }, adminAToken);
    assert.equal(status, 404, "W: cliente de outro tenant não é encontrado no escopo de admin A");
  }

  // ===== X (§15 tests 5/6/7): quantity negativo/zero/decimal => DENY =====
  {
    const julioId = await makeClientWithSales("julio", 0);
    for (const quantity of [-1, 0, 1.5]) {
      const { status, body } = await postJson(`/api/admin/sorteios/campaigns/${manualCampaignId}/clients/${julioId}/manual-entries`, { quantity, idempotencyKey: crypto.randomUUID() }, adminAToken);
      assert.equal(status, 400, `X: quantity=${quantity} precisa ser DENY`);
      assert.equal(body.code, "VALIDATION_ERROR");
    }
  }

  // ===== Y (§15 test 8): idempotência — reenviar a MESMA idempotencyKey nunca duplica a concessão =====
  {
    const karenId = await makeClientWithSales("karen", 0);
    const key = crypto.randomUUID();
    const first = await postJson(`/api/admin/sorteios/campaigns/${manualCampaignId}/clients/${karenId}/manual-entries`, { quantity: 3, reason: "courtesy", idempotencyKey: key }, adminAToken);
    assert.equal(first.status, 201);
    const firstEntitlement = first.body.entitlement as { manualInternalEntries: number };
    assert.equal(firstEntitlement.manualInternalEntries, 3);
    const replay = await postJson(`/api/admin/sorteios/campaigns/${manualCampaignId}/clients/${karenId}/manual-entries`, { quantity: 3, reason: "courtesy", idempotencyKey: key }, adminAToken);
    assert.equal(replay.status, 201, "Y: replay do mesmo idempotencyKey continua respondendo OK");
    const replayEntitlement = replay.body.entitlement as { manualInternalEntries: number };
    assert.equal(replayEntitlement.manualInternalEntries, 3, "Y: replay NÃO soma de novo — continua 3, nunca 6");
  }

  // ===== Z (§15 tests 9/10/11): concessão manual não altera qualifyingSpend, não cria venda, não mexe em estoque =====
  {
    const laraId = await makeClientWithSales("lara", 0);
    const salesBefore = (await db.collection(`users/${adminAUid}/sales`).where("clientId", "==", laraId).get()).size;
    const before = await getJson(`/api/admin/sorteios/campaigns/${manualCampaignId}/clients/${laraId}/entitlement`, adminAToken);
    await postJson(`/api/admin/sorteios/campaigns/${manualCampaignId}/clients/${laraId}/manual-entries`, { quantity: 4, reason: "external_magazine_sale", idempotencyKey: crypto.randomUUID() }, adminAToken);
    const after = await getJson(`/api/admin/sorteios/campaigns/${manualCampaignId}/clients/${laraId}/entitlement`, adminAToken);
    const salesAfter = (await db.collection(`users/${adminAUid}/sales`).where("clientId", "==", laraId).get()).size;
    assert.equal(after.body.qualifyingSpend, before.body.qualifyingSpend, "Z/9: qualifyingSpend não muda por causa de concessão manual");
    assert.equal(salesAfter, salesBefore, "Z/10: nenhuma venda foi criada");
    assert.equal((after.body as { manualInternalEntries: number }).manualInternalEntries, 4);
    // Z/11: não existe nenhum caminho de escrita a produtos/estoque nesta rota — nada a decrementar.
  }

  // ===== AA (§15 test 12 / ticket §10): globalRemaining=3 via manual; dois links (2+2) nunca consomem 4 =====
  {
    const marcoId = await makeClientWithSales("marco", 0);
    await postJson(`/api/admin/sorteios/campaigns/${manualCampaignId}/clients/${marcoId}/manual-entries`, { quantity: 3, reason: "courtesy", idempotencyKey: crypto.randomUUID() }, adminAToken);
    const linkAA1 = await postJson(`/api/admin/sorteios/campaigns/${manualCampaignId}/links`, { customerId: marcoId, selectionLimit: 2 }, adminAToken);
    const linkAA2 = await postJson(`/api/admin/sorteios/campaigns/${manualCampaignId}/links`, { customerId: marcoId, selectionLimit: 2 }, adminAToken);
    const [raceAA1, raceAA2] = await Promise.all([
      postJson(`/api/public/sorteios/${manualSlug}/claim`, { token: linkAA1.body.token, numbers: [50, 51] }),
      postJson(`/api/public/sorteios/${manualSlug}/claim`, { token: linkAA2.body.token, numbers: [52, 53] }),
    ]);
    const okCount = [raceAA1, raceAA2].filter((r) => r.body.ok === true).length;
    const participantSnap = await db.doc(`promotionalCampaigns/${manualCampaignId}/participants/${marcoId}`).get();
    const claimed = Number(participantSnap.data()?.entriesClaimed ?? 0);
    assert.ok(claimed <= 3, "AA: nunca consome mais que os 3 direitos reais (2 automáticos+manuais somados, mesmo com 2 links de 2)");
    assert.ok(okCount >= 1, "AA: pelo menos uma das claims confirma");
  }

  // ===== BB (§15 test 13): revoke preserva entitlement global (incluindo manual) não utilizado =====
  {
    const nadiaId = await makeClientWithSales("nadia", 0);
    await postJson(`/api/admin/sorteios/campaigns/${manualCampaignId}/clients/${nadiaId}/manual-entries`, { quantity: 3, reason: "courtesy", idempotencyKey: crypto.randomUUID() }, adminAToken);
    const linkToRevokeBB = await postJson(`/api/admin/sorteios/campaigns/${manualCampaignId}/links`, { customerId: nadiaId, selectionLimit: 2 }, adminAToken);
    await postJson(`/api/public/sorteios/${manualSlug}/claim`, { token: linkToRevokeBB.body.token, numbers: [60] });
    await postJson(`/api/admin/sorteios/campaigns/${manualCampaignId}/links/${linkToRevokeBB.body.tokenId}/revoke`, {}, adminAToken);
    const newLinkBB = await postJson(`/api/admin/sorteios/campaigns/${manualCampaignId}/links`, { customerId: nadiaId }, adminAToken);
    assert.equal(newLinkBB.body.selectionLimit, 2, "BB: saldo global (3 manuais - 1 usado = 2) preservado após revoke, incluindo a parte manual");
  }

  // ===== CC (§15 test 14): ajuste NUNCA apaga o histórico anterior — ledger imutável e somável =====
  {
    const oscarId = await makeClientWithSales("oscar", 0);
    // A rota real de concessão também faz este upsert (ver server/promotional-campaigns.ts) — replicado
    // aqui porque este teste escreve os eventos DIRETO no Firestore (não existe endpoint de ajuste ainda).
    await db.doc(`promotionalCampaigns/${manualCampaignId}/participants/${oscarId}`).set({ customerId: oscarId, updatedAt: new Date().toISOString() }, { merge: true });
    const grantRef = entitlementEventsRefForTest(db, manualCampaignId, oscarId).doc();
    await grantRef.set({ customerId: oscarId, type: "MANUAL_INTERNAL_GRANT", amount: 3, reason: "external_magazine_sale", note: null, createdAt: new Date().toISOString(), createdBy: adminAUid });
    const adjustmentRef = entitlementEventsRefForTest(db, manualCampaignId, oscarId).doc();
    await adjustmentRef.set({ customerId: oscarId, type: "MANUAL_INTERNAL_ADJUSTMENT", amount: -1, reason: "manual_adjustment", note: "quantidade errada", createdAt: new Date().toISOString(), createdBy: adminAUid });
    const grantStillThere = await grantRef.get();
    assert.equal(grantStillThere.exists, true, "CC: evento original de concessão continua existindo — o ajuste não apagou nada");
    assert.equal(grantStillThere.data()?.amount, 3, "CC: valor original do evento preservado");
    const detail = await getJson(`/api/admin/sorteios/campaigns/${manualCampaignId}`, adminAToken);
    const oscarRow = (detail.body.participants as { customerId: string; manualInternalEntries: number; manualEvents: unknown[] }[])
      .find((p) => p.customerId === oscarId);
    assert.ok(oscarRow, "CC: participante aparece na listagem mesmo sem ter feito claim ainda");
    assert.equal(oscarRow!.manualInternalEntries, 2, "CC: soma líquida = 3 - 1 = 2");
    assert.equal(oscarRow!.manualEvents.length, 2, "CC: os DOIS eventos continuam visíveis no histórico, nenhum foi apagado");
  }

  // ===== DD (ticket §18 — fixture obrigatória ponta a ponta) =====
  {
    const moisesId = await makeClientWithSales("moises", 200); // qualifyingSpend = R$200, spendPerEntry = 100 => automatic = 2
    const salesBeforeMoises = (await db.collection(`users/${adminAUid}/sales`).where("clientId", "==", moisesId).get()).size;

    const entitlementBefore = await getJson(`/api/admin/sorteios/campaigns/${manualCampaignId}/clients/${moisesId}/entitlement`, adminAToken);
    assert.equal(entitlementBefore.body.automaticEntries, 2, "DD: R$200/R$100 = 2 automáticos");
    assert.equal(entitlementBefore.body.entriesAvailable, 2);

    // Admin quer liberar 5 => diferença de 3 precisa virar concessão manual antes do link nascer.
    const desired = 5;
    const manualNeeded = desired - (entitlementBefore.body.entriesAvailable as number);
    assert.equal(manualNeeded, 3);
    const grantDD = await postJson(`/api/admin/sorteios/campaigns/${manualCampaignId}/clients/${moisesId}/manual-entries`, { quantity: manualNeeded, reason: "external_magazine_sale", note: "venda por revista", idempotencyKey: crypto.randomUUID() }, adminAToken);
    assert.equal(grantDD.status, 201);

    const linkDD = await postJson(`/api/admin/sorteios/campaigns/${manualCampaignId}/links`, { customerId: moisesId, selectionLimit: desired }, adminAToken);
    assert.equal(linkDD.status, 201);
    assert.equal(linkDD.body.selectionLimit, 5, "DD: link libera exatamente os 5 pedidos (2 automáticos + 3 manuais)");

    const claimDD = await postJson(`/api/public/sorteios/${manualSlug}/claim`, { token: linkDD.body.token, numbers: [7, 18, 39, 62, 91] });
    assert.equal(claimDD.body.ok, true, "DD: claim dos 5 números confirma");

    const finalEntitlement = await getJson(`/api/admin/sorteios/campaigns/${manualCampaignId}/clients/${moisesId}/entitlement`, adminAToken);
    assert.equal(finalEntitlement.body.automaticEntries, 2, "DD esperado: automatic = 2");
    assert.equal(finalEntitlement.body.manualInternalEntries, 3, "DD esperado: manual = 3");
    assert.equal(finalEntitlement.body.entriesAlreadyClaimed, 5, "DD esperado: claimed = 5");
    assert.equal(finalEntitlement.body.entriesAvailable, 0, "DD esperado: remaining = 0");
    assert.equal(finalEntitlement.body.qualifyingSpend, 200, "DD esperado: qualifyingSpend = R$200, nunca alterado");

    const salesAfterMoises = (await db.collection(`users/${adminAUid}/sales`).where("clientId", "==", moisesId).get()).size;
    assert.equal(salesAfterMoises, salesBeforeMoises, "DD: nenhuma venda adicional foi criada pela concessão manual");
  }

  // ==================================================================================================
  // PROMOTIONAL-CAMPAIGNS-SECURE-DRAW-06 — motor de apuração: close-entries / draw / result.
  // Reseta a janela do rate limiter público (30 req/60s por IP, compartilhada por todos os testes deste
  // arquivo) antes deste bloco, mesmo padrão já usado antes do bloco MANUAL-INTERNAL-05.
  // ==================================================================================================
  await new Promise((resolve) => setTimeout(resolve, 61_000));

  async function createCampaign(title: string, numberCount = 100): Promise<{ id: string; slug: string }> {
    const created = await postJson("/api/admin/sorteios/campaigns", {
      title, prizeName: "Prêmio Secure Draw", startsAt, endsAt, spendPerEntry: 100, numberCount,
    }, adminAToken);
    assert.equal(created.status, 201);
    return { id: created.body.id as string, slug: created.body.slug as string };
  }

  // ===== EE/FF: non-admin close/draw -> 403 =====
  {
    const { id: campaignId } = await createCampaign("Sorteio Secure Draw EE");
    await patchJson(`/api/admin/sorteios/campaigns/${campaignId}/status`, { status: "active" }, adminAToken);
    const closeDenied = await postJson(`/api/admin/sorteios/campaigns/${campaignId}/close-entries`, {}, regularToken);
    assert.equal(closeDenied.status, 403, "EE: non-admin close-entries precisa ser DENY");
    const drawDenied = await postJson(`/api/admin/sorteios/campaigns/${campaignId}/draw`, {}, regularToken);
    assert.equal(drawDenied.status, 403, "FF: non-admin draw precisa ser DENY");
  }

  // ===== GG/HH/II: cross-tenant close/draw/result -> DENY =====
  {
    const { id: campaignId } = await createCampaign("Sorteio Secure Draw GG");
    await patchJson(`/api/admin/sorteios/campaigns/${campaignId}/status`, { status: "active" }, adminAToken);
    const closeDenied = await postJson(`/api/admin/sorteios/campaigns/${campaignId}/close-entries`, {}, adminBToken);
    assert.equal(closeDenied.status, 403, "GG: cross-tenant close-entries precisa ser DENY");
    const drawDenied = await postJson(`/api/admin/sorteios/campaigns/${campaignId}/draw`, {}, adminBToken);
    assert.equal(drawDenied.status, 403, "HH: cross-tenant draw precisa ser DENY");
    const resultDenied = await getJson(`/api/admin/sorteios/campaigns/${campaignId}/result`, adminBToken);
    assert.equal(resultDenied.status, 403, "II: cross-tenant result precisa ser DENY");
  }

  // ===== JJ: draw antes de close -> CAMPAIGN_NOT_CLOSED, status não muda =====
  {
    const { id: campaignId } = await createCampaign("Sorteio Secure Draw JJ");
    await patchJson(`/api/admin/sorteios/campaigns/${campaignId}/status`, { status: "active" }, adminAToken);
    const drawTooEarly = await postJson(`/api/admin/sorteios/campaigns/${campaignId}/draw`, {}, adminAToken);
    assert.equal(drawTooEarly.status, 400, "JJ: sortear antes de encerrar precisa ser rejeitado");
    assert.equal(drawTooEarly.body.code, "CAMPAIGN_NOT_CLOSED");
    const snap = await db.doc(`promotionalCampaigns/${campaignId}`).get();
    assert.equal(snap.data()?.status, "active", "JJ: campanha continua active — draw rejeitado não muda o status");
  }

  // ===== KK: close a partir de draft -> CAMPAIGN_NOT_CLOSABLE =====
  {
    const { id: campaignId } = await createCampaign("Sorteio Secure Draw KK");
    const closeFromDraft = await postJson(`/api/admin/sorteios/campaigns/${campaignId}/close-entries`, {}, adminAToken);
    assert.equal(closeFromDraft.status, 400, "KK: encerrar uma campanha draft precisa ser rejeitado");
    assert.equal(closeFromDraft.body.code, "CAMPAIGN_NOT_CLOSABLE");
  }

  // ===== LL (§24.7): zero candidatos elegíveis bloqueia o sorteio; status NÃO vira drawn =====
  {
    const { id: campaignId } = await createCampaign("Sorteio Secure Draw LL");
    await patchJson(`/api/admin/sorteios/campaigns/${campaignId}/status`, { status: "active" }, adminAToken);
    const close = await postJson(`/api/admin/sorteios/campaigns/${campaignId}/close-entries`, {}, adminAToken);
    assert.equal(close.status, 200);
    assert.equal(close.body.status, "entries_closed");
    const drawEmpty = await postJson(`/api/admin/sorteios/campaigns/${campaignId}/draw`, {}, adminAToken);
    assert.equal(drawEmpty.status, 400, "LL: sortear sem nenhum número claimed precisa ser rejeitado");
    assert.equal(drawEmpty.body.code, "NO_ELIGIBLE_ENTRIES");
    const snap = await db.doc(`promotionalCampaigns/${campaignId}`).get();
    assert.equal(snap.data()?.status, "entries_closed", "LL: campanha permanece entries_closed, nunca vira drawn sem candidatos");
  }

  // ===== UU: PATCH genérico de status nunca aceita entries_closed/drawn, e trava depois de encerrado =====
  {
    const { id: campaignId } = await createCampaign("Sorteio Secure Draw UU");
    await patchJson(`/api/admin/sorteios/campaigns/${campaignId}/status`, { status: "active" }, adminAToken);
    const patchToClosed = await patchJson(`/api/admin/sorteios/campaigns/${campaignId}/status`, { status: "entries_closed" }, adminAToken);
    assert.equal(patchToClosed.status, 400, "UU: PATCH não pode fingir entries_closed sem passar pelo motor de apuração");
    const patchToDrawn = await patchJson(`/api/admin/sorteios/campaigns/${campaignId}/status`, { status: "drawn" }, adminAToken);
    assert.equal(patchToDrawn.status, 400, "UU: PATCH não pode fingir drawn sem passar pelo motor de apuração");
    await postJson(`/api/admin/sorteios/campaigns/${campaignId}/close-entries`, {}, adminAToken);
    const patchAfterClose = await patchJson(`/api/admin/sorteios/campaigns/${campaignId}/status`, { status: "paused" }, adminAToken);
    assert.equal(patchAfterClose.status, 400, "UU: depois de entries_closed, o PATCH genérico fica travado — sem reabrir simples");
    assert.equal(patchAfterClose.body.code, "CAMPAIGN_LOCKED_BY_DRAW");
  }

  // ===== MM/NN/OO/PP/QQ/SS/TT (§24.3/4/5/8/9/10/11/12/13/14/17): fluxo completo com 5 números claimed,
  // origem mista (venda registrada + concessão manual interna), depois close -> claim negado -> draw ->
  // segunda chamada idempotente -> concorrência -> snapshot imutável mesmo após editar nome/prêmio. =====
  {
    const { id: campaignId, slug } = await createCampaign("Sorteio Secure Draw Completo", 100);
    await patchJson(`/api/admin/sorteios/campaigns/${campaignId}/status`, { status: "active" }, adminAToken);

    // registered_sale: rafael (R$300 => 3 automáticos)
    const rafaelId = await makeClientWithSales("rafael", 300);
    const linkRafael = await postJson(`/api/admin/sorteios/campaigns/${campaignId}/links`, { customerId: rafaelId }, adminAToken);
    const claimRafael = await postJson(`/api/public/sorteios/${slug}/claim`, { token: linkRafael.body.token, numbers: [10, 25, 40] });
    assert.equal(claimRafael.body.ok, true);

    // manual_internal: teodora (0 vendas, 2 concedidos manualmente)
    const teodoraId = await makeClientWithSales("teodora", 0);
    await postJson(`/api/admin/sorteios/campaigns/${campaignId}/clients/${teodoraId}/manual-entries`, { quantity: 2, reason: "courtesy", idempotencyKey: crypto.randomUUID() }, adminAToken);
    const linkTeodora = await postJson(`/api/admin/sorteios/campaigns/${campaignId}/links`, { customerId: teodoraId, selectionLimit: 2 }, adminAToken);
    const claimTeodora = await postJson(`/api/public/sorteios/${slug}/claim`, { token: linkTeodora.body.token, numbers: [55, 70] });
    assert.equal(claimTeodora.body.ok, true, "SS: número claimed por manual_internal precisa confirmar normalmente");

    // §24.3: número 80 NUNCA é escolhido — precisa continuar unclaimed, fora do conjunto elegível.
    const eligibleClaimedNumbers = [10, 25, 40, 55, 70];

    // ===== NN: encerrar participações =====
    const close = await postJson(`/api/admin/sorteios/campaigns/${campaignId}/close-entries`, {}, adminAToken);
    assert.equal(close.status, 200);
    assert.equal(close.body.status, "entries_closed");
    assert.ok(close.body.entriesClosedAt, "NN: entriesClosedAt precisa ser persistido");

    // ===== MM (§17 do ticket original + §24.17 aqui): claim depois de encerrado é negado =====
    const claimAfterClose = await postJson(`/api/public/sorteios/${slug}/claim`, { token: linkRafael.body.token, numbers: [80] });
    assert.equal(claimAfterClose.body.ok, false, "MM: claim depois de close-entries precisa ser negado");
    assert.equal(claimAfterClose.body.denyReason, "CAMPAIGN_NOT_ACTIVE");
    const numberEightySnap = await db.doc(`promotionalCampaigns/${campaignId}/numbers/80`).get();
    assert.equal(numberEightySnap.exists, false, "§24.3: 80 nunca foi claimed, continua fora do Firestore/fora do conjunto elegível");

    // §16 do ticket original: claim CONCORRENTE após fechamento também precisa ser rejeitado — não só uma
    // chamada isolada. Duas claims disparadas em paralelo de verdade contra números nunca usados (81/82).
    {
      const [concurrentA, concurrentB] = await Promise.all([
        postJson(`/api/public/sorteios/${slug}/claim`, { token: linkRafael.body.token, numbers: [81] }),
        postJson(`/api/public/sorteios/${slug}/claim`, { token: linkTeodora.body.token, numbers: [82] }),
      ]);
      assert.equal(concurrentA.body.ok, false, "§16: claim concorrente após close-entries precisa ser negada (A)");
      assert.equal(concurrentA.body.denyReason, "CAMPAIGN_NOT_ACTIVE");
      assert.equal(concurrentB.body.ok, false, "§16: claim concorrente após close-entries precisa ser negada (B)");
      assert.equal(concurrentB.body.denyReason, "CAMPAIGN_NOT_ACTIVE");
    }

    // ===== RR (§15/§21 — §24.18): corpo com winningNumber forjado é totalmente ignorado =====
    const drawResponse = await postJson(`/api/admin/sorteios/campaigns/${campaignId}/draw`, { winningNumber: 999999, winningClientId: "hacker" }, adminAToken);
    assert.equal(drawResponse.status, 201, "OO: primeira apuração deve suceder");
    const draw = drawResponse.body.draw as Record<string, unknown>;
    assert.equal(drawResponse.body.alreadyDrawn, false);

    // ===== OO: resultado persistido, usa só o conjunto elegível, hash correto =====
    assert.equal(draw.eligibleNumberCount, 5, "OO/§24.2: exatamente os 5 números claimed, nada mais");
    assert.equal(draw.participantCount, 2, "OO/§24: rafael + teodora = 2 participantes distintos (rafael tem 3 chances, teodora 2)");
    assert.ok(eligibleClaimedNumbers.includes(draw.winningNumber as number), "OO/§24.8: o vencedor precisa vir do conjunto elegível — 80 nunca poderia ganhar mesmo forjado no corpo");
    assert.notEqual(draw.winningNumber, 999999, "RR/§24.18: winningNumber forjado no corpo nunca é usado");
    assert.equal(draw.algorithm, "crypto.randomInt");
    assert.notEqual(draw.winningClientId, "hacker", "RR: winningClientId forjado no corpo nunca é usado");

    // §24.14 end-to-end: recomputar o hash localmente a partir do MESMO conjunto elegível (via query direta
    // ao Firestore) precisa bater com o hash persistido pelo servidor — prova que o algoritmo real do
    // servidor (não só a função pura isolada) é determinístico.
    const claimedSnap = await db.collection(`promotionalCampaigns/${campaignId}/numbers`).where("status", "==", "claimed").get();
    const recomputedEligible = buildEligibleEntries(claimedSnap.docs.map((doc) => ({ number: Number(doc.id), customerId: doc.data().customerId as string })));
    const recomputedHash = crypto.createHash("sha256").update(canonicalEligibleSetString(recomputedEligible)).digest("hex");
    assert.equal(draw.eligibleSetHash, recomputedHash, "§24.14: eligibleSetHash persistido precisa bater com o recomputado a partir do MESMO conjunto elegível");

    const campaignAfterDraw = await db.doc(`promotionalCampaigns/${campaignId}`).get();
    assert.equal(campaignAfterDraw.data()?.status, "drawn", "OO: campanha vira drawn após a apuração");
    assert.equal(campaignAfterDraw.data()?.winningNumber, draw.winningNumber);

    // ===== PP (§24.10): segunda chamada de draw NÃO gera novo vencedor — devolve o mesmo resultado =====
    const secondDraw = await postJson(`/api/admin/sorteios/campaigns/${campaignId}/draw`, {}, adminAToken);
    assert.equal(secondDraw.status, 200, "PP: segunda chamada não cria (201), só devolve (200)");
    assert.equal(secondDraw.body.alreadyDrawn, true);
    assert.equal((secondDraw.body.draw as Record<string, unknown>).drawId, draw.drawId, "PP: mesmo drawId, nunca um segundo sorteio oficial");
    assert.equal((secondDraw.body.draw as Record<string, unknown>).winningNumber, draw.winningNumber, "PP: mesmo vencedor sempre");

    // ===== QQ (§24.11): duas requisições de draw concorrentes contra uma NOVA campanha — só 1 resultado
    // oficial nasce, nunca dois drawIds diferentes. =====
    {
      const { id: raceCampaignId, slug: raceSlug } = await createCampaign("Sorteio Secure Draw QQ");
      await patchJson(`/api/admin/sorteios/campaigns/${raceCampaignId}/status`, { status: "active" }, adminAToken);
      const ursulaId = await makeClientWithSales("ursula", 500);
      const linkUrsula = await postJson(`/api/admin/sorteios/campaigns/${raceCampaignId}/links`, { customerId: ursulaId }, adminAToken);
      await postJson(`/api/public/sorteios/${raceSlug}/claim`, { token: linkUrsula.body.token, numbers: [3, 4] });
      await postJson(`/api/admin/sorteios/campaigns/${raceCampaignId}/close-entries`, {}, adminAToken);
      const [raceA, raceB] = await Promise.all([
        postJson(`/api/admin/sorteios/campaigns/${raceCampaignId}/draw`, {}, adminAToken),
        postJson(`/api/admin/sorteios/campaigns/${raceCampaignId}/draw`, {}, adminAToken),
      ]);
      const drawIdA = (raceA.body.draw as Record<string, unknown>).drawId;
      const drawIdB = (raceB.body.draw as Record<string, unknown>).drawId;
      assert.equal(drawIdA, drawIdB, "QQ: duas requisições concorrentes de draw resultam em exatamente 1 drawId oficial");
      const officialSnap = await db.collection(`promotionalCampaigns/${raceCampaignId}/draws`).get();
      assert.equal(officialSnap.size, 1, "QQ: apenas 1 documento de apuração oficial persistido, nunca 2");
    }

    // ===== TT (§24.12/§24.13): editar nome do cliente e o prêmio DEPOIS do sorteio não altera o snapshot
    // histórico já persistido. =====
    await db.doc(`users/${adminAUid}/clients/${draw.winningClientId}`).update({ name: "Nome Alterado Depois Do Sorteio" });
    await db.doc(`promotionalCampaigns/${campaignId}`).update({ prizeName: "Prêmio Trocado Depois Do Sorteio" });
    const resultAfterEdits = await getJson(`/api/admin/sorteios/campaigns/${campaignId}/result`, adminAToken);
    assert.equal(resultAfterEdits.status, 200);
    const persistedDraw = resultAfterEdits.body.draw as Record<string, unknown>;
    assert.equal(persistedDraw.winnerDisplayNameSnapshot, draw.winnerDisplayNameSnapshot, "TT/§24.12: nome do vencedor no resultado histórico não muda mesmo com o cliente renomeado depois");
    assert.notEqual(persistedDraw.winnerDisplayNameSnapshot, "Nome Alterado Depois Do Sorteio");
    assert.equal(persistedDraw.prizeNameSnapshot, draw.prizeNameSnapshot, "TT/§24.13: prêmio do resultado histórico não muda mesmo com a campanha editada depois");
    assert.notEqual(persistedDraw.prizeNameSnapshot, "Prêmio Trocado Depois Do Sorteio");
  }

  // ==================================================================================================
  // PROMOTIONAL-CAMPAIGNS-PARTICIPANT-SYNC-06A — cliente com entitlement automático (registered_sale) que
  // gera link válido precisa aparecer em PARTICIPANTES imediatamente, não só depois do primeiro claim.
  // ==================================================================================================
  {
    const psCampaign = await postJson("/api/admin/sorteios/campaigns", {
      title: "Sorteio Participant Sync", prizeName: "Prêmio", startsAt, endsAt, spendPerEntry: 100, numberCount: 100,
    }, adminAToken);
    const psCampaignId = psCampaign.body.id as string;
    const psSlug = psCampaign.body.slug as string;
    await patchJson(`/api/admin/sorteios/campaigns/${psCampaignId}/status`, { status: "active" }, adminAToken);

    // ===== teste 1 (§14.1): registered_sale entitlement + generate link => participant aparece =====
    // pedro: qualifyingSpend=200 => automatic=2, manual=0 — nunca passou pela rota manual-entries.
    const pedroId = await makeClientWithSales("pedro", 200);
    const linkPedro = await postJson(`/api/admin/sorteios/campaigns/${psCampaignId}/links`, { customerId: pedroId, selectionLimit: 1 }, adminAToken);
    assert.equal(linkPedro.status, 201);
    const detailAfterPedroLink = await getJson(`/api/admin/sorteios/campaigns/${psCampaignId}`, adminAToken);
    const pedroParticipant = (detailAfterPedroLink.body.participants as Array<Record<string, unknown>>).find((p) => p.customerId === pedroId);
    assert.ok(pedroParticipant, "1: cliente registered_sale que gerou link precisa aparecer em PARTICIPANTES sem nenhum claim ainda");
    assert.equal(pedroParticipant!.entriesClaimed, 0, "1: 0 escolhidos antes de qualquer claim");
    assert.equal(pedroParticipant!.entriesAvailable, 2, "1: 2 restantes (automaticEntries=2, selectionLimit não afeta o saldo global)");
    const pedroDocDirect = await db.doc(`promotionalCampaigns/${psCampaignId}/participants/${pedroId}`).get();
    assert.equal(pedroDocDirect.exists, true, "1: participant realmente materializado no Firestore, não só computado na resposta");

    // ===== teste 2 (§14.2): manual_internal + generate link => participant aparece (comportamento já
    // existente, preservado) =====
    const rebecaId = await makeClientWithSales("rebeca", 0);
    await postJson(`/api/admin/sorteios/campaigns/${psCampaignId}/clients/${rebecaId}/manual-entries`, { quantity: 2, reason: "courtesy", idempotencyKey: crypto.randomUUID() }, adminAToken);
    const linkRebeca = await postJson(`/api/admin/sorteios/campaigns/${psCampaignId}/links`, { customerId: rebecaId, selectionLimit: 1 }, adminAToken);
    assert.equal(linkRebeca.status, 201);
    const detailAfterRebeca = await getJson(`/api/admin/sorteios/campaigns/${psCampaignId}`, adminAToken);
    assert.ok((detailAfterRebeca.body.participants as Array<Record<string, unknown>>).some((p) => p.customerId === rebecaId), "2: manual_internal continua aparecendo em PARTICIPANTES");

    // ===== teste 3 (§14.3): auto + manual => único participant lógico =====
    // saulo: qualifyingSpend=100 => automatic=1, + 2 manuais concedidos depois. Precisa existir só 1 doc.
    const sauloId = await makeClientWithSales("saulo", 100);
    const linkSauloAuto = await postJson(`/api/admin/sorteios/campaigns/${psCampaignId}/links`, { customerId: sauloId, selectionLimit: 1 }, adminAToken);
    assert.equal(linkSauloAuto.status, 201);
    await postJson(`/api/admin/sorteios/campaigns/${psCampaignId}/clients/${sauloId}/manual-entries`, { quantity: 2, reason: "courtesy", idempotencyKey: crypto.randomUUID() }, adminAToken);
    const sauloParticipantDocs = await db.collection(`promotionalCampaigns/${psCampaignId}/participants`).where("customerId", "==", sauloId).get();
    assert.equal(sauloParticipantDocs.size, 1, "3: automatic+manual do mesmo cliente nunca cria dois participantes — sempre 1");
    const detailAfterSaulo = await getJson(`/api/admin/sorteios/campaigns/${psCampaignId}`, adminAToken);
    const sauloParticipant = (detailAfterSaulo.body.participants as Array<Record<string, unknown>>).find((p) => p.customerId === sauloId);
    assert.equal(sauloParticipant!.automaticEntries, 1, "3: automatic=1 preservado");
    assert.equal(sauloParticipant!.manualInternalEntries, 2, "3: manual=2 agregado no MESMO participante lógico");

    // ===== teste 4 (§14.4): dois links para o mesmo cliente => participantCount continua 1 =====
    const linkPedro2 = await postJson(`/api/admin/sorteios/campaigns/${psCampaignId}/links`, { customerId: pedroId, selectionLimit: 1 }, adminAToken);
    assert.equal(linkPedro2.status, 201, "4: segundo link para o mesmo cliente deve suceder normalmente");
    const pedroParticipantDocsAfterSecondLink = await db.collection(`promotionalCampaigns/${psCampaignId}/participants`).where("customerId", "==", pedroId).get();
    assert.equal(pedroParticipantDocsAfterSecondLink.size, 1, "4: dois links do mesmo cliente nunca duplicam o participant");
    const metricsAfterSecondLink = await getJson(`/api/admin/sorteios/campaigns/${psCampaignId}`, adminAToken);
    const tokensSnapForPsCampaign = await db.collection(`promotionalCampaigns/${psCampaignId}/accessTokens`).get();
    assert.ok(tokensSnapForPsCampaign.size >= 3, "4 setup: pelo menos 3 tokens já existem (pedro x2, rebeca, saulo)");
    const realParticipantDocsSnap = await db.collection(`promotionalCampaigns/${psCampaignId}/participants`).get();
    assert.equal((metricsAfterSecondLink.body.metrics as Record<string, unknown>).participantsCount, realParticipantDocsSnap.size, "9: PARTICIPANTES conta documentos de participante únicos no Firestore, nunca tokens/links (que já somam 3+ aqui, mas participantsCount é bem menor)");
    assert.ok(realParticipantDocsSnap.size < tokensSnapForPsCampaign.size, "9: participantsCount precisa ser estritamente menor que o total de tokens (pedro sozinho já tem 2 links => 1 participante)");

    // ===== teste 5 (§14.5): claim posterior atualiza chosen/remaining no MESMO participant =====
    const claimPedro = await postJson(`/api/public/sorteios/${psSlug}/claim`, { token: linkPedro.body.token, numbers: [15] });
    assert.equal(claimPedro.body.ok, true);
    const detailAfterClaim = await getJson(`/api/admin/sorteios/campaigns/${psCampaignId}`, adminAToken);
    const pedroAfterClaim = (detailAfterClaim.body.participants as Array<Record<string, unknown>>).find((p) => p.customerId === pedroId);
    assert.equal(pedroAfterClaim!.entriesClaimed, 1, "5: 1 escolhido depois do claim");
    assert.equal(pedroAfterClaim!.entriesAvailable, 1, "5: 1 restante (2 automáticos - 1 claimed)");
    const pedroParticipantDocsAfterClaim = await db.collection(`promotionalCampaigns/${psCampaignId}/participants`).where("customerId", "==", pedroId).get();
    assert.equal(pedroParticipantDocsAfterClaim.size, 1, "5: claim nunca cria um segundo participant — atualiza o mesmo doc");

    // ===== teste 6 (§14.6): revoke preserva o participant =====
    await postJson(`/api/admin/sorteios/campaigns/${psCampaignId}/links/${linkRebeca.body.tokenId}/revoke`, {}, adminAToken);
    const detailAfterRevoke = await getJson(`/api/admin/sorteios/campaigns/${psCampaignId}`, adminAToken);
    assert.ok((detailAfterRevoke.body.participants as Array<Record<string, unknown>>).some((p) => p.customerId === rebecaId), "6: revogar o link não remove o participante da lista");

    // ===== teste 7 (§14.7): tenant A não materializa participant de tenant B =====
    {
      const bCampaign = await postJson("/api/admin/sorteios/campaigns", {
        title: "Sorteio Tenant B Sync", prizeName: "Prêmio", startsAt, endsAt, spendPerEntry: 100, numberCount: 100,
      }, adminBToken);
      const bCampaignId = bCampaign.body.id as string;
      await patchJson(`/api/admin/sorteios/campaigns/${bCampaignId}/status`, { status: "active" }, adminBToken);
      const crossTenantLink = await postJson(`/api/admin/sorteios/campaigns/${bCampaignId}/links`, { customerId: pedroId }, adminAToken);
      assert.equal(crossTenantLink.status, 403, "7: admin A não consegue gerar link numa campanha de admin B — bloqueado antes de qualquer lookup de cliente/participant");
      const bParticipants = await db.collection(`promotionalCampaigns/${bCampaignId}/participants`).get();
      assert.equal(bParticipants.size, 0, "7: nenhum participant vazou para a campanha do tenant B");
    }

    // ===== teste 8 (§14.8): falha de geração de link não deixa participant fantasma =====
    // Cliente inexistente => a rota falha ANTES do batch (CLIENT_NOT_FOUND) — nenhum participant deve
    // ser criado para um customerId que nunca existiu de verdade.
    {
      const fakeCustomerId = `pc06a-nao-existe-${suffix}`;
      const failedLink = await postJson(`/api/admin/sorteios/campaigns/${psCampaignId}/links`, { customerId: fakeCustomerId }, adminAToken);
      assert.equal(failedLink.status, 404);
      assert.equal(failedLink.body.code, "CLIENT_NOT_FOUND");
      const ghostParticipant = await db.doc(`promotionalCampaigns/${psCampaignId}/participants/${fakeCustomerId}`).get();
      assert.equal(ghostParticipant.exists, false, "8: geração de link que falha nunca deixa participant fantasma para trás");
    }

    // ===== testes 9/10 (§14.9/§14.10): qualifyingSpend/vendas/estoque não mudam por causa desta correção =====
    const pedroSalesBefore = (await db.collection(`users/${adminAUid}/sales`).where("clientId", "==", pedroId).get()).size;
    const pedroEntitlementFinal = await getJson(`/api/admin/sorteios/campaigns/${psCampaignId}/clients/${pedroId}/entitlement`, adminAToken);
    assert.equal(pedroEntitlementFinal.body.qualifyingSpend, 200, "9: qualifyingSpend continua exatamente o que veio das vendas reais, nunca alterado por esta correção");
    const pedroSalesAfter = (await db.collection(`users/${adminAUid}/sales`).where("clientId", "==", pedroId).get()).size;
    assert.equal(pedroSalesAfter, pedroSalesBefore, "10: nenhuma venda nova foi criada por esta correção de projeção");

    // ===== §13: self-heal — cliente com token pré-existente (bug histórico simulado) mas SEM participant
    // projection precisa ser materializado ao carregar o detalhe da campanha, sem migração destrutiva. =====
    {
      const historicoId = await makeClientWithSales("historico", 300);
      // Simula o estado de produção ANTES desta correção: token válido gravado direto no Firestore, sem
      // passar pela rota /links já corrigida (que agora sempre upserta o participant).
      const legacyRawToken = crypto.randomUUID();
      await db.doc(`promotionalCampaigns/${psCampaignId}/accessTokens/legacy-broken-${suffix}`).set({
        customerId: historicoId, tokenHash: hashTokenForTest(legacyRawToken), createdAt: new Date().toISOString(),
        expiresAt: null, revokedAt: null, selectionLimit: 3, claimedThroughToken: 0,
      });
      const beforeHeal = await db.doc(`promotionalCampaigns/${psCampaignId}/participants/${historicoId}`).get();
      assert.equal(beforeHeal.exists, false, "§13 setup: reproduz o bug real — token existe, participant não");

      const detailTriggersHeal = await getJson(`/api/admin/sorteios/campaigns/${psCampaignId}`, adminAToken);
      assert.ok((detailTriggersHeal.body.participants as Array<Record<string, unknown>>).some((p) => p.customerId === historicoId), "§13: self-heal materializa o participante faltante ao carregar o detalhe da campanha");
      const afterHeal = await db.doc(`promotionalCampaigns/${psCampaignId}/participants/${historicoId}`).get();
      assert.equal(afterHeal.exists, true, "§13: self-heal grava o participant no Firestore, não só na resposta HTTP");

      // Self-heal precisa ser idempotente: chamar de novo não duplica nem falha.
      const detailAgain = await getJson(`/api/admin/sorteios/campaigns/${psCampaignId}`, adminAToken);
      assert.equal(detailAgain.status, 200);
      const historicoDocsAfterSecondLoad = await db.collection(`promotionalCampaigns/${psCampaignId}/participants`).where("customerId", "==", historicoId).get();
      assert.equal(historicoDocsAfterSecondLoad.size, 1, "§13: carregar o detalhe de novo não duplica o participant self-healed");
    }
  }

  server.close();
  console.log("PROMOTIONAL-CAMPAIGNS-PARTICIPANT-SYNC-06A owner-access tests passed: registered_sale-only client that generates a link now appears in PARTICIPANTES immediately (materialized in Firestore, not just computed), manual_internal behavior preserved, automatic+manual entries aggregate into a single logical participant (never two docs), a second link for the same client never duplicates the participant or inflates participantsCount, a later claim updates the SAME participant doc (chosen/remaining), revoke preserves the participant, tenant isolation holds (link generation against another tenant's client 404s, no cross-tenant participant leak), a failed link generation (client not found) never leaves a ghost participant, qualifyingSpend/sales are provably untouched by this projection fix, and a pre-existing token-without-participant (the real historical bug, reproduced directly in Firestore) self-heals on campaign-detail load — idempotently, without a destructive migration.");
  console.log("PROMOTIONAL-CAMPAIGNS-SECURE-DRAW-06 owner-access/concurrency tests passed: non-admin close/draw denied, cross-tenant close/draw/result denied, draw before close-entries denied (status unchanged), close-entries from draft denied, zero eligible entries blocks draw (status stays entries_closed), generic status PATCH can never fake entries_closed/drawn and locks after close, claim rejected after close-entries, registered_sale and manual_internal claimed numbers equally eligible, unclaimed numbers excluded from the eligible set, official draw persisted with server-side crypto.randomInt (never Math.random, never a client-supplied winningNumber/winningClientId), eligibleSetHash reproducible from an independent Firestore query, second draw call returns the same official result (no reroll), concurrent draw requests converge to exactly one official drawId, winner name and prize snapshots stay frozen even after the underlying client/campaign is edited afterward.");
  console.log("PROMOTIONAL-CAMPAIGNS-01 owner-access/concurrency tests passed: non-admin create denied, cross-owner detail denied, entitlement computed from real sales (350/100=3), claim confirms atomically, reopening link reflects 0 remaining + own numbers, another customer blocked from an already-claimed number, concurrent claims for the same number resolve to exactly one winner, invalid/revoked token denied, draft/paused/finished campaigns reject claims. LINK-SELECTION-LIMIT-04: link creation blocked with zero entitlement, entitlement preview endpoint, per-token cap independent of global balance, reopening reflects token-scoped remaining, multiple links never jointly overspend, concurrent claims across different links never overspend entitlement, revoke preserves unused rights, legacy tokens without selectionLimit remain fully compatible, tenant isolation on link creation. MANUAL-INTERNAL-05: non-admin denied, spoofed policy ignored (server-authoritative from campaign doc), cross-owner campaign/client denied, invalid quantity denied, idempotent replay never duplicates, qualifyingSpend/sales/stock untouched by manual grants, concurrent claims across manual-funded links never overspend, revoke preserves manual-included balance, ledger immutable across a compensating adjustment, end-to-end §18 fixture (automatic=2, manual=3, claimed=5, remaining=0, qualifyingSpend unchanged, zero extra sales).");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
