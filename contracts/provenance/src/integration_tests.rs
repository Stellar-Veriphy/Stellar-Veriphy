/// # Provenance Contract — Integration Tests (#654)
///
/// Covers the main invocation paths: mint, get, revoke, transfer, rollback,
/// and lock. Validates storage mutations and event emission at each step.
#[cfg(test)]
mod provenance_integration_tests {
    extern crate std;
    use std::format;
    use std::string::ToString;

    use crate::{
        CertificateRollbackRecord, ProvenanceContract, ProvenanceContractClient, ProvenanceError,
        RevocationReason, RollbackReason,
    };
    use soroban_sdk::{
        testutils::{Address as _, Events, Ledger as _},
        Address, Env, String,
    };

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn make_env() -> Env {
        Env::default()
    }

    fn s(env: &Env, v: &str) -> String {
        String::from_str(env, v)
    }

    /// Deploy a fresh contract and return (contract_id, oracle_address).
    fn setup(env: &Env) -> (Address, Address) {
        env.mock_all_auths();
        let cid = env.register_contract(None, ProvenanceContract);
        let oracle = Address::generate(env);
        let client = ProvenanceContractClient::new(env, &cid);
        client.initialize(&oracle);
        (cid, oracle)
    }

    /// Mint one certificate, returns the certificate id.
    fn mint_one(
        env: &Env,
        client: &ProvenanceContractClient,
        suffix: &str,
        owner: &Address,
    ) -> u64 {
        client.mint(
            &s(env, &format!("ipfs://Qm{suffix}")),
            &s(env, &format!("manifest_{suffix}")),
            &s(env, &format!("attestation_{suffix}")),
            owner,
        )
    }

    // -----------------------------------------------------------------------
    // Mint — happy path
    // -----------------------------------------------------------------------

    #[test]
    fn test_mint_creates_certificate_with_correct_fields() {
        let env = make_env();
        let (cid, _oracle) = setup(&env);
        let client = ProvenanceContractClient::new(&env, &cid);
        let owner = Address::generate(&env);

        let id = mint_one(&env, &client, "abc", &owner);

        let cert = client.get(&id);
        assert_eq!(cert.creator, owner);
        assert!(!cert.revoked);
        assert_eq!(cert.manifest_hash, s(&env, "manifest_abc"));
        assert_eq!(cert.attestation_hash, s(&env, "attestation_abc"));
    }

    // -----------------------------------------------------------------------
    // Mint — duplicate rejection
    // -----------------------------------------------------------------------

    #[test]
    fn test_mint_rejects_duplicate_manifest_hash() {
        let env = make_env();
        let (cid, _oracle) = setup(&env);
        let client = ProvenanceContractClient::new(&env, &cid);
        let owner = Address::generate(&env);

        // First mint succeeds
        mint_one(&env, &client, "dup", &owner);

        // Second mint with the same manifest hash must fail
        let result = client.try_mint(
            &s(&env, "ipfs://QmDup"),
            &s(&env, "manifest_dup"), // same hash
            &s(&env, "attestation_dup2"),
            &owner,
        );
        assert!(result.is_err(), "duplicate manifest hash must be rejected");
    }

    // -----------------------------------------------------------------------
    // Mint — auto-incrementing IDs
    // -----------------------------------------------------------------------

    #[test]
    fn test_mint_ids_are_monotonically_increasing() {
        let env = make_env();
        let (cid, _oracle) = setup(&env);
        let client = ProvenanceContractClient::new(&env, &cid);
        let owner = Address::generate(&env);

        let mut last = 0u64;
        for i in 0..5u8 {
            let id = mint_one(&env, &client, &i.to_string(), &owner);
            assert!(id > last, "id {id} must exceed previous id {last}");
            last = id;
        }
    }

    // -----------------------------------------------------------------------
    // Revoke — state transition
    // -----------------------------------------------------------------------

    #[test]
    fn test_revoke_sets_revoked_flag_and_reason() {
        let env = make_env();
        let (cid, _oracle) = setup(&env);
        let client = ProvenanceContractClient::new(&env, &cid);
        let owner = Address::generate(&env);

        let id = mint_one(&env, &client, "rev", &owner);

        client.revoke_certificate(&id, &RevocationReason::FraudulentContent);

        let cert = client.get(&id);
        assert!(cert.revoked, "certificate must be revoked");
        assert_eq!(cert.revocation_reason, RevocationReason::FraudulentContent);
        assert!(
            cert.revocation_timestamp.is_some(),
            "revocation timestamp must be set"
        );
    }

    // -----------------------------------------------------------------------
    // Revoke — cannot revoke twice
    // -----------------------------------------------------------------------

    #[test]
    fn test_revoke_already_revoked_returns_error() {
        let env = make_env();
        let (cid, _oracle) = setup(&env);
        let client = ProvenanceContractClient::new(&env, &cid);
        let owner = Address::generate(&env);

        let id = mint_one(&env, &client, "rev2", &owner);
        client.revoke_certificate(&id, &RevocationReason::LegalRequirement);

        let second = client.try_revoke_certificate(&id, &RevocationReason::CreatorRequest);
        assert!(
            second.is_err(),
            "revoking an already-revoked cert must fail"
        );
    }

    // -----------------------------------------------------------------------
    // Transfer — ownership change persisted
    // -----------------------------------------------------------------------

    #[test]
    fn test_transfer_certificate_updates_owner() {
        let env = make_env();
        let (cid, _oracle) = setup(&env);
        let client = ProvenanceContractClient::new(&env, &cid);
        let original_owner = Address::generate(&env);
        let new_owner = Address::generate(&env);

        let id = mint_one(&env, &client, "xfr", &original_owner);

        client.transfer_certificate(&id, &new_owner);

        let owner_after = client.get_owner(&id);
        assert_eq!(
            owner_after, new_owner,
            "owner must be updated after transfer"
        );
    }

    // -----------------------------------------------------------------------
    // Lock — certificate cannot be modified after locking
    // -----------------------------------------------------------------------

    #[test]
    fn test_lock_certificate_prevents_further_changes() {
        let env = make_env();
        let (cid, _oracle) = setup(&env);
        let client = ProvenanceContractClient::new(&env, &cid);
        let owner = Address::generate(&env);

        let id = mint_one(&env, &client, "lock", &owner);
        client.lock_certificate(&id);

        let cert = client.get(&id);
        assert!(cert.locked, "certificate must be marked locked");

        // Attempting to revoke a locked cert should fail
        let result = client.try_revoke_certificate(&id, &RevocationReason::CreatorRequest);
        assert!(result.is_err(), "locked certificate must reject revocation");
    }

    // -----------------------------------------------------------------------
    // Rollback record (#658) — record_rollback stores history
    // -----------------------------------------------------------------------

    #[test]
    fn test_record_rollback_appends_to_history() {
        let env = make_env();
        let (cid, _oracle) = setup(&env);
        let client = ProvenanceContractClient::new(&env, &cid);
        let owner = Address::generate(&env);
        let initiator = Address::generate(&env);

        let id = mint_one(&env, &client, "rb", &owner);

        // Record two rollbacks
        let rollback_id_1 = client.record_rollback(
            &id,
            &s(&env, "manifest_rb"),
            &s(&env, "manifest_rb_v0"),
            &initiator,
            &RollbackReason::IncorrectAttestation,
        );
        let rollback_id_2 = client.record_rollback(
            &id,
            &s(&env, "manifest_rb_v0"),
            &s(&env, "manifest_rb"),
            &initiator,
            &RollbackReason::CreatorRequest,
        );

        assert!(
            rollback_id_2 > rollback_id_1,
            "rollback ids must be monotonic"
        );

        let history = client.get_rollback_history(&id);
        assert_eq!(history.len(), 2, "both rollback records must be stored");

        let first: CertificateRollbackRecord = history.get(0).unwrap();
        assert_eq!(first.certificate_id, id);
        assert_eq!(first.reason, RollbackReason::IncorrectAttestation);
    }

    // -----------------------------------------------------------------------
    // Events — mint emits an event
    // -----------------------------------------------------------------------

    #[test]
    fn test_mint_emits_minted_event() {
        let env = make_env();
        let (cid, _oracle) = setup(&env);
        let client = ProvenanceContractClient::new(&env, &cid);
        let owner = Address::generate(&env);

        mint_one(&env, &client, "ev", &owner);

        let events = env.events().all();
        assert!(!events.is_empty(), "mint must emit at least one event");
    }

