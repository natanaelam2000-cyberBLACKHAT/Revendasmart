import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = process.cwd();
const policyPath = resolve(repoRoot, "client/public/privacy-policy.md");
const termsPath = resolve(repoRoot, "client/public/terms-of-service.md");
const matrixPath = resolve(repoRoot, "docs/PLAY_DATA_SAFETY_MATRIX.md");

assert.ok(existsSync(policyPath), "a Privacy Policy pública precisa existir");
assert.ok(existsSync(termsPath), "os Termos públicos precisam existir");
assert.ok(existsSync(matrixPath), "a matriz preparatória de Data Safety precisa existir");

const policy = readFileSync(policyPath, "utf8");
const terms = readFileSync(termsPath, "utf8");
const matrix = readFileSync(matrixPath, "utf8");
const supportEmail = "revendasmart.suporte@gmail.com";
const privacyUrl = "https://revendasmart.vercel.app/privacy-policy";
const termsUrl = "https://revendasmart.vercel.app/terms-of-service";
const deletionUrl = "https://revendasmart.vercel.app/account-deletion";

for (const [label, document] of [["Privacy Policy", policy], ["Termos", terms]] as const) {
  assert.match(document, new RegExp(supportEmail.replace(".", "\\.")), `${label}: contato real ausente`);
  assert.doesNotMatch(document, /\[\s*support@/i, `${label}: placeholder de contato reapareceu`);
}

assert.match(policy, new RegExp(privacyUrl.replaceAll(".", "\\.")), "Privacy Policy: URL canônica da política ausente");
assert.match(policy, new RegExp(termsUrl.replaceAll(".", "\\.")), "Privacy Policy: URL canônica dos termos ausente");
assert.match(policy, new RegExp(deletionUrl.replaceAll(".", "\\.")), "Privacy Policy: URL externa de exclusão ausente");
assert.match(terms, /\/account-deletion/, "Termos: fluxo atual de exclusão ausente");
assert.match(terms, /Google Play/i, "Termos: assinatura Android via Google Play ausente");

const forbiddenLegacyClaims: ReadonlyArray<[RegExp, string]> = [
  [/\bbcrypt\b/i, "algoritmo de hash de senha não demonstrado"],
  [/TLS\s*1\.3\+?/i, "versão fixa de TLS não demonstrada"],
  [/Fornecedor:\s*Replit/i, "fornecedor antigo"],
  [/telemetria\s*\(\s*opcional\s*\)/i, "telemetria não é opcional no runtime atual"],
  [/optar por não receber telemetria/i, "opt-out inexistente"],
  [/permanentemente deletados? em até 30 dias/i, "prazo de exclusão inexistente"],
];

for (const [pattern, description] of forbiddenLegacyClaims) {
  assert.doesNotMatch(policy, pattern, `Privacy Policy: claim legado reapareceu (${description})`);
}
assert.doesNotMatch(terms, /permanentemente deletados? em até 30 dias/i, "Termos: prazo legado de exclusão reapareceu");
assert.doesNotMatch(policy, /tenta gravar .*Firebase Realtime Database/i, "Privacy Policy: RTDB legado reapareceu");

for (const heading of [
  "DATA TYPE",
  "COLLECTED?",
  "SHARED?",
  "PURPOSE",
  "OPTIONAL?",
  "ENCRYPTED IN TRANSIT?",
  "USER CAN DELETE?",
  "PROCESSOR",
  "EVIDENCE",
]) {
  assert.ok(matrix.includes(heading), `matriz: coluna obrigatória ausente (${heading})`);
}

// REVENDASMART-LGPD-ANPD-REMEDIATION-01, Fase 13: Photoroom corrigido de SMOKE_ONLY para IMPLEMENTED —
// a classificação anterior estava desatualizada (a rota real já está em produção, ver
// server/product-cutout-photoroom.ts). Gemini virou dois caminhos separados (geração de fundo e
// inspeção visual), ambos FEATURE_FLAGGED — código pronto e credencial presente, só falta a flag de
// ambiente, então "SMOKE_ONLY" (só script local) deixou de ser uma descrição precisa.
for (const [provider, status] of [
  ["Photoroom", "IMPLEMENTED"],
  ["Gemini / Google AI — geração de fundo (Marketing Pro)", "FEATURE_FLAGGED"],
  ["Gemini / Google AI — inspeção visual de produto", "FEATURE_FLAGGED"],
  ["OpenAI", "SMOKE_ONLY"],
  ["Black Forest Labs (BFL)", "SMOKE_ONLY"],
  ["Marketing Pro — provider determinístico local", "IMPLEMENTED"],
] as const) {
  const row = matrix.split("\n").find((line) => line.includes(provider));
  assert.ok(row, `matriz: provider conhecido ausente (${provider})`);
  assert.ok(row.includes(status), `matriz: status incorreto para ${provider}; esperado ${status}`);
}

for (const processor of [
  "Firebase Authentication",
  "Firestore",
  "Firebase Cloud Storage",
  "Firebase Analytics",
  "Firebase Performance",
  "Sentry",
  "Mercado Pago",
  "Google Play Billing",
]) {
  assert.ok(matrix.includes(processor), `matriz: processor/dataset conhecido ausente (${processor})`);
}

assert.match(matrix, /PLAY_CONSOLE_DECISION_REQUIRED/, "matriz deve preservar decisões do Play Console como pendentes");
assert.match(matrix, /PRIVACY_POLICY_CANONICAL_URL:\*\* `https:\/\/revendasmart\.vercel\.app\/privacy-policy`/, "matriz deve registrar a URL canônica da política");
assert.match(matrix, /TERMS_CANONICAL_URL:\*\* `https:\/\/revendasmart\.vercel\.app\/terms-of-service`/, "matriz deve registrar a URL canônica dos termos");
assert.match(matrix, /ACCOUNT_DELETION_CANONICAL_URL:\*\* `https:\/\/revendasmart\.vercel\.app\/account-deletion`/, "matriz deve registrar a URL canônica de exclusão");
assert.match(matrix, /PRODUCTION_LEGAL_URLS_STATUS:\*\* `PENDING_EXTERNAL_VERIFICATION`/, "matriz deve refletir pendência de verificação pública, não um bug local forçado");
assert.match(matrix, /PLAY_CONSOLE_SUBMISSION_STATUS:\*\* `NOT_READY`/, "matriz não pode indicar submissão pronta enquanto decisões permanecem abertas");

console.log("Privacy documentation guardrails passed.");
