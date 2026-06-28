const { Blockchain, nameToBigInt, mintTokens } = require('@vaulta/vert');
const { Name } = require('@wharfkit/antelope');
const fs = require('fs');

/*
 * Deposit / withdraw coverage for the atomicmarket contract (VeRT port of the Hydra
 * "Deposit-Withdraw Actions" suite, v2-valid gaps not already covered by market-smoke).
 *
 *  - receive_token_transfer: first deposit creates the balance row, a second token appends
 *    to the quantities vector, a repeat deposit increments in place, deposits from a second
 *    (non eosio.token) token contract work, and the contract-identity / memo guards reject.
 *  - withdraw: full / partial / multi-token / non-eosio.token withdrawals adjust the row and
 *    return the tokens, plus the full set of negative guards (no row, wrong symbol, insufficient
 *    balance, non-positive amount, missing owner auth).
 *
 * Self-contained: its own Blockchain, a second token contract (karmatoken) for the
 * "second token" / "non eosio.token" cases, and a leaner beforeEach than the smoke suite
 * (no AtomicAssets / collections needed for balance bookkeeping).
 */

const WAX = (amount) => `${amount.toFixed(8)} WAX`;
const KARMA = (amount) => `${amount.toFixed(4)} KARMA`;
const MARKET = 'atomicmarket';
const MINT_WAX = 10000; // WAX minted to the depositor each run
const MINT_KARMA = 1000; // KARMA minted to the depositor each run