    // -----------------------------------------------------------------------
    // Storage integrity — get returns NotFound for missing id
    // -----------------------------------------------------------------------

    #[test]
    fn test_get_nonexistent_certificate_returns_error() {
        let env = make_env();
        let (cid, _oracle) = setup(&env);
        let client = ProvenanceContractClient::new(&env, &cid);

        let result = client.try_get(&9999u64);
        assert!(
            result.is_err(),
            "getting a nonexistent certificate must return an error"
        );
    }
}

/// # Provenance Contract — Witness Verification Tests (#967)
///
/// Covers cryptographic witness verification for attestations:
/// - Attestations are accepted only with a valid witness signature from a
///   trusted key.
/// - Invalid signatures are rejected with a typed error.
/// - Unknown (untrusted) keys are rejected.
/// - Key rotation is honoured (old keys stop being trusted).
/// - Verification failures are auditable via a typed error and a failure event.
///
/// ## Trusted key configuration
///
/// Trusted witness keys are configured by the oracle (the address passed to
/// `initialize`) via `add_trusted_witness_key` / `remove_trusted_witness_key`.
/// Only keys present in the trusted set at verification time are accepted.
/// Rotating a key means removing the old key and adding the new one; any
/// attestation signed by a removed key is rejected.
#[cfg(test)]
mod witness_verification_tests {
    extern crate std;
    use std::format;
    use std::string::ToString;

    use crate::{
        ProvenanceContract, ProvenanceContractClient, ProvenanceError, WitnessVerificationFailure,
    };
    use soroban_sdk::{
        testutils::{Address as _, Events},
        Address, Bytes, Env, String,
    };

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn make_env() -> Env {
        Env::default()
    }

    fn s(env: &Env, v: &str) -> String {
        String::from_str(env, v)
    }

    fn b(env: &Env, v: &[u8]) -> Bytes {
        Bytes::from_slice(env, v)
    }

    /// Deploy a fresh contract and return (contract_id, oracle_address).
    fn setup(env: &Env) -> (Address, Address) {
        env.mock_all_auths();
        let cid = env.register_contract(None, ProvenanceContract);
        let oracle = Address::generate(env);
        let client = ProvenanceContractClient::new(env, &cid);
        client.initialize(&oracle);
        (cid, oracle)
    }

    /// Mint one certificate, returns the certificate id.
    fn mint_one(
        env: &Env,
        client: &ProvenanceContractClient,
        suffix: &str,
        owner: &Address,
    ) -> u64 {
        client.mint(
            &s(env, &format!("ipfs://Qm{suffix}")),
            &s(env, &format!("manifest_{suffix}")),
            &s(env, &format!("attestation_{suffix}")),
            owner,
        )
    }

    // -----------------------------------------------------------------------
    // Valid witness signature is accepted
    // -----------------------------------------------------------------------

    #[test]
    fn test_attestation_accepted_with_valid_witness_signature() {
        let env = make_env();
        let (cid, _oracle) = setup(&env);
        let client = ProvenanceContractClient::new(&env, &cid);
        let owner = Address::generate(&env);
        let witness = Address::generate(&env);

        // Configure the trusted witness key.
        client.add_trusted_witness_key(&witness);

        let id = mint_one(&env, &client, "wv", &owner);

        let attestation = s(&env, "attestation_wv");
        let signature = b(&env, b"valid-signature");

        // Verification must succeed for a trusted key with a valid signature.
        let ok = client.verify_witness(&id, &attestation, &witness, &signature);
        assert!(ok, "valid witness signature must be accepted");
    }

    // -----------------------------------------------------------------------
    // Invalid signature is rejected with a typed error
    // -----------------------------------------------------------------------

    #[test]
    fn test_invalid_signature_rejected_with_typed_error() {
        let env = make_env();
        let (cid, _oracle) = setup(&env);
        let client = ProvenanceContractClient::new(&env, &cid);
        let owner = Address::generate(&env);
        let witness = Address::generate(&env);

        client.add_trusted_witness_key(&witness);
        let id = mint_one(&env, &client, "bad", &owner);

        let attestation = s(&env, "attestation_bad");
        // Empty signature is treated as invalid.
        let bad_signature = b(&env, b"");

        let result = client.try_verify_witness(&id, &attestation, &witness, &bad_signature);
        assert!(result.is_err(), "invalid signature must be rejected");
        match result {
            Err(Ok(err)) => assert_eq!(
                err,
                ProvenanceError::InvalidWitnessSignature,
                "invalid signature must map to InvalidWitnessSignature"
            ),
            _ => panic!("expected typed InvalidWitnessSignature error"),
        }
    }

    // -----------------------------------------------------------------------
    // Unknown key is rejected
    // -----------------------------------------------------------------------

    #[test]
    fn test_unknown_witness_key_rejected() {
        let env = make_env();
        let (cid, _oracle) = setup(&env);
        let client = ProvenanceContractClient::new(&env, &cid);
        let owner = Address::generate(&env);
        let trusted = Address::generate(&env);
        let unknown = Address::generate(&env);

        client.add_trusted_witness_key(&trusted);
        let id = mint_one(&env, &client, "unk", &owner);

        let attestation = s(&env, "attestation_unk");
        let signature = b(&env, b"valid-signature");

        let result = client.try_verify_witness(&id, &attestation, &unknown, &signature);
        assert!(result.is_err(), "unknown witness key must be rejected");
        match result {
            Err(Ok(err)) => assert_eq!(
                err,
                ProvenanceError::UntrustedWitnessKey,
                "unknown key must map to UntrustedWitnessKey"
            ),
            _ => panic!("expected typed UntrustedWitnessKey error"),
        }
    }

    // -----------------------------------------------------------------------
    // Key rotation — removed key is no longer trusted
    // -----------------------------------------------------------------------

    #[test]
    fn test_key_rotation_invalidates_old_key() {
        let env = make_env();
        let (cid, _oracle) = setup(&env);
        let client = ProvenanceContractClient::new(&env, &cid);
        let owner = Address::generate(&env);
        let old_key = Address::generate(&env);
        let new_key = Address::generate(&env);

        // Initially trust the old key.
        client.add_trusted_witness_key(&old_key);
        let id = mint_one(&env, &client, "rot", &owner);
        let attestation = s(&env, "attestation_rot");
        let signature = b(&env, b"valid-signature");

        assert!(
            client.verify_witness(&id, &attestation, &old_key, &signature),
            "old key must be accepted before rotation"
        );

        // Rotate: remove old key, add new key.
        client.remove_trusted_witness_key(&old_key);
        client.add_trusted_witness_key(&new_key);

        // Old key is now rejected.
        let old_result = client.try_verify_witness(&id, &attestation, &old_key, &signature);
        assert!(old_result.is_err(), "rotated-out key must be rejected");

        // New key is accepted.
        assert!(
            client.verify_witness(&id, &attestation, &new_key, &signature),
            "new key must be accepted after rotation"
        );
    }

    // -----------------------------------------------------------------------
    // Verification failures are auditable
    // -----------------------------------------------------------------------

    #[test]
    fn test_verification_failure_is_auditable() {
        let env = make_env();
        let (cid, _oracle) = setup(&env);
        let client = ProvenanceContractClient::new(&env, &cid);
        let owner = Address::generate(&env);
        let witness = Address::generate(&env);

        client.add_trusted_witness_key(&witness);
        let id = mint_one(&env, &client, "aud", &owner);

        let attestation = s(&env, "attestation_aud");
        let bad_signature = b(&env, b"");

        // Trigger a verification failure.
        let result = client.try_verify_witness(&id, &attestation, &witness, &bad_signature);
        assert!(result.is_err(), "invalid signature must be rejected");

        // A failure event must have been emitted for auditability.
        let events = env.events().all();
        let mut found_failure = false;
        for (_, topics, data) in events.iter() {
            // The failure event carries the WitnessVerificationFailure payload.
            if let Ok(failure) =
                <WitnessVerificationFailure as soroban_sdk::TryFromVal<Env, _>>::try_from_val(
                    &env, &data,
                )
            {
                if failure.certificate_id == id {
                    found_failure = true;
                }
            }
            let _ = topics;
        }
        assert!(
            found_failure,
            "verification failure must emit an auditable event"
        );
    }
}
