/**
 * RELEASE-05 — login-CSRF / account-link hijack no OAuth do Mercado Pago.
 *
 * Roda a aplicação Express REAL (registerRoutes) contra o Firebase Auth/Firestore Emulator. As
 * chamadas ao Mercado Pago em si (token exchange, /users/me) são interceptadas via um `fetch` global
 * mockado — ZERO chamada real ao Mercado Pago, exatamente como exigido pela tarefa. O mock só
 * intercepta URLs de api.mercadopago.com; qualquer outra chamada (inclusive as do próprio teste contra
 * o servidor local) passa direto para o fetch original.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import express from "express";
import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, type User } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";

const PROJECT_ID = "demo-revendasmart";

function requireLocalEmulators(): void {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
  assert.notEqual(process.env.GOOGLE_CLOUD_PROJECT, "revenda-smart");
  process.env.FIREBASE_PROJECT_ID = PROJECT_ID;
}

// Lidas uma única vez, no module-load de server/mercadopago-connections.ts — precisam existir ANTES
// do primeiro `await import(...)` de qualquer módulo do servidor, mais abaixo.
process.env.MERCADOPAGO_CLIENT_ID = "test-client-id-never-sent-anywhere";
process.env.MERCADOPAGO_CLIENT_SECRET = "test-client-secret-never-sent-anywhere";
process.env.MERCADOPAGO_TOKEN_ENCRYPTION_KEY = "a".repeat(64);
process.env.FRONTEND_URL = "https://revendasmart.example.test";

async function createTestUser(label: string): Promise<{ app: FirebaseApp; user: User; db: Firestore }> {
  const app = initializeApp({
    apiKey: "demo-api-key",
    authDomain: `${PROJECT_ID}.firebaseapp.com`,
    projectId: PROJECT_ID,
    appId: `mp-oauth-${label}-${Date.now()}`,
  }, `mp-oauth-${label}-${Date.now()}-${Math.random()}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const credential = await createUserWithEmailAndPassword(
    auth,
    `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
    "LocalTestPassword!123",
  );
  return { app, user: credential.user, db };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

/** Extrai só o par nome=valor do primeiro Set-Cookie (ignora Path/HttpOnly/etc.) para reenviar como Cookie. */
function firstCookiePair(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null;
  return setCookieHeader.split(";")[0]?.trim() || null;
}

type MockTokenResponse = { access_token: string; token_type: string; expires_in: number; scope: string; user_id: number; refresh_token?: string };

/** Fetch mockado: só intercepta URLs de api.mercadopago.com (token exchange + /users/me); tudo o mais
 * (inclusive as chamadas HTTP do próprio teste contra o servidor Express local) passa para o fetch real. */
