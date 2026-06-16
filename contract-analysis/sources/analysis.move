/// Sheka — paid, model-selectable AI analysis access.
///
/// Prices per model live on-chain (`Registry`, admin-set) so a buyer can never
/// underpay. `purchase` charges exactly the model price in SUI into a `Treasury`
/// and mints an owned `AnalysisReceipt`. New wallets get `free_limit` free runs on
/// the Auto model via `claim_free`, enforced on-chain by a per-wallet `Quota`
/// counter. The `AnalysisReceipt` is the access key for the Seal-encrypted result
/// (`seal_approve` only passes for its owner) and is transferable (resellable).
module sheka_analysis::analysis;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::event;
use sui::object::id_to_bytes;
use sui::sui::SUI;
use sui::table::{Self, Table};

// === Errors ===
const E_PRICE_UNSET: u64 = 0;
const E_UNDERPAID: u64 = 1;
const E_NOT_FREE_MODEL: u64 = 2;
const E_FREE_LIMIT: u64 = 3;
const E_WRONG_RECEIPT: u64 = 4;

// === Constants ===
const AUTO_MODEL_ID: u64 = 0;
const DEFAULT_FREE_LIMIT: u64 = 3;

// === Types ===
public struct AdminCap has key, store {
    id: UID,
}

public struct Registry has key {
    id: UID,
    prices: Table<u64, u64>, // model_id -> price (MIST)
}

public struct Treasury has key {
    id: UID,
    balance: Balance<SUI>,
}

public struct Quota has key {
    id: UID,
    used: Table<address, u64>,
    free_limit: u64,
}

/// Owned, transferable proof of paid (or free) access to one analysis.
public struct AnalysisReceipt has key, store {
    id: UID,
    buyer: address,
    model_id: u64,
    amount: u64,
    paid: bool,
}

// === Events ===
public struct AnalysisPurchased has copy, drop {
    buyer: address,
    model_id: u64,
    receipt_id: ID,
    amount: u64,
}
public struct FreeClaimed has copy, drop {
    buyer: address,
    receipt_id: ID,
    remaining: u64,
}

// === Init ===
fun init(ctx: &mut TxContext) {
    transfer::public_transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
    transfer::share_object(Registry { id: object::new(ctx), prices: table::new(ctx) });
    transfer::share_object(Treasury { id: object::new(ctx), balance: balance::zero<SUI>() });
    transfer::share_object(Quota {
        id: object::new(ctx),
        used: table::new(ctx),
        free_limit: DEFAULT_FREE_LIMIT,
    });
}

// === Admin ===
public fun set_price(_admin: &AdminCap, reg: &mut Registry, model_id: u64, price: u64) {
    if (table::contains(&reg.prices, model_id)) {
        *table::borrow_mut(&mut reg.prices, model_id) = price;
    } else {
        table::add(&mut reg.prices, model_id, price);
    }
}

public fun remove_price(_admin: &AdminCap, reg: &mut Registry, model_id: u64) {
    if (table::contains(&reg.prices, model_id)) {
        table::remove(&mut reg.prices, model_id);
    };
}

public fun set_free_limit(_admin: &AdminCap, q: &mut Quota, limit: u64) {
    q.free_limit = limit;
}

public fun withdraw(
    _admin: &AdminCap,
    t: &mut Treasury,
    amount: u64,
    ctx: &mut TxContext,
): Coin<SUI> {
    coin::take(&mut t.balance, amount, ctx)
}

// === Views ===
public fun price(reg: &Registry, model_id: u64): u64 {
    assert!(table::contains(&reg.prices, model_id), E_PRICE_UNSET);
    *table::borrow(&reg.prices, model_id)
}

public fun free_used(q: &Quota, who: address): u64 {
    if (table::contains(&q.used, who)) *table::borrow(&q.used, who) else 0
}

public fun free_limit(q: &Quota): u64 {
    q.free_limit
}

public fun treasury_value(t: &Treasury): u64 {
    balance::value(&t.balance)
}

// === Purchase (paid) ===
public fun purchase(
    reg: &Registry,
    treasury: &mut Treasury,
    mut payment: Coin<SUI>,
    model_id: u64,
    ctx: &mut TxContext,
) {
    let p = price(reg, model_id);
    assert!(coin::value(&payment) >= p, E_UNDERPAID);

    let paid = coin::split(&mut payment, p, ctx);
    balance::join(&mut treasury.balance, coin::into_balance(paid));

    // Return change (or destroy an exact-zero remainder).
    if (coin::value(&payment) == 0) {
        coin::destroy_zero(payment);
    } else {
        transfer::public_transfer(payment, ctx.sender());
    };

    let receipt = AnalysisReceipt {
        id: object::new(ctx),
        buyer: ctx.sender(),
        model_id,
        amount: p,
        paid: true,
    };
    event::emit(AnalysisPurchased {
        buyer: ctx.sender(),
        model_id,
        receipt_id: object::id(&receipt),
        amount: p,
    });
    transfer::public_transfer(receipt, ctx.sender());
}

// === Free claim (Auto model, on-chain quota) ===
public fun claim_free(q: &mut Quota, model_id: u64, ctx: &mut TxContext) {
    assert!(model_id == AUTO_MODEL_ID, E_NOT_FREE_MODEL);
    let sender = ctx.sender();
    let used = free_used(q, sender);
    assert!(used < q.free_limit, E_FREE_LIMIT);

    if (table::contains(&q.used, sender)) {
        *table::borrow_mut(&mut q.used, sender) = used + 1;
    } else {
        table::add(&mut q.used, sender, used + 1);
    };

    let receipt = AnalysisReceipt {
        id: object::new(ctx),
        buyer: sender,
        model_id,
        amount: 0,
        paid: false,
    };
    event::emit(FreeClaimed {
        buyer: sender,
        receipt_id: object::id(&receipt),
        remaining: q.free_limit - (used + 1),
    });
    transfer::public_transfer(receipt, sender);
}

// === Seal decryption policy ===
/// Passes only when `id` equals the receipt's object id — i.e. the caller owns
/// the receipt for that analysis. Used by Seal key servers to gate decryption.
public fun seal_approve(id: vector<u8>, receipt: &AnalysisReceipt) {
    assert!(id == id_to_bytes(&object::id(receipt)), E_WRONG_RECEIPT);
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) {
    init(ctx)
}
