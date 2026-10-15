# Release risk register

| Risk | Evidence | Owner / next action | Release disposition |
|---|---|---|---|
| Historical credential material | Redacted Gitleaks findings, including historical environment files | Repository owner: confidential rotation/revocation evidence and per-finding triage; follow SECURITY_PROVIDER_ROTATION_RUNBOOK.md | BLOCKED; no risk acceptance fabricated |
| Residual HIGH dependencies | Independent npm/OSV/Trivy reports | Repository owner: assess transitive paths, exploit prerequisites and safe compatible versions | REVIEW_REQUIRED |
| Full regression failure | Original release gating assertion conflicts with current Ads Pro behavior | Separate authorized Ads Pro maintenance task; preserve this task's scope | FAIL |
| Incomplete scanner coverage | Semgrep socketpair blocked; CI CodeQL/review/Scorecard not executed | Run prepared workflows on an authorized published candidate | BLOCKED |
| Missing build/Android provenance | Vite EPERM; sync missing six Firebase config values; no merged manifest | Build in a permitted environment using approved public client config and existing secure signing setup | BLOCKED |
| External mobile/DAST checks | No final APK/AAB, MobSF or ZAP results | Local MobSF static; dynamic only fake accounts/emulators; ZAP passive/baseline against localhost | BLOCKED |
| GitHub governance not enforced | Public API release protected=false, visible rulesets=[] | Owner applies reviewed ruleset and private reporting settings explicitly | MANUAL |
| Complete UX fault matrix not run | Unit/emulator tests cover core recovery, not every UI/device scenario | Controlled UI tests for double taps, back/navigation, process kill, real offline/reconnect and empty forms | NOT_RUN; no global certification |

Exception policy: each exception names finding ID, exact affected versions/paths, evidence,
owner, expiry and compensating control. No real credential allowlist, broad scanner ignore,
major upgrade without validation or production attack is permitted. Preexisting does not
mean accepted. No exception or external risk acceptance was granted in this run.
