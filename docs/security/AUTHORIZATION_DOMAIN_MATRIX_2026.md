# Authorization domain matrix — 2026-10-10

Synthetic emulator identities were used where the existing suite supports them.
`DENY_PASS` means a runtime negative assertion returned permission denied/forbidden.
`SOURCE_REVIEW_ONLY` is explicitly not a runtime pass.

| DOMAIN | OPERATION | OWNER_USER | ATTACKER_USER | ENDPOINT_OR_RULE | EXPECTED | ACTUAL | TEST | RESULT |
|---|---|---|---|---|---|---|---|---|
| Firestore pending sales | read | USER_A | USER_B | `users/{uid}/pendingSales/*` | DENY | permission denied | firebase-emulator-tests | DENY_PASS |
| Firestore pending sales | update/complete | USER_A | USER_B | same rule | DENY | permission denied | firebase-emulator-tests | DENY_PASS |
| Firestore pending sales | delete | USER_A | USER_B | same rule | DENY | permission denied | firebase-emulator-tests | DENY_PASS |
| Firestore user data | read/list | USER_A | USER_B | `users/{uid}/**` | DENY | Rules path isolation | firebase-emulator-tests, owner-access-02 | DENY_PASS |
| Account deletion | delete | USER_A | USER_B | `DELETE /api/account` | DENY | authenticated UID required | account-deletion-tests | DENY_PASS |
| Settings | get/save | USER_A | USER_B | `/api/user/settings/:userId` | DENY | `requireOwnership` | onboarding/emulator tests | DENY_PASS |
| Plan data | get | USER_A | USER_B | `/api/plan/data/:userId` | DENY | `requireOwnership` | source + route tests | SOURCE_REVIEW_ONLY |
| Public catalog | owner mutation | USER_A | USER_B | catalog owner commands | DENY | owner lookup/transaction | public-catalog-isolation-tests | DENY_PASS |
| Uploads | create/read | USER_A | USER_B | storage Rules / upload routes | DENY | Rules owner path | upload-hardening-tests | DENY_PASS |
| Referrals | settings mutation | USER_A | USER_B | referral settings path | DENY | owner-isolated transaction | referral-settings-isolation-tests | DENY_PASS |
| Sorteios/admin | all operations | USER_A | USER_B | `/api/admin/sorteios/*` | DENY | custom admin claim required | promotional-campaigns-owner-access-tests | DENY_PASS |
| Admin grants | all operations | USER_A | USER_B | `/api/admin/grants/*` | DENY | `requireAdmin` | hardening-admin-auth-tests | DENY_PASS |
| Orders | edit | USER_A | USER_B | `/api/orders/:orderId/edit` | DENY | server owner lookup | order-edit-command-emulator-tests | DENY_PASS |
| Sales | finalize/replay | USER_A | USER_B | sale command and queue | DENY | server UID + sale ownership | pending-sale and emulator tests | DENY_PASS_TARGETED |
| Services | booking management | USER_A | USER_B | service booking routes | DENY | owner checks | services-security-tests | DENY_PASS_TARGETED |
| Payments | charge/status/delete | USER_A | USER_B | `/api/payments/:chargeId` | DENY | charge owner and auth | payment tests/source | PARTIAL_RUNTIME |
| OAuth connections | list/revoke/default | USER_A | USER_B | Mercado Pago connection routes | DENY | connection owner | OAuth tests/source | PARTIAL_RUNTIME |
| Products | CRUD | USER_A | USER_B | product Firestore paths | DENY | Rules owner path | emulator/source tests | PARTIAL_RUNTIME |
| Clients | CRUD | USER_A | USER_B | client Firestore paths | DENY | Rules owner path | source review | SOURCE_REVIEW_ONLY |

No client-controlled `uid`, `ownerId`, `admin`, `role`, `premium`, payment or plan
field is treated as the authenticated identity in the reviewed command handlers.
The remaining `PARTIAL_RUNTIME` and `SOURCE_REVIEW_ONLY` rows are explicit next
runtime-test targets; they are not silently promoted to PASS.
