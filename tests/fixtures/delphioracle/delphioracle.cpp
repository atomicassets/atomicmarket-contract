#include <eosio/eosio.hpp>
#include <eosio/asset.hpp>
#include <eosio/system.hpp>

using namespace eosio;

/*
Minimal delphioracle stand-in for the VeRT test suite. It mirrors the table layout that the
atomicmarket contract reads through delphioracle-interface.hpp and exposes test-only actions
to populate it. NOT a release artifact.

Build (committed wasm/abi; rebuild only when this file changes):
  docker run --rm -v "$PWD":/work -w /work antelope-cdt \
    cdt-cpp -abigen -contract=delphioracle \
    tests/fixtures/delphioracle/delphioracle.cpp \
    -o tests/fixtures/delphioracle/delphioracle.wasm
*/

CONTRACT delphioracle : public contract {
public:
    using contract::contract;

    typedef uint16_t asset_type;

    TABLE pairs_s {
        bool active;
        bool bounty_awarded;
        bool bounty_edited_by_custodians;

        name proposer;
        name name;

        asset bounty_amount;

        std::vector <eosio::name> approving_custodians;
        std::vector <eosio::name> approving_oracles;

        symbol base_symbol;
        asset_type base_type;
        eosio::name base_contract;

        symbol quote_symbol;
        asset_type quote_type;
        eosio::name quote_contract;

        uint64_t quoted_precision;

        uint64_t primary_key() const { return name.value; }
    };
    typedef multi_index <eosio::name("pairs"), pairs_s> pairs_t;

    //Scope: pair_name
    TABLE datapoints_s {
        uint64_t id;
        name owner;
        uint64_t value;
        uint64_t median;
        time_point timestamp;

        uint64_t primary_key() const { return id; }
    };
    typedef multi_index <eosio::name("datapoints"), datapoints_s> datapoints_t;

    ACTION setpair(name pair_name, symbol base_symbol, symbol quote_symbol, uint64_t quoted_precision) {
        require_auth(get_self());

        pairs_t pairs(get_self(), get_self().value);
        check(pairs.find(pair_name.value) == pairs.end(), "A pair with this name already exists");

        pairs.emplace(get_self(), [&](auto &_pair) {
            _pair.active = true;
            _pair.bounty_awarded = true;
            _pair.bounty_edited_by_custodians = false;
            _pair.proposer = get_self();
            _pair.name = pair_name;
            _pair.bounty_amount = asset(0, base_symbol);
            _pair.approving_custodians = {};
            _pair.approving_oracles = {};
            _pair.base_symbol = base_symbol;
            _pair.base_type = 0;
            _pair.base_contract = eosio::name("");
            _pair.quote_symbol = quote_symbol;
            _pair.quote_type = 0;
            _pair.quote_contract = eosio::name("");
            _pair.quoted_precision = quoted_precision;
        });
    }

    ACTION setdata(name pair_name, uint64_t id, uint64_t median) {
        require_auth(get_self());

        datapoints_t datapoints(get_self(), pair_name.value);

        datapoints.emplace(get_self(), [&](auto &_datapoint) {
            _datapoint.id = id;
            _datapoint.owner = get_self();
            _datapoint.value = median;
            _datapoint.median = median;
            _datapoint.timestamp = current_time_point();
        });
    }
};
