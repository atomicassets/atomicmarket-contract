# Rentals

AtomicMarket V2 supports **custodial per-hour rentals** built on the AtomicAssets V2
holdership system: while an asset is rented, the renter is its **holder** (visible to games
and dApps through the AtomicAssets `holders` table) while the **ownership** stays with the
market contract, so the renter can never run away with the asset.

## Lifecycle

```
announcerent ──> transfer (memo "rental") ──> rentasset ──> [extensions] ──> endrent ──┐
     │                  (custody)               (rented)                  (listed again)│
     └──────────────────────────── cancelrent (asset returned) <────────────────────────┘
```

1. **List** — the owner announces the listing with its terms:

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

   - `price_per_hour` is denoted in the listing symbol. If it differs from
     `settlement_symbol`, a delphi pair must be configured and the rental is paid in the
     settlement symbol at the oracle rate at renting time (e.g. price in USD, paid in WAX).
   - `maximum_rental_duration` (seconds) is the longest period one rental — including
     extensions by the same renter — can cover. Minimum 3600 (one hour), maximum 10 years.

2. **Activate** — the owner transfers the asset to the market account with the memo
   `rental`. The contract becomes the custodial owner. Each asset is its own listing
   (one listing per asset id).

3. **Rent** — a renter pays from their deposited balance:

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

   - The total price (`price_per_hour × hours`, oracle-converted if applicable) is deducted
     from the renter's balance and paid out like a sale: marketplace fees, the collection
     fee (with [royalty splits](Royalty-Splits) and
     [fee discounts](V2-Changes)), remainder to the listing owner.
   - The AtomicAssets holdership of the asset moves to the renter until `rental_end`.
   - `expected_price_per_hour` protects the renter against listing changes between signing
     and execution.

4. **Extend** — the *current* renter can call `rentasset` again while their rental is
   active; the purchased hours are appended to the current period. The combined remaining
   period must stay within `maximum_rental_duration`. Rentals never renew automatically.

5. **Wrap up** — after `rental_end`, **anyone** may call `endrent(asset_id)`. It moves the
   holdership back to the market contract, making the listing rentable again. If nobody
   calls it, the next `rentasset` moves holdership directly from the expired renter to the
   new renter.

6. **Cancel** — the owner reclaims the asset with `cancelrent(asset_id)` whenever no rental
   is actively running (also handles expired-but-not-ended rentals by reclaiming holdership
   first). A not-yet-activated listing whose owner no longer owns the asset is invalid and
   may be cancelled by anyone.

## Actions

| Action | Auth | Effect |
|---|---|---|
| `announcerent(lister, asset_id, price_per_hour, settlement_symbol, maximum_rental_duration, maker_marketplace)` | lister | Create a rental listing |
| `cancelrent(asset_id)` | owner (anyone if invalid) | Cancel the listing; return the asset if custodied |
| `rentasset(renter, asset_id, rental_hours, expected_price_per_hour, intended_delphi_median, taker_marketplace)` | renter | Rent or extend; pays from the renter's balance |
| `endrent(asset_id)` | anyone | Reset an expired rental back to its listed state |
| `payrentram(payer, asset_id)` | payer | Take over the RAM cost of the listing row |

Log actions: `lognewrent` (listing created), `logrentstart` (custody received, listing
active), `logrental` (rental executed: renter, hours, paid price, rental_end).

## The `rentals` table

| Field | Meaning |
|---|---|
| `asset_id` | primary key — one listing per asset |
| `owner` | the listing creator; receives the rental payouts |
| `holder` | the current renter; empty when not rented out |
| `price_per_hour` | in the listing symbol |
| `settlement_symbol` | what rentals are actually paid in |
| `maximum_rental_duration` | seconds; cap for a single rental incl. extensions |
| `rental_end` | seconds since epoch; 0 when not rented out (secondary index `rentalends`) |
| `asset_transferred` | true once the asset is in contract custody |
| `maker_marketplace`, `collection_name`, `collection_fee` | listing metadata |

## Integration notes for games and dApps

- To honor rentals, resolve an asset's *effective user* through the AtomicAssets `holders`
  table: if a row exists for the asset, the `holder` is the active user; otherwise the
  owner is. Rented assets have `owner = atomicmarket` and `holder = <renter>`.
- `rental_end` is tracked in the market's `rentals` table (with a secondary index by end
  time for expiry sweeps). After expiry the holdership remains with the previous renter
  until `endrent`, the next rental, or `cancelrent` resets it — treat
  `rental_end <= now` as "rental over" regardless of the holders table.
- Royalties apply to rentals exactly as to sales, including the royalty log actions.
