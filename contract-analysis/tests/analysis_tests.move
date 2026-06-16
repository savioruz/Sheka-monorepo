#[test_only]
module sheka_analysis::analysis_tests;

use sui::coin::{Self, Coin};
use sui::object::id_to_bytes;
use sui::sui::SUI;
use sui::test_scenario::{Self as ts};
use sheka_analysis::analysis::{Self, AdminCap, Registry, Treasury, Quota, AnalysisReceipt};

const ADMIN: address = @0xA;
const ALICE: address = @0xA11CE;

fun setup(sc: &mut ts::Scenario): AdminCap {
    analysis::init_for_testing(ts::ctx(sc));
    ts::next_tx(sc, ADMIN);
    ts::take_from_sender<AdminCap>(sc)
}

#[test]
fun test_purchase_exact_and_change() {
    let mut sc = ts::begin(ADMIN);
    let admin = setup(&mut sc);

    ts::next_tx(&mut sc, ADMIN);
    let mut reg = ts::take_shared<Registry>(&sc);
    analysis::set_price(&admin, &mut reg, 1, 100);

    ts::next_tx(&mut sc, ALICE);
    let mut treasury = ts::take_shared<Treasury>(&sc);
    let payment = coin::mint_for_testing<SUI>(150, ts::ctx(&mut sc)); // overpay → 50 change
    analysis::purchase(&reg, &mut treasury, payment, 1, ts::ctx(&mut sc));
    assert!(analysis::treasury_value(&treasury) == 100, 0);

    ts::next_tx(&mut sc, ALICE);
    let change = ts::take_from_sender<Coin<SUI>>(&sc);
    assert!(coin::value(&change) == 50, 1);
    coin::burn_for_testing(change);
    let receipt = ts::take_from_sender<AnalysisReceipt>(&sc);
    ts::return_to_sender(&sc, receipt);

    ts::return_shared(reg);
    ts::return_shared(treasury);
    ts::next_tx(&mut sc, ADMIN);
    ts::return_to_sender(&sc, admin);
    ts::end(sc);
}

#[test, expected_failure]
fun test_underpay_aborts() {
    let mut sc = ts::begin(ADMIN);
    let admin = setup(&mut sc);
    ts::next_tx(&mut sc, ADMIN);
    let mut reg = ts::take_shared<Registry>(&sc);
    analysis::set_price(&admin, &mut reg, 1, 100);
    ts::next_tx(&mut sc, ALICE);
    let mut treasury = ts::take_shared<Treasury>(&sc);
    let payment = coin::mint_for_testing<SUI>(50, ts::ctx(&mut sc)); // < 100
    analysis::purchase(&reg, &mut treasury, payment, 1, ts::ctx(&mut sc));
    abort 0
}

#[test, expected_failure]
fun test_price_unset_aborts() {
    let mut sc = ts::begin(ADMIN);
    let _admin = setup(&mut sc);
    ts::next_tx(&mut sc, ALICE);
    let reg = ts::take_shared<Registry>(&sc);
    let mut treasury = ts::take_shared<Treasury>(&sc);
    let payment = coin::mint_for_testing<SUI>(100, ts::ctx(&mut sc));
    analysis::purchase(&reg, &mut treasury, payment, 99, ts::ctx(&mut sc)); // model 99 has no price
    abort 0
}

#[test]
fun test_free_three_ok() {
    let mut sc = ts::begin(ADMIN);
    let admin = setup(&mut sc);
    ts::next_tx(&mut sc, ALICE);
    let mut q = ts::take_shared<Quota>(&sc);
    analysis::claim_free(&mut q, 0, ts::ctx(&mut sc));
    ts::next_tx(&mut sc, ALICE);
    analysis::claim_free(&mut q, 0, ts::ctx(&mut sc));
    ts::next_tx(&mut sc, ALICE);
    analysis::claim_free(&mut q, 0, ts::ctx(&mut sc));
    assert!(analysis::free_used(&q, ALICE) == 3, 0);
    ts::return_shared(q);
    ts::next_tx(&mut sc, ADMIN);
    ts::return_to_sender(&sc, admin);
    ts::end(sc);
}

#[test, expected_failure]
fun test_free_fourth_aborts() {
    let mut sc = ts::begin(ADMIN);
    let _admin = setup(&mut sc);
    ts::next_tx(&mut sc, ALICE);
    let mut q = ts::take_shared<Quota>(&sc);
    let mut i = 0;
    while (i < 4) {
        ts::next_tx(&mut sc, ALICE);
        analysis::claim_free(&mut q, 0, ts::ctx(&mut sc)); // 4th aborts
        i = i + 1;
    };
    abort 0
}

#[test, expected_failure]
fun test_free_non_auto_aborts() {
    let mut sc = ts::begin(ADMIN);
    let _admin = setup(&mut sc);
    ts::next_tx(&mut sc, ALICE);
    let mut q = ts::take_shared<Quota>(&sc);
    analysis::claim_free(&mut q, 5, ts::ctx(&mut sc)); // model 5 not free
    abort 0
}

#[test]
fun test_seal_approve_owner_ok() {
    let mut sc = ts::begin(ADMIN);
    let admin = setup(&mut sc);
    ts::next_tx(&mut sc, ALICE);
    let mut q = ts::take_shared<Quota>(&sc);
    analysis::claim_free(&mut q, 0, ts::ctx(&mut sc));
    ts::next_tx(&mut sc, ALICE);
    let receipt = ts::take_from_sender<AnalysisReceipt>(&sc);
    let id_bytes = id_to_bytes(&object::id(&receipt));
    analysis::seal_approve(id_bytes, &receipt); // matching id → ok
    ts::return_to_sender(&sc, receipt);
    ts::return_shared(q);
    ts::next_tx(&mut sc, ADMIN);
    ts::return_to_sender(&sc, admin);
    ts::end(sc);
}

#[test, expected_failure]
fun test_seal_approve_wrong_id_aborts() {
    let mut sc = ts::begin(ADMIN);
    let _admin = setup(&mut sc);
    ts::next_tx(&mut sc, ALICE);
    let mut q = ts::take_shared<Quota>(&sc);
    analysis::claim_free(&mut q, 0, ts::ctx(&mut sc));
    ts::next_tx(&mut sc, ALICE);
    let receipt = ts::take_from_sender<AnalysisReceipt>(&sc);
    analysis::seal_approve(b"not-the-right-id", &receipt); // wrong id → abort
    abort 0
}
