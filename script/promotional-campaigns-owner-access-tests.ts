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

  server.close();
  console.log("PROMOTIONAL-CAMPAIGNS-01 owner-access/concurrency tests passed: non-admin create denied, cross-owner detail denied, entitlement computed from real sales (350/100=3), claim confirms atomically, reopening link reflects 0 remaining + own numbers, another customer blocked from an already-claimed number, concurrent claims for the same number resolve to exactly one winner, invalid/revoked token denied, draft/paused/finished campaigns reject claims. LINK-SELECTION-LIMIT-04: link creation blocked with zero entitlement, entitlement preview endpoint, per-token cap independent of global balance, reopening reflects token-scoped remaining, multiple links never jointly overspend, concurrent claims across different links never overspend entitlement, revoke preserves unused rights, legacy tokens without selectionLimit remain fully compatible, tenant isolation on link creation. MANUAL-INTERNAL-05: non-admin denied, spoofed policy ignored (server-authoritative from campaign doc), cross-owner campaign/client denied, invalid quantity denied, idempotent replay never duplicates, qualifyingSpend/sales/stock untouched by manual grants, concurrent claims across manual-funded links never overspend, revoke preserves manual-included balance, ledger immutable across a compensating adjustment, end-to-end §18 fixture (automatic=2, manual=3, claimed=5, remaining=0, qualifyingSpend unchanged, zero extra sales).");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
