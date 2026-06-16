/// Sheka — parimutuel 3-way sports prediction market.
///
/// Each game is a `Market<T>` (T = stake coin, e.g. DUSDC) with three pools:
/// outcome 0 = HOME win, 1 = DRAW, 2 = AWAY win. Users `stake` T into one pool
/// and receive an owned, transferable `Position`. The admin `resolve`s the
/// winner (from the final score). Winners `claim` a pro-rata share of the whole
/// pool: payout = stake * total / winning_pool. If nobody picked the winning
/// outcome, every staker is refunded their stake.
module sheka_market::market;

use std::string::String;
use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::event;

// === Errors ===
const E_NOT_OPEN: u64 = 0;
const E_BAD_OUTCOME: u64 = 1;
const E_ZERO_STAKE: u64 = 2;
const E_WRONG_MARKET: u64 = 3;
const E_NOT_RESOLVED: u64 = 4;

// === Constants ===
const STATUS_OPEN: u8 = 0;
const STATUS_RESOLVED: u8 = 1;
const WINNER_UNSET: u8 = 255;
const NUM_OUTCOMES: u64 = 3;

// === Types ===

/// Capability held by the operator/resolver. Minted to the publisher in `init`.
public struct AdminCap has key, store {
    id: UID,
}

/// A parimutuel market over stake coin `T`. Shared so anyone can stake/claim.
public struct Market<phantom T> has key {
    id: UID,
    event_id: String,
    home: String,
    away: String,
    /// pools[0]=home, pools[1]=draw, pools[2]=away (in T base units)
    pools: vector<u64>,
    total: u64,
    status: u8,
    /// 0..2 once resolved, else WINNER_UNSET
    winner: u8,
    vault: Balance<T>,
}

/// An owned, transferable stake position. Selling it = selling the position.
public struct Position has key, store {
    id: UID,
    market_id: ID,
    outcome: u8,
    amount: u64,
}

// === Events ===
public struct MarketCreated has copy, drop { market_id: ID, event_id: String }
public struct Staked has copy, drop { market_id: ID, outcome: u8, amount: u64, by: address }
public struct MarketResolved has copy, drop { market_id: ID, winner: u8 }
public struct Claimed has copy, drop { market_id: ID, by: address, payout: u64 }

// === Init ===
fun init(ctx: &mut TxContext) {
    transfer::public_transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
}

// === Admin: create market ===
public fun create_market<T>(
    _admin: &AdminCap,
    event_id: String,
    home: String,
    away: String,
    ctx: &mut TxContext,
) {
    let market = Market<T> {
        id: object::new(ctx),
        event_id,
        home,
        away,
        pools: vector[0, 0, 0],
        total: 0,
        status: STATUS_OPEN,
        winner: WINNER_UNSET,
        vault: balance::zero<T>(),
    };
    event::emit(MarketCreated { market_id: object::id(&market), event_id: market.event_id });
    transfer::share_object(market);
}

// === Stake ===
public fun stake<T>(
    market: &mut Market<T>,
    outcome: u8,
    payment: Coin<T>,
    ctx: &mut TxContext,
) {
    assert!(market.status == STATUS_OPEN, E_NOT_OPEN);
    assert!((outcome as u64) < NUM_OUTCOMES, E_BAD_OUTCOME);
    let amount = coin::value(&payment);
    assert!(amount > 0, E_ZERO_STAKE);

    balance::join(&mut market.vault, coin::into_balance(payment));
    let pool = vector::borrow_mut(&mut market.pools, outcome as u64);
    *pool = *pool + amount;
    market.total = market.total + amount;

    let market_id = object::id(market);
    let position = Position { id: object::new(ctx), market_id, outcome, amount };
    event::emit(Staked { market_id, outcome, amount, by: ctx.sender() });
    transfer::public_transfer(position, ctx.sender());
}

// === Admin: resolve ===
public fun resolve<T>(
    _admin: &AdminCap,
    market: &mut Market<T>,
    winner: u8,
    _ctx: &mut TxContext,
) {
    assert!(market.status == STATUS_OPEN, E_NOT_OPEN);
    assert!((winner as u64) < NUM_OUTCOMES, E_BAD_OUTCOME);
    market.winner = winner;
    market.status = STATUS_RESOLVED;
    event::emit(MarketResolved { market_id: object::id(market), winner });
}

// === Claim ===
public fun claim<T>(market: &mut Market<T>, position: Position, ctx: &mut TxContext) {
    assert!(market.status == STATUS_RESOLVED, E_NOT_RESOLVED);
    assert!(position.market_id == object::id(market), E_WRONG_MARKET);

    let Position { id, market_id: _, outcome, amount } = position;
    object::delete(id);

    let winning_pool = *vector::borrow(&market.pools, market.winner as u64);
    let payout = if (winning_pool == 0) {
        // Nobody picked the winning outcome → refund every staker.
        amount
    } else if (outcome == market.winner) {
        mul_div(amount, market.total, winning_pool)
    } else {
        0
    };

    if (payout > 0) {
        let c = coin::take(&mut market.vault, payout, ctx);
        transfer::public_transfer(c, ctx.sender());
    };
    event::emit(Claimed { market_id: object::id(market), by: ctx.sender(), payout });
}

// === Views ===
public fun pools<T>(market: &Market<T>): vector<u64> { market.pools }
public fun total<T>(market: &Market<T>): u64 { market.total }
public fun status<T>(market: &Market<T>): u8 { market.status }
public fun winner<T>(market: &Market<T>): u8 { market.winner }

// === Helpers ===
fun mul_div(a: u64, b: u64, c: u64): u64 {
    (((a as u128) * (b as u128)) / (c as u128)) as u64
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }
