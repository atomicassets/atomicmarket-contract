const { Blockchain, nameToBigInt, mintTokens } = require('@vaulta/vert');
const { Name, TimePoint } = require('@wharfkit/antelope');
const fs = require('fs');

/*
 * VeRT coverage for the AtomicMarket auction actions, filling the v2-valid gaps the
 * end-to-end smoke suite does not exercise:
 *   announceauct, receive_asset_transfer (auction activation), auctionbid,
 *   auctclaimbuy, auctclaimsel.
 *
 * Ported from the Hydra "Auction Actions" suite, restricted to v2-valid behaviour:
 *  - single-asset only (bundle / multi-asset happy paths are obsolete and the rejection
 *    is already covered in market-smoke; the legacy bundle dissolve / partial-claim paths
 *    live in market-smoke too).
 *  - collection fee is the live 10% from the shared setup (the stored collection_fee is
 *    informational); seller payout is a direct token transfer (asserted via
 *    token.tables.accounts), fees/bids accrue to the market balances table.
 *
 * Self-contained: the beforeAll/beforeEach and helpers are copied from market-smoke.test.js
 * (one Blockchain per file, same as the Hydra suites). Error strings are matched against the
 * actual v2 messages in src/atomicmarket.cpp.
 */

const WAX = (amount) => `${amount.toFixed(8)} WAX`;
const ASSET1 = '1099511627776'; // first minted asset id (2^40)
const ASSET2 = '1099511627777';
const MARKET = 'atomicmarket';
const AA = 'atomicassets';
const COL = 'testcollect1';

