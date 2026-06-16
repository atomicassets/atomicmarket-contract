<h1 class="contract">init</h1>

---
spec_version: "0.2.0"
title: Initialize config table
summary: 'Initialize the table "config" if it has not been initialized before'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
Initialize the table "config" if it has not been initialized before. If it has been initialized before, nothing will happen.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of {{$action.account}}.
</div>




<h1 class="contract">convcounters</h1>

---
spec_version: "0.2.0"
title: Converts config counters
summary: 'Converts deprecated config counters into using the counters table'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
The deprecated (since version 1.3.0) sale_counter and auction_counter in the config singleton are added to the counters table.

The counter values in the config singleton are set to 0.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of {{$action.account}}.
</div>




<h1 class="contract">setminbidinc</h1>

---
spec_version: "0.2.0"
title: Set minimum auction bid increase
summary: 'Sets the minimum auction bid increase to {{nowrap minimum_bid_increase}}'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---
<b>Description:</b>
<div class="description">
The minimum bid increase for auctions to {{minimum_bid_increase}}.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of {{$action.account}}.
</div>




<h1 class="contract">setversion</h1>

---
spec_version: "0.2.0"
title: Set config version
summary: 'Sets the version in the config table to {{nowrap new_version}}'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---
<b>Description:</b>
<div class="description">
The version in the config table is set to {{new_version}}.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of {{$action.account}}.
</div>




<h1 class="contract">addconftoken</h1>

---
spec_version: "0.2.0"
title: Add token to supported list
summary: 'Adds a to the supported tokens list in the config'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---
<b>Description:</b>
<div class="description">
The token with the symbol {{token_symbol}} from the token contract {{token_contract}} is added to the supported_tokens list.

This means this token can then be deposited and used for sales and auctions.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of {{$action.account}}.
</div>




<h1 class="contract">adddelphi</h1>

---
spec_version: "0.2.0"
title: Add a delphi symbol pair
summary: 'Adds a pair to the supported symbol pairs list in the config'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---
<b>Description:</b>
<div class="description">
A new symbol pair is added to the config.

It allows users to list an asset for sale with a listing price specified in {{listing_symbol}} which will be paid (settled) in {{settlement_symbol}}, which belongs to a supported token.

The exchange rate is calculated using the {{delphi_pair_name}} delphioracle pair.

