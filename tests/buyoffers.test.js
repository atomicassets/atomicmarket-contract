const { Blockchain, nameToBigInt, mintTokens } = require('@vaulta/vert');
const { Name } = require('@wharfkit/antelope');
const fs = require('fs');

/*
 * Buyoffer-action coverage for the atomicmarket contract (v2-valid gaps).
 *
 * Translated from the Hydra "Buyoffer Actions" suite (createbuyo / cancelbuyo /
 * acceptbuyo / declinebuyo), restricted to single-asset / v2-valid behavior.
 *
 * v2 semantics applied here:
 *  - Single-asset only: createbuyo rejects asset_ids.size() != 1, so the legacy
 *    multi-asset happy paths are obsolete (empty / duplicate inputs both reduce to
 *    the "exactly one asset id" guard).
 *  - createbuyo escrows the price out of the buyer's deposited market balance.
 *  - The collection_fee snapshot stored on the row, and the fee actually charged at
 *    acceptbuyo settlement, are the live AtomicAssets market_fee (10% from setup).
 *  - acceptbuyo requires the recipient to have created the matching AtomicAssets
 *    offer (memo "buyoffer", to the market, no assets asked back) before accepting.
 *
 * Skipped (already covered by market-smoke.test.js): the createbuyo bundle
 * rejection, the acceptbuyo is_permutation length-mismatch guard, the empty
 * AtomicAssets offers-table guard, and the legacy bundle buyoffer refund.
 */

const WAX = (amount) => `${amount.toFixed(8)} WAX`;
const ASSET1 = '1099511627776'; // template-1 asset minted to seller (transferable)
const ASSET2 = '1099511627777'; // templateless asset minted to seller
const ASSET3 = '1099511627778'; // first id minted by any per-test mintasset
const MARKET = 'atomicmarket';
const AA = 'atomicassets';
const COL = 'testcollect1';

