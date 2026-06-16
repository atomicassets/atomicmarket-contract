#include <atomicmarket.hpp>

/**
* Initializes the config table. Only needs to be called once when first deploying the contract
*
* @required_auth The contract itself
*/
ACTION atomicmarket::init() {
    require_auth(get_self());
    get_config().get_or_create(get_self(), config_s{});

    auto marketplaces = get_marketplaces();

    if (marketplaces.find(name("").value) == marketplaces.end()) {
        marketplaces.emplace(get_self(), [&](auto &_marketplace) {
            _marketplace.marketplace_name = name("");
            _marketplace.creator = DEFAULT_MARKETPLACE_CREATOR;
        });
    }
}


/**
* Converts the now deprecated sale and auction counters in the config singleton
* into using the counters table
*
* Calling this only is necessary when upgrading the contract from a lower version to 1.2.0
* When deploying a fresh contract, this action can be ignored completely
*
* @required_auth The contract itself
*/
ACTION atomicmarket::convcounters() {
    require_auth(get_self());

    auto config = get_config();
    config_s current_config = config.get();

    auto counters = get_counters();

    check(current_config.sale_counter != 0 && current_config.auction_counter != 0,
        "The sale or auction counters have already been converted");

    counters.emplace(get_self(), [&](auto &_counter) {
        _counter.counter_name = name("sale");
        _counter.counter_value = current_config.sale_counter;
    });
    current_config.sale_counter = 0;

    counters.emplace(get_self(), [&](auto &_counter) {
        _counter.counter_name = name("auction");
        _counter.counter_value = current_config.auction_counter;
    });
    current_config.auction_counter = 0;

    config.set(current_config, get_self());
}


/**
* Sets the minimum bid increase compared to the previous bid
*
* @required_auth The contract itself
*/
ACTION atomicmarket::setminbidinc(double minimum_bid_increase) {
    require_auth(get_self());
    check(minimum_bid_increase > 0, "The bid increase must be greater than 0");

    auto config = get_config();
    config_s current_config = config.get();
    current_config.minimum_bid_increase = minimum_bid_increase;
    config.set(current_config, get_self());
}


/**
* Sets the version for the config table
*
* @required_auth The contract itself
*/
ACTION atomicmarket::setversion(const string &new_version) {
    require_auth(get_self());

    auto config = get_config();
    config_s current_config = config.get();

    current_config.version = new_version;

    config.set(current_config, get_self());
}


/**
* Adds a token that can be used to sell assets for
*
* @required_auth The contract itself
*/
ACTION atomicmarket::addconftoken(name token_contract, symbol token_symbol) {
    require_auth(get_self());

    check(!is_symbol_supported(token_symbol),
        "A token with this symbol is already supported");

    auto config = get_config();
    config_s current_config = config.get();

    current_config.supported_tokens.push_back({
        .token_contract = token_contract,
        .token_symbol = token_symbol
    });

    config.set(current_config, get_self());
}


/**
* Adds a stable pair that can be used for stable sales
*
* @required_auth The contract itself
*/
ACTION atomicmarket::adddelphi(
    name delphi_pair_name,
    bool invert_delphi_pair,
    symbol listing_symbol,
    symbol settlement_symbol
) {
    require_auth(get_self());

    check(listing_symbol.is_valid(), "Invalid tpye listing_symbol");
    check(settlement_symbol.is_valid(), "Invalid type settlement_symbol");

    check(listing_symbol != settlement_symbol,
        "Listing symbol and settlement symbol must be different");

    auto pairs = delphioracle::get_pairs();

    auto pair_itr = pairs.require_find(delphi_pair_name.value,
        "The provided delphi_pair_name does not exist in the delphi oracle contract");
    if (!invert_delphi_pair) {
        check(listing_symbol.precision() == pair_itr->quote_symbol.precision(),
            "The listing symbol precision needs to be equal to the delphi quote smybol precision for non inverted pairs");
        check(settlement_symbol.precision() == pair_itr->base_symbol.precision(),
            "The settlement symbol precision needs to be equal to the delphi base smybol precision for non inverted pairs");
    } else {
        check(listing_symbol.precision() == pair_itr->base_symbol.precision(),
            "The listing symbol precision needs to be equal to the delphi base smybol precision for inverted pairs");
        check(settlement_symbol.precision() == pair_itr->quote_symbol.precision(),
            "The settlement symbol precision needs to be equal to the delphi quote smybol precision for inverted pairs");
    }

    check(!is_symbol_pair_supported(listing_symbol, settlement_symbol),
        "There already exists a symbol pair with the specified listing - settlement symbol combination");

    check(is_symbol_supported(settlement_symbol), "The settlement symbol does not belong to a supported token");

    auto config = get_config();
    config_s current_config = config.get();

    current_config.supported_symbol_pairs.push_back({
        .listing_symbol = listing_symbol,
        .settlement_symbol = settlement_symbol,
        .delphi_pair_name = delphi_pair_name,
        .invert_delphi_pair = invert_delphi_pair
    });

    config.set(current_config, get_self());
}


/**
* Sets the maker and taker market fee
*
* @required_auth The contract itself
*/
ACTION atomicmarket::setmarketfee(double maker_market_fee, double taker_market_fee) {
    require_auth(get_self());

    check(maker_market_fee >= 0 && taker_market_fee >= 0,
        "Market fees need to be at least 0");

    auto config = get_config();
    config_s current_config = config.get();

    current_config.maker_market_fee = maker_market_fee;
    current_config.taker_market_fee = taker_market_fee;

    config.set(current_config, get_self());
}


/**
* Adds an bonus fee to be paid for payouts of listings created in the future
* with a counter name that is within the applicable counter names
*
* @required_auth The contract itself
*/
ACTION atomicmarket::addbonusfee(
    name fee_recipient,
    double fee,
    const vector <name> &applicable_counter_names,
    const string &fee_name
) {
    require_auth(get_self());

    check(is_account(fee_recipient), "The fee recipient is not a valid account");

    check(fee > 0, "The fee must be positive");

    check(applicable_counter_names.size() != 0,
        "Applicable counter names must contain at least one name");

    vector <COUNTER_RANGE> counter_ranges = {};

    auto counters = get_counters();

    for (name counter_name : applicable_counter_names) {
        auto counter_itr = counters.find(counter_name.value);
        counter_ranges.push_back({
            .counter_name = counter_name,
            .start_id = counter_itr != counters.end() ? counter_itr->counter_value : 1,
            .end_id = ULLONG_MAX
        });
    }

    auto bonusfees = get_bonusfees();

    bonusfees.emplace(get_self(), [&](auto &_bonusfee) {
        _bonusfee.bonusfee_id = consume_counter(name("bonusfee"));
        _bonusfee.fee_recipient = fee_recipient;
        _bonusfee.fee = fee;
        _bonusfee.counter_ranges = counter_ranges;
        _bonusfee.fee_name = fee_name;
    });
}


/**
* Adds an additional counter name to be added to an existing bonus fee
* This will lead to the fee being applied to all future listings using the counter name
*
* @required_auth The contract itself
*/
ACTION atomicmarket::addafeectr(
    uint64_t bonusfee_id,
    name counter_name_to_add
) {
    require_auth(get_self());

    auto counters = get_counters();
    auto bonusfees = get_bonusfees();

    auto bonusfee_itr = bonusfees.require_find(bonusfee_id,
        "No bonus fee with this id exists");

    check(bonusfee_itr->counter_ranges[0].end_id != ULLONG_MAX,
        "Can't add a counter name to an bonus fee that is already stopped");

    auto counter_range_itr = std::find_if(
        bonusfee_itr->counter_ranges.begin(),
        bonusfee_itr->counter_ranges.end(),
        [&](auto &counter_range) {
            return counter_range.counter_name == counter_name_to_add;
        }
    );

    check(counter_range_itr == bonusfee_itr->counter_ranges.end(),
        "This counter name is already added to the bonus fee");


    vector <COUNTER_RANGE> counter_ranges = bonusfee_itr->counter_ranges;

    auto counter_itr = counters.find(counter_name_to_add.value);
    counter_ranges.push_back({
        .counter_name = counter_name_to_add,
        .start_id = counter_itr != counters.end() ? counter_itr->counter_value : 1,
        .end_id = ULLONG_MAX
    });

    bonusfees.modify(bonusfee_itr, get_self(), [&](auto &_bonusfee) {
        _bonusfee.counter_ranges = counter_ranges;
    });
}


/**
* Stops an bonus fee so that it is no longer paid by any listings created in the future
*
* @required_auth The contract itself
*/
ACTION atomicmarket::stopbonusfee(
    uint64_t bonusfee_id
) {
    require_auth(get_self());

    auto counters = get_counters();
    auto bonusfees = get_bonusfees();

    auto bonusfee_itr = bonusfees.require_find(bonusfee_id,
        "No bonus fee with this id exists");

    vector <COUNTER_RANGE> counter_ranges = bonusfee_itr->counter_ranges;

    for (COUNTER_RANGE &counter_range : counter_ranges) {
        auto counter_itr = counters.find(counter_range.counter_name.value);
        counter_range.end_id = counter_itr != counters.end() ? counter_itr->counter_value : 1;
    }

    bonusfees.modify(bonusfee_itr, get_self(), [&](auto &_bonusfee) {
        _bonusfee.counter_ranges = counter_ranges;
    });
}


/**
* Erases an bonus fee entirely, so that it is not paid by any listing, including past ones that have
* originally been created with this fee
*
* @required_auth The contract itself
*/
ACTION atomicmarket::delbonusfee(
    uint64_t bonusfee_id
) {
    require_auth(get_self());

    auto bonusfees = get_bonusfees();
    auto bonusfee_itr = bonusfees.require_find(bonusfee_id,
        "No bonus fee with this id exists");

    bonusfees.erase(bonusfee_itr);
}



/**
* Registers a marketplace that can then be used in the maker_marketplace / taker_marketplace parameters
*
* This is needed because without the registration process, an attacker could create tiny sales with random accounts
* as the marketplace, for which the atomicmarket contract would then create balance table rows and pay the RAM for.
*
* marketplace names that belong to existing accounts can not be chosen,
* except if that account authorizes the transaction
*
* @required_auth creator
*/
ACTION atomicmarket::regmarket(
    name creator,
    name marketplace_name
) {
    require_auth(creator);

    auto marketplaces = get_marketplaces();
    name marketplace_name_suffix = marketplace_name.suffix();

    if (is_account(marketplace_name)) {
        check(has_auth(marketplace_name),
            "When the marketplace has the name of an existing account, its authorization is required");
    } else {
        if (marketplace_name_suffix != marketplace_name) {
            check(has_auth(marketplace_name_suffix),
                "When the marketplace name has a suffix, the suffix authorization is required");
        } else {
            check(marketplace_name.length() == 12,
                "Without special authorization, marketplace names must be 12 characters long");
        }
    }

    check(marketplaces.find(marketplace_name.value) == marketplaces.end(),
        "A marketplace with this name already exists");

    marketplaces.emplace(creator, [&](auto &_marketplace) {
        _marketplace.marketplace_name = marketplace_name;
        _marketplace.creator = creator;
    });
}


/**
* Withdraws a token from a users balance. The specified token is then transferred to the user.
*
* @required_auth owner
*/
ACTION atomicmarket::withdraw(
    name owner,
    asset token_to_withdraw
) {
    require_auth(owner);

    check(token_to_withdraw.is_valid(), "Invalid type token_to_withdraw");

    internal_withdraw_tokens(owner, token_to_withdraw, "AtomicMarket Withdrawal");
}


/**
* Creates or updates the royalty split config for a collection
*
* The founders category is a list of global recipients that applies to every sale / rental of
* the collection. The three split weights determine how the collection fee is divided between
* the founders, template and attribute categories. Categories without payees at settlement
* time are renormalized away, so the weights only need to be relative to each other.
*
* @required_auth The collection author (authorized accounts are deliberately not accepted,
* as royalty configs control where funds are paid out)
*/
ACTION atomicmarket::setroyalconf(
    name collection_name,
    ROYALTYPAIR_V founders,
    uint8_t attribute_mode,
    uint32_t split_founders,
    uint32_t split_templates,
    uint32_t split_attributes
) {
    name ram_payer = require_collection_author(collection_name);

    check(attribute_mode <= 1, "attribute_mode must be 0 (merged) or 1 (granular per-source)");

    check(split_founders > 0 || split_templates > 0 || split_attributes > 0,
        "At least one of the category split weights must be greater than 0");

    if (split_founders > 0) {
        validate_royalty_recipients(founders);
    } else {
        check(founders.size() == 0, "founders must be empty when split_founders is 0");
    }

    auto royaltyconf = get_royaltyconf();
    auto conf_itr = royaltyconf.find(collection_name.value);

    if (conf_itr != royaltyconf.end() && conf_itr->attribute_mode != attribute_mode) {
        // Merged mode rules (source 0) and granular rules (sources 1-4) occupy disjoint
        // lookup hash spaces - flipping the mode would silently orphan existing rules
        auto royaltyattr = get_royaltyattr(collection_name);
        check(royaltyattr.begin() == royaltyattr.end(),
            "attribute_mode can't be changed while attribute rules exist. Delete the rules first");
    }

    if (conf_itr == royaltyconf.end()) {
        royaltyconf.emplace(ram_payer, [&](auto &_conf) {
            _conf.collection = collection_name;
            _conf.founders = founders;
            _conf.attribute_mode = attribute_mode;
            _conf.split_founders = split_founders;
            _conf.split_templates = split_templates;
            _conf.split_attributes = split_attributes;
        });
    } else {
        royaltyconf.modify(conf_itr, ram_payer, [&](auto &_conf) {
            _conf.founders = founders;
            _conf.attribute_mode = attribute_mode;
            _conf.split_founders = split_founders;
            _conf.split_templates = split_templates;
            _conf.split_attributes = split_attributes;
        });
    }
}


