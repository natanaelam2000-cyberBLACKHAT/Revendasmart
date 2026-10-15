# Opportunity Outcomes V1

## Model and behavior

`opportunity_actions` retains `acted` / `dismissed`, the fingerprint/cycle and existing snapshots/timestamps. An acted record without `outcome` is displayed as awaiting_result. Explicit outcomes are `converted` or `no_result`, with `outcomeAt`. Transactions keep the first action/outcome stable on retries; a conflicting outcome returns 409. Dismissed records cannot receive outcomes.

Creating an action now requires a matching server-computed opportunity in the authenticated tenant. This closes the previous acceptance of arbitrary fingerprints. The bounded detector is re-evaluated on an initial action POST, so an opportunity that has disappeared or fallen outside the current response window returns 404 and can be refreshed.

## References

Optional `{type,id}` references use existing tenant subcollections: sale → sales, installment → installments, work → serviceWorks. Inactive-client/stalled-product opportunities accept sales; idle-schedule accepts work; overdue-receivable accepts only its exact installment. The server validates type, document existence and ownership before writing. No financial fields are persisted with the action. Opening the associated result reads the authoritative document again; missing/deleted sources return 404. Work results also link to their existing detail page.

## Metrics and costs

The shared aggregation counts acted records, converted, no_result and awaiting; dismissed is excluded. Conversion rate is converted / (converted + no_result), or zero for an empty denominator. History and metrics use the existing latest-500 query, ordered by updatedAt. This is a bounded recent-history measurement, not an all-time total; the UI states its scope. Reloads perform reads only. Result details cost two document reads on explicit click, with no per-card lookup on page load.

## Deferred

- Automatic overdue recognition: deferred. Correct manual attribution is implemented. Automatic recognition needs integration with authoritative payment commands; no writes are added to GET/page load and no heuristic attribution is used.
- Reports integration: deferred. It would add a history query to the strategic summary and another display surface. Metrics remain local to Opportunities with one shared calculation.

## Validation

- `npm run check`
- `npm test`
- `npm run test:plan-impl-07a` (includes outcomes, concurrent retries, reference rejection, Free/tenant isolation, result deletion and independent cycles)
- `npm run build`
- `npm run performance:bundle-check`
- `npm run lint`
- Browser: set `E2E_SPEC=tests/e2e/opportunity-outcomes.spec.ts`, then run the existing `scripts/e2e/run-account-deletion-e2e.mjs` inside Firebase auth/firestore/storage emulators for demo-revendasmart.

No push, deploy or Android/signing work is part of this change.
