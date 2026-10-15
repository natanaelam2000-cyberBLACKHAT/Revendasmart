# Android / Capacitor MASVS matrix — 2026-10-10

This is a source and configuration review at the local security checkpoint. It is
not an APK/MobSF certification because no current APK/AAB was produced.

| MASVS area | Evidence | Status |
|---|---|---|
| MASVS-STORAGE | `allowBackup=false`; account-scoped local data cleanup; no custom bearer-token persistence found | PASS_SOURCE |
| MASVS-CRYPTO | Firebase Auth/HTTPS; release secrets read from environment; no hardcoded signing password | PASS_SOURCE |
| MASVS-AUTH | Firebase Auth provider persistence; server verifies revoked ID tokens; token values kept in SDK/runtime | PASS_SOURCE + targeted tests |
| MASVS-NETWORK | Capacitor `androidScheme=https`; external app URLs reviewed; no trust-all verifier found | PASS_SOURCE |
| MASVS-PLATFORM | launcher is the only exported activity; FileProvider is non-exported; external storage root removed | PASS_SOURCE |
| MASVS-CODE | TypeScript/security tests pass; release signing fails closed without env vars | PASS_SOURCE |
| MASVS-RESILIENCE | offline queue leases, bounded retry, corrupted-item isolation, account-switch cleanup | PASS_RUNTIME_TARGETED |
| MASVS-PRIVACY | scoped storage cleanup, sanitized logs, no secret values in reports | PASS_SOURCE + targeted tests |

MASTG references used for review: MSTG-STORAGE-1/2 (sensitive data and backups),
MSTG-AUTH-1/2 (session/token handling), MSTG-PLATFORM-1/2 (exported components and
deep links), MSTG-NETWORK-1 (TLS), and MSTG-RESILIENCE-1 (state recovery). Full
device instrumentation remains NOT_TESTED.
