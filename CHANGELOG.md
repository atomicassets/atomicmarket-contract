# Changelog

Notable changes to the AtomicMarket contract. This file starts at 2.0.0; the
releases published before it live in
[GitHub Releases](https://github.com/atomicassets/atomicmarket-contract/releases).

Entry headings keep the `## [X.Y.Z] - YYYY-MM-DD` form. Each entry opens with a
summary line, then carries the sections that `RELEASING.md` defines, in that
order; the entry is the editorial text of the version's GitHub Release. This
project follows semantic versioning.

## [2.0.0] - 2026-08-03

The AtomicMarket v2 contract: royalty splits, single-asset listings, and a collection fee charged at execution time.

### Breaking changes

- A sale, auction or buyoffer references exactly one asset, and `announcesale`, `announceauct` and `createbuyo` reject more than one. Listing several assets in one transaction covers what bundles were used for, and single-asset rows keep per-asset attribution of the collection fee and the royalty split exact. (#1)
- A pre-v2 row holding more than one asset cancels when it is touched, rather than migrating. `purchasesale` cancels the sale and charges the buyer nothing, a bid or claim on a bundle auction dissolves it with the bid refunded and the assets returned, and `acceptbuyo` refunds the buyer. `cancelsale` and `cancelauct` on a bundle may be called by anyone, and activating a bundle through the `sale` offer memo or the `auction` transfer memo aborts. (#1)
- A partially claimed bundle auction finishes through the normal claim actions, because one side was already served. The collection fee goes to the author in full and no royalty logs are emitted. (#2)
- Settlement reads the collection's `market_fee` live from AtomicAssets at execution time, not the value stored when the listing was created. A fee change by the author, up or down within the 15% cap, applies at once to every existing listing, and the listing row's `collection_fee` is informational only. The buyer always pays the listed price and only the split between seller and collection moves, so a front end shows the live fee at the point of sale. (#3)

### Upgrading

| Asset | sha256 |
| --- | --- |
| `atomicmarket.wasm` | `5016d9560574cce18f511de41d4ba1e81c4d30526c4452f0f70c3e59d64e7ed3` |
| `atomicmarket.abi` | `e1b480faeb6f59f8f474af28677907a25d0d58e455d5a951f2315a87012177a9` |

- The wasm sha256 equals the on-chain code hash, so `get_code_hash` confirms which bytes are running. The attached `SHA256SUMS` carries the same two values.
- The ABI is additive against v1.3.3: nothing is removed and no existing struct changes shape. The published ABI is the legacy-compat build, where `vector<uint8_t>` fields render as `uint8[]`, so a v1 reader keeps working unchanged. The ABI version moves from `eosio::abi/1.1` to `1.2`, and the behavior changes above are not expressed in the ABI at all.
- The final surface is 51 actions and 12 tables. The existing tables (`sales`, `auctions`, `buyoffers`, `tbuyoffers`, `config`, `balances`, `marketplaces`, `bonusfees`, counters) keep their layout, and the added tables are `royaltyconf`, `royaltytemp` and `royaltyattr`.
- Deploy AtomicAssets v2 on the chain first. Settlement reads the AtomicAssets `templates2` table for royalty attribute matching, and the collections row for the live market fee.
- A chain that does not yet run template buyoffers also gains `createtbuyo`, `canceltbuyo`, `fulfilltbuyo`, `lognewtbuyo` and the `tbuyoffers` table with this upgrade.
- The deploy is a `setcode` plus `setabi`. On-chain state is preserved, and existing single-asset sales, auctions and buyoffers keep working.
- `setversion` takes `2.0.0`.
- These bytes ran on the WAX testnet and jungle4 as rc2, where the on-chain code hash matched the table above. That was the first AtomicMarket v2 deployment on any chain.
- Signers of an msig proposal check the proposal's wasm sha256 against the table above, and its packed ABI against the published `.abi`, because the chain does not validate `setabi` payloads.

### Features

- By default the collection fee goes to the collection author, and an author can instead split it across weighted categories: a global founders list, per-template recipient lists, and attribute rules that match a `(field, value)` on the asset such as `rarity = legendary`. Configuration lives in the new `royaltyconf`, `royaltytemp` and `royaltyattr` tables. (#1)
- Settlement emits `logroyfound`, `logroytempl`, `logroyattr` and `logroydust`, whose amounts sum exactly to the collection fee, so an indexer records the final per-recipient amounts without reimplementing the split. These actions notify no account, so read them from action traces, and a `logroyattr` rule id is never reused. Payouts accrue to balances and are claimed with `withdraw`, and nothing is transferred inline, so a recipient contract cannot block a collection's settlements. (#1)
- `setdefmktcr` redirects the empty-name default marketplace's fee recipient at runtime, and `migratebal` merges accumulated balances, so one binary runs on a chain where the seeded `fees.atomic` account does not exist. `migratebal` rejects `from == to`, which would otherwise double a balance. (#7)
- Tables are constructed lazily per action, the config singleton is deserialized at most once per action, the AtomicAssets collections row is read through a size-capped partial read that takes only the author and the market fee, and notification handlers bind with `[[eosio::on_notify]]`. (#1)

### Bug fixes

- `assertsale`, `assertauct` and `acceptbuyo` compare asset lists with the four-iterator `std::is_permutation`, which checks the lengths and cannot read past the shorter list. `6da1ed7`
- Settlement re-asserts the execution-time fee between 0 and 15 percent, because a negative double cast to `uint64_t` is undefined behavior, and `acceptbuyo` and `fulfilltbuyo` check the AtomicAssets offers table before reading its last row. `2b0338f`

### Other changes

- `setmarketfee` and `addbonusfee` reject a fee configuration whose fees plus the maximum collection fee exceed the sale price, and `internal_payout_sale` asserts a positive seller payout as the runtime backstop. (#4)
- Custodial rentals are not part of v2. The implementation is preserved on the [`archive/v2-custodial-rentals`](https://github.com/atomicassets/atomicmarket-contract/tree/archive/v2-custodial-rentals) branch. (#13)
