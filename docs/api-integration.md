# AtomicMarket V2.0 — API / Indexer Integration Guide

Audience: the team updating the API reader (eosio-contract-api / atomicassets-api filler)
for the AtomicMarket V2.0 contract.

- **Code**: https://github.com/atomicassets/atomicmarket-contract (`main`)
- **User-facing docs**: https://github.com/atomicassets/atomicmarket-contract/wiki
- **Status**: merged, CI green, **not yet deployed on-chain** — you can develop against a
  testnet deployment or the VeRT suite (`yarn install && bash build.sh && npm test`;
  `tests/market-smoke.test.js` doubles as an executable spec of every flow described here)
- **Depends on**: AtomicAssets V2.0 (`templates2` mutable template data)

## 1. Interface delta at a glance

**New tables** (section 2): `royaltyconf`, `royaltytemp`, `royaltyattr`.
No existing table changed its layout.

**New actions**:

| Group | Actions |
|---|---|
| Royalty config | `setroyalconf`, `delroyalconf`, `settemplroy`, `deltemplroy`, `setattrroy`, `delattrroy` |
| Royalty logs | `logroyfound`, `logroytempl`, `logroyattr`, `logroydust` |

**Behavior changes to existing actions** (section 5 — these WILL break naive state
machines): single-asset listings, legacy-bundle auto-cancellation, execution-time
collection fee (applied at settlement, section 4.3).

**Important for trace consumption**: none of the royalty log actions notify any account
(`require_recipient` deliberately absent — a notified recipient contract could abort
settlements). If your reader is notification-driven rather than trace-driven, these
actions are invisible to it.

## 2. New tables

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
| `source` | uint8 | 0 merged / 1 asset immutable / 2 asset mutable / 3 templ immutable / 4 templ mutable |
| `field` | string | |
| `value` | `ATOMIC_ATTRIBUTE` variant | same variant type as AtomicAssets data |
| `weight` | uint32 | the rule's weight within the attributes category |
| `recipients` | `ROYALTYPAIR[]` | |
| `lookup_hash` | checksum256 | sha256(pack(source, field, value)); secondary index `byhash` |

## 3. Royalty splits — config and settlement

### 3.1 Config CRUD

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

### 3.2 Settlement: who gets the collection fee

Every settlement — `purchasesale`, `auctclaimsel`, `acceptbuyo`, `fulfilltbuyo` —
distributes the payment: maker fee, taker fee, **collection fee**, bonus
fees, remainder to the seller/lister (transferred out directly; everything else accrues to
the `balances` table, claimed via `withdraw`).

For the collection fee:

- **No `royaltyconf` row** → the full collection fee goes to the author's balance.
  **No log is emitted in this case** — compute the author's earnings yourself (see 4.3 for
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

## 4. Breaking behavior changes

### 4.1 Single-asset listings

`announcesale`, `announceauct`, `createbuyo` now reject `asset_ids.size() != 1`. All new
sales/auctions/buyoffers reference exactly one asset. (`tbuyoffers` were single-asset by
design.)

### 4.2 Legacy bundle rows auto-cancel — execution actions no longer always mean a trade

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

### 4.3 Execution-time collection fee

The applied collection fee is the collection's `market_fee` on AtomicAssets **at execution
time**, read live at settlement — *not* the fee stored in the listing row. The
`collection_fee` field in sales/auctions/buyoffers rows is therefore informational
only (the fee at listing time); it does not determine the payout.

- With a royalty config: the applied amount = the logged `logroy*` sum (section 3.2).
- Without: applied amount = `floor(current AA market_fee × price)`
  — you already track AA `setmarketfee`, so the current fee is in your DB.

This is deliberate product behavior: the collection author has full control, and fee changes
— down *or* up — apply to all existing listings immediately. Expect fee changes mid-listing
to be common, not exceptional.

### 4.4 Royalty config authorization

Unlike most collection-scoped things in the ecosystem, royalty config actions are valid
ONLY with the **author's** auth. If you surface "who may edit", do not show authorized
accounts for these.

## 5. Unchanged

Deposits/withdrawals and the `balances` table, marketplace registration and maker/taker
fees, bonus fees, the sale/auction/buyoffer/tbuyoffer happy paths and their existing log
actions (`lognewsale`, `lognewauct`, `lognewbuyo`, `lognewtbuyo`, `logsalestart`,
`logauctstart`), assert actions, `paysaleram`/`payauctram`/`paybuyoram`, counters, the
config singleton layout (version reports `2.0.0`).

The deployed ABI keeps the legacy spellings your readers already handle (`key`/`value`
pair fields, `uint8[]`) — `make release` post-processes the raw CDT 4.1 ABI exactly like
the AtomicAssets V2 release does.

## 6. Quick reference: everything to add to your action filter

```
setroyalconf delroyalconf settemplroy deltemplroy setattrroy delattrroy
logroyfound logroytempl logroyattr logroydust
```

Questions: the VeRT suite (`tests/market-smoke.test.js`) demonstrates every flow above
end-to-end, including the exact balance outcomes — it is the fastest way to answer "what
exactly happens on chain when X".
