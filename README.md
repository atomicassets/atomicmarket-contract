# AtomicMarket V2.0
AtomicMarket is a marketplace to sell, auction and rent out [AtomicAssets](https://github.com/pinknetworkx/atomicassets-contract) NFTs. V2.0 builds on the AtomicAssets V2.0 contract.

### [Documentation can be found here.](docs/wiki/Home.md)

(V1 documentation for the upstream contract: [pinknetworkx wiki](https://github.com/pinknetworkx/atomicmarket-contract/wiki))

## Useful links
- API: https://github.com/pinknetworkx/eosio-contract-api
- Live API example: https://wax.api.atomicassets.io/atomicmarket/docs/
- Javascript module: https://www.npmjs.com/package/atomicmarket
- Test cases (using Hydra framework): https://github.com/pinknetworkx/atomicmarket-contract-tests
- Telegram group: https://t.me/atomicassets

## Key Features
	
- **NFTs do not have to be transferred for sales**

	Instead of using transfers, AtomicAssets **offers** are used for sales. These offers are only accepted when someone buys the NFTs for sale. Therefore, sellers keep ownership over their NFTs while they are listed on the AtomicMarket.

- **Custodial rentals**

	Assets can be rented out per hour. The owner lists an asset and transfers it into contract custody; renters pay from their deposited balance and receive the AtomicAssets V2 *holdership* of the asset for the rental period, while ownership stays with the contract. Rental payments are distributed like sale payouts, including royalties.

- **Royalty splits**

	On top of the collection fee, collection authors can configure how that fee is distributed: globally weighted founder accounts, per-template recipient lists, and attribute-matching rules (e.g. `rarity = legendary`), each with their own weights. The collection fee applied at settlement is always the fee at execution time, so author fee changes — discounts *and* increases — take effect immediately on all existing listings.

- **Single-asset listings**

	Every sale, auction and buyoffer contains exactly one asset (bundle listings were removed in V2.0; legacy bundle listings are cancelled when interacted with). To trade multiple assets at once, create multiple listings within a single transaction.

- **Support for any standard token**

	The AtomicMarket supports adding any number of standard tokens to support. This means that the market is not limited to a chain's core token (e.g. WAX), but instead new tokens can be added, which can then be used to sell and auction NFTs for.

- **Delphioracle Sales**

	On top of normal sales for standard tokens, the AtomicMarket contract can also use the [delphioracle](https://github.com/eostitan/delphioracle) to allow selling assets for any symbol which is then converted into an on-chain token at the time of purchase. An example would be listing an NFT for USD, which is then paid in WAX tokens at the exchange rate at the time of the pruchase.
	
- **Decentralized fee structure**

	There is no central account that receives fees for sales / auctions. Instead, anyone can register as a marketplace and receive fees for the sales / auctions they facilitate. By default, the maker marketplace (facilitating the listing) and the taker marketplace (facilitating the purchase) both receive **1% each** of any sale / auction.
	
- **Collection fees**

	Collections can define a market fee between 0 and 15% in the AtomicAssets contract. This fee is respected by the AtomicMarket and paid to the authors of the collection.
