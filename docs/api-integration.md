# AtomicMarket V2.0 — API / Indexer Integration Guide

Audience: the team updating the API reader (eosio-contract-api / atomicassets-api filler)
for the AtomicMarket V2.0 contract.

- **Code**: https://github.com/atomicassets/atomicmarket-contract (`master`)
- **User-facing docs**: https://github.com/atomicassets/atomicmarket-contract/wiki
- **Status**: merged, CI green, **not yet deployed on-chain** — you can develop against a
  testnet deployment or the VeRT suite (`yarn install && bash build.sh && npm test`;
  `tests/market-smoke.test.js` doubles as an executable spec of every flow described here)
- **Depends on**: AtomicAssets V2.0 (`holders` table, `move` action, `templates2` mutable
  template data) — the rentals feature is built on AA holdership

## 1. Interface delta at a glance

**New tables** (section 2): `rentals`, `royaltyconf`, `royaltytemp`, `royaltyattr`.
No existing table changed its layout.

**New actions**:

| Group | Actions |
|---|---|
| Rentals | `announcerent`, `cancelrent`, `rentasset`, `endrent`, `payrentram` |
| Rental logs | `lognewrent`, `logrentstart`, `logrental` |
| Royalty config | `setroyalconf`, `delroyalconf`, `settemplroy`, `deltemplroy`, `setattrroy`, `delattrroy` |
| Royalty logs | `logroyfound`, `logroytempl`, `logroyattr`, `logroydust` |

**New transfer memo**: AtomicAssets transfers to the market account with memo `rental`
activate rental listings (existing memos unchanged: `deposit` for tokens, `auction` for
auction transfers, `sale` / `buyoffer` / `tbuyoffer` for offers).

**Behavior changes to existing actions** (section 5 — these WILL break naive state
machines): single-asset listings, legacy-bundle auto-cancellation, execution-time
collection-fee discounting.

**Important for trace consumption**: none of the royalty log actions notify any account
(`require_recipient` deliberately absent — a notified recipient contract could abort
settlements). If your reader is notification-driven rather than trace-driven, these
actions are invisible to it. `logrental` notifies the lister and renter; `lognewrent` and
`logrentstart` notify the lister.

## 2. New tables

### `rentals` — scope: contract account

One row per listed asset (a rental listing holds exactly one asset; the asset id IS the key).

| Field | Type | Notes |
|---|---|---|
| `asset_id` | uint64 | primary key |
| `owner` | name | listing creator; receives rental payouts |
| `holder` | name | current renter; empty name when not rented out |
| `price_per_hour` | asset | in the listing symbol |
| `settlement_symbol` | symbol | what rentals are paid in (delphi pair if ≠ listing symbol) |
| `maximum_rental_duration` | uint32 | seconds; cap per rental incl. extensions |
| `rental_end` | uint32 | sec since epoch; 0 when not rented out |
| `asset_transferred` | bool | true once the asset is in contract custody |
| `maker_marketplace` | name | |
| `collection_name` | name | |
| `collection_fee` | float64 | fee at listing time (see fee discount, section 5.3) |

Secondary index `rentalends` (uint64 on `rental_end`) — useful for expiry sweeps.

### `royaltyconf` — scope: contract account

Per-collection royalty split config. PK: `collection`.

| Field | Type |
|---|---|
| `collection` | name |
| `founders` | `ROYALTYPAIR[]` = `{recipient: name, weight: uint32}[]` |
| `attribute_mode` | uint8 — 0 merged, 1 granular per-source |
| `split_founders` / `split_templates` / `split_attributes` | uint32 category weights |

### `royaltytemp` — scope: collection name

PK: `template_id` (stored int32, keyed as uint64). Fields: `template_id` (int32),
`recipients` (`ROYALTYPAIR[]`).

### `royaltyattr` — scope: collection name

| Field | Type | Notes |
|---|---|---|
| `index` | uint64 | PK = the rule id; allocated from a persistent counter, **never reused** |
| `source` | uint8 | 0 merged / 1 templ immutable / 2 asset immutable / 3 templ mutable / 4 asset mutable |
| `field` | string | |
| `value` | `ATOMIC_ATTRIBUTE` variant | same variant type as AtomicAssets data |
| `weight` | uint32 | the rule's weight within the attributes category |
| `recipients` | `ROYALTYPAIR[]` | |
| `lookup_hash` | checksum256 | sha256(pack(source, field, value)); secondary index `byhash` |

## 3. Rentals — workflow and indexing signals

State machine of a `rentals` row:

```
(none) --announcerent--> LISTED(asset_transferred=false)
LISTED --AA transfer memo "rental"--> ACTIVE(asset_transferred=true, holder="")
ACTIVE --rentasset--> RENTED(holder=renter, rental_end=T)
RENTED --rentasset by same renter, before T--> RENTED(rental_end += hours*3600)   [extension]
RENTED, after T --rentasset by anyone--> RENTED(new holder, rental_end = now + hours*3600)
RENTED, after T --endrent (anyone)--> ACTIVE(holder="", rental_end=0)
ACTIVE or expired-RENTED --cancelrent (owner)--> (row erased, asset returned)
LISTED --cancelrent (owner; anyone if owner no longer owns the asset)--> (row erased)
```

