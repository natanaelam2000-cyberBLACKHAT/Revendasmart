# RS-SEC-FINAL-01 findings

Audited base: 60f6226596d1156785b3a39b62a16580d4beb229. Changes are uncommitted in
security/revendasmart-final-01. No release approval is issued. Tests below use synthetic
identities and localhost/demo Firebase emulators. Ads Pro application code is unchanged.

## Confirmed and corrected

| ID | SEVERITY | CATEGORY/FLOW | SCENARIO | EXPECTED | ACTUAL / ROOT_CAUSE | FILE / FIX | TEST_ADDED / RETEST | STATUS |
|---|---|---|---|---|---|---|---|---|
| RS-01 | HIGH (data integrity) | DATA_INTEGRITY/OFFLINE | HTTP 200 HTML, empty body or wrong sale ID | Retain queue until matching sale acknowledgement | Old sync treated any response.ok as synced, enabling settlement to delete the pending document | pending-sale-response.ts + offline-sales-queue.ts; require matching saleId | pending-sale-response-tests.mjs; old SHA reproduced invalid 200 as synced; after PASS | FIXED |
| RS-02 | MEDIUM | RELIABILITY/OFFLINE | 408/429/500/502/503/504 | Bounded retry with original stable saleId | Old HTTP branch returned permanent failed, unlike network exceptions | classifier returns retry; existing lease/attempt budget/backoff retained | Old 503 reproduced as failed; response tests PASS | FIXED |
| RS-03 | HIGH (essential-flow availability) | AUTH/USER_ERROR | Token refresh/bootstrap never settles | Deadline, release action lock, preserve choices, no late POST | AbortController timer covered fetch but did not settle awaited auth Promise | abortable.ts, api-client.ts, onboarding-persistence.ts; bounded auth work, observe late resolution/rejection | security-auth-timeout-tests.ts failed before with STUCK; after PASS, no late POST and retry works | FIXED |
| RS-04 | MEDIUM | RELIABILITY/ONBOARDING | success=true with settings array/empty or wrong businessMode | Confirm persisted mode before clearing draft | Existing confirmation only required a truthy settings value, and checked completion=true when requested | Validate settings object and echoed businessMode; retain draft on inconsistent acknowledgement | security-onboarding-matrix-tests.ts: eight invalid responses rejected; PASS | FIXED |
| RS-05 | LOW | USER_ERROR/ONBOARDING | 401/403/409/422/429 | Actionable session/permission/validation/conflict/rate-limit message | All statuses fell into a connection-oriented generic message | onboarding-error.ts central classification, no internal text | security-auth-timeout-tests.ts message matrix PASS | FIXED |
| RS-06 | LOW | RELIABILITY/SECURITY TOOLING | Windows CRLF skill checkout | Same validation as Linux LF | Validator required literal ---\n and misclassified 113 skills | Normalize CRLF while reading, retain all validation requirements | skills:validate initially FAIL; after PASS 113 skills | FIXED |

RS-01/03 HIGH labels describe the demonstrated impact within an essential flow; no
financial exploitation or attacker-controlled auth deadlock was proven. RS-01 preserves
server-authoritative financial behavior; server stock/charge transactions were not changed.
Unit tests do not prove device/process-kill UX or every browser navigation edge case.

## Unresolved / external blockers

| ID | Severity/confidence/source | Evidence / impact | Decision / test / retest / status |
|---|---|---|---|
| RS-HIST-01 | UNTRIAGED; Gitleaks | 43 history detections and 21 working-tree detections; includes historical env.yaml/env.yamlx and private-key/token patterns | Do not authenticate, suppress or rewrite history. Validity UNKNOWN. Owner must establish rotation or prove individual false positives. FAIL gate |
| RS-SCA-01 | Scanner HIGH; exploitability NOT_PROVEN | OSV 45 preexisting HIGH package/advisory groups, npm production 4 propagated HIGH entries, Trivy @grpc/grpc-js HIGH | Existing critical hardening preserved; no new critical/high dependency delta. Individual reachability/compatibility review remains required, not accepted implicitly |
| RS-TEST-01 | INFO; reproducible preexisting test failure | release-v1-gating-tests.ts expects showProTab=isProAdsAdmin; current base uses canUseAdsPro. Both files unchanged | Baseline reproduction fails at the same assertion. Ads Pro OUT_OF_SCOPE; npm test/preflight/final remain FAIL |
| RS-CAT-01 | UNCONFIRMED/intermittent | Catalog uniqueness initially 200/500, expected 200/409; Firestore emulator transaction invalid/closed | Controlled emulator retest PASS including uniqueness/ownership/mass assignment. Retain initial evidence, no speculative transaction change |
| RS-BUILD-01 | BLOCKED/environment | Vite realpath main.tsx EPERM under both installed and bundled Node | No product changes to bypass sandbox. Build/bundle check not validated |
| RS-PLAY-01 | BLOCKED/artifact | Play Billing mocked API tests pass; merged release manifest missing, suite exit 1 | Need verified release build; no fabricated manifest or weakened test |
| RS-CI-01 | BLOCKED/unpublished | CodeQL/Dependency Review/Scorecard configured locally, no workflow run for final changes | No push/PR/admin change authorized; execute on real candidate later |
| RS-SAST-01 | BLOCKED/environment | Semgrep CE core socketpair denied by sandbox, CLI/direct attempts unsuccessful | No Semgrep PASS claim; CI configuration remains unexecuted |
| RS-MOBILE-01 | BLOCKED/manual validation | No final APK/AAB, MobSF/static/dynamic, ZAP or Play Console/Integrity evidence | NO_GO until required artifact and external gates are validated |

The signed release must correspond to a commit containing the reviewed changes. Current
HEAD alone does not identify the uncommitted patch. No final AAB hash exists.
