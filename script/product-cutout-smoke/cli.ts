import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PRODUCT_IMAGE_COORDINATE_SPACE_VERSION } from "../../shared/product-image-coordinate-space";
import { getProductCutoutSmokeCase, PRODUCT_CUTOUT_SMOKE_CASES } from "./cases";
import { runReservedPhotoroomAttempt } from "./attempt";
import {
  PHOTOROOM_CONSERVATIVE_MAX_REQUEST_COST_USD,
  PHOTOROOM_ESTIMATED_REQUEST_COST_USD,
  PRODUCT_CUTOUT_SMOKE_HARD_STOP_USD,
  canReserveProductCutoutAttempt,
  getProductCutoutCommittedSpendUsd,
  readProductCutoutSmokeLedger,
  writeProductCutoutSmokeLedger,
} from "./ledger";
import { PHOTOROOM_MAX_CALLS_PER_RUN, PHOTOROOM_MAX_RETRIES, PHOTOROOM_REMOVE_BACKGROUND_ENDPOINT, type ProductCutoutSourceDimensions } from "./photoroom";
import { decodeSourceRgbaIfPossible } from "./source-decode";

function argumentValue(name: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "") : "";
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const execute = process.argv.includes("--execute");
  if (dryRun === execute) throw new Error("use exatamente um modo: --dry-run ou --execute");

  const caseId = argumentValue("--case");
  const selectedCase = getProductCutoutSmokeCase(caseId);
  if (!selectedCase) throw new Error(`--case precisa ser um de: ${PRODUCT_CUTOUT_SMOKE_CASES.map((entry) => entry.id).join(", ")}`);

  const ledgerPath = resolve("script/product-cutout-smoke/spend-ledger.json");
  const ledger = await readProductCutoutSmokeLedger(ledgerPath);
  const credentialConfigured = Boolean(process.env.PHOTOROOM_API_KEY?.trim());
  const committedSpendUsd = getProductCutoutCommittedSpendUsd(ledger);
  const reservationAllowed = canReserveProductCutoutAttempt(ledger);
  const common = {
    mode: dryRun ? "dry-run" : "execute",
    provider: "photoroom",
    caseId: selectedCase.id,
    file: selectedCase.file,
    credentialStatus: credentialConfigured ? "configured" : "missing",
    estimatedCostUsd: PHOTOROOM_ESTIMATED_REQUEST_COST_USD,
    conservativeMaxCostUsd: PHOTOROOM_CONSERVATIVE_MAX_REQUEST_COST_USD,
    ledgerEntries: ledger.entries.length,
    ledgerCommittedSpendUsd: committedSpendUsd,
    hardStopUsd: PRODUCT_CUTOUT_SMOKE_HARD_STOP_USD,
    budgetRemainingUsd: Math.max(0, PRODUCT_CUTOUT_SMOKE_HARD_STOP_USD - committedSpendUsd),
    reservationAllowed,
    callsMax: PHOTOROOM_MAX_CALLS_PER_RUN,
    retries: PHOTOROOM_MAX_RETRIES,
  };

  if (dryRun) {
    console.log(JSON.stringify({
      ...common,
      sourceMime: selectedCase.mimeType,
      sourceWidth: selectedCase.width,
      sourceHeight: selectedCase.height,
      // PRO-07F.3B-FIX §9: nenhuma decodificação de source acontece antes do provider — a Fase 1
      // (provider/mask) só depende de sourceDimensions (números já conhecidos, sem decode nenhum).
      sourceDecodeRequiredBeforeProvider: false,
      // Informativo: só PNG tem decode local disponível hoje (reaproveita ./png.ts); para os demais
      // formatos (JPEG/WebP — os 3 casos reais A/B/C são JPEG), a Fase 2 fica pending-source-rgba.
      sourceLocalRgbaAvailable: selectedCase.mimeType === "image/png",
      endpoint: PHOTOROOM_REMOVE_BACKGROUND_ENDPOINT,
      alphaOnlyStrategy: "channels=alpha, format=png, size=full, crop=false — RGB do provider é sempre descartado; o composer usa RGB original + alpha do provider",
      networkCall: false,
    }, null, 2));
    return;
  }
  if (!credentialConfigured) throw new Error("PHOTOROOM_API_KEY missing");
  if (!reservationAllowed) throw new Error("cutout smoke hard stop reached");

  const sourceImageBytes = new Uint8Array(await readFile(resolve(selectedCase.file)));
  const sourceAssetId = `cutout-smoke:sha256:${createHash("sha256").update(sourceImageBytes).digest("hex")}`;
  const sourceDimensions: ProductCutoutSourceDimensions = {
    width: selectedCase.width,
    height: selectedCase.height,
    sourceAssetId,
    coordinateSpaceVersion: PRODUCT_IMAGE_COORDINATE_SPACE_VERSION,
  };
  // §1/§6: o SOURCE nunca passa por decodePngToRgba() a não ser que já seja PNG de verdade. Os bytes
  // enviados ao provider (dentro de runReservedPhotoroomAttempt -> transport) são sempre os originais,
  // sem qualquer conversão — decodeSourceRgbaIfPossible só afeta o que fica disponível LOCALMENTE
  // para a Fase 2, nunca o que é enviado pela rede.
  const originalRgba = decodeSourceRgbaIfPossible(sourceImageBytes, selectedCase.mimeType, sourceAssetId);

  const attempt = await runReservedPhotoroomAttempt({
    apiKey: process.env.PHOTOROOM_API_KEY || "",
    sourceImageBytes,
    fileName: basename(selectedCase.file),
    mimeType: selectedCase.mimeType,
    file: selectedCase.file,
    caseId: selectedCase.id,
    sourceDimensions,
    originalRgba,
  }, ledger);
  if (attempt.blockedByHardStop || !attempt.adapter) throw new Error("cutout smoke hard stop reached");
  await writeProductCutoutSmokeLedger(ledgerPath, attempt.ledger);

  const adapter = attempt.adapter;
  const result = {
    ...common,
    success: adapter.success,
    providerMaskAccepted: adapter.providerMaskAccepted,
    localCompositionStatus: adapter.localCompositionStatus,
    httpStatus: adapter.httpStatus,
    httpOutcome: adapter.httpOutcome,
    durationMs: adapter.durationMs ?? null,
    potentiallyBilled: adapter.potentiallyBilled,
    errorCode: adapter.errorCode || null,
    mask: adapter.mask ? { width: adapter.mask.width, height: adapter.mask.height, byteLength: adapter.mask.data.length } : null,
  };

  // §5: artefatos só quando a mask do provider foi tecnicamente aceita (HTTP/MIME/assinatura/
  // dimensões/alpha-buffer/identidade) — nunca para uma resposta rejeitada, e nunca a API key.
  let artifactsDir: string | null = null;
  if (adapter.providerMaskAccepted && adapter.mask && adapter.rawMaskPngBytes) {
    const runId = new Date().toISOString().replace(/[:.]/g, "-");
    artifactsDir = join(".tmp", "product-cutout-smoke", runId, selectedCase.id);
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(join(artifactsDir, "mask.png"), adapter.rawMaskPngBytes);
    await writeFile(join(artifactsDir, "result.json"), JSON.stringify({
      provider: "photoroom",
      case: selectedCase.id,
      sourceMime: selectedCase.mimeType,
      sourceWidth: selectedCase.width,
      sourceHeight: selectedCase.height,
      maskWidth: adapter.mask.width,
      maskHeight: adapter.mask.height,
      httpStatus: adapter.httpStatus,
      durationMs: adapter.durationMs ?? null,
      costReservationUsd: PHOTOROOM_CONSERVATIVE_MAX_REQUEST_COST_USD,
      providerMaskAccepted: adapter.providerMaskAccepted,
      localCompositionStatus: adapter.localCompositionStatus,
    }, null, 2));
  }

  console.log(JSON.stringify({ ...result, artifactsDir }, null, 2));
  if (!adapter.providerMaskAccepted) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "product-cutout-smoke-failed");
  process.exitCode = 1;
});
