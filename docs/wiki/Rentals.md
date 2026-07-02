# Rentals

AtomicMarket supports **non-custodial per-hour rentals**. While an asset is rented, the renter
becomes the **real AtomicAssets owner** of it, so unmodified games, APIs and dApps grant the renter
the asset's utility with no special integration. The lister's right to get the asset back is parked
in the AtomicAssets `leases` table, the **single source of truth for the lock state**. The asset is
locked from transfer, burn and offer-out for the duration, and a permissionless `reclaim` force-returns
it to the lister at expiry. The asset is **never escrowed** in the market contract.

## Lifecycle

```
announcerent ──> rentasset ──> [extensions] ──> expiry ──> endrent / reclaim ──┐
     │           (renter = owner, locked)                   (returned, listed again)│
     └──────────────────────── cancelrent (when no active rental) <────────────────┘
```

1. **List** — the owner announces the listing with its terms. The asset stays in the owner's account;
   announcing does not move or lock it.

   ```sh
   cleos push action atomicmarket announcerent '{
     "lister": "alice",
     "asset_id": 1099511627776,
     "price_per_hour": "0.50000000 WAX",
     "settlement_symbol": "8,WAX",
     "maximum_rental_duration": 604800,
     "maker_marketplace": ""
   }' -p alice@active
   ```

   - `price_per_hour` is denoted in the listing symbol. If it differs from `settlement_symbol`, a
     delphi pair must be configured and the rental is paid in the settlement symbol at the oracle
     rate at renting time (e.g. price in USD, paid in WAX).
   - `maximum_rental_duration` (seconds) is the longest period one rental — including extensions by
     the same renter, measured from the lease's original start — can cover. Minimum 3600 (one hour),
     maximum 28 days (2,419,200 seconds). AtomicAssets enforces its own 28-day cap independently.
   - Each asset is its own listing (one listing per asset id).

2. **Rent** — a renter pays from their deposited balance:

   ```sh
   cleos push action atomicmarket rentasset '{
     "renter": "bob",
     "asset_id": 1099511627776,
     "rental_hours": 48,
     "expected_price_per_hour": "0.50000000 WAX",
     "intended_delphi_median": 0,
     "taker_marketplace": ""
   }' -p bob@active
   ```

   - The total price (`price_per_hour × hours`, oracle-converted if applicable) is deducted from the
     renter's balance and paid out like a sale: marketplace fees, the collection fee (with
     [royalty splits](Royalty-Splits) and [collection fee](V2-Changes)), remainder to the listing owner.
   - AtomicMarket drives AtomicAssets to make the renter the **real owner** of the asset until
     `rental_end`, and the asset is locked (its lock state lives in the AtomicAssets `leases` row).
   - `expected_price_per_hour` (and `intended_delphi_median` for oracle-priced listings) protect the
     renter against listing or price changes between signing and execution.

3. **Extend** — the *current* renter can call `rentasset` again while their rental is active; the
   purchased hours are appended to the current period. The combined period, measured from the lease's
   original start, must stay within `maximum_rental_duration`. Rentals never renew automatically.

4. **Wrap up** — after `rental_end`, **anyone** may call `endrent(asset_id)`, which triggers the
   permissionless AtomicAssets `reclaim`: it returns the asset to the lister and clears the lock,
   making the listing rentable again. `endrent` is idempotent — a second call once the asset is
   already reclaimed is a no-op. If nobody calls it, the next `rentasset` reclaims the expired lease
   and re-leases to the new renter in the same transaction.

5. **Cancel** — the owner removes the listing with `cancelrent(asset_id)` whenever no rental is
   actively running. Because nothing is escrowed, cancelling is just removing the listing row; an
   expired-but-unreclaimed rental is reclaimed to the owner as part of the cancel. A listing whose
   owner no longer owns the asset is invalid and may be cancelled by anyone.

## Actions

| Action | Auth | Effect |
|---|---|---|
| `announcerent(lister, asset_id, price_per_hour, settlement_symbol, maximum_rental_duration, maker_marketplace)` | lister | Create a rental listing (no escrow) |
| `cancelrent(asset_id)` | owner (anyone if invalid) | Remove the listing; reclaim first if expired-but-unreclaimed |
| `rentasset(renter, asset_id, rental_hours, expected_price_per_hour, intended_delphi_median, taker_marketplace)` | renter | Rent or extend; pays from the renter's balance |
| `endrent(asset_id)` | anyone | After expiry, reclaim the asset to the lister (idempotent) |
| `payrentram(payer, asset_id)` | payer | Take over the RAM cost of the listing row |

Market log actions: `lognewrent` (listing created), `logrental` (rental executed: renter, hours,
paid price, rental_end). The lock and return events are logged on the AtomicAssets side: `loglock`
(lease opened or extended) and `logreclaim` (asset returned). The reclaim path intentionally notifies
**no account that could veto it** (not the renter, not the title owner) so the guaranteed return
cannot be aborted — only the asset's collection is notified.

## The `rentals` table

The row is immutable listing config; the lock/renter/end state lives in the AtomicAssets `leases`
table, and the two join 1:1 on `asset_id`.

| Field | Meaning |
|---|---|
| `asset_id` | primary key — one listing per asset |
| `owner` | the listing creator; receives the rental payouts |
| `price_per_hour` | in the listing symbol |
| `settlement_symbol` | what rentals are actually paid in |
| `maximum_rental_duration` | seconds; cap for a single rental incl. extensions, from the lease start |
| `maker_marketplace` | the marketplace that brokered the listing |
| `collection_name` | the asset's collection |
| `collection_fee` | the collection fee snapshot at listing time (the live fee is re-read at payout) |

## Integration notes for games and dApps

- To honor rentals, treat the AtomicAssets **owner as the effective user**: during a lease the renter
  *is* the owner, so no special resolution is needed for utility. The lock state (whether a returnable
  lease is in force, and when it ends) is the AtomicAssets `leases` row for the asset.
- The `leases` row carries `title_owner` (the lister the asset returns to), `renter`, `rental_start`
  and `rental_end`. Treat `rental_end <= now` as "rental over"; after expiry the renter remains the
  owner until `endrent`, the next `rentasset`, or `cancelrent` triggers the reclaim.
- Royalties apply to rentals exactly as to sales, including the royalty log actions.
