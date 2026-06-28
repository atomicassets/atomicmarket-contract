const { Blockchain, nameToBigInt, mintTokens } = require('@vaulta/vert');
const { Name } = require('@wharfkit/antelope');
const fs = require('fs');

/*
 * VeRT coverage for the AtomicMarket sale-flow actions (v2 single-asset semantics):
 *   announcesale, cancelsale, purchasesale, receive_asset_offer (atomicassets::lognewoffer).
 *
 * Translated from the legacy Hydra "Sale Actions" suite, keeping only the v2-valid behaviour:
 *  - bundle / multi-asset happy paths are obsolete (announcesale rejects asset_ids.size() != 1),
 *    so they are dropped (the single rejection path is already covered by market-smoke).
 *  - the collection in setup carries a live 10% market fee (Hydra used 5%); payouts are asserted
 *    against the live 10% fee, which settlement reads fresh at execution time.
 *  - cases already covered by market-smoke (basic delphi purchase, the delphi-median-not-found
 *    reject, the plain no-config 1 WAX purchase, bundle rejection) are not duplicated here.
 *
 * Self-contained: the beforeAll / beforeEach and helpers are copied from market-smoke.test.js.
 */

const WAX = (amount) => `${amount.toFixed(8)} WAX`;
const ASSET1 = '1099511627776'; // first minted asset id (2^40), template 1, owned by seller
const ASSET2 = '1099511627777'; // templateless, owned by seller
const MARKET = 'atomicmarket';
const AA = 'atomicassets';
const FAKE_AA = 'atomicfake';
const COL = 'testcollect1';

