# Pre-Play findings index

The complete finding records, evidence, corrections and retests are in
[RS_SEC_FINAL_01_FINDINGS.md](RS_SEC_FINAL_01_FINDINGS.md). Scanner dependency rows are in
[PRE_PLAY_SUPPLY_CHAIN_2026.md](PRE_PLAY_SUPPLY_CHAIN_2026.md). Secret metadata is recorded
below without secret values; this is a detection inventory, not confirmation that each
match is a valid live credential. Test fixtures and public client keys need individual
false-positive verification. No new allowlist was added.

| ID | FILE | COMMIT | LINE | SECRET_TYPE | VALIDITY | STATUS |
|---|---|---|---|---|---|---|
| HIST-01 | `script/rc-p0-pricing-tests.ts` | `d62c81823bb70cf387410c5421e15b2be36e8b2b` | 22 | mercado-pago-token | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-02 | `script/plan-impl-04a-plan-experience-tests.ts` | `eacead77175323de00c6755d02ce79fa02021aa2` | 202 | mercado-pago-token | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-03 | `script/plan-impl-04b-provider-pricing-tests.ts` | `eacead77175323de00c6755d02ce79fa02021aa2` | 104 | mercado-pago-token | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-04 | `script/plan-impl-03-trial-lifecycle-tests.ts` | `cebfa5978a39a5733d179a3d6f345ad5e8364326` | 426 | generic-api-key | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-05 | `script/plan-impl-03-trial-lifecycle-tests.ts` | `cebfa5978a39a5733d179a3d6f345ad5e8364326` | 442 | generic-api-key | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-06 | `script/plan-impl-03-trial-lifecycle-tests.ts` | `cebfa5978a39a5733d179a3d6f345ad5e8364326` | 566 | generic-api-key | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-07 | `script/services-booking-tests.ts` | `991844dc5d80bbaac2e3c89e90c8a2457ca52fe7` | 97 | generic-api-key | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-08 | `script/subscription-cancel-tests.ts` | `f3d131e4df718c5981ca023b300c1c906d50d528` | 27 | mercado-pago-token | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-09 | `script/smoke-tests.ts` | `f3d131e4df718c5981ca023b300c1c906d50d528` | 2142 | mercado-pago-token | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-10 | `script/smoke-tests.ts` | `f3d131e4df718c5981ca023b300c1c906d50d528` | 2189 | mercado-pago-token | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-11 | `script/smoke-tests.ts` | `f3d131e4df718c5981ca023b300c1c906d50d528` | 2196 | mercado-pago-token | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-12 | `scripts/security/run-gitleaks.mjs` | `5c32876e2bf831418ff3da0bc0cff78cc130754c` | 36 | firebase-admin-private-key | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-13 | `script/smoke-tests.ts` | `5aebce995cb8fa6696d5305765144619a8a60625` | 805 | mercado-pago-token | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-14 | `script/smoke-tests.ts` | `5aebce995cb8fa6696d5305765144619a8a60625` | 807 | mercado-pago-token | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-15 | `scripts/security/validate-agent-skills.mjs` | `d93de35d1c8dd9e3541feac9a94f51d18457aa5f` | 68 | firebase-admin-private-key | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-16 | `env.yaml` | `75cca6521f7eb8cc49e72151d5e2ce9bf6dfb63b` | 1 | mercado-pago-token | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-17 | `env.yaml` | `75cca6521f7eb8cc49e72151d5e2ce9bf6dfb63b` | 8 | private-key | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-18 | `env.yaml` | `75cca6521f7eb8cc49e72151d5e2ce9bf6dfb63b` | 8 | firebase-admin-private-key | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-19 | `env.yamlx` | `75cca6521f7eb8cc49e72151d5e2ce9bf6dfb63b` | 7 | firebase-admin-private-key | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-20 | `env.yamlx` | `75cca6521f7eb8cc49e72151d5e2ce9bf6dfb63b` | 11 | firebase-admin-private-key | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-21 | `env.yamlx` | `75cca6521f7eb8cc49e72151d5e2ce9bf6dfb63b` | 11 | gcp-service-account-json-key | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-22 | `env.yamlx` | `75cca6521f7eb8cc49e72151d5e2ce9bf6dfb63b` | 1 | mercado-pago-token | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-23 | `env.yamlx` | `75cca6521f7eb8cc49e72151d5e2ce9bf6dfb63b` | 7 | private-key | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-24 | `env.yamlx` | `75cca6521f7eb8cc49e72151d5e2ce9bf6dfb63b` | 11 | private-key | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-25 | `.replit` | `d0a403fcdf182a21724bae378fdb3897f5aa779f` | 67 | mercado-pago-token | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-26 | `.replit` | `d0a403fcdf182a21724bae378fdb3897f5aa779f` | 64 | generic-api-key | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-27 | `.replit` | `d0a403fcdf182a21724bae378fdb3897f5aa779f` | 66 | generic-api-key | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-28 | `.replit` | `d0a403fcdf182a21724bae378fdb3897f5aa779f` | 53 | gcp-api-key | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-29 | `FECHAR_PREMIUM_HOJE.md` | `d0a403fcdf182a21724bae378fdb3897f5aa779f` | 229 | curl-auth-header | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-30 | `GLOBAL_PREMIUM_RELEASE.md` | `d0a403fcdf182a21724bae378fdb3897f5aa779f` | 255 | curl-auth-header | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-31 | `GLOBAL_PREMIUM_RELEASE.md` | `d0a403fcdf182a21724bae378fdb3897f5aa779f` | 278 | curl-auth-header | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-32 | `CLOUD_RUN_MIGRATION.md` | `d0a403fcdf182a21724bae378fdb3897f5aa779f` | 59 | firebase-admin-private-key | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-33 | `CLOUD_RUN_MIGRATION.md` | `d0a403fcdf182a21724bae378fdb3897f5aa779f` | 178 | generic-api-key | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-34 | `SYNC_PAID_SUBSCRIPTION.md` | `d0a403fcdf182a21724bae378fdb3897f5aa779f` | 48 | curl-auth-header | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-35 | `VERCEL_BACKEND_MIGRATION_ANALYSIS.md` | `d0a403fcdf182a21724bae378fdb3897f5aa779f` | 365 | generic-api-key | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-36 | `VERCEL_BACKEND_MIGRATION_ANALYSIS.md` | `d0a403fcdf182a21724bae378fdb3897f5aa779f` | 353 | firebase-admin-private-key | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-37 | `env.yaml` | `d0a403fcdf182a21724bae378fdb3897f5aa779f` | 5 | gcp-service-account-json-key | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-38 | `env.yaml` | `d0a403fcdf182a21724bae378fdb3897f5aa779f` | 5 | private-key | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-39 | `env.yaml` | `d0a403fcdf182a21724bae378fdb3897f5aa779f` | 5 | firebase-admin-private-key | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-40 | `setup-secrets-cloud-run.sh` | `d0a403fcdf182a21724bae378fdb3897f5aa779f` | 92 | firebase-admin-private-key | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-41 | `serviceAccountKey.json` | `d0a403fcdf182a21724bae378fdb3897f5aa779f` | 5 | gcp-service-account-json-key | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-42 | `serviceAccountKey.json` | `d0a403fcdf182a21724bae378fdb3897f5aa779f` | 5 | private-key | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
| HIST-43 | `serviceAccountKey.json` | `d0a403fcdf182a21724bae378fdb3897f5aa779f` | 5 | firebase-admin-private-key | UNKNOWN | REVIEW_REQUIRED; no authentication attempted |
