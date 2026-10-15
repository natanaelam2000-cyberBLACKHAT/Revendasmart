import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * RELEASE-AUTOMATION-01 — um único comando determinístico que responde "o candidato atual está
 * tecnicamente pronto para virar um release assinado?", sem nunca precisar do Play Console, do keystore
 * de release, ou de um device físico (esses continuam manuais/deferidos por design — ver
 * docs/ANDROID_RELEASE_SIGNING.md). Nunca imprime segredo algum: as 4 variáveis de assinatura de release
 * são checadas só por PRESENÇA (nome, nunca valor), exatamente como android/app/build.gradle já faz.
 *
 * Uso:
 *   npm run release:preflight
 *   npm run release:preflight -- --skip-android     (sem Android SDK/Gradle disponível)
 *   npm run release:preflight -- --skip-billing      (sem Firebase emulator disponível/lento)
 *
 * Saída: uma tabela final PASS/FAIL/SKIP por etapa, e exit code 1 se qualquer etapa OBRIGATÓRIA falhar.
 * "SIGNED_AAB"/assinatura nunca é uma etapa obrigatória — ausência de credenciais de assinatura é
 * SKIP, não FAIL (ver Seção 12 do processo de release — nunca inventar/exigir credenciais aqui).
 */

const args = new Set(process.argv.slice(2));
const skipAndroid = args.has("--skip-android");
const skipBilling = args.has("--skip-billing");

type StepStatus = "PASS" | "FAIL" | "SKIP" | "WARN";
type StepResult = { name: string; status: StepStatus; detail?: string; requiredForPass: boolean };

const results: StepResult[] = [];

function run(cmd: string, opts: { cwd?: string; timeoutMs?: number } = {}): { ok: boolean; output: string } {
  try {
    const output = execSync(cmd, {
      cwd: opts.cwd ?? process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: opts.timeoutMs ?? 10 * 60 * 1000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, output };
  } catch (error: any) {
    const output = [error?.stdout, error?.stderr].filter(Boolean).join("\n") || String(error?.message ?? error);
    return { ok: false, output };
  }
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function record(name: string, status: StepStatus, detail: string | undefined, requiredForPass: boolean): void {
  results.push({ name, status, detail, requiredForPass });
  const icon = status === "PASS" ? "✓" : status === "SKIP" ? "○" : status === "WARN" ? "!" : "✗";
  console.log(`${icon} ${name}: ${status}${detail ? ` — ${detail}` : ""}`);
}

// ---------------------------------------------------------------------------
// 1. Provenance — branch/HEAD/dirty worktree. Dirty is reported, never a hard stop here: the operator
// may legitimately be mid-change when running this locally. It's on the final table either way.
// ---------------------------------------------------------------------------
section("1. Provenance");
let branch = "unknown";
let head = "unknown";
let dirty = true;
try {
  branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
  head = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  const status = execSync("git status --porcelain=v1", { encoding: "utf8" }).trim();
  dirty = status.length > 0;
  console.log(`branch=${branch}`);
  console.log(`HEAD=${head}`);
  console.log(`worktree=${dirty ? "DIRTY" : "clean"}`);
  if (dirty) console.log(status);
  record("git-provenance", "PASS", `branch=${branch} dirty=${dirty}`, true);
} catch (error: any) {
  record("git-provenance", "FAIL", String(error?.message ?? error), true);
}

// ---------------------------------------------------------------------------
// 2. Typecheck / tests / build / bundle budget — the canonical web gates, run exactly as CLAUDE.md
// documents them.
// ---------------------------------------------------------------------------
section("2. TypeScript check");
{
  const r = run("npm run check");
  record("typecheck", r.ok ? "PASS" : "FAIL", r.ok ? undefined : r.output.slice(-2000), true);
}

section("3. Full test suite");
{
  const r = run("npm test", { timeoutMs: 15 * 60 * 1000 });
  record("full-tests", r.ok ? "PASS" : "FAIL", r.ok ? undefined : r.output.slice(-2000), true);
}

section("4. Production web build");
{
  const r = run("npm run build", { timeoutMs: 10 * 60 * 1000 });
  record("web-build", r.ok ? "PASS" : "FAIL", r.ok ? undefined : r.output.slice(-2000), true);
}

section("5. Bundle / performance budget");
{
  const r = run("npm run performance:bundle-check");
  record("bundle-budget", r.ok ? "PASS" : "FAIL", r.ok ? undefined : r.output.slice(-2000), true);
}

// ---------------------------------------------------------------------------
// 6. Localhost/dev leakage scan — the built client bundle must never ship a hardcoded localhost/dev
// server URL or an obvious demo Firebase key baked into a production artifact.
// ---------------------------------------------------------------------------
section("6. Localhost/dev leakage scan (built assets)");
{
  const distDir = path.join(process.cwd(), "dist", "public", "assets");
  if (!existsSync(distDir)) {
    record("dev-leakage-scan", "SKIP", "dist/public/assets missing — build step above did not produce output", true);
  } else {
    const offenders: string[] = [];
    const suspiciousPatterns = [/localhost:\d+/i, /127\.0\.0\.1:\d+/, /demo-api-key/i, /VITE_USE_FIREBASE_EMULATORS/];
    for (const file of readdirSync(distDir)) {
      if (!file.endsWith(".js")) continue;
      const contents = readFileSync(path.join(distDir, file), "utf8");
      for (const pattern of suspiciousPatterns) {
        if (pattern.test(contents)) {
          offenders.push(`${file} matches ${pattern}`);
          break;
        }
      }
    }
    record("dev-leakage-scan", offenders.length === 0 ? "PASS" : "FAIL", offenders.length ? offenders.join("; ") : undefined, true);
  }
}

// ---------------------------------------------------------------------------
// 7. Capacitor sync + Android identity/SDK values (source-of-truth files, no build needed for this part)
// ---------------------------------------------------------------------------
section("7. Android identity (source)");
{
  try {
    const buildGradle = readFileSync(path.join(process.cwd(), "android", "app", "build.gradle"), "utf8");
    const variablesGradle = readFileSync(path.join(process.cwd(), "android", "variables.gradle"), "utf8");
    const versionProps = readFileSync(path.join(process.cwd(), "android", "version.properties"), "utf8");
    const applicationId = /applicationId\s+"([^"]+)"/.exec(buildGradle)?.[1];
    const namespace = /namespace\s*=\s*"([^"]+)"/.exec(buildGradle)?.[1];
    const versionCode = /androidVersionCode=(\d+)/.exec(versionProps)?.[1];
    const versionName = /androidVersionName=([^\s]+)/.exec(versionProps)?.[1];
    const compileSdk = /compileSdkVersion\s*=\s*(\d+)/.exec(variablesGradle)?.[1];
    const targetSdk = /targetSdkVersion\s*=\s*(\d+)/.exec(variablesGradle)?.[1];
    const minSdk = /minSdkVersion\s*=\s*(\d+)/.exec(variablesGradle)?.[1];
    const summary = `applicationId=${applicationId} namespace=${namespace} versionCode=${versionCode} versionName=${versionName} minSdk=${minSdk} compileSdk=${compileSdk} targetSdk=${targetSdk}`;
    console.log(summary);
    const identityOk = Boolean(applicationId && namespace === applicationId && versionCode && versionName && compileSdk && targetSdk && minSdk);
    record("android-identity", identityOk ? "PASS" : "FAIL", identityOk ? summary : `could not resolve all fields: ${summary}`, !skipAndroid);
  } catch (error: any) {
    record("android-identity", skipAndroid ? "SKIP" : "FAIL", String(error?.message ?? error), !skipAndroid);
  }
}

