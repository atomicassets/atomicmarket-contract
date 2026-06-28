const { Blockchain, nameToBigInt } = require('@vaulta/vert');

/*
 * Admin / config action coverage for the atomicmarket contract (v2 / VeRT).
 *
 * Ports the v2-valid gaps from the Hydra "Admin Actions" + "Misc/regmarket" suites that the
 * market-smoke suite does not already cover:
 *   - init: no-auth guard + config singleton is created at version 2.0.0
 *   - setmarketfee: negative maker / taker / no-auth guards (the fee-ceiling cases live in smoke)
 *   - addconftoken: append same-contract / different-contract tokens + duplicate-symbol / no-auth
 *   - adddelphi: pair registration permutations + every validation guard
 *   - setminbidinc: happy path + zero / negative / no-auth guards
 *   - regmarket: register / second / name==creator + collision / duplicate / no-auth guards
 *
 * Self-contained: the beforeAll/beforeEach below are trimmed copies of the smoke setup (one
 * Blockchain per file). Error strings are matched against the actual v2 src/atomicmarket.cpp.
 */

const MARKET = 'atomicmarket';

describe('atomicmarket admin actions', () => {
    let blockchain;
    let atomicmarket, delphi;
    let user1, marketmaker1, someuseracct;

    const config = () =>
        atomicmarket.tables.config(nameToBigInt(atomicmarket.name)).getTableRows()[0];

    const marketplaces = () =>
        atomicmarket.tables.marketplaces(nameToBigInt(atomicmarket.name)).getTableRows();

    const marketplaceCreator = (marketplaceName) => {
        const row = marketplaces().find((r) => r.marketplace_name === marketplaceName);
        return row ? row.creator : null;
    };

    const hasToken = (contract, sym) =>
        config().supported_tokens.some(
            (t) => t.token_contract === contract && t.token_symbol === sym
        );

    const hasPair = (pair) =>
        config().supported_symbol_pairs.some(
            (p) =>
                p.delphi_pair_name === pair.delphi_pair_name &&
                p.invert_delphi_pair === pair.invert_delphi_pair &&
                p.listing_symbol === pair.listing_symbol &&
                p.settlement_symbol === pair.settlement_symbol
        );

    // setpair(pair_name, base_symbol, quote_symbol, quoted_precision)
    const setpair = (name, base, quote, precision = 4) =>
        delphi.actions.setpair([name, base, quote, precision]).send('delphioracle@active');

    beforeAll(async () => {
        blockchain = new Blockchain();
        atomicmarket = blockchain.createContract(MARKET, './build/atomicmarket');
        delphi = blockchain.createContract('delphioracle', './tests/fixtures/delphioracle/delphioracle');

        user1 = blockchain.createAccount('unauthorized');
        marketmaker1 = blockchain.createAccount('marketmaker1');
        someuseracct = blockchain.createAccount('someuseracct');
    });

    beforeEach(async () => {
        blockchain.resetTables();

        await atomicmarket.actions.init([]).send(`${MARKET}@active`);
        await atomicmarket.actions.addconftoken(['eosio.token', '8,WAX']).send(`${MARKET}@active`);
    });

    /* ------------------------------------------------------------------ */
    /* init                                                               */
    /* ------------------------------------------------------------------ */

    test('init creates the config singleton at version 2.0.0 and the default marketplace', () => {
        const c = config();
        expect(c).toMatchObject({ version: '2.0.0' });
        expect(Number(c.minimum_bid_increase)).toBeCloseTo(0.1);
        expect(Number(c.maker_market_fee)).toBeCloseTo(0.01);
        expect(Number(c.taker_market_fee)).toBeCloseTo(0.01);
        expect(marketplaceCreator('')).toBe('fees.atomic');
    });

    test('init throws without authorization', async () => {
        await expect(
            atomicmarket.actions.init([]).send('unauthorized@active')
        ).rejects.toThrow(/missing required authority/);
    });

    /* ------------------------------------------------------------------ */
    /* setmarketfee  (fee-ceiling cases are covered in market-smoke)       */
    /* ------------------------------------------------------------------ */

    test('setmarketfee updates both fees', async () => {
        await atomicmarket.actions.setmarketfee([0.05, 0.03]).send(`${MARKET}@active`);
        const c = config();
        expect(Number(c.maker_market_fee)).toBeCloseTo(0.05);
        expect(Number(c.taker_market_fee)).toBeCloseTo(0.03);
    });

    test('setmarketfee throws when the maker fee is negative', async () => {
        await expect(
            atomicmarket.actions.setmarketfee([-0.05, 0.03]).send(`${MARKET}@active`)
        ).rejects.toThrow(/Market fees need to be at least 0/);
    });

    test('setmarketfee throws when the taker fee is negative', async () => {
        await expect(
            atomicmarket.actions.setmarketfee([0.05, -0.03]).send(`${MARKET}@active`)
        ).rejects.toThrow(/Market fees need to be at least 0/);
    });

    test('setmarketfee throws without authorization', async () => {
        await expect(
            atomicmarket.actions.setmarketfee([0.05, 0.03]).send('unauthorized@active')
        ).rejects.toThrow(/missing required authority/);
    });

    /* ------------------------------------------------------------------ */
    /* addconftoken                                                        */
    /* ------------------------------------------------------------------ */

    test('addconftoken appends a second token of the same contract', async () => {
        await atomicmarket.actions.addconftoken(['eosio.token', '0,SYS']).send(`${MARKET}@active`);
        expect(hasToken('eosio.token', '8,WAX')).toBe(true);
        expect(hasToken('eosio.token', '0,SYS')).toBe(true);
    });

    test('addconftoken appends a token from a different contract', async () => {
        await atomicmarket.actions.addconftoken(['karmatoken', '4,KARMA']).send(`${MARKET}@active`);
        expect(hasToken('eosio.token', '8,WAX')).toBe(true);
        expect(hasToken('karmatoken', '4,KARMA')).toBe(true);
    });

    test('addconftoken throws when the symbol is already supported', async () => {
        // WAX was added in beforeEach; a different contract with the same symbol still collides
        await expect(
            atomicmarket.actions.addconftoken(['fakewax', '8,WAX']).send(`${MARKET}@active`)
        ).rejects.toThrow(/A token with this symbol is already supported/);
    });

    test('addconftoken throws without authorization', async () => {
        await expect(
            atomicmarket.actions.addconftoken(['eosio.token', '4,KARMA']).send('unauthorized@active')
        ).rejects.toThrow(/missing required authority/);
    });

    /* ------------------------------------------------------------------ */
    /* adddelphi                                                           */
    /* ------------------------------------------------------------------ */

    test('adddelphi registers the first symbol pair', async () => {
        await setpair('waxpusd', '8,WAX', '2,USD');
        await atomicmarket.actions
            .adddelphi(['waxpusd', false, '2,USD', '8,WAX'])
            .send(`${MARKET}@active`);

        expect(
            hasPair({
                delphi_pair_name: 'waxpusd',
                invert_delphi_pair: false,
                listing_symbol: '2,USD',
                settlement_symbol: '8,WAX',
            })
        ).toBe(true);
    });

    test('adddelphi registers a second, different symbol pair', async () => {
        await setpair('waxpusd', '8,WAX', '2,USD');
        await setpair('waxpbtc', '8,WAX', '8,BTC', 8);
        await atomicmarket.actions
            .adddelphi(['waxpusd', false, '2,USD', '8,WAX'])
            .send(`${MARKET}@active`);
        await atomicmarket.actions
            .adddelphi(['waxpbtc', false, '8,BTC', '8,WAX'])
            .send(`${MARKET}@active`);

        expect(hasPair({
            delphi_pair_name: 'waxpusd', invert_delphi_pair: false,
            listing_symbol: '2,USD', settlement_symbol: '8,WAX',
        })).toBe(true);
        expect(hasPair({
            delphi_pair_name: 'waxpbtc', invert_delphi_pair: false,
            listing_symbol: '8,BTC', settlement_symbol: '8,WAX',
        })).toBe(true);
    });

    test('adddelphi allows the same pair name with a different listing symbol', async () => {
        await setpair('waxpusd', '8,WAX', '2,USD');
        await atomicmarket.actions
            .adddelphi(['waxpusd', false, '2,USD', '8,WAX'])
            .send(`${MARKET}@active`);
        await atomicmarket.actions
            .adddelphi(['waxpusd', false, '2,USDT', '8,WAX'])
            .send(`${MARKET}@active`);

        expect(hasPair({
            delphi_pair_name: 'waxpusd', invert_delphi_pair: false,
            listing_symbol: '2,USDT', settlement_symbol: '8,WAX',
        })).toBe(true);
    });

    test('adddelphi registers an inverted pair', async () => {
        // usdwaxp: base 2,USD / quote 8,WAXP. inverted -> listing matches base, settlement matches quote
        await setpair('usdwaxp', '2,USD', '8,WAXP');
        await atomicmarket.actions
            .adddelphi(['usdwaxp', true, '2,USD', '8,WAX'])
            .send(`${MARKET}@active`);

        expect(hasPair({
            delphi_pair_name: 'usdwaxp', invert_delphi_pair: true,
            listing_symbol: '2,USD', settlement_symbol: '8,WAX',
        })).toBe(true);
    });

    test('adddelphi throws when listing and settlement symbol are the same', async () => {
        await setpair('waxpusd', '8,WAX', '2,USD');
        await expect(
            atomicmarket.actions
                .adddelphi(['waxpusd', false, '8,WAX', '8,WAX'])
                .send(`${MARKET}@active`)
        ).rejects.toThrow(/Listing symbol and settlement symbol must be different/);
    });

    test('adddelphi throws when the pair name is missing from the oracle', async () => {
        await expect(
            atomicmarket.actions
                .adddelphi(['nopair', false, '2,USD', '8,WAX'])
                .send(`${MARKET}@active`)
        ).rejects.toThrow(/The provided delphi_pair_name does not exist in the delphi oracle contract/);
    });

    test('adddelphi throws when the listing - settlement combination already exists', async () => {
        await setpair('waxpusd', '8,WAX', '2,USD');
        await setpair('waxpusd2', '8,WAX', '2,USD');
        await atomicmarket.actions
            .adddelphi(['waxpusd', false, '2,USD', '8,WAX'])
            .send(`${MARKET}@active`);

        await expect(
            atomicmarket.actions
                .adddelphi(['waxpusd2', false, '2,USD', '8,WAX'])
                .send(`${MARKET}@active`)
        ).rejects.toThrow(/There already exists a symbol pair with the specified listing - settlement symbol combination/);
    });

    test('adddelphi throws when the settlement symbol is not a supported token', async () => {
        // 4,KARMA is not in supported_tokens, so it can't be a settlement symbol
        await setpair('karmausd', '4,KARMA', '2,USD');
        await expect(
            atomicmarket.actions
                .adddelphi(['karmausd', false, '2,USD', '4,KARMA'])
                .send(`${MARKET}@active`)
        ).rejects.toThrow(/The settlement symbol does not belong to a supported token/);
    });

    test('adddelphi (non-inverted) throws when listing precision != delphi quote precision', async () => {
        await setpair('waxpusd', '8,WAX', '4,USD');
        await expect(
            atomicmarket.actions
                .adddelphi(['waxpusd', false, '2,USD', '8,WAX'])
                .send(`${MARKET}@active`)
        ).rejects.toThrow(/The listing symbol precision needs to be equal to the delphi quote smybol precision for non inverted pairs/);
    });

    test('adddelphi (non-inverted) throws when settlement precision != delphi base precision', async () => {
        await setpair('waxpusd', '4,WAX', '2,USD');
        await expect(
            atomicmarket.actions
                .adddelphi(['waxpusd', false, '2,USD', '8,WAX'])
                .send(`${MARKET}@active`)
        ).rejects.toThrow(/The settlement symbol precision needs to be equal to the delphi base smybol precision for non inverted pairs/);
    });

    test('adddelphi (inverted) throws when listing precision != delphi base precision', async () => {
        await setpair('usdwaxp', '4,USD', '8,WAXP');
        await expect(
            atomicmarket.actions
                .adddelphi(['usdwaxp', true, '2,USD', '8,WAX'])
                .send(`${MARKET}@active`)
        ).rejects.toThrow(/The listing symbol precision needs to be equal to the delphi base smybol precision for inverted pairs/);
    });

    test('adddelphi (inverted) throws when settlement precision != delphi quote precision', async () => {
        await setpair('usdwaxp', '2,USD', '4,WAXP');
        await expect(
            atomicmarket.actions
                .adddelphi(['usdwaxp', true, '2,USD', '8,WAX'])
                .send(`${MARKET}@active`)
        ).rejects.toThrow(/The settlement symbol precision needs to be equal to the delphi quote smybol precision for inverted pairs/);
    });

    test('adddelphi throws without authorization', async () => {
        await setpair('waxpusd', '8,WAX', '2,USD');
        await expect(
            atomicmarket.actions
                .adddelphi(['waxpusd', false, '2,USD', '8,WAX'])
                .send('unauthorized@active')
        ).rejects.toThrow(/missing required authority/);
    });

    /* ------------------------------------------------------------------ */
    /* setminbidinc                                                        */
    /* ------------------------------------------------------------------ */

    test('setminbidinc updates the minimum bid increase', async () => {
        await atomicmarket.actions.setminbidinc([0.2]).send(`${MARKET}@active`);
        expect(Number(config().minimum_bid_increase)).toBeCloseTo(0.2);
    });

    test('setminbidinc throws when the increase is 0', async () => {
        await expect(
            atomicmarket.actions.setminbidinc([0.0]).send(`${MARKET}@active`)
        ).rejects.toThrow(/The bid increase must be greater than 0/);
    });

    test('setminbidinc throws when the increase is negative', async () => {
        await expect(
            atomicmarket.actions.setminbidinc([-0.1]).send(`${MARKET}@active`)
        ).rejects.toThrow(/The bid increase must be greater than 0/);
    });

    test('setminbidinc throws without authorization', async () => {
        await expect(
            atomicmarket.actions.setminbidinc([0.1]).send('unauthorized@active')
        ).rejects.toThrow(/missing required authority/);
    });

    /* ------------------------------------------------------------------ */
    /* regmarket                                                           */
    /* ------------------------------------------------------------------ */

    test('regmarket registers a marketplace', async () => {
        await atomicmarket.actions
            .regmarket(['marketmaker1', 'mymarket1111'])
            .send('marketmaker1@active');
        expect(marketplaceCreator('mymarket1111')).toBe('marketmaker1');
    });

    test('regmarket registers a second marketplace for the same creator', async () => {
        await atomicmarket.actions
            .regmarket(['marketmaker1', 'mymarket1111'])
            .send('marketmaker1@active');
        await atomicmarket.actions
            .regmarket(['marketmaker1', 'mymarket2222'])
            .send('marketmaker1@active');
        expect(marketplaceCreator('mymarket1111')).toBe('marketmaker1');
        expect(marketplaceCreator('mymarket2222')).toBe('marketmaker1');
    });

    test('regmarket allows a marketplace name equal to the creator account name', async () => {
        // marketplace_name is an existing account, but it is the creator's own name (self-auth)
        await atomicmarket.actions
            .regmarket(['marketmaker1', 'marketmaker1'])
            .send('marketmaker1@active');
        expect(marketplaceCreator('marketmaker1')).toBe('marketmaker1');
    });

    test('regmarket throws when the name is another existing account', async () => {
        await expect(
            atomicmarket.actions
                .regmarket(['marketmaker1', 'someuseracct'])
                .send('marketmaker1@active')
        ).rejects.toThrow(/When the marketplace has the name of an existing account, its authorization is required/);
    });

    test('regmarket throws when a marketplace with this name already exists', async () => {
        await atomicmarket.actions
            .regmarket(['marketmaker1', 'mymarket1111'])
            .send('marketmaker1@active');
        await expect(
            atomicmarket.actions
                .regmarket(['marketmaker1', 'mymarket1111'])
                .send('marketmaker1@active')
        ).rejects.toThrow(/A marketplace with this name already exists/);
    });

    test('regmarket throws without the creator authorization', async () => {
        await expect(
            atomicmarket.actions
                .regmarket(['marketmaker1', 'mymarket1111'])
                .send('unauthorized@active')
        ).rejects.toThrow(/missing required authority/);
    });
});
