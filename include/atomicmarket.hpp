#include <eosio/eosio.hpp>
#include <eosio/singleton.hpp>
#include <eosio/asset.hpp>
#include <eosio/system.hpp>
#include <eosio/crypto.hpp>

#include <atomicassets-interface.hpp>
#include <delphioracle-interface.hpp>

#include <math.h>
#include <optional>

#include <checkformat.hpp>
#include <atomicdata.hpp>

using namespace std;
using namespace eosio;
using namespace atomicdata;

static constexpr name DEFAULT_MARKETPLACE_CREATOR = name("fees.atomic");


/**
* This function takes a vector of asset ids, sorts them and then returns the sha256 hash
* It should therefore return the same hash for two vectors if and only if both vectors include
* exactly the same asset ids in any order
*/
checksum256 hash_asset_ids(const vector <uint64_t> &asset_ids) {
    uint64_t asset_ids_array[asset_ids.size()];
    std::copy(asset_ids.begin(), asset_ids.end(), asset_ids_array);
    std::sort(asset_ids_array, asset_ids_array + asset_ids.size());

    return eosio::sha256((char *) asset_ids_array, sizeof(asset_ids_array));
};

/**
* Computes the lookup key for an attribute royalty rule.
* eosio::pack encodes the variant's alternative index in front of the value, so the value's
* TYPE is part of the key automatically - uint32_t(5) and int32_t(5) hash differently and a
* rule only matches the exact type the schema deserializes to.
*/
static checksum256 hash_attribute_royalty(uint8_t source, const std::string &field, const ATOMIC_ATTRIBUTE &value) {
    auto packed = eosio::pack(std::make_tuple(source, field, value));
    return eosio::sha256((const char *) packed.data(), packed.size());
}


