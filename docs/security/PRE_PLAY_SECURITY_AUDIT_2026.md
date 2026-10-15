# Pre-Play security audit — 2026-10-10

STATUS=FAIL / GO_NO_GO=NO_GO. This run implements and validates feasible local changes;
it is not a completed final security certification. No production data or paid services used.

## Identity

BASE_SHA=60f6226596d1156785b3a39b62a16580d4beb229
BRANCH=security/revendasmart-final-01
WORKTREE=C:\Users\natan\Documents\Codex\revendasmart-security-final-01
Baseline isolated worktree was clean; HEAD was the exact requested dependency-hardening commit.
No source checkout files were changed. The original checkout is on chore/shared-ai-context;
its initial status query was blocked by access/worktree resolution, so no clean claim is made for it.
Default GitHub branch=main. Remote release=d803fc73b92024370885d45e00d00a144cb39b41,
an ancestor of the local candidate; local release includes newer unpublished hardening.
FINAL_SHA remains BASE_SHA because no commit was authorized before reporting results.
Uncommitted changes must be committed/revalidated before producing a SHA-attested release.

## Completed evidence

- npm ci PASS with TMP/TEMP scoped to worktree; lockfile and tar override unchanged.
- TypeScript PASS. Configured lint PASS with one preexisting unused-variable warning in settings.tsx.
- Targeted changed-file lint PASS. Security regression command PASS: queue confirmation/retry,
  onboarding persistence, auth deadlines/errors/matrix, SCA policy and token encryption.
- npm run test:firebase PASS after configuring local CLI cache/config directories; strict new
  pendingSales cross-account negative test, stock/charge/order transactions and Rules budget PASS.
- Extra emulator suites: onboarding persistence (20 cycles), onboarding route safety, referral,
  deletion, ownership, sorteios, uploads, cancellation, Mercado Pago OAuth and service security PASS.
  Catalog initial transaction failure was followed by a controlled successful retest.
- Play Billing API verification/restoration/RTDN/idempotency mocks PASS, then suite FAIL due
  missing merged release manifest. Do not claim full Play Billing validation.
- zizmor after hardening PASS (zero findings). Gitleaks FAIL; OSV delta PASS; Trivy report and SBOM generated.

## Remaining failures / limitations

Full npm test, security:preflight and security:final fail at the unchanged base release-v1
Ads Pro gating assertion. Security final also reports unresolved Gitleaks detections.
Security-focused source contract tests were updated to verify the strengthened scanner
and actual conflict classifier; no tests were skipped, deleted or weakened to pass.

Build is BLOCKED by Vite realpath EPERM, reproduced with two Node installations;
performance:bundle-check cannot run without a successful build. Android doctor fails on
missing generated web assets; sync blocks on missing approved Firebase client config.
No env/signing/keystore material was copied from the dirty checkout or modified.

Semgrep core cannot create socketpair in this sandbox. CodeQL/Dependency Review/Scorecard
files are prepared but not published/run. MobSF static/dynamic, ZAP, full E2E fault
matrix, final AAB signature/provenance, Play Integrity and Play Console remain NOT_RUN/BLOCKED.

## Reviewed boundaries

113 skills inventoried and seven OWASP candidates reviewed without duplicate imports.
124 literal API registrations inventoried outside Ads Pro. Authentication uses Admin
verifyIdToken(token,true), tenant ownership checks and deletion tombstones. Reviewed
source includes onboarding, API errors, offline leases, sale finalization, catalog ownership,
payment transactions, Rules, Android manifest/bridge/FileProvider and local storage.
Source review plus selected negative tests does not certify every endpoint or native plugin.

Current Android source already disables backup. No blind manifest/entitlement/major-dependency
change was made. Data integrity fixes retain the existing server financial authority.
See USER_FLOW_RISK_MATRIX.md, RS_SEC_FINAL_01_FINDINGS.md, PRE_PLAY_RISK_REGISTER_2026.md,
PRE_PLAY_TOOLCHAIN_2026.md, PRE_PLAY_SUPPLY_CHAIN_2026.md and PRE_PLAY_MASVS_MATRIX_2026.md.
