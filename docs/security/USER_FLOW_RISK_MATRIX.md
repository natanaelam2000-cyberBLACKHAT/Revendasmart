# Critical flow risk matrix

All paths below are under client/src/pages unless explicitly noted. Literal API registrations
and their source locations are in API_ENDPOINT_INVENTORY.md. PASS refers only to the named
unit/emulator checks; no complete user/device/E2E certification is asserted. Ads Pro is OUT_OF_SCOPE.

| FLOW | CLIENT_ENTRY | API_ENDPOINT | AUTH_REQUIRED | WRITE_OPERATION | OFFLINE_CAPABLE | DUPLICATION_RISK | DATA_LOSS_RISK | AUTHORIZATION_RISK | CURRENT_TEST | RESULT |
|---|---|---|---|---|---|---|---|---|---|---|
| login | login.tsx | Firebase Auth SDK | YES (after login) | AUTH | NO | LOW | form retention | token lifecycle | auth-p0-01-tests | PASS targeted; UI NOT_RUN |
| cadastro | signup.tsx | Firebase Auth SDK | PUBLIC signup | AUTH/PROFILE | NO | REVIEW | partial registration | profile ownership | auth-p0-01-tests | PARTIAL |
| onboarding | onboarding.tsx | /api/user/settings/:userId | YES | POST | DRAFT_ONLY | deduplicated/ordered | draft until acknowledgement | UID rechecked before/after request | onboarding persistence + matrix + emulator | PASS core; device/UI NOT_RUN |
| clientes | clients.tsx / sell.tsx | /api/clients | YES | POST | NO creation | stable clientId/idempotencyKey | pending form | server UID | plan-authoritative / smoke / Firebase | PARTIAL |
| produtos | add-product.tsx | /api/products + Firestore updates | YES | POST/UPDATE | SDK updates | create command review | stock delta | server-only create | Firebase + release-quality-05 | PASS tested boundaries; form matrix PARTIAL |
| catalogo | public-catalog.tsx | /api/public/catalog/:storeSlug/* | PUBLIC | order/payment request | NO | reservation idempotency | request outcome | public presentation privacy | public-catalog-isolation + order concurrency | PASS retest; initial emulator failure retained |
| vendas | sell.tsx | /api/sales/finalize | YES | POST transaction | AVISTA_QUEUE | stable saleId | explicit ack required | server UID | sale-stock concurrency + pending response | PASS sampled |
| pedidos | orders.tsx | /api/orders/:orderId/confirm-payment | YES owner | POST | REVIEW | atomic transitions | status preservation | tenant lookup | Firebase order/charge concurrency | PASS sampled |
| servicos | services-list.tsx / services-new.tsx | server/plan-authoritative-mutations.ts | YES | CREATE/UPDATE | REVIEW | command review | form retention | tenant scoped | services-security-tests | PASS security samples; UX PARTIAL |
| agenda | service-agenda.tsx | /api/services/bookings/* | YES | POST | NO booking commands | transactional hold | hold expiry | owner/client checks | services-security-tests | PARTIAL |
| agendamento publico | public-service-booking.tsx | server/service-public-booking.ts | PUBLIC token | POST | NO | quota/reservation | expired token | scoped public token | services-security-tests | PARTIAL |
| planos | plans.tsx / plan-usage.tsx | /api/plan/data/:userId | YES | READ / authoritative mutations | NO entitlements | usage/idempotency review | load failure state | server plan authority | plan foundation/limits + Firebase | PASS samples; purchase UX NOT_RUN |
| assinaturas | subscribe.tsx | /api/app-subscription/{create,cancel} | YES | POST | NO | existing reservation | confirmation required | server/provider entitlement | subscription-cancel-tests | PASS mocked cancellation; exhaustive UX NOT_RUN |
| Mercado Pago | settings-mercadopago.tsx / billings.tsx | /api/mercadopago/* + server/payments.ts | YES / signed webhook | POST/OAuth/webhook | NO | charge reservations | provider-failure release | OAuth state / ownership | mercadopago-oauth + token crypto + Firebase charges | PASS mocks/emulators |
| Google Play Billing | subscribe.tsx | /api/billing/google-play/{verify,restore,rtdn} | YES / RTDN auth | POST | NO | purchase ownership/replay | server confirmation | server verification | play-billing-tests | API samples PASS; suite BLOCKED missing merged manifest |
| sorteios | sorteios-create.tsx / sorteios-admin.tsx | /api/admin/sorteios/* | YES / public link token | POST/PATCH | NO | allocation review | form retention | per-customer/tenant checks | promotional-campaigns-owner-access-tests | PASS security samples |
| indicacoes | settings.tsx + onboarding-referral.ts | /api/user/settings/:userId / server/referral-* | YES | POST | onboarding draft | immutable source / reward transactions | retry preserved | no forged reward | referral-settings-isolation-tests | PASS samples |
| configuracoes | settings.tsx | /api/user/settings/:userId | YES owner | POST | DRAFT only onboarding | slug ownership transaction | retry and confirmation | field sanitization | onboarding + catalog + referral emulators | PASS targeted; matrix PARTIAL |
| exclusao de conta | account-deletion.tsx | /api/account | YES reauth | DELETE | NO | deletion tombstone/retry | backend progress | server UID | account-deletion-tests | PASS emulator |
| offline queue | usePendingSalesSync.ts / offline-sales-queue.ts | pendingSales + /api/sales/finalize | YES owner | CLAIM/POST/SETTLE | YES avista | lease + attempts + stable ID | keep unconfirmed sale | cross-account DENIED | Firebase queue test + response tests | PASS rules/core; process kill/UI NOT_RUN |

## Onboarding scenarios

ONB-01 normal persistence: PASS unit + 20/20 backend persistence/restart cycles.
ONB-02 slow/out-of-order responses: PASS ordered-writer unit; extreme UI slowness NOT_RUN.
ONB-03/04 offline before/during save: PASS rejected-request draft/retry model; real device toggle NOT_RUN.
ONB-05 timeout: PASS auth deadline and request-abort model; no late POST after token delay.
ONB-06/07 expired-token/401: PASS synthetic HTTP classification/recovery; device session UX NOT_RUN.
ONB-08/09/10/11 403/409/422/500: PASS rejection, draft preservation and retry tests.
ONB-12 invalid response: PASS null/empty/missing settings/array/wrong mode/unconfirmed completion.
ONB-13 double submit: PASS shared promise/one request in existing persistence test.
ONB-14 back during request: NOT_RUN UI; no automatic navigation in failure handler, existing regression PASS.
ONB-15 close/reopen: PASS durable-draft reconstruction and server restart model; device process kill NOT_RUN.
ONB-16 retry after failure: PASS for network, timeout and ten HTTP status failures.
ONB-17 completed user: PARTIAL existing route-safety/persistence evidence; full live UI route NOT_RUN.
ONB-18 confirmed response/local delayed state: PARTIAL ordered writer + backend tests; browser loop matrix NOT_RUN.

## Offline scenarios

OFF-01/02 persistence uses Firestore SDK; source review and durable draft/queue rules evidence only.
OFF-03/04/05 retry policy: unit response classification PASS; existing capped attempts/backoff/lease retained.
OFF-06 409 business conflict/replay: PASS unit; server sale replay/concurrency emulator PASS.
OFF-07 session expiry: PARTIAL auth deadline and 401 classification; full queued UI interaction NOT_RUN.
OFF-08/09 account switch: token-before-POST tenant guard PASS; pendingSales cross-account
read/claim/delete require exact permission-denied in Firebase test. Device reconnect/snapshot races NOT_RUN.
OFF-10/11 duplicate/already-processed: saleId replay and stock transaction PASS; no second stock decrement.
OFF-12 invalid item: response failure retains queue; exhaustive corrupt local queue/UI recovery NOT_RUN.

Browser/device back, reload/deep-link, repeated delete/purchase taps, every form boundary,
kill during POST, and every HTTP status across every flow remain outstanding. Do not infer
that one core unit test validates all UI behaviors or every mutable endpoint.
