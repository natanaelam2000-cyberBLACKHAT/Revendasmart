/**
 * RELEASE-06 — hardening de uploads: magic bytes, dimensões, quota e path ownership.
 *
 * Roda a aplicação Express REAL (registerRoutes) contra Firebase Auth/Firestore/Storage Emulator —
 * grava de verdade no Storage emulado via Admin SDK, exatamente como em produção. Nenhuma chamada a
 * nenhum provider externo.
 */
import assert from "node:assert/strict";
import * as zlib from "node:zlib";
import { createServer, type Server } from "node:http";
import express from "express";
import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, type User } from "firebase/auth";

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
process.env.FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || "demo-revendasmart.appspot.com";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:9199";

function requireLocalEmulators(): void {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
  assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST, "127.0.0.1:9199");
  assert.notEqual(process.env.GOOGLE_CLOUD_PROJECT, "revenda-smart");
}

// ---- fixtures: imagens reais mínimas (mesmos builders de script/smoke-tests.ts) ----
function crc32(buf: Buffer): number {
  let crc = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}
function buildMinimalPng(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  const ihdr = pngChunk("IHDR", ihdrData);
  const rowSize = 1 + width * 3;
  const raw = Buffer.alloc(rowSize * height);
  const idat = pngChunk("IDAT", zlib.deflateSync(raw));
  const iend = pngChunk("IEND", Buffer.alloc(0));
  return Buffer.concat([signature, ihdr, idat, iend]);
}
function buildMinimalJpeg(width: number, height: number): Buffer {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11,
    0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03,
    0x01, 0x22, 0x00,
    0x02, 0x11, 0x01,
    0x03, 0x11, 0x01,
    0xff, 0xd9,
  ]);
}

