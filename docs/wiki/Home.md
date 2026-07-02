# AtomicMarket V2.0

AtomicMarket is a marketplace smart contract for selling and auctioning
[AtomicAssets](https://github.com/pinknetworkx/atomicassets-contract) NFTs on Antelope chains.
V2.0 builds on the AtomicAssets V2.0 contract.

## What's new in V2.0

| Feature | Summary | Details |
|---|---|---|
| **Royalty splits** | The collection fee can be distributed across weighted founders, per-template recipients, and attribute-matching rules instead of going entirely to the collection author | [Royalty Splits](Royalty-Splits) |
| **Single-asset listings** | Every sale, auction and buyoffer contains exactly one asset; bundle listings were removed | [V2 Changes](V2-Changes) |
| **Execution-time collection fee** | Settlements apply the collection's fee at execution time, so author fee changes — down *or* up — take effect immediately on all existing listings | [V2 Changes](V2-Changes) |
| **CPU optimizations** | Lazy table construction, per-action config caching, size-capped raw reads of the collections table | [V2 Changes](V2-Changes) |

## Core concepts (unchanged from V1)

- **Deposits**: buyers pay from a deposited balance. Transfer any supported token
  to the market account with the memo `deposit`; withdraw any time with the `withdraw` action.
- **Sales**: `announcesale`, then activate by creating an AtomicAssets trade offer to the
  market account with the memo `sale`. Purchased with `purchasesale`.
- **Auctions**: `announceauct`, then activate by transferring the asset to the market account
  with the memo `auction`. Bid with `auctionbid`; settle with `auctclaimbuy` / `auctclaimsel`.
- **Buyoffers**: `createbuyo` (per asset) and `createtbuyo` (per template).
- **Marketplaces**: anyone can `regmarket` a marketplace name; the maker and taker
  marketplaces of a settlement each receive a configurable share (1% by default).
- **Delphi pricing**: listings can be priced in one symbol (e.g. USD) and settled in another
  (e.g. WAX) at the [delphioracle](https://github.com/eostitan/delphioracle) exchange rate at
  execution time.

## Settlement payout order

Every settlement (sale purchase, auction seller claim, buyoffer acceptance/fulfillment)
distributes the payment as follows:

1. Maker marketplace fee (default 1%)
2. Taker marketplace fee (default 1%)
3. Collection fee — the collection's fee **at execution time**, distributed per the
   collection's [royalty split config](Royalty-Splits), or in full to the collection author
   if none exists
4. Bonus fees (admin-configured, if applicable)
5. The remainder is paid out to the seller / listing owner directly

All fee shares accrue to the internal `balances` table and are claimed with `withdraw`.
The seller's share is transferred out directly at settlement.

## For developers

- Build: `make build` (native CDT 4.1.1) or `bash build.sh` (dockerized CDT)
- Tests: `yarn install && bash build.sh && npm test` (VeRT / `@vaulta/vert` suite)
- Ricardian clauses for all actions are embedded in the ABI (`resource/atomicmarket.contracts.md`)
