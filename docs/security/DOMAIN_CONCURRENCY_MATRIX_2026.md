# Domain concurrency matrix — 2026-10-10

| DOMAIN | CONCURRENCY SCENARIO | EXPECTED | EVIDENCE | RESULT |
|---|---|---|---|---|
| Sales/charges | same sale/order charge submitted twice | one logical application | order-charge-race and payment-race tests | PASS_TARGETED |
| Offline sales | response lost after server processing, replay | stable ID acknowledged without duplicate | pending-sale response tests | PASS_TARGETED |
| Orders | two edits with stale version | conflict or server-defined safe outcome | order edit command tests | PASS_TARGETED |
| Onboarding | account switch while auth token resolves | no late write under new UID | onboarding matrix | PASS_TARGETED |
| Auth API | many callers await one deadline | no late POST after cancellation | auth timeout tests | PASS_TARGETED |
| Client/product CRUD | two screens save same document | no silent cross-account write | source review; runtime matrix pending | PARTIAL |
| Agenda/services | simultaneous booking/update/delete | explicit conflict or transaction outcome | service tests; exhaustive race pending | PARTIAL |
| Payments/webhooks | duplicate/out-of-order provider event | idempotent state transition | mocked payment tests | PARTIAL_MOCKED |
| Account deletion | delete repeated or concurrent with reads | tombstone blocks further work | account deletion/emulator tests | PASS_TARGETED |
| Offline queue | malformed item alongside valid item | isolate poison item and continue drain | `security-queue-corruption-tests.ts` + runtime guard | PASS_TARGETED |

The matrix distinguishes tested behavior from assumptions. `PARTIAL` rows require
synthetic emulator/API concurrency coverage before release certification.
