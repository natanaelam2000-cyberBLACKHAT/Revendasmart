# API security matrix — 2026-10-10

The detailed literal route inventory remains in `API_ENDPOINT_INVENTORY.md` (124
registrations). This matrix summarizes the security controls by domain; `PARTIAL`
means reviewed source plus selected tests, not certification of every handler.

| METHOD/PATH DOMAIN | PURPOSE | PUBLIC | AUTH_REQUIRED | OWNER_CHECK | ADMIN_CHECK | INPUT_VALIDATION | RATE_LIMIT | IDEMPOTENT | TEST | STATUS |
|---|---|---|---|---|---|---|---|---|---|---|
| `/api/user/settings/*` | settings/onboarding | no | yes | token UID | no | allowlisted fields | service dependent | confirmation required | onboarding matrices | PASS_TARGETED |
| clients/products Firestore + API helpers | CRUD | no | yes | Rules UID path | no | client + Rules/server command | n/a | writes use document IDs | emulator suites | PARTIAL |
| `/api/sales/*`, pending sales | financial mutation/replay | no | yes | token UID, server authority | no | command validation | bounded queue | stable sale ID/dedup | response/queue tests | PASS_TARGETED |
| `/api/orders/:id/edit` | order mutation | no | yes | owner lookup | no | parsed command, server fields | no explicit global limit | optimistic version conflict | order edit tests | PASS_TARGETED |
| public catalog routes | public catalog | yes/read scoped | route dependent | catalog owner on mutation | no | slug/payload checks | IP/subject limits | slug conflict handling | catalog isolation retest | PASS_TARGETED |
| services/agenda routes | booking and availability | mixed | protected mutations | owner checks | no | dedicated parsers | quotas where applicable | holds/conflicts | service security tests | PARTIAL |
| `/api/account` | deletion | no | yes | authenticated account only | no | fixed command | sensitive endpoint controls | tombstone/retry safe | deletion tests | PASS_TARGETED |
| `/api/admin/*` | administrative operations | no | yes | n/a | authoritative custom claim | bounded fields | per-admin where applicable | command dependent | admin/promotional tests | PASS_TARGETED |
| payment/subscription routes | provider boundary | mixed webhook/protected user | route dependent | charge/subscription owner | provider verification | dedicated validators | endpoint limits | event/replay guards | mocked payment tests | PARTIAL |

No endpoint is considered safe merely because its identifier is random. The owner
source is the verified token UID or an authoritative server lookup. Ads Pro business
logic is outside this round.
