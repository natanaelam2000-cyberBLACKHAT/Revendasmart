# Android user resilience — 2026-10-10

| Scenario | Status | Evidence / gap |
|---|---|---|
| app background during request | PARTIAL | request cancellation and auth deadlines tested in web layer; device lifecycle not run |
| process death during offline sale | PARTIAL | Firestore persistence and queue lease design reviewed; device restart not run |
| return after token expiry | PASS_SOURCE_TARGETED | revoked-token handling and bounded token acquisition |
| offline then reconnect | PASS_RUNTIME_TARGETED | offline queue classifier, bounded retry and account isolation |
| account switch | PASS_RUNTIME_TARGETED | UID-scoped cache cleanup and emulator negative tests |
| Android back button | PASS_SOURCE | dedicated back-button helper and modal-first behavior |
| external browser return | PARTIAL | explicit URL flows reviewed; device intent test not run |
| permission denied/no network | PARTIAL | frontend recovery paths exist; device permission harness unavailable |
| rotation/reload | NOT_TESTED | no emulator/device run in this checkpoint |

No current APK/AAB exists for dynamic MobSF or device validation. Those remain
blocked until the audited checkpoint can build in an environment without the known
Vite `realpath` EPERM restriction.