/**
* Deletes the royalty split config of a collection. The collection fee then again goes to the
* collection author in full
*
* To keep the config state consistent, all template and attribute royalties of the collection
* have to be deleted before the config can be deleted
*
* @required_auth The collection author (authorized accounts are deliberately not accepted,
* as royalty configs control where funds are paid out)
*/
ACTION atomicmarket::delroyalconf(
    name collection_name
) {
    require_collection_author(collection_name);

    auto royaltyconf = get_royaltyconf();
    auto conf_itr = royaltyconf.require_find(collection_name.value,
        "No royalty config exists for this collection");

    auto royaltytemp = get_royaltytemp(collection_name);
    check(royaltytemp.begin() == royaltytemp.end(),
        "All template royalties of this collection must be deleted before the config can be deleted");

    auto royaltyattr = get_royaltyattr(collection_name);
    check(royaltyattr.begin() == royaltyattr.end(),
        "All attribute royalty rules of this collection must be deleted before the config can be deleted");

    royaltyconf.erase(conf_itr);
}


/**
* Creates or updates the royalty recipients for a specific template of a collection
*
* @required_auth The collection author (authorized accounts are deliberately not accepted,
* as royalty configs control where funds are paid out)
*/
ACTION atomicmarket::settemplroy(
    name collection_name,
    int32_t template_id,
    const ROYALTYPAIR_V &recipients
) {
    name ram_payer = require_collection_author(collection_name);

    auto royaltyconf = get_royaltyconf();
    royaltyconf.require_find(collection_name.value,
        "No royalty config exists for this collection. Create one using the setroyalconf action first");

    check(template_id >= 0,
        "template_id must not be negative (assets without a template can't have template royalties)");

    auto collection_templates = atomicassets::get_templates(collection_name);
    collection_templates.require_find((uint64_t) template_id,
        "No template with this id exists within the specified collection");

    validate_royalty_recipients(recipients);

    auto royaltytemp = get_royaltytemp(collection_name);
    auto template_royalty_itr = royaltytemp.find((uint64_t) template_id);

    if (template_royalty_itr == royaltytemp.end()) {
        royaltytemp.emplace(ram_payer, [&](auto &_template_royalty) {
            _template_royalty.template_id = template_id;
            _template_royalty.recipients = recipients;
        });
    } else {
        royaltytemp.modify(template_royalty_itr, ram_payer, [&](auto &_template_royalty) {
            _template_royalty.recipients = recipients;
        });
    }
}


/**
* Deletes the royalty recipients for a specific template of a collection
*
* @required_auth The collection author (authorized accounts are deliberately not accepted,
* as royalty configs control where funds are paid out)
*/
ACTION atomicmarket::deltemplroy(
    name collection_name,
    int32_t template_id
) {
    require_collection_author(collection_name);

    auto royaltytemp = get_royaltytemp(collection_name);
    auto template_royalty_itr = royaltytemp.require_find(uint64_t(uint32_t(template_id)),
        "No template royalty for this template_id exists within the specified collection");

    royaltytemp.erase(template_royalty_itr);
}


/**
* Creates or updates an attribute royalty rule for a collection
*
* A rule matches when an asset that is sold / rented has an attribute with the exact
* (source, field, value) triple of the rule. The value's type is part of the match -
* uint32_t(5) and int32_t(5) are different keys. If a rule for the exact triple already
* exists, its weight and recipients are updated instead of a new rule being created.
*
* @required_auth The collection author (authorized accounts are deliberately not accepted,
* as royalty configs control where funds are paid out)
*/
ACTION atomicmarket::setattrroy(
    name collection_name,
    uint8_t source,
    const string &field,
    const ATOMIC_ATTRIBUTE &value,
    uint32_t rule_weight,
    const ROYALTYPAIR_V &recipients
) {
    name ram_payer = require_collection_author(collection_name);

    auto royaltyconf = get_royaltyconf();
    auto conf_itr = royaltyconf.require_find(collection_name.value,
        "No royalty config exists for this collection. Create one using the setroyalconf action first");

    if (conf_itr->attribute_mode == 0) {
        check(source == 0,
            "This collection uses the merged attribute mode, the source must be 0");
    } else {
        check(source >= 1 && source <= 4,
            "This collection uses the granular attribute mode, the source must be 1 (asset immutable), "
            "2 (asset mutable), 3 (template immutable) or 4 (template mutable)");
    }

    check(field.length() > 0, "field must not be empty");
    check(field.length() <= 64, "field can only be 64 characters max");

    check(!std::holds_alternative <float>(value) && !std::holds_alternative <double>(value),
        "float typed attributes can't be used as royalty match keys");
    // The vector alternatives start after the 11 scalar / string alternatives
    check(value.index() <= 10,
        "vector typed attributes can't be used as royalty match keys");

    check(rule_weight > 0, "rule_weight must be greater than 0");

    validate_royalty_recipients(recipients);

    checksum256 lookup_hash = hash_attribute_royalty(source, field, value);

    auto royaltyattr = get_royaltyattr(collection_name);
    auto rules_by_hash = royaltyattr.get_index <name("byhash")>();
    auto rule_itr = rules_by_hash.find(lookup_hash);

    if (rule_itr != rules_by_hash.end()) {
        rules_by_hash.modify(rule_itr, ram_payer, [&](auto &_rule) {
            _rule.weight = rule_weight;
            _rule.recipients = recipients;
        });
    } else {
        royaltyattr.emplace(ram_payer, [&](auto &_rule) {
            // Rule ids come from a persistent counter instead of available_primary_key():
            // the latter is derived from the live rows only, so deleting the highest rule
            // would let its id be reused - which would corrupt the rule history that
            // indexers build from the logroyattr action traces
            _rule.index = consume_counter(name("attrroyalty"));
            _rule.source = source;
            _rule.field = field;
            _rule.value = value;
            _rule.weight = rule_weight;
            _rule.recipients = recipients;
            _rule.lookup_hash = lookup_hash;
        });
    }
}


/**
* Deletes an attribute royalty rule of a collection
*
* @required_auth The collection author (authorized accounts are deliberately not accepted,
* as royalty configs control where funds are paid out)
*/
ACTION atomicmarket::delattrroy(
    name collection_name,
    uint64_t rule_id
) {
    require_collection_author(collection_name);

    auto royaltyattr = get_royaltyattr(collection_name);
    auto rule_itr = royaltyattr.require_find(rule_id,
        "No attribute royalty rule with this rule_id exists within the specified collection");

    royaltyattr.erase(rule_itr);
}


/**
* Create a sale listing
* For the sale to become active, the seller needs to create an atomicassets offer from them to the atomicmarket
* account, offering (only) the assets to be sold with the memo "sale"
*
* @required_auth seller
*/
ACTION atomicmarket::announcesale(
    name seller,
    const vector <uint64_t> &asset_ids,
    asset listing_price,
    symbol settlement_symbol,
    name maker_marketplace
) {
    require_auth(seller);

    check(listing_price.is_valid(), "Invalid type listing_price");
    check(settlement_symbol.is_valid(), "Invalid type settlement_symbol");

    check(asset_ids.size() == 1,
        "asset_ids must contain exactly one asset id. Bundle listings are not supported - "
        "create one sale per asset (multiple sales can be created within a single transaction)");

    name assets_collection_name = get_collection_and_check_assets(seller, asset_ids);

    check(asset_ids.size() == 1, "Bundle listings retired");
    checksum256 asset_ids_hash = hash_asset_ids(asset_ids);

    auto sales = get_sales();
    auto sales_by_hash = sales.get_index <name("assetidshash")>();
    auto sale_itr = sales_by_hash.find(asset_ids_hash);

    while (sale_itr != sales_by_hash.end()) {
        if (asset_ids_hash != sale_itr->asset_ids_hash()) {
            break;
        }

        check(sale_itr->seller != seller,
            "You have already announced a sale for these assets. You can cancel a sale using the cancelsale action.");

        sale_itr++;
    }


    if (listing_price.symbol == settlement_symbol) {
        check(is_symbol_supported(listing_price.symbol), "The specified listing symbol is not supported.");
    } else {
        check(is_symbol_pair_supported(listing_price.symbol, settlement_symbol),
            "The specified listing - settlement symbol combination is not supported");
    }


    check(listing_price.amount > 0, "The sale price must be greater than zero");

    check(is_valid_marketplace(maker_marketplace), "The maker marketplace is not a valid marketplace");

    double collection_fee = get_collection_fee(assets_collection_name);
    check(collection_fee <= atomicassets::MAX_MARKET_FEE,
        "The collection fee is too high. This should have been prevented by the atomicassets contract");

    uint64_t sale_id = consume_counter(name("sale"));

    sales.emplace(seller, [&](auto &_sale) {
        _sale.sale_id = sale_id;
        _sale.seller = seller;
        _sale.asset_ids = asset_ids;
        _sale.offer_id = -1;
        _sale.listing_price = listing_price;
        _sale.settlement_symbol = settlement_symbol;
        _sale.maker_marketplace = maker_marketplace;
        _sale.collection_name = assets_collection_name;
        _sale.collection_fee = collection_fee;
    });


    action(
        permission_level{get_self(), name("active")},
        get_self(),
        name("lognewsale"),
        make_tuple(
            sale_id,
            seller,
            asset_ids,
            listing_price,
            settlement_symbol,
            maker_marketplace,
            assets_collection_name,
            collection_fee
        )
    ).send();
}


/**
* Cancels a sale. The sale can both be active or inactive
*
* If the sale is invalid (offer for the sale was cancelled or the seller does not own at least one
* of the assets on sale, this action can be called without the authorization of the seller
*
* @required_auth The sale's seller
*/
ACTION atomicmarket::cancelsale(
    uint64_t sale_id
) {
    auto sales = get_sales();
    auto sale_itr = sales.require_find(sale_id,
        "No sale with this sale_id exists");


    auto atomicassets_offers = atomicassets::get_offers();

    // Legacy bundle sales are inherently invalid since bundle listings were removed,
    // so anyone may cancel them
    bool is_sale_invalid = sale_itr->asset_ids.size() > 1;

    if (sale_itr->offer_id != -1) {
        if (atomicassets_offers.find(sale_itr->offer_id) == atomicassets_offers.end()) {
            is_sale_invalid = true;
        }
    }

    atomicassets::assets_t seller_assets = atomicassets::get_assets(sale_itr->seller);
    for (uint64_t asset_id : sale_itr->asset_ids) {
        if (seller_assets.find(asset_id) == seller_assets.end()) {
            is_sale_invalid = true;
            break;
        }
    }

    check(is_sale_invalid || has_auth(sale_itr->seller),
        "The sale is not invalid, therefore the authorization of the seller is needed to cancel it");


    if (sale_itr->offer_id != -1) {
        if (atomicassets_offers.find(sale_itr->offer_id) != atomicassets_offers.end()) {
            //Cancels the atomicassets offer for this sale for convenience
            action(
                permission_level{get_self(), name("active")},
                atomicassets::ATOMICASSETS_ACCOUNT,
                name("declineoffer"),
                make_tuple(
                    sale_itr->offer_id
                )
            ).send();
        }
    }

    sales.erase(sale_itr);
}


/**
* Purchases an asset that is for sale.
* The sale price is deducted from the buyer's balance and added to the seller's balance
*
* intended_delphi_median is only relevant if the sale uses a delphi pairing. Otherwise it is not checked.
*
* @required_auth buyer
*/
ACTION atomicmarket::purchasesale(
    name buyer,
    uint64_t sale_id,
    uint64_t intended_delphi_median,
    name taker_marketplace
) {
    require_auth(buyer);

    auto sales = get_sales();
    auto sale_itr = sales.require_find(sale_id,
        "No sale with this sale_id exists");

    if (sale_itr->asset_ids.size() > 1) {
        // Legacy bundle sale, created before bundle listings were removed. Bundles can no
        // longer be purchased - attempting to do so cancels the listing instead (exactly
        // like cancelsale). The buyer is not charged anything
        auto atomicassets_offers = atomicassets::get_offers();
        if (sale_itr->offer_id != -1 &&
            atomicassets_offers.find(sale_itr->offer_id) != atomicassets_offers.end()) {
            action(
                permission_level{get_self(), name("active")},
                atomicassets::ATOMICASSETS_ACCOUNT,
                name("declineoffer"),
                make_tuple(
                    sale_itr->offer_id
                )
            ).send();
        }
        sales.erase(sale_itr);
        return;
    }

    check(buyer != sale_itr->seller, "You can't purchase your own sale");

    check(sale_itr->offer_id != -1,
        "This sale is not active yet. The seller first has to create an atomicasset offer for this asset");

    auto atomicassets_offers = atomicassets::get_offers();
    check(atomicassets_offers.find(sale_itr->offer_id) != atomicassets_offers.end(),
        "The seller cancelled the atomicassets offer related to this sale");

    check(is_valid_marketplace(taker_marketplace), "The taker marketplace is not a valid marketplace");


    asset sale_price = calc_settlement_price(
        sale_itr->listing_price,
        sale_itr->settlement_symbol,
        intended_delphi_median
    );


    internal_decrease_balance(
        buyer,
        sale_price
    );

    internal_payout_sale(
        sale_price,
        sale_itr->seller,
        sale_itr->maker_marketplace,
        taker_marketplace,
        sale_itr->collection_name,
        sale_itr->collection_fee,
        sale_itr->asset_ids,
        sale_itr->seller, // the assets are still owned by the seller at this point
        name("sale"),
        sale_id,
        "AtomicMarket Sale Payout - ID #" + to_string(sale_id)
    );

    action(
        permission_level{get_self(), name("active")},
        atomicassets::ATOMICASSETS_ACCOUNT,
        name("acceptoffer"),
        make_tuple(
            sale_itr->offer_id
        )
    ).send();

    internal_transfer_assets(
        buyer,
        sale_itr->asset_ids,
        "AtomicMarket Purchased Sale - ID # " + to_string(sale_id)
    );

    sales.erase(sale_itr);
}


