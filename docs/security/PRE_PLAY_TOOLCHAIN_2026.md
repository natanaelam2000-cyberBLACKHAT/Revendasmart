# Toolchain and execution evidence — 2026-10-10

Base: `60f6226596d1156785b3a39b62a16580d4beb229`. Isolated branch: `security/revendasmart-final-01`.
Node baseline v24.15.0; npm 11.12.1; Java 21.0.10. npm ci completed with
TMP/TEMP inside `.tmp/` after initial sandbox EPERM failures. No dependency versions
or lockfile overrides were changed. Versions and upstream SHA256 checksums are in
`scripts/security/tool-versions.json`; official Actions commit pins were resolved
with `git ls-remote` against their upstream repositories.

| Tool | Version | Evidence / result | Control type |
|---|---|---|---|
| Gitleaks | 8.30.1 | Executed history (`--all`) and working snapshot; FAIL, unresolved detections | LOCAL_SCRIPT / CI gate configured |
| OSV-Scanner | 2.6.0 | Executed base/head lockfiles; delta critical=0/high=0 | LOCAL_SCRIPT / CI gate configured |
| Trivy | 0.75.0 | Executed filesystem vulnerability scan: 1 high, 3 medium, 1 low | LOCAL scan / CI report configured |
| Syft | 1.54.1 | Executed; CycloneDX 1.7 with 521 components | LOCAL artifact / CI artifact configured |
| zizmor | 1.30.1 | Before: mutable actions/credentials; after: zero findings, exit 0 | LOCAL / CI gate configured |
| Semgrep CE | 1.180.0 | BLOCKED: semgrep-core `socketpair` denied by Windows sandbox | CI gate configured, NOT executed |
| CodeQL | action v3.29.9 | BLOCKED: workflow prepared locally; no push/PR authorized | CI_CHECK configured, NOT active evidence |
| Dependency Review | action v4.7.1 | BLOCKED: no PR comparing this unpublished branch | CI_CHECK configured |
| Scorecard | action v2.4.3 | BLOCKED: workflow not published/executed; no local runtime | CI report configured |
| Firebase | CLI 15.24.0 | Demo-project emulators; per-suite results in audit | LOCAL_TEST |
| MobSF static/dynamic | NOT_RUN | No APK/AAB built from final changes; Docker/runtime not available | Manual release gate |
| ZAP | NOT_RUN | No completed runnable web build/passive scan | Manual release gate |

A workflow file is not proof that a GitHub check ran or that a ruleset requires it.
All new CI files remain unpublished. Public API inspection returned main as default,
release remote SHA `d803fc73b92024370885d45e00d00a144cb39b41`, protected=false, and zero visible
rulesets. The remote SHA is an ancestor of the requested local base; release identity
must name the local audited changes explicitly before an AAB can be approved.

No attacks on production, live payments, external APK uploads, paid API calls, pushes,
merges, commits, or administrative GitHub changes were performed.
