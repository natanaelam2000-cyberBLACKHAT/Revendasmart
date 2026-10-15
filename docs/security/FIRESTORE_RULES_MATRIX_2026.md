# Firestore Rules matrix — 2026-10-10

The matrix is derived from the deployed source rules and the local emulator suites.
`DENY_PASS` is used only where a negative emulator assertion exists.

| PATH | RESOURCE | READ | LIST | CREATE | UPDATE | DELETE | AUTH_REQUIRED | OWNER_CHECK | ADMIN_CHECK | SERVER_ONLY | TEST_STATUS |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `users/{uid}` | tenant root | DENY | DENY | DENY | DENY | DENY | yes | n/a | no | yes | emulator |
| `users/{uid}/clients/{id}` | clients | own | own query | DENY | own + shape | DENY | yes | uid | no | create/delete | source + Rules |
| `users/{uid}/products/{id}` | products | own | own query | DENY | own + closed shape | DENY | yes | uid | no | create/delete | Rules/source |
| `users/{uid}/sales/{id}` | finalized sales | own | own query | DENY | DENY | DENY | yes | uid | no | yes | emulator/source |
| `users/{uid}/pendingSales/{id}` | offline queue | own | own query | own + shape | own + immutable payload | own | yes | uid | no | final sale | emulator DENY_PASS |
| `users/{uid}/orders/{id}` | orders | own | own query | own + shape | own + shape | DENY | yes | uid | no | command fields | order emulator |
| `users/{uid}/services/{id}` | services | own | own query | DENY | own + shape | DENY | yes | uid | no | create/delete | service tests |
| `users/{uid}/bookings/{id}` | bookings | own | own query | DENY | DENY | DENY | yes | uid | no | yes | service/emulator |
| `users/{uid}/serviceWorks/{id}` | work orders | own | own query | own + shape | own + shape | DENY | yes | uid | no | payment children | service tests |
| `users/{uid}/charges/{id}` | charges | own | own query | DENY | DENY | DENY | yes | uid | no | yes | payment/source |
| `users/{uid}/installments/{id}` | installments | own | own query | DENY | limited status/payment | DENY | yes | uid | no | terms server-only | source |
| `users/{uid}/mercadopago_connections/{id}` | OAuth connections | own | own query | DENY | DENY | DENY | yes | uid | no | yes | OAuth/source |
| `user_settings/{uid}` | settings | DENY | DENY | DENY | DENY | DENY | yes | API ownership | no | yes | onboarding/emulator |
| `account_deletion_requests/{uid}` | deletion tombstone | DENY | DENY | DENY | DENY | DENY | yes | server | no | yes | deletion/emulator |
| `mercadopago_oauth_states/{nonce}` | OAuth nonce | DENY | DENY | DENY | DENY | DENY | yes | server | no | yes | source |
| `users/{uid}/planUsage/*` | quota | DENY | DENY | DENY | DENY | DENY | yes | server | no | yes | plan tests |
| `users/{uid}/bookingHolds/*` | booking holds | own | own query | DENY | DENY | DENY | yes | uid | no | yes | service tests |
| `users/{uid}/scheduleLocks/*` | schedule locks | DENY | DENY | DENY | DENY | DENY | yes | server | no | yes | source |

The catch-all rule denies every unlisted path. Collection/list leakage is denied by
tenant path rules for the tested collections; a full runtime query matrix for every
collectionGroup/report/export path remains a follow-up and is not marked complete here.