/**
* Checks whether the provided asset ids, listing price and settlement symbol match the values of
* the sale with the specified id and throws the transaction if this is not the case
*
* Meant to be called within the same transaction as the purchase action for this sale in order to
* validate that the sale with the specified id contains what the purchaser expects it to contain
*
* @required_auth None
*/
ACTION atomicmarket::assertsale(
    uint64_t sale_id,
    const vector <uint64_t> &asset_ids_to_assert,
    asset listing_price_to_assert,
    symbol settlement_symbol_to_assert
) {
    check(listing_price_to_assert.is_valid(), "Invalid type listing_price_to_assert");
    check(settlement_symbol_to_assert.is_valid(), "Invalid type settlement_symbol_to_assert");

    auto sales = get_sales();
    auto sale_itr = sales.require_find(sale_id,
        "No sale with this sale_id exists");

    check(std::is_permutation(asset_ids_to_assert.begin(), asset_ids_to_assert.end(), sale_itr->asset_ids.begin()),
        "The asset ids to assert differ from the asset ids of this sale");

    check(listing_price_to_assert == sale_itr->listing_price,
        "The listing price to assert differs from the listing price of this sale");

    check(settlement_symbol_to_assert == sale_itr->settlement_symbol,
        "The settlement symbol to assert differs from the settlement symbol of this sale");
}


/**
* Create an auction listing
* For the auction to become active, the seller needs to use the atomicassets transfer action to transfer the assets
* to the atomicmarket contract with the memo "auction"
*
* duration is in seconds
*
* @required_auth seller
*/
ACTION atomicmarket::announceauct(
    name seller,
    const vector <uint64_t> &asset_ids,
    asset starting_bid,
    uint32_t duration,
    name maker_marketplace
) {
    require_auth(seller);

    check(starting_bid.is_valid(), "Invalid type starting_bid");

    check(asset_ids.size() == 1,
        "asset_ids must contain exactly one asset id. Bundle listings are not supported - "
        "create one auction per asset (multiple auctions can be created within a single transaction)");

    name assets_collection_name = get_collection_and_check_assets(seller, asset_ids);


    checksum256 asset_ids_hash = hash_asset_ids(asset_ids);

    auto auctions = get_auctions();
    auto auctions_by_hash = auctions.get_index <name("assetidshash")>();
    auto auction_itr = auctions_by_hash.find(asset_ids_hash);

    while (auction_itr != auctions_by_hash.end()) {
        if (asset_ids_hash != auction_itr->asset_ids_hash()) {
            break;
        }

        check(auction_itr->seller != seller,
            "You have already announced an auction for these assets. You can cancel an auction using the cancelauct action.");

        auction_itr++;
    }


    check(is_symbol_supported(starting_bid.symbol), "The specified starting bid token is not supported.");
    check(starting_bid.amount > 0, "The starting bid must be greater than zero");

    check(is_valid_marketplace(maker_marketplace), "The maker marketplace is not a valid marketplace");

    double collection_fee = get_collection_fee(assets_collection_name);
    check(collection_fee <= atomicassets::MAX_MARKET_FEE,
        "The collection fee is too high. This should have been prevented by the atomicassets contract");

    const config_s &current_config = cached_config();
    check(duration >= current_config.minimum_auction_duration,
        "The specified duration is shorter than the minimum auction duration");
    check(duration <= current_config.maximum_auction_duration,
        "The specified duration is longer than the maximum auction duration");

    uint64_t auction_id = consume_counter(name("auction"));

    auctions.emplace(seller, [&](auto &_auction) {
        _auction.auction_id = auction_id;
        _auction.seller = seller;
        _auction.asset_ids = asset_ids;
        _auction.end_time = current_time_point().sec_since_epoch() + duration;
        _auction.assets_transferred = false;
        _auction.current_bid = starting_bid;
        _auction.current_bidder = name("");
        _auction.claimed_by_seller = false;
        _auction.claimed_by_buyer = false;
        _auction.maker_marketplace = maker_marketplace;
        _auction.taker_marketplace = name("");
        _auction.collection_name = assets_collection_name;
        _auction.collection_fee = collection_fee;
    });


    action(
        permission_level{get_self(), name("active")},
        get_self(),
        name("lognewauct"),
        make_tuple(
            auction_id,
            seller,
            asset_ids,
            starting_bid,
            duration,
            current_time_point().sec_since_epoch() + duration,
            maker_marketplace,
            assets_collection_name,
            collection_fee
        )
    ).send();
}


/**
* Cancels an auction. If the auction is active, it must not have any bids yet.
* Auctions with bids can't be cancelled.
*
* If the auction is invalid (it is not active yet and the seller does not own at least one of the
* assets listed in the auction) this action can be called without the autorization of the seller
*
* @required_auth seller
*/
ACTION atomicmarket::cancelauct(
    uint64_t auction_id
) {
    auto auctions = get_auctions();
    auto auction_itr = auctions.require_find(auction_id,
        "No auction with this auction_id exists");


    // Legacy bundle auctions are inherently invalid since bundle listings were removed,
    // so anyone may cancel them (partial-claim states are guarded below)
    bool is_auction_invalid = auction_itr->asset_ids.size() > 1;

    if (!auction_itr->assets_transferred) {
        atomicassets::assets_t seller_assets = atomicassets::get_assets(auction_itr->seller);
        for (uint64_t asset_id : auction_itr->asset_ids) {
            if (seller_assets.find(asset_id) == seller_assets.end()) {
                is_auction_invalid = true;
                break;
            }
        }
    }

    check(is_auction_invalid || has_auth(auction_itr->seller),
        "The auction is not invalid, therefore the authorization of the seller is needed to cancel it");


    if (auction_itr->assets_transferred) {
        if (auction_itr->current_bidder != name("")) {
            check(auction_itr->asset_ids.size() > 1,
                "This auction already has a bid. Auctions with bids can't be cancelled");

            // Legacy bundle auction with a bid: it can be dissolved as long as neither side
            // has claimed yet (a partial claim means one side was already served - refunding
            // or returning then would pay one party twice)
            check(!auction_itr->claimed_by_seller && !auction_itr->claimed_by_buyer,
                "Partially claimed legacy bundle auctions have to be wrapped up using the claim actions");

            internal_add_balance(auction_itr->current_bidder, auction_itr->current_bid);
        }

        internal_transfer_assets(
            auction_itr->seller,
            auction_itr->asset_ids,
            "AtomicMarket Cancelled Auction - ID # " + to_string(auction_id)
        );
    }

    auctions.erase(auction_itr);
}


/**
* Places a bid on an auction
* The bid is deducted from the buyer's balance
* If a higher bid gets placed by someone else, the original bid will be refunded to the original buyer's balance
*
* @required_auth bidder
*/
ACTION atomicmarket::auctionbid(
    name bidder,
    uint64_t auction_id,
    asset bid,
    name taker_marketplace
) {
    require_auth(bidder);

    check(bid.is_valid(), "Invalid type bid");

    auto auctions = get_auctions();
    auto auction_itr = auctions.require_find(auction_id,
        "No auction with this auction_id exists");

    if (auction_itr->asset_ids.size() > 1) {
        // Legacy bundle auction, created before bundle listings were removed. Bundles can
        // no longer be bid on - attempting to do so dissolves the auction instead: an
        // existing bid is refunded and custodied assets are returned to the seller.
        // Partially claimed auctions can't be dissolved (one side was already served and
        // a refund would pay twice) - those have to be wrapped up via the claim actions
        check(!auction_itr->claimed_by_seller && !auction_itr->claimed_by_buyer,
            "Partially claimed legacy bundle auctions have to be wrapped up using the claim actions");

        if (auction_itr->current_bidder != name("")) {
            internal_add_balance(auction_itr->current_bidder, auction_itr->current_bid);
        }
        if (auction_itr->assets_transferred) {
            internal_transfer_assets(
                auction_itr->seller,
                auction_itr->asset_ids,
                "AtomicMarket Dissolved Legacy Bundle Auction - ID # " + to_string(auction_id)
            );
        }
        auctions.erase(auction_itr);
        return;
    }

    check(bidder != auction_itr->seller, "You can't bid on your own auction");

    check(auction_itr->assets_transferred,
        "The auction is not yet active. The seller first needs to transfer the asset to the atomicmarket account");

    check(current_time_point().sec_since_epoch() < auction_itr->end_time,
        "The auction is already finished");

    check(bid.symbol == auction_itr->current_bid.symbol,
        "The bid uses a different symbol than the current auction bid");

    const config_s &current_config = cached_config();
    if (auction_itr->current_bidder == name("")) {
        check(bid.amount >= auction_itr->current_bid.amount,
            "The bid must be at least as high as the minimum bid");
    } else {
        check((double) bid.amount >=
              (double) auction_itr->current_bid.amount * (1.0 + current_config.minimum_bid_increase),
            "The relative increase is less than the minimum bid increase specified in the config");
    }


    if (auction_itr->current_bidder != name("")) {
        internal_add_balance(
            auction_itr->current_bidder,
            auction_itr->current_bid
        );
    }

    internal_decrease_balance(
        bidder,
        bid
    );

    check(is_valid_marketplace(taker_marketplace), "The taker marketplace is not a valid marketplace");

    auctions.modify(auction_itr, same_payer, [&](auto &_auction) {
        _auction.current_bid = bid;
        _auction.current_bidder = bidder;
        _auction.taker_marketplace = taker_marketplace;
        _auction.end_time = std::max(
            _auction.end_time,
            current_time_point().sec_since_epoch() + current_config.auction_reset_duration
        );
    });
}


/**
* Claims the asset for the highest bidder of an auction
*
* @required_auth The highest bidder of the auction
*/
ACTION atomicmarket::auctclaimbuy(
    uint64_t auction_id
) {
    auto auctions = get_auctions();
    auto auction_itr = auctions.require_find(auction_id,
        "No auction with this auction_id exists");

    check(auction_itr->assets_transferred, "The auction is not active");

    check(auction_itr->current_bidder != name(""),
        "The auction does not have any bids");

    require_auth(auction_itr->current_bidder);

    check(auction_itr->end_time < current_time_point().sec_since_epoch(),
        "The auction is not finished yet");

    check(!auction_itr->claimed_by_buyer,
        "The auction has already been claimed by the buyer");

    if (auction_itr->asset_ids.size() > 1 && !auction_itr->claimed_by_seller) {
        // Legacy bundle auction that ended before bundle listings were removed and that
        // nobody has claimed yet: it is dissolved instead - the winning bid is refunded
        // and the assets are returned to the seller.
        // If the seller HAS already claimed (pre-removal), they were paid out, so the
        // assets must still go to the winning bidder - the normal claim below handles that
        internal_add_balance(auction_itr->current_bidder, auction_itr->current_bid);
        internal_transfer_assets(
            auction_itr->seller,
            auction_itr->asset_ids,
            "AtomicMarket Dissolved Legacy Bundle Auction - ID # " + to_string(auction_id)
        );
        auctions.erase(auction_itr);
        return;
    }

    internal_transfer_assets(
        auction_itr->current_bidder,
        auction_itr->asset_ids,
        "AtomicMarket Won Auction - ID # " + to_string(auction_id)
    );

    if (auction_itr->claimed_by_seller) {
        auctions.erase(auction_itr);
    } else {
        auctions.modify(auction_itr, same_payer, [&](auto &_auction) {
            _auction.claimed_by_buyer = true;
        });
    }
}


/**
* Claims the highest bid of an auction for the seller and also gives a cut to the marketplaces and the collection
*
* If the auction has no bids, use the cancelauct action instead
*
* @required_auth The auction's seller
*/
ACTION atomicmarket::auctclaimsel(
    uint64_t auction_id
) {
    auto auctions = get_auctions();
    auto auction_itr = auctions.require_find(auction_id,
        "No auction with this auction_id exists");

    require_auth(auction_itr->seller);

    check(auction_itr->assets_transferred, "The auction is not active");

    check(auction_itr->end_time < current_time_point().sec_since_epoch(),
        "The auction is not finished yet");

    check(auction_itr->current_bidder != name(""),
        "The auction does not have any bids");

    check(!auction_itr->claimed_by_seller,
        "The auction has already been claimed by the seller");

    if (auction_itr->asset_ids.size() > 1 && !auction_itr->claimed_by_buyer) {
        // Legacy bundle auction that ended before bundle listings were removed and that
        // nobody has claimed yet: it is dissolved instead - the winning bid is refunded
        // and the assets are returned to the seller.
        // If the buyer HAS already claimed the assets (pre-removal), the seller must still
        // be paid - the payout below handles that. Bundles never touch the royalty split
        // engine: internal_payout_sale credits the collection cut of multi-asset payouts
        // to the collection author in full
        internal_add_balance(auction_itr->current_bidder, auction_itr->current_bid);
        internal_transfer_assets(
            auction_itr->seller,
            auction_itr->asset_ids,
            "AtomicMarket Dissolved Legacy Bundle Auction - ID # " + to_string(auction_id)
        );
        auctions.erase(auction_itr);
        return;
    }

    internal_payout_sale(
        auction_itr->current_bid,
        auction_itr->seller,
        auction_itr->maker_marketplace,
        auction_itr->taker_marketplace,
        auction_itr->collection_name,
        auction_itr->collection_fee,
        auction_itr->asset_ids,
        // If the buyer has not claimed yet, the assets are still in contract custody.
        // Otherwise they were transferred to the highest bidder
        auction_itr->claimed_by_buyer ? auction_itr->current_bidder : get_self(),
        name("auction"),
        auction_id,
        "AtomicMarket Auction Payout - ID #" + to_string(auction_id)
    );

    if (auction_itr->claimed_by_buyer) {
        auctions.erase(auction_itr);
    } else {
        auctions.modify(auction_itr, same_payer, [&](auto &_auction) {
            _auction.claimed_by_seller = true;
        });
    }
}


