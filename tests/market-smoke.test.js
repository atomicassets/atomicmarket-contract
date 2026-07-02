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
 *  3. Non-custodial rentals: announce (no escrow) -> rent (renter becomes the real atomicassets
 *     owner via a leases lock) -> extension -> expiry -> reclaim/endrent -> cancelrent.
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
        leases: () => atomicassets.tables.leases(nameToBigInt(atomicassets.name)).getTableRows(),
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

        // Leasing is opt-in in AtomicAssets (rentalcfg defaults to disabled); authorize
        // this market so the non-custodial rental flow can drive leasestart/leaseextend.
        await atomicassets.actions.setrentmkt([MARKET]).send(`${AA}@active`);

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

        await deposit('renter', 20);

        // 2 hours x 0.50 USD = 1.00 USD = 20 WAX
        await atomicmarket.actions.rentasset([
            'renter', ASSET1, 2, '0.50 USD', 500, '',
        ]).send('renter@active');

        expect(balanceOf('author')).toEqual([WAX(2)]);          // 10% of 20 WAX
        expect(balanceOf('fees.atomic')).toEqual([WAX(0.4)]);   // 2% of 20 WAX
        const sellerTokens = token.tables.accounts(nameToBigInt(Name.from('seller'))).getTableRows();
        expect(sellerTokens).toEqual([{ balance: WAX(17.6) }]); // 88% of 20 WAX
        expect(aaTables.leases()[0].renter).toBe('renter');
        // non-custodial: the renter is the real owner now
        expect(aaTables.assets('renter').map((a) => a.asset_id)).toContain(ASSET1);
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

    // Non-custodial: announcing a rental is all it takes - the asset stays with the lister.
    const listAndActivateRental = async () => {
        await atomicmarket.actions.announcerent([
            'seller', ASSET1, WAX(0.5), '8,WAX', 86400, '',
        ]).send('seller@active');
    };

    test('full rental lifecycle: announce, rent, extend, expire, endrent, cancel', async () => {
        await listAndActivateRental();

        const rentals = marketTables.rentals();
        expect(rentals.length).toBe(1);
        expect(rentals[0].owner).toBe('seller');

        // non-custodial: the asset is still the seller's until it's rented, and nothing is leased
        expect(aaTables.assets('seller').map((a) => a.asset_id)).toContain(ASSET1);
        expect(aaTables.assets(MARKET).length).toBe(0);
        expect(aaTables.leases()).toEqual([]);

        // rent for 2 hours = 1.0 WAX
        await deposit('renter', 2);
        await atomicmarket.actions.rentasset([
            'renter', ASSET1, 2, WAX(0.5), 0, '',
        ]).send('renter@active');

        // the renter is now the REAL atomicassets owner, the asset is locked, and the lease row (the
        // single source of truth for lock state) holds the lister's reclaim right
        expect(aaTables.assets('renter').map((a) => a.asset_id)).toContain(ASSET1);
        expect(aaTables.assets('seller').map((a) => a.asset_id)).not.toContain(ASSET1);
        const leased = aaTables.leases();
        expect(leased).toEqual([{
            asset_id: ASSET1,
            title_owner: 'seller',
            renter: 'renter',
            collection_name: COL,
            rental_start: Number(leased[0].rental_end) - 2 * 3600,
            rental_end: Number(leased[0].rental_end),
            rental_id: 1, // the AM rental counter, echoed on the lease for indexer joins
        }]);

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

        // cancelling during an active lease is the owner's delist right, nobody else's
        // (the delist-during-lease semantics have their own dedicated test below)
        await expect(
            atomicmarket.actions.cancelrent([ASSET1]).send('renter2@active')
        ).rejects.toThrow(/missing required authority/);

        // endrent before expiry fails
        await expect(
            atomicmarket.actions.endrent([ASSET1]).send('renter2@active')
        ).rejects.toThrow(/not over yet/);

        // the same renter can extend (1 more hour = 0.5 WAX); no second ownership flip
        const endBefore = Number(aaTables.leases()[0].rental_end);
        await atomicmarket.actions.rentasset([
            'renter', ASSET1, 1, WAX(0.5), 0, '',
        ]).send('renter@active');
        expect(Number(aaTables.leases()[0].rental_end)).toBe(endBefore + 3600);
        expect(aaTables.assets('renter').map((a) => a.asset_id)).toContain(ASSET1);

        // jump past the rental end; anyone can wrap it up (endrent triggers the reclaim)
        blockchain.addTime(TimePoint.fromMilliseconds(4 * 3600 * 1000));
        await atomicmarket.actions.endrent([ASSET1]).send('renter2@active');

        // asset returned to the lister; lock cleared; the listing stays (rentable again)
        expect(aaTables.leases()).toEqual([]);
        expect(aaTables.assets('seller').map((a) => a.asset_id)).toContain(ASSET1);
        expect(marketTables.rentals().length).toBe(1);

        // owner cancels the (now idle) listing
        await atomicmarket.actions.cancelrent([ASSET1]).send('seller@active');
        expect(marketTables.rentals()).toEqual([]);
        expect(aaTables.assets('seller').length).toBe(2); // ASSET1 + ASSET2
    });

    test('renting after expiry without endrent re-leases from the old renter to the new one', async () => {
        await listAndActivateRental();

        await deposit('renter', 1);
        await atomicmarket.actions.rentasset([
            'renter', ASSET1, 1, WAX(0.5), 0, '',
        ]).send('renter@active');

        blockchain.addTime(TimePoint.fromMilliseconds(2 * 3600 * 1000));

        // no endrent in between - renter2 rents directly. rentasset reclaims the expired lease
        // (asset back to the lister) and then re-leases to renter2 in the same transaction.
        await deposit('renter2', 1);
        await atomicmarket.actions.rentasset([
            'renter2', ASSET1, 1, WAX(0.5), 0, '',
        ]).send('renter2@active');

        expect(aaTables.assets('renter2').map((a) => a.asset_id)).toContain(ASSET1);
        expect(aaTables.assets('renter').map((a) => a.asset_id)).not.toContain(ASSET1);
        const leased = aaTables.leases();
        expect(leased).toEqual([{
            asset_id: ASSET1,
            title_owner: 'seller',
            renter: 'renter2',
            collection_name: COL,
            rental_start: Number(leased[0].rental_end) - 1 * 3600,
            rental_end: Number(leased[0].rental_end),
            rental_id: 2, // the re-lease is a NEW rental: fresh counter id on the fresh lease
        }]);
    });

    test('editrent reprices the listing mid-lease: extensions and re-rents pay the NEW terms', async () => {
        await listAndActivateRental(); // 0.5 WAX/h, 24h max

        await deposit('renter', 10);
        await atomicmarket.actions.rentasset([
            'renter', ASSET1, 2, WAX(0.5), 0, '',
        ]).send('renter@active');

        // mid-lease the owner reprices to 2 WAX/h and shortens the max to 12h: the listing row
        // is the owner's OFFER of future rentals, separate from the renter's purchased lease
        await atomicmarket.actions.editrent([
            ASSET1, WAX(2), 12 * 3600, '',
        ]).send('seller@active');
        expect(marketTables.rentals()[0].price_per_hour).toBe(WAX(2));
        expect(Number(marketTables.rentals()[0].maximum_rental_duration)).toBe(12 * 3600);

        // the running lease is untouched
        expect(aaTables.leases()[0].renter).toBe('renter');

        // an extension is a fresh purchase of the current offer: the old price is now rejected...
        await expect(
            atomicmarket.actions.rentasset([
                'renter', ASSET1, 1, WAX(0.5), 0, '',
            ]).send('renter@active')
        ).rejects.toThrow(/differs from the expected price/);
        // ...and the new price charges 2 WAX for 1h
        const endBefore = Number(aaTables.leases()[0].rental_end);
        await atomicmarket.actions.rentasset([
            'renter', ASSET1, 1, WAX(2), 0, '',
        ]).send('renter@active');
        expect(Number(aaTables.leases()[0].rental_end)).toBe(endBefore + 3600);

        // stale-price snipe regression: at expiry, a re-rent must pay the CURRENT terms, not
        // the price the listing had when the previous lease started
        blockchain.addTime(TimePoint.fromMilliseconds(4 * 3600 * 1000));
        await deposit('renter2', 10);
        await expect(
            atomicmarket.actions.rentasset([
                'renter2', ASSET1, 1, WAX(0.5), 0, '',
            ]).send('renter2@active')
        ).rejects.toThrow(/differs from the expected price/);
        await atomicmarket.actions.rentasset([
            'renter2', ASSET1, 1, WAX(2), 0, '',
        ]).send('renter2@active');
        expect(aaTables.leases()[0].renter).toBe('renter2');
    });

    test('editrent validation: owner-only, same listing symbol, duration bounds', async () => {
        await listAndActivateRental();

        await expect(
            atomicmarket.actions.editrent([
                ASSET1, WAX(2), 86400, '',
            ]).send('buyer@active')
        ).rejects.toThrow(/missing required authority/);

        await expect(
            atomicmarket.actions.editrent([
                ASSET1, '2.00 USD', 86400, '',
            ]).send('seller@active')
        ).rejects.toThrow(/listing symbol cannot be changed/);

        await expect(
            atomicmarket.actions.editrent([
                ASSET1, WAX(2), 1800, '',
            ]).send('seller@active')
        ).rejects.toThrow(/at least one hour/);
    });

    test('delisting during an active lease withdraws the offer without touching the lease', async () => {
        await listAndActivateRental();

        await deposit('renter', 1);
        await atomicmarket.actions.rentasset([
            'renter', ASSET1, 2, WAX(0.5), 0, '',
        ]).send('renter@active');

        // only the owner may delist while the lease runs (the listing is not "invalid":
        // the owner not owning the asset is the normal rented state)
        await expect(
            atomicmarket.actions.cancelrent([ASSET1]).send('renter2@active')
        ).rejects.toThrow(/missing required authority/);
        await atomicmarket.actions.cancelrent([ASSET1]).send('seller@active');

        // listing gone, lease (and the renter's ownership) untouched
        expect(marketTables.rentals()).toEqual([]);
        expect(aaTables.leases()[0].renter).toBe('renter');
        expect(aaTables.assets('renter').map((a) => a.asset_id)).toContain(ASSET1);

        // the lease still expires normally, and the lease-driven endrent needs no listing row
        blockchain.addTime(TimePoint.fromMilliseconds(3 * 3600 * 1000));
        await atomicmarket.actions.endrent([ASSET1]).send('renter2@active');
        expect(aaTables.leases()).toEqual([]);
        expect(aaTables.assets('seller').map((a) => a.asset_id)).toContain(ASSET1);
    });

    test('cancelrent on an expired-but-not-ended rental reclaims the asset to the lister', async () => {
        await listAndActivateRental();

        await deposit('renter', 1);
        await atomicmarket.actions.rentasset([
            'renter', ASSET1, 1, WAX(0.5), 0, '',
        ]).send('renter@active');

        blockchain.addTime(TimePoint.fromMilliseconds(2 * 3600 * 1000));

        await atomicmarket.actions.cancelrent([ASSET1]).send('seller@active');

        expect(aaTables.leases()).toEqual([]);
        expect(marketTables.rentals()).toEqual([]);
        expect(aaTables.assets('seller').length).toBe(2);
    });

    test('extensions are capped at the maximum duration measured from the lease start', async () => {
        // listAndActivateRental lists with maximum_rental_duration = 86400s (24h)
        await listAndActivateRental();
        await deposit('renter', 20);

        // rent 20h (start = T0, end = T0 + 20h)
        await atomicmarket.actions.rentasset([
            'renter', ASSET1, 20, WAX(0.5), 0, '',
        ]).send('renter@active');
        const end = Number(aaTables.leases()[0].rental_end);

        // advance 10h, still active. Extending by 5h would push the total to 25h
        // from the lease start (> 24h) even though only 15h would remain from
        // "now" - the from-start cap rejects it (a rolling-window cap would not).
        blockchain.addTime(TimePoint.fromMilliseconds(10 * 3600 * 1000));
        await expect(
            atomicmarket.actions.rentasset([
                'renter', ASSET1, 5, WAX(0.5), 0, '',
            ]).send('renter@active')
        ).rejects.toThrow(/maximum rental duration/);

        // extending by 4h reaches exactly 24h from start, which is allowed
        await atomicmarket.actions.rentasset([
            'renter', ASSET1, 4, WAX(0.5), 0, '',
        ]).send('renter@active');
        expect(Number(aaTables.leases()[0].rental_end)).toBe(end + 4 * 3600);
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

    test('rental extension pays template/attribute royalties from the renter scope', async () => {
        // Pins the asset_scope invariant for the EXTENSION branch (asset_scope = renter):
        // by extension time the renter is the AA owner, so the royalty engine must read the
        // asset's template_id/attributes from the renter's scope. If asset_scope were wrong
        // (or the lease flip were reordered before payout), distribute_collection_fee would
        // silently drop temproy1/attrroy1 and this test's doubled balances would fail.
        await setupRoyaltySplits();
        await listAndActivateRental();

        await deposit('renter', 2);
        // fresh rental (asset_scope = owner): 1.0 WAX
        await atomicmarket.actions.rentasset([
            'renter', ASSET1, 2, WAX(0.5), 0, '',
        ]).send('renter@active');
        // same-renter extension while still active (asset_scope = renter): another 1.0 WAX
        await atomicmarket.actions.rentasset([
            'renter', ASSET1, 2, WAX(0.5), 0, '',
        ]).send('renter@active');

        // template + attribute royalty recipients must be paid for BOTH payouts (2 x 0.03333333),
        // proving the extension read the asset from the renter scope, not an empty one.
        expect(balanceOf('temproy1')).toEqual(['0.06666666 WAX']);
        expect(balanceOf('attrroy1')).toEqual(['0.06666666 WAX']);
    });

    test('rental payouts use the discounted fee at execution time', async () => {
        await listAndActivateRental();

        // discount applied after the listing was created
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

    test('a rented (locked) asset cannot be listed for sale, auction, buyoffer or re-rent', async () => {
        await listAndActivateRental();
        await deposit('renter', 2);
        await atomicmarket.actions.rentasset([
            'renter', ASSET1, 2, WAX(0.5), 0, '',
        ]).send('renter@active');

        // the renter is the current owner, but the asset is rental-locked
        await expect(
            atomicmarket.actions.announcesale([
                'renter', [ASSET1], WAX(1), '8,WAX', '',
            ]).send('renter@active')
        ).rejects.toThrow(/rented out|locked/);

        await expect(
            atomicmarket.actions.announceauct([
                'renter', [ASSET1], WAX(1), 600, '',
            ]).send('renter@active')
        ).rejects.toThrow(/rented out|locked/);

        await deposit('buyer', 1);
        await expect(
            atomicmarket.actions.createbuyo([
                'buyer', 'renter', WAX(1), [ASSET1], '', '',
            ]).send('buyer@active')
        ).rejects.toThrow(/rented out|locked/);

        await expect(
            atomicmarket.actions.announcerent([
                'renter', ASSET1, WAX(0.5), '8,WAX', 86400, '',
            ]).send('renter@active')
        ).rejects.toThrow(/rented out|locked/);

        // after expiry the permissionless reclaim lifts the lock and the lister can list it again
        blockchain.addTime(TimePoint.fromMilliseconds(3 * 3600 * 1000));
        await atomicmarket.actions.endrent([ASSET1]).send('renter@active');
        await expect(
            atomicmarket.actions.announcesale([
                'seller', [ASSET1], WAX(1), '8,WAX', '',
            ]).send('seller@active')
        ).resolves.not.toThrow();
    });

    test('a stray "rental" memo transfer to the market is now rejected', async () => {
        await listAndActivateRental();
        // non-custodial rentals never escrow the asset, so the old "rental" intake is gone
        await expect(
            atomicassets.actions.transfer([
                'seller', MARKET, [ASSET1], 'rental',
            ]).send('seller@active')
        ).rejects.toThrow(/Invalid memo/);
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

    test('migratebal rejects when from and to are the same account', async () => {
        setBalance('fees.atomic', [WAX(5)]);
        await expect(
            atomicmarket.actions.migratebal(['fees.atomic', 'fees.atomic']).send(`${MARKET}@active`)
        ).rejects.toThrow(/must be different accounts/);
        // the balance must be untouched
        expect(balanceOf('fees.atomic')).toEqual([WAX(5)]);
    });

    /* 4. assert* asset-id length mismatch (is_permutation guard)         */
    /* ------------------------------------------------------------------ */

    test('assertsale with more asset ids than the sale rejects cleanly (no out-of-bounds read)', async () => {
        await listAndActivateSale([ASSET1], 1);
        await expect(
            atomicmarket.actions.assertsale([
                1, [ASSET1, ASSET2], WAX(1), '8,WAX',
            ]).send('buyer@active')
        ).rejects.toThrow(/differ from the asset ids of this sale/);
    });

    test('assertsale with the matching single asset id passes', async () => {
        await listAndActivateSale([ASSET1], 1);
        await atomicmarket.actions.assertsale([
            1, [ASSET1], WAX(1), '8,WAX',
        ]).send('buyer@active');
    });

    test('assertauct with more asset ids than the auction rejects cleanly', async () => {
        await atomicmarket.actions.announceauct([
            'seller', [ASSET1], WAX(1), 600, '',
        ]).send('seller@active');
        await expect(
            atomicmarket.actions.assertauct([
                1, [ASSET1, ASSET2],
            ]).send('buyer@active')
        ).rejects.toThrow(/differ from the asset ids of this auction/);
    });

    test('acceptbuyo with more expected asset ids than the buyoffer rejects cleanly', async () => {
        await deposit('buyer', 1);
        await atomicmarket.actions.createbuyo([
            'buyer', 'seller', WAX(1), [ASSET1], '', '',
        ]).send('buyer@active');

        await expect(
            atomicmarket.actions.acceptbuyo([
                1, [ASSET1, ASSET2], WAX(1), '',
            ]).send('seller@active')
        ).rejects.toThrow(/differ from the expected asset ids/);
    });

    /* 4. Low hardening: empty AtomicAssets offers table guard            */
    /* ------------------------------------------------------------------ */

    test('acceptbuyo with no AtomicAssets offer present rejects instead of decrementing end() on an empty table', async () => {
        await deposit('buyer', 1);
        await atomicmarket.actions.createbuyo([
            'buyer', 'seller', WAX(1), [ASSET1], '', '',
        ]).send('buyer@active');

        // The recipient accepts without having created the matching AtomicAssets offer,
        // so the offers table is empty - the guard must reject cleanly.
        await expect(
            atomicmarket.actions.acceptbuyo([
                1, [ASSET1], WAX(1), '',
            ]).send('seller@active')
        ).rejects.toThrow(/no AtomicAssets offer present to accept/);
    });

    test('fulfilltbuyo with no AtomicAssets offer present rejects instead of decrementing end() on an empty table', async () => {
        await deposit('buyer', 1);
        // template buyoffer for template 1 (ASSET1 is a template-1 asset owned by seller)
        await atomicmarket.actions.createtbuyo([
            'buyer', WAX(1), COL, 1, '',
        ]).send('buyer@active');

        // The seller fulfills without having created the matching AtomicAssets offer.
        await expect(
            atomicmarket.actions.fulfilltbuyo([
                'seller', 1, ASSET1, WAX(1), '',
            ]).send('seller@active')
        ).rejects.toThrow(/no AtomicAssets offer present to fulfill/);
    });

    /* 4. Fee-ceiling guards                                              */
    /* ------------------------------------------------------------------ */

    test('setmarketfee rejects maker + taker that, with the max collection fee, exceeds the price', async () => {
        // 0.5 + 0.5 + 0.15 (MAX_MARKET_FEE) = 1.15 > 1.0
        await expect(
            atomicmarket.actions.setmarketfee([0.5, 0.5]).send(`${MARKET}@active`)
        ).rejects.toThrow(/may not exceed the sale price/);
    });

    test('setmarketfee accepts maker + taker that leaves room for the collection fee', async () => {
        // 0.4 + 0.4 + 0.15 = 0.95 <= 1.0
        await atomicmarket.actions.setmarketfee([0.4, 0.4]).send(`${MARKET}@active`);
        const config = atomicmarket.tables.config(nameToBigInt(atomicmarket.name)).getTableRows()[0];
        expect(Number(config.maker_market_fee)).toBeCloseTo(0.4);
        expect(Number(config.taker_market_fee)).toBeCloseTo(0.4);
    });

    test('addbonusfee rejects a single fee that overflows the maker + taker + max collection fee', async () => {
        // default maker/taker 0.01 each + 0.15 + 0.9 = 1.07 > 1.0
        await expect(
            atomicmarket.actions.addbonusfee([
                'founder1', 0.9, ['sale'], 'too big',
            ]).send(`${MARKET}@active`)
        ).rejects.toThrow(/may not exceed the sale price/);
    });

    test('stacked bonus fees that exceed the price are caught at settlement instead of bricking with a balance error', async () => {
        // Each bonus fee passes the per-fee config bound (0.01+0.01+0.15+0.45 = 0.62 <= 1.0),
        // but together with the 1%+1% market fees and the 10% collection fee they sum to
        // 1.02 of the price. The seller-payout backstop must reject this clearly.
        await atomicmarket.actions.addbonusfee([
            'founder1', 0.45, ['sale'], 'bonus a',
        ]).send(`${MARKET}@active`);
        await atomicmarket.actions.addbonusfee([
            'founder2', 0.45, ['sale'], 'bonus b',
        ]).send(`${MARKET}@active`);

        await listAndActivateSale([ASSET1], 1);
        await deposit('buyer', 1);

        await expect(
            atomicmarket.actions.purchasesale([
                'buyer', 1, 0, '',
            ]).send('buyer@active')
        ).rejects.toThrow(/Total fees leave no payout for the seller/);
    });
});
