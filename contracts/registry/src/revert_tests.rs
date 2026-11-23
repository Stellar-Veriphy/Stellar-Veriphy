/// # Registry Contract — Revert and failure-path tests (#805)
///
/// Each test drives one failure through the public API and asserts the exact
/// `Error` returned, so revert reasons stay explicit and stable.
use crate::{Error, ProposalOperation, RegistryContract, RegistryContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, BytesN, Env, String,
};

fn hash(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

fn initialised(env: &Env) -> RegistryContractClient<'_> {
    env.mock_all_auths();
    let cid = env.register_contract(None, RegistryContract);
    let client = RegistryContractClient::new(env, &cid);
    let admin = Address::generate(env);
    let provenance = Address::generate(env);
    client.init(&admin, &provenance);
    client
}

#[test]
fn deprecating_a_hash_before_init_reverts_with_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let cid = env.register_contract(None, RegistryContract);
    let client = RegistryContractClient::new(&env, &cid);

    assert_eq!(
        client.try_deprecate_tee_hash(&hash(&env, 0x01)).err(),
        Some(Ok(Error::NotInitialized))
    );
}

#[test]
fn recording_a_result_before_init_reverts_with_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let cid = env.register_contract(None, RegistryContract);
    let client = RegistryContractClient::new(&env, &cid);

    assert_eq!(
        client
            .try_record_verification_result(&hash(&env, 0x02), &true)
            .err(),
        Some(Ok(Error::NotInitialized))
    );
}

#[test]
fn approving_an_unknown_proposal_reverts_with_proposal_not_found() {
    let env = Env::default();
    let client = initialised(&env);

    assert_eq!(
        client.try_approve_proposal(&404).err(),
        Some(Ok(Error::ProposalNotFound))
    );
}

#[test]
fn executing_without_enough_approvals_reverts_with_insufficient_approvals() {
    let env = Env::default();
    let client = initialised(&env);

    // The default multisig threshold is 1, and a fresh proposal has no approvals.
    let proposal_id = client
        .try_propose_operation(&ProposalOperation::AddTeeHash(hash(&env, 0x03)), &0)
        .unwrap()
        .unwrap();

    assert_eq!(
        client.try_execute_proposal(&proposal_id).err(),
        Some(Ok(Error::InsufficientApprovals))
    );
}

#[test]
fn executing_before_the_timelock_reverts_with_invalid_threshold() {
    // Pins the current code for a timelock that has not elapsed. The mapping to
    // InvalidThreshold is unusual, so changing it needs a deliberate decision.
    let env = Env::default();
    let client = initialised(&env);
    let proposal_id = client
        .try_propose_operation(&ProposalOperation::AddTeeHash(hash(&env, 0x04)), &100)
        .unwrap()
        .unwrap();
    client.try_approve_proposal(&proposal_id).unwrap().unwrap();

    assert_eq!(
        client.try_execute_proposal(&proposal_id).err(),
        Some(Ok(Error::InvalidThreshold))
    );
}

/// # Governance threshold simulation (#969)
///
/// Pure, deterministic simulation of the threshold logic used by
/// `execute_proposal`. No privileged contract calls are made: the harness
/// reuses [`crate::evaluate_threshold`] so simulated outcomes match on-chain
/// behaviour exactly.
mod governance_simulation {
    use crate::{evaluate_threshold, ThresholdOutcome};

    /// A fixed, reproducible voter set: (approvals, rejections, abstentions).
    const SCENARIOS: &[(u32, u32, u32)] = &[
        (0, 0, 0),
        (1, 0, 0),
        (2, 1, 0),
        (3, 1, 0),
        (2, 2, 0),
        (2, 0, 3),
        (1, 1, 1),
    ];

    #[test]
    fn simple_majority_scenarios_are_reproducible() {
        // threshold = 1 approval, no quorum, no supermajority.
        let outcomes: [ThresholdOutcome; 7] = [
            evaluate_threshold(0, 0, 0, 1, 0, 0),
            evaluate_threshold(1, 0, 0, 1, 0, 0),
            evaluate_threshold(2, 1, 0, 1, 0, 0),
            evaluate_threshold(3, 1, 0, 1, 0, 0),
            evaluate_threshold(2, 2, 0, 1, 0, 0),
            evaluate_threshold(2, 0, 3, 1, 0, 0),
            evaluate_threshold(1, 1, 1, 1, 0, 0),
        ];
        let expected = [
            ThresholdOutcome::InsufficientApprovals,
            ThresholdOutcome::Passed,
            ThresholdOutcome::Passed,
            ThresholdOutcome::Passed,
            ThresholdOutcome::Passed,
            ThresholdOutcome::Passed,
            ThresholdOutcome::Passed,
        ];
        assert_eq!(outcomes, expected);
    }