/**
* Checks whether the provided asset ids match those of the auction with the specified id
* and throws the transaction if this is not the case
*
* Meant to be called within the same transaction as a bid action for this auction in order to
* validate that the auction with the specified id contains what the bidder expects it to contain
*
* @required_auth None
*/
ACTION atomicmarket::assertauct(
    uint64_t auction_id,
    const vector <uint64_t> &asset_ids_to_assert
) {
    auto auctions = get_auctions();
    auto auction_itr = auctions.require_find(auction_id,
        "No auction with this auction_id exists");

    check(std::is_permutation(asset_ids_to_assert.begin(), asset_ids_to_assert.end(), auction_itr->asset_ids.begin()),
        "The asset ids to assert differ from the asset ids of this auction");
}


/**
* Creates a buyoffer
* The specified price is deducted from the buyer's balance
* The recipient then has the option to trade the specified assets for the offered price (excluding fees)
*
* @required_auth buyer
*/
ACTION atomicmarket::createbuyo(
    name buyer,
    name recipient,
    asset price,
    const vector <uint64_t> &asset_ids,
    const string &memo,
    name maker_marketplace
) {
    require_auth(buyer);

    check(price.is_valid(), "Invalid type price");

    check(buyer != recipient, "buyer and recipient can't be the same account");

    check(asset_ids.size() == 1,
        "asset_ids must contain exactly one asset id. Bundle listings are not supported - "
        "create one buyoffer per asset (multiple buyoffers can be created within a single transaction)");

    name assets_collection_name = get_collection_and_check_assets(recipient, asset_ids);

    // Not needed technically, as invalid symbols would simply fail when attempting to decrease
    // the balance. Only meant to give more meaningful error messages.
    check(is_symbol_supported(price.symbol), "The symbol of the specified price is not supported");

    check(price.amount > 0, "The price must be greater than zero");
    internal_decrease_balance(buyer, price);

    check(memo.length() <= 256, "A buyoffer memo can only be 256 characters max");


    check(is_valid_marketplace(maker_marketplace), "The maker marketplace is not a valid marketplace");

    double collection_fee = get_collection_fee(assets_collection_name);

    uint64_t buyoffer_id = consume_counter(name("buyoffer"));

    auto buyoffers = get_buyoffers();
    buyoffers.emplace(buyer, [&](auto &_buyoffer) {
        _buyoffer.buyoffer_id = buyoffer_id;
        _buyoffer.buyer = buyer;
        _buyoffer.recipient = recipient;
        _buyoffer.price = price;
        _buyoffer.asset_ids = asset_ids;
        _buyoffer.memo = memo;
        _buyoffer.maker_marketplace = maker_marketplace;
        _buyoffer.collection_name = assets_collection_name;
        _buyoffer.collection_fee = collection_fee;
    });


    action(
        permission_level{get_self(), name("active")},
        get_self(),
        name("lognewbuyo"),
        make_tuple(
            buyoffer_id,
            buyer,
            recipient,
            price,
            asset_ids,
            memo,
            maker_marketplace,
            assets_collection_name,
            collection_fee
        )
    ).send();
}


/**
* Cancels (erases) a buyoffer
* The price that has previously been deducted when creating the buyoffer is added
* back to the buyer's balance
*
* @required_auth The buyer of the buyoffer
*/
ACTION atomicmarket::cancelbuyo(
    uint64_t buyoffer_id
) {
    auto buyoffers = get_buyoffers();
    auto buyoffer_itr = buyoffers.require_find(buyoffer_id,
        "No buyoffer with this id exists");

    require_auth(buyoffer_itr->buyer);

    internal_add_balance(buyoffer_itr->buyer, buyoffer_itr->price);

    buyoffers.erase(buyoffer_itr);
}


/**
* Accepts a buyoffer
* Calling this action expects that the recipient of the buyoffer had created an AtomicAssets
* trade offer, which offers the assets of the buyoffer to the AtomicMarket contract, while
* asking for nothing in return and using the memo "buyoffer"
*
* The AtomicAssets offer with the highest offer_id is looked at, which means that the recipient
* should create the AtomicAssets offer and then call this action within the same transaction to
* make sure that they are executed directly after one antoher
*
* The AtomicMarket will then accept this trade offer and transfer the assets to the sender of
* the buyoffer, and pay out the offered price to the recipient
*
* The price is subject to the same fees as sales or auctions
*
* @required_auth The recipient of the buyoffer
*/
ACTION atomicmarket::acceptbuyo(
    uint64_t buyoffer_id,
    const vector <uint64_t> &expected_asset_ids,
    asset expected_price,
    name taker_marketplace
) {
    check(expected_price.is_valid(), "Invalid type expected_price");

    auto buyoffers = get_buyoffers();
    auto buyoffer_itr = buyoffers.require_find(buyoffer_id,
        "No buyoffer with this id exists");

    require_auth(buyoffer_itr->recipient);

    if (buyoffer_itr->asset_ids.size() > 1) {
        // Legacy bundle buyoffer, created before bundle listings were removed. Bundles can
        // no longer be accepted - attempting to do so cancels the buyoffer instead and the
        // escrowed price is returned to the buyer (exactly like declinebuyo)
        internal_add_balance(buyoffer_itr->buyer, buyoffer_itr->price);
        buyoffers.erase(buyoffer_itr);
        return;
    }

    check(std::is_permutation(
            buyoffer_itr->asset_ids.begin(),
            buyoffer_itr->asset_ids.end(),
            expected_asset_ids.begin()
        ),
        "The asset ids of this buyoffer differ from the expected asset ids");
    check(buyoffer_itr->price == expected_price,
        "The price of this buyoffer differ from the expected price");

    // This could theoretically fail if there is not a single AtomicAssets offer exists
    // Because it is assumed that this will rarely if ever be the case, no explicit check is added for that
    auto atomicassets_offers = atomicassets::get_offers();
    auto last_offer_itr = --atomicassets_offers.end();

    check(last_offer_itr->sender == buyoffer_itr->recipient && last_offer_itr->recipient == get_self(),
        "The last created AtomicAssets offer must be from the buyoffer recipient to the AtomicMarket contract");

    check(std::is_permutation(
            last_offer_itr->sender_asset_ids.begin(),
            last_offer_itr->sender_asset_ids.end(),
            buyoffer_itr->asset_ids.begin()
        ),
        "The last created AtomicAssets offer must contain the assets of the buyoffer");
    check(last_offer_itr->recipient_asset_ids.size() == 0,
        "The last created AtomicAssets offer must not ask for any assets in return");

    check(last_offer_itr->memo == "buyoffer",
        "The last created AtomicAssets offer must have the memo \"buyoffer\"");


    // It is not checked whether the AtomicAssets offer is valid, because this will be checked in the
    // acceptoffer action, and if the offer is invalid, the transaction will throw
    action(
        permission_level{get_self(), name("active")},
        atomicassets::ATOMICASSETS_ACCOUNT,
        name("acceptoffer"),
        make_tuple(
            last_offer_itr->offer_id
        )
    ).send();

    internal_transfer_assets(
        buyoffer_itr->buyer,
        buyoffer_itr->asset_ids,
        "AtomicMarket Accepted Buyoffer - ID # " + to_string(buyoffer_id)
    );


    check(is_valid_marketplace(taker_marketplace), "The taker marketplace is not a valid marketplace");

    internal_payout_sale(
        buyoffer_itr->price,
        buyoffer_itr->recipient,
        buyoffer_itr->maker_marketplace,
        taker_marketplace,
        buyoffer_itr->collection_name,
        buyoffer_itr->collection_fee,
        buyoffer_itr->asset_ids,
        buyoffer_itr->recipient, // the assets are still owned by the recipient at this point
        name("buyoffer"),
        buyoffer_id,
        "AtomicMarket Buyoffer Payout - ID #" + to_string(buyoffer_id)
    );


    buyoffers.erase(buyoffer_itr);
}


/**
* Declines a buyoffer
*
* @required_auth The recipient of the buyoffer
*/
ACTION atomicmarket::declinebuyo(
    uint64_t buyoffer_id,
    const string &decline_memo
) {
    auto buyoffers = get_buyoffers();
    auto buyoffer_itr = buyoffers.require_find(buyoffer_id,
        "No buyoffer with this id exists");

    require_auth(buyoffer_itr->recipient);

    check(decline_memo.length() <= 256, "A decline memo can only be 256 characters max");

    internal_add_balance(buyoffer_itr->buyer, buyoffer_itr->price);

    buyoffers.erase(buyoffer_itr);
}

ACTION atomicmarket::createtbuyo(
    name buyer, asset price, name collection_name, uint64_t template_id, name maker_marketplace
) {
    require_auth(buyer);

    check(price.is_valid(), "Invalid type price");

    // Check if the template id is correct (in the collection)
    auto collection_templates = atomicassets::get_templates(collection_name);
    collection_templates.require_find(template_id, "Invalid template id");

    // Not needed technically, as invalid symbols would simply fail when attempting to decrease
    // the balance. Only meant to give more meaningful error messages.
    check(is_symbol_supported(price.symbol), "The symbol of the specified price is not supported");

    check(price.amount > 0, "The price must be greater than zero");
    internal_decrease_balance(buyer, price);

    check(is_valid_marketplace(maker_marketplace),
        "The maker marketplace is not a valid marketplace");

    double collection_fee = get_collection_fee(collection_name);

    uint64_t buyoffer_id = consume_counter(name("tbuyoffer"));

    auto template_buyoffers = get_template_buyoffers();
    template_buyoffers.emplace(buyer, [&](auto &entry) {
        entry.buyoffer_id = buyoffer_id;
        entry.buyer = buyer;
        entry.price = price;
        entry.template_id = template_id;
        entry.maker_marketplace = maker_marketplace;
        entry.collection_name = collection_name;
        entry.collection_fee = collection_fee;
    });

    action(
        permission_level{get_self(), name("active")},
        get_self(),
        name("lognewtbuyo"),
        make_tuple(
            buyoffer_id,
            buyer,
            price,
            template_id,
            maker_marketplace,
            collection_name,
            collection_fee
        )
    ).send();
}

ACTION atomicmarket::canceltbuyo(uint64_t buyoffer_id) {
    auto template_buyoffers = get_template_buyoffers();
    auto buyoffer_itr = template_buyoffers.require_find(
        buyoffer_id, "No buyoffer with this id exists"
    );

    // Only the buyer can cancel
    require_auth(buyoffer_itr->buyer);

    internal_add_balance(buyoffer_itr->buyer, buyoffer_itr->price);

    template_buyoffers.erase(buyoffer_itr);
}

ACTION atomicmarket::fulfilltbuyo(
    name seller, uint64_t buyoffer_id, uint64_t asset_id, asset expected_price,
    name taker_marketplace
) {
    check(expected_price.is_valid(), "Invalid type expected_price");

    auto template_buyoffers = get_template_buyoffers();
    auto buyoffer_itr = template_buyoffers.require_find(buyoffer_id,
        "No buyoffer with this id exists");

    // Ensure the person selling authorized the transaction
    require_auth(seller);

    // Verify the seller is offering an asset of the correct template
    auto seller_assets = atomicassets::get_assets(seller);
    auto asset_itr = seller_assets.require_find(asset_id, "The seller must own the asset sold");
    check(asset_itr->template_id == buyoffer_itr->template_id,
        "The sold asset must have the correct template");

    // Verify the seller will get the price they expect
    check(buyoffer_itr->price == expected_price,
        "The price of this buyoffer differs from the expected price");

    // Get the last offer on atomic assets. It is expected that in the same transaction an offer
    // with the memo "tbuyoffer" was made to atomicmarket with the singular asset
    auto atomicassets_offers = atomicassets::get_offers();
    auto last_offer_itr = --atomicassets_offers.end();
    // Verify the offer is from the correct account to atomicmarket
    check(last_offer_itr->sender == seller && last_offer_itr->recipient == get_self(),
        "The last created AtomicAssets offer must be from the seller to the AtomicMarket contract");
    // Verify the offer contains exactly the one asset and does not expect anything in return
    check(last_offer_itr->sender_asset_ids.size() == 1, "The offer must contain exactly one asset");
    check(last_offer_itr->sender_asset_ids[0] == asset_id,
        "The offer must contain the asset sold");
    check(last_offer_itr->recipient_asset_ids.size() == 0,
        "The last created AtomicAssets offer must not ask for any assets in return");

    // Verify the memo of the offer to be as expected
    check(last_offer_itr->memo == "tbuyoffer",
        "The last created AtomicAssets offer must have the memo \"tbuyoffer\"");

    // It is not checked whether the AtomicAssets offer is valid, because this will be checked in the
    // acceptoffer action, and if the offer is invalid, the transaction will throw
    action(
        permission_level{get_self(), name("active")},
        atomicassets::ATOMICASSETS_ACCOUNT,
        name("acceptoffer"),
        make_tuple(
            last_offer_itr->offer_id
        )
    ).send();

    internal_transfer_assets(
        buyoffer_itr->buyer,
        std::vector <uint64_t> {asset_id},
        "AtomicMarket Accepted Template Buyoffer - ID # " + to_string(buyoffer_id)
    );

    check(is_valid_marketplace(taker_marketplace),
        "The taker marketplace is not a valid marketplace");

    internal_payout_sale(
        buyoffer_itr->price,
        seller,
        buyoffer_itr->maker_marketplace,
        taker_marketplace,
        buyoffer_itr->collection_name,
        buyoffer_itr->collection_fee,
        std::vector <uint64_t> {asset_id},
        seller, // the asset is still owned by the seller at this point
        name("tbuyoffer"),
        buyoffer_id,
        "AtomicMarket Template Buyoffer Payout - ID #" + to_string(buyoffer_id)
    );

    template_buyoffers.erase(buyoffer_itr);
}