CONTRACT atomicmarket : public contract {
public:
    using contract::contract;

    struct ROYALTYPAIR {
        name     recipient;
        uint32_t weight;
    };
    typedef std::vector <ROYALTYPAIR> ROYALTYPAIR_V;

    // A single payout credited to the internal balances table, as reported by the
    // royalty distribution log actions
    struct ROYALTYPAYOUT {
        name  recipient;
        asset amount;
    };
    typedef std::vector <ROYALTYPAYOUT> ROYALTYPAYOUT_V;

    ACTION init();

    ACTION convcounters();

    ACTION setminbidinc(
        double minimum_bid_increase
    );

    ACTION setversion(
        const string &new_version
    );

    ACTION addconftoken(
        name token_contract,
        symbol token_symbol
    );

    ACTION adddelphi(
        name delphi_pair_name,
        bool invert_delphi_pair,
        symbol listing_symbol,
        symbol settlement_symbol
    );

    ACTION setmarketfee(
        double maker_market_fee,
        double taker_market_fee
    );

    ACTION addbonusfee(
        name fee_recipient,
        double fee,
        const vector <name> &applicable_counter_names,
        const string &fee_name
    );

    ACTION addafeectr(
        uint64_t bonusfee_id,
        name counter_name_to_add
    );

    ACTION stopbonusfee(
        uint64_t bonusfee_id
    );

    ACTION delbonusfee(
        uint64_t bonusfee_id
    );


    ACTION regmarket(
        name creator,
        name marketplace_name
    );


    ACTION withdraw(
        name owner,
        asset token_to_withdraw
    );


    /*
        Royalty split configuration

        All mutations require the authorization of the collection AUTHOR. Authorized
        accounts of the collection are deliberately not accepted - these configs control
        where funds are paid out, so only the collection's highest authority may change
        them. The author pays for the RAM.
    */

    ACTION setroyalconf(
        name collection_name,
        ROYALTYPAIR_V founders,
        uint8_t attribute_mode,
        uint32_t split_founders,
        uint32_t split_templates,
        uint32_t split_attributes
    );

    ACTION delroyalconf(
        name collection_name
    );

    ACTION settemplroy(
        name collection_name,
        int32_t template_id,
        const ROYALTYPAIR_V &recipients
    );

    ACTION deltemplroy(
        name collection_name,
        int32_t template_id
    );

    ACTION setattrroy(
        name collection_name,
        uint8_t source,
        const string &field,
        const ATOMIC_ATTRIBUTE &value,
        uint32_t rule_weight,
        const ROYALTYPAIR_V &recipients
    );

    ACTION delattrroy(
        name collection_name,
        uint64_t rule_id
    );


    ACTION announcesale(
        name seller,
        const vector <uint64_t> &asset_ids,
        asset listing_price,
        symbol settlement_symbol,
        name maker_marketplace
    );

    ACTION cancelsale(
        uint64_t sale_id
    );

    ACTION purchasesale(
        name buyer,
        uint64_t sale_id,
        uint64_t intended_delphi_median,
        name taker_marketplace
    );

    ACTION assertsale(
        uint64_t sale_id,
        const vector <uint64_t> &asset_ids_to_assert,
        asset listing_price_to_assert,
        symbol settlement_symbol_to_assert
    );


    ACTION announceauct(
        name seller,
        const vector <uint64_t> &asset_ids,
        asset starting_bid,
        uint32_t duration,
        name maker_marketplace
    );

    ACTION cancelauct(
        uint64_t auction_id
    );

    ACTION auctionbid(
        name bidder,
        uint64_t auction_id,
        asset bid,
        name taker_marketplace
    );

    ACTION auctclaimbuy(
        uint64_t auction_id
    );

    ACTION auctclaimsel(
        uint64_t auction_id
    );

    ACTION assertauct(
        uint64_t auction_id,
        const vector <uint64_t> &asset_ids_to_assert
    );


    ACTION createbuyo(
        name buyer,
        name recipient,
        asset price,
        const vector <uint64_t> &asset_ids,
        const string &memo,
        name maker_marketplace
    );

    ACTION cancelbuyo(
        uint64_t buyoffer_id
    );

    ACTION acceptbuyo(
        uint64_t buyoffer_id,
        const vector <uint64_t> &expected_asset_ids,
        asset expected_price,
        name taker_marketplace
    );

    ACTION declinebuyo(
        uint64_t buyoffer_id,
        const string &decline_memo
    );

    /**
     * Create a buy offer for a template. The balance of the buyer must hold enough to cover the
     * price. Ideally a frontend ensures this and adds a transfer action of the asset if required.
     * @param buyer The name of the account who wants to buy a template
     * @param price The price the buyer is willing to pay
     * @param collection_name The name of the collection that has the template
     * @param template_id The template id the buyer is looking for
     * @param maker_marketplace The maker marketplace - gets a part of the royalties
     */
    ACTION createtbuyo(
        name buyer,
        asset price,
        name collection_name,
        uint64_t template_id,
        name maker_marketplace
    );

    /**
     * Cancel a buy offer for a template. The escrowed tokens will be added to the buyers balance
     * again and they can withdraw them.
     * @param buyoffer_id The id of the buy offer to cancel.
     */
    ACTION canceltbuyo(
        uint64_t buyoffer_id
    );

    /**
     * Fulfill a buy offer for a template. This will
     * @param seller The name of the account selling an asset to the buyer
     * @param buyoffer_id The id of the template buy offer to fulfill
     * @param asset_id The id of the asset to fulfill the offer with. This must be of the correct
     * template. It is expected That a trade offer with this asset (and no assets in return) is
     * made to the atomicmarket smart contract with the memo "tbuyoffer"
     * @param expected_price The price that is expected to be paid for the asset
     * @param taker_marketplace The taker marketplace - gets a part of the royalties
     */
    ACTION fulfilltbuyo(
        name seller,
        uint64_t buyoffer_id,
        uint64_t asset_id,
        asset expected_price,
        name taker_marketplace
    );


    /*
        Rentals

        Custodial rental flow:
        1. The owner announces a rental listing (announcerent), specifying the price per hour,
           the settlement symbol, and the maximum duration a single rental can cover
        2. The owner transfers the asset to the atomicmarket contract with the memo "rental",
           which activates the listing (the contract becomes the custodial owner)
        3. A renter pays for a number of hours from their deposited balance (rentasset). The
           payment is distributed like a sale payout (market fees, collection fee / royalty
           splits, remainder to the listing owner) and the atomicassets HOLDERSHIP of the
           asset is moved to the renter, while ownership stays with the contract
        4. After the rental period is over, anyone can reset the holdership back to the
           contract (endrent), making the listing rentable again
        5. The owner can cancel the listing and reclaim the asset whenever no rental is
           actively running (cancelrent)
    */

    ACTION announcerent(
        name lister,
        uint64_t asset_id,
        asset price_per_hour,
        symbol settlement_symbol,
        uint32_t maximum_rental_duration,
        name maker_marketplace
    );

    ACTION cancelrent(
        uint64_t asset_id
    );

    ACTION rentasset(
        name renter,
        uint64_t asset_id,
        uint32_t rental_hours,
        asset expected_price_per_hour,
        uint64_t intended_delphi_median,
        name taker_marketplace
    );

    ACTION endrent(
        uint64_t asset_id
    );


    ACTION paysaleram(
        name payer,
        uint64_t sale_id
    );

    ACTION payauctram(
        name payer,
        uint64_t auction_id
    );

    ACTION paybuyoram(
        name payer,
        uint64_t buyoffer_id
    );

    ACTION payrentram(
        name payer,
        uint64_t asset_id
    );


    [[eosio::on_notify("atomicassets::transfer")]] void receive_asset_transfer(
        name from,
        name to,
        const vector <uint64_t> &asset_ids,
        const string &memo
    );

    [[eosio::on_notify("atomicassets::lognewoffer")]] void receive_asset_offer(
        uint64_t offer_id,
        name sender,
        name recipient,
        const vector <uint64_t> &sender_asset_ids,
        const vector <uint64_t> &recipient_asset_ids,
        const string &memo
    );

    [[eosio::on_notify("*::transfer")]] void receive_token_transfer(
        name from,
        name to,
        asset quantity,
        const string &memo
    );

    ACTION lognewsale(
        uint64_t sale_id,
        name seller,
        const vector <uint64_t> &asset_ids,
        asset listing_price,
        symbol settlement_symbol,
        name maker_marketplace,
        name collection_name,
        double collection_fee
    );

    ACTION lognewauct(
        uint64_t auction_id,
        name seller,
        const vector <uint64_t> &asset_ids,
        asset starting_bid,
        uint32_t duration,
        uint32_t end_time,
        name maker_marketplace,
        name collection_name,
        double collection_fee
    );

    ACTION lognewbuyo(
        uint64_t buyoffer_id,
        name buyer,
        name recipient,
        asset price,
        const vector <uint64_t> &asset_ids,
        const string &memo,
        name maker_marketplace,
        name collection_name,
        double collection_fee
    );

    ACTION lognewtbuyo(
        uint64_t buyoffer_id,
        name buyer,
        asset price,
        uint64_t template_id,
        name maker_marketplace,
        name collection_name,
        double collection_fee
    );

    ACTION logsalestart(
        uint64_t sale_id,
        uint64_t offer_id
    );

    ACTION logauctstart(
        uint64_t auction_id
    );

    ACTION lognewrent(
        uint64_t asset_id,
        name lister,
        asset price_per_hour,
        symbol settlement_symbol,
        uint32_t maximum_rental_duration,
        name maker_marketplace,
        name collection_name,
        double collection_fee
    );

    ACTION logrentstart(
        uint64_t asset_id,
        name lister
    );

    ACTION logrental(
        uint64_t rental_counter_id,
        uint64_t asset_id,
        name lister,
        name renter,
        uint32_t rental_hours,
        asset paid_settlement_price,
        uint32_t rental_end,
        name taker_marketplace
    );

    /*
        Royalty distribution logs - emitted by every settlement (sale, auction, buyoffer,
        rental) that distributes a collection fee through a royalty split config. One action
        per asset and category (one per matched rule for the attributes category), carrying
        the exact amounts credited to the internal balances table.

        These deliberately do NOT require_recipient the payout recipients: notifying
        arbitrary accounts from inside settlement would let a recipient contract assert in
        its notification handler and block the collection's sales entirely.
    */

    ACTION logroyfound(
        name collection_name,
        uint64_t asset_id,
        const ROYALTYPAYOUT_V &payouts
    );

    ACTION logroytempl(
        name collection_name,
        uint64_t asset_id,
        int32_t template_id,
        const ROYALTYPAYOUT_V &payouts
    );

    ACTION logroyattr(
        name collection_name,
        uint64_t asset_id,
        uint64_t rule_id,
        const ROYALTYPAYOUT_V &payouts
    );

    ACTION logroydust(
        name collection_name,
        name collection_author,
        asset amount
    );

private:
    struct COUNTER_RANGE {
        name counter_name;
        uint64_t start_id;
        uint64_t end_id;
    };

    struct TOKEN {
        name   token_contract;
        symbol token_symbol;
    };

    struct SYMBOLPAIR {
        symbol listing_symbol;
        symbol settlement_symbol;
        name   delphi_pair_name;
        bool   invert_delphi_pair;
    };

    /**
    * The relevant parts of an atomicassets collections row. Read through
    * partial_read_collection, which never deserializes the (potentially huge)
    * description blob at the end of the row.
    */
    struct COLLECTION_INFO {
        name   author;
        double market_fee;
    };

    // Per-collection royalty split config - scope: get_self()
    TABLE royaltyconf_s {
        name          collection;
        ROYALTYPAIR_V founders;
        uint8_t       attribute_mode = 0;   // 0 = merged/union, 1 = granular per-source
                                            // locked while attribute rules exist (the two modes
                                            // occupy disjoint lookup hash spaces)
        uint32_t      split_founders   = 0; // category weights; renormalized at settlement
        uint32_t      split_templates  = 0; // across the categories that actually have payees
        uint32_t      split_attributes = 0;

        uint64_t primary_key() const { return collection.value; };
    };

    typedef multi_index <name("royaltyconf"), royaltyconf_s> royaltyconf_t;

    // Per-template royalties - scope: collection
    TABLE royaltytemp_s {
        int32_t       template_id;          // must reference a real template; -1 is invalid here
        ROYALTYPAIR_V recipients;

        uint64_t primary_key() const { return uint64_t(uint32_t(template_id)); }
    };
    typedef multi_index <name("royaltytemp"), royaltytemp_s> royaltytemp_t;

    // Attribute royalty rules, one row per rule - scope: collection
    TABLE royaltyattr_s {
        uint64_t         index;             // available_primary_key()
        uint8_t          source;            // 0 = merged, 1 = asset immut, 2 = asset mut,
                                            // 3 = templ immut, 4 = templ mut (precedence order)
        std::string      field;
        ATOMIC_ATTRIBUTE value;             // kept readable for introspection / UIs
        uint32_t         weight;            // this rule's weight WITHIN the attributes category
        ROYALTYPAIR_V    recipients;
        checksum256      lookup_hash;       // hash_attribute_royalty(source, field, value)

        uint64_t    primary_key() const { return index; }
        checksum256 by_hash()     const { return lookup_hash; }
    };
    typedef eosio::multi_index <name("royaltyattr"), royaltyattr_s,
        indexed_by <name("byhash"), const_mem_fun <royaltyattr_s, checksum256, &royaltyattr_s::by_hash>>
    > royaltyattr_t;

    TABLE balances_s {
        name           owner;
        vector <asset> quantities;

        uint64_t primary_key() const { return owner.value; };
    };

    typedef multi_index <name("balances"), balances_s> balances_t;


    TABLE sales_s {
        uint64_t          sale_id;
        name              seller;
        vector <uint64_t> asset_ids;
        int64_t           offer_id; //-1 if no offer has been created yet, else the offer id
        asset             listing_price;
        symbol            settlement_symbol;
        name              maker_marketplace;
        name              collection_name;
        double            collection_fee;

        uint64_t primary_key() const { return sale_id; };

        checksum256 asset_ids_hash() const { return hash_asset_ids(asset_ids); };
    };

    typedef multi_index <name("sales"), sales_s,
        indexed_by < name("assetidshash"), const_mem_fun < sales_s, checksum256, &sales_s::asset_ids_hash>>>
    sales_t;


    TABLE auctions_s {
        uint64_t          auction_id;
        name              seller;
        vector <uint64_t> asset_ids;
        uint32_t          end_time;   //seconds since epoch
        bool              assets_transferred;
        asset             current_bid;
        name              current_bidder;
        bool              claimed_by_seller;
        bool              claimed_by_buyer;
        name              maker_marketplace;
        name              taker_marketplace;
        name              collection_name;
        double            collection_fee;

        uint64_t primary_key() const { return auction_id; };

        checksum256 asset_ids_hash() const { return hash_asset_ids(asset_ids); };
    };

    typedef multi_index <name("auctions"), auctions_s,
        indexed_by < name("assetidshash"), const_mem_fun < auctions_s, checksum256, &auctions_s::asset_ids_hash>>>
    auctions_t;


    TABLE buyoffers_s {
        uint64_t          buyoffer_id;
        name              buyer;
        name              recipient;
        asset             price;
        vector <uint64_t> asset_ids;
        string            memo;
        name              maker_marketplace;
        name              collection_name;
        double            collection_fee;

        uint64_t primary_key() const { return buyoffer_id; };
    };

    typedef multi_index <name("buyoffers"), buyoffers_s> buyoffers_t;

    TABLE template_buyoffer_s {
        uint64_t buyoffer_id;
        name     buyer;
        asset    price;
        uint64_t template_id;
        name     maker_marketplace;
        name     collection_name;
        double   collection_fee;

        uint64_t primary_key() const { return buyoffer_id; };
    };

    typedef multi_index <name("tbuyoffers"), template_buyoffer_s> template_buyoffers_t;

    TABLE rentals_s {
        uint64_t asset_id;
        name     owner;                     // the listing creator; receives the rental payouts
        name     holder;                    // the current renter; name("") when not rented out
        asset    price_per_hour;            // denoted in the listing symbol
        symbol   settlement_symbol;         // what the rental is actually paid in
        uint32_t maximum_rental_duration;   // seconds; the longest period a rental can cover
        uint32_t rental_end;                // seconds since epoch; 0 when not rented out
        bool     asset_transferred;         // true once the asset is in contract custody
        name     maker_marketplace;
        name     collection_name;
        double   collection_fee;

        uint64_t primary_key() const { return asset_id; };
        uint64_t by_rental_end() const { return (uint64_t) rental_end; };
    };

    typedef multi_index <name("rentals"), rentals_s,
        indexed_by <name("rentalends"), const_mem_fun <rentals_s, uint64_t, &rentals_s::by_rental_end>>>
    rentals_t;

    TABLE marketplaces_s {
        name marketplace_name;
        name creator;

        uint64_t primary_key() const { return marketplace_name.value; };
    };

    typedef multi_index <name("marketplaces"), marketplaces_s> marketplaces_t;


    TABLE counters_s {
        name     counter_name;
        uint64_t counter_value;

        uint64_t primary_key() const { return counter_name.value; };
    };

    typedef multi_index <name("counters"), counters_s> counters_t;


    TABLE bonusfees_s {
        uint64_t               bonusfee_id;
        name                   fee_recipient;
        double                 fee;
        vector <COUNTER_RANGE> counter_ranges;
        string                 fee_name;

        uint64_t primary_key() const { return bonusfee_id; };
    };

    typedef multi_index <name("bonusfees"), bonusfees_s> bonusfees_t;


    TABLE config_s {
        string              version                  = "2.0.0";
        uint64_t            sale_counter             = 0; // deprecated and no longer used
        uint64_t            auction_counter          = 0; // deprecated and no longer used
        double              minimum_bid_increase     = 0.1;
        uint32_t            minimum_auction_duration = 120; //2 minutes
        uint32_t            maximum_auction_duration = 2592000; //30 days
        uint32_t            auction_reset_duration   = 120; //2 minutes
        vector <TOKEN>      supported_tokens         = {};
        vector <SYMBOLPAIR> supported_symbol_pairs   = {};
        double              maker_market_fee         = 0.01;
        double              taker_market_fee         = 0.01;
        name                atomicassets_account     = atomicassets::ATOMICASSETS_ACCOUNT;
        name                delphioracle_account     = delphioracle::DELPHIORACLE_ACCOUNT;
    };
    typedef singleton <name("config"), config_s>               config_t;

    /*
        *********************
        *** Table Fetches ***
        *********************

        Tables are constructed lazily inside the actions that actually use them instead of
        being constructed as contract members - constructing every table object on every
        action dispatch wastes CPU.
    */

    royaltyconf_t get_royaltyconf() { return royaltyconf_t(get_self(), get_self().value); }
    royaltytemp_t get_royaltytemp(name collection_name) { return royaltytemp_t(get_self(), collection_name.value); }
    royaltyattr_t get_royaltyattr(name collection_name) { return royaltyattr_t(get_self(), collection_name.value); }

    balances_t     get_balances() { return balances_t(get_self(), get_self().value); }

    sales_t        get_sales() { return sales_t(get_self(), get_self().value); }
    auctions_t     get_auctions() { return auctions_t(get_self(), get_self().value); }
    buyoffers_t    get_buyoffers() { return buyoffers_t(get_self(), get_self().value); }
    template_buyoffers_t get_template_buyoffers() { return template_buyoffers_t(get_self(), get_self().value); }
    rentals_t      get_rentals() { return rentals_t(get_self(), get_self().value); }

    marketplaces_t get_marketplaces() { return marketplaces_t(get_self(), get_self().value); }
    counters_t     get_counters() { return counters_t(get_self(), get_self().value); }
    bonusfees_t    get_bonusfees() { return bonusfees_t(get_self(), get_self().value); }
    config_t       get_config() { return config_t(get_self(), get_self().value); }

    /**
    * Deserializing the config singleton is comparatively expensive (it holds the supported
    * token and symbol pair vectors) and most actions need it several times through different
    * helpers, so the first read is cached for the lifetime of the action.
    *
    * Admin actions that MODIFY the config must keep using get_config() directly and must not
    * read through this cache after writing.
    */
    std::optional <config_s> config_cache;

    const config_s &cached_config() {
        if (!config_cache) {
            config_cache = get_config().get();
        }
        return *config_cache;
    }


    COLLECTION_INFO partial_read_collection(name collection_name);

    name require_collection_author(name collection_name);

    void validate_royalty_recipients(const ROYALTYPAIR_V &recipients);


    name get_collection_and_check_assets(name owner, const vector <uint64_t> &asset_ids);

    name get_collection_author(name collection_name);

    double get_collection_fee(name collection_name);


    uint64_t consume_counter(name counter_name);


    name require_get_supported_token_contract(symbol token_symbol);

    SYMBOLPAIR require_get_symbol_pair(symbol listing_symbol, symbol settlement_symbol);


    bool is_token_supported(name token_contract, symbol token_symbol);

    bool is_symbol_supported(symbol token_symbol);

    bool is_symbol_pair_supported(symbol listing_symbol, symbol settlement_symbol);

    bool is_valid_marketplace(name marketplace);


    asset calc_settlement_price(
        const asset &listing_price,
        symbol settlement_symbol,
        uint64_t intended_delphi_median
    );

    void internal_withdraw_tokens(
        name withdrawer,
        asset quantity,
        const string &memo
    );

    void internal_payout_sale(
        asset quantity,
        name seller,
        name maker_marketplace,
        name taker_marketplace,
        name collection_name,
        double collection_fee,
        const vector <uint64_t> &asset_ids,
        name asset_scope,
        name relevant_counter_name,
        uint64_t relevant_counter_id,
        const string &seller_payout_message
    );

    void distribute_collection_fee(
        name collection_name,
        name collection_author,
        asset total_fee,
        const vector <uint64_t> &asset_ids,
        name asset_scope
    );

    void internal_add_balance(name owner, asset quantity);

    void internal_decrease_balance(name owner, asset quantity);

    void internal_transfer_assets(name to, const vector <uint64_t> &asset_ids, const string &memo);



};
