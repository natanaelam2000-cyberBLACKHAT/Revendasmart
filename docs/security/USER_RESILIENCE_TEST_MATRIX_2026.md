# User resilience test matrix — 2026-10-10

| ID | FLOW | TEST | EXPECTED | ACTUAL | FIX | RETEST |
|---|---|---|---|---|---|---|
| AUTH-007/008 | login | repeated Enter/click before render | one sign-in/settings sequence | two handlers could start before disabled state rendered | synchronous `loginInFlightRef` guard | smoke source contract PASS |
| AUTH-009/011 | authenticated request | slow/stalled token and timeout | bounded wait, no late POST | fixed in RS-SEC-FINAL-01 | shared AbortSignal bounds token + fetch | security auth timeout PASS |
| AUTH-HTTP-01 | API error | short filesystem/SQL/exception response | generic safe message | arbitrary short backend text was displayed | reject internal-detail patterns | smoke API tests PASS |
| ONB-01..18 | onboarding | offline, timeout, HTTP errors, invalid acknowledgement, account switch | preserve draft; no late write | fixed in prior round | confirmation and auth deadline | matrix PASS |
| OFF-01..12 | offline sale | malformed 2xx, replay, transient errors | delete only after matching acknowledgement | fixed in prior round | semantic response classifier | directed tests PASS |
| TENANT-01 | account switch | A pending operation, then B | B cannot read/send/delete/complete A | denied by Rules/UID scope | strict negative emulator assertions | PASS |
| CACHE-01 | logout/account switch | cached Firestore/query/image data | clear or isolate before next tenant | centralized listener and logout cleanup present | existing cache isolation controls | PASS_TARGETED |
| SALE-AMB-01 | lost response/replay | server processed, client retries | no duplicate sale | stable sale ID and server duplicate response supported | retained queue until explicit ack | PASS_TARGETED |
| HTTP-429/5XX | API/offline queue | rate limit/transient service failure | bounded retry only when safe | classifier marks recoverable; API does not auto-retry writes | explicit retryable metadata/backoff owner | PASS_TARGETED |
| QUEUE-CORRUPT-01 | offline recovery | malformed Firestore queue document | isolate terminal item; continue valid items | runtime guard rejects invalid ID/payload/status without crashing worker | `security-queue-corruption-tests.ts` PASS |

Device UI, forced process death, live provider failures and exhaustive endpoint IDOR
coverage remain outside automated evidence. They are not reported as PASS.
