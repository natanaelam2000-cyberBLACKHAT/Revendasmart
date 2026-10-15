# Security final gate

Canonical local command: `npm run security:final` (Node 24; npm ci first).
Install free official binary tools with `npm run security:tools`, then add
`.tmp/security-tools` to PATH. Install-tools verifies checked-in version-specific SHA256
hashes before extraction; it does not execute downloaded shell installers. Binary/tool
installation is separate from application dependencies. npm ci's lockfile is preserved.

On Windows restricted environments, set TMP and TEMP to an existing worktree `.tmp`
directory, npm_config_cache to `.tmp/npm-cache`, and XDG_CONFIG_HOME to `.tmp/config`.
Semgrep may still be BLOCKED by OS socketpair restrictions; never convert this to PASS.

| Tool/check | Threat/failure detected | Blocking policy | Local reproduction | Artifact |
|---|---|---|---|---|
| skills validator | Unsafe or inconsistent agent guidance/provenance | Any validation error | npm run skills:validate | console summary |
| TypeScript/lint | Invalid contracts/source defects | Error; existing lint warning remains visible | npm run check; npm run lint | console |
| Unit/smoke/security regressions | Auth, state, duplicate-write, queue and crypto regressions | Any failing assertion | npm test; npm run test:security:final | final-results.json |
| Gitleaks 8.30.1 | Credential material in all Git refs/history and non-ignored working files | Any unresolved finding; missing scanner fails | npm run security:gitleaks | sanitized metadata reports |
| OSV 2.6.0 | npm dependency vulnerabilities independently of npm audit | New CVSS >=9 or new unknown severity blocks; HIGH separately reported | npm run security:sca; optional full SECURITY_BASE_SHA | osv-base/head.json, sca-delta.json |
| Trivy 0.75.0 | Independent filesystem/npm vulnerability report | Report initially; OSV critical delta is enforced separately | trivy fs --scanners vuln --skip-dirs .tmp,node_modules,.git --format json --output .tmp/security/trivy.json . | trivy.json |
| Semgrep CE 1.180.0 | JS/TS/Express/Node/React issues and native bridge/logging patterns | ERROR + HIGH confidence blocks; scanner errors also block; other findings report | semgrep scan with p/typescript, p/javascript, p/nodejs, p/react, p/expressjs and scripts/security/semgrep.yml, --metrics off --disable-version-check --strict --json --output .tmp/security/semgrep.json; node scripts/security/semgrep-policy.mjs | sanitized rule/path/severity metadata |
| CodeQL JS/TS | Interprocedural code security issues | GitHub code scanning/ruleset policy; workflow failure blocks when required | GitHub workflow codeql.yml; no application build | GitHub code scanning |
| Dependency Review | Newly introduced vulnerable dependencies in PR diff | New HIGH/CRITICAL; no blanket fail on existing issues | dependency-review.yml on PR | GitHub check |
| zizmor 1.30.1 | Action pins, token scope, credential/cache/expression/workflow hazards | CI HIGH/high-confidence; local full report reviewed | zizmor --offline --no-config .github/workflows/ | local JSON / CI console |
| Scorecard | Repository governance/supply-chain posture | Report initially; manual enforcement recommendation | scorecard.yml on release push/schedule; publish_results=false | scorecard.json |
| Syft 1.54.1 | Inventory of npm application dependencies | Failed generation blocks artifact job | syft scan dir:. --override-default-catalogers javascript-lock-cataloger -o cyclonedx-json=.tmp/security/sbom.cdx.json | CycloneDX CI artifact |
| Firebase emulators | Cross-tenant/privileged field/storage/payment/queue boundary regressions | Any negative test failure | npm run test:firebase, named isolated suites | demo-project test logs |

The canonical runner executes every listed local step even if a previous step fails and
returns nonzero if any step failed. CI-only tools run in a separate job to avoid adding
project dependencies. Raw source snippets/credential-bearing logs are not uploaded;
`sanitize-reports.mjs` emits only Gitleaks/Semgrep location metadata and non-secret dependency/SBOM reports.
Generated SBOM JSON under docs/security/sbom is ignored and copied as a delivery/CI artifact.

OSV compares base/head lockfiles using the same scanner/database run. PR CI passes the
immutable PR base SHA via an environment variable validated as 40 hexadecimal digits.
Local/push fallback baseline is the requested 60f6226 commit, not an arbitrary moving ref.
Every preexisting vulnerability remains visible and still needs triage; baseline matching
is not risk acceptance. npm audit reports supplement independent OSV/Trivy results.

Exceptions require exact finding/paths/versions, evidence of non-applicability, owner,
expiry and compensating controls. Never allowlist real secrets or ignore entire source
files to conceal detections. Broad existing Gitleaks source-file exclusions were removed;
no new false-positive exception was introduced. Do not use npm audit --force or automated
major upgrades. No scanner replaces regression tests or verifies final artifact identity.

GitHub checks are configured locally, not yet executed/enforced. CODEOWNERS alone does
not require review; apply the recommendations in security/GITHUB_HARDENING_RECOMMENDATIONS.md
through an explicit owner-approved repository settings change. Private reporting must be
enabled before the SECURITY.md reporting endpoint can be relied upon.

External/manual prerequisites: build and attest the actual APK/AAB from committed reviewed
changes; merged manifest (debuggable/testOnly/backup/exported/cleartext/permissions), valid
signature and package/version/SDK/hash; local MobSF static/rescan; dynamic MobSF only with
fake accounts and emulators; passive ZAP baseline on localhost/authorized synthetic staging;
Play Integrity and Play Console verification; device process-kill/offline/back/duplicate-tap
matrix. No production pentest, live payment or paid scanner service is permitted.

References: [OSV scan/output](https://google.github.io/osv-scanner/usage/),
[Semgrep CLI](https://docs.semgrep.dev/cli-reference),
[zizmor usage](https://docs.zizmor.sh/usage/),
[Scorecard action](https://github.com/ossf/scorecard-action).