/**
* Create a rental listing for a single asset
* For the listing to become active, the lister needs to use the atomicassets transfer action to
* transfer the asset to the atomicmarket contract with the memo "rental"
*
* price_per_hour is denoted in the listing symbol; if it differs from the settlement symbol, a
* delphi symbol pair has to be configured and the rental is paid in the settlement symbol at the
* exchange rate at the time of renting
*
* maximum_rental_duration is in seconds and is the longest period a single rental (including
* extensions by the same renter) can cover
*
* @required_auth lister
*/
ACTION atomicmarket::announcerent(
    name lister,
    uint64_t asset_id,
    asset price_per_hour,
    symbol settlement_symbol,
    uint32_t maximum_rental_duration,
    name maker_marketplace
) {
    require_auth(lister);

    check(price_per_hour.is_valid(), "Invalid type price_per_hour");
    check(settlement_symbol.is_valid(), "Invalid type settlement_symbol");

    check(price_per_hour.amount > 0, "The price per hour must be greater than zero");

    check(maximum_rental_duration >= 3600,
        "The maximum rental duration must be at least one hour (3600 seconds)");
    check(maximum_rental_duration <= 2419200,
        "The maximum rental duration can't be longer than 28 days");

    name assets_collection_name = get_collection_and_check_assets(lister, vector <uint64_t> {asset_id});

    auto rentals = get_rentals();
    check(rentals.find(asset_id) == rentals.end(),
        "A rental listing for this asset already exists");

    if (price_per_hour.symbol == settlement_symbol) {
        check(is_symbol_supported(price_per_hour.symbol), "The specified listing symbol is not supported.");
    } else {
        check(is_symbol_pair_supported(price_per_hour.symbol, settlement_symbol),
            "The specified listing - settlement symbol combination is not supported");
    }

    check(is_valid_marketplace(maker_marketplace), "The maker marketplace is not a valid marketplace");

    double collection_fee = get_collection_fee(assets_collection_name);
    check(collection_fee <= atomicassets::MAX_MARKET_FEE,
        "The collection fee is too high. This should have been prevented by the atomicassets contract");

    rentals.emplace(lister, [&](auto &_rental) {
        _rental.asset_id = asset_id;
        _rental.owner = lister;
        _rental.holder = name("");
        _rental.price_per_hour = price_per_hour;
        _rental.settlement_symbol = settlement_symbol;
        _rental.maximum_rental_duration = maximum_rental_duration;
        _rental.rental_end = 0;
        _rental.asset_transferred = false;
        _rental.maker_marketplace = maker_marketplace;
        _rental.collection_name = assets_collection_name;
        _rental.collection_fee = collection_fee;
    });

    action(
        permission_level{get_self(), name("active")},
        get_self(),
        name("lognewrent"),
        make_tuple(
            asset_id,
            lister,
            price_per_hour,
            settlement_symbol,
            maximum_rental_duration,
            maker_marketplace,
            assets_collection_name,
            collection_fee
        )
    ).send();
}


/**
* Cancels a rental listing
*
* If the listing is not active yet, it can be cancelled by the owner - or by anyone if the
* owner does not own the asset anymore (which makes the listing invalid)
*
* If the listing is active (the asset is in contract custody), it can only be cancelled by the
* owner and only while no rental is actively running. The asset is then transferred back
*
* @required_auth The listing's owner (see above for the invalid listing exception)
*/
ACTION atomicmarket::cancelrent(
    uint64_t asset_id
) {
    auto rentals = get_rentals();
    auto rental_itr = rentals.require_find(asset_id,
        "No rental listing with this asset_id exists");

    if (!rental_itr->asset_transferred) {
        atomicassets::assets_t owner_assets = atomicassets::get_assets(rental_itr->owner);
        bool is_rental_invalid = owner_assets.find(asset_id) == owner_assets.end();

        check(is_rental_invalid || has_auth(rental_itr->owner),
            "The rental listing is not invalid, therefore the authorization of the owner is needed to cancel it");

        rentals.erase(rental_itr);
        return;
    }

    require_auth(rental_itr->owner);

    check(rental_itr->holder == name("") ||
          rental_itr->rental_end <= current_time_point().sec_since_epoch(),
        "The asset is currently rented out. The listing can only be cancelled after the rental period is over");

    if (rental_itr->holder != name("")) {
        // The rental period is over but the holdership was never reset via endrent.
        // It needs to be reclaimed BEFORE the asset is transferred back, otherwise the
        // holders table row would survive the transfer
        action(
            permission_level{get_self(), name("active")},
            atomicassets::ATOMICASSETS_ACCOUNT,
            name("move"),
            make_tuple(
                get_self(),
                rental_itr->holder,
                get_self(),
                vector <uint64_t> {asset_id},
                string("AtomicMarket Rental Ended")
            )
        ).send();
    }

    internal_transfer_assets(
        rental_itr->owner,
        vector <uint64_t> {asset_id},
        "AtomicMarket Cancelled Rental Listing - Asset ID # " + to_string(asset_id)
    );

    rentals.erase(rental_itr);
}


/**
* Rents an asset for the specified number of hours
*
* The total price (price per hour x hours, converted to the settlement symbol if the listing
* uses a delphi pairing) is deducted from the renter's balance and paid out like a sale payout
* (market fees, collection fee / royalty splits, remainder to the listing owner)
*
* The atomicassets HOLDERSHIP of the asset is moved to the renter until the rental period is
* over, while the ownership stays with the atomicmarket contract
*
* If the renter already holds an active rental for this asset, the new hours extend the
* current rental period instead (the combined remaining period must stay within the listing's
* maximum rental duration)
*
* @required_auth renter
*/
ACTION atomicmarket::rentasset(
    name renter,
    uint64_t asset_id,
    uint32_t rental_hours,
    asset expected_price_per_hour,
    uint64_t intended_delphi_median,
    name taker_marketplace
) {
    require_auth(renter);

    check(expected_price_per_hour.is_valid(), "Invalid type expected_price_per_hour");

    auto rentals = get_rentals();
    auto rental_itr = rentals.require_find(asset_id,
        "No rental listing with this asset_id exists");

    check(rental_itr->asset_transferred,
        "This rental listing is not active yet. The owner first has to transfer the asset to the atomicmarket account");

    check(renter != rental_itr->owner, "You can't rent your own asset");

    check(rental_itr->price_per_hour == expected_price_per_hour,
        "The price per hour of this listing differs from the expected price per hour");

    check(rental_hours > 0, "rental_hours must be at least 1");

    uint32_t current_time = current_time_point().sec_since_epoch();

    bool has_active_rental = rental_itr->holder != name("") && rental_itr->rental_end > current_time;
    bool is_extension = has_active_rental && rental_itr->holder == renter;

    check(!has_active_rental || is_extension,
        "This asset is currently rented out. It can be rented again once the current rental period is over");

    uint64_t added_duration = (uint64_t) rental_hours * 3600;
    uint64_t new_rental_end = (uint64_t)(is_extension ? rental_itr->rental_end : current_time) + added_duration;

    check(new_rental_end - current_time <= rental_itr->maximum_rental_duration,
        "The rental period would exceed the maximum rental duration of this listing");

    check(is_valid_marketplace(taker_marketplace), "The taker marketplace is not a valid marketplace");

    __uint128_t total_listing_amount = (__uint128_t) rental_itr->price_per_hour.amount * rental_hours;
    check(total_listing_amount <= (__uint128_t) asset::max_amount, "The total rental price is too large");

    asset listing_price = asset((int64_t) total_listing_amount, rental_itr->price_per_hour.symbol);

    asset settlement_price = calc_settlement_price(
        listing_price,
        rental_itr->settlement_symbol,
        intended_delphi_median
    );
    check(settlement_price.amount > 0, "The total rental price must be greater than zero");

    internal_decrease_balance(renter, settlement_price);

    uint64_t rental_counter_id = consume_counter(name("rental"));

    internal_payout_sale(
        settlement_price,
        rental_itr->owner,
        rental_itr->maker_marketplace,
        taker_marketplace,
        rental_itr->collection_name,
        rental_itr->collection_fee,
        vector <uint64_t> {asset_id},
        get_self(), // the asset is in contract custody
        name("rental"),
        rental_counter_id,
        "AtomicMarket Rental Payout - ID #" + to_string(rental_counter_id)
    );

    if (!is_extension) {
        // Move the holdership to the renter. If a previous rental expired without endrent
        // being called, the holdership still sits with the previous renter and is moved
        // directly from them; otherwise it is moved from the contract itself
        name move_from = rental_itr->holder == name("") ? get_self() : rental_itr->holder;

        if (move_from != renter) {
            action(
                permission_level{get_self(), name("active")},
                atomicassets::ATOMICASSETS_ACCOUNT,
                name("move"),
                make_tuple(
                    get_self(),
                    move_from,
                    renter,
                    vector <uint64_t> {asset_id},
                    string("AtomicMarket Rental - ID # ") + to_string(rental_counter_id)
                )
            ).send();
        }
    }

    rentals.modify(rental_itr, same_payer, [&](auto &_rental) {
        _rental.holder = renter;
        _rental.rental_end = (uint32_t) new_rental_end;
    });

    action(
        permission_level{get_self(), name("active")},
        get_self(),
        name("logrental"),
        make_tuple(
            rental_counter_id,
            asset_id,
            rental_itr->owner,
            renter,
            rental_hours,
            settlement_price,
            (uint32_t) new_rental_end,
            taker_marketplace
        )
    ).send();
}


/**
* Wraps up an expired rental by moving the holdership of the asset back to the atomicmarket
* contract, making the listing rentable again
*
* This can be called by anyone - it only resets an expired rental back to its listed state
*
* @required_auth None
*/
ACTION atomicmarket::endrent(
    uint64_t asset_id
) {
    auto rentals = get_rentals();
    auto rental_itr = rentals.require_find(asset_id,
        "No rental listing with this asset_id exists");

    check(rental_itr->holder != name(""), "This asset is not currently rented out");

    check(rental_itr->rental_end <= current_time_point().sec_since_epoch(),
        "The rental period is not over yet");

    action(
        permission_level{get_self(), name("active")},
        atomicassets::ATOMICASSETS_ACCOUNT,
        name("move"),
        make_tuple(
            get_self(),
            rental_itr->holder,
            get_self(),
            vector <uint64_t> {asset_id},
            string("AtomicMarket Rental Ended")
        )
    ).send();

    rentals.modify(rental_itr, same_payer, [&](auto &_rental) {
        _rental.holder = name("");
        _rental.rental_end = 0;
    });
}


/**
* Pays the RAM cost for an already existing sale
*/
ACTION atomicmarket::paysaleram(
    name payer,
    uint64_t sale_id
) {
    require_auth(payer);

    auto sales = get_sales();
    auto sale_itr = sales.require_find(sale_id,
        "No sale with this id exists");

    sales_s sale_copy = *sale_itr;

    sales.erase(sale_itr);

    sales.emplace(payer, [&](auto &_sale) {
        _sale = sale_copy;
    });
}


/**
* Pays the RAM cost for an already existing auction
*/
ACTION atomicmarket::payauctram(
    name payer,
    uint64_t auction_id
) {
    require_auth(payer);

    auto auctions = get_auctions();
    auto auction_itr = auctions.require_find(auction_id,
        "No auction with this id exists");

    auctions_s auction_copy = *auction_itr;

    auctions.erase(auction_itr);

    auctions.emplace(payer, [&](auto &_auction) {
        _auction = auction_copy;
    });
}


/**
* Pays the RAM cost for an already existing buyoffer
*/
ACTION atomicmarket::paybuyoram(
    name payer,
    uint64_t buyoffer_id
) {
    require_auth(payer);

    auto buyoffers = get_buyoffers();
    auto buyoffer_itr = buyoffers.require_find(buyoffer_id,
        "No buyoffer with this id exists");

    buyoffers_s buyoffer_copy = *buyoffer_itr;

    buyoffers.erase(buyoffer_itr);

    buyoffers.emplace(payer, [&](auto &_buyoffer) {
        _buyoffer = buyoffer_copy;
    });
}


/**
* Pays the RAM cost for an already existing rental listing
*/
ACTION atomicmarket::payrentram(
    name payer,
    uint64_t asset_id
) {
    require_auth(payer);

    auto rentals = get_rentals();
    auto rental_itr = rentals.require_find(asset_id,
        "No rental listing with this asset_id exists");

    rentals_s rental_copy = *rental_itr;

    rentals.erase(rental_itr);

    rentals.emplace(payer, [&](auto &_rental) {
        _rental = rental_copy;
    });
}


/**
* This function is called when a transfer receipt from any token contract is sent to the atomicmarket contract
* It handels deposits and adds the transferred tokens to the sender's balance table row
*/
void atomicmarket::receive_token_transfer(name from, name to, asset quantity, const string &memo) {
    if (to != get_self()) {
        return;
    }

    check(is_token_supported(get_first_receiver(), quantity.symbol), "The transferred token is not supported");

    if (memo == "deposit") {
        internal_add_balance(from, quantity);
    } else {
        check(false, "invalid memo");
    }
}