section("8. Android manifest sanity (source)");
{
  try {
    const manifest = readFileSync(path.join(process.cwd(), "android", "app", "src", "main", "AndroidManifest.xml"), "utf8");
    const hasCleartext = /usesCleartextTraffic\s*=\s*"true"/.test(manifest);
    const hasBilling = /com\.android\.vending\.BILLING/.test(manifest);
    const hasInternet = /android\.permission\.INTERNET/.test(manifest);
    const problems: string[] = [];
    if (hasCleartext) problems.push("usesCleartextTraffic=true is set (should not be, targetSdk blocks cleartext by default)");
    if (!hasBilling) problems.push("com.android.vending.BILLING permission missing");
    if (!hasInternet) problems.push("INTERNET permission missing");
    record("android-manifest-sanity", problems.length === 0 ? "PASS" : "FAIL", problems.join("; ") || undefined, !skipAndroid);
  } catch (error: any) {
    record("android-manifest-sanity", skipAndroid ? "SKIP" : "FAIL", String(error?.message ?? error), !skipAndroid);
  }
}

if (skipAndroid) {
  record("capacitor-sync", "SKIP", "--skip-android", false);
  record("android-bundle-debug", "SKIP", "--skip-android", false);
} else if (!existsSync(path.join(process.cwd(), "android"))) {
  record("capacitor-sync", "SKIP", "android/ directory not present in this checkout", false);
  record("android-bundle-debug", "SKIP", "android/ directory not present in this checkout", false);
} else {
  section("9. Capacitor Android sync");
  const syncResult = run("npx cap sync android", { timeoutMs: 5 * 60 * 1000 });
  record("capacitor-sync", syncResult.ok ? "PASS" : "FAIL", syncResult.ok ? undefined : syncResult.output.slice(-2000), true);

  section("10. Android debug bundle (compile-only — never touches release signing)");
  const androidCwd = path.join(process.cwd(), "android");
  // A bare `gradlew.bat` is not found by cmd.exe (Node's default shell for execSync on Windows) without
  // an explicit `.\` prefix, even with the right cwd — cmd.exe doesn't search the current directory.
  const gradlewCmd = process.platform === "win32" ? ".\\gradlew.bat" : "./gradlew";
  const gradlewOpts = { cwd: androidCwd, timeoutMs: 10 * 60 * 1000 };
  const bundleResult = run(`${gradlewCmd} bundleDebug`, gradlewOpts);
  record("android-bundle-debug", bundleResult.ok ? "PASS" : "FAIL", bundleResult.ok ? undefined : bundleResult.output.slice(-2000), true);

  // Confirms the fail-closed signing guard is intact WITHOUT ever supplying/inventing credentials —
  // bundleRelease is expected to FAIL fast here; that failure IS the passing condition for this check.
  section("11. Release-signing fail-closed guard (expected to refuse — never supplies credentials)");
  const hasSigningEnv = Boolean(
    process.env.REVENDASMART_KEYSTORE_PATH &&
    process.env.REVENDASMART_KEYSTORE_PASSWORD &&
    process.env.REVENDASMART_KEY_ALIAS &&
    process.env.REVENDASMART_KEY_PASSWORD,
  );
  if (hasSigningEnv) {
    record("release-signing-guard", "SKIP", "signing env vars are present in this environment — not this script's job to build/verify a signed AAB", false);
  } else {
    const releaseAttempt = run(`${gradlewCmd} bundleRelease`, { ...gradlewOpts, timeoutMs: 60 * 1000 });
    const refusedForSigningReason = !releaseAttempt.ok && /vari.{1,3}veis de ambiente ausentes|REVENDASMART_KEYSTORE_PATH/i.test(releaseAttempt.output);
    record(
      "release-signing-guard",
      refusedForSigningReason ? "PASS" : "WARN",
      refusedForSigningReason
        ? "bundleRelease correctly refused without inventing/using debug-signing fallback"
        : "unexpected bundleRelease outcome — inspect manually, this script never supplies signing credentials",
      false,
    );
  }
}

