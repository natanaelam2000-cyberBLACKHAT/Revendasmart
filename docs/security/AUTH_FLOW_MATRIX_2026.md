# Authentication flow matrix — 2026-10-10

| FLOW | CLIENT_FILE | SERVER_ENDPOINT | TOKEN_REQUIRED | SERVER_VALIDATION | FAILURE_HANDLING | USER_MESSAGE | TEST_COVERAGE | STATUS |
|---|---|---|---|---|---|---|---|---|
| Email login | `client/src/pages/login.tsx` | Firebase Auth, then `/api/user/settings/:uid` | yes for settings | `verifyIdToken(token, true)` + ownership | bounded UI state, settings retry, synchronous single-flight | friendly invalid/network/rate-limit messages | smoke source contract + existing routing tests | FIXED double submit |
| Password reset | `client/src/pages/login.tsx` | Firebase Auth | no app bearer | provider validation | loading reset in finally; enumeration-safe user-not-found response | actionable | source review | REVIEWED |
| Signup | `client/src/pages/signup.tsx` | Firebase Auth + settings/referral | yes | token UID ownership | preserves referral fallback | friendly | existing routing/referral tests | PARTIAL |
| Session restore | `PrivateRouter.tsx`, `firebase.ts` | plan initialization | yes | revoked-token check | auth listener redirects to login; initialization failure does not loop | skeleton/login | auth tests | PARTIAL |
| Authenticated API | `client/src/lib/api-client.ts` | all protected `/api/*` | yes | server `requireAuth` | auth-token and fetch share deadline; no automatic write retry | mapped 401/403/429/5xx | security auth timeout + smoke | PASS_TARGETED |
| Logout | `settings.tsx`, `firebase.ts` | Firebase Auth | n/a | n/a | clears scoped local data, Firestore persistence, query cache and telemetry | failure remains on page | existing LGPD/source tests | PASS_TARGETED |
| Account deletion | `account-deletion.tsx` | `DELETE /api/account` | yes | revoked-token + authenticated UID + tombstone | clears cache and signs out after confirmation | actionable | emulator/account-deletion tests | PASS_TARGETED |
| Account switch | `firebase.ts`, data hooks | Firestore/API | yes | UID-scoped paths and ownership | auth transition clears persistent cache and image cache | transparent | cross-account queue/Rules tests | PASS_TARGETED |

Google/Facebook login is not present in the reviewed primary login page. Mercado Pago
OAuth is an integration authorization flow and is not treated as application login.
The server checks revoked/disabled/deleted Firebase tokens on protected routes.