/**
* This function is called when a "transfer" action receipt from the atomicassets contract is sent to the atomicmarket
* contract. It handles receiving assets for auctions and rentals.
*/
void atomicmarket::receive_asset_transfer(
    name from,
    name to,
    const vector <uint64_t> &asset_ids,
    const string &memo
) {
    if (to != get_self()) {
        return;
    }

    if (memo == "auction") {
        // Bundle transfers can only ever match a legacy bundle auction row (announceauct
        // enforces single-asset listings) - those can't be activated anymore. Multiple
        // single-asset auctions have to be activated with one transfer each
        check(asset_ids.size() == 1,
            "Bundle transfers can no longer activate auctions. Legacy bundle auctions can be "
            "cancelled by anyone using the cancelauct action");

        checksum256 asset_ids_hash = hash_asset_ids(asset_ids);

        auto auctions = get_auctions();
        auto auctions_by_hash = auctions.get_index <name("assetidshash")>();
        auto auction_itr = auctions_by_hash.find(asset_ids_hash);

        while (true) {
            check(auction_itr != auctions_by_hash.end(),
                "No announced, non-finished auction by the sender for these assets exists");

            check(asset_ids_hash == auction_itr->asset_ids_hash(),
                "No announced, non-finished auction by the sender for these assets exists");

            if (auction_itr->seller == from && current_time_point().sec_since_epoch() < auction_itr->end_time) {
                break;
            }

            auction_itr++;
        }

        auctions_by_hash.modify(auction_itr, same_payer, [&](auto &_auction) {
            _auction.assets_transferred = true;
        });

        action(
            permission_level{get_self(), name("active")},
            get_self(),
            name("logauctstart"),
            make_tuple(
                auction_itr->auction_id
            )
        ).send();

    } else if (memo == "rental") {
        auto rentals = get_rentals();

        for (uint64_t asset_id : asset_ids) {
            auto rental_itr = rentals.require_find(asset_id,
                ("No rental listing exists for one of the transferred assets - " + to_string(asset_id)).c_str());

            check(rental_itr->owner == from,
                ("A rental listing for this asset exists, but it belongs to another account - "
                + to_string(asset_id)).c_str());

            check(!rental_itr->asset_transferred,
                ("The asset for this rental listing has already been transferred - " + to_string(asset_id)).c_str());

            rentals.modify(rental_itr, same_payer, [&](auto &_rental) {
                _rental.asset_transferred = true;
            });

            action(
                permission_level{get_self(), name("active")},
                get_self(),
                name("logrentstart"),
                make_tuple(
                    asset_id,
                    from
                )
            ).send();
        }

    } else {
        check(false, "Invalid memo");
    }
}


/**
* This function is called when a "lognewoffer" action receipt from the atomicassets contract is sent to the
* atomicmarket contract. It handles receiving offers for sales.
*/
void atomicmarket::receive_asset_offer(
    uint64_t offer_id,
    name sender,
    name recipient,
    const vector <uint64_t> &sender_asset_ids,
    const vector <uint64_t> &recipient_asset_ids,
    const string &memo
) {
    if (recipient != get_self()) {
        return;
    }

    if (memo == "sale") {
        check(recipient_asset_ids.size() == 0, "You must not ask for any assets in return in a sale offer");

        // Bundle offers can only ever match a legacy bundle sale row (announcesale enforces
        // single-asset listings) - those can't be activated anymore
        check(sender_asset_ids.size() == 1,
            "Bundle offers can no longer activate sales. Legacy bundle sales can be "
            "cancelled by anyone using the cancelsale action");


        checksum256 asset_ids_hash = hash_asset_ids(sender_asset_ids);

        auto sales = get_sales();
        auto sales_by_hash = sales.get_index <name("assetidshash")>();
        auto sale_itr = sales_by_hash.find(asset_ids_hash);

        while (true) {
            check(sale_itr != sales_by_hash.end(),
                "No sale was announced by this sender for the offered assets");

            check(asset_ids_hash == sale_itr->asset_ids_hash(),
                "No sale was announced by this sender for the offered assets");

            if (sale_itr->seller == sender) {
                break;
            }

            sale_itr++;
        }

        check(sale_itr->offer_id == -1, "An offer for this sale has already been created");

        sales_by_hash.modify(sale_itr, same_payer, [&](auto &_sale) {
            _sale.offer_id = offer_id;
        });

        action(
            permission_level{get_self(), name("active")},
            get_self(),
            name("logsalestart"),
            make_tuple(
                sale_itr->sale_id,
                offer_id
            )
        ).send();

    } else if (memo == "buyoffer" || memo == "tbuyoffer") {
        // Offers for buyoffers are handled in the acceptbuyo action and require no immediate action
    } else {
        check(false, "Invalid memo");
    }
}


ACTION atomicmarket::lognewsale(
    uint64_t sale_id,
    name seller,
    const vector <uint64_t> &asset_ids,
    asset listing_price,
    symbol settlement_symbol,
    name maker_marketplace,
    name collection_name,
    double collection_fee
) {
    require_auth(get_self());

    require_recipient(seller);
}

ACTION atomicmarket::lognewauct(
    uint64_t auction_id,
    name seller,
    const vector <uint64_t> &asset_ids,
    asset starting_bid,
    uint32_t duration,
    uint32_t end_time,
    name maker_marketplace,
    name collection_name,
    double collection_fee
) {
    require_auth(get_self());

    require_recipient(seller);
}

ACTION atomicmarket::lognewbuyo(
    uint64_t buyoffer_id,
    name buyer,
    name recipient,
    asset price,
    const vector <uint64_t> &asset_ids,
    const string &memo,
    name maker_marketplace,
    name collection_name,
    double collection_fee
) {
    require_auth(get_self());
}

ACTION atomicmarket::lognewtbuyo(
    uint64_t buyoffer_id, name buyer, asset price, uint64_t template_id, name maker_marketplace,
    name collection_name, double collection_fee
) {
    require_auth(get_self());
}

ACTION atomicmarket::logsalestart(
    uint64_t sale_id,
    uint64_t offer_id
) {
    require_auth(get_self());
}

ACTION atomicmarket::logauctstart(
    uint64_t auction_id
) {
    require_auth(get_self());
}

ACTION atomicmarket::lognewrent(
    uint64_t asset_id,
    name lister,
    asset price_per_hour,
    symbol settlement_symbol,
    uint32_t maximum_rental_duration,
    name maker_marketplace,
    name collection_name,
    double collection_fee
) {
    require_auth(get_self());

    require_recipient(lister);
}

ACTION atomicmarket::logrentstart(
    uint64_t asset_id,
    name lister
) {
    require_auth(get_self());

    require_recipient(lister);
}

ACTION atomicmarket::logrental(
    uint64_t rental_counter_id,
    uint64_t asset_id,
    name lister,
    name renter,
    uint32_t rental_hours,
    asset paid_settlement_price,
    uint32_t rental_end,
    name taker_marketplace
) {
    require_auth(get_self());

    require_recipient(lister);
    require_recipient(renter);
}

// The royalty distribution logs intentionally notify nobody (see the header comment):
// a require_recipient to an arbitrary payout recipient would let a recipient contract
// assert in its notification handler and block the collection's settlements

ACTION atomicmarket::logroyfound(
    name collection_name,
    uint64_t asset_id,
    const ROYALTYPAYOUT_V &payouts
) {
    require_auth(get_self());
}

ACTION atomicmarket::logroytempl(
    name collection_name,
    uint64_t asset_id,
    int32_t template_id,
    const ROYALTYPAYOUT_V &payouts
) {
    require_auth(get_self());
}

ACTION atomicmarket::logroyattr(
    name collection_name,
    uint64_t asset_id,
    uint64_t rule_id,
    const ROYALTYPAYOUT_V &payouts
) {
    require_auth(get_self());
}

ACTION atomicmarket::logroydust(
    name collection_name,
    name collection_author,
    asset amount
) {
    require_auth(get_self());
}


name atomicmarket::get_collection_and_check_assets(
    name owner,
    const vector <uint64_t> &asset_ids
) {
    check(asset_ids.size() != 0, "asset_ids needs to contain at least one id");

    vector <uint64_t> asset_ids_copy = asset_ids;
    std::sort(asset_ids_copy.begin(), asset_ids_copy.end());
    check(std::adjacent_find(asset_ids_copy.begin(), asset_ids_copy.end()) == asset_ids_copy.end(),
        "The asset_ids must not contain duplicates");


    atomicassets::assets_t owner_assets = atomicassets::get_assets(owner);

    name assets_collection_name = name("");
    // All assets have to belong to the same collection, so the templates table only needs to
    // be constructed once instead of once per asset
    std::optional <atomicassets::templates_t> collection_templates;

    for (uint64_t asset_id : asset_ids) {
        auto asset_itr = owner_assets.require_find(asset_id,
            ("The specified account does not own at least one of the assets - "
            + to_string(asset_id)).c_str());

        if (assets_collection_name == name("")) {
            assets_collection_name = asset_itr->collection_name;
        } else {
            check(assets_collection_name == asset_itr->collection_name,
                "The specified asset ids must all belong to the same collection");
        }

        if (asset_itr->template_id != -1) {
            if (!collection_templates) {
                collection_templates.emplace(atomicassets::ATOMICASSETS_ACCOUNT, assets_collection_name.value);
            }
            auto template_itr = collection_templates->require_find((uint64_t) asset_itr->template_id,
                ("The template of one of the assets does not exist - " + to_string(asset_id)).c_str());
            check(template_itr->transferable,
                ("At least one of the assets is not transferable - " + to_string(asset_id)).c_str());
        }
    }

    return assets_collection_name;
}


/**
* Reads the relevant parts of a row of the atomicassets collections table using a direct,
* size-capped memory read.
*
* The serialized collections row is laid out as:
*   collection_name (8) | author (8) | allow_notify (1) |
*   authorized_accounts (varint length + 8 per entry) |
*   notify_accounts (varint length + 8 per entry) |
*   market_fee (8) | serialized_data (the collection description and other display data)
*
* Everything this contract needs here is the author and the market fee, both of which sit
* BEFORE serialized_data - which regularly holds large amounts of display-only description
* data that is useless for contract logic. Deserializing it through the multi_index API on
* every fee lookup wastes a lot of CPU, so only the leading bytes of the row are read.
* 1000 bytes comfortably cover the two name vectors even for collections with unusually many
* authorizations; in the rare case that a collection has more entries than fit, the read
* window is grown - the description blob is still never read in full.
*/
atomicmarket::COLLECTION_INFO atomicmarket::partial_read_collection(name collection_name) {
    int32_t row_itr = eosio::internal_use_do_not_use::db_find_i64(
        atomicassets::ATOMICASSETS_ACCOUNT.value,
        atomicassets::ATOMICASSETS_ACCOUNT.value,
        name("collections").value,
        collection_name.value
    );
    check(row_itr >= 0, "No collection with this name exists");

    int32_t total_size = eosio::internal_use_do_not_use::db_get_i64(row_itr, nullptr, 0);
    // 8 + 8 + 1 + 1 + 1 + 8 + 1 minimum - empty vectors serialize to a single 0x00 length byte
    check(total_size >= 28, "Invalid collections table row");

    int32_t read_size = std::min(total_size, 1000);

    while (true) {
        vector <char> buffer(read_size);
        eosio::internal_use_do_not_use::db_get_i64(row_itr, buffer.data(), read_size);

        const uint8_t *ptr = (const uint8_t *) buffer.data();
        const uint8_t *end = ptr + read_size;

        // Set when a parse step would run past the read window. The window is then grown
        // and the parse restarted - this can only happen for collections whose authorized /
        // notify account lists exceed ~60 combined entries
        bool truncated = false;

        auto read_bytes = [&](void *destination, size_t length) {
            if ((size_t)(end - ptr) < length) {
                truncated = true;
                return;
            }
            memcpy(destination, ptr, length);
            ptr += length;
        };
        auto skip_bytes = [&](size_t length) {
            if ((size_t)(end - ptr) < length) {
                truncated = true;
                return;
            }
            ptr += length;
        };
        auto read_varint = [&]() -> uint64_t {
            uint64_t result = 0;
            int shift = 0;
            while (true) {
                if (ptr >= end) {
                    truncated = true;
                    return 0;
                }
                check(shift < 64, "Invalid varint in collections table row");
                uint8_t byte = *ptr++;
                result |= (uint64_t)(byte & 0x7F) << shift;
                if (!(byte & 0x80)) {
                    return result;
                }
                shift += 7;
            }
        };

        COLLECTION_INFO collection_info;
        uint64_t raw_name_value;

        skip_bytes(8); // collection_name (already known)
        read_bytes(&raw_name_value, 8);
        collection_info.author = name(raw_name_value);
        skip_bytes(1); // allow_notify

        // Both account vectors are skipped - nothing in this contract needs their contents,
        // they only have to be parsed through to reach market_fee
        for (int vector_index = 0; vector_index < 2 && !truncated; vector_index++) {
            uint64_t account_count = read_varint();
            if (!truncated) {
                check(account_count <= 4096, "Invalid collections table row");
                skip_bytes(account_count * 8);
            }
        }

        if (!truncated) {
            read_bytes(&collection_info.market_fee, 8);
        }

        if (!truncated) {
            return collection_info;
        }

        check(read_size < total_size, "Invalid collections table row");
        read_size = std::min(total_size, read_size * 4);
    }
}


/**
* Gets the author of a collection in the atomicassets contract
*/
name atomicmarket::get_collection_author(name collection_name) {
    return partial_read_collection(collection_name).author;
}


/**
* Gets the fee defined by a collection in the atomicassets contract
*/
double atomicmarket::get_collection_fee(name collection_name) {
    return partial_read_collection(collection_name).market_fee;
}


