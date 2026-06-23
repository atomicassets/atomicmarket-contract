const { Blockchain, nameToBigInt, mintTokens } = require('@vaulta/vert');
const { Name, TimePoint } = require('@wharfkit/antelope');
const fs = require('fs');

/*
 * End-to-end smoke suite for the atomicmarket contract.
 *
 * Covers the three workstreams:
 *  1. Notification dispatch (the on_notify handlers): proves atomicassets::transfer routes to
 *     receive_asset_transfer (and NOT the *::transfer token handler), token transfers route to
 *     receive_token_transfer, and atomicassets::lognewoffer routes to receive_asset_offer.
 *  2. Sale payouts: legacy collection fee (no royalty config) and the full royalty split
 *     engine (founders / template / attribute categories, exact integer math incl. dust).
 *  3. Custodial rentals: announce -> custody transfer -> rent (holdership moves to the renter
 *     in the atomicassets holders table) -> extension -> expiry -> endrent -> cancelrent.
 */

const WAX = (amount) => `${amount.toFixed(8)} WAX`;
const ASSET1 = '1099511627776'; // first minted asset id (2^40)
const ASSET2 = '1099511627777';
const MARKET = 'atomicmarket';
const AA = 'atomicassets';
const COL = 'testcollect1';

describe('atomicmarket end to end', () => {
    let blockchain;
    let atomicmarket, atomicassets, token, delphi;
    let author, seller, buyer, renter, renter2;
    let founder1, founder2, temproy1, attrroy1, feesAtomic;

    const aaTables = {
        assets: (scope) => atomicassets.tables.assets(nameToBigInt(Name.from(scope))).getTableRows(),
        holders: () => atomicassets.tables.holders(nameToBigInt(atomicassets.name)).getTableRows(),
        offers: () => atomicassets.tables.offers(nameToBigInt(atomicassets.name)).getTableRows(),
    };
    const marketTables = {
        balances: () => atomicmarket.tables.balances(nameToBigInt(atomicmarket.name)).getTableRows(),
        sales: () => atomicmarket.tables.sales(nameToBigInt(atomicmarket.name)).getTableRows(),
        auctions: () => atomicmarket.tables.auctions(nameToBigInt(atomicmarket.name)).getTableRows(),
        rentals: () => atomicmarket.tables.rentals(nameToBigInt(atomicmarket.name)).getTableRows(),
    };

    const balanceOf = (account) => {
        const row = marketTables.balances().find((r) => r.owner === account);
        return row ? row.quantities : null;
    };

    beforeAll(async () => {
        blockchain = new Blockchain();
        atomicassets = blockchain.createContract(AA, './tests/fixtures/atomicassets/atomicassets');
        atomicmarket = blockchain.createContract(MARKET, './build/atomicmarket');
        delphi = blockchain.createContract('delphioracle', './tests/fixtures/delphioracle/delphioracle');
        token = blockchain.createAccount({
            name: Name.from('eosio.token'),
            wasm: fs.readFileSync('./tests/fixtures/eosio.token/eosio.token.wasm'),
            abi: fs.readFileSync('./tests/fixtures/eosio.token/eosio.token.abi', 'utf8'),
        });

        author = blockchain.createAccount('author');
        seller = blockchain.createAccount('seller');
        buyer = blockchain.createAccount('buyer');
        renter = blockchain.createAccount('renter');
        renter2 = blockchain.createAccount('renter2');
        founder1 = blockchain.createAccount('founder1');
        founder2 = blockchain.createAccount('founder2');
        temproy1 = blockchain.createAccount('temproy1');
        attrroy1 = blockchain.createAccount('attrroy1');
        feesAtomic = blockchain.createAccount('fees.atomic');
    });

    beforeEach(async () => {
        blockchain.resetTables();

        await atomicassets.actions.init([]).send(`${AA}@active`);
        await atomicmarket.actions.init([]).send(`${MARKET}@active`);

        await atomicmarket.actions.addconftoken(['eosio.token', '8,WAX']).send(`${MARKET}@active`);

        await mintTokens(token, 'WAX', 8, 1000000000, 10000, [buyer, renter, renter2]);

        // Collection with a 10% market fee, author also authorized
        await atomicassets.actions.createcol([
            'author', COL, true, ['author'], [], 0.1, [],
        ]).send('author@active');

        await atomicassets.actions.createschema([
            'author', COL, 'testschema',
            [
                { name: 'name', type: 'string' },
                { name: 'rarity', type: 'string' },
                { name: 'level', type: 'uint32' },
            ],
        ]).send('author@active');

        // Template 1 with immutable template data
        await atomicassets.actions.createtempl([
            'author', COL, 'testschema', true, true, 0,
            [{ first: 'name', second: ['string', 'TestItem'] }],
        ]).send('author@active');

        // ASSET1: template asset owned by seller, rarity legendary in the asset immutable data
        await atomicassets.actions.mintasset([
            'author', COL, 'testschema', 1, 'seller',
            [{ first: 'rarity', second: ['string', 'legendary'] }], [], [],
        ]).send('author@active');

        // ASSET2: templateless asset owned by seller
        await atomicassets.actions.mintasset([
            'author', COL, 'testschema', -1, 'seller',
            [], [], [],
        ]).send('author@active');
    });

    const deposit = async (account, amount) => {
        await token.actions.transfer([
            account, MARKET, WAX(amount), 'deposit',
        ]).send(`${account}@active`);
    };

    /* ------------------------------------------------------------------ */
    /* 1. Notification dispatch                                            */
    /* ------------------------------------------------------------------ */

    test('token transfer with deposit memo routes to receive_token_transfer', async () => {
        await deposit('buyer', 5);
        expect(balanceOf('buyer')).toEqual([WAX(5)]);
    });

    test('atomicassets transfer routes to receive_asset_transfer (exact beats *::transfer)', async () => {
        // announce an auction, then transfer the asset with the "auction" memo.
        // If the wildcard token handler intercepted the atomicassets::transfer notification,
        // this would abort with a token error instead of activating the auction.
        await atomicmarket.actions.announceauct([
            'seller', [ASSET1], WAX(1), 600, '',
        ]).send('seller@active');

        await atomicassets.actions.transfer([
            'seller', MARKET, [ASSET1], 'auction',
        ]).send('seller@active');

        const auctions = marketTables.auctions();
        expect(auctions.length).toBe(1);
        expect(auctions[0].assets_transferred).toBe(true);
    });

    test('atomicassets transfer with an unknown memo aborts in the asset handler', async () => {
        await expect(
            atomicassets.actions.transfer([
                'seller', MARKET, [ASSET1], 'something else',
            ]).send('seller@active')
        ).rejects.toThrow(/Invalid memo/);
    });

    test('lognewoffer routes to receive_asset_offer and activates the sale', async () => {
        await atomicmarket.actions.announcesale([
            'seller', [ASSET1], WAX(1), '8,WAX', '',
        ]).send('seller@active');

        await atomicassets.actions.createoffer([
            'seller', MARKET, [ASSET1], [], 'sale',
        ]).send('seller@active');

        const sales = marketTables.sales();
        expect(sales.length).toBe(1);
        expect(Number(sales[0].offer_id)).toBeGreaterThanOrEqual(1);
    });

    /* ------------------------------------------------------------------ */
    /* 2. Sales + royalty splits                                           */
    /* ------------------------------------------------------------------ */

    const listAndActivateSale = async (assetIds, price) => {
        await atomicmarket.actions.announcesale([
            'seller', assetIds, WAX(price), '8,WAX', '',
        ]).send('seller@active');
        await atomicassets.actions.createoffer([
            'seller', MARKET, assetIds, [], 'sale',
        ]).send('seller@active');
    };

    test('purchase with no royalty config pays the full collection fee to the author', async () => {
        await listAndActivateSale([ASSET1], 1);
        await deposit('buyer', 1);

        await atomicmarket.actions.purchasesale([
            'buyer', 1, 0, '',
        ]).send('buyer@active');

        // 1.00000000 WAX: 1% maker + 1% taker -> fees.atomic, 10% -> author,
        // 88% withdrawn straight to the seller's token balance
        expect(balanceOf('author')).toEqual([WAX(0.1)]);
        expect(balanceOf('fees.atomic')).toEqual([WAX(0.02)]);
        expect(balanceOf('buyer')).toBeNull(); // fully spent, row erased
        expect(balanceOf('seller')).toBeNull(); // paid out via direct transfer

        const sellerTokens = token.tables.accounts(nameToBigInt(Name.from('seller'))).getTableRows();
        expect(sellerTokens).toEqual([{ balance: WAX(0.88) }]);

        // the asset moved to the buyer
        expect(aaTables.assets('buyer').length).toBe(1);
        expect(marketTables.sales()).toEqual([]);
    });

    const setupRoyaltySplits = async () => {
        // founders f1:1 f2:3, equal category weights, merged attribute mode
        await atomicmarket.actions.setroyalconf([
            COL,
            [{ recipient: 'founder1', weight: 1 }, { recipient: 'founder2', weight: 3 }],
            0, 1, 1, 1,
        ]).send('author@active');

        await atomicmarket.actions.settemplroy([
            COL, 1, [{ recipient: 'temproy1', weight: 1 }],
        ]).send('author@active');

        await atomicmarket.actions.setattrroy([
            COL, 0, 'rarity', ['string', 'legendary'], 1,
            [{ recipient: 'attrroy1', weight: 1 }],
        ]).send('author@active');
    };

    test('royalty config CRUD only accepts the collection author', async () => {
        await expect(
            atomicmarket.actions.setroyalconf([
                COL, [{ recipient: 'founder1', weight: 1 }], 0, 1, 0, 0,
            ]).send('seller@active')
        ).rejects.toThrow(/authorization of the collection author/);

        // even an AUTHORIZED account of the collection is rejected - royalty configs
        // control finances, so only the highest authority (the author) is accepted
        await atomicassets.actions.addcolauth([COL, 'seller']).send('author@active');
        await expect(
            atomicmarket.actions.setroyalconf([
                COL, [{ recipient: 'founder1', weight: 1 }], 0, 1, 0, 0,
            ]).send('seller@active')
        ).rejects.toThrow(/authorization of the collection author/);

        await atomicmarket.actions.setroyalconf([
            COL, [{ recipient: 'founder1', weight: 1 }], 0, 1, 0, 0,
        ]).send('author@active');
    });

    test('purchase splits the collection fee across all three categories with exact dust', async () => {
        await setupRoyaltySplits();
        await listAndActivateSale([ASSET1], 1);
        await deposit('buyer', 1);

        await atomicmarket.actions.purchasesale(['buyer', 1, 0, '']).send('buyer@active');

        // collection cut = 10000000 (0.1 WAX), categories renormalize to 1/3 each = 3333333
        // founders: f1 = 3333333*1/4 = 833333, f2 = 3333333*3/4 = 2499999
        // template: 3333333 ; attribute: 3333333 ; dust = 10000000 - 9999998 = 2 -> author
        expect(balanceOf('founder1')).toEqual(['0.00833333 WAX']);
        expect(balanceOf('founder2')).toEqual(['0.02499999 WAX']);
        expect(balanceOf('temproy1')).toEqual(['0.03333333 WAX']);
        expect(balanceOf('attrroy1')).toEqual(['0.03333333 WAX']);
        expect(balanceOf('author')).toEqual(['0.00000002 WAX']);

        // every category emits its distribution log inline, and the rounding dust that
        // went to the author is reported via logroydust so the logs sum to the full fee
        const logNames = blockchain.executionTraces.map((t) => t.action.toString());
        expect(logNames).toContain('logroyfound');
        expect(logNames).toContain('logroytempl');
        expect(logNames).toContain('logroyattr');
        expect(logNames).toContain('logroydust');
    });

    test('templateless asset with no matching attribute renormalizes to founders only', async () => {
        await setupRoyaltySplits();
        await listAndActivateSale([ASSET2], 1);
        await deposit('buyer', 1);

        await atomicmarket.actions.purchasesale(['buyer', 1, 0, '']).send('buyer@active');

        // only the founders category matches -> it gets the whole 0.1 WAX
        // f1 = 10000000/4 = 2500000, f2 = 7500000, no dust
        expect(balanceOf('founder1')).toEqual([WAX(0.025)]);
        expect(balanceOf('founder2')).toEqual([WAX(0.075)]);
        expect(balanceOf('author')).toBeNull();
    });

    test('attribute_mode is locked while rules exist; delroyalconf requires empty rules', async () => {
        await setupRoyaltySplits();

        await expect(
            atomicmarket.actions.setroyalconf([
                COL, [{ recipient: 'founder1', weight: 1 }], 1, 1, 1, 1,
            ]).send('author@active')
        ).rejects.toThrow(/attribute_mode can't be changed/);

        await expect(
            atomicmarket.actions.delroyalconf([COL]).send('author@active')
        ).rejects.toThrow(/must be deleted before the config/);

        // rule ids are allocated from a persistent counter starting at 1
        await atomicmarket.actions.deltemplroy([COL, 1]).send('author@active');
        await atomicmarket.actions.delattrroy([COL, 1]).send('author@active');
        await atomicmarket.actions.delroyalconf([COL]).send('author@active');
    });

    test('rule weight/recipient validation rejects bad input', async () => {
        await atomicmarket.actions.setroyalconf([
            COL, [{ recipient: 'founder1', weight: 1 }], 0, 1, 1, 1,
        ]).send('author@active');

        await expect(
            atomicmarket.actions.settemplroy([
                COL, 1, [{ recipient: 'founder1', weight: 0 }],
            ]).send('author@active')
        ).rejects.toThrow(/weights must be greater than 0/);

        await expect(
            atomicmarket.actions.settemplroy([
                COL, 1, [{ recipient: 'nonexistent1', weight: 1 }],
            ]).send('author@active')
        ).rejects.toThrow(/not a valid account/);

        await expect(
            atomicmarket.actions.setattrroy([
                COL, 0, 'level', ['float64', 1.5], 1, [{ recipient: 'founder1', weight: 1 }],
            ]).send('author@active')
        ).rejects.toThrow(/float typed attributes/);

        await expect(
            atomicmarket.actions.setattrroy([
                COL, 2, 'rarity', ['string', 'legendary'], 1, [{ recipient: 'founder1', weight: 1 }],
            ]).send('author@active')
        ).rejects.toThrow(/merged attribute mode/);
    });

    /* ------------------------------------------------------------------ */
    /* Delphi-priced (oracle) settlement                                    */
    /* ------------------------------------------------------------------ */

    // waxpusd pair: base 8,WAX / quote 2,USD, quoted_precision 4.
    // median 500 = 0.0500 USD per WAX, i.e. 1 USD = 20 WAX
    const setupDelphiPair = async () => {
        await delphi.actions.setpair(['waxpusd', '8,WAX', '2,USD', 4]).send('delphioracle@active');
        await delphi.actions.setdata(['waxpusd', 1, 500]).send('delphioracle@active');
        await atomicmarket.actions.adddelphi(['waxpusd', false, '2,USD', '8,WAX']).send(`${MARKET}@active`);
    };

    test('delphi-priced sale settles in WAX at the oracle rate', async () => {
        await setupDelphiPair();

        await atomicmarket.actions.announcesale([
            'seller', [ASSET1], '10.00 USD', '8,WAX', '',
        ]).send('seller@active');
        await atomicassets.actions.createoffer([
            'seller', MARKET, [ASSET1], [], 'sale',
        ]).send('seller@active');

        await deposit('buyer', 200);

        // a wrong intended median is rejected
        await expect(
            atomicmarket.actions.purchasesale(['buyer', 1, 999, '']).send('buyer@active')
        ).rejects.toThrow(/No datapoint with the intended median/);

        // 10.00 USD at 0.05 USD/WAX = 200 WAX
        await atomicmarket.actions.purchasesale(['buyer', 1, 500, '']).send('buyer@active');

        expect(balanceOf('author')).toEqual([WAX(20)]);       // 10% of 200 WAX
        expect(balanceOf('fees.atomic')).toEqual([WAX(4)]);   // 2% of 200 WAX
        const sellerTokens = token.tables.accounts(nameToBigInt(Name.from('seller'))).getTableRows();
        expect(sellerTokens).toEqual([{ balance: WAX(176) }]); // 88% of 200 WAX
        expect(aaTables.assets('buyer').length).toBe(1);
    });

    test('delphi-priced rental settles in WAX at the oracle rate', async () => {
        await setupDelphiPair();

        await atomicmarket.actions.announcerent([
            'seller', ASSET1, '0.50 USD', '8,WAX', 86400, '',
        ]).send('seller@active');
        await atomicassets.actions.transfer([
            'seller', MARKET, [ASSET1], 'rental',
        ]).send('seller@active');

        await deposit('renter', 20);

        // 2 hours x 0.50 USD = 1.00 USD = 20 WAX
        await atomicmarket.actions.rentasset([
            'renter', ASSET1, 2, '0.50 USD', 500, '',
        ]).send('renter@active');

        expect(balanceOf('author')).toEqual([WAX(2)]);          // 10% of 20 WAX
        expect(balanceOf('fees.atomic')).toEqual([WAX(0.4)]);   // 2% of 20 WAX
        const sellerTokens = token.tables.accounts(nameToBigInt(Name.from('seller'))).getTableRows();
        expect(sellerTokens).toEqual([{ balance: WAX(17.6) }]); // 88% of 20 WAX
        expect(marketTables.rentals()[0].holder).toBe('renter');
    });

    test('lowering the collection fee after listing discounts the executed sale', async () => {
        await listAndActivateSale([ASSET1], 1);
        await deposit('buyer', 1);

        // the author runs a temporary discount: 10% -> 2%
        await atomicassets.actions.setmarketfee([COL, 0.02]).send('author@active');

        await atomicmarket.actions.purchasesale(['buyer', 1, 0, '']).send('buyer@active');

        expect(balanceOf('author')).toEqual([WAX(0.02)]);
        const sellerTokens = token.tables.accounts(nameToBigInt(Name.from('seller'))).getTableRows();
        expect(sellerTokens).toEqual([{ balance: WAX(0.96) }]);
    });

    test('raising the collection fee after listing applies at execution time', async () => {
        await listAndActivateSale([ASSET1], 1);
        await deposit('buyer', 1);

        // the author raises the fee after listing: 10% -> 15%
        await atomicassets.actions.setmarketfee([COL, 0.15]).send('author@active');

        await atomicmarket.actions.purchasesale(['buyer', 1, 0, '']).send('buyer@active');

        // the fee at execution time (15%) now applies, overriding the 10% stored at listing time
        expect(balanceOf('author')).toEqual([WAX(0.15)]);
        const sellerTokens = token.tables.accounts(nameToBigInt(Name.from('seller'))).getTableRows();
        expect(sellerTokens).toEqual([{ balance: WAX(0.83) }]); // 1 - 0.15 collection - 0.01 maker - 0.01 taker
    });

    test('minimal 28-byte collection row (empty lists, empty data) can list and sell', async () => {
        // regression: partial_read_collection used to require rows >= 33 bytes, but a
        // collection with no authorized accounts, no notify accounts and no display data
        // serializes to exactly 28 bytes (empty vectors pack as one 0x00 length byte)
        await atomicassets.actions.createcol([
            'author', 'mincolxxxxxx', true, ['author'], [], 0.05, [],
        ]).send('author@active');
        await atomicassets.actions.createschema([
            'author', 'mincolxxxxxx', 'minschema', [{ name: 'name', type: 'string' }],
        ]).send('author@active');
        await atomicassets.actions.mintasset([
            'author', 'mincolxxxxxx', 'minschema', -1, 'seller', [], [], [],
        ]).send('author@active');

        // shrink the row to its 28-byte minimum AFTER minting
        await atomicassets.actions.remcolauth(['mincolxxxxxx', 'author']).send('author@active');

        const minAsset = aaTables.assets('seller')
            .find((a) => a.collection_name === 'mincolxxxxxx').asset_id;

        await atomicmarket.actions.announcesale([
            'seller', [minAsset], WAX(1), '8,WAX', '',
        ]).send('seller@active');
        await atomicassets.actions.createoffer([
            'seller', MARKET, [minAsset], [], 'sale',
        ]).send('seller@active');

        await deposit('buyer', 1);
        await atomicmarket.actions.purchasesale(['buyer', 1, 0, '']).send('buyer@active');

        expect(balanceOf('author')).toEqual([WAX(0.05)]);
        expect(aaTables.assets('buyer').some((a) => a.asset_id === minAsset)).toBe(true);
    });

    // ASSET3: template asset with both a rarity and a level attribute (level is uint32
    // per the schema), used by the granular / multi-rule / type-strictness tests
    const ASSET3 = '1099511627778';
    const mintAsset3 = async () => {
        await atomicassets.actions.mintasset([
            'author', COL, 'testschema', 1, 'seller',
            [
                { first: 'rarity', second: ['string', 'legendary'] },
                { first: 'level', second: ['uint32', 10] },
            ], [], [],
        ]).send('author@active');
    };

    test('granular attribute mode matches per data source', async () => {
        // attributes-only config in granular mode (1)
        await atomicmarket.actions.setroyalconf([COL, [], 1, 0, 0, 1]).send('author@active');

        // source 1 = asset immutable data - ASSET1 has rarity=legendary there
        await atomicmarket.actions.setattrroy([
            COL, 1, 'rarity', ['string', 'legendary'], 1, [{ recipient: 'attrroy1', weight: 1 }],
        ]).send('author@active');
        // source 3 = template immutable data - template 1 has NO rarity, so this never matches
        await atomicmarket.actions.setattrroy([
            COL, 3, 'rarity', ['string', 'legendary'], 1, [{ recipient: 'temproy1', weight: 1 }],
        ]).send('author@active');

        await listAndActivateSale([ASSET1], 1);
        await deposit('buyer', 1);
        await atomicmarket.actions.purchasesale(['buyer', 1, 0, '']).send('buyer@active');

        // only the asset-immutable rule matched; it gets the whole 0.1 WAX collection cut
        expect(balanceOf('attrroy1')).toEqual([WAX(0.1)]);
        expect(balanceOf('temproy1')).toBeNull();
        expect(balanceOf('author')).toBeNull();
    });

    test('multiple matched rules split the attributes category by rule weight', async () => {
        await mintAsset3();

        await atomicmarket.actions.setroyalconf([COL, [], 0, 0, 0, 1]).send('author@active');
        await atomicmarket.actions.setattrroy([
            COL, 0, 'rarity', ['string', 'legendary'], 3, [{ recipient: 'founder1', weight: 1 }],
        ]).send('author@active');
        await atomicmarket.actions.setattrroy([
            COL, 0, 'level', ['uint32', 10], 1, [{ recipient: 'founder2', weight: 1 }],
        ]).send('author@active');

        await listAndActivateSale([ASSET3], 1);
        await deposit('buyer', 1);
        await atomicmarket.actions.purchasesale(['buyer', 1, 0, '']).send('buyer@active');

        // 0.1 WAX attributes category, split 3:1 across the two matched rules
        expect(balanceOf('founder1')).toEqual([WAX(0.075)]);
        expect(balanceOf('founder2')).toEqual([WAX(0.025)]);
        expect(balanceOf('author')).toBeNull();
    });

    test('attribute matching is type-strict: int32 rule does not match a uint32 value', async () => {
        await mintAsset3();

        await atomicmarket.actions.setroyalconf([
            COL, [{ recipient: 'founder1', weight: 1 }], 0, 1, 0, 1,
        ]).send('author@active');
        // the schema deserializes level as uint32 - an int32-typed rule must NOT match
        await atomicmarket.actions.setattrroy([
            COL, 0, 'level', ['int32', 10], 1, [{ recipient: 'attrroy1', weight: 1 }],
        ]).send('author@active');

        await listAndActivateSale([ASSET3], 1);
        await deposit('buyer', 1);
        await atomicmarket.actions.purchasesale(['buyer', 1, 0, '']).send('buyer@active');

        // attributes category had no match, so everything renormalizes to founders
        expect(balanceOf('attrroy1')).toBeNull();
        expect(balanceOf('founder1')).toEqual([WAX(0.1)]);
    });

    /* ------------------------------------------------------------------ */
    /* Bundle listing removal                                              */
    /* ------------------------------------------------------------------ */

    test('bundle listings are rejected at creation', async () => {
        await expect(
            atomicmarket.actions.announcesale([
                'seller', [ASSET1, ASSET2], WAX(1), '8,WAX', '',
            ]).send('seller@active')
        ).rejects.toThrow(/exactly one asset id/);

        await expect(
            atomicmarket.actions.announceauct([
                'seller', [ASSET1, ASSET2], WAX(1), 600, '',
            ]).send('seller@active')
        ).rejects.toThrow(/exactly one asset id/);

        await deposit('buyer', 1);
        await expect(
            atomicmarket.actions.createbuyo([
                'buyer', 'seller', WAX(1), [ASSET1, ASSET2], '', '',
            ]).send('buyer@active')
        ).rejects.toThrow(/exactly one asset id/);
    });

    // legacy bundle rows can no longer be created through actions, so they are injected
    // directly into the table store to simulate pre-upgrade state
    const injectLegacyBundleSale = () => {
        atomicmarket.tables.sales(nameToBigInt(atomicmarket.name)).set(1n, atomicmarket.name, {
            sale_id: 1,
            seller: 'seller',
            asset_ids: [ASSET1, ASSET2],
            offer_id: -1,
            listing_price: WAX(1),
            settlement_symbol: '8,WAX',
            maker_marketplace: '',
            collection_name: COL,
            collection_fee: 0.1,
        });
    };

    test('purchasing a legacy bundle sale cancels it and charges the buyer nothing', async () => {
        injectLegacyBundleSale();
        await deposit('buyer', 1);

        await atomicmarket.actions.purchasesale(['buyer', 1, 0, '']).send('buyer@active');

        expect(marketTables.sales()).toEqual([]);
        expect(balanceOf('buyer')).toEqual([WAX(1)]); // untouched
        expect(balanceOf('author')).toBeNull(); // no fee was paid out
    });

    test('anyone can cancel a legacy bundle sale', async () => {
        injectLegacyBundleSale();

        await atomicmarket.actions.cancelsale([1]).send('buyer@active');

        expect(marketTables.sales()).toEqual([]);
    });

    test('bidding on a legacy bundle auction dissolves it', async () => {
        atomicmarket.tables.auctions(nameToBigInt(atomicmarket.name)).set(1n, atomicmarket.name, {
            auction_id: 1,
            seller: 'seller',
            asset_ids: [ASSET1, ASSET2],
            end_time: 4070908800, // far future
            assets_transferred: false,
            current_bid: WAX(1),
            current_bidder: '',
            claimed_by_seller: false,
            claimed_by_buyer: false,
            maker_marketplace: '',
            taker_marketplace: '',
            collection_name: COL,
            collection_fee: 0.1,
        });
        await deposit('renter', 2);

        await atomicmarket.actions.auctionbid(['renter', 1, WAX(2), '']).send('renter@active');

        expect(marketTables.auctions()).toEqual([]);
        expect(balanceOf('renter')).toEqual([WAX(2)]); // bid was never taken
    });

    test('partially-claimed legacy bundle auction: seller claim pays the author in full, bypassing splits', async () => {
        // a pre-V2 bundle auction whose BUYER already claimed the assets - the seller's
        // claim must still pay out, with the collection cut going to the author in full
        // (bundles never touch the royalty split engine), even when a config exists
        await setupRoyaltySplits();

        atomicmarket.tables.auctions(nameToBigInt(atomicmarket.name)).set(1n, atomicmarket.name, {
            auction_id: 1,
            seller: 'seller',
            asset_ids: [ASSET1, ASSET2],
            end_time: 1, // long over
            assets_transferred: true,
            current_bid: WAX(1),
            current_bidder: 'buyer',
            claimed_by_seller: false,
            claimed_by_buyer: true,
            maker_marketplace: '',
            taker_marketplace: '',
            collection_name: COL,
            collection_fee: 0.1,
        });

        // the escrowed winning bid sits in the contract's token balance
        await token.actions.transfer(['buyer', MARKET, WAX(1), 'deposit']).send('buyer@active');

        // move past end_time (the vert chain clock starts at epoch 0)
        blockchain.addTime(TimePoint.fromMilliseconds(3600 * 1000));

        await atomicmarket.actions.auctclaimsel([1]).send('seller@active');

        // author got the WHOLE 10% cut; none of the royalty recipients got anything
        expect(balanceOf('author')).toEqual([WAX(0.1)]);
        expect(balanceOf('founder1')).toBeNull();
        expect(balanceOf('founder2')).toBeNull();
        expect(balanceOf('temproy1')).toBeNull();
        expect(balanceOf('attrroy1')).toBeNull();

        // no royalty logs were emitted for the bundle payout
        const logNames = blockchain.executionTraces.map((t) => t.action.toString());
        expect(logNames.some((n) => n.startsWith('logroy'))).toBe(false);

        // seller received 88% directly, auction row gone
        const sellerTokens = token.tables.accounts(nameToBigInt(Name.from('seller'))).getTableRows();
        expect(sellerTokens).toEqual([{ balance: WAX(0.88) }]);
        expect(marketTables.auctions()).toEqual([]);
    });

    test('accepting a legacy bundle buyoffer refunds the buyer instead', async () => {
        atomicmarket.tables.buyoffers(nameToBigInt(atomicmarket.name)).set(1n, atomicmarket.name, {
            buyoffer_id: 1,
            buyer: 'buyer',
            recipient: 'seller',
            price: WAX(1),
            asset_ids: [ASSET1, ASSET2],
            memo: '',
            maker_marketplace: '',
            collection_name: COL,
            collection_fee: 0.1,
        });

        await atomicmarket.actions.acceptbuyo([
            1, [ASSET1, ASSET2], WAX(1), '',
        ]).send('seller@active');

        expect(atomicmarket.tables.buyoffers(nameToBigInt(atomicmarket.name)).getTableRows()).toEqual([]);
        expect(balanceOf('buyer')).toEqual([WAX(1)]); // escrow returned
        expect(aaTables.assets('seller').length).toBe(2); // assets never moved
    });

    /* ------------------------------------------------------------------ */
    /* 3. Rentals                                                          */
    /* ------------------------------------------------------------------ */

    const listAndActivateRental = async () => {
        await atomicmarket.actions.announcerent([
            'seller', ASSET1, WAX(0.5), '8,WAX', 86400, '',
        ]).send('seller@active');
        await atomicassets.actions.transfer([
            'seller', MARKET, [ASSET1], 'rental',
        ]).send('seller@active');
    };

    test('full rental lifecycle: announce, custody, rent, extend, expire, endrent, cancel', async () => {
        await listAndActivateRental();

        let rentals = marketTables.rentals();
        expect(rentals.length).toBe(1);
        expect(rentals[0].asset_transferred).toBe(true);
        expect(rentals[0].owner).toBe('seller');
        expect(rentals[0].holder).toBe('');

        // the market contract is now the custodial owner
        expect(aaTables.assets(MARKET).length).toBe(1);

        // rent for 2 hours = 1.0 WAX
        await deposit('renter', 2);
        await atomicmarket.actions.rentasset([
            'renter', ASSET1, 2, WAX(0.5), 0, '',
        ]).send('renter@active');

        rentals = marketTables.rentals();
        expect(rentals[0].holder).toBe('renter');

        // holdership moved to the renter inside atomicassets
        expect(aaTables.holders()).toEqual([
            { asset_id: ASSET1, holder: 'renter', owner: MARKET },
        ]);

        // payout: 1.0 WAX -> 2% fees.atomic, 10% author, 88% straight to the seller
        expect(balanceOf('author')).toEqual([WAX(0.1)]);
        expect(balanceOf('fees.atomic')).toEqual([WAX(0.02)]);
        const sellerTokens = token.tables.accounts(nameToBigInt(Name.from('seller'))).getTableRows();
        expect(sellerTokens).toEqual([{ balance: WAX(0.88) }]);

        // someone else can't rent while active
        await deposit('renter2', 2);
        await expect(
            atomicmarket.actions.rentasset([
                'renter2', ASSET1, 1, WAX(0.5), 0, '',
            ]).send('renter2@active')
        ).rejects.toThrow(/currently rented out/);

        // owner can't cancel while active
        await expect(
            atomicmarket.actions.cancelrent([ASSET1]).send('seller@active')
        ).rejects.toThrow(/currently rented out/);

        // endrent before expiry fails
        await expect(
            atomicmarket.actions.endrent([ASSET1]).send('renter2@active')
        ).rejects.toThrow(/not over yet/);

        // the same renter can extend (1 more hour = 0.5 WAX)
        const endBefore = Number(marketTables.rentals()[0].rental_end);
        await atomicmarket.actions.rentasset([
            'renter', ASSET1, 1, WAX(0.5), 0, '',
        ]).send('renter@active');
        expect(Number(marketTables.rentals()[0].rental_end)).toBe(endBefore + 3600);

        // jump past the rental end; anyone can wrap it up
        blockchain.addTime(TimePoint.fromMilliseconds(4 * 3600 * 1000));
        await atomicmarket.actions.endrent([ASSET1]).send('renter2@active');

        expect(aaTables.holders()).toEqual([]);
        rentals = marketTables.rentals();
        expect(rentals[0].holder).toBe('');
        expect(Number(rentals[0].rental_end)).toBe(0);

        // owner cancels; the asset comes back
        await atomicmarket.actions.cancelrent([ASSET1]).send('seller@active');
        expect(marketTables.rentals()).toEqual([]);
        expect(aaTables.assets('seller').length).toBe(2); // ASSET1 + ASSET2
    });

    test('renting after expiry without endrent moves holdership from the old renter', async () => {
        await listAndActivateRental();

        await deposit('renter', 1);
        await atomicmarket.actions.rentasset([
            'renter', ASSET1, 1, WAX(0.5), 0, '',
        ]).send('renter@active');

        blockchain.addTime(TimePoint.fromMilliseconds(2 * 3600 * 1000));

        // no endrent in between - renter2 rents directly
        await deposit('renter2', 1);
        await atomicmarket.actions.rentasset([
            'renter2', ASSET1, 1, WAX(0.5), 0, '',
        ]).send('renter2@active');

        expect(aaTables.holders()).toEqual([
            { asset_id: ASSET1, holder: 'renter2', owner: MARKET },
        ]);
        expect(marketTables.rentals()[0].holder).toBe('renter2');
    });

    test('cancelrent on an expired-but-not-ended rental reclaims holdership and the asset', async () => {
        await listAndActivateRental();

        await deposit('renter', 1);
        await atomicmarket.actions.rentasset([
            'renter', ASSET1, 1, WAX(0.5), 0, '',
        ]).send('renter@active');

        blockchain.addTime(TimePoint.fromMilliseconds(2 * 3600 * 1000));

        await atomicmarket.actions.cancelrent([ASSET1]).send('seller@active');

        expect(aaTables.holders()).toEqual([]);
        expect(marketTables.rentals()).toEqual([]);
        expect(aaTables.assets('seller').length).toBe(2);
    });

    test('rental payouts respect royalty splits', async () => {
        await setupRoyaltySplits();
        await listAndActivateRental();

        await deposit('renter', 1);
        await atomicmarket.actions.rentasset([
            'renter', ASSET1, 2, WAX(0.5), 0, '',
        ]).send('renter@active');

        // identical math to the sale split test (1.0 WAX total, 0.1 collection cut)
        expect(balanceOf('founder1')).toEqual(['0.00833333 WAX']);
        expect(balanceOf('founder2')).toEqual(['0.02499999 WAX']);
        expect(balanceOf('temproy1')).toEqual(['0.03333333 WAX']);
        expect(balanceOf('attrroy1')).toEqual(['0.03333333 WAX']);
        expect(balanceOf('author')).toEqual(['0.00000002 WAX']);
    });

    test('rental payouts use the discounted fee at execution time', async () => {
        await listAndActivateRental();

        // discount applied after the listing was created and the asset custodied
        await atomicassets.actions.setmarketfee([COL, 0.05]).send('author@active');

        await deposit('renter', 1);
        await atomicmarket.actions.rentasset([
            'renter', ASSET1, 2, WAX(0.5), 0, '',
        ]).send('renter@active');

        // 1.0 WAX rental: author gets the discounted 5%, not the stored 10%
        expect(balanceOf('author')).toEqual([WAX(0.05)]);
        const sellerTokens = token.tables.accounts(nameToBigInt(Name.from('seller'))).getTableRows();
        expect(sellerTokens).toEqual([{ balance: WAX(0.93) }]);
    });

    test('payrentram switches the RAM payer without changing the listing', async () => {
        await listAndActivateRental();

        const before = marketTables.rentals();
        await atomicmarket.actions.payrentram(['buyer', ASSET1]).send('buyer@active');
        expect(marketTables.rentals()).toEqual(before);
    });

    test('rental listing validation', async () => {
        // unsupported symbol
        await expect(
            atomicmarket.actions.announcerent([
                'seller', ASSET1, '1.0000 EOS', '4,EOS', 86400, '',
            ]).send('seller@active')
        ).rejects.toThrow(/not supported/);

        // duration under an hour
        await expect(
            atomicmarket.actions.announcerent([
                'seller', ASSET1, WAX(0.5), '8,WAX', 1800, '',
            ]).send('seller@active')
        ).rejects.toThrow(/at least one hour/);

        // not the asset owner
        await expect(
            atomicmarket.actions.announcerent([
                'buyer', ASSET1, WAX(0.5), '8,WAX', 86400, '',
            ]).send('buyer@active')
        ).rejects.toThrow(/does not own/);

        await listAndActivateRental();

        // owner can't rent their own asset
        await expect(
            atomicmarket.actions.rentasset([
                'seller', ASSET1, 1, WAX(0.5), 0, '',
            ]).send('seller@active')
        ).rejects.toThrow(/own asset/);

        // exceeding the maximum duration (86400s = 24h)
        await deposit('renter', 100);
        await expect(
            atomicmarket.actions.rentasset([
                'renter', ASSET1, 25, WAX(0.5), 0, '',
            ]).send('renter@active')
        ).rejects.toThrow(/maximum rental duration/);

        // price expectation mismatch
        await expect(
            atomicmarket.actions.rentasset([
                'renter', ASSET1, 1, WAX(0.6), 0, '',
            ]).send('renter@active')
        ).rejects.toThrow(/differs from the expected price/);
    });

    /* ------------------------------------------------------------------ */
    /* 4. Default marketplace creator + balance migration (XPR)           */
    /* ------------------------------------------------------------------ */

    const marketplaceCreator = (marketplaceName) => {
        const rows = atomicmarket.tables.marketplaces(nameToBigInt(atomicmarket.name)).getTableRows();
        const row = rows.find((r) => r.marketplace_name === marketplaceName);
        return row ? row.creator : null;
    };

    const setBalance = (account, quantities) => {
        atomicmarket.tables.balances(nameToBigInt(atomicmarket.name)).set(
            nameToBigInt(Name.from(account)), atomicmarket.name,
            { owner: account, quantities }
        );
    };

    test('setdefmktcr redirects the default marketplace creator', async () => {
        // init seeds the empty-name default marketplace with creator fees.atomic
        expect(marketplaceCreator('')).toBe('fees.atomic');

        await atomicmarket.actions.setdefmktcr(['founder1']).send(`${MARKET}@active`);

        expect(marketplaceCreator('')).toBe('founder1');
    });

    test('setdefmktcr rejects a non-existent account', async () => {
        await expect(
            atomicmarket.actions.setdefmktcr(['nonexistent1']).send(`${MARKET}@active`)
        ).rejects.toThrow(/account does not exist/);
    });

    test('migratebal merges per symbol into an existing target and erases the source', async () => {
        setBalance('fees.atomic', [WAX(5), '100.0000 FOO']);
        setBalance('founder1', [WAX(2)]);

        await atomicmarket.actions.migratebal(['fees.atomic', 'founder1']).send(`${MARKET}@active`);

        // WAX summed (2 + 5), FOO appended, source row removed
        expect(balanceOf('founder1')).toEqual([WAX(7), '100.0000 FOO']);
        expect(balanceOf('fees.atomic')).toBeNull();
    });

    test('migratebal creates the target row when it does not exist', async () => {
        setBalance('fees.atomic', [WAX(3)]);

        await atomicmarket.actions.migratebal(['fees.atomic', 'founder2']).send(`${MARKET}@active`);

        expect(balanceOf('founder2')).toEqual([WAX(3)]);
        expect(balanceOf('fees.atomic')).toBeNull();
    });

    test('migratebal rejects when the source has no balance', async () => {
        await expect(
            atomicmarket.actions.migratebal(['fees.atomic', 'founder1']).send(`${MARKET}@active`)
        ).rejects.toThrow(/No balances found/);
    });
});
