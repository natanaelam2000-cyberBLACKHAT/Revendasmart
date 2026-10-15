# Trivy final triage — 2026-10-10

Filesystem scan: Trivy 0.75.0, vulnerability scanner, CycloneDX/npm lockfile
workspace. No secrets or licenses were reported by this result. The four package
findings below are distinct CVEs, but each is also present in the current OSV
report; none is a second independent vulnerability count.

| Severity | ID | Package | Installed | Fixed | Direct/transitive | Runtime/dev | Reachable | npm audit | OSV | Decision |
|---|---|---|---|---|---|---|---|---|---|---|
| HIGH | CVE-2026-101916 | @grpc/grpc-js | 1.9.16 | 1.13.6 or 1.14.5 | transitive via firebase client | runtime dependency tree | not assessed | not present by CVE ID | present | REVIEW_REQUIRED; no blind upgrade |
| MEDIUM | CVE-2026-82417 | qs | 6.15.2 | 6.16.0 | transitive via express/body-parser | runtime | not assessed | not present by CVE ID | present | REVIEW_REQUIRED; compatible fix requires dependency validation |
| MEDIUM | CVE-2026-82562 | qs | 6.15.2 | 6.16.0 | transitive via express/body-parser | runtime | not assessed | not present by CVE ID | present | REVIEW_REQUIRED; same installed component as above |
| MEDIUM | CVE-2026-41907 | uuid | 9.0.1 | 11.1.1, 12.0.1 or 13.0.1 | transitive via Firebase Admin/Google Cloud | runtime dependency tree | not assessed | not present by CVE ID | present | REVIEW_REQUIRED; major-version fix, no blind upgrade |

Additional Trivy output contained one LOW `@grpc/grpc-js` finding. It is recorded in
the machine report and is not a HIGH/MEDIUM release gate here. Trivy did not prove
reachability. The application uses Firebase/Google Cloud packages at runtime, so
the findings cannot be dismissed as dev-only without a dependency graph and code
path review.

`TRIVY_HIGH_UNIQUE_NEW=0` and `TRIVY_MEDIUM_UNIQUE_NEW=0` mean no finding was unique
to Trivy relative to OSV. They do not mean the packages are safe or that the OSV
findings are resolved. A compatible dependency update requires a separate change,
full tests, emulator tests and a rescan; this round intentionally did not run
`npm audit fix --force`, major upgrades, overrides or downgrades.
