import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { PRODUCT_IMAGE_COORDINATE_SPACE_VERSION } from "../../shared/product-image-coordinate-space";
import { runReservedPhotoroomAttempt } from "./attempt";
import { decodeSourceRgbaIfPossible } from "./source-decode";
import { emptyProductCutoutSmokeLedger, type ProductCutoutSmokeLedger } from "./ledger";
import { PHOTOROOM_MAX_CALLS_PER_RUN, normalizePhotoroomMask, runPhotoroomCutoutAdapter, type PhotoroomMaskTransport } from "./photoroom";
import { decodePngToRgba, hasPngSignature } from "./png";

function u32(value: number) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value >>> 0);
  return bytes;
}

function chunk(type: string, data: Uint8Array) {
  return Buffer.concat([u32(data.length), Buffer.from(type, "ascii"), Buffer.from(data), Buffer.alloc(4)]);
}

function grayscalePng(width: number, height: number, alpha: readonly number[]): Uint8Array {
  assert.equal(alpha.length, width * height);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const scanlines = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    scanlines[y * (width + 1)] = 0;
    for (let x = 0; x < width; x += 1) scanlines[y * (width + 1) + 1 + x] = alpha[y * width + x];
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(scanlines)),
    chunk("IEND", new Uint8Array()),
  ]);
}

/** RGB PNG mínimo (colorType 2, sem alpha), para testar decode de SOURCE-PNG (item D). */
function rgbPng(width: number, height: number, pixels: readonly [number, number, number][]): Uint8Array {
  assert.equal(pixels.length, width * height);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const stride = width * 3;
  const scanlines = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    scanlines[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixels[y * width + x];
      const offset = y * (stride + 1) + 1 + x * 3;
      scanlines[offset] = r;
      scanlines[offset + 1] = g;
      scanlines[offset + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(scanlines)),
    chunk("IEND", new Uint8Array()),
  ]);
}

function baseInput() {
  return {
    apiKey: "test-key-never-sent",
    sourceImageBytes: Uint8Array.from([1, 2, 3]),
    fileName: "fixture.png",
    mimeType: "image/png",
    sourceDimensions: {
      width: 2,
      height: 2,
      sourceAssetId: "asset-test-v1",
      coordinateSpaceVersion: PRODUCT_IMAGE_COORDINATE_SPACE_VERSION,
    },
    originalRgba: {
      data: Uint8ClampedArray.from([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255]),
      width: 2,
      height: 2,
      sourceAssetId: "asset-test-v1",
      coordinateSpaceVersion: PRODUCT_IMAGE_COORDINATE_SPACE_VERSION,
    },
  };
}

function response(status: number, body = grayscalePng(2, 2, [0, 128, 255, 64]), contentType = "image/png") {
  return { status, body, contentType };
}