describe('atomicmarket buyoffers', () => {
    let blockchain;
    let atomicmarket, atomicassets, token, delphi;
    let author, seller, buyer, renter, renter2;
    let founder1, founder2, temproy1, attrroy1, feesAtomic, marketowner;

    const aaTables = {
        assets: (scope) => atomicassets.tables.assets(nameToBigInt(Name.from(scope))).getTableRows(),
        offers: () => atomicassets.tables.offers(nameToBigInt(atomicassets.name)).getTableRows(),
    };
    const marketTables = {
        balances: () => atomicmarket.tables.balances(nameToBigInt(atomicmarket.name)).getTableRows(),
        buyoffers: () => atomicmarket.tables.buyoffers(nameToBigInt(atomicmarket.name)).getTableRows(),
        marketplaces: () => atomicmarket.tables.marketplaces(nameToBigInt(atomicmarket.name)).getTableRows(),
    };

    const balanceOf = (account) => {
        const row = marketTables.balances().find((r) => r.owner === account);
        return row ? row.quantities : null;
    };

    const tokenBalanceOf = (account) =>
        token.tables.accounts(nameToBigInt(Name.from(account))).getTableRows();

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
        marketowner = blockchain.createAccount('marketowner');
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

        // Template 1 with immutable template data (transferable)
        await atomicassets.actions.createtempl([
            'author', COL, 'testschema', true, true, 0,
            [{ first: 'name', second: ['string', 'TestItem'] }],
        ]).send('author@active');

        // ASSET1: template asset owned by seller
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
    /* createbuyo                                                          */
    /* ------------------------------------------------------------------ */

    test('createbuyo for a single (templateless) asset escrows from the buyer balance', async () => {
        await deposit('buyer', 100);

        await atomicmarket.actions.createbuyo([
            'buyer', 'seller', WAX(50), [ASSET2], 'My memo', '',
        ]).send('buyer@active');

        const buyoffers = marketTables.buyoffers();
        expect(buyoffers.length).toBe(1);
        expect(Number(buyoffers[0].buyoffer_id)).toBe(1);
        expect(buyoffers[0]).toMatchObject({
            buyer: 'buyer',
            recipient: 'seller',
            price: WAX(50),
            asset_ids: [ASSET2],
            memo: 'My memo',
            maker_marketplace: '',
            collection_name: COL,
        });
        // collection_fee snapshot = live AA market_fee (10%)
        expect(Number(buyoffers[0].collection_fee)).toBeCloseTo(0.1);

        // 50 of the 100 deposited WAX is now escrowed, leaving 50 in the balance
        expect(balanceOf('buyer')).toEqual([WAX(50)]);
    });

    test('createbuyo for an asset with a template', async () => {
        await deposit('buyer', 100);

        await atomicmarket.actions.createbuyo([
            'buyer', 'seller', WAX(50), [ASSET1], 'My memo', '',
        ]).send('buyer@active');

        const buyoffers = marketTables.buyoffers();
        expect(buyoffers.length).toBe(1);
        expect(buyoffers[0].asset_ids).toEqual([ASSET1]);
        expect(balanceOf('buyer')).toEqual([WAX(50)]);
    });

    test('createbuyo a second buyoffer increments the id and escrows both', async () => {
        await deposit('buyer', 100);

        await atomicmarket.actions.createbuyo([
            'buyer', 'seller', WAX(50), [ASSET1], 'My memo', '',
        ]).send('buyer@active');
        await atomicmarket.actions.createbuyo([
            'buyer', 'seller', WAX(50), [ASSET2], 'My memo', '',
        ]).send('buyer@active');

        const buyoffers = marketTables.buyoffers();
        expect(buyoffers.map((b) => Number(b.buyoffer_id))).toEqual([1, 2]);
        expect(buyoffers.map((b) => b.asset_ids[0])).toEqual([ASSET1, ASSET2]);
        // 100 fully escrowed across the two offers -> balance row erased
        expect(balanceOf('buyer')).toBeNull();
    });

    test('createbuyo two buyoffers for the same asset', async () => {
        await deposit('buyer', 100);

        await atomicmarket.actions.createbuyo([
            'buyer', 'seller', WAX(30), [ASSET1], 'My memo', '',
        ]).send('buyer@active');
        await atomicmarket.actions.createbuyo([
            'buyer', 'seller', WAX(50), [ASSET1], 'My second memo', '',
        ]).send('buyer@active');

        const buyoffers = marketTables.buyoffers();
        expect(buyoffers.length).toBe(2);
        expect(buyoffers.map((b) => b.price)).toEqual([WAX(30), WAX(50)]);
        // 30 + 50 escrowed, 20 left
        expect(balanceOf('buyer')).toEqual([WAX(20)]);
    });

    test('createbuyo with a different supported token', async () => {
        await mintTokens(token, 'KARMA', 4, 1000000000, 10000, [buyer]);
        await atomicmarket.actions.addconftoken(['eosio.token', '4,KARMA']).send(`${MARKET}@active`);

        await token.actions.transfer([
            'buyer', MARKET, '100.0000 KARMA', 'deposit',
        ]).send('buyer@active');

        await atomicmarket.actions.createbuyo([
            'buyer', 'seller', '50.0000 KARMA', [ASSET1], 'My memo', '',
        ]).send('buyer@active');

        const buyoffers = marketTables.buyoffers();
        expect(buyoffers[0].price).toBe('50.0000 KARMA');
        expect(balanceOf('buyer')).toEqual(['50.0000 KARMA']);
    });

    test('createbuyo with a custom maker marketplace', async () => {
        await atomicmarket.actions.regmarket(['marketowner', 'mymarket1111']).send('marketowner@active');
        await deposit('buyer', 100);

        await atomicmarket.actions.createbuyo([
            'buyer', 'seller', WAX(50), [ASSET1], 'My memo', 'mymarket1111',
        ]).send('buyer@active');

        expect(marketTables.buyoffers()[0].maker_marketplace).toBe('mymarket1111');
        expect(balanceOf('buyer')).toEqual([WAX(50)]);
    });

    test('createbuyo throws when buyer equals recipient', async () => {
        await expect(
            atomicmarket.actions.createbuyo([
                'buyer', 'buyer', WAX(50), [ASSET1], 'My memo', '',
            ]).send('buyer@active')
        ).rejects.toThrow(/buyer and recipient can't be the same account/);
    });

    test('createbuyo throws on empty asset_ids (single-asset guard)', async () => {
        await expect(
            atomicmarket.actions.createbuyo([
                'buyer', 'seller', WAX(50), [], 'My memo', '',
            ]).send('buyer@active')
        ).rejects.toThrow(/exactly one asset id/);
    });

    test('createbuyo throws on duplicate asset_ids (single-asset guard)', async () => {
        await expect(
            atomicmarket.actions.createbuyo([
                'buyer', 'seller', WAX(50), [ASSET1, ASSET1], 'My memo', '',
            ]).send('buyer@active')
        ).rejects.toThrow(/exactly one asset id/);
    });

    test('createbuyo throws when the recipient does not own the asset', async () => {
        await expect(
            atomicmarket.actions.createbuyo([
                'buyer', 'seller', WAX(50), ['999999999999'], 'My memo', '',
            ]).send('buyer@active')
        ).rejects.toThrow(/does not own at least one of the assets/);
    });

    test('createbuyo throws when the asset is not transferable', async () => {
        // template 2: non-transferable; ASSET3 minted from it to seller
        await atomicassets.actions.createtempl([
            'author', COL, 'testschema', false, true, 0, [],
        ]).send('author@active');
        await atomicassets.actions.mintasset([
            'author', COL, 'testschema', 2, 'seller', [], [], [],
        ]).send('author@active');

        await expect(
            atomicmarket.actions.createbuyo([
                'buyer', 'seller', WAX(50), [ASSET3], 'My memo', '',
            ]).send('buyer@active')
        ).rejects.toThrow(/is not transferable/);
    });

    test('createbuyo throws when the price symbol is not supported', async () => {
        await expect(
            atomicmarket.actions.createbuyo([
                'buyer', 'seller', '50.0000 FAKE', [ASSET1], 'My memo', '',
            ]).send('buyer@active')
        ).rejects.toThrow(/symbol of the specified price is not supported/);
    });

    test('createbuyo throws when the price is zero', async () => {
        await expect(
            atomicmarket.actions.createbuyo([
                'buyer', 'seller', WAX(0), [ASSET1], 'My memo', '',
            ]).send('buyer@active')
        ).rejects.toThrow(/price must be greater than zero/);
    });

    test('createbuyo throws when the price is negative', async () => {
        await expect(
            atomicmarket.actions.createbuyo([
                'buyer', 'seller', '-10.00000000 WAX', [ASSET1], 'My memo', '',
            ]).send('buyer@active')
        ).rejects.toThrow(/price must be greater than zero/);
    });

    test('createbuyo throws when the maker marketplace does not exist', async () => {
        await deposit('buyer', 100);
        await expect(
            atomicmarket.actions.createbuyo([
                'buyer', 'seller', WAX(50), [ASSET1], 'My memo', 'fakemarket',
            ]).send('buyer@active')
        ).rejects.toThrow(/maker marketplace is not a valid marketplace/);
    });

    test('createbuyo throws when the memo is over 256 bytes', async () => {
        await deposit('buyer', 100);
        const longMemo = 'x'.repeat(257);
        await expect(
            atomicmarket.actions.createbuyo([
                'buyer', 'seller', WAX(50), [ASSET1], longMemo, '',
            ]).send('buyer@active')
        ).rejects.toThrow(/buyoffer memo can only be 256 characters max/);
    });

    test('createbuyo throws without authorization from the buyer', async () => {
        await expect(
            atomicmarket.actions.createbuyo([
                'buyer', 'seller', WAX(50), [ASSET1], 'My memo', '',
            ]).send('seller@active')
        ).rejects.toThrow(/missing required authority/);
    });

    /* ------------------------------------------------------------------ */
    /* cancelbuyo                                                          */
    /* ------------------------------------------------------------------ */

    test('cancelbuyo refunds the buyer balance and erases the row', async () => {
        await deposit('buyer', 1);
        await atomicmarket.actions.createbuyo([
            'buyer', 'seller', WAX(1), [ASSET1], '', '',
        ]).send('buyer@active');
        expect(balanceOf('buyer')).toBeNull(); // fully escrowed

        await atomicmarket.actions.cancelbuyo([1]).send('buyer@active');

        expect(marketTables.buyoffers()).toEqual([]);
        expect(balanceOf('buyer')).toEqual([WAX(1)]); // escrow refunded
    });

    test('cancelbuyo throws when no buyoffer with the id exists', async () => {
        await expect(
            atomicmarket.actions.cancelbuyo([1]).send('buyer@active')
        ).rejects.toThrow(/No buyoffer with this id exists/);
    });

    test('cancelbuyo throws without authorization of the buyer', async () => {
        await deposit('buyer', 1);
        await atomicmarket.actions.createbuyo([
            'buyer', 'seller', WAX(1), [ASSET1], '', '',
        ]).send('buyer@active');

        await expect(
            atomicmarket.actions.cancelbuyo([1]).send('seller@active')
        ).rejects.toThrow(/missing required authority/);
    });

    /* ------------------------------------------------------------------ */
    /* acceptbuyo                                                          */
    /* ------------------------------------------------------------------ */

    const createSingleBuyoffer = async (price) => {
        await deposit('buyer', price);
        await atomicmarket.actions.createbuyo([
            'buyer', 'seller', WAX(price), [ASSET1], 'My memo', '',
        ]).send('buyer@active');
    };

    test('acceptbuyo settles a single-asset buyoffer with the exact fee split', async () => {
        await createSingleBuyoffer(1);

        // the recipient (seller) escrows the asset to the market via an AA offer
        await atomicassets.actions.createoffer([
            'seller', MARKET, [ASSET1], [], 'buyoffer',
        ]).send('seller@active');

        await atomicmarket.actions.acceptbuyo([
            1, [ASSET1], WAX(1), '',
        ]).send('seller@active');

        expect(marketTables.buyoffers()).toEqual([]);

        // 1 WAX: 10% collection -> author, 1% maker + 1% taker -> fees.atomic,
        // 88% paid straight to the recipient's token balance
        expect(balanceOf('author')).toEqual([WAX(0.1)]);
        expect(balanceOf('fees.atomic')).toEqual([WAX(0.02)]);
        expect(balanceOf('buyer')).toBeNull(); // escrow consumed
        expect(tokenBalanceOf('seller')).toEqual([{ balance: WAX(0.88) }]);

        // the asset moved to the buyer
        expect(aaTables.assets('buyer').length).toBe(1);
        expect(aaTables.assets('buyer')[0].asset_id).toBe(ASSET1);
    });

    test('acceptbuyo with a custom taker marketplace splits the taker fee', async () => {
        await atomicmarket.actions.regmarket(['marketowner', 'mymarket1111']).send('marketowner@active');
        await createSingleBuyoffer(1);

        await atomicassets.actions.createoffer([
            'seller', MARKET, [ASSET1], [], 'buyoffer',
        ]).send('seller@active');

        await atomicmarket.actions.acceptbuyo([
            1, [ASSET1], WAX(1), 'mymarket1111',
        ]).send('seller@active');

        // maker (default '') -> fees.atomic 1%, taker (mymarket1111) -> marketowner 1%
        expect(balanceOf('author')).toEqual([WAX(0.1)]);
        expect(balanceOf('fees.atomic')).toEqual([WAX(0.01)]);
        expect(balanceOf('marketowner')).toEqual([WAX(0.01)]);
        expect(tokenBalanceOf('seller')).toEqual([{ balance: WAX(0.88) }]);
    });

    test('acceptbuyo throws when the expected price differs from the buyoffer', async () => {
        await createSingleBuyoffer(1);
        await expect(
            atomicmarket.actions.acceptbuyo([
                1, [ASSET1], WAX(2), '',
            ]).send('seller@active')
        ).rejects.toThrow(/price of this buyoffer differ from the expected price/);
    });

    test('acceptbuyo throws when the most recent AA offer is not from the recipient', async () => {
        await createSingleBuyoffer(1);
        // ASSET3 minted to buyer; buyer (not the recipient) is the most recent offerer
        await atomicassets.actions.mintasset([
            'author', COL, 'testschema', -1, 'buyer', [], [], [],
        ]).send('author@active');
        await atomicassets.actions.createoffer([
            'buyer', MARKET, [ASSET3], [], 'buyoffer',
        ]).send('buyer@active');

        await expect(
            atomicmarket.actions.acceptbuyo([
                1, [ASSET1], WAX(1), '',
            ]).send('seller@active')
        ).rejects.toThrow(/must be from the buyoffer recipient to the AtomicMarket contract/);
    });

    test('acceptbuyo throws when the most recent AA offer is not to the market', async () => {
        await createSingleBuyoffer(1);
        // recipient creates the offer but to the buyer instead of to the market
        await atomicassets.actions.createoffer([
            'seller', 'buyer', [ASSET1], [], 'buyoffer',
        ]).send('seller@active');

        await expect(
            atomicmarket.actions.acceptbuyo([
                1, [ASSET1], WAX(1), '',
            ]).send('seller@active')
        ).rejects.toThrow(/must be from the buyoffer recipient to the AtomicMarket contract/);
    });

    test('acceptbuyo throws when the most recent AA offer has the wrong assets', async () => {
        await createSingleBuyoffer(1);
        // offer escrows ASSET2 instead of the buyoffer's ASSET1
        await atomicassets.actions.createoffer([
            'seller', MARKET, [ASSET2], [], 'buyoffer',
        ]).send('seller@active');

        await expect(
            atomicmarket.actions.acceptbuyo([
                1, [ASSET1], WAX(1), '',
            ]).send('seller@active')
        ).rejects.toThrow(/must contain exactly the assets of the buyoffer/);
    });

    test('acceptbuyo throws when the most recent AA offer asks for NFTs back', async () => {
        await createSingleBuyoffer(1);
        // give the market an asset, then have the recipient ask for it back in the offer
        await atomicassets.actions.mintasset([
            'author', COL, 'testschema', -1, MARKET, [], [], [],
        ]).send('author@active');
        await atomicassets.actions.createoffer([
            'seller', MARKET, [ASSET1], [ASSET3], 'buyoffer',
        ]).send('seller@active');

        await expect(
            atomicmarket.actions.acceptbuyo([
                1, [ASSET1], WAX(1), '',
            ]).send('seller@active')
        ).rejects.toThrow(/must not ask for any assets in return/);
    });

    test('acceptbuyo throws when the AA offer memo is invalid', async () => {
        await createSingleBuyoffer(1);
        // A createoffer to the market with an unrecognized memo is rejected by the market's
        // receive_asset_offer notification handler at creation time, so the offer row is
        // injected directly to reach the acceptbuyo memo guard (same as the Hydra fixture).
        atomicassets.tables.offers(nameToBigInt(atomicassets.name)).set(1n, atomicassets.name, {
            offer_id: 1,
            sender: 'seller',
            recipient: MARKET,
            sender_asset_ids: [ASSET1],
            recipient_asset_ids: [],
            memo: 'this memo is invalid',
            ram_payer: 'seller',
        });

        await expect(
            atomicmarket.actions.acceptbuyo([
                1, [ASSET1], WAX(1), '',
            ]).send('seller@active')
        ).rejects.toThrow(/must have the memo "buyoffer"/);
    });

    test('acceptbuyo throws when the taker marketplace is invalid', async () => {
        await createSingleBuyoffer(1);
        await atomicassets.actions.createoffer([
            'seller', MARKET, [ASSET1], [], 'buyoffer',
        ]).send('seller@active');

        await expect(
            atomicmarket.actions.acceptbuyo([
                1, [ASSET1], WAX(1), 'fakemarket',
            ]).send('seller@active')
        ).rejects.toThrow(/taker marketplace is not a valid marketplace/);
    });

    test('acceptbuyo throws without authorization from the recipient', async () => {
        await createSingleBuyoffer(1);
        await atomicassets.actions.createoffer([
            'seller', MARKET, [ASSET1], [], 'buyoffer',
        ]).send('seller@active');

        await expect(
            atomicmarket.actions.acceptbuyo([
                1, [ASSET1], WAX(1), '',
            ]).send('buyer@active')
        ).rejects.toThrow(/missing required authority/);
    });

    /* ------------------------------------------------------------------ */
    /* declinebuyo                                                         */
    /* ------------------------------------------------------------------ */

    test('declinebuyo refunds the buyer balance and erases the row', async () => {
        await deposit('buyer', 1);
        await atomicmarket.actions.createbuyo([
            'buyer', 'seller', WAX(1), [ASSET1], 'My memo', '',
        ]).send('buyer@active');

        await atomicmarket.actions.declinebuyo([1, 'My decline memo']).send('seller@active');

        expect(marketTables.buyoffers()).toEqual([]);
        expect(balanceOf('buyer')).toEqual([WAX(1)]); // escrow refunded
    });

    test('declinebuyo throws when no buyoffer with the id exists', async () => {
        await expect(
            atomicmarket.actions.declinebuyo([1, 'My decline memo']).send('seller@active')
        ).rejects.toThrow(/No buyoffer with this id exists/);
    });

    test('declinebuyo throws when the decline memo is over 256 bytes', async () => {
        await deposit('buyer', 1);
        await atomicmarket.actions.createbuyo([
            'buyer', 'seller', WAX(1), [ASSET1], 'My memo', '',
        ]).send('buyer@active');

        const longMemo = 'x'.repeat(257);
        await expect(
            atomicmarket.actions.declinebuyo([1, longMemo]).send('seller@active')
        ).rejects.toThrow(/decline memo can only be 256 characters max/);
    });

    test('declinebuyo throws without authorization of the recipient', async () => {
        await deposit('buyer', 1);
        await atomicmarket.actions.createbuyo([
            'buyer', 'seller', WAX(1), [ASSET1], 'My memo', '',
        ]).send('buyer@active');

        await expect(
            atomicmarket.actions.declinebuyo([1, 'My decline memo']).send('buyer@active')
        ).rejects.toThrow(/missing required authority/);
    });
});