    #[test]
    fn supermajority_scenarios_are_reproducible() {
        // Require 2/3 of cast votes (approvals + rejections) to approve.
        let outcomes: [ThresholdOutcome; 7] = [
            evaluate_threshold(0, 0, 0, 1, 0, 2),
            evaluate_threshold(1, 0, 0, 1, 0, 2),
            evaluate_threshold(2, 1, 0, 1, 0, 2),
            evaluate_threshold(3, 1, 0, 1, 0, 2),
            evaluate_threshold(2, 2, 0, 1, 0, 2),
            evaluate_threshold(2, 0, 3, 1, 0, 2),
            evaluate_threshold(1, 1, 1, 1, 0, 2),
        ];
        let expected = [
            ThresholdOutcome::InsufficientApprovals,
            ThresholdOutcome::Passed,
            ThresholdOutcome::Passed,
            ThresholdOutcome::Passed,
            ThresholdOutcome::Rejected,
            ThresholdOutcome::Passed,
            ThresholdOutcome::Rejected,
        ];
        assert_eq!(outcomes, expected);
    }

    #[test]
    fn quorum_with_abstentions_is_reproducible() {
        // Quorum of 3 total participants; abstentions count toward quorum.
        let outcomes: [ThresholdOutcome; 7] = [
            evaluate_threshold(0, 0, 0, 1, 3, 0),
            evaluate_threshold(1, 0, 0, 1, 3, 0),
            evaluate_threshold(2, 1, 0, 1, 3, 0),
            evaluate_threshold(3, 1, 0, 1, 3, 0),
            evaluate_threshold(2, 2, 0, 1, 3, 0),
            evaluate_threshold(2, 0, 3, 1, 3, 0),
            evaluate_threshold(1, 1, 1, 1, 3, 0),
        ];
        let expected = [
            ThresholdOutcome::QuorumNotMet,
            ThresholdOutcome::QuorumNotMet,
            ThresholdOutcome::QuorumNotMet,
            ThresholdOutcome::Passed,
            ThresholdOutcome::Passed,
            ThresholdOutcome::Passed,
            ThresholdOutcome::QuorumNotMet,
        ];
        assert_eq!(outcomes, expected);
    }

    #[test]
    fn ties_are_rejected() {
        // Equal approvals and rejections never pass, even with quorum met.
        assert_eq!(
            evaluate_threshold(1, 1, 0, 1, 0, 0),
            ThresholdOutcome::Rejected
        );
        assert_eq!(
            evaluate_threshold(2, 2, 0, 1, 0, 2),
            ThresholdOutcome::Rejected
        );
    }

    #[test]
    fn insufficient_participation_is_reported() {
        assert_eq!(
            evaluate_threshold(0, 0, 0, 1, 3, 0),
            ThresholdOutcome::QuorumNotMet
        );
        assert_eq!(
            evaluate_threshold(0, 0, 0, 1, 0, 0),
            ThresholdOutcome::InsufficientApprovals
        );
    }

    #[test]
    fn simulation_is_deterministic_across_runs() {
        for &(approvals, rejections, abstentions) in SCENARIOS {
            let first = evaluate_threshold(approvals, rejections, abstentions, 1, 0, 2);
            let second = evaluate_threshold(approvals, rejections, abstentions, 1, 0, 2);
            assert_eq!(first, second);
        }
    }
}

#[test]
fn validating_an_expired_certificate_reverts_with_certificate_expired() {
    let env = Env::default();
    let client = initialised(&env);
    let code_hash = hash(&env, 0x05);
    client.add_tee_hash(&code_hash);

    // The certificate was valid until ledger time 500, and it is now 1000.
    client
        .try_attach_cert_ref(
            &code_hash,
            &String::from_str(&env, "issuer"),
            &0u64,
            &500u64,
            &None,
        )
        .unwrap()
        .unwrap();
    env.ledger().set_timestamp(1000);

    assert_eq!(
        client.try_validate_cert_expiration(&code_hash).err(),
        Some(Ok(Error::CertificateExpired))
    );
}
