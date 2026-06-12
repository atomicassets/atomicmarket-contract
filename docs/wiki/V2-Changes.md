# V2 Changes & Migration

This page covers the V2.0 changes that affect existing users, integrators and indexers,
beyond the two new feature sets ([Royalty Splits](Royalty-Splits), [Rentals](Rentals)).

## Single-asset listings (bundle removal)

Every sale, auction and buyoffer now contains **exactly one asset**. `announcesale`,
`announceauct` and `createbuyo` reject `asset_ids` vectors with more than one entry.

**Why:** bundles complicated royalty splitting (per-asset attribution of the collection
fee), and batching at the *transaction* level — multiple single-asset listings created and
purchased in one transaction — covers the same use cases cleanly.

**Migration of legacy bundle listings** (rows created before V2):

| Interaction | Result |
|---|---|
| `purchasesale` on a bundle sale | No purchase; the sale is cancelled, the buyer is charged nothing |
| `auctionbid` on an unclaimed bundle auction | No bid; the auction is dissolved — existing bid refunded, custodied assets returned to the seller |
| `auctclaimbuy` / `auctclaimsel` on an ended, fully unclaimed bundle auction | Dissolved — winning bid refunded, assets returned to the seller |
| `auctclaim*` on a **partially claimed** bundle auction | Completes (one side was already served; dissolving would pay one party twice). On the seller claim, the collection fee goes to the collection author in full — bundles never touch the royalty split engine |
| `acceptbuyo` on a bundle buyoffer | No trade; the buyoffer is cancelled, the escrowed price returned to the buyer |
| `cancelsale` / `cancelauct` on a bundle | Allowed for **anyone** (bundles count as invalid listings); bundle auctions with bids refund the bidder |
| Activating a bundle (offer memo `sale` / transfer memo `auction` with multiple assets) | Rejected with a pointer to the cancel actions |

## Collection fee discounts

Settlements apply `min(collection fee stored at listing time, collection fee at execution
time)`. Lowering a collection's fee on AtomicAssets therefore immediately discounts **all
existing listings** of the collection — enabling temporary, collection-wide promotion
windows — while *raising* the fee never affects already-created listings retroactively.
This applies to sales, auctions, both buyoffer types and rentals.

## For indexers and API providers

New tables: `royaltyconf`, `royaltytemp`, `royaltyattr` (see [Royalty Splits](Royalty-Splits)),
`rentals` (see [Rentals](Rentals)).

New actions to index:

- Royalty config CRUD: `setroyalconf`, `delroyalconf`, `settemplroy`, `deltemplroy`,
  `setattrroy`, `delattrroy`
- Royalty distribution logs: `logroyfound`, `logroytempl`, `logroyattr`, `logroydust` —
  the logs of one settlement sum to exactly the collection fee, so royalty earnings can be
  indexed without re-implementing the split math. These actions notify no accounts; read
  them from action traces.
- Rentals: `announcerent`, `cancelrent`, `rentasset`, `endrent`, `payrentram`, plus the
  logs `lognewrent`, `logrentstart`, `logrental`
- Note that rule ids in `logroyattr` are never reused (persistent counter), so they are
  stable keys for historical data.

Behavioral changes to existing actions: the legacy-bundle table above (purchases/bids/
accepts of bundle rows now mutate state *without* trading), and the effective collection
fee at settlement may be lower than the fee stored in the listing row.

## CPU optimizations (no external behavior change)

- Tables are constructed lazily inside actions instead of on every dispatch
- The config singleton is deserialized at most once per action
- The AtomicAssets `collections` row is read via a size-capped raw `db_get_i64` window
  that extracts only the author and market fee and never deserializes the (potentially
  very large) description blob
- Notification handlers are bound with `[[eosio::on_notify]]` (exact AtomicAssets matches
  take precedence over the `*::transfer` wildcard)

## Versioning

The config singleton reports version `2.0.0`. The contract builds with CDT 4.1.1; the
release ABI is post-processed (`make release`) to restore legacy ABI spellings
(`key`/`value` pair fields, `uint8[]`) for compatibility with deployed integrations.