function buildMockFetch(originalFetch: typeof fetch, options: { tokenResponse?: MockTokenResponse | { error: number }; userInfo?: { email: string } }) {
  const calls: string[] = [];
  const mockFetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    if (url.startsWith("https://api.mercadopago.com/oauth/token")) {
      calls.push("token_exchange");
      if (options.tokenResponse && "error" in options.tokenResponse) {
        return new Response(null, { status: options.tokenResponse.error });
      }
      const body = options.tokenResponse ?? {
        access_token: "TEST-mock-access-token", token_type: "bearer", expires_in: 21600,
        scope: "read write", user_id: 999999, refresh_token: "TEST-mock-refresh-token",
      };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.startsWith("https://api.mercadopago.com/users/me")) {
      calls.push("user_info");
      // first_name/last_name/identification sempre presentes: um MP /users/me sem esses campos expõe
      // um bug pré-existente e não relacionado (accountName/accountDocumentId viram undefined e o
      // Firestore recusa o documento) — fora do escopo desta tarefa (login-CSRF), sinalizado
      // separadamente em vez de corrigido aqui.
      return new Response(JSON.stringify(options.userInfo ?? {
        email: "merchant@example.test", first_name: "Merchant", last_name: "Test",
        identification: { number: "00000000000" },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return originalFetch(input, init);
  }) as unknown as typeof fetch;
  return { mockFetch, calls };
}

async function run(): Promise<void> {
  requireLocalEmulators();

  const [{ registerRoutes }, { getFirebaseAdmin }] = await Promise.all([
    import("../server/routes"),
    import("../server/firebase-admin-init"),
  ]);
  const app = express();
  app.use(express.json({ limit: "100kb" }));
  const server = createServer(app);
  await registerRoutes(server, app);
  const baseUrl = await listen(server);

  const admin = getFirebaseAdmin();
  const db = admin.firestore();
  const createdApps: FirebaseApp[] = [];
  const originalFetch = globalThis.fetch;

  try {
    const owner = await createTestUser("owner");
    createdApps.push(owner.app);
    const intruder = await createTestUser("intruder");
    createdApps.push(intruder.app);

    const startAuth = async (user: User) => {
      const token = await user.getIdToken();
      const response = await fetch(`${baseUrl}/api/mercadopago/start-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const body = await response.json() as { authUrl?: string; nonce?: string };
      const setCookie = response.headers.get("set-cookie");
      return { status: response.status, body, cookie: firstCookiePair(setCookie) };
    };

    const callback = async (params: { code?: string; state?: string; error?: string }, cookieHeader?: string | null) => {
      const url = new URL(`${baseUrl}/api/mercadopago/callback`);
      if (params.code !== undefined) url.searchParams.set("code", params.code);
      if (params.state !== undefined) url.searchParams.set("state", params.state);
      if (params.error !== undefined) url.searchParams.set("error", params.error);
      const response = await fetch(url, { redirect: "manual", headers: cookieHeader ? { Cookie: cookieHeader } : {} });
      const location = response.headers.get("location") || "";
      const reason = new URL(location, baseUrl).searchParams.get("reason");
      const status = new URL(location, baseUrl).searchParams.get("status");
      return { httpStatus: response.status, location, status, reason };
    };

    // ===== A: fluxo legítimo completa =====
    {
      const { mockFetch, calls } = buildMockFetch(originalFetch, {});
      (globalThis as any).fetch = mockFetch;
      const started = await startAuth(owner.user);
      assert.equal(started.status, 200);
      assert.ok(started.body.nonce, "A: start-auth precisa devolver o nonce");
      assert.ok(started.cookie?.startsWith("mp_oauth_attempt="), "A: start-auth precisa setar o cookie de continuidade");

      const result = await callback({ code: "real-looking-code", state: started.body.nonce }, started.cookie);
      globalThis.fetch = originalFetch;
      assert.equal(result.status, "success", "A: fluxo legítimo (mesmo browser, cookie presente) precisa concluir com sucesso");
      assert.deepEqual(calls, ["token_exchange", "user_info"]);

      const uid = owner.user.uid;
      const connections = await db.collection("users").doc(uid).collection("mercadopago_connections").get();
      assert.equal(connections.size, 1);
      const connection = connections.docs[0].data();
      assert.equal(connection.uid, uid, "H: a conexão criada pertence ao UID que iniciou o attempt");
      assert.equal(connection.merchantId, "999999");
      assert.equal(connection.status, "active");
    }

    // ===== RELEASE-05B: /users/me sem nome/documento não pode quebrar a criação da conexão =====
    // (letras conforme a tarefa RELEASE-05B, não as de RELEASE-05 acima)
    const metadataScenario = async (label: string, userInfo: Record<string, unknown>, expect: { name?: string; documentId?: string }) => {
      const scenarioUser = await createTestUser(`metadata-${label}`);
      createdApps.push(scenarioUser.app);
      const { mockFetch } = buildMockFetch(originalFetch, { userInfo: userInfo as { email: string } });
      (globalThis as any).fetch = mockFetch;
      const started = await startAuth(scenarioUser.user);
      const result = await callback({ code: `code-${label}`, state: started.body.nonce }, started.cookie);
      globalThis.fetch = originalFetch;
      assert.equal(result.status, "success", `${label}: conexão precisa ser criada mesmo com /users/me incompleto`);

      const snapshot = await db.collection("users").doc(scenarioUser.user.uid).collection("mercadopago_connections").get();
      assert.equal(snapshot.size, 1, `${label}: K, conexão listável/persistida`);
      const data = snapshot.docs[0].data();

      // J: o documento persistido no Firestore nunca contém uma chave com valor `undefined` — nem
      // accountName/accountDocumentId, nem nenhum outro campo (o bug original travava o `.set()` inteiro).
      for (const [key, value] of Object.entries(data)) {
        assert.notEqual(value, undefined, `${label}: J, campo "${key}" não pode ser undefined no documento persistido`);
      }

      if (expect.name === undefined) assert.ok(!("accountName" in data), `${label}: accountName precisa estar OMITIDO, não undefined`);
      else assert.equal(data.accountName, expect.name);

      if (expect.documentId === undefined) assert.ok(!("accountDocumentId" in data), `${label}: accountDocumentId precisa estar OMITIDO, não undefined`);
      else assert.equal(data.accountDocumentId, expect.documentId);

      // H/I: tokens continuam criptografados e nunca aparecem na resposta pública.
      assert.equal(typeof data.accessToken, "object");
      assert.ok(data.accessToken?.ciphertext, `${label}: accessToken precisa continuar como EncryptedToken`);
      const token = await scenarioUser.user.getIdToken();
      const listResponse = await fetch(`${baseUrl}/api/mercadopago/connections`, { headers: { Authorization: `Bearer ${token}` } });
      const listBody = await listResponse.text();
      assert.doesNotMatch(listBody, /"accessToken"|"refreshToken"|TEST-mock-access-token|TEST-mock-refresh-token/, `${label}: token nunca aparece na resposta de listagem`);
    };

    // A) resposta completa já foi coberta pelo teste "A" acima (nome e documento presentes).
    await metadataScenario("B-sem-first-name", { email: "b@example.test", last_name: "Silva", identification: { number: "111" } }, { name: "Silva", documentId: "111" });
    await metadataScenario("C-sem-last-name", { email: "c@example.test", first_name: "Ana", identification: { number: "222" } }, { name: "Ana", documentId: "222" });
    await metadataScenario("D-sem-ambos", { email: "d@example.test", identification: { number: "333" } }, { documentId: "333" });
    await metadataScenario("E-sem-identification", { email: "e@example.test", first_name: "Ana", last_name: "Silva" }, { name: "Ana Silva" });
    await metadataScenario("F-identification-vazio", { email: "f@example.test", first_name: "Ana", last_name: "Silva", identification: { number: "" } }, { name: "Ana Silva" });
    await metadataScenario("G-tudo-vazio", { email: "g@example.test", first_name: "", last_name: "", identification: { number: "" } }, {});

    // ===== B: state inexistente rejeita =====
    {
      const fakeState = "0".repeat(64);
      const result = await callback({ code: "x", state: fakeState }, `mp_oauth_attempt=${fakeState}`);
      assert.equal(result.status, "error");
      assert.equal(result.reason, "invalid_state");
    }

    // ===== C: state alterado (fora do formato) rejeita =====
    {
      const result = await callback({ code: "x", state: "not-a-valid-hex-nonce" }, "mp_oauth_attempt=not-a-valid-hex-nonce");
      assert.equal(result.status, "error");
      assert.equal(result.reason, "invalid_state");
    }

    // ===== D: state expirado rejeita =====
    {
      const started = await startAuth(owner.user);
      const nonce = started.body.nonce!;
      // Reescreve o expiresAt diretamente no Firestore (Admin SDK, ignora Rules) para simular TTL vencido
      // sem precisar esperar os 10 minutos reais.
      await db.collection("mercadopago_oauth_states").doc(nonce).update({ expiresAt: new Date(Date.now() - 1000).toISOString() });
      const result = await callback({ code: "x", state: nonce }, started.cookie);
      assert.equal(result.status, "error");
      assert.equal(result.reason, "invalid_state");
    }

    // ===== E/O: state reutilizado rejeita (replay) — inclui uma corrida de dois callbacks simultâneos,
    // dos quais só um pode consumir o mesmo nonce. =====
    {
      const { mockFetch } = buildMockFetch(originalFetch, {});
      (globalThis as any).fetch = mockFetch;
      const started = await startAuth(owner.user);
      const nonce = started.body.nonce!;
      const [first, second] = await Promise.all([
        callback({ code: "code-a", state: nonce }, started.cookie),
        callback({ code: "code-b", state: nonce }, started.cookie),
      ]);
      globalThis.fetch = originalFetch;
      const outcomes = [first.status, second.status].sort();
      assert.deepEqual(outcomes, ["error", "success"], "O: exatamente uma das duas chamadas concorrentes consome o nonce");
      const failed = first.status === "error" ? first : second;
      assert.equal(failed.reason, "invalid_state");

      // Repetir de novo, sequencialmente, confirma que o nonce já consumido nunca mais funciona (E).
      const replay = await callback({ code: "code-c", state: nonce }, started.cookie);
      assert.equal(replay.status, "error");
      assert.equal(replay.reason, "invalid_state");
    }

    // ===== F/I: callback nunca decide o UID a partir de query/body — só do attempt server-owned =====
    {
      const started = await startAuth(owner.user);
      const nonce = started.body.nonce!;
      // Nem sequer existe um parâmetro de uid no callback — a única forma de influenciar o dono seria
      // via query/body, e a rota não lê nenhum campo do tipo. Confirmado estruturalmente abaixo.
      const mercadopagoConnectionsSource = await (await import("node:fs/promises")).readFile("server/mercadopago-connections.ts", "utf8");
      assert.doesNotMatch(mercadopagoConnectionsSource, /req\.(query|body)\.u?id/i, "F/I: o handler nunca lê uid de query/body");
      // Consome o attempt de forma limpa para não deixar lixo pendurado no próximo teste.
      await db.collection("mercadopago_oauth_states").doc(nonce).update({ used: true, usedAt: new Date().toISOString() });
    }

    // ===== G: browser B não consegue concluir o attempt de A (continuidade de browser) =====
    {
      const startedByOwner = await startAuth(owner.user);
      const nonce = startedByOwner.body.nonce!;
      // "B" tenta completar o callback do "A" com o code/state corretos, mas SEM o cookie que só o
      // browser de A recebeu (simula B copiando/roubando a URL, nunca o cookie HttpOnly de A).
      const hijackAttempt = await callback({ code: "stolen-code", state: nonce }, null);
      assert.equal(hijackAttempt.status, "error");
      assert.equal(hijackAttempt.reason, "continuity_mismatch", "G: sem o cookie do browser que iniciou, o callback é recusado");

      // O cookie errado (de outro attempt) também não serve.
      const otherAttempt = await startAuth(intruder.user);
      const wrongCookieAttempt = await callback({ code: "stolen-code", state: nonce }, otherAttempt.cookie);
      assert.equal(wrongCookieAttempt.status, "error");
      assert.equal(wrongCookieAttempt.reason, "continuity_mismatch");

      // O nonce de A continua intacto (não foi consumido pelas tentativas de B) — o dono legítimo ainda
      // consegue completar o próprio fluxo depois.
      const { mockFetch } = buildMockFetch(originalFetch, {});
      (globalThis as any).fetch = mockFetch;
      const legitimateCompletion = await callback({ code: "real-code", state: nonce }, startedByOwner.cookie);
      globalThis.fetch = originalFetch;
      assert.equal(legitimateCompletion.status, "success", "o dono original ainda consegue completar o próprio attempt depois das tentativas de sequestro");
    }

    // ===== J: code ausente rejeita =====
    {
      const started = await startAuth(owner.user);
      const result = await callback({ state: started.body.nonce }, started.cookie);
      assert.equal(result.status, "error");
      assert.equal(result.reason, "missing_params");
    }

    // ===== K: erro OAuth do provider tratado =====
    {
      const result = await callback({ error: "access_denied" });
      assert.equal(result.status, "denied");
    }

    // ===== L: troca de code falhando não cria conexão falsa =====
    {
      const { mockFetch } = buildMockFetch(originalFetch, { tokenResponse: { error: 400 } });
      (globalThis as any).fetch = mockFetch;
      const started = await startAuth(owner.user);
      const before = await db.collection("users").doc(owner.user.uid).collection("mercadopago_connections").get();
      const result = await callback({ code: "will-fail", state: started.body.nonce }, started.cookie);
      globalThis.fetch = originalFetch;
      assert.equal(result.status, "error");
      assert.equal(result.reason, "server_error");
      const after = await db.collection("users").doc(owner.user.uid).collection("mercadopago_connections").get();
      assert.equal(after.size, before.size, "L: nenhuma conexão nova nasce quando a troca de code falha");
    }

    // ===== N: conexão legacy criada antes desta correção continua funcional =====
    {
      const legacyRef = db.collection("users").doc(owner.user.uid).collection("mercadopago_connections").doc("legacy-connection");
      await legacyRef.set({
        id: "legacy-connection", uid: owner.user.uid, accessToken: null, refreshToken: null,
        tokenObtainedAt: new Date().toISOString(), accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
        refreshTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(), merchantId: "legacy-merchant",
        accountEmail: "legacy@example.test", status: "active", isDefault: false, environment: "production",
        connectedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      const token = await owner.user.getIdToken();
      const response = await fetch(`${baseUrl}/api/mercadopago/connections`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await response.json() as { connections: Array<{ id: string; merchantId: string }> };
      assert.equal(response.status, 200);
      assert.ok(body.connections.some((c) => c.id === "legacy-connection" && c.merchantId === "legacy-merchant"), "N: conexão legacy continua listável/funcional");
    }

    // ===== M: tokens nunca aparecem na resposta =====
    {
      const token = await owner.user.getIdToken();
      const response = await fetch(`${baseUrl}/api/mercadopago/connections`, { headers: { Authorization: `Bearer ${token}` } });
      const raw = await response.text();
      assert.doesNotMatch(raw, /TEST-mock-access-token|TEST-mock-refresh-token/, "M: token em claro nunca aparece na resposta");
      assert.doesNotMatch(raw, /"accessToken"|"refreshToken"/, "M: nem o campo criptografado de token é exposto ao client");
    }

    // ===== RELEASE-21: sem chave de criptografia válida, o callback nunca persiste uma conexão =====
    // (mesmo com token exchange e /users/me respondendo com sucesso — a falha é só na hora de
    // encriptar o token antes de gravar, exatamente como "L" acima cobre a falha na troca de code).
    {
      const { mockFetch } = buildMockFetch(originalFetch, {});
      (globalThis as any).fetch = mockFetch;
      const started = await startAuth(owner.user);
      const before = await db.collection("users").doc(owner.user.uid).collection("mercadopago_connections").get();

      const originalEncryptionKey = process.env.MERCADOPAGO_TOKEN_ENCRYPTION_KEY;
      delete process.env.MERCADOPAGO_TOKEN_ENCRYPTION_KEY;
      let result: Awaited<ReturnType<typeof callback>>;
      try {
        result = await callback({ code: "would-succeed-but-no-key", state: started.body.nonce }, started.cookie);
      } finally {
        process.env.MERCADOPAGO_TOKEN_ENCRYPTION_KEY = originalEncryptionKey;
      }
      globalThis.fetch = originalFetch;

      assert.equal(result.status, "error", "RELEASE-21: sem chave de criptografia, o callback nunca reporta sucesso");
      assert.equal(result.reason, "server_error");
      const after = await db.collection("users").doc(owner.user.uid).collection("mercadopago_connections").get();
      assert.equal(after.size, before.size, "RELEASE-21: nenhuma conexão nasce quando a criptografia do token falha — nunca persiste token em claro nem conexão marcada como ativa");
    }

    console.log("Mercado Pago OAuth continuity/CSRF tests passed: state single-use, browser continuity, cross-user linking blocked, legacy preserved, encryption fail-closed.");
  } finally {
    globalThis.fetch = originalFetch;
    await close(server);
    await Promise.allSettled(createdApps.map((app) => deleteApp(app)));
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