describe('atomicmarket sale actions', () => {
    let blockchain;
    let atomicmarket, atomicassets, atomicfake, token, delphi;
    let author, seller, buyer;
    let feesAtomic, marketowner1, marketowner2;

    const aaTables = {
        assets: (scope) => atomicassets.tables.assets(nameToBigInt(Name.from(scope))).getTableRows(),
        offers: () => atomicassets.tables.offers(nameToBigInt(atomicassets.name)).getTableRows(),
    };
    const marketTables = {
        balances: () => atomicmarket.tables.balances(nameToBigInt(atomicmarket.name)).getTableRows(),
        sales: () => atomicmarket.tables.sales(nameToBigInt(atomicmarket.name)).getTableRows(),
    };

    const balanceOf = (account) => {
        const row = marketTables.balances().find((r) => r.owner === account);
        return row ? row.quantities : null;
    };
    const saleById = (saleId) =>
        marketTables.sales().find((r) => Number(r.sale_id) === Number(saleId));
    const tokenBalanceOf = (account) =>
        token.tables.accounts(nameToBigInt(Name.from(account))).getTableRows();

    beforeAll(async () => {
        blockchain = new Blockchain();
        atomicassets = blockchain.createContract(AA, './tests/fixtures/atomicassets/atomicassets');
        atomicfake = blockchain.createContract(FAKE_AA, './tests/fixtures/atomicassets/atomicassets');
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
        feesAtomic = blockchain.createAccount('fees.atomic');
        marketowner1 = blockchain.createAccount('marketowner1');
        marketowner2 = blockchain.createAccount('marketowner2');
    });

    beforeEach(async () => {
        blockchain.resetTables();

        await atomicassets.actions.init([]).send(`${AA}@active`);
        await atomicmarket.actions.init([]).send(`${MARKET}@active`);

        await atomicmarket.actions.addconftoken(['eosio.token', '8,WAX']).send(`${MARKET}@active`);

        // Only the buyer is funded; the seller starts empty so payout assertions are exact.
        await mintTokens(token, 'WAX', 8, 1000000000, 10000, [buyer]);

        // Collection with a 10% market fee, author authorized
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

        // Template 1: transferable
        await atomicassets.actions.createtempl([
            'author', COL, 'testschema', true, true, 0,
            [{ first: 'name', second: ['string', 'TestItem'] }],
        ]).send('author@active');

        // ASSET1: template-1 asset owned by seller
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

    const setBalance = (account, quantities) => {
        atomicmarket.tables.balances(nameToBigInt(atomicmarket.name)).set(
            nameToBigInt(Name.from(account)), atomicmarket.name,
            { owner: account, quantities }
        );
    };

    const announceSale = async (assetIds, price, makerMarketplace = '') => {
        await atomicmarket.actions.announcesale([
            'seller', assetIds, WAX(price), '8,WAX', makerMarketplace,
        ]).send('seller@active');
    };

    const listAndActivateSale = async (assetIds, price) => {
        await announceSale(assetIds, price);
        await atomicassets.actions.createoffer([
            'seller', MARKET, assetIds, [], 'sale',
        ]).send('seller@active');
    };

    // waxpusd: base 8,WAX / quote 2,USD, quoted_precision 4. median 500 = 0.0500 USD/WAX.
    const setupDelphiPair = async () => {
        await delphi.actions.setpair(['waxpusd', '8,WAX', '2,USD', 4]).send('delphioracle@active');
        await delphi.actions.setdata(['waxpusd', 1, 500]).send('delphioracle@active');
        await atomicmarket.actions.adddelphi(['waxpusd', false, '2,USD', '8,WAX']).send(`${MARKET}@active`);
    };

    /* ------------------------------------------------------------------ */
    /* announcesale                                                        */
    /* ------------------------------------------------------------------ */

    test('announcesale: single-asset sale snapshots the row (offer_id -1, live 10% fee)', async () => {
        await announceSale([ASSET1], 10);

        expect(marketTables.sales()).toEqual([
            {
                sale_id: 1,
                seller: 'seller',
                asset_ids: [ASSET1],
                offer_id: -1,
                listing_price: WAX(10),
                settlement_symbol: '8,WAX',
                maker_marketplace: '',
                collection_name: COL,
                collection_fee: '0.1',
            },
        ]);
    });

    test('announcesale: a second sale gets the next sale id', async () => {
        await announceSale([ASSET1], 10);
        await announceSale([ASSET2], 20);

        const sales = marketTables.sales();
        expect(sales.map((s) => Number(s.sale_id)).sort()).toEqual([1, 2]);
        expect(Number(saleById(2).sale_id)).toBe(2);
        expect(saleById(2).asset_ids).toEqual([ASSET2]);
    });

    test('announcesale: stores the maker marketplace', async () => {
        await atomicmarket.actions.regmarket(['marketowner1', 'mymarketaaaa']).send('marketowner1@active');

        await announceSale([ASSET1], 10, 'mymarketaaaa');

        expect(saleById(1).maker_marketplace).toBe('mymarketaaaa');
    });

    test('announcesale: lists in a different supported token', async () => {
        await atomicmarket.actions.addconftoken(['eosio.token', '4,KARMA']).send(`${MARKET}@active`);

        await atomicmarket.actions.announcesale([
            'seller', [ASSET1], '10.0000 KARMA', '4,KARMA', '',
        ]).send('seller@active');

        expect(saleById(1).listing_price).toBe('10.0000 KARMA');
        expect(saleById(1).settlement_symbol).toBe('4,KARMA');
    });

    test('announcesale: lists with a delphi pair (price in USD, settled in WAX)', async () => {
        await setupDelphiPair();

        await atomicmarket.actions.announcesale([
            'seller', [ASSET1], '10.00 USD', '8,WAX', '',
        ]).send('seller@active');

        expect(saleById(1).listing_price).toBe('10.00 USD');
        expect(saleById(1).settlement_symbol).toBe('8,WAX');
    });

    test('announcesale: an equal sale by another account coexists', async () => {
        await announceSale([ASSET1], 10);

        // hand ASSET1 to the buyer so they too can list it
        await atomicassets.actions.transfer(['seller', 'buyer', [ASSET1], '']).send('seller@active');
        await atomicmarket.actions.announcesale([
            'buyer', [ASSET1], WAX(20), '8,WAX', '',
        ]).send('buyer@active');

        const sales = marketTables.sales();
        expect(sales.length).toBe(2);
        expect(saleById(1).seller).toBe('seller');
        expect(saleById(2).seller).toBe('buyer');
        expect(saleById(1).asset_ids).toEqual([ASSET1]);
        expect(saleById(2).asset_ids).toEqual([ASSET1]);
    });

    test('announcesale: the same seller cannot announce the same asset twice', async () => {
        await announceSale([ASSET1], 10);

        await expect(announceSale([ASSET1], 10)).rejects.toThrow(
            /already announced a sale for these assets/
        );
    });

    test('announcesale: throws on an empty asset_ids (single-asset only)', async () => {
        await expect(announceSale([], 10)).rejects.toThrow(/exactly one asset id/);
    });

    test('announcesale: throws when the seller does not own the asset', async () => {
        await atomicassets.actions.mintasset([
            'author', COL, 'testschema', -1, 'buyer', [], [], [],
        ]).send('author@active');
        const buyerAsset = aaTables.assets('buyer')[0].asset_id;

        await expect(announceSale([buyerAsset], 10)).rejects.toThrow(
            /does not own at least one of the assets/
        );
    });

    test('announcesale: throws when the asset is not transferable', async () => {
        // template 2 is non-transferable
        await atomicassets.actions.createtempl([
            'author', COL, 'testschema', false, true, 0, [],
        ]).send('author@active');
        await atomicassets.actions.mintasset([
            'author', COL, 'testschema', 2, 'seller', [], [], [],
        ]).send('author@active');
        const boundAsset = aaTables.assets('seller')
            .find((a) => Number(a.template_id) === 2).asset_id;

        await expect(announceSale([boundAsset], 10)).rejects.toThrow(
            /not transferable/
        );
    });

    test('announcesale: throws when the direct-sale token is not supported', async () => {
        await expect(
            atomicmarket.actions.announcesale([
                'seller', [ASSET1], '10.0000 FAKE', '4,FAKE', '',
            ]).send('seller@active')
        ).rejects.toThrow(/listing symbol is not supported/);
    });

    test('announcesale: throws when the delphi symbol combination is not supported', async () => {
        await expect(
            atomicmarket.actions.announcesale([
                'seller', [ASSET1], '5.00 EUR', '8,WAX', '',
            ]).send('seller@active')
        ).rejects.toThrow(/listing - settlement symbol combination is not supported/);
    });

    test('announcesale: throws when the listing price is zero', async () => {
        await expect(announceSale([ASSET1], 0)).rejects.toThrow(
            /sale price must be greater than zero/
        );
    });

    test('announcesale: throws when the listing price is negative', async () => {
        await expect(
            atomicmarket.actions.announcesale([
                'seller', [ASSET1], '-10.00000000 WAX', '8,WAX', '',
            ]).send('seller@active')
        ).rejects.toThrow(/sale price must be greater than zero/);
    });

    test('announcesale: throws when the maker marketplace does not exist', async () => {
        await expect(announceSale([ASSET1], 10, 'fakemarket')).rejects.toThrow(
            /maker marketplace is not a valid marketplace/
        );
    });

    test('announcesale: throws without authorization from the seller', async () => {
        await expect(
            atomicmarket.actions.announcesale([
                'seller', [ASSET1], WAX(10), '8,WAX', '',
            ]).send('buyer@active')
        ).rejects.toThrow(/missing required authority/);
    });

    /* ------------------------------------------------------------------ */
    /* cancelsale                                                          */
    /* ------------------------------------------------------------------ */

    test('cancelsale: cancelling an active sale cleans the sale and the AtomicAssets offer', async () => {
        await listAndActivateSale([ASSET1], 10);
        expect(aaTables.offers().length).toBe(1);

        await atomicmarket.actions.cancelsale([1]).send('seller@active');

        expect(marketTables.sales()).toEqual([]);
        expect(aaTables.offers()).toEqual([]);
    });

    test('cancelsale: cancelling an announced-only sale (no offer) works', async () => {
        await announceSale([ASSET1], 10);

        await atomicmarket.actions.cancelsale([1]).send('seller@active');

        expect(marketTables.sales()).toEqual([]);
    });

    test('cancelsale: anyone can cancel a sale whose offer was cancelled', async () => {
        await listAndActivateSale([ASSET1], 10);

        // the seller cancels the underlying AtomicAssets offer, making the sale invalid
        const offerId = aaTables.offers()[0].offer_id;
        await atomicassets.actions.canceloffer([offerId]).send('seller@active');

        // a non-seller may now cancel it
        await atomicmarket.actions.cancelsale([1]).send('buyer@active');

        expect(marketTables.sales()).toEqual([]);
    });

    test('cancelsale: throws when no sale with the id exists', async () => {
        await expect(
            atomicmarket.actions.cancelsale([999]).send('seller@active')
        ).rejects.toThrow(/No sale with this sale_id exists/);
    });

    test('cancelsale: throws when cancelling a valid active sale without the seller auth', async () => {
        await listAndActivateSale([ASSET1], 10);

        await expect(
            atomicmarket.actions.cancelsale([1]).send('buyer@active')
        ).rejects.toThrow(/the authorization of the seller is needed to cancel it/);
    });

    /* ------------------------------------------------------------------ */
    /* purchasesale                                                        */
    /* ------------------------------------------------------------------ */

    test('purchasesale: a buyer with surplus balance keeps the remainder', async () => {
        await listAndActivateSale([ASSET1], 1);
        await deposit('buyer', 2);

        await atomicmarket.actions.purchasesale(['buyer', 1, 0, '']).send('buyer@active');

        // 1 WAX spent: 0.1 author, 0.02 fees.atomic, 0.88 to seller, 1.0 left for buyer
        expect(balanceOf('buyer')).toEqual([WAX(1)]);
        expect(balanceOf('author')).toEqual([WAX(0.1)]);
        expect(balanceOf('fees.atomic')).toEqual([WAX(0.02)]);
        expect(tokenBalanceOf('seller')).toEqual([{ balance: WAX(0.88) }]);
        expect(aaTables.assets('buyer').length).toBe(1);
        expect(marketTables.sales()).toEqual([]);
    });

    test('purchasesale: a one-satoshi price rounds every fee to zero, seller gets it all', async () => {
        await listAndActivateSale([ASSET1], 0.00000001);
        await deposit('buyer', 0.00000001);

        await atomicmarket.actions.purchasesale(['buyer', 1, 0, '']).send('buyer@active');

        expect(balanceOf('buyer')).toBeNull();
        expect(balanceOf('author')).toBeNull();
        expect(balanceOf('fees.atomic')).toBeNull();
        expect(tokenBalanceOf('seller')).toEqual([{ balance: WAX(0.00000001) }]);
        expect(aaTables.assets('buyer').length).toBe(1);
    });

    test('purchasesale: a very small price keeps only the collection cut, rest to seller', async () => {
        await listAndActivateSale([ASSET1], 0.0000005); // 50 sat
        await deposit('buyer', 0.0000005);

        await atomicmarket.actions.purchasesale(['buyer', 1, 0, '']).send('buyer@active');

        // 50 sat: collection 10% = 5 sat -> author; maker/taker 1% = 0 sat; seller = 45 sat
        expect(balanceOf('author')).toEqual([WAX(0.00000005)]);
        expect(balanceOf('fees.atomic')).toBeNull();
        expect(balanceOf('buyer')).toBeNull();
        expect(tokenBalanceOf('seller')).toEqual([{ balance: WAX(0.00000045) }]);
    });

    test('purchasesale: inverted delphi pair settles in WAX at the oracle rate', async () => {
        // usdwax: base 2,USD / quote 8,WAX, quoted_precision 4. median 200000.
        // inverted: settlement = listing.amount * median * 10^(-4 + 8 - 2)
        //   5.00 RUSD (500) * 200000 * 100 = 1e10 = 100.00000000 WAX
        await delphi.actions.setpair(['usdwax', '2,USD', '8,WAX', 4]).send('delphioracle@active');
        await delphi.actions.setdata(['usdwax', 1, 200000]).send('delphioracle@active');
        await atomicmarket.actions.adddelphi(['usdwax', true, '2,RUSD', '8,WAX']).send(`${MARKET}@active`);

        await atomicmarket.actions.announcesale([
            'seller', [ASSET1], '5.00 RUSD', '8,WAX', '',
        ]).send('seller@active');
        await atomicassets.actions.createoffer([
            'seller', MARKET, [ASSET1], [], 'sale',
        ]).send('seller@active');

        await deposit('buyer', 100);
        await atomicmarket.actions.purchasesale(['buyer', 1, 200000, '']).send('buyer@active');

        expect(balanceOf('author')).toEqual([WAX(10)]);      // 10% of 100 WAX
        expect(balanceOf('fees.atomic')).toEqual([WAX(2)]);  // 2% of 100 WAX
        expect(tokenBalanceOf('seller')).toEqual([{ balance: WAX(88) }]);
        expect(aaTables.assets('buyer').length).toBe(1);
    });

    test('purchasesale: custom maker/taker marketplaces split the market fee to their creators', async () => {
        await atomicmarket.actions.regmarket(['marketowner1', 'mymarketaaaa']).send('marketowner1@active');
        await atomicmarket.actions.regmarket(['marketowner2', 'mymarketbbbb']).send('marketowner2@active');

        await listAndActivateSale([ASSET1], 1);
        await deposit('buyer', 1);

        // re-list under the maker marketplace
        await atomicmarket.actions.cancelsale([1]).send('seller@active');
        await announceSale([ASSET1], 1, 'mymarketaaaa');
        await atomicassets.actions.createoffer(['seller', MARKET, [ASSET1], [], 'sale']).send('seller@active');

        await atomicmarket.actions.purchasesale(['buyer', 2, 0, 'mymarketbbbb']).send('buyer@active');

        expect(balanceOf('marketowner1')).toEqual([WAX(0.01)]); // maker 1%
        expect(balanceOf('marketowner2')).toEqual([WAX(0.01)]); // taker 1%
        expect(balanceOf('author')).toEqual([WAX(0.1)]);        // collection 10%
        expect(balanceOf('fees.atomic')).toBeNull();            // default market unused
        expect(tokenBalanceOf('seller')).toEqual([{ balance: WAX(0.88) }]);
    });

    test('purchasesale: throws when no sale with the id exists', async () => {
        await deposit('buyer', 1);
        await expect(
            atomicmarket.actions.purchasesale(['buyer', 1, 0, '']).send('buyer@active')
        ).rejects.toThrow(/No sale with this sale_id exists/);
    });

    test('purchasesale: throws when buying your own sale', async () => {
        await listAndActivateSale([ASSET1], 1);

        await expect(
            atomicmarket.actions.purchasesale(['seller', 1, 0, '']).send('seller@active')
        ).rejects.toThrow(/can't purchase your own sale/);
    });

    test('purchasesale: throws when the sale is not active yet (no offer)', async () => {
        await announceSale([ASSET1], 1);
        await deposit('buyer', 1);

        await expect(
            atomicmarket.actions.purchasesale(['buyer', 1, 0, '']).send('buyer@active')
        ).rejects.toThrow(/This sale is not active yet/);
    });

    test('purchasesale: throws when the seller cancelled the AtomicAssets offer', async () => {
        await listAndActivateSale([ASSET1], 1);
        const offerId = aaTables.offers()[0].offer_id;
        await atomicassets.actions.canceloffer([offerId]).send('seller@active');
        await deposit('buyer', 1);

        await expect(
            atomicmarket.actions.purchasesale(['buyer', 1, 0, '']).send('buyer@active')
        ).rejects.toThrow(/seller cancelled the atomicassets offer related to this sale/);
    });

    test('purchasesale: throws when a direct sale is purchased with a non-zero delphi median', async () => {
        await listAndActivateSale([ASSET1], 1);
        await deposit('buyer', 1);

        await expect(
            atomicmarket.actions.purchasesale(['buyer', 1, 54321, '']).send('buyer@active')
        ).rejects.toThrow(/intended delphi median needs to be 0 for non delphi sales/);
    });

    test('purchasesale: throws when the taker marketplace is invalid', async () => {
        await listAndActivateSale([ASSET1], 1);
        await deposit('buyer', 1);

        await expect(
            atomicmarket.actions.purchasesale(['buyer', 1, 0, 'fakemarket']).send('buyer@active')
        ).rejects.toThrow(/taker marketplace is not a valid marketplace/);
    });

    test('purchasesale: throws when the buyer has no balance row', async () => {
        await listAndActivateSale([ASSET1], 1);

        await expect(
            atomicmarket.actions.purchasesale(['buyer', 1, 0, '']).send('buyer@active')
        ).rejects.toThrow(/does not have a balance table row/);
    });

    test('purchasesale: throws when the buyer balance is insufficient', async () => {
        await listAndActivateSale([ASSET1], 1);
        await deposit('buyer', 0.5);

        await expect(
            atomicmarket.actions.purchasesale(['buyer', 1, 0, '']).send('buyer@active')
        ).rejects.toThrow(/balance is lower than the specified quantity/);
    });

    test('purchasesale: throws when the buyer only holds a different token', async () => {
        await listAndActivateSale([ASSET1], 1);
        // buyer has a balance row, but only in a different symbol
        setBalance('buyer', ['500.0000 KARMA']);

        await expect(
            atomicmarket.actions.purchasesale(['buyer', 1, 0, '']).send('buyer@active')
        ).rejects.toThrow(/does not have a balance for the symbol specified in the quantity/);
    });

    test('purchasesale: throws without authorization from the buyer', async () => {
        await listAndActivateSale([ASSET1], 1);
        await deposit('buyer', 1);

        await expect(
            atomicmarket.actions.purchasesale(['buyer', 1, 0, '']).send('seller@active')
        ).rejects.toThrow(/missing required authority/);
    });

    /* ------------------------------------------------------------------ */
    /* receive_asset_offer (atomicassets::lognewoffer)                     */
    /* ------------------------------------------------------------------ */

    test('receive_asset_offer: an offer flips the sale offer_id from -1 to the AA offer id', async () => {
        await announceSale([ASSET1], 10);
        expect(Number(saleById(1).offer_id)).toBe(-1);

        await atomicassets.actions.createoffer([
            'seller', MARKET, [ASSET1], [], 'sale',
        ]).send('seller@active');

        const offerId = aaTables.offers()[0].offer_id;
        expect(Number(offerId)).toBeGreaterThanOrEqual(1);
        expect(Number(saleById(1).offer_id)).toBe(Number(offerId));
    });

    test('receive_asset_offer: targets the sender own sale when an equal one by another seller exists', async () => {
        await announceSale([ASSET1], 10); // sale 1 by seller

        await atomicassets.actions.transfer(['seller', 'buyer', [ASSET1], '']).send('seller@active');
        await atomicmarket.actions.announcesale([
            'buyer', [ASSET1], WAX(20), '8,WAX', '',
        ]).send('buyer@active'); // sale 2 by buyer (current owner)

        await atomicassets.actions.createoffer([
            'buyer', MARKET, [ASSET1], [], 'sale',
        ]).send('buyer@active');

        expect(Number(saleById(1).offer_id)).toBe(-1);                 // seller's untouched
        expect(Number(saleById(2).offer_id)).toBeGreaterThanOrEqual(1); // buyer's activated
    });

    test('receive_asset_offer: leaves unrelated sales untouched', async () => {
        await announceSale([ASSET1], 10); // sale 1
        await announceSale([ASSET2], 10); // sale 2 (unrelated)

        await atomicassets.actions.createoffer([
            'seller', MARKET, [ASSET1], [], 'sale',
        ]).send('seller@active');

        expect(Number(saleById(1).offer_id)).toBeGreaterThanOrEqual(1);
        expect(Number(saleById(2).offer_id)).toBe(-1);
    });

    test('receive_asset_offer: throws when the offer asks for assets in return', async () => {
        await announceSale([ASSET1], 10);
        // give the market an asset the offer can ask back for
        await atomicassets.actions.mintasset([
            'author', COL, 'testschema', -1, MARKET, [], [], [],
        ]).send('author@active');
        const marketAsset = aaTables.assets(MARKET)[0].asset_id;

        await expect(
            atomicassets.actions.createoffer([
                'seller', MARKET, [ASSET1], [marketAsset], 'sale',
            ]).send('seller@active')
        ).rejects.toThrow(/must not ask for any assets in return in a sale offer/);
    });

    test('receive_asset_offer: throws when no sale was announced for the assets', async () => {
        await expect(
            atomicassets.actions.createoffer([
                'seller', MARKET, [ASSET1], [], 'sale',
            ]).send('seller@active')
        ).rejects.toThrow(/No sale was announced by this sender for the offered assets/);
    });

    test('receive_asset_offer: throws when the only sale is by a different seller', async () => {
        await announceSale([ASSET1], 10); // sale by seller
        await atomicassets.actions.transfer(['seller', 'buyer', [ASSET1], '']).send('seller@active');

        // buyer now owns ASSET1 but never announced a sale for it
        await expect(
            atomicassets.actions.createoffer([
                'buyer', MARKET, [ASSET1], [], 'sale',
            ]).send('buyer@active')
        ).rejects.toThrow(/No sale was announced by this sender for the offered assets/);
    });

    test('receive_asset_offer: throws when an offer for the sale already exists', async () => {
        await listAndActivateSale([ASSET1], 10); // offer already created

        await expect(
            atomicassets.actions.createoffer([
                'seller', MARKET, [ASSET1], [], 'sale',
            ]).send('seller@active')
        ).rejects.toThrow(/An offer for this sale has already been created/);
    });

    test('receive_asset_offer: throws on an invalid memo', async () => {
        await announceSale([ASSET1], 10);

        await expect(
            atomicassets.actions.createoffer([
                'seller', MARKET, [ASSET1], [], 'Wrong memo!',
            ]).send('seller@active')
        ).rejects.toThrow(/Invalid memo/);
    });

    test('receive_asset_offer: ignores lognewoffer from a counterfeit atomicassets contract', async () => {
        await announceSale([ASSET1], 10);

        // stand up a second, identical contract under a different account and mint the
        // same asset id there, then have it emit lognewoffer at the market
        await atomicfake.actions.init([]).send(`${FAKE_AA}@active`);
        await atomicfake.actions.createcol([
            'author', COL, true, ['author'], [], 0.1, [],
        ]).send('author@active');
        await atomicfake.actions.createschema([
            'author', COL, 'testschema', [{ name: 'name', type: 'string' }],
        ]).send('author@active');
        await atomicfake.actions.mintasset([
            'author', COL, 'testschema', -1, 'seller', [], [], [],
        ]).send('author@active');

        await atomicfake.actions.createoffer([
            'seller', MARKET, [ASSET1], [], 'sale',
        ]).send('seller@active');

        // the market only trusts atomicassets::lognewoffer, so the sale stays inactive
        expect(Number(saleById(1).offer_id)).toBe(-1);
    });
});