/**
* Checks that the transaction is authorized by the collection author and returns the author
* (used as RAM payer)
*
* Authorized accounts of the collection are deliberately NOT accepted: royalty configs
* control where funds are paid out, so only the collection's highest authority may change them
*/
name atomicmarket::require_collection_author(name collection_name) {
    name author = partial_read_collection(collection_name).author;

    check(has_auth(author), "The transaction needs the authorization of the collection author");

    return author;
}


/**
* Checks that a royalty recipients list is valid: non-empty, bounded, no duplicate recipients,
* every recipient is an existing account and every weight is positive
*/
void atomicmarket::validate_royalty_recipients(const ROYALTYPAIR_V &recipients) {
    check(recipients.size() > 0, "The recipients list must not be empty");
    check(recipients.size() <= 64, "The recipients list can hold 64 entries max");

    for (size_t i = 0; i < recipients.size(); i++) {
        check(recipients[i].weight > 0, "Recipient weights must be greater than 0");
        check(is_account(recipients[i].recipient),
            ("At least one recipient is not a valid account - " + recipients[i].recipient.to_string()).c_str());

        for (size_t j = i + 1; j < recipients.size(); j++) {
            check(recipients[j].recipient != recipients[i].recipient,
                "The recipients list must not contain duplicates");
        }
    }
}


/**
* Gets the current value of a counter and increments the counter by 1
* If no counter with the specified name exists yet, it is treated as if the counter was 1
*/
uint64_t atomicmarket::consume_counter(name counter_name) {
    uint64_t value;

    auto counters = get_counters();
    auto counter_itr = counters.find(counter_name.value);
    if (counter_itr == counters.end()) {
        value = 1; // Starting with 1 instead of 0 because these ids can be front facing
        counters.emplace(get_self(), [&](auto &_counter) {
            _counter.counter_name = counter_name;
            _counter.counter_value = 2;
        });
    } else {
        value = counter_itr->counter_value;
        counters.modify(counter_itr, get_self(), [&](auto &_counter) {
            _counter.counter_value++;
        });
    }

    return value;
}


/**
* Gets the token_contract corresponding to the token_symbol from the config
* Throws if there is no supported token with the specified token_symbol
*/
name atomicmarket::require_get_supported_token_contract(
    symbol token_symbol
) {
    const config_s &current_config = cached_config();

    for (const TOKEN &supported_token : current_config.supported_tokens) {
        if (supported_token.token_symbol == token_symbol) {
            return supported_token.token_contract;
        }
    }

    check(false, "The specified token symbol is not supported");
    return name(""); //To silence the compiler warning
}


/**
* Gets the symbol pair with the provided listing and settlement symbol combination
* Throws if there is no symbol pair with the provided listing and settlement symbol combination
*/
atomicmarket::SYMBOLPAIR atomicmarket::require_get_symbol_pair(
    symbol listing_symbol,
    symbol settlement_symbol
) {
    const config_s &current_config = cached_config();

    for (const SYMBOLPAIR &symbol_pair : current_config.supported_symbol_pairs) {
        if (symbol_pair.listing_symbol == listing_symbol && symbol_pair.settlement_symbol == settlement_symbol) {
            return symbol_pair;
        }
    }

    check(false, "No symbol pair with the specified listing - settlement symbol combination exists");
    return {}; //To silence the compiler warning
}


/**
* Internal function to check whether an token is a supported token
*/
bool atomicmarket::is_token_supported(
    name token_contract,
    symbol token_symbol
) {
    const config_s &current_config = cached_config();

    for (const TOKEN &supported_token : current_config.supported_tokens) {
        if (supported_token.token_contract == token_contract && supported_token.token_symbol == token_symbol) {
            return true;
        }
    }
    return false;
}


/**
* Internal function to check whether a supported token with this symbol exists
*/
bool atomicmarket::is_symbol_supported(
    symbol token_symbol
) {
    const config_s &current_config = cached_config();

    for (const TOKEN &supported_token : current_config.supported_tokens) {
        if (supported_token.token_symbol == token_symbol) {
            return true;
        }
    }
    return false;
}


/**
* Internal function to check whether a symbol pair with the specified listing and settlement symbols exists
*/
bool atomicmarket::is_symbol_pair_supported(
    symbol listing_symbol,
    symbol settlement_symbol
) {
    const config_s &current_config = cached_config();

    for (const SYMBOLPAIR &symbol_pair : current_config.supported_symbol_pairs) {
        if (symbol_pair.listing_symbol == listing_symbol && symbol_pair.settlement_symbol == settlement_symbol) {
            return true;
        }
    }
    return false;
}


/**
* Checks if the provided marketplace is a valid marketplace
* A marketplace is valid if is in the marketplaces table
*/
bool atomicmarket::is_valid_marketplace(name marketplace) {
    auto marketplaces = get_marketplaces();
    return (marketplaces.find(marketplace.value) != marketplaces.end());
}


/**
* Calculates the price in the settlement symbol for a listing price
*
* For non delphi listings (listing symbol == settlement symbol) the listing price is returned
* unchanged and intended_delphi_median has to be 0
*
* For delphi listings, it is checked that a datapoint with the intended median exists, and the
* final price is calculated using that median and the delphi pair's quoted precision
*/
asset atomicmarket::calc_settlement_price(
    const asset &listing_price,
    symbol settlement_symbol,
    uint64_t intended_delphi_median
) {
    if (listing_price.symbol == settlement_symbol) {
        check(intended_delphi_median == 0, "intended delphi median needs to be 0 for non delphi sales");
        return listing_price;
    }

    SYMBOLPAIR symbol_pair = require_get_symbol_pair(listing_price.symbol, settlement_symbol);

    delphioracle::datapoints_t datapoints = delphioracle::get_datapoints(symbol_pair.delphi_pair_name);

    bool found_point_with_median = false;
    for (auto itr = datapoints.begin(); itr != datapoints.end(); itr++) {
        if (itr->median == intended_delphi_median) {
            found_point_with_median = true;
            break;
        }
    }
    check(found_point_with_median,
        "No datapoint with the intended median was found. You likely took too long to confirm your transaction");


    //Using the price denoted in the listing symbol and the median price provided by the delphioracle,
    //the final price in the settlement token is calculated
    auto delphi_pairs = delphioracle::get_pairs();
    auto pair_itr = delphi_pairs.find(symbol_pair.delphi_pair_name.value);

    uint64_t settlement_price_amount;

    if (!symbol_pair.invert_delphi_pair) {
        //Normal
        settlement_price_amount = (double) listing_price.amount / (double) intended_delphi_median * pow(
            10, pair_itr->quoted_precision + settlement_symbol.precision() -
                listing_price.symbol.precision()
        );
    } else {
        //Inverted
        settlement_price_amount = (double) listing_price.amount * (double) intended_delphi_median * pow(
            10, -pair_itr->quoted_precision + settlement_symbol.precision() -
                listing_price.symbol.precision()
        );
    }

    return asset(settlement_price_amount, settlement_symbol);
}


/**
* Decreases the withdrawers balance by the specified quantity and transfers the tokens to them
* Throws if the withdrawer does not have a sufficient balance
*/
void atomicmarket::internal_withdraw_tokens(
    name withdrawer,
    asset quantity,
    const string &memo
) {
    check(quantity.amount > 0, "The quantity to withdraw must be positive");

    //This will throw if the user does not have sufficient balance
    internal_decrease_balance(withdrawer, quantity);

    name withdraw_token_contract = require_get_supported_token_contract(quantity.symbol);

    action(
        permission_level{get_self(), name("active")},
        withdraw_token_contract,
        name("transfer"),
        make_tuple(
            get_self(),
            withdrawer,
            quantity,
            memo
        )
    ).send();
}


/**
* Gives the seller, the marketplaces and the collection their share of the sale price
*
* The collection fee applied is the collection's fee at EXECUTION time (read fresh from the
* AtomicAssets collections row), never the fee stored when the listing was created. This gives
* the collection author full control: both fee reductions and increases take effect immediately
* on every existing listing
*
* The collection's share is distributed according to the collection's royalty split config
* (see distribute_collection_fee), or in full to the collection author if no config exists
*
* asset_ids / asset_scope describe the assets the payout is for and the atomicassets scope
* (owner) their rows can currently be found in - they are needed to evaluate template and
* attribute based royalty splits
*/
void atomicmarket::internal_payout_sale(
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
) {
    const config_s &current_config = cached_config();

    auto marketplaces = get_marketplaces();

    asset seller_cut_quantity = quantity;

    // Maker market fee
    auto maker_itr = marketplaces.find(maker_marketplace.value);
    asset maker_cut = asset((uint64_t)(current_config.maker_market_fee * (double) quantity.amount), quantity.symbol);
    internal_add_balance(maker_itr->creator, maker_cut);
    seller_cut_quantity -= maker_cut;

    // Taker market fee
    auto taker_itr = marketplaces.find(taker_marketplace.value);
    asset taker_cut = asset((uint64_t)(current_config.taker_market_fee * (double) quantity.amount), quantity.symbol);
    internal_add_balance(taker_itr->creator, taker_cut);
    seller_cut_quantity -= taker_cut;

    // Collection fee - the fee at EXECUTION time ALWAYS applies, regardless of the fee that
    // was stored when the listing was created. This gives the collection author full control:
    // both fee reductions and fee raises take effect immediately on every already-created
    // listing (sales, auctions and rentals alike). The stored collection_fee is retained only
    // for informational / indexing purposes (emitted by the lognew* actions) and no longer
    // influences the payout.
    // The same partial read also provides the author for the royalty distribution.
    COLLECTION_INFO collection_info = partial_read_collection(collection_name);
    double effective_collection_fee = collection_info.market_fee;

    asset collection_cut = asset((uint64_t)(effective_collection_fee * (double) quantity.amount), quantity.symbol);
    if (asset_ids.size() > 1) {
        // Only reachable for pre-V2 bundle listings draining out through the partially
        // claimed auction path (auctclaimsel after the buyer already claimed). Bundles
        // never touch the royalty split engine - the author receives the cut in full
        // and no royalty log actions are emitted
        internal_add_balance(collection_info.author, collection_cut);
    } else {
        distribute_collection_fee(collection_name, collection_info.author, collection_cut, asset_ids, asset_scope);
    }
    seller_cut_quantity -= collection_cut;

    // Bonus fees
    auto bonusfees = get_bonusfees();
    for (auto bonusfee_itr = bonusfees.begin(); bonusfee_itr != bonusfees.end(); bonusfee_itr++) {
        auto counter_range_itr = std::find_if(
            bonusfee_itr->counter_ranges.begin(),
            bonusfee_itr->counter_ranges.end(),
            [&](auto &counter_range) {
                return counter_range.counter_name == relevant_counter_name;
            }
        );

        // If no counter range entry exists, it means that the bonus fee does not apply to
        // this type of payout
        if (counter_range_itr == bonusfee_itr->counter_ranges.end()) {
            continue;
        }
        if (relevant_counter_id < counter_range_itr->start_id || relevant_counter_id >= counter_range_itr->end_id) {
            continue;
        }

        asset bonusfee_cut = asset((uint64_t)(bonusfee_itr->fee * (double) quantity.amount), quantity.symbol);
        internal_add_balance(bonusfee_itr->fee_recipient, bonusfee_cut);
        seller_cut_quantity -= bonusfee_cut;
    }

    // Payout seller
    internal_add_balance(
        seller,
        seller_cut_quantity
    );

    // Directly transfer tokens to the seller
    internal_withdraw_tokens(seller, seller_cut_quantity, seller_payout_message);
}