export async function runProductCutoutSmokeTests() {
  // 2xx válida: só o alpha do provider entra; RGB final permanece original; as duas fases concluem.
  let calls = 0;
  const validTransport: PhotoroomMaskTransport = async () => { calls += 1; return response(200); };
  const valid = await runPhotoroomCutoutAdapter(baseInput(), { transport: validTransport });
  assert.equal(valid.success, true);
  assert.equal(valid.providerMaskAccepted, true);
  assert.equal(valid.localCompositionStatus, "accepted");
  assert.equal(valid.callsMade, 1);
  assert.equal(valid.retries, 0);
  assert.equal(calls, 1);
  assert.deepEqual(Array.from(valid.mask?.data || []), [0, 128, 255, 64]);
  assert.deepEqual(Array.from(valid.composition?.accepted ? valid.composition.rgba : []), [10, 20, 30, 0, 40, 50, 60, 128, 70, 80, 90, 255, 100, 110, 120, 64]);

  // 2xx inválida/decode falho.
  const invalidBody = await runPhotoroomCutoutAdapter(baseInput(), { transport: async () => response(200, Uint8Array.from([1, 2, 3])) });
  assert.equal(invalidBody.success, false);
  assert.equal(invalidBody.providerMaskAccepted, false);
  assert.equal(invalidBody.localCompositionStatus, "rejected");
  assert.equal(invalidBody.errorCode, "mask-decode-failed");
  assert.equal(invalidBody.potentiallyBilled, true);

  // HTTP 4xx e 429: uma chamada, zero retry, sem fallback.
  for (const status of [400, 429]) {
    let attemptCalls = 0;
    const result = await runPhotoroomCutoutAdapter(baseInput(), { transport: async () => { attemptCalls += 1; return response(status); } });
    assert.equal(result.success, false);
    assert.equal(result.providerMaskAccepted, false);
    assert.equal(result.httpStatus, status);
    assert.equal(result.retries, 0);
    assert.equal(attemptCalls, 1);
  }

  // Network error: pode ter chegado ao provider, portanto reserva permanece conservadoramente cobrada.
  let networkCalls = 0;
  const networkError = await runPhotoroomCutoutAdapter(baseInput(), { transport: async () => { networkCalls += 1; throw new Error("offline-test"); } });
  assert.equal(networkError.errorCode, "NETWORK_ERROR");
  assert.equal(networkError.providerMaskAccepted, false);
  assert.equal(networkError.potentiallyBilled, true);
  assert.equal(networkError.retries, 0);
  assert.equal(networkCalls, 1);

  // Dimensões erradas.
  const wrongDimensions = await runPhotoroomCutoutAdapter(baseInput(), { transport: async () => response(200, grayscalePng(1, 1, [255])) });
  assert.equal(wrongDimensions.errorCode, "mask-dimensions-mismatch");
  assert.equal(wrongDimensions.providerMaskAccepted, false);

  // Alpha buffer inválido é barrado pelo composer/gate mesmo se um normalizador defeituoso o entregar.
  const invalidAlpha = await runPhotoroomCutoutAdapter(baseInput(), {
    transport: async () => response(200),
    normalizeMask: (input) => ({
      accepted: true,
      mask: { data: Uint8ClampedArray.from([255]), width: 2, height: 2, sourceAssetId: input.sourceAssetId, coordinateSpaceVersion: input.coordinateSpaceVersion },
      errors: [],
    }),
  });
  assert.equal(invalidAlpha.errorCode, "PIXEL_GATE_REJECTED");
  assert.equal(invalidAlpha.providerMaskAccepted, true);
  assert.equal(invalidAlpha.localCompositionStatus, "rejected");

  const validMaskBody = grayscalePng(2, 2, [0, 128, 255, 64]);
  const normalizationBase = {
    responseBody: validMaskBody,
    contentType: "image/png",
    expectedWidth: 2,
    expectedHeight: 2,
    sourceAssetId: "asset-a",
    expectedSourceAssetId: "asset-a",
    coordinateSpaceVersion: PRODUCT_IMAGE_COORDINATE_SPACE_VERSION,
    expectedCoordinateSpaceVersion: PRODUCT_IMAGE_COORDINATE_SPACE_VERSION,
  };
  assert.equal(normalizePhotoroomMask({ ...normalizationBase, sourceAssetId: "asset-b" }).accepted, false);
  assert.equal(normalizePhotoroomMask({ ...normalizationBase, coordinateSpaceVersion: "other-space" as any }).accepted, false);

  // Pixel Gate rejeitado nunca vira sucesso.
  const pixelRejected = await runPhotoroomCutoutAdapter(baseInput(), {
    transport: async () => response(200),
    compose: () => ({ accepted: false, errors: [{ code: "pixel-gate-rejected", field: "cutout", message: "synthetic" }] }),
  });
  assert.equal(pixelRejected.success, false);
  assert.equal(pixelRejected.errorCode, "PIXEL_GATE_REJECTED");
  assert.equal(pixelRejected.localCompositionStatus, "rejected");

  // Hard stop: reserva de US$0,02 acima de US$1 impede a chamada antes do transport.
  const exhaustedLedger: ProductCutoutSmokeLedger = {
    ...emptyProductCutoutSmokeLedger(),
    entries: [{
      timestamp: "2026-08-16T00:00:00.000Z",
      provider: "photoroom",
      file: "fixture.png",
      caseId: "fixture",
      estimatedCostUsd: 1,
      conservativeMaxCostUsd: 1,
      actualBilledCostUsd: null,
      httpOutcome: "network-error",
      potentiallyBilled: true,
      success: false,
    }],
  };
  let blockedCalls = 0;
  const blocked = await runReservedPhotoroomAttempt({ ...baseInput(), caseId: "fixture", file: "fixture.png" }, exhaustedLedger, {
    transport: async () => { blockedCalls += 1; return response(200); },
  });
  assert.equal(blocked.blockedByHardStop, true);
  assert.equal(blocked.adapter, null);
  assert.equal(blockedCalls, 0);

  // --- PRO-07F.3B-RECONCILE-DIAG §5: cobertura adicional, zero rede real ---

  // HTTP 401.
  {
    let attemptCalls = 0;
    const result = await runPhotoroomCutoutAdapter(baseInput(), { transport: async () => { attemptCalls += 1; return response(401); } });
    assert.equal(result.success, false);
    assert.equal(result.httpStatus, 401);
    assert.equal(result.errorCode, "HTTP_4XX");
    assert.equal(result.retries, 0);
    assert.equal(attemptCalls, 1);
  }

  // HTTP 500.
  {
    let attemptCalls = 0;
    const result = await runPhotoroomCutoutAdapter(baseInput(), { transport: async () => { attemptCalls += 1; return response(500); } });
    assert.equal(result.success, false);
    assert.equal(result.httpStatus, 500);
    assert.equal(result.errorCode, "HTTP_ERROR");
    assert.equal(result.retries, 0);
    assert.equal(attemptCalls, 1);
  }

  // MIME inesperado: 2xx mas Content-Type não é image/png -> rejeitado antes de qualquer decode.
  {
    const jsonBody = Buffer.from(JSON.stringify({ error: "not an image" }), "utf8");
    const result = await runPhotoroomCutoutAdapter(baseInput(), { transport: async () => response(200, jsonBody, "application/json") });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "invalid-response-mime");
    assert.equal(result.contentType, "application/json");
    assert.equal(result.bodyLength, jsonBody.length);
  }

  // Body vazio.
  {
    const result = await runPhotoroomCutoutAdapter(baseInput(), { transport: async () => response(200, new Uint8Array(0)) });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "mask-decode-failed");
    assert.equal(result.bodyLength, 0);
  }

  // Invalid PNG signature, fail-closed.
  {
    const jpegLikeBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01]);
    assert.equal(hasPngSignature(jpegLikeBytes), false, "assinatura JPEG não pode ser confundida com PNG");
    assert.equal(hasPngSignature(new Uint8Array(0)), false, "buffer vazio nunca tem assinatura válida");
    const validSignature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    assert.equal(hasPngSignature(validSignature), true);

    const result = await runPhotoroomCutoutAdapter(baseInput(), { transport: async () => response(200, jpegLikeBytes) });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "mask-decode-failed");
  }

  // Limite de chamadas: no máximo 1 chamada por execução do adapter, sempre.
  {
    assert.equal(PHOTOROOM_MAX_CALLS_PER_RUN, 1);
    let transportCalls = 0;
    const result = await runPhotoroomCutoutAdapter(baseInput(), { transport: async () => { transportCalls += 1; return response(200); } });
    assert.equal(transportCalls, 1);
    assert.equal(result.callsMade, 1);
  }

  // Segredo nunca persistido no ledger.
  {
    const realisticApiKey = "sk_live_photoroom_smoke_test_never_should_appear_in_ledger_abc123";
    const cleanLedger = emptyProductCutoutSmokeLedger();
    const attempt = await runReservedPhotoroomAttempt(
      { ...baseInput(), apiKey: realisticApiKey, caseId: "secret-check", file: "fixture.png" },
      cleanLedger,
      { transport: async () => response(200) },
    );
    const serialized = JSON.stringify(attempt.ledger);
    assert.doesNotMatch(serialized, new RegExp(realisticApiKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(serialized, /x-api-key/i);
    assert.doesNotMatch(serialized, /authorization/i);
    for (const entry of attempt.ledger.entries) {
      assert.equal("apiKey" in entry, false);
      assert.equal("headers" in entry, false);
    }
  }

  // --- PRO-07F.3B-FIX §7: source JPEG vs PNG, Fase 1 vs Fase 2, sem garantia falsa ---

  // A) source JPEG nunca aciona decodePngToRgba — decodeSourceRgbaIfPossible devolve undefined sem
  // tentar decodificar (bytes JPEG reais, que fariam decodePngToRgba lançar se fossem chamados).
  {
    const realJpegHeader = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01]);
    const originalRgba = decodeSourceRgbaIfPossible(realJpegHeader, "image/jpeg", "asset-jpeg-v1");
    assert.equal(originalRgba, undefined, "source JPEG não deve produzir RGBA local — nenhum decoder JPEG existe");
    assert.throws(() => decodePngToRgba(realJpegHeader), "prova de que os MESMOS bytes JPEG lançariam se decodePngToRgba fosse chamado sobre eles — decodeSourceRgbaIfPossible corretamente evita isso");
  }

  // B) source JPEG chega intacto ao transport mock — bytes exatamente iguais, nenhuma transformação.
  {
    const jpegSourceBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
    let receivedBytes: Uint8Array | null = null;
    await runPhotoroomCutoutAdapter(
      { ...baseInput(), sourceImageBytes: jpegSourceBytes, mimeType: "image/jpeg", originalRgba: undefined },
      { transport: async (request) => { receivedBytes = request.sourceImageBytes; return response(200); } },
    );
    assert.deepEqual(Array.from(receivedBytes || []), Array.from(jpegSourceBytes), "os bytes do source chegam ao transport exatamente como lidos, sem conversão JPEG->PNG nem qualquer outra");
  }

  // C) resposta alpha PNG válida é aceita (Fase 1) independentemente do formato do source.
  {
    const result = await runPhotoroomCutoutAdapter(
      { ...baseInput(), mimeType: "image/jpeg", originalRgba: undefined },
      { transport: async () => response(200) },
    );
    assert.equal(result.providerMaskAccepted, true);
  }

  // D) source PNG continua funcionando: decode local reaproveita o MESMO decoder da mask, agora
  // aplicado a um arquivo que de fato é PNG — Fase 2 roda e aceita.
  {
    const pngSourceBytes = rgbPng(2, 2, [[10, 20, 30], [40, 50, 60], [70, 80, 90], [100, 110, 120]]);
    const originalRgba = decodeSourceRgbaIfPossible(pngSourceBytes, "image/png", "asset-png-source-v1");
    assert.ok(originalRgba, "source PNG precisa decodificar com sucesso");
    assert.deepEqual(Array.from(originalRgba!.data), [10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255]);

    const result = await runPhotoroomCutoutAdapter(
      {
        apiKey: "test-key-never-sent",
        sourceImageBytes: pngSourceBytes,
        fileName: "source.png",
        mimeType: "image/png",
        sourceDimensions: { width: 2, height: 2, sourceAssetId: "asset-png-source-v1", coordinateSpaceVersion: PRODUCT_IMAGE_COORDINATE_SPACE_VERSION },
        originalRgba,
      },
      { transport: async () => response(200) },
    );
    assert.equal(result.providerMaskAccepted, true);
    assert.equal(result.localCompositionStatus, "accepted");
    assert.equal(result.success, true);
  }

  // E) mask não-PNG rejeita (já coberto por "MIME inesperado" acima; reforça no contexto de source JPEG).
  {
    const result = await runPhotoroomCutoutAdapter(
      { ...baseInput(), mimeType: "image/jpeg", originalRgba: undefined },
      { transport: async () => response(200, Buffer.from("not a png"), "text/plain") },
    );
    assert.equal(result.providerMaskAccepted, false);
    assert.equal(result.errorCode, "invalid-response-mime");
  }

  // F) JPEG source + mask válida => localCompositionStatus="pending-source-rgba", nunca "accepted".
  {
    const result = await runPhotoroomCutoutAdapter(
      { ...baseInput(), mimeType: "image/jpeg", originalRgba: undefined },
      { transport: async () => response(200) },
    );
    assert.equal(result.providerMaskAccepted, true);
    assert.equal(result.localCompositionStatus, "pending-source-rgba");
    assert.equal(result.success, false, "success precisa ser false enquanto a composição não roda de verdade");
    assert.equal(result.composition, undefined, "composeProductCutoutRgba nunca é chamado neste caminho");
    assert.ok(result.mask, "a mask real fica disponível mesmo sem composição — para inspeção/composição futura");
  }

  // G) quando o RGBA original é injetado (ex.: source era PNG, ou viria do browser no futuro), o
  // composer + Pixel Gate rodam de verdade e a Fase 2 conclui.
  {
    const result = await runPhotoroomCutoutAdapter(baseInput(), { transport: async () => response(200) });
    assert.equal(result.providerMaskAccepted, true);
    assert.equal(result.localCompositionStatus, "accepted");
    assert.ok(result.composition?.accepted);
  }

  // H) nenhuma garantia falsa quando RGBA não existe: success nunca é true, composition nunca existe,
  // localCompositionStatus nunca é "accepted", mesmo com HTTP 2xx e mask tecnicamente válida.
  {
    const result = await runPhotoroomCutoutAdapter(
      { ...baseInput(), mimeType: "image/jpeg", originalRgba: undefined },
      { transport: async () => response(200) },
    );
    assert.notEqual(result.localCompositionStatus, "accepted");
    assert.equal(result.success, false);
    assert.equal(result.composition, undefined);
  }

  // I) zero retry mesmo no fluxo de duas fases — nenhum cenário acima (JPEG ou PNG) chama o transport
  // mais de uma vez.
  {
    let transportCalls = 0;
    await runPhotoroomCutoutAdapter(
      { ...baseInput(), mimeType: "image/jpeg", originalRgba: undefined },
      { transport: async () => { transportCalls += 1; return response(200); } },
    );
    assert.equal(transportCalls, 1);
  }

  // J) ledger continua correto com o novo formato de input (sourceDimensions + originalRgba opcional)
  // — a entrada gravada tem os mesmos campos de sempre, incluindo os aditivos httpStatus/durationMs.
  {
    const cleanLedger = emptyProductCutoutSmokeLedger();
    const attempt = await runReservedPhotoroomAttempt(
      { ...baseInput(), mimeType: "image/jpeg", originalRgba: undefined, caseId: "ledger-check", file: "fixture.jpeg" },
      cleanLedger,
      { transport: async () => response(200) },
    );
    assert.equal(attempt.ledger.entries.length, 1);
    const entry = attempt.ledger.entries[0];
    assert.equal(entry.provider, "photoroom");
    assert.equal(entry.caseId, "ledger-check");
    assert.equal(entry.httpStatus, 200);
    assert.equal(typeof entry.durationMs, "number");
    assert.equal(entry.success, false, "success reflete que a composição ainda está pendente, não um erro");
  }
}