{{#if invert_delphi_pair}}The delphioracle price data will be inverted.
{{/if}}
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of {{$action.account}}.
</div>




<h1 class="contract">setmarketfee</h1>

---
spec_version: "0.2.0"
title: Set the market fees
summary: 'Sets the market fees that are paid out to the marketplaces facilitating sales and auctions'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---
<b>Description:</b>
<div class="description">
The share that the maker market place will receive of successful sales and auctions is set to {{maker_market_fee}}.

The share that the taker market place will receive of successful sales and auctions is set to {{taker_market_fee}}.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of {{$action.account}}.
</div>




<h1 class="contract">regmarket</h1>

---
spec_version: "0.2.0"
title: Register a new market
summary: '{{nowrap creator}} creates a new marketplace with the name {{nowrap marketplace_name}}'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
{{nowrap creator}} creates a new marketplace with the name {{nowrap marketplace_name}}.

This marketplace name can then be used in the "announcesale", "announceauct", "purchasesale", "auctionbid" actions.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of {{creator}}.
</div>




<h1 class="contract">withdraw</h1>

---
spec_version: "0.2.0"
title: Withdraw fungible tokens
summary: '{{nowrap owner}} withdraws {{token_to_withdraw}} from his balance'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
{{owner}} withdraws {{token_to_withdraw}}.
The tokens will be transferred back to {{owner}} and will be deducted from {{owner}}'s balance.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of {{owner}}.
</div>




<h1 class="contract">announcesale</h1>

---
spec_version: "0.2.0"
title: Announce a sale
summary: '{{nowrap seller}} announces a sale of an asset'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
{{seller}} announces a sale for the asset with the following ID:
{{#each asset_ids}}
    - {{this}}
{{/each}}

A sale contains exactly one asset. To sell multiple assets, multiple sales can be created within a single transaction.

For this sale to become active, {{seller}} has to create an AtomicAssets trade offer in which he offers the aforementioned asset to the AtomicMarket account with the memo "sale".

The asset will be listed for the price of {{listing_price}} which will be settled in {{symbol_to_symbol_code settlement_symbol}}.

{{#if maker_marketplace}}The marketplace with the name {{maker_marketplace}} facilitates this listing.
{{else}}The default marketplace facilitates this listing.
{{/if}}

If the sale is purchased, the marketplace facilitating the listing of the sale and the marketplace facilitating the purchase of the sale each receive a share of the sale price.

If the sale is purchased, the collection that the listed asset belongs to receives its collection fee share of the sale price, distributed according to the collection's royalty split configuration, or in full to the collection author if no such configuration exists. The collection fee applied is the collection's fee at the time of the purchase, regardless of whether it is higher or lower than at the time of this announcement.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of {{seller}}.
</div>




<h1 class="contract">cancelsale</h1>

---
spec_version: "0.2.0"
title: Cancel a sale
summary: 'The sale with the ID {{nowrap sale_id}} is cancelled'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
The sale with the ID {{sale_id}} is cancelled.

If the seller of this sale has created an AtomicAssets trade offer, offering the assets for this sale to the AtomicMarket account, this trade offer will be declined.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of the seller of the sale with the ID {{sale_id}}, unless the sale is invalid (the seller no longer owns the listed asset or the related trade offer was cancelled) or is a legacy bundle listing, in which case anyone may call this action.
</div>




<h1 class="contract">purchasesale</h1>

---
spec_version: "0.2.0"
title: Purchase a sale
summary: '{{nowrap buyer}} purchases the sale with the ID {{nowrap sale_id}}'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
{{buyer}} purchases the sale with the ID {{sale_id}}.

If the sale's listing price uses a different symbol than the sale's settlement symbol, the following delphioracle median price is used to calculate the exchange rate: {{intended_delphi_median}}.

This delphioracle median price must have been reported to the delphioracle and must still be present in the delphioracle's datapoints table for the relevant delphi pair.

{{buyer}} will be transferred the asset of the sale.

The price of the sale will be deducted from {{buyer}}'s balance.

The marketplaces facilitating the sale listing and the purchase, the collection's royalty recipients (according to the collection's royalty split configuration, or the collection author if none exists), and the seller each get their share of the sale price added to their balances. The collection fee applied is the collection's fee at the time of this purchase, regardless of whether it is higher or lower than when the sale was created.

{{#if taker_marketplace}}The marketplace with the name {{taker_marketplace}} facilitates this purchase.
{{else}}The default marketplace facilitates this purchase.
{{/if}}

If the sale is a legacy bundle listing (more than one asset), no purchase takes place. The sale is cancelled instead and {{buyer}} is not charged anything.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of {{buyer}}.
</div>




<h1 class="contract">assertsale</h1>

---
spec_version: "0.2.0"
title: Asserts sale details
summary: 'The asset ids and price of the sale {{nowrap sale_id}} is asserted'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
Asserts whether the sale with the id {{sale_id}} is for the asset ids {{asset_ids_to_assert}}, whether the listing price is {{listing_price_to_assert}} and whether the settlement symbol is {{settlement_symbol_to_assert}}
If any of these are not true, the transaction fails. Otherwise, nothing happens.
</div>

<b>Clauses:</b>
<div class="clauses">
</div>




<h1 class="contract">announceauct</h1>

---
spec_version: "0.2.0"
title: Announce an auction
summary: '{{nowrap seller}} announces an auction of an asset'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
{{seller}} announces an auction for the asset with the following ID:
{{#each asset_ids}}
    - {{this}}
{{/each}}

An auction contains exactly one asset. To auction multiple assets, multiple auctions can be created within a single transaction.

For this auction to become active, {{seller}} has to transfer the aforementioned asset to the AtomicMarket account with the memo "auction".

The starting bid for this auction will be {{starting_bid}} and the auction will run for a minimum of {{duration}} seconds, starting from the time of announcement.

{{#if maker_marketplace}}The marketplace with the name {{maker_marketplace}} facilitates this auction creation.
{{else}}The default marketplace facilitates this auction creation.
{{/if}}

If the auction is successful, the marketplace facilitating the creation of the auction and the marketplace facilitating the final bid on the auction each receive a share of the final bid.

If the auction is successful, the collection that the listed asset belongs to receives its collection fee share of the final bid, distributed according to the collection's royalty split configuration, or in full to the collection author if no such configuration exists. The collection fee applied is the collection's fee at the time of the seller claim, regardless of whether it is higher or lower than at the time of this announcement.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of {{seller}}.
</div>




<h1 class="contract">cancelauct</h1>

---
spec_version: "0.2.0"
title: Cancel an auction
summary: 'The auction with the ID {{nowrap auction_id}} is cancelled'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
The auction with the ID {{auction_id}} is cancelled. The auction must not have any bids yet, otherwise it can't be cancelled.

If the seller of this auction has already transferred the assets for this auction to the AtomicMarket account, the assets are transferred back.

Exception: legacy bundle auctions (more than one asset) that have a bid but that nobody has claimed yet may also be cancelled - the bid is then refunded to the bidder's balance and the assets are returned to the seller.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of the seller of the auction with the ID {{auction_id}}, unless the auction is invalid (it is not active and the seller no longer owns the listed asset) or is a legacy bundle listing, in which case anyone may call this action.
</div>




<h1 class="contract">auctionbid</h1>

---
spec_version: "0.2.0"
title: Place a bid on an auction
summary: '{{nowrap bidder}} bids {{nowrap bid}} on the auction with the ID {{nowrap sale_id}}'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
{{bidder}} places a bid of {{bid}} on the auction with the ID {{auction_id}}.

If the auction does not have any previous bids, the placed bid must be at least as high as the specified minimum bid of the auction.

If the auction does have a previous bid, the minimum relative increase of the bid is specified in the config table in the field minimum_bid_increase.

The bid will be deducted from {{bidder}}'s balance.

If the auction has a previous bid, the previous bidder is refunded their bid into their balance.

{{#if taker_marketplace}}The marketplace with the name {{taker_marketplace}} facilitates this bid.
{{else}}The default marketplace facilitates this bid.
{{/if}}

If the auction is an unclaimed legacy bundle listing (more than one asset), no bid takes place. The auction is dissolved instead: an existing bid is refunded to its bidder, custodied assets are returned to the seller, and {{bidder}} is not charged anything.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of {{bidder}}.
</div>




<h1 class="contract">auctclaimbuy</h1>

---
spec_version: "0.2.0"
title: Claim an auction as the buyer
summary: 'The highest bidder of the finished auction with the ID {{nowrap auction_id}} claims the assets won'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
The winner (highest bidder) of the auction with the ID {{auction_id}} claims the assets won in the auction. The auction must be finished.

The assets won in the auction are transferred to the auction's winner.

If the auction is a legacy bundle listing (more than one asset) and the seller has not claimed yet, the auction is dissolved instead: the winning bid is refunded to the bidder's balance and the assets are returned to the seller.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of the winner of the auction with the ID {{auction_id}}.
</div>




<h1 class="contract">auctclaimsel</h1>

---
spec_version: "0.2.0"
title: Claim an auction as the seller
summary: 'The seller of the finished auction with the ID {{nowrap auction_id}} claims the final bid'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
The seller of the auction with the ID {{auction_id}} claims the final bid of the auction. The auction must be finished.

The marketplaces facilitating the auction creation and the final bid, the collection's royalty recipients (according to the collection's royalty split configuration, or the collection author if none exists), and the seller each get their share of the final bid added to their balances. The collection fee applied is the collection's fee at the time of this claim, regardless of whether it is higher or lower than when the auction was created.

If the auction is a legacy bundle listing (more than one asset) and the winning bidder has not claimed yet, the auction is dissolved instead: the winning bid is refunded to the bidder's balance and the assets are returned to the seller.

If the auction is a legacy bundle listing and the winning bidder has already claimed the assets, the seller is paid out, with the collection fee share going to the collection author in full (legacy bundles are not distributed through the royalty split configuration).
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of the seller of the auction with the ID {{auction_id}}.
</div>




<h1 class="contract">assertauct</h1>

---
spec_version: "0.2.0"
title: Asserts auction details
summary: 'The asset ids of the auction {{nowrap auction_id}} is asserted'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
Asserts whether the auction with the id {{auction_id}} is for the asset ids {{asset_ids_to_assert}}
If it is not, the transaction fails. Otherwise, nothing happens.
</div>

<b>Clauses:</b>
<div class="clauses">
</div>




<h1 class="contract">createbuyo</h1>

---
spec_version: "0.2.0"
title: Create a buyoffer
summary: '{{nowrap sender}} creates a buyoffer for {{nowrap recipient}}'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
{{sender}} creates a buyoffer, offering {{price}} for the asset with the following id, owned by {{recipient}}:
{{#each asset_ids}}
    - {{this}}
{{/each}}

A buyoffer contains exactly one asset. To make offers on multiple assets, multiple buyoffers can be created within a single transaction.

The price is deducted from {{sender}}'s balance.

{{recipient}} may accept this buyoffer, exchanging the previously mentioned assets for the specified price (excluding fees).

{{#if maker_marketplace}}The marketplace with the name {{maker_marketplace}} facilitates this buyoffer creation.
{{else}}The default marketplace facilitates this buyoffer creation.
{{/if}}

{{#if memo}}There is a memo attached to the buyoffer stating:
    {{memo}}
{{else}}No memo is attached to the buyoffer.
{{/if}}
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of {{sender}}.
</div>




<h1 class="contract">cancelbuyo</h1>

---
spec_version: "0.2.0"
title: Cancels a buyoffer
summary: 'The buyoffer {{nowrap buyoffer_id}} is cancelled'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
The buyoffer with the id {{buyoffer_id}} is cancelled.

The price of the buyoffer is added to the balance of the buyoffer's sender.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of the sender of the buyoffer.
</div>




<h1 class="contract">acceptbuyo</h1>

---
spec_version: "0.2.0"
title: Accepts a buyoffer
summary: 'The buyoffer {{nowrap buyoffer_id}} is accepted'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
The buyoffer with the id {{buyoffer_id}} is accepted by the recipient of the buyoffer.

If the asset ids of the buyoffer differ from {{expected_asset_ids}}, the transaction fails.

If the price of the buyoffer differs from {{expected_price}}, the transaction fails.

{{#if taker_marketplace}}The marketplace with the name {{taker_marketplace}} facilitates this buyoffer acceptance.
{{else}}The default marketplace facilitates this buyoffer acceptance.
{{/if}}

The recipient needs to have previously created an AtomicAssets trade offer, offerring the assets of the buyoffer to the AtomicMarket account without asking for anything in return.

The AtomicAssets trade offer is accepted and the asset of the buyoffer is forwarded to the sender of the buyoffer.

The marketplaces facilitating the buyoffer creation and the acceptance, the collection's royalty recipients (according to the collection's royalty split configuration, or the collection author if none exists), and the recipient of the buyoffer each get their share of the offered price added to their balances. The collection fee applied is the collection's fee at the time of this acceptance, regardless of whether it is higher or lower than when the buyoffer was created.

If the buyoffer is a legacy bundle listing (more than one asset), no trade takes place. The buyoffer is cancelled instead and the escrowed price is returned to the balance of the buyoffer's sender.

</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of the recipient of the buyoffer.
</div>




<h1 class="contract">declinebuyo</h1>

---
spec_version: "0.2.0"
title: Declines a buyoffer
summary: 'The buyoffer {{nowrap buyoffer_id}} is declined'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
The buyoffer with the id {{buyoffer_id}} is declined by the recipient of the buyoffer.

The price of the buyoffer is added to the balance of the buyoffer's sender.

{{#if decline_memo}}There is a memo attached to the decline stating:
    {{decline_memo}}
{{else}}No memo is attached to the decline.
{{/if}}

</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of the recipient of the buyoffer.
</div>




<h1 class="contract">paysaleram</h1>

---
spec_version: "0.2.0"
title: Pay for the RAM of a sale 
summary: '{{nowrap payer}} pays for the RAM of the sale with the ID {{nowrap sale_id}}'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
{{payer}} pays for the RAM associated with the table entry of the sale with the ID {{sale_id}}. The content of the table entry does not change.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of {{payer}}.
</div>




<h1 class="contract">payauctram</h1>

---
spec_version: "0.2.0"
title: Pay for the RAM of an auction 
summary: '{{nowrap payer}} pays for the RAM of the auction with the ID {{nowrap auction_id}}'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
{{payer}} pays for the RAM associated with the table entry of the auction with the ID {{auction_id}}. The content of the table entry does not change.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of {{payer}}.
</div>




<h1 class="contract">paybuyoram</h1>

---
spec_version: "0.2.0"
title: Pay for the RAM of a buyoffer 
summary: '{{nowrap payer}} pays for the RAM of the buyoffer with the ID {{nowrap buyoffer_id}}'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
{{payer}} pays for the RAM associated with the table entry of the buyoffer with the ID {{buyoffer_id}}. The content of the table entry does not change.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of {{payer}}.
</div>




<h1 class="contract">payrentram</h1>

---
spec_version: "0.2.0"
title: Pay for the RAM of a rental listing
summary: '{{nowrap payer}} pays for the RAM of the rental listing for the asset {{nowrap asset_id}}'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
{{payer}} pays for the RAM associated with the table entry of the rental listing for the asset with the ID {{asset_id}}. The content of the table entry does not change.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of {{payer}}.
</div>




<h1 class="contract">addbonusfee</h1>

---
spec_version: "0.2.0"
title: Add a bonus fee
summary: 'Adds a bonus fee of {{nowrap fee}} paid to {{nowrap fee_recipient}}'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
A bonus fee of {{fee}} paid to {{fee_recipient}} is added for all future listings whose counter name is within the applicable counter names. The fee is deducted from the payouts of those listings when they settle.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of {{$action.account}}.
</div>




<h1 class="contract">addafeectr</h1>

---
spec_version: "0.2.0"
title: Add a counter name to a bonus fee
summary: 'Adds the counter name {{nowrap counter_name_to_add}} to the bonus fee with the ID {{nowrap bonusfee_id}}'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
The counter name {{counter_name_to_add}} is added to the bonus fee with the ID {{bonusfee_id}}, so that the fee also applies to all future listings using that counter name.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of {{$action.account}}.
</div>




<h1 class="contract">stopbonusfee</h1>

---
spec_version: "0.2.0"
title: Stop a bonus fee
summary: 'Stops the bonus fee with the ID {{nowrap bonusfee_id}}'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
The bonus fee with the ID {{bonusfee_id}} is stopped. Listings created after this point will not pay the fee; listings created while the fee was active continue to pay it when they settle.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of {{$action.account}}.
</div>




<h1 class="contract">delbonusfee</h1>

---
spec_version: "0.2.0"
title: Delete a bonus fee
summary: 'Deletes the bonus fee with the ID {{nowrap bonusfee_id}}'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
The bonus fee with the ID {{bonusfee_id}} is erased entirely, so that it is not paid by any listing, including listings that were originally created while the fee was active.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of {{$action.account}}.
</div>




<h1 class="contract">setroyalconf</h1>

---
spec_version: "0.2.0"
title: Set a collection's royalty split config
summary: 'The royalty split config of the collection {{nowrap collection_name}} is created or updated'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
The royalty split config of the collection {{collection_name}} is created or updated.

When a sale, auction, buyoffer or rental of an asset belonging to {{collection_name}} settles, the collection fee share of the payment is divided between three categories, weighted {{split_founders}} (founders) : {{split_templates}} (templates) : {{split_attributes}} (attributes). Categories that have no payees for the settled asset are renormalized away, so the weights only need to be relative to each other.

The founders category is distributed to the configured founders list, proportional to the configured weights.

The templates category is distributed according to the template royalties of the settled asset's template (see the settemplroy action).

The attributes category is distributed according to the attribute royalty rules the settled asset matches (see the setattrroy action). The attribute_mode of {{attribute_mode}} determines whether rules match on the merged attribute data of an asset (0) or on each data source individually (1). The attribute_mode can not be changed while attribute royalty rules exist.

Any rounding remainders, and the shares of assets for which no category has payees, go to the collection author.

The authorizing account pays for the RAM of the config table entry.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of the author of the collection {{collection_name}}. Authorized accounts of the collection are not accepted, as this configuration controls where funds are paid out.
</div>




<h1 class="contract">delroyalconf</h1>

---
spec_version: "0.2.0"
title: Delete a collection's royalty split config
summary: 'The royalty split config of the collection {{nowrap collection_name}} is deleted'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
The royalty split config of the collection {{collection_name}} is deleted. The collection fee share of future settlements then again goes to the collection author in full.

All template royalties and attribute royalty rules of the collection must be deleted before the config can be deleted.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of the author of the collection {{collection_name}}.
</div>




<h1 class="contract">settemplroy</h1>

---
spec_version: "0.2.0"
title: Set template royalties
summary: 'The royalty recipients for the template {{nowrap template_id}} of the collection {{nowrap collection_name}} are created or updated'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
The royalty recipients for the template {{template_id}} of the collection {{collection_name}} are created or updated.

When an asset of this template settles, the templates category share of the collection fee is distributed to the configured recipients, proportional to their weights.

The collection must have a royalty split config (see the setroyalconf action). The authorizing account pays for the RAM of the table entry.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of the author of the collection {{collection_name}}. Authorized accounts of the collection are not accepted, as this configuration controls where funds are paid out.
</div>




<h1 class="contract">deltemplroy</h1>

---
spec_version: "0.2.0"
title: Delete template royalties
summary: 'The royalty recipients for the template {{nowrap template_id}} of the collection {{nowrap collection_name}} are deleted'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
The royalty recipients for the template {{template_id}} of the collection {{collection_name}} are deleted.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of the author of the collection {{collection_name}}.
</div>




<h1 class="contract">setattrroy</h1>

---
spec_version: "0.2.0"
title: Set an attribute royalty rule
summary: 'An attribute royalty rule for the collection {{nowrap collection_name}} is created or updated'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
An attribute royalty rule for the collection {{collection_name}} is created or updated.

The rule matches a settled asset when the asset has an attribute with the exact field {{field}}, the exact configured value and value type, read from the data source {{source}} (0 = merged attribute data; 1 = asset immutable data; 2 = asset mutable data; 3 = template immutable data; 4 = template mutable data).

When one or more rules match a settled asset, the attributes category share of the collection fee is first divided between the matched rules proportional to their rule weights (this rule's weight is {{rule_weight}}), and each rule's share is then distributed to its configured recipients, proportional to their weights.

If a rule for the exact same source, field and value already exists, its weight and recipients are updated instead of a new rule being created.

The collection must have a royalty split config (see the setroyalconf action). Float typed and vector typed attribute values can not be used as royalty match keys. The authorizing account pays for the RAM of the table entry.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of the author of the collection {{collection_name}}. Authorized accounts of the collection are not accepted, as this configuration controls where funds are paid out.
</div>




<h1 class="contract">delattrroy</h1>

---
spec_version: "0.2.0"
title: Delete an attribute royalty rule
summary: 'The attribute royalty rule with the ID {{nowrap rule_id}} of the collection {{nowrap collection_name}} is deleted'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
The attribute royalty rule with the ID {{rule_id}} of the collection {{collection_name}} is deleted.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of the author of the collection {{collection_name}}.
</div>




<h1 class="contract">createtbuyo</h1>

---
spec_version: "0.2.0"
title: Create a template buyoffer
summary: '{{nowrap buyer}} offers {{nowrap price}} for any asset of the template {{nowrap template_id}}'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
{{buyer}} creates a buyoffer, offering {{price}} for any asset of the template {{template_id}} of the collection {{collection_name}}.

The price is deducted from {{buyer}}'s balance.

Any account owning an asset of the template may fulfill this buyoffer, exchanging their asset for the specified price (excluding fees).

{{#if maker_marketplace}}The marketplace with the name {{maker_marketplace}} facilitates this buyoffer creation.
{{else}}The default marketplace facilitates this buyoffer creation.
{{/if}}
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of {{buyer}}.
</div>




<h1 class="contract">canceltbuyo</h1>

---
spec_version: "0.2.0"
title: Cancel a template buyoffer
summary: 'The template buyoffer {{nowrap buyoffer_id}} is cancelled'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
The template buyoffer with the id {{buyoffer_id}} is cancelled.

The price of the buyoffer is added back to the balance of the buyoffer's buyer.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of the buyer of the template buyoffer.
</div>




<h1 class="contract">fulfilltbuyo</h1>

---
spec_version: "0.2.0"
title: Fulfill a template buyoffer
summary: '{{nowrap seller}} fulfills the template buyoffer {{nowrap buyoffer_id}} with the asset {{nowrap asset_id}}'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
{{seller}} fulfills the template buyoffer with the id {{buyoffer_id}}, selling the asset with the id {{asset_id}}, which must be of the buyoffer's template.

If the price of the buyoffer differs from {{expected_price}}, the transaction fails.

{{seller}} needs to have previously created an AtomicAssets trade offer, offering the asset to the AtomicMarket account without asking for anything in return, using the memo "tbuyoffer".

The AtomicAssets trade offer is accepted and the asset is forwarded to the buyer of the buyoffer.

The marketplaces facilitating the buyoffer creation and the fulfillment, the collection's royalty recipients (according to the collection's royalty split configuration, or the collection author if none exists), and {{seller}} each get their share of the offered price added to their balances. The collection fee applied is the collection's fee at the time of this fulfillment, regardless of whether it is higher or lower than when the buyoffer was created.

{{#if taker_marketplace}}The marketplace with the name {{taker_marketplace}} facilitates this fulfillment.
{{else}}The default marketplace facilitates this fulfillment.
{{/if}}
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of {{seller}}.
</div>




<h1 class="contract">announcerent</h1>

---
spec_version: "0.2.0"
title: Announce a rental listing
summary: '{{nowrap lister}} announces a rental listing for the asset {{nowrap asset_id}}'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
{{lister}} announces a rental listing for the asset with the ID {{asset_id}}.

For this listing to become active, {{lister}} has to transfer the asset to the AtomicMarket account with the memo "rental". The AtomicMarket account then holds the asset in custody for the lifetime of the listing.

The asset can be rented for {{price_per_hour}} per hour, settled in {{symbol_to_symbol_code settlement_symbol}}. A single rental (including extensions by the same renter) can cover at most {{maximum_rental_duration}} seconds.

While the asset is rented out, the renter receives the AtomicAssets HOLDERSHIP of the asset; the ownership stays with the AtomicMarket account.

{{#if maker_marketplace}}The marketplace with the name {{maker_marketplace}} facilitates this listing.
{{else}}The default marketplace facilitates this listing.
{{/if}}

When the asset is rented, the marketplaces facilitating the listing and the rental, and the collection's royalty recipients (according to the collection's royalty split configuration, or the collection author if none exists) each receive a share of the rental payment; the remainder is paid out to {{lister}}. The collection fee applied is the collection's fee at the time of a rental, regardless of whether it is higher or lower than at the time of this announcement.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of {{lister}}.
</div>




<h1 class="contract">cancelrent</h1>

---
spec_version: "0.2.0"
title: Cancel a rental listing
summary: 'The rental listing for the asset {{nowrap asset_id}} is cancelled'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
The rental listing for the asset with the ID {{asset_id}} is cancelled.

A listing can only be cancelled while no rental is actively running. If the asset is in the custody of the AtomicMarket account, it is transferred back to the listing's owner. If an expired rental was never wrapped up via the endrent action, the holdership of the asset is reclaimed first.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of the owner of the rental listing, unless the listing is not active and the owner no longer owns the asset (which makes the listing invalid), in which case anyone may call this action.
</div>




<h1 class="contract">rentasset</h1>

---
spec_version: "0.2.0"
title: Rent an asset
summary: '{{nowrap renter}} rents the asset {{nowrap asset_id}} for {{nowrap rental_hours}} hours'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
{{renter}} rents the asset with the ID {{asset_id}} for {{rental_hours}} hours.

If the price per hour of the listing differs from {{expected_price_per_hour}}, the transaction fails.

The total rental price (price per hour times hours, converted to the listing's settlement symbol if the listing uses a delphi pairing, using the delphioracle median price {{intended_delphi_median}} where applicable) is deducted from {{renter}}'s balance.

The marketplaces facilitating the listing and this rental, and the collection's royalty recipients (according to the collection's royalty split configuration, or the collection author if none exists) each get their share of the rental payment added to their balances; the remainder is paid out to the listing's owner. The collection fee applied is the collection's fee at the time of this rental, regardless of whether it is higher or lower than when the listing was created.

{{renter}} receives the AtomicAssets HOLDERSHIP of the asset until the end of the rental period; the ownership stays with the AtomicMarket account. The rental period does not renew automatically.

If {{renter}} already holds an active rental for this asset, the purchased hours extend the current rental period instead. The combined remaining period must stay within the listing's maximum rental duration.

{{#if taker_marketplace}}The marketplace with the name {{taker_marketplace}} facilitates this rental.
{{else}}The default marketplace facilitates this rental.
{{/if}}
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called with the permission of {{renter}}.
</div>




<h1 class="contract">endrent</h1>

---
spec_version: "0.2.0"
title: Wrap up an expired rental
summary: 'The expired rental of the asset {{nowrap asset_id}} is wrapped up'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
The rental period of the asset with the ID {{asset_id}} is over, and the AtomicAssets holdership of the asset is moved from the renter back to the AtomicMarket account, making the listing rentable again.

This action has no effect other than resetting an expired rental back to its listed state.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may be called by anyone.
</div>




<h1 class="contract">lognewsale</h1>

---
spec_version: "0.2.0"
title: Log a new sale
summary: 'Logs the creation of the sale with the ID {{nowrap sale_id}}'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
Logs the creation of the sale with the ID {{sale_id}}. This action is only used for notification purposes and has no effect on any state.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called by the AtomicMarket contract itself.
</div>




<h1 class="contract">lognewauct</h1>

---
spec_version: "0.2.0"
title: Log a new auction
summary: 'Logs the creation of the auction with the ID {{nowrap auction_id}}'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
Logs the creation of the auction with the ID {{auction_id}}. This action is only used for notification purposes and has no effect on any state.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called by the AtomicMarket contract itself.
</div>




<h1 class="contract">lognewbuyo</h1>

---
spec_version: "0.2.0"
title: Log a new buyoffer
summary: 'Logs the creation of the buyoffer with the ID {{nowrap buyoffer_id}}'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
Logs the creation of the buyoffer with the ID {{buyoffer_id}}. This action is only used for notification purposes and has no effect on any state.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called by the AtomicMarket contract itself.
</div>




<h1 class="contract">lognewtbuyo</h1>

---
spec_version: "0.2.0"
title: Log a new template buyoffer
summary: 'Logs the creation of the template buyoffer with the ID {{nowrap buyoffer_id}}'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
Logs the creation of the template buyoffer with the ID {{buyoffer_id}}. This action is only used for notification purposes and has no effect on any state.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called by the AtomicMarket contract itself.
</div>




<h1 class="contract">logsalestart</h1>

---
spec_version: "0.2.0"
title: Log a sale becoming active
summary: 'Logs that the sale with the ID {{nowrap sale_id}} has become active'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
Logs that the sale with the ID {{sale_id}} has become active, with the related AtomicAssets trade offer {{offer_id}}. This action is only used for notification purposes and has no effect on any state.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called by the AtomicMarket contract itself.
</div>




<h1 class="contract">logauctstart</h1>

---
spec_version: "0.2.0"
title: Log an auction becoming active
summary: 'Logs that the auction with the ID {{nowrap auction_id}} has become active'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
Logs that the auction with the ID {{auction_id}} has become active. This action is only used for notification purposes and has no effect on any state.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called by the AtomicMarket contract itself.
</div>




<h1 class="contract">lognewrent</h1>

---
spec_version: "0.2.0"
title: Log a new rental listing
summary: 'Logs the creation of the rental listing for the asset {{nowrap asset_id}}'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
Logs the creation of the rental listing for the asset with the ID {{asset_id}}. This action is only used for notification purposes and has no effect on any state.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called by the AtomicMarket contract itself.
</div>




<h1 class="contract">logrentstart</h1>

---
spec_version: "0.2.0"
title: Log a rental listing becoming active
summary: 'Logs that the rental listing for the asset {{nowrap asset_id}} has become active'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
Logs that the rental listing for the asset with the ID {{asset_id}} has become active (the asset has been transferred into the custody of the AtomicMarket account). This action is only used for notification purposes and has no effect on any state.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called by the AtomicMarket contract itself.
</div>




<h1 class="contract">logrental</h1>

---
spec_version: "0.2.0"
title: Log an executed rental
summary: 'Logs that {{nowrap renter}} rented the asset {{nowrap asset_id}}'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
Logs that {{renter}} rented the asset with the ID {{asset_id}} from {{lister}} for {{rental_hours}} hours, paying {{paid_settlement_price}}. The rental period ends at {{rental_end}} (seconds since epoch). This action is only used for notification purposes and has no effect on any state.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called by the AtomicMarket contract itself.
</div>




<h1 class="contract">logroyfound</h1>

---
spec_version: "0.2.0"
title: Log a founders royalty distribution
summary: 'Logs the founders royalty payouts for the asset {{nowrap asset_id}} of the collection {{nowrap collection_name}}'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
Logs the amounts credited to the internal balances of the founders category recipients of the collection {{collection_name}} during the settlement of the asset with the ID {{asset_id}}. This action is only used for logging purposes and has no effect on any state.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called by the AtomicMarket contract itself.
</div>




<h1 class="contract">logroytempl</h1>

---
spec_version: "0.2.0"
title: Log a template royalty distribution
summary: 'Logs the template royalty payouts for the asset {{nowrap asset_id}} of the collection {{nowrap collection_name}}'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
Logs the amounts credited to the internal balances of the royalty recipients of the template {{template_id}} of the collection {{collection_name}} during the settlement of the asset with the ID {{asset_id}}. This action is only used for logging purposes and has no effect on any state.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called by the AtomicMarket contract itself.
</div>




<h1 class="contract">logroyattr</h1>

---
spec_version: "0.2.0"
title: Log an attribute royalty distribution
summary: 'Logs the attribute rule royalty payouts for the asset {{nowrap asset_id}} of the collection {{nowrap collection_name}}'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
Logs the amounts credited to the internal balances of the recipients of the attribute royalty rule with the ID {{rule_id}} of the collection {{collection_name}} during the settlement of the asset with the ID {{asset_id}}. This action is only used for logging purposes and has no effect on any state.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called by the AtomicMarket contract itself.
</div>




<h1 class="contract">logroydust</h1>

---
spec_version: "0.2.0"
title: Log a royalty fallback distribution
summary: 'Logs the royalty amounts that fell through to the author of the collection {{nowrap collection_name}}'
icon: https://atomicassets.io/image/logo256.png#108AEE3530F4EB368A4B0C28800894CFBABF46534F48345BF6453090554C52D5
---

<b>Description:</b>
<div class="description">
Logs the amount credited to the internal balance of {{collection_author}}, the author of the collection {{collection_name}}, during a royalty split settlement, consisting of integer rounding remainders and the shares of assets for which no royalty category had payees. Together with the logroyfound, logroytempl and logroyattr actions of the same settlement, the logged amounts sum up to exactly the collection fee. This action is only used for logging purposes and has no effect on any state.
</div>

<b>Clauses:</b>
<div class="clauses">
This action may only be called by the AtomicMarket contract itself.
</div>