# RC hardening: C1, H1, H2, H3

Scope: the four blockers from the RC global audit, based on
`8ca9a3b5a21b26820741e83ad7717fce10b36565`. ADS-PRO assets, manifest,
curation and inventory are unchanged. This is not production or Play Store approval.

## H1: administrative authority

Administrative HTTP handlers derive the UID from the verified Firebase ID token.
The shared authorization helper reads the current Firebase Admin user record and
requires `customClaims.admin === true`, with the account enabled. Missing claims,
lookup errors and disabled accounts deny access. Email, including the old email
allowlist, does not confer administrative authority. Existing administrators must
have the explicit claim provisioned through trusted server/operator tooling;
clients cannot self-provision it. No automatic migration of email authority occurs.

`script/hardening-admin-auth-tests.ts` exercises registered administrative/reward
routes against Auth and Firestore emulators: anonymous, ordinary and spoofed
identities are denied; an authorized administrator is allowed; claim removal
takes effect even with an older valid token. It also checks that client writes
cannot promote users through server-owned Firestore documents.

## H3: monotonic payment transitions

Manual order transitions are `awaiting_customer_payment -> customer_reported_paid
-> paid`; owner confirmation may skip the reported state. Reporting an already
paid order is an idempotent no-op. Buyer-token checks and state checks happen
inside the Firestore transaction, including retries.

Provider charge updates use the persisted state inside a transaction. A paid
charge cannot become pending, failed, cancelled or another unpaid state through
a stale result. An explicit provider refund/chargeback with refund evidence has
its own terminal `refunded` state. Delayed successes cannot erase it. Charge and
associated order confirmation occur atomically; duplicate events do not rewrite
the original confirmation timestamp. Existing sale/charge ownership and server
financial idempotency remain authoritative.

`script/hardening-payment-race-tests.ts` uses real Firestore transactions and
deterministic read barriers for stale report/confirmation and success/failure
races, as well as duplicate, retry, refund and cross-tenant cases.

## H2: persistent offline recovery

An online Firestore transaction claims each queued sale with a worker owner,
120-second lease, attempt counter and persisted backoff. Active leases are not
stolen. Expired `syncing` records are recovered after restart; legacy records
without a lease expire from their persisted `updatedAt`. The online worker checks
every five seconds, limits token and HTTP requests to 30 seconds each, and renews
its owned lease before sending. Only the owning worker can settle a result.

There are at most five automatic attempts, with exponential backoff beginning at
15 seconds. Exhausted and business-conflict records preserve the payload for
review. Explicit manual retry resets the budget; retry/cancel cannot interrupt an
active syncing record. Authentication changes clear the previous user's view.

The stable sale ID and existing server `SALE_ALREADY_EXISTS` handling protect
financial idempotency. A lease is not a promise that HTTP is never repeated after
an arbitrary network partition or a crash after server success but before local
acknowledgement; the server must continue enforcing sale-ID idempotency.

`script/hardening-offline-browser-tests.ts` uses the production hook and queue,
real Chromium, Auth/Firestore emulators, IndexedDB persistence, reload and two
browser workers. Its HTTP boundary verifies the emulator token and counts sends;
it does not call an external payment provider. Server acknowledgement and record
removal, rather than a cached absent client read, are required for completion.

## C1: Capacitor Android advisory

The minimal patched 8.4 line is 8.4.3. Android, core and CLI are pinned together
to 8.4.3; other plugins and unrelated dependencies are unchanged.

- [GHSA-rvm3-566m-v7fv](https://github.com/ionic-team/capacitor/security/advisories/GHSA-rvm3-566m-v7fv)
- [Capacitor 8.4.3 release](https://github.com/ionic-team/capacitor/releases/tag/8.4.3)

The upstream fix blocks navigation through the native HTTP proxy, including
subframes, while preserving non-navigation HTTP requests. Merely disabling
CapacitorHttp is insufficient mitigation. Acceptance requires the patched
installed/locked dependency plus Capacitor sync and Android compilation.

## Validation and release limits

Use Node 22 or newer and the existing project's Firebase emulator test commands.
The three hardening test scripts require the demo emulators; the browser test
also requires the installed Playwright Chromium binary. On affected Windows
environments, use the previously validated SUBST build method with
`RS_BUILD_PRESERVE_SYMLINKS=true` and consistent Node resolution flags.

The known referral smoke assertion still expects inline token retrieval despite
delegation to the authenticated helper. It is outside this hardening scope.
Medium/low audit observations, other npm advisories, Play Console readiness,
backup policy and production payment-provider validation remain separate gates.
No signing credentials, publication, production mutations, asset regeneration
or promotion are part of this work.
