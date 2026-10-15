# Gitleaks final triage — 2026-10-10

No secret values are included. The 64 raw detections were deduplicated by rule,
path, line, commit and scanner fingerprint. The historical snapshot paths under
`.tmp/security/gitleaks-tree-*` are scanner artifacts and are mapped to their
original repository path; they are not additional repository files.

| Group | Rule/type | Repository paths | Presence | Classification | Rotation | Blocker |
|---|---|---|---|---|---|---|
| G-001 | gcp-api-key, generic-api-key, mercado-pago-token | `.replit` | previous HEAD only; sensitive assignments removed in candidate | REAL_SECRET_ACTIVE (remediated in candidate) | ROTATION_REQUIRED | YES until owner rotates/revokes Firebase Admin and Mercado Pago credentials |
| G-002 | firebase-admin-private-key, private-key, gcp-service-account-json-key, mercado-pago-token | `env.yaml`, `env.yamlx` | history only; absent from HEAD | UNKNOWN_SECRET | UNKNOWN | YES |
| G-003 | private-key, gcp-service-account-json-key, firebase-admin-private-key | `serviceAccountKey.json` | history only; absent from HEAD | UNKNOWN_SECRET | UNKNOWN | YES |
| G-004 | firebase-admin-private-key, generic-api-key | `CLOUD_RUN_MIGRATION.md`, `VERCEL_BACKEND_MIGRATION_ANALYSIS.md`, `scripts/security/run-gitleaks.mjs`, `scripts/security/validate-agent-skills.mjs` | HEAD/history | UNKNOWN_SECRET pending local value review | UNKNOWN | YES |
| G-005 | generic-api-key, mercado-pago-token | `script/*-tests.ts`, `script/smoke-tests.ts` | HEAD/history | TEST_FIXTURE pending owner confirmation | NOT_APPLICABLE | NO only after confirmation |
| G-006 | curl-auth-header | `FECHAR_PREMIUM_HOJE.md`, `GLOBAL_PREMIUM_RELEASE.md`, `SYNC_PAID_SUBSCRIPTION.md` | HEAD/history | DOCUMENTATION_EXAMPLE pending owner confirmation | NOT_APPLICABLE | NO only after confirmation |

Local inspection confirmed that the previous `.replit` contained sensitive
Firebase Admin and Mercado Pago assignments. Those assignments were removed from
the candidate `.replit`; the corresponding external credentials still require
owner-led rotation/revocation. Historical `env.yaml`/`env.yamlx` and
`serviceAccountKey.json` findings remain real-secret candidates with unknown
rotation status. G-004 remains UNKNOWN because its mixed migration/security files
need value-level review without exposing their contents. Therefore
`UNKNOWN_SECRET > 0` and release remains NO_GO.
No external service was contacted and no detected value was used for authentication.

No allowlist was added. The existing scanner-source and generated-snapshot handling
was not broadened to suppress findings. The owner must inspect the exact local
values in a controlled environment, classify fixtures/examples, and rotate any real
credential through its issuing system. History will not be rewritten in this round.

## Required release gate

`REAL_SECRET_ACTIVE=0` and `ROTATION_UNKNOWN_REAL_SECRET=0` cannot be asserted from
metadata alone. The next authorized step must produce a local, value-hash-only
classification record for each group, then rerun both the worktree and history scans.
