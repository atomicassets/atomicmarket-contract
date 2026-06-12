Done (v2/integration-2):

- [x] Rewire everything to optimize for CPU usage
      (lazy table getters, per-action config cache, partial collection reads,
      pass-by-reference, announcesale / get_collection fixes)
- [x] Add support for atomic rentals
      (custodial per-hour rentals via AA v2 holders/move; announcerent ->
      transfer "rental" -> rentasset -> endrent / cancelrent)
- [x] Add support for atomic royalty splits - generative attributes and template based
      (founders / template / attribute categories with weighted recipients,
      author-only config, accrue-to-balances, full log actions)
- [x] Withdrawing bundle listings autonomously
      (bundle listings removed entirely; legacy bundle rows are invalid -
      anyone can cancel them, and execution paths auto-cancel/dissolve them)

To Do:

- Deploy to testnet and run the suite against a live AA v2 deployment
- Update the wiki / external docs for the V2 features (rentals, royalty
  splits, single-asset listings, fee discounts)
