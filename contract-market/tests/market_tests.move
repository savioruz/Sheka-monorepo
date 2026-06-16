#[test_only]
module sheka_market::market_tests;

use std::string;
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::test_scenario::{Self as ts};
use sheka_market::market::{Self, Market, Position, AdminCap};

const ADMIN: address = @0xA;
const ALICE: address = @0xA11CE;
const BOB: address = @0xB0B;
const CAROL: address = @0xCA201;

fun new_market(sc: &mut ts::Scenario): AdminCap {
    market::init_for_testing(ts::ctx(sc));
    ts::next_tx(sc, ADMIN);
    let admin = ts::take_from_sender<AdminCap>(sc);
    market::create_market<SUI>(
        &admin,
        string::utf8(b"evt1"),
        string::utf8(b"GER"),
        string::utf8(b"ENG"),
        ts::ctx(sc),
    );
    admin
}

fun stake_as(sc: &mut ts::Scenario, who: address, m: &mut Market<SUI>, outcome: u8, amount: u64) {
    ts::next_tx(sc, who);
    let c = coin::mint_for_testing<SUI>(amount, ts::ctx(sc));
    market::stake<SUI>(m, outcome, c, ts::ctx(sc));
}

fun claim_as(sc: &mut ts::Scenario, who: address, m: &mut Market<SUI>): u64 {
    ts::next_tx(sc, who);
    let pos = ts::take_from_sender<Position>(sc);
    market::claim<SUI>(m, pos, ts::ctx(sc));
    ts::next_tx(sc, who);
    if (ts::has_most_recent_for_sender<Coin<SUI>>(sc)) {
        let paid = ts::take_from_sender<Coin<SUI>>(sc);
        let v = coin::value(&paid);
        coin::burn_for_testing(paid);
        v
    } else {
        0
    }
}

#[test]
fun test_payout_winner_and_loser() {
    let mut sc = ts::begin(ADMIN);
    let admin = new_market(&mut sc);

    ts::next_tx(&mut sc, ALICE);
    let mut m = ts::take_shared<Market<SUI>>(&sc);

    stake_as(&mut sc, ALICE, &mut m, 0, 100); // HOME
    stake_as(&mut sc, BOB, &mut m, 2, 50); // AWAY
    assert!(market::total(&m) == 150, 0);

    ts::next_tx(&mut sc, ADMIN);
    market::resolve<SUI>(&admin, &mut m, 0, ts::ctx(&mut sc)); // HOME wins

    assert!(claim_as(&mut sc, ALICE, &mut m) == 150, 1); // 100 * 150 / 100
    assert!(claim_as(&mut sc, BOB, &mut m) == 0, 2); // loser

    ts::return_shared(m);
    ts::next_tx(&mut sc, ADMIN);
    ts::return_to_sender(&sc, admin);
    ts::end(sc);
}

#[test]
fun test_proportional_split() {
    let mut sc = ts::begin(ADMIN);
    let admin = new_market(&mut sc);

    ts::next_tx(&mut sc, ALICE);
    let mut m = ts::take_shared<Market<SUI>>(&sc);

    stake_as(&mut sc, ALICE, &mut m, 0, 60); // HOME
    stake_as(&mut sc, BOB, &mut m, 0, 40); // HOME
    stake_as(&mut sc, CAROL, &mut m, 2, 100); // AWAY → total 200, home pool 100

    ts::next_tx(&mut sc, ADMIN);
    market::resolve<SUI>(&admin, &mut m, 0, ts::ctx(&mut sc));

    assert!(claim_as(&mut sc, ALICE, &mut m) == 120, 0); // 60 * 200 / 100
    assert!(claim_as(&mut sc, BOB, &mut m) == 80, 1); // 40 * 200 / 100
    assert!(claim_as(&mut sc, CAROL, &mut m) == 0, 2);

    ts::return_shared(m);
    ts::next_tx(&mut sc, ADMIN);
    ts::return_to_sender(&sc, admin);
    ts::end(sc);
}

#[test]
fun test_refund_when_no_winners() {
    let mut sc = ts::begin(ADMIN);
    let admin = new_market(&mut sc);

    ts::next_tx(&mut sc, ALICE);
    let mut m = ts::take_shared<Market<SUI>>(&sc);

    stake_as(&mut sc, ALICE, &mut m, 0, 100); // HOME
    stake_as(&mut sc, BOB, &mut m, 2, 50); // AWAY

    ts::next_tx(&mut sc, ADMIN);
    market::resolve<SUI>(&admin, &mut m, 1, ts::ctx(&mut sc)); // DRAW wins, nobody picked it

    assert!(claim_as(&mut sc, ALICE, &mut m) == 100, 0); // refund
    assert!(claim_as(&mut sc, BOB, &mut m) == 50, 1); // refund

    ts::return_shared(m);
    ts::next_tx(&mut sc, ADMIN);
    ts::return_to_sender(&sc, admin);
    ts::end(sc);
}

#[test, expected_failure]
fun test_stake_after_resolve_aborts() {
    let mut sc = ts::begin(ADMIN);
    let admin = new_market(&mut sc);
    ts::next_tx(&mut sc, ALICE);
    let mut m = ts::take_shared<Market<SUI>>(&sc);
    ts::next_tx(&mut sc, ADMIN);
    market::resolve<SUI>(&admin, &mut m, 0, ts::ctx(&mut sc));
    stake_as(&mut sc, ALICE, &mut m, 0, 100); // aborts: not OPEN
    abort 0
}

#[test, expected_failure]
fun test_claim_before_resolve_aborts() {
    let mut sc = ts::begin(ADMIN);
    let admin = new_market(&mut sc);
    ts::next_tx(&mut sc, ALICE);
    let mut m = ts::take_shared<Market<SUI>>(&sc);
    stake_as(&mut sc, ALICE, &mut m, 0, 100);
    let _ = claim_as(&mut sc, ALICE, &mut m); // aborts: not resolved
    abort 0
}

#[test, expected_failure]
fun test_bad_outcome_aborts() {
    let mut sc = ts::begin(ADMIN);
    let admin = new_market(&mut sc);
    ts::next_tx(&mut sc, ALICE);
    let mut m = ts::take_shared<Market<SUI>>(&sc);
    stake_as(&mut sc, ALICE, &mut m, 5, 100); // outcome 5 invalid → abort
    abort 0
}