describe('atomicmarket deposit / withdraw', () => {
    let blockchain;
    let atomicmarket, token, karmatoken;
    let buyer, other;

    const eosioTokenAccount = (name) => ({
        name: Name.from(name),
        wasm: fs.readFileSync('./tests/fixtures/eosio.token/eosio.token.wasm'),
        abi: fs.readFileSync('./tests/fixtures/eosio.token/eosio.token.abi', 'utf8'),
    });

    const marketBalances = () =>
        atomicmarket.tables.balances(nameToBigInt(atomicmarket.name)).getTableRows();
    const balanceOf = (account) => {
        const row = marketBalances().find((r) => r.owner === account);
        return row ? row.quantities : null;
    };
    const tokenAccountsOf = (contract, account) =>
        contract.tables.accounts(nameToBigInt(Name.from(account))).getTableRows();
    const setBalance = (account, quantities) =>
        atomicmarket.tables.balances(nameToBigInt(atomicmarket.name)).set(
            nameToBigInt(Name.from(account)), atomicmarket.name,
            { owner: account, quantities }
        );

    // deposit a token by transferring it to the market with the "deposit" memo
    const deposit = (contract, account, quantity, memo = 'deposit') =>
        contract.actions.transfer([account, MARKET, quantity, memo]).send(`${account}@active`);

    beforeAll(async () => {
        blockchain = new Blockchain();
        atomicmarket = blockchain.createContract(MARKET, './build/atomicmarket');
        token = blockchain.createAccount(eosioTokenAccount('eosio.token'));
        karmatoken = blockchain.createAccount(eosioTokenAccount('karmatoken'));

        buyer = blockchain.createAccount('buyer');
        other = blockchain.createAccount('other');
    });

    beforeEach(async () => {
        blockchain.resetTables();

        await atomicmarket.actions.init([]).send(`${MARKET}@active`);

        // eosio.token/WAX and a second contract karmatoken/KARMA are supported
        await atomicmarket.actions.addconftoken(['eosio.token', '8,WAX']).send(`${MARKET}@active`);
        await atomicmarket.actions.addconftoken(['karmatoken', '4,KARMA']).send(`${MARKET}@active`);

        // fund the depositor: WAX (eosio.token), KARMA (karmatoken) and, deliberately, WAX
        // issued by karmatoken so the "same symbol, wrong contract" guard can be exercised
        await mintTokens(token, 'WAX', 8, 1000000000, MINT_WAX, [buyer]);
        await mintTokens(karmatoken, 'KARMA', 4, 1000000, MINT_KARMA, [buyer]);
        await mintTokens(karmatoken, 'WAX', 8, 1000000000, MINT_WAX, [buyer]);
    });

    /* ------------------------------------------------------------------ */
    /* deposit (receive_token_transfer)                                   */
    /* ------------------------------------------------------------------ */

    test('first deposit without an existing row creates the balance row', async () => {
        await deposit(token, 'buyer', WAX(10));

        expect(marketBalances()).toEqual([
            { owner: 'buyer', quantities: [WAX(10)] },
        ]);
    });

    test('depositing a second token appends to the quantities vector', async () => {
        await deposit(karmatoken, 'buyer', KARMA(25));
        await deposit(token, 'buyer', WAX(10));

        expect(marketBalances()).toEqual([
            { owner: 'buyer', quantities: [KARMA(25), WAX(10)] },
        ]);
    });

    test('depositing a token the row already holds increments it in place', async () => {
        await deposit(token, 'buyer', WAX(10));
        await deposit(token, 'buyer', WAX(10));

        expect(marketBalances()).toEqual([
            { owner: 'buyer', quantities: [WAX(20)] },
        ]);
    });

    test('deposit from a non eosio.token token contract is credited', async () => {
        await deposit(karmatoken, 'buyer', KARMA(10));

        expect(marketBalances()).toEqual([
            { owner: 'buyer', quantities: [KARMA(10)] },
        ]);
    });

    test('throws when the token is not supported (same symbol, wrong contract)', async () => {
        // karmatoken also issues WAX, but only eosio.token/WAX is a supported token, so
        // the contract-identity half of is_token_supported must reject this deposit
        await expect(
            deposit(karmatoken, 'buyer', WAX(10))
        ).rejects.toThrow(/The transferred token is not supported/);

        expect(marketBalances()).toEqual([]);
    });

    test('throws on an invalid (non "deposit") memo', async () => {
        await expect(
            deposit(token, 'buyer', WAX(10), 'this memo is probably invalid')
        ).rejects.toThrow(/invalid memo/);

        expect(marketBalances()).toEqual([]);
    });

    /* ------------------------------------------------------------------ */
    /* withdraw                                                            */
    /* ------------------------------------------------------------------ */

    test('withdrawing all of the only token erases the row and returns the tokens', async () => {
        await deposit(token, 'buyer', WAX(100));

        await atomicmarket.actions.withdraw(['buyer', WAX(100)]).send('buyer@active');

        expect(marketBalances()).toEqual([]); // row erased
        expect(tokenAccountsOf(token, 'buyer')).toEqual([{ balance: WAX(MINT_WAX) }]);
    });

    test('withdrawing part of the only token reduces the row', async () => {
        await deposit(token, 'buyer', WAX(100));

        await atomicmarket.actions.withdraw(['buyer', WAX(30)]).send('buyer@active');

        expect(marketBalances()).toEqual([
            { owner: 'buyer', quantities: [WAX(70)] },
        ]);
        expect(tokenAccountsOf(token, 'buyer')).toEqual([{ balance: WAX(MINT_WAX - 70) }]);
    });

    test('withdrawing all of one of several tokens leaves the others intact', async () => {
        await deposit(karmatoken, 'buyer', KARMA(50));
        await deposit(token, 'buyer', WAX(100));

        await atomicmarket.actions.withdraw(['buyer', WAX(100)]).send('buyer@active');

        expect(marketBalances()).toEqual([
            { owner: 'buyer', quantities: [KARMA(50)] },
        ]);
        expect(tokenAccountsOf(token, 'buyer')).toEqual([{ balance: WAX(MINT_WAX) }]);
    });

    test('withdrawing a non eosio.token token returns it from the right contract', async () => {
        await deposit(karmatoken, 'buyer', KARMA(50));

        await atomicmarket.actions.withdraw(['buyer', KARMA(50)]).send('buyer@active');

        expect(marketBalances()).toEqual([]); // row erased
        // buyer also holds karmatoken-issued WAX (minted for the unsupported-token case),
        // so assert the KARMA balance specifically was fully returned
        const karmaBalances = tokenAccountsOf(karmatoken, 'buyer')
            .map((r) => r.balance)
            .filter((b) => b.endsWith('KARMA'));
        expect(karmaBalances).toEqual([KARMA(MINT_KARMA)]);
    });

    test('throws when the owner has no balance row at all', async () => {
        await expect(
            atomicmarket.actions.withdraw(['buyer', WAX(100)]).send('buyer@active')
        ).rejects.toThrow(/does not have a balance table row/);
    });

    test('throws when the owner has no balance for the withdrawal symbol', async () => {
        setBalance('buyer', [KARMA(50)]);

        await expect(
            atomicmarket.actions.withdraw(['buyer', WAX(100)]).send('buyer@active')
        ).rejects.toThrow(/does not have a balance for the symbol specified in the quantity/);
    });

    test('throws when the balance is lower than the withdrawal amount', async () => {
        setBalance('buyer', [WAX(50)]);

        await expect(
            atomicmarket.actions.withdraw(['buyer', WAX(100)]).send('buyer@active')
        ).rejects.toThrow(/balance is lower than the specified quantity/);
    });

    test('throws on a non-positive withdrawal amount', async () => {
        setBalance('buyer', [WAX(50)]);

        await expect(
            atomicmarket.actions.withdraw(['buyer', '-100.00000000 WAX']).send('buyer@active')
        ).rejects.toThrow(/The quantity to withdraw must be positive/);
    });

    test('throws without the owner authorization', async () => {
        await deposit(token, 'buyer', WAX(50));

        await expect(
            atomicmarket.actions.withdraw(['buyer', WAX(50)]).send('other@active')
        ).rejects.toThrow(/missing required authority buyer/);
    });
});