Per-action effects:

| Action / signal | Auth | State effects | Log emitted |
|---|---|---|---|
| `announcerent(lister, asset_id, price_per_hour, settlement_symbol, maximum_rental_duration, maker_marketplace)` | lister | rentals row created | `lognewrent(asset_id, lister, price_per_hour, settlement_symbol, maximum_rental_duration, maker_marketplace, collection_name, collection_fee)` |
| AA `transfer(from, to=market, [asset_id], "rental")` | — | `asset_transferred = true`; market becomes AA owner | `logrentstart(asset_id, lister)` per asset (a multi-asset transfer activates each asset's own listing) |
| `rentasset(renter, asset_id, rental_hours, expected_price_per_hour, intended_delphi_median, taker_marketplace)` | renter | renter balance debited; payout distributed (section 4); `holder = renter`, `rental_end` set; inline AA `move` shifts holdership to the renter — skipped when the renter already holds it (extensions, AND an expired rental re-rented by the same renter without an intervening `endrent`). Do not assume every non-extension `logrental` has a sibling AA `move` trace | `logrental(rental_counter_id, asset_id, lister, renter, rental_hours, paid_settlement_price, rental_end, taker_marketplace)` |
| `endrent(asset_id)` | **anyone** | `holder = ""`, `rental_end = 0`; inline AA `move` returns holdership to the market | — |
| `cancelrent(asset_id)` | owner (anyone if listing invalid & not activated) | row erased; if custodied: holdership reclaimed if needed, asset transferred back to owner | — |
| `payrentram(payer, asset_id)` | payer | row erased + re-created with new RAM payer; **contents unchanged** (do not treat as a state change) | — |

Indexing recipes:

- **`rental_counter_id`** in `logrental` is a global, monotonically increasing rental event
  id (from the `counters` table, name `rental`) — a natural primary key for rental events.
- **Extensions**: trust `logrental.rental_end` directly; it is the new absolute end. An
  extension is recognizable as `renter == previous holder && previous rental_end > block_time`.
- **Effective user of an asset**: from the AA `holders` table (`owner = market account,
  holder = renter`). After expiry the holders row persists until `endrent` / next rental /
  `cancelrent` — treat `rental_end <= now` as "rental over" regardless.
- **Paid price**: `logrental.paid_settlement_price` is the final settled amount (already
  delphi-converted if the listing is oracle-priced).
- `rentasset` aborts with "currently rented out" for non-holders during an active rental —
  no state to index on failure (failed transactions don't reach the chain).

## 4. Royalty splits — config and settlement

### 4.1 Config CRUD

All six actions require the **collection author's** authorization (authorized accounts are
rejected — config controls fund routing). The author pays RAM.

| Action | Notes |
|---|---|
| `setroyalconf(collection_name, founders, attribute_mode, split_founders, split_templates, split_attributes)` | upsert; ≥1 split > 0; `founders` empty iff `split_founders == 0`; `attribute_mode` locked while rules exist |
| `delroyalconf(collection_name)` | requires royaltytemp + royaltyattr empty for the collection |
| `settemplroy(collection_name, template_id, recipients)` | upsert; template must exist |
| `deltemplroy(collection_name, template_id)` | |
| `setattrroy(collection_name, source, field, value, rule_weight, recipients)` | **upserts by exact (source, field, value)** — watch for modifies, not just emplaces; new rules get a fresh `index` from the counter |
| `delattrroy(collection_name, rule_id)` | |

Validation guarantees you can rely on: recipient lists are 1–64 entries, weights > 0, no
duplicate recipients, all recipients exist; rule values are never float/double or vectors;
`source` is 0 in merged mode, 1–4 in granular mode.

### 4.2 Settlement: who gets the collection fee

Every settlement — `purchasesale`, `auctclaimsel`, `acceptbuyo`, `fulfilltbuyo`,
`rentasset` — distributes the payment: maker fee, taker fee, **collection fee**, bonus
fees, remainder to the seller/lister (transferred out directly; everything else accrues to
the `balances` table, claimed via `withdraw`).

For the collection fee:

- **No `royaltyconf` row** → the full collection fee goes to the author's balance.
  **No log is emitted in this case** — compute the author's earnings yourself (see 5.3 for
  the amount).
- **Legacy bundle payout** (only reachable via `auctclaimsel` on a buyer-claimed pre-V2
  bundle auction) → the full collection fee goes to the author, even when a royalty config
  exists, and no logs are emitted.
- **Config exists** → the engine splits per category and emits logs:

| Log | Emitted | Payload |
|---|---|---|
| `logroyfound(collection_name, asset_id, payouts)` | once per asset with founders payouts | `payouts: ROYALTYPAYOUT[]` = `{recipient: name, amount: asset}[]` |
| `logroytempl(collection_name, asset_id, template_id, payouts)` | once per asset with template payouts | |
| `logroyattr(collection_name, asset_id, rule_id, payouts)` | once per **matched rule** with payouts | `rule_id` = `royaltyattr.index`, stable forever |
| `logroydust(collection_name, collection_author, amount)` | once per settlement if anything fell through to the author | rounding remainders + shares of assets with no matching category |

**Invariant you can assert in the reader**: for one settlement,
`sum(all logroy* payout amounts) == the collection fee amount applied` — exactly, to the
unit. The logs are emitted even when the only category is dust.

You do NOT need to re-implement the split math (category renormalization, two-level rule
weighting, dust) — the logs carry the final per-recipient amounts. The math lives in
`distribute_collection_fee` in `src/atomicmarket.cpp` if you want to cross-check.

## 5. Breaking behavior changes

### 5.1 Single-asset listings

`announcesale`, `announceauct`, `createbuyo` now reject `asset_ids.size() != 1`. All new
sales/auctions/buyoffers reference exactly one asset. (`rentals` and `tbuyoffers` were
single-asset by design.)

### 5.2 Legacy bundle rows auto-cancel — execution actions no longer always mean a trade

Rows with `asset_ids.length > 1` can only predate V2. When one is touched, the action
**succeeds** but performs a cancellation instead of a trade. Your state machine must branch
on the row's asset count (which you already have in your DB):

| Action on a bundle row | What actually happens | DB effect |
|---|---|---|
| `purchasesale` | sale cancelled (AA offer declined); buyer charged nothing | sale → cancelled, **not** sold |
| `auctionbid` (unclaimed auction) | auction dissolved; existing bid refunded to bidder's balance; custodied assets returned to seller | auction → cancelled; no bid recorded |
| `auctclaimbuy` / `auctclaimsel` (ended, fully unclaimed) | dissolved; winning bid refunded; assets returned to seller | auction → cancelled, **not** settled |
| `auctclaimbuy` (seller claimed pre-V2) | completes normally — assets transferred to the winner | settle as in V1 |
| `auctclaimsel` (buyer claimed pre-V2) | seller paid out, BUT the collection cut goes to the **author in full** — bundles never touch the royalty split engine, and **no `logroy*` actions are emitted** for this payout | settle; attribute the whole collection fee to the author |
| `acceptbuyo` | buyoffer cancelled; escrow returned to buyer's balance | buyoffer → declined-equivalent |
| `cancelsale` / `cancelauct` | now allowed for **anyone** on bundles (and bundle auctions with bids, refunding the bidder) — EXCEPT partially-claimed bundle auctions, which can't be cancelled | cancelled |
| offer memo `sale` / transfer memo `auction` with >1 assets | transaction aborts (bundles can't activate) | nothing |

### 5.3 Execution-time collection fee discount

The applied collection fee is `min(fee stored in the listing row, the collection's
market_fee on AtomicAssets at execution time)`. The `collection_fee` field in
sales/auctions/buyoffers/rentals rows is therefore an **upper bound**, not the applied fee.

- With a royalty config: the applied amount = the logged `logroy*` sum (section 4.2).
- Without: applied amount = `floor(min(row.collection_fee, current AA market_fee) × price)`
  — you already track AA `setmarketfee`, so both inputs are in your DB.

This is deliberate product behavior (authors can run temporary collection-wide discounts);
expect fee changes mid-listing to be common, not exceptional.

### 5.4 Royalty config authorization

Unlike most collection-scoped things in the ecosystem, royalty config actions are valid
ONLY with the **author's** auth. If you surface "who may edit", do not show authorized
accounts for these.

## 6. Unchanged

Deposits/withdrawals and the `balances` table, marketplace registration and maker/taker
fees, bonus fees, the sale/auction/buyoffer/tbuyoffer happy paths and their existing log
actions (`lognewsale`, `lognewauct`, `lognewbuyo`, `lognewtbuyo`, `logsalestart`,
`logauctstart`), assert actions, `paysaleram`/`payauctram`/`paybuyoram` (joined by
`payrentram`), counters, the config singleton layout (version reports `2.0.0`).

The deployed ABI keeps the legacy spellings your readers already handle (`key`/`value`
pair fields, `uint8[]`) — `make release` post-processes the raw CDT 4.1 ABI exactly like
the AtomicAssets V2 release does.

## 7. Quick reference: everything to add to your action filter

```
setroyalconf delroyalconf settemplroy deltemplroy setattrroy delattrroy
announcerent cancelrent rentasset endrent payrentram
lognewrent logrentstart logrental
logroyfound logroytempl logroyattr logroydust
```

Plus: AA `transfer` notifications to the market account with memo `rental`, and the AA
`holders` table / `logmove` if you want real-time holdership (you likely index those for
AA V2 already).

Questions: the VeRT suite (`tests/market-smoke.test.js`) demonstrates every flow above
end-to-end, including the exact balance outcomes — it is the fastest way to answer "what
exactly happens on chain when X".