/**
* Distributes a collection's share of a payout
*
* Only single-asset payouts reach this function (enforced by the check below) - bundle
* payouts from legacy listings are routed to the collection author by internal_payout_sale
* and never touch the split engine.
*
* If the collection has no royalty split config, the full amount goes to the collection author
* (the previous behavior). Otherwise the asset's share is
* divided between the founders, template and attribute categories according to the config's
* split weights. Categories without payees for an asset are renormalized away. Within the
* attributes category, the share is first split across the matched rules proportional to the
* rule weights, and within each rule (and the other categories) by the recipient weights.
*
* All payouts are accrued to the internal balances table (recipients withdraw via the withdraw
* action). No inline transfers are pushed - a recipient that asserts in its transfer handler
* must not be able to block settlements.
*
* All rounding dust is deterministically added to the collection author, so the sum of all
* payouts always exactly equals total_fee.
*/
void atomicmarket::distribute_collection_fee(
    name collection_name,
    name collection_author,
    asset total_fee,
    const vector <uint64_t> &asset_ids,
    name asset_scope
) {
    if (total_fee.amount == 0) {
        return;
    }

    check(asset_ids.size() == 1, "Bundle listings retired");

    auto royaltyconf = get_royaltyconf();
    auto conf_itr = royaltyconf.find(collection_name.value);

    if (conf_itr == royaltyconf.end()) {
        internal_add_balance(collection_author, total_fee);
        return;
    }

    // Payouts are accumulated per recipient and written to the balances table once at the
    // end - this caps the number of table writes regardless of how many rules match
    std::map <name, uint64_t> accrued_payouts = {};
    uint64_t distributed = 0;
    // Everything that falls through to the collection author: shares of assets for which
    // no category had payees, plus all integer rounding dust (reported via logroydust so
    // that the royalty log actions always sum up to exactly the collection fee)
    uint64_t author_fallback = 0;

    auto royaltytemp = get_royaltytemp(collection_name);
    auto royaltyattr = get_royaltyattr(collection_name);
    auto rules_by_hash = royaltyattr.get_index <name("byhash")>();

    bool has_attribute_rules = conf_itr->split_attributes > 0 &&
                               royaltyattr.begin() != royaltyattr.end();
    bool needs_asset_data = conf_itr->split_templates > 0 || has_attribute_rules;

    atomicassets::assets_t scope_assets = atomicassets::get_assets(asset_scope);
    atomicassets::templates_t collection_templates = atomicassets::get_templates(collection_name);
    atomicassets::template_mutables_t template_mutables = atomicassets::get_template_mutables(collection_name);

    // Schema formats are converted and cached once per schema - bundle assets usually share one
    std::map <uint64_t, vector <atomicdata::FORMAT>> format_cache = {};

    uint64_t base_share = (uint64_t) total_fee.amount / asset_ids.size();
    uint64_t first_asset_extra = (uint64_t) total_fee.amount % asset_ids.size();

    // Splits an amount across a recipients list proportional to the recipient weights and
    // returns the individual payouts (for the royalty distribution log actions)
    auto distribute_to_recipients = [&](const ROYALTYPAIR_V &recipients, uint64_t amount) -> ROYALTYPAYOUT_V {
        ROYALTYPAYOUT_V payouts = {};
        if (amount == 0) {
            return payouts;
        }
        uint64_t recipients_total_weight = 0;
        for (const ROYALTYPAIR &royalty_pair : recipients) {
            recipients_total_weight += royalty_pair.weight;
        }
        // The CRUD actions guarantee non-empty lists with strictly positive weights
        for (const ROYALTYPAIR &royalty_pair : recipients) {
            uint64_t payout = (uint64_t)(((__uint128_t) amount * royalty_pair.weight) / recipients_total_weight);
            if (payout > 0) {
                accrued_payouts[royalty_pair.recipient] += payout;
                distributed += payout;
                payouts.push_back({royalty_pair.recipient, asset((int64_t) payout, total_fee.symbol)});
            }
        }
        return payouts;
    };

    struct MATCHED_RULE {
        uint64_t             rule_id;
        uint32_t             weight;
        const ROYALTYPAIR_V *recipients;
    };

    for (size_t asset_index = 0; asset_index < asset_ids.size(); asset_index++) {
        uint64_t asset_share = base_share + (asset_index == 0 ? first_asset_extra : 0);
        if (asset_share == 0) {
            continue;
        }

        const ROYALTYPAIR_V *template_recipients = nullptr;
        int32_t matched_template_id = -1;
        // every attribute rule this asset matches
        vector <MATCHED_RULE> matched_rules = {};

        // The asset row might no longer exist in the expected scope (e.g. an auction where
        // the buyer already claimed and re-transferred the assets). In that case only the
        // founders category can match - the funds are never stranded either way
        auto asset_itr = needs_asset_data ? scope_assets.find(asset_ids[asset_index]) : scope_assets.end();

        if (asset_itr != scope_assets.end() && asset_itr->collection_name == collection_name) {
            if (conf_itr->split_templates > 0 && asset_itr->template_id >= 0) {
                auto template_royalty_itr = royaltytemp.find((uint64_t) asset_itr->template_id);
                if (template_royalty_itr != royaltytemp.end()) {
                    template_recipients = &template_royalty_itr->recipients;
                    matched_template_id = asset_itr->template_id;
                }
            }

            if (has_attribute_rules) {
                // Fetch and convert the schema format (cached across the bundle)
                auto format_itr = format_cache.find(asset_itr->schema_name.value);
                if (format_itr == format_cache.end()) {
                    auto collection_schemas = atomicassets::get_schemas(collection_name);
                    auto schema_itr = collection_schemas.find(asset_itr->schema_name.value);

                    vector <atomicdata::FORMAT> format_lines = {};
                    if (schema_itr != collection_schemas.end()) {
                        format_lines.reserve(schema_itr->format.size());
                        for (const atomicassets::FORMAT &format_line : schema_itr->format) {
                            format_lines.push_back({format_line.name, format_line.type});
                        }
                    }
                    format_itr = format_cache.emplace(asset_itr->schema_name.value, std::move(format_lines)).first;
                }
                const vector <atomicdata::FORMAT> &schema_format = format_itr->second;

                if (!schema_format.empty()) {
                    // The (source id, attribute map) pairs of all data sources that exist for
                    // this asset, pushed in merge-precedence order (highest first). The source
                    // ids deliberately follow that same precedence, matching the AtomicAssets
                    // data hierarchy: 1 asset immutable > 2 asset mutable > 3 template immutable
                    // > 4 template mutable.
                    vector <std::pair <uint8_t, ATTRIBUTE_MAP>> source_maps = {};

                    if (asset_itr->immutable_serialized_data.size() > 0) {
                        source_maps.push_back(
                            {1, atomicdata::deserialize(asset_itr->immutable_serialized_data, schema_format)});
                    }
                    if (asset_itr->mutable_serialized_data.size() > 0) {
                        source_maps.push_back(
                            {2, atomicdata::deserialize(asset_itr->mutable_serialized_data, schema_format)});
                    }
                    if (asset_itr->template_id >= 0) {
                        auto template_itr = collection_templates.find((uint64_t) asset_itr->template_id);
                        if (template_itr != collection_templates.end() &&
                            template_itr->schema_name == asset_itr->schema_name &&
                            template_itr->immutable_serialized_data.size() > 0) {
                            source_maps.push_back(
                                {3, atomicdata::deserialize(template_itr->immutable_serialized_data, schema_format)});
                        }

                        auto template_mutable_itr = template_mutables.find((uint64_t) asset_itr->template_id);
                        if (template_mutable_itr != template_mutables.end() &&
                            template_mutable_itr->schema_name == asset_itr->schema_name &&
                            template_mutable_itr->mutable_serialized_data.size() > 0) {
                            source_maps.push_back(
                                {4, atomicdata::deserialize(template_mutable_itr->mutable_serialized_data,
                                    schema_format)});
                        }
                    }

                    if (conf_itr->attribute_mode == 0) {
                        // Merged mode: std::map::insert keeps existing keys, so inserting the
                        // sources in precedence order makes higher-precedence values win
                        ATTRIBUTE_MAP merged_attributes = {};
                        for (const auto &[source_id, attribute_map] : source_maps) {
                            merged_attributes.insert(attribute_map.begin(), attribute_map.end());
                        }

                        for (const auto &[attribute_field, attribute_value] : merged_attributes) {
                            checksum256 rule_hash = hash_attribute_royalty(0, attribute_field, attribute_value);
                            auto rule_itr = rules_by_hash.find(rule_hash);
                            if (rule_itr != rules_by_hash.end()) {
                                matched_rules.push_back({rule_itr->index, rule_itr->weight, &rule_itr->recipients});
                            }
                        }
                    } else {
                        // Granular mode: every source is probed with its own source id
                        for (const auto &[source_id, attribute_map] : source_maps) {
                            for (const auto &[attribute_field, attribute_value] : attribute_map) {
                                checksum256 rule_hash =
                                    hash_attribute_royalty(source_id, attribute_field, attribute_value);
                                auto rule_itr = rules_by_hash.find(rule_hash);
                                if (rule_itr != rules_by_hash.end()) {
                                    matched_rules.push_back({rule_itr->index, rule_itr->weight, &rule_itr->recipients});
                                }
                            }
                        }
                    }
                }
            }
        }

        // Renormalize the category split weights across the categories that actually have
        // payees for this asset, so that no funds are stranded
        uint64_t founders_split = (conf_itr->split_founders > 0 && conf_itr->founders.size() > 0)
                                  ? conf_itr->split_founders : 0;
        uint64_t templates_split = template_recipients != nullptr ? conf_itr->split_templates : 0;
        uint64_t attributes_split = matched_rules.size() > 0 ? conf_itr->split_attributes : 0;

        uint64_t total_split = founders_split + templates_split + attributes_split;

        if (total_split == 0) {
            // No category has payees for this asset - its share goes to the collection author
            accrued_payouts[collection_author] += asset_share;
            distributed += asset_share;
            author_fallback += asset_share;
            continue;
        }

        if (founders_split > 0) {
            uint64_t category_amount = (uint64_t)(((__uint128_t) asset_share * founders_split) / total_split);
            ROYALTYPAYOUT_V payouts = distribute_to_recipients(conf_itr->founders, category_amount);
            if (payouts.size() > 0) {
                action(
                    permission_level{get_self(), name("active")},
                    get_self(),
                    name("logroyfound"),
                    make_tuple(
                        collection_name,
                        asset_ids[asset_index],
                        payouts
                    )
                ).send();
            }
        }

        if (templates_split > 0) {
            uint64_t category_amount = (uint64_t)(((__uint128_t) asset_share * templates_split) / total_split);
            ROYALTYPAYOUT_V payouts = distribute_to_recipients(*template_recipients, category_amount);
            if (payouts.size() > 0) {
                action(
                    permission_level{get_self(), name("active")},
                    get_self(),
                    name("logroytempl"),
                    make_tuple(
                        collection_name,
                        asset_ids[asset_index],
                        matched_template_id,
                        payouts
                    )
                ).send();
            }
        }

        if (attributes_split > 0) {
            uint64_t category_amount = (uint64_t)(((__uint128_t) asset_share * attributes_split) / total_split);

            // The category share is first split across the matched rules proportional to the
            // rule weights - pooling all recipients directly would let a rule configured with
            // large absolute weights swamp a rule configured with small ones
            uint64_t rules_total_weight = 0;
            for (const MATCHED_RULE &matched_rule : matched_rules) {
                rules_total_weight += matched_rule.weight;
            }

            for (const MATCHED_RULE &matched_rule : matched_rules) {
                uint64_t rule_amount =
                    (uint64_t)(((__uint128_t) category_amount * matched_rule.weight) / rules_total_weight);
                ROYALTYPAYOUT_V payouts = distribute_to_recipients(*matched_rule.recipients, rule_amount);
                if (payouts.size() > 0) {
                    action(
                        permission_level{get_self(), name("active")},
                        get_self(),
                        name("logroyattr"),
                        make_tuple(
                            collection_name,
                            asset_ids[asset_index],
                            matched_rule.rule_id,
                            payouts
                        )
                    ).send();
                }
            }
        }
    }

    // All integer division rounding dust deterministically goes to the collection author,
    // so the sum of all payouts exactly equals total_fee
    check(distributed <= (uint64_t) total_fee.amount,
        "Royalty distribution exceeded the collection fee"); // Can't happen; defensive
    uint64_t dust = (uint64_t) total_fee.amount - distributed;
    if (dust > 0) {
        accrued_payouts[collection_author] += dust;
        author_fallback += dust;
    }

    if (author_fallback > 0) {
        action(
            permission_level{get_self(), name("active")},
            get_self(),
            name("logroydust"),
            make_tuple(
                collection_name,
                collection_author,
                asset((int64_t) author_fallback, total_fee.symbol)
            )
        ).send();
    }

    for (const auto &[recipient, amount] : accrued_payouts) {
        internal_add_balance(recipient, asset((int64_t) amount, total_fee.symbol));
    }
}


/**
* Internal function used to add a quantity of a token to an account's balance
* It is not checked whether the added token is a supported token, this has to be checked before calling this function
*/
void atomicmarket::internal_add_balance(
    name owner,
    asset quantity
) {
    if (quantity.amount == 0) {
        return;
    }
    check(quantity.amount > 0, "Can't add negative balances");

    auto balances = get_balances();
    auto balance_itr = balances.find(owner.value);

    if (balance_itr == balances.end()) {
        //No balance table row exists yet
        balances.emplace(get_self(), [&](auto &_balance) {
            _balance.owner = owner;
            _balance.quantities = {quantity};
        });
        return;
    }

    //A balance table row already exists for owner
    balances.modify(balance_itr, get_self(), [&](auto &_balance) {
        for (asset &token : _balance.quantities) {
            if (token.symbol == quantity.symbol) {
                //If the owner already has a balance for the token, this balance is increased
                token.amount += quantity.amount;
                return;
            }
        }
        //If the owner does not already have a balance for the token, it is added to the vector
        _balance.quantities.push_back(quantity);
    });
}


/**
* Internal function used to deduct a quantity of a token from an account's balance
* If the account does not has less than that quantity in his balance, this function will cause the
* transaction to fail
*/
void atomicmarket::internal_decrease_balance(
    name owner,
    asset quantity
) {
    auto balances = get_balances();
    auto balance_itr = balances.require_find(owner.value,
        "The specified account does not have a balance table row");

    // The token is located first so that the erase / modify decision can be made without
    // copying the quantities vector out of the row
    const vector <asset> &quantities = balance_itr->quantities;
    size_t token_index = 0;
    while (token_index < quantities.size() && quantities[token_index].symbol != quantity.symbol) {
        token_index++;
    }

    check(token_index < quantities.size(),
        "The specified account does not have a balance for the symbol specified in the quantity");
    check(quantities[token_index].amount >= quantity.amount,
        "The specified account's balance is lower than the specified quantity");

    if (quantities[token_index].amount == quantity.amount) {
        if (quantities.size() == 1) {
            //Erasing the balances table row, as no other balances exist
            balances.erase(balance_itr);
        } else {
            //Removing the token from the quantities vector
            balances.modify(balance_itr, same_payer, [&](auto &_balance) {
                _balance.quantities.erase(_balance.quantities.begin() + token_index);
            });
        }
    } else {
        balances.modify(balance_itr, same_payer, [&](auto &_balance) {
            _balance.quantities[token_index].amount -= quantity.amount;
        });
    }
}


void atomicmarket::internal_transfer_assets(
    name to,
    const vector <uint64_t> &asset_ids,
    const string &memo
) {
    action(
        permission_level{get_self(), name("active")},
        atomicassets::ATOMICASSETS_ACCOUNT,
        name("transfer"),
        make_tuple(
            get_self(),
            to,
            asset_ids,
            memo
        )
    ).send();
}
