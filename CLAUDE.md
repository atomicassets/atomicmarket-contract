# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AtomicMarket V2.0 is a marketplace smart contract (C++ / Antelope, formerly EOSIO) for trading
and renting [AtomicAssets](https://github.com/pinknetworkx/atomicassets-contract) NFTs. It builds
on the AtomicAssets V2.0 contract (developed in the sibling repo `../atomicassets-contract`,
branch `feat/v2-integration`) and extends the upstream AtomicMarket with:

- **Royalty splits**: a collection's market fee can be distributed across weighted founders,
  per-template recipients, and attribute-matching rules instead of going entirely to the
  collection author
- **Custodial rentals**: per-hour asset rentals using the AtomicAssets V2 `holders` table and
  `move` action (the market contract holds ownership, the renter receives holdership)
- **Single-asset listings only**: bundle listings were removed (legacy bundle rows are
  auto-cancelled when touched); multiple assets are traded via multiple listings in one
  transaction
- **CPU optimizations**: lazy table construction, per-action config caching, and size-capped
  raw reads of the AtomicAssets collections table that skip the description blob

## Architecture

### Core Components

- **Contract implementation**: all action logic in `src/atomicmarket.cpp`
- **Contract header**: tables, actions, helpers in `include/atomicmarket.hpp`
- **External interfaces**: `include/atomicassets-interface.hpp` (AtomicAssets V2 tables),
  `include/delphioracle-interface.hpp` (price oracle for delphi-paired listings)
- **Shared AtomicAssets headers** (copied verbatim from the sibling repo - keep in sync):
  `include/atomicdata.hpp`, `include/checkformat.hpp`, `include/base58.hpp`

### Key Concepts

- **Sales / auctions / buyoffers / template buyoffers**: the upstream listing types; every
  listing holds exactly ONE asset
- **Rentals**: `announcerent` -> transfer with memo `"rental"` (custody) -> `rentasset`
  (pays per-hour price, holdership moves to renter) -> `endrent` after expiry (anyone) ->
  `cancelrent` (owner reclaims the asset)
- **Royalty configs** (`royaltyconf` / `royaltytemp` / `royaltyattr` tables): mutations require
  the collection AUTHOR's authorization only (financial config; authorized accounts are
  deliberately rejected). Category splits renormalize across categories that have payees;
  rounding dust goes to the collection author; payouts accrue to the `balances` table
  (recipients withdraw via `withdraw`) - never pushed as inline transfers
- **Collection fee at execution time**: settlements apply the collection's fee at execution
  time (read live from AtomicAssets), not the fee stored at listing time, so author fee
  changes — discounts and raises alike — take effect immediately on all existing listings;
  the stored `collection_fee` is retained only for indexing/logging
- **Notification handlers**: `[[eosio::on_notify]]` attributes in the header route
  `atomicassets::transfer`, `atomicassets::lognewoffer`, and wildcard `*::transfer` (token
  deposits); the exact atomicassets handlers take precedence over the wildcard
- **partial_read_collection**: reads the AtomicAssets collections row via raw
  `db_find_i64`/`db_get_i64` with a 1000-byte window (grow-on-truncation) to extract only the
  author and market_fee without deserializing the display-data blob; minimum valid row is
  28 bytes (empty vectors serialize to a single 0x00 length byte)

## Build Commands

```bash
# local build (no native CDT needed; uses the antelope-cdt docker image, CDT 4.1.1)
bash build.sh

# native build (requires cdt-cpp 4.1.1 on PATH; this is what CI runs)
make build

# distribution artifacts (wasm + legacy-compatible ABI for cleos set contract)
make release
```

`make release` runs `scripts/patch-abi.py`, which restores legacy ABI spellings
(pair key/value, uint8[]) for deployed-integration compatibility. Tests run against the RAW
CDT ABI - never patch the ABI for test builds.

## Testing

### Test Framework
- VeRT (`@vaulta/vert`) blockchain simulation, tests written in JavaScript with Jest
- Test configuration in `jest.config.js` (10-minute timeout)

### Running Tests
```bash
yarn install        # or npm install
bash build.sh       # tests deploy ./build/atomicmarket.wasm
npm test            # run all tests
npx jest market     # run test files matching a pattern
```

### Test Structure
- `tests/market-smoke.test.js` - end-to-end suite: notification dispatch routing, sale payouts
  (legacy + royalty splits with exact integer math), execution-time collection fee, bundle-removal behavior
  (including legacy rows injected via `tables.X(...).set(...)`), and the full rental lifecycle
- `tests/fixtures/eosio.token/` - token contract fixture (wasm + abi)
- `tests/fixtures/atomicassets/` - the AtomicAssets V2 contract the market integrates with.
  Rebuild from the sibling repo (`bash ../atomicassets-contract/build.sh`) and re-copy the
  wasm/abi here whenever AtomicAssets changes

## Code Formatting
```bash
npm run prettier  # Format JavaScript test files
```

## Development Notes

- The contract compiles with CDT 4.1.1; ricardian clauses live in
  `resource/atomicmarket.contracts.md` and are embedded into the ABI via the `-R./resource`
  flag - every action must have a clause (a "does not have a ricardian contract" warning
  on build means a new action is missing one)
- Safety-critical invariants: royalty payouts must sum EXACTLY to the collection cut
  (uint128 intermediate math, dust to author); settlement must never be blockable by a
  recipient (accrue-to-balances only); legacy bundle auctions in partially-claimed states
  must complete via the claim actions (dissolving them would pay one side twice)
- All listing/settlement paths read collection data through `partial_read_collection` -
  if AtomicAssets ever changes the collections row layout, update that parser