// ---------------------------------------------------------------------------
// 12. Play Billing contract tests (Firebase emulator, mocked Google Play API — zero real Google call)
// ---------------------------------------------------------------------------
section("12. Play Billing contract tests");
if (skipBilling) {
  record("play-billing-tests", "SKIP", "--skip-billing", false);
} else {
  const cacheDir = process.platform === "win32" ? path.join(process.cwd(), ".tmp", "npm-cache") : "/tmp/revendasmart-npm-cache";
  const cmd = `npx --yes firebase-tools@15.24.0 emulators:exec --project demo-revendasmart --only auth,firestore "npx tsx script/play-billing-tests.ts"`;
  const r = run(cmd, {
    timeoutMs: 5 * 60 * 1000,
    cwd: process.cwd(),
  });
  // The manifest-permission assertion inside play-billing-tests.ts needs a prior Gradle merge; treat
  // that specific, already-understood ENOENT as non-fatal to this step when Android wasn't built above.
  const onlyManifestGap = !r.ok && /merged_manifest.*release.*AndroidManifest\.xml/i.test(r.output) && /Play Billing tests passed/.test(r.output);
  if (r.ok) {
    record("play-billing-tests", "PASS", undefined, true);
  } else if (onlyManifestGap) {
    record("play-billing-tests", "WARN", "business-logic assertions passed; release-manifest permission check skipped (no prior Android release build in this run)", false);
  } else {
    record("play-billing-tests", "FAIL", r.output.slice(-2000), true);
  }
  void cacheDir;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
section("SUMMARY");
const width = Math.max(...results.map((r) => r.name.length)) + 2;
for (const r of results) {
  console.log(`${r.name.padEnd(width)} ${r.status}${r.requiredForPass ? "" : " (optional)"}`);
}

const hardFailures = results.filter((r) => r.requiredForPass && r.status === "FAIL");
if (hardFailures.length > 0) {
  console.log(`\nRELEASE_PREFLIGHT = FAIL — ${hardFailures.length} required step(s) failed: ${hardFailures.map((r) => r.name).join(", ")}`);
  process.exit(1);
} else {
  console.log("\nRELEASE_PREFLIGHT = PASS — all required automated checks are green. Signing/Play Console/device testing remain manual by design.");
  process.exit(0);
}
