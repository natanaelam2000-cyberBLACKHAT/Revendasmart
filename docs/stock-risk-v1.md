# Stock risk opportunities V1

## Sources

- Current stock: `users/{uid}/products/{productId}.stock`.
- Product availability: the same product document; `planAccessState === "preserved"`, `active === false`, and `published === false` are excluded.
- Recent sales: `users/{uid}/sales`, filtered by `date` in the last 30 days, ordered descending and capped at 500 documents.
- Sale items: `sales[].products[].productId` and `quantity`.

## Rule

`stock_risk` means a product is selling recently and the current stock covers only a short period at that recent pace. It is separate from `stalled_product`, which means the product has stock but has not sold for a long time.

The pure rule requires:

- at least 4 valid units sold in the 30-day window;
- at least 2 distinct sale days;
- positive finite current stock;
- positive finite item quantities;
- product still active and available to the seller;
- valid sale date, positive `totalPrice`, and no cancelled/refunded/deleted flags or terminal timestamps.

The velocity is:

```text
averageDailyUnitsSold = unitsSoldInWindow / 30
daysOfCover = currentStock / averageDailyUnitsSold
```

The opportunity appears when `daysOfCover <= 14`.

Priority is deterministic:

- `high`: `daysOfCover <= 7`;
- `medium`: `daysOfCover <= 14`.

The UI rounds `daysOfCover` to a whole commercial number, avoiding false precision.

## Cycle

The lifecycle fingerprint uses:

```text
stock_risk:{productId}:{currentStock}:{latestSaleAt}
```

This prevents the same condition from reappearing on reload. A new cycle is allowed after a material stock state change and a later valid sale.

## Limits

- The detector reads at most 500 recent sales.
- Product lookups are batched with `getAll`, capped at 60 refs.
- The pure candidate list is capped at 30 before the global opportunity engine sort/limit.
- No writes happen during page load or detection.

## Known limits

The rule is intentionally conservative. It can miss a product whose signal is older than 30 days or whose valid sales were outside the 500-document cap. It does not create suppliers, purchase orders, reorder automation, AI forecasts, push notifications, or reports integration.
