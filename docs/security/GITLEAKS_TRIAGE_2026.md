# Gitleaks triage — 2026-10-10

This triage intentionally records metadata only. Secret values were never printed,
tested, sent to a service, or used for authentication. The scanner reported 43
history findings and 21 working-tree findings in the latest run. Findings below are
grouped by rule/file/commit/fingerprint metadata; validity remains UNKNOWN until the
repository owner verifies rotation or proves a fixture/example.

| ID | RULE | SECRET_TYPE | FILE | COMMIT | PRESENT_IN_HEAD | HISTORY_ONLY | LIKELY_REAL_SECRET | TEST_FIXTURE | EXAMPLE_VALUE | FALSE_POSITIVE | ROTATION_STATUS | ACTION | RELEASE_BLOCKER |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GL-HIST-ALL | firebase-admin-private-key, private-key, gcp-service-account-json-key, mercado-pago-token, gcp-api-key, generic-api-key, curl-auth-header | cloud/payment/auth material | historical files listed in sanitized artifact | multiple historical commits | UNKNOWN | YES for history-only rows | UNKNOWN | UNKNOWN | NOT_RECORDED | UNKNOWN | UNKNOWN | Owner must inspect source history and revoke/rotate any real credential; classify fixtures individually | YES |
| GL-HEAD-ALL | firebase-admin-private-key, gcp-api-key, generic-api-key, mercado-pago-token, curl-auth-header | cloud/payment/auth material | files listed in sanitized working-tree artifact | current candidate commits | UNKNOWN | NO | UNKNOWN | UNKNOWN | NOT_RECORDED | UNKNOWN | UNKNOWN | Owner must inspect current files and remove/revoke any real credential without touching signing material blindly | YES |

## Evidence and classification policy

The sanitized artifacts `gitleaks-history.json` and `gitleaks-working-tree.json`
contain only RuleID, file, line, commit, fingerprint and `validity=UNKNOWN`.
The raw detector counts were 43 history and 21 working-tree findings; the working
tree findings are not automatically 21 unique secrets. A precise unique count is
deferred until the owner can inspect the underlying values in a controlled local
review. This report does not claim FALSE_POSITIVE, KNOWN_ROTATED, or
ROTATION_REQUIRED without evidence.

`SECRET_LEAK_ACTIVE=BLOCKER` remains the correct conservative status for any
finding that is confirmed present in HEAD. `SECRET_HISTORY_ROTATION_UNKNOWN=BLOCKER`
remains the status for a real historical credential whose rotation cannot be proved.
No allowlist was added, no broad exclusion was restored, and no signing keystore or
password file was opened or modified.

## Required owner action

Review the exact local files and commits named in the sanitized artifacts, classify
each finding as a placeholder/fixture/example or real secret, and document rotation
evidence for each real historical credential. Rotate active credentials through
their issuing systems. Do not paste values into issues, logs, reports, or APIs.