async function createTestUser(label: string): Promise<{ app: FirebaseApp; user: User }> {
  const app = initializeApp({
    apiKey: "demo-api-key",
    authDomain: `${process.env.FIREBASE_PROJECT_ID}.firebaseapp.com`,
    projectId: process.env.FIREBASE_PROJECT_ID,
    appId: `upload-${label}-${Date.now()}`,
  }, `upload-${label}-${Date.now()}-${Math.random()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const credential = await createUserWithEmailAndPassword(
    auth,
    `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
    "LocalTestPassword!123",
  );
  return { app, user: credential.user };
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
  const bucket = admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET);
  const createdApps: FirebaseApp[] = [];

  const upload = async (user: User, kind: string, targetId: string | undefined, bytes: Buffer, contentType: string) => {
    const token = await user.getIdToken();
    const path = targetId ? `/api/uploads/${kind}/${targetId}` : `/api/uploads/${kind}`;
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": contentType, Authorization: `Bearer ${token}` },
      body: bytes,
    });
    let body: any = null;
    try { body = await response.json(); } catch { /* ignore */ }
    return { status: response.status, body };
  };

  const remove = async (user: User, kind: string, targetId: string | undefined, storagePath: string) => {
    const token = await user.getIdToken();
    const path = targetId ? `/api/uploads/${kind}/${targetId}` : `/api/uploads/${kind}`;
    const response = await fetch(`${baseUrl}${path}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ storagePath }),
    });
    let body: any = null;
    try { body = await response.json(); } catch { /* ignore */ }
    return { status: response.status, body };
  };

  try {
    const owner = await createTestUser("owner");
    createdApps.push(owner.app);
    const intruder = await createTestUser("intruder");
    createdApps.push(intruder.app);

    const jpeg = buildMinimalJpeg(320, 240);
    const png = buildMinimalPng(64, 48);

    // ===== A/B: JPEG/PNG reais aceitos, gravados de verdade no Storage emulado =====
    {
      const result = await upload(owner.user, "product", "product-1", jpeg, "image/jpeg");
      assert.equal(result.status, 200, "A: JPEG real precisa ser aceito");
      assert.equal(result.body.width, 320);
      assert.equal(result.body.height, 240);
      const [exists] = await bucket.file(result.body.storagePath).exists();
      assert.equal(exists, true, "o arquivo precisa existir de verdade no Storage");
      assert.ok(result.body.storagePath.startsWith(`users/${owner.user.uid}/products/product-1/`), "§7: path deriva do UID autenticado");
    }
    {
      const result = await upload(owner.user, "logo", undefined, png, "image/png");
      assert.equal(result.status, 200, "B: PNG real (logo) precisa ser aceito");
      assert.ok(result.body.storagePath.startsWith(`users/${owner.user.uid}/branding/`));
    }

    // ===== D: contentType declarado != bytes reais rejeita =====
    {
      const result = await upload(owner.user, "product", "product-2", jpeg, "image/png");
      assert.equal(result.status, 400);
      assert.equal(result.body.reason, "mime-mismatch");
    }

    // ===== E: extensão/contentType "falso" (arquivo renomeado) rejeita =====
    {
      const executable = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00]);
      const result = await upload(owner.user, "product", "product-3", executable, "image/png");
      assert.equal(result.status, 400);
      assert.equal(result.body.reason, "unsupported-format");
    }

    // ===== F: arquivo truncado rejeita =====
    {
      const result = await upload(owner.user, "product", "product-4", jpeg.subarray(0, 5), "image/jpeg");
      assert.equal(result.status, 400);
    }

    // ===== G: dimensões absurdas (cabeçalho PNG com 60000x60000) rejeitam =====
    {
      const bomb = Buffer.alloc(24);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bomb, 0);
      bomb.write("IHDR", 12, "ascii");
      bomb.writeUInt32BE(60000, 16);
      bomb.writeUInt32BE(60000, 20);
      const result = await upload(owner.user, "product", "product-5", bomb, "image/png");
      assert.equal(result.status, 400);
      assert.equal(result.body.reason, "megapixels-exceeded");
    }

    // ===== H: acima do limite de bytes rejeita =====
    {
      const oversized = Buffer.concat([jpeg, Buffer.alloc(6 * 1024 * 1024)]);
      const result = await upload(owner.user, "product", "product-6", oversized, "image/jpeg");
      assert.equal(result.status, 400);
      assert.equal(result.body.reason, "too-large");
    }

    // ===== I: outro tenant nunca escreve no path de outro usuário =====
    // A rota nem aceita um "uid" como parâmetro — o path SEMPRE deriva do token autenticado. O
    // "ataque" possível é o intruder tentar usar o MESMO productId de outro usuário — mas como o path
    // inclui o uid do intruder, o resultado cai dentro do PRÓPRIO namespace dele, nunca no do owner.
    {
      const result = await upload(intruder.user, "product", "product-1", png, "image/png");
      assert.equal(result.status, 200);
      assert.ok(result.body.storagePath.startsWith(`users/${intruder.user.uid}/products/product-1/`), "I: grava no namespace do PRÓPRIO intruder, nunca no do owner");
      assert.ok(!result.body.storagePath.includes(owner.user.uid), "I: nunca toca o path do owner");
    }

    // ===== J: targetId com tentativa de path traversal é rejeitado =====
    {
      const result = await upload(owner.user, "product", encodeURIComponent("../other-product"), png, "image/png");
      assert.equal(result.status, 400);
      assert.equal(result.body.error, "INVALID_TARGET_ID");
    }

    // ===== N: cutout PNG-only =====
    {
      const rejected = await upload(owner.user, "cutout", "cutout-product", jpeg, "image/jpeg");
      assert.equal(rejected.status, 400, "N: cutout nunca aceita JPEG");
      const accepted = await upload(owner.user, "cutout", "cutout-product", png, "image/png");
      assert.equal(accepted.status, 200, "N: cutout aceita PNG");
      assert.ok(accepted.body.storagePath.startsWith(`users/${owner.user.uid}/product-cutouts/cutout-product/`));
    }

    // ===== K/L: quota — legítima aceita, excedida rejeita (janela apertada via doc direto no Firestore) =====
    {
      const quotaUser = await createTestUser("quota");
      createdApps.push(quotaUser.app);
      // Primeiro upload real (dentro da quota) precisa funcionar.
      const legit = await upload(quotaUser.user, "product", "quota-product-1", png, "image/png");
      assert.equal(legit.status, 200, "L: upload legítimo dentro da quota é aceito");

      // Simula quota já esgotada (Admin SDK, ignora Rules) para provar que o excedente é bloqueado sem
      // depender de enviar centenas de uploads reais no teste.
      await db.collection("users").doc(quotaUser.user.uid).collection("uploadQuota").doc("main").set({
        bytesUsed: 0,
        uploadCount: 200,
        windowStartAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const exceeded = await upload(quotaUser.user, "product", "quota-product-2", buildMinimalPng(10, 10), "image/png");
      assert.equal(exceeded.status, 429, "K: quota excedida rejeita");
      assert.equal(exceeded.body.reason, "rate_limited");
    }

    // ===== M: upload duplicado (mesmo conteúdo) é idempotente — não duplica quota nem regrava =====
    {
      const dedupeUser = await createTestUser("dedupe");
      createdApps.push(dedupeUser.app);
      const first = await upload(dedupeUser.user, "product", "dedupe-product", png, "image/png");
      assert.equal(first.status, 200);
      assert.equal(first.body.deduplicated, false);
      const second = await upload(dedupeUser.user, "product", "dedupe-product", png, "image/png");
      assert.equal(second.status, 200);
      assert.equal(second.body.deduplicated, true, "M: o mesmo conteúdo reenviado é reconhecido como duplicado");
      assert.equal(second.body.storagePath, first.body.storagePath);

      const quotaDoc = await db.collection("users").doc(dedupeUser.user.uid).collection("uploadQuota").doc("main").get();
      assert.equal(quotaDoc.data()?.uploadCount, 1, "M: upload duplicado não incrementa a quota de novo");
    }

    // ===== O: original do produto permanece intacto (bytes do PNG gravado == bytes enviados) =====
    {
      const originalUser = await createTestUser("original");
      createdApps.push(originalUser.app);
      const result = await upload(originalUser.user, "product", "original-product", png, "image/png");
      assert.equal(result.status, 200);
      const [storedBytes] = await bucket.file(result.body.storagePath).download();
      assert.ok(Buffer.compare(storedBytes, png) === 0, "O: os bytes gravados são EXATAMENTE os bytes enviados — nunca recodificados/alterados pelo servidor");
    }

    // ===== P: nenhum segredo/bytes desnecessários persistidos no Firestore =====
    {
      const pUser = await createTestUser("secrets");
      createdApps.push(pUser.app);
      const result = await upload(pUser.user, "product", "secrets-product", png, "image/png");
      assert.equal(result.status, 200);
      const receiptDoc = await db.collection("users").doc(pUser.user.uid).collection("uploadReceipts").get();
      assert.equal(receiptDoc.size, 1);
      const receiptData = JSON.stringify(receiptDoc.docs[0].data());
      assert.doesNotMatch(receiptData, /[A-Za-z0-9+/]{100,}={0,2}/, "P: nenhum blob de bytes/base64 grande no Firestore — só metadata");
      const responseRaw = JSON.stringify(result.body);
      assert.doesNotMatch(responseRaw, /[A-Za-z0-9+/]{100,}={0,2}/, "P: a resposta também não devolve os bytes da imagem");
    }

    // ===== Sem autenticação rejeita =====
    {
      const response = await fetch(`${baseUrl}/api/uploads/product/no-auth-product`, {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: png,
      });
      assert.equal(response.status, 401);
    }

    // ===== RELEASE-18: DELETE server-side — única forma de apagar um asset agora que storage.rules nega
    // write/delete direto do client (rollback de upload em add-product.tsx usa exatamente esta rota). =====
    {
      const deleteUser = await createTestUser("delete-owner");
      createdApps.push(deleteUser.app);
      const uploaded = await upload(deleteUser.user, "product", "delete-product", png, "image/png");
      assert.equal(uploaded.status, 200);
      const [existsBefore] = await bucket.file(uploaded.body.storagePath).exists();
      assert.equal(existsBefore, true);

      // Q: owner apaga o próprio upload pelo endpoint server-side.
      const deleted = await remove(deleteUser.user, "product", "delete-product", uploaded.body.storagePath);
      assert.equal(deleted.status, 200, "Q: endpoint server-side apaga o próprio upload");
      const [existsAfter] = await bucket.file(uploaded.body.storagePath).exists();
      assert.equal(existsAfter, false, "Q: o arquivo realmente some do Storage");

      // Repetir o delete (arquivo já sumiu) continua seguro — nunca lança, nunca recria nada.
      const deletedAgain = await remove(deleteUser.user, "product", "delete-product", uploaded.body.storagePath);
      assert.equal(deletedAgain.status, 200, "Q: apagar de novo um arquivo já ausente é idempotente");

      // R: um storagePath que não bate com o path que o próprio uid produziria é rejeitado — mesmo
      // sendo, tecnicamente, dentro do namespace users/{uid}/... do próprio chamador.
      const forgedPath = await remove(deleteUser.user, "product", "delete-product", `users/${deleteUser.user.uid}/products/delete-product/../../secrets.txt`);
      assert.equal(forgedPath.status, 400);
      assert.equal(forgedPath.body.error, "INVALID_STORAGE_PATH");

      // S: intruso não consegue apagar o asset de outro usuário — o path que ele envia nunca bate com o
      // que `storagePathFor` produziria para o PRÓPRIO uid do intruso (nunca chega a tocar o bucket).
      const secondUpload = await upload(deleteUser.user, "product", "delete-product-2", png, "image/png");
      assert.equal(secondUpload.status, 200);
      const intruderDelete = await remove(intruder.user, "product", "delete-product-2", secondUpload.body.storagePath);
      assert.equal(intruderDelete.status, 400, "S: intruso não consegue apagar asset de outro usuário");
      assert.equal(intruderDelete.body.error, "INVALID_STORAGE_PATH");
      const [stillExists] = await bucket.file(secondUpload.body.storagePath).exists();
      assert.equal(stillExists, true, "S: o asset do owner permanece intacto");
    }

    // ===== Sem autenticação rejeita o delete também =====
    {
      const response = await fetch(`${baseUrl}/api/uploads/product/no-auth-product`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath: "users/whoever/products/no-auth-product/x.png" }),
      });
      assert.equal(response.status, 401);
    }

    console.log("Upload hardening tests passed: magic bytes, dimensions, quota, idempotency, path ownership, server-side delete.");
  } finally {
    await close(server);
    await Promise.allSettled(createdApps.map((app) => deleteApp(app)));
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