describe('atomicmarket auctions', () => {
    let blockchain;
    let atomicmarket, atomicassets, token, delphi;
    let author, seller, buyer, renter, renter2;
    let founder1, founder2, temproy1, attrroy1, feesAtomic;

    const aaTables = {
        assets: (scope) => atomicassets.tables.assets(nameToBigInt(Name.from(scope))).getTableRows(),
        offers: () => atomicassets.tables.offers(nameToBigInt(atomicassets.name)).getTableRows(),
    };
    const marketTables = {
        balances: () => atomicmarket.tables.balances(nameToBigInt(atomicmarket.name)).getTableRows(),
        sales: () => atomicmarket.tables.sales(nameToBigInt(atomicmarket.name)).getTableRows(),
        auctions: () => atomicmarket.tables.auctions(nameToBigInt(atomicmarket.name)).getTableRows(),
    };

    const balanceOf = (account) => {
        const row = marketTables.balances().find((r) => r.owner === account);
        return row ? row.quantities : null;
    };

    const tokenBalanceOf = (account) =>
        token.tables.accounts(nameToBigInt(Name.from(account))).getTableRows();

    const auctionById = (id) =>
        marketTables.auctions().find((a) => Number(a.auction_id) === id);

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

    /* --------------------------------------------------------------------- */
    /* helpers specific to auctions                                          */
    /* --------------------------------------------------------------------- */

    const announceAuct = async (assetIds, startingBid, opts = {}) => {
        const { duration = 600, maker = '', actor = 'seller' } = opts;
        await atomicmarket.actions.announceauct([
            actor, assetIds, startingBid, duration, maker,
        ]).send(`${actor}@active`);
    };

    const transferForAuction = async (assetIds, actor = 'seller') => {
        await atomicassets.actions.transfer([
            actor, MARKET, assetIds, 'auction',
        ]).send(`${actor}@active`);
    };

    // Custodial single-asset auction ready to receive bids (announce + transfer).
    const liveAuction = async (assetIds, startingBid, opts = {}) => {
        await announceAuct(assetIds, startingBid, opts);
        await transferForAuction(assetIds, opts.actor || 'seller');
    };

    // The chain clock only moves on addTime (actions do not advance it), and auctions are
    // announced with a 600s duration, so a single 700s jump finishes the latest auction.
    const finishAuctions = () => blockchain.addTime(TimePoint.fromMilliseconds(700 * 1000));

    // Inject an auction row directly into the table store (mirrors market-smoke's legacy-row
    // injection). NOTE: a directly-set row is NOT added to the assetidshash secondary index,
    // so it is only useful where the contract reaches the row by primary key or where its
    // absence from the index is the intended scenario.
    // Create a REAL foreign auction for `assetId` by `other`, registered in the
    // assetidshash secondary index, then return the asset to `seller` so the foreign
    // auction is stale but still indexed. A directly-set row (TableView.set) skips the
    // secondary index, which both announceauct's duplicate check and receive_asset_transfer
    // walk - so injection would give false coverage. The ownership swap exercises the index
    // for real.
    const announceForeignAuction = async (assetId, other = 'buyer', startingBid = WAX(10)) => {
        await atomicassets.actions.transfer(['seller', other, [assetId], 'lend']).send('seller@active');
        await announceAuct([assetId], startingBid, { actor: other });
        await atomicassets.actions.transfer([other, 'seller', [assetId], 'return']).send(`${other}@active`);
    };

    const auctionsBySeller = (s) => marketTables.auctions().filter((a) => a.seller === s);

    const mintNonTransferableAsset = async () => {
        // template 2: not transferable
        await atomicassets.actions.createtempl([
            'author', COL, 'testschema', false, true, 0, [],
        ]).send('author@active');
        await atomicassets.actions.mintasset([
            'author', COL, 'testschema', 2, 'seller', [], [], [],
        ]).send('author@active');
        // third minted asset id
        return '1099511627778';
    };

    /* ===================================================================== */
    /* announceauct                                                          */
    /* ===================================================================== */

    test('announceauct: single asset creates the auction row', async () => {
        await announceAuct([ASSET1], WAX(10));

        const row = auctionById(1);
        expect(Number(row.auction_id)).toBe(1);
        expect(Number(row.end_time)).toBeGreaterThan(0);
        expect(Number(row.collection_fee)).toBeCloseTo(0.1);
        expect(row).toMatchObject({
            seller: 'seller',
            asset_ids: [ASSET1],
            assets_transferred: false,
            current_bid: WAX(10),
            current_bidder: '',
            claimed_by_seller: false,
            claimed_by_buyer: false,
            maker_marketplace: '',
            taker_marketplace: '',
            collection_name: COL,
        });
    });

    test('announceauct: a second auction gets the next id from the counter', async () => {
        await announceAuct([ASSET1], WAX(10));
        await announceAuct([ASSET2], WAX(10));

        const auctions = marketTables.auctions();
        expect(auctions.length).toBe(2);
        expect(auctions.map((a) => Number(a.auction_id)).sort()).toEqual([1, 2]);
    });

    test('announceauct: with a registered maker marketplace', async () => {
        await atomicmarket.actions.regmarket(['founder1', 'mymarket1111']).send('founder1@active');

        await announceAuct([ASSET1], WAX(10), { maker: 'mymarket1111' });

        expect(auctionById(1).maker_marketplace).toBe('mymarket1111');
    });

    test('announceauct: for a different supported token', async () => {
        await atomicmarket.actions.addconftoken(['eosio.token', '4,KARMA']).send(`${MARKET}@active`);

        await announceAuct([ASSET1], '50.0000 KARMA');

        expect(auctionById(1).current_bid).toBe('50.0000 KARMA');
    });

    test('announceauct: another account already announced for the same asset (both coexist)', async () => {
        // a foreign (now-stale) auction for the same asset must not block the owner's own
        // announce - the duplicate check only fires for the same seller. Built as a real,
        // index-registered auction so the secondary-index path is actually exercised.
        await announceForeignAuction(ASSET1, 'buyer');

        await announceAuct([ASSET1], WAX(10));

        const auctions = marketTables.auctions();
        expect(auctions.length).toBe(2);
        expect(auctionsBySeller('seller').length).toBe(1);
        expect(auctionsBySeller('buyer').length).toBe(1);
    });

    test('announceauct: throw on empty asset_ids (size != 1)', async () => {
        await expect(
            announceAuct([], WAX(10))
        ).rejects.toThrow(/exactly one asset id/);
    });

    test('announceauct: throw on duplicate asset_ids (size != 1)', async () => {
        await expect(
            announceAuct([ASSET1, ASSET1], WAX(10))
        ).rejects.toThrow(/exactly one asset id/);
    });

    test('announceauct: throw when the seller does not own the asset', async () => {
        await expect(
            announceAuct([ASSET1], WAX(10), { actor: 'buyer' })
        ).rejects.toThrow(/does not own at least one of the assets/);
    });

    test('announceauct: throw when the asset is not transferable', async () => {
        const ntAsset = await mintNonTransferableAsset();
        await expect(
            announceAuct([ntAsset], WAX(10))
        ).rejects.toThrow(/not transferable/);
    });

    test('announceauct: throw when the starting bid token is not supported', async () => {
        await expect(
            announceAuct([ASSET1], '10.0000 FAKE')
        ).rejects.toThrow(/starting bid token is not supported/);
    });

    test('announceauct: throw when the starting bid is zero', async () => {
        await expect(
            announceAuct([ASSET1], WAX(0))
        ).rejects.toThrow(/starting bid must be greater than zero/);
    });

    test('announceauct: throw when the starting bid is negative', async () => {
        await expect(
            announceAuct([ASSET1], '-10.00000000 WAX')
        ).rejects.toThrow(/starting bid must be greater than zero/);
    });

    test('announceauct: throw when the maker marketplace does not exist', async () => {
        await expect(
            announceAuct([ASSET1], WAX(10), { maker: 'fakemarket111' })
        ).rejects.toThrow(/maker marketplace is not a valid marketplace/);
    });

    test('announceauct: throw without authorization from the seller', async () => {
        await expect(
            atomicmarket.actions.announceauct([
                'seller', [ASSET1], WAX(10), 600, '',
            ]).send('buyer@active')
        ).rejects.toThrow(/missing required authority/);
    });

    /* ===================================================================== */
    /* receive_asset_transfer (auction activation)                          */
    /* ===================================================================== */

    test('transfer: single asset activates the auction and custodies the asset', async () => {
        await announceAuct([ASSET1], WAX(10));
        await transferForAuction([ASSET1]);

        expect(auctionById(1).assets_transferred).toBe(true);
        expect(aaTables.assets(MARKET).length).toBe(1);
    });

    test('transfer: activates only the seller\'s auction, leaving a foreign auction untouched', async () => {
        // both auctions are real and in the assetidshash index; receive_asset_transfer must
        // pick the one whose seller == the transfer sender.
        await announceForeignAuction(ASSET1, 'buyer'); // real, indexed, stale (buyer)
        await announceAuct([ASSET1], WAX(10));          // seller

        await transferForAuction([ASSET1]);

        expect(auctionsBySeller('seller')[0].assets_transferred).toBe(true);
        expect(auctionsBySeller('buyer')[0].assets_transferred).toBe(false);
    });

    test('transfer: leaves an unrelated auction pending', async () => {
        await announceAuct([ASSET1], WAX(10)); // id 1
        await announceAuct([ASSET2], WAX(10)); // id 2

        await transferForAuction([ASSET1]);

        expect(auctionById(1).assets_transferred).toBe(true);
        expect(auctionById(2).assets_transferred).toBe(false);
    });

    test('transfer: throw when no auction was announced', async () => {
        await expect(
            transferForAuction([ASSET1])
        ).rejects.toThrow(/No announced, non-finished auction by the sender/);
    });

    test('transfer: throw on an invalid memo', async () => {
        await announceAuct([ASSET1], WAX(10));
        await expect(
            atomicassets.actions.transfer([
                'seller', MARKET, [ASSET1], 'not a memo',
            ]).send('seller@active')
        ).rejects.toThrow(/Invalid memo/);
    });

    /* ===================================================================== */
    /* auctionbid                                                            */
    /* ===================================================================== */

    test('auctionbid: initial bid equal to the starting bid', async () => {
        await liveAuction([ASSET1], WAX(50));
        await deposit('buyer', 100);

        await atomicmarket.actions.auctionbid(['buyer', 1, WAX(50), '']).send('buyer@active');

        const row = auctionById(1);
        expect(row.current_bid).toBe(WAX(50));
        expect(row.current_bidder).toBe('buyer');
        expect(balanceOf('buyer')).toEqual([WAX(50)]);
    });

    test('auctionbid: initial bid above the starting bid', async () => {
        await liveAuction([ASSET1], WAX(50));
        await deposit('buyer', 100);

        await atomicmarket.actions.auctionbid(['buyer', 1, WAX(70), '']).send('buyer@active');

        expect(auctionById(1).current_bid).toBe(WAX(70));
        expect(balanceOf('buyer')).toEqual([WAX(30)]);
    });

    test('auctionbid: throw when the initial bid is below the starting bid', async () => {
        await liveAuction([ASSET1], WAX(50));
        await deposit('buyer', 100);

        await expect(
            atomicmarket.actions.auctionbid(['buyer', 1, WAX(10), '']).send('buyer@active')
        ).rejects.toThrow(/at least as high as the minimum bid/);
    });

    test('auctionbid: initial bid with a taker marketplace', async () => {
        await atomicmarket.actions.regmarket(['founder1', 'mymarket1111']).send('founder1@active');
        await liveAuction([ASSET1], WAX(50));
        await deposit('buyer', 100);

        await atomicmarket.actions.auctionbid(['buyer', 1, WAX(50), 'mymarket1111']).send('buyer@active');

        expect(auctionById(1).taker_marketplace).toBe('mymarket1111');
    });

    test('auctionbid: outbidding by exactly 10% refunds the previous bidder', async () => {
        await liveAuction([ASSET1], WAX(50));
        await deposit('renter', 100);
        await deposit('buyer', 100);

        await atomicmarket.actions.auctionbid(['renter', 1, WAX(50), '']).send('renter@active');
        await atomicmarket.actions.auctionbid(['buyer', 1, WAX(55), '']).send('buyer@active');

        const row = auctionById(1);
        expect(row.current_bid).toBe(WAX(55));
        expect(row.current_bidder).toBe('buyer');
        expect(balanceOf('renter')).toEqual([WAX(100)]); // refunded the 50 it had bid
        expect(balanceOf('buyer')).toEqual([WAX(45)]);
    });

    test('auctionbid: outbidding by more than 10%', async () => {
        await liveAuction([ASSET1], WAX(50));
        await deposit('renter', 100);
        await deposit('buyer', 100);

        await atomicmarket.actions.auctionbid(['renter', 1, WAX(50), '']).send('renter@active');
        await atomicmarket.actions.auctionbid(['buyer', 1, WAX(75), '']).send('buyer@active');

        expect(auctionById(1).current_bid).toBe(WAX(75));
        expect(balanceOf('renter')).toEqual([WAX(100)]);
        expect(balanceOf('buyer')).toEqual([WAX(25)]);
    });

    test('auctionbid: throw when the outbid is below the current bid', async () => {
        await liveAuction([ASSET1], WAX(50));
        await deposit('renter', 100);
        await deposit('buyer', 100);

        await atomicmarket.actions.auctionbid(['renter', 1, WAX(50), '']).send('renter@active');
        await expect(
            atomicmarket.actions.auctionbid(['buyer', 1, WAX(10), '']).send('buyer@active')
        ).rejects.toThrow(/relative increase is less than the minimum bid increase/);
    });

    test('auctionbid: throw when the outbid increase is below the config minimum', async () => {
        await liveAuction([ASSET1], WAX(50));
        await deposit('renter', 100);
        await deposit('buyer', 100);

        await atomicmarket.actions.auctionbid(['renter', 1, WAX(50), '']).send('renter@active');
        // 54.5 < 50 * 1.1 = 55
        await expect(
            atomicmarket.actions.auctionbid(['buyer', 1, WAX(54.5), '']).send('buyer@active')
        ).rejects.toThrow(/relative increase is less than the minimum bid increase/);
    });

    test('auctionbid: outbidding with a taker marketplace updates taker_marketplace', async () => {
        await atomicmarket.actions.regmarket(['founder1', 'mymarket1111']).send('founder1@active');
        await liveAuction([ASSET1], WAX(50));
        await deposit('renter', 100);
        await deposit('buyer', 100);

        await atomicmarket.actions.auctionbid(['renter', 1, WAX(50), '']).send('renter@active');
        await atomicmarket.actions.auctionbid(['buyer', 1, WAX(75), 'mymarket1111']).send('buyer@active');

        expect(auctionById(1).taker_marketplace).toBe('mymarket1111');
    });

    test('auctionbid: throw when the auction id does not exist', async () => {
        await deposit('buyer', 100);
        await expect(
            atomicmarket.actions.auctionbid(['buyer', 999, WAX(50), '']).send('buyer@active')
        ).rejects.toThrow(/No auction with this auction_id exists/);
    });

    test('auctionbid: throw when bidding on your own auction', async () => {
        await liveAuction([ASSET1], WAX(50));
        await expect(
            atomicmarket.actions.auctionbid(['seller', 1, WAX(50), '']).send('seller@active')
        ).rejects.toThrow(/can't bid on your own auction/);
    });

    test('auctionbid: throw when the assets have not been transferred yet', async () => {
        await announceAuct([ASSET1], WAX(50)); // announced but not custodied
        await deposit('buyer', 100);
        await expect(
            atomicmarket.actions.auctionbid(['buyer', 1, WAX(50), '']).send('buyer@active')
        ).rejects.toThrow(/auction is not yet active/);
    });

    test('auctionbid: throw when the auction is already finished', async () => {
        await liveAuction([ASSET1], WAX(50));
        await deposit('buyer', 100);
        finishAuctions();
        await expect(
            atomicmarket.actions.auctionbid(['buyer', 1, WAX(50), '']).send('buyer@active')
        ).rejects.toThrow(/auction is already finished/);
    });

    test('auctionbid: throw when the bid uses a different symbol', async () => {
        await liveAuction([ASSET1], WAX(50));
        await expect(
            atomicmarket.actions.auctionbid(['buyer', 1, '75.0000 KARMA', '']).send('buyer@active')
        ).rejects.toThrow(/different symbol than the current auction bid/);
    });

    test('auctionbid: throw when the taker marketplace does not exist', async () => {
        await liveAuction([ASSET1], WAX(50));
        await deposit('buyer', 100);
        await expect(
            atomicmarket.actions.auctionbid(['buyer', 1, WAX(50), 'noexist11111']).send('buyer@active')
        ).rejects.toThrow(/taker marketplace is not a valid marketplace/);
    });

    test('auctionbid: throw without authorization from the bidder', async () => {
        await liveAuction([ASSET1], WAX(50));
        await deposit('buyer', 100);
        await expect(
            atomicmarket.actions.auctionbid(['buyer', 1, WAX(50), '']).send('renter@active')
        ).rejects.toThrow(/missing required authority/);
    });

    /* ===================================================================== */
    /* auctclaimbuy                                                          */
    /* ===================================================================== */

    test('auctclaimbuy: claim transfers the asset to the highest bidder', async () => {
        await liveAuction([ASSET1], WAX(50));
        await deposit('buyer', 100);
        await atomicmarket.actions.auctionbid(['buyer', 1, WAX(100), '']).send('buyer@active');
        finishAuctions();

        await atomicmarket.actions.auctclaimbuy([1]).send('buyer@active');

        expect(auctionById(1).claimed_by_buyer).toBe(true);
        expect(aaTables.assets('buyer').some((a) => a.asset_id === ASSET1)).toBe(true);
        expect(aaTables.assets(MARKET).length).toBe(0);
    });

    test('auctclaimbuy: claiming after the seller already claimed erases the row', async () => {
        await liveAuction([ASSET1], WAX(50));
        await deposit('buyer', 100);
        await atomicmarket.actions.auctionbid(['buyer', 1, WAX(100), '']).send('buyer@active');
        finishAuctions();

        await atomicmarket.actions.auctclaimsel([1]).send('seller@active');
        await atomicmarket.actions.auctclaimbuy([1]).send('buyer@active');

        expect(auctionById(1)).toBeUndefined();
        expect(aaTables.assets('buyer').some((a) => a.asset_id === ASSET1)).toBe(true);
    });

    test('auctclaimbuy: throw when the auction id does not exist', async () => {
        await expect(
            atomicmarket.actions.auctclaimbuy([999]).send('buyer@active')
        ).rejects.toThrow(/No auction with this auction_id exists/);
    });

    test('auctclaimbuy: throw when the auction is not active', async () => {
        await announceAuct([ASSET1], WAX(50)); // never custodied
        await expect(
            atomicmarket.actions.auctclaimbuy([1]).send('buyer@active')
        ).rejects.toThrow(/auction is not active/);
    });

    test('auctclaimbuy: throw when the auction has no bids', async () => {
        await liveAuction([ASSET1], WAX(50));
        finishAuctions();
        await expect(
            atomicmarket.actions.auctclaimbuy([1]).send('buyer@active')
        ).rejects.toThrow(/auction does not have any bids/);
    });

    test('auctclaimbuy: throw when the auction is not finished yet', async () => {
        await liveAuction([ASSET1], WAX(50));
        await deposit('buyer', 100);
        await atomicmarket.actions.auctionbid(['buyer', 1, WAX(100), '']).send('buyer@active');
        await expect(
            atomicmarket.actions.auctclaimbuy([1]).send('buyer@active')
        ).rejects.toThrow(/auction is not finished yet/);
    });

    test('auctclaimbuy: throw when already claimed by the buyer', async () => {
        await liveAuction([ASSET1], WAX(50));
        await deposit('buyer', 100);
        await atomicmarket.actions.auctionbid(['buyer', 1, WAX(100), '']).send('buyer@active');
        finishAuctions();
        await atomicmarket.actions.auctclaimbuy([1]).send('buyer@active');

        await expect(
            atomicmarket.actions.auctclaimbuy([1]).send('buyer@active')
        ).rejects.toThrow(/already been claimed by the buyer/);
    });

    test('auctclaimbuy: throw without authorization from the highest bidder', async () => {
        await liveAuction([ASSET1], WAX(50));
        await deposit('buyer', 100);
        await atomicmarket.actions.auctionbid(['buyer', 1, WAX(100), '']).send('buyer@active');
        finishAuctions();
        await expect(
            atomicmarket.actions.auctclaimbuy([1]).send('renter@active')
        ).rejects.toThrow(/missing required authority/);
    });

    /* ===================================================================== */
    /* auctclaimsel                                                          */
    /* ===================================================================== */

    test('auctclaimsel: seller claim pays out with the exact fee distribution', async () => {
        await liveAuction([ASSET1], WAX(50));
        await deposit('buyer', 100);
        await atomicmarket.actions.auctionbid(['buyer', 1, WAX(100), '']).send('buyer@active');
        finishAuctions();

        await atomicmarket.actions.auctclaimsel([1]).send('seller@active');

        // 100 WAX: author 10% collection fee, fees.atomic 1%+1% maker/taker, seller 88% direct
        expect(balanceOf('author')).toEqual([WAX(10)]);
        expect(balanceOf('fees.atomic')).toEqual([WAX(2)]);
        expect(tokenBalanceOf('seller')).toEqual([{ balance: WAX(88) }]);
        expect(auctionById(1).claimed_by_seller).toBe(true);
    });

    test('auctclaimsel: claiming after the buyer already claimed erases the row', async () => {
        await liveAuction([ASSET1], WAX(50));
        await deposit('buyer', 100);
        await atomicmarket.actions.auctionbid(['buyer', 1, WAX(100), '']).send('buyer@active');
        finishAuctions();

        await atomicmarket.actions.auctclaimbuy([1]).send('buyer@active');
        await atomicmarket.actions.auctclaimsel([1]).send('seller@active');

        expect(auctionById(1)).toBeUndefined();
        expect(balanceOf('author')).toEqual([WAX(10)]);
        expect(tokenBalanceOf('seller')).toEqual([{ balance: WAX(88) }]);
    });

    test('auctclaimsel: custom maker/taker marketplaces split the market fee', async () => {
        await atomicmarket.actions.regmarket(['founder1', 'mymarket1111']).send('founder1@active');
        await atomicmarket.actions.regmarket(['founder2', 'mymarket2222']).send('founder2@active');

        await liveAuction([ASSET1], WAX(50), { maker: 'mymarket1111' });
        await deposit('buyer', 100);
        await atomicmarket.actions.auctionbid(['buyer', 1, WAX(100), 'mymarket2222']).send('buyer@active');
        finishAuctions();

        await atomicmarket.actions.auctclaimsel([1]).send('seller@active');

        expect(balanceOf('author')).toEqual([WAX(10)]);     // 10% collection fee
        expect(balanceOf('founder1')).toEqual([WAX(1)]);    // 1% maker fee
        expect(balanceOf('founder2')).toEqual([WAX(1)]);    // 1% taker fee
        expect(tokenBalanceOf('seller')).toEqual([{ balance: WAX(88) }]);
    });

    test('auctclaimsel: minimal bid rounds every fee to zero and pays the seller in full', async () => {
        await liveAuction([ASSET1], '0.00000001 WAX');
        await deposit('buyer', 1);
        await atomicmarket.actions.auctionbid(['buyer', 1, '0.00000001 WAX', '']).send('buyer@active');
        finishAuctions();

        await atomicmarket.actions.auctclaimsel([1]).send('seller@active');

        // 1 sat: 10% collection and 1% fees all floor to 0, so the seller receives all of it
        expect(balanceOf('author')).toBeNull();
        expect(balanceOf('fees.atomic')).toBeNull();
        expect(tokenBalanceOf('seller')).toEqual([{ balance: '0.00000001 WAX' }]);
    });

    test('auctclaimsel: very small bid leaves only the collection rounding dust', async () => {
        await liveAuction([ASSET1], '0.00000050 WAX');
        await deposit('buyer', 1);
        await atomicmarket.actions.auctionbid(['buyer', 1, '0.00000050 WAX', '']).send('buyer@active');
        finishAuctions();

        await atomicmarket.actions.auctclaimsel([1]).send('seller@active');

        // 50 sat: collection 10% -> floor(5.0) = 5 sat to the author; maker/taker 1% -> 0
        expect(balanceOf('author')).toEqual(['0.00000005 WAX']);
        expect(balanceOf('fees.atomic')).toBeNull();
        expect(tokenBalanceOf('seller')).toEqual([{ balance: '0.00000045 WAX' }]);
    });

    test('auctclaimsel: throw when the auction id does not exist', async () => {
        await expect(
            atomicmarket.actions.auctclaimsel([999]).send('seller@active')
        ).rejects.toThrow(/No auction with this auction_id exists/);
    });

    test('auctclaimsel: throw when the auction is not active', async () => {
        await announceAuct([ASSET1], WAX(50)); // never custodied
        await expect(
            atomicmarket.actions.auctclaimsel([1]).send('seller@active')
        ).rejects.toThrow(/auction is not active/);
    });

    test('auctclaimsel: throw when the auction is not finished yet', async () => {
        await liveAuction([ASSET1], WAX(50));
        await deposit('buyer', 100);
        await atomicmarket.actions.auctionbid(['buyer', 1, WAX(100), '']).send('buyer@active');
        await expect(
            atomicmarket.actions.auctclaimsel([1]).send('seller@active')
        ).rejects.toThrow(/auction is not finished yet/);
    });

    test('auctclaimsel: throw when the auction has no bids', async () => {
        await liveAuction([ASSET1], WAX(50));
        finishAuctions();
        await expect(
            atomicmarket.actions.auctclaimsel([1]).send('seller@active')
        ).rejects.toThrow(/auction does not have any bids/);
    });

    test('auctclaimsel: throw when already claimed by the seller', async () => {
        await liveAuction([ASSET1], WAX(50));
        await deposit('buyer', 100);
        await atomicmarket.actions.auctionbid(['buyer', 1, WAX(100), '']).send('buyer@active');
        finishAuctions();
        await atomicmarket.actions.auctclaimsel([1]).send('seller@active');

        await expect(
            atomicmarket.actions.auctclaimsel([1]).send('seller@active')
        ).rejects.toThrow(/already been claimed by the seller/);
    });

    test('auctclaimsel: throw without authorization from the seller', async () => {
        await liveAuction([ASSET1], WAX(50));
        await deposit('buyer', 100);
        await atomicmarket.actions.auctionbid(['buyer', 1, WAX(100), '']).send('buyer@active');
        finishAuctions();
        await expect(
            atomicmarket.actions.auctclaimsel([1]).send('buyer@active')
        ).rejects.toThrow(/missing required authority/);
    });
});
