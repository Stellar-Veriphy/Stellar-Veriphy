#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, storage::Temporary as _},
    Env, Bytes, BytesN,
};

fn make_env() -> Env {
    Env::default()
}

fn register_oracle(env: &Env) -> Address {
    env.register_contract(None, OracleContract)
}

fn hash32(env: &Env, n: u8) -> BytesN<32> {
    BytesN::from_array(env, &[n; 32])
}

mod mock_registry {
    use soroban_sdk::{contract, contractimpl, BytesN, Env};

    #[contract]
    pub struct MockRegistry;

    #[contractimpl]
    impl MockRegistry {
        pub fn is_tee_hash_approved(env: Env, tee_hash: BytesN<32>) -> bool {
            tee_hash == BytesN::from_array(&env, &[1u8; 32])
        }

        pub fn is_provider(_env: Env, _provider: BytesN<32>) -> bool {
            true
        }
    }
}

mod reject_registry {
    use soroban_sdk::{contract, contractimpl, BytesN, Env};

    #[contract]
    pub struct RejectRegistry;

    #[contractimpl]
    impl RejectRegistry {
        pub fn is_provider(_env: Env, _provider: BytesN<32>) -> bool {
            false
        }
        pub fn is_tee_hash_approved(_env: Env, _tee_hash: BytesN<32>) -> bool {
            true
        }
    }
}

fn setup_with_mock_registry(env: &Env) -> (Address, Address) {
    let registry_id = env.register_contract(None, mock_registry::MockRegistry);
    let oracle_id   = register_oracle(env);
    let provenance  = Address::generate(env);
    let admin       = Address::generate(env);
    OracleContractClient::new(env, &oracle_id)
        .init(&registry_id, &provenance, &admin);
    (oracle_id, registry_id)
}

// ---------------------------------------------------------------------------
// Issue #34 — init and double-init guard
// ---------------------------------------------------------------------------

#[test]
fn test_init() {
    let env = make_env();
    let cid = register_oracle(&env);
    let client = OracleContractClient::new(&env, &cid);

    let registry   = Address::generate(&env);
    let provenance = Address::generate(&env);
    let admin      = Address::generate(&env);

    client.init(&registry, &provenance, &admin);

    let result = client.try_init(&registry, &provenance, &admin);
    assert!(result.is_err());
}

#[test]
fn test_init_already_initialized() {
    let env = make_env();
    let cid = register_oracle(&env);
    let client = OracleContractClient::new(&env, &cid);

    let registry   = Address::generate(&env);
    let provenance = Address::generate(&env);
    let admin      = Address::generate(&env);

    client.init(&registry, &provenance, &admin);

    let err = client
        .try_init(&registry, &provenance, &admin)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::AlreadyInitialized);
}

// ---------------------------------------------------------------------------
// Issue #35 — submit_request uniqueness and TTL
// ---------------------------------------------------------------------------

#[test]
fn test_submit_request_generates_unique_ids() {
    let env = make_env();
    env.mock_all_auths();
    let cid    = register_oracle(&env);
    let client = OracleContractClient::new(&env, &cid);
    let bytes  = Bytes::from_slice(&env, b"data");
    let req    = Address::generate(&env);

    assert_eq!(client.submit_request(&bytes, &bytes, &req), 1);
    assert_eq!(client.submit_request(&bytes, &bytes, &req), 2);
}

#[test]
fn test_submit_request_stores_pending_in_temporary_storage() {
    let env = make_env();
    env.mock_all_auths();
    let cid    = register_oracle(&env);
    let client = OracleContractClient::new(&env, &cid);
    let bytes  = Bytes::from_slice(&env, b"ref");
    let req    = Address::generate(&env);

    let id = client.submit_request(&bytes, &bytes, &req);
    assert_eq!(client.get_request(&id).unwrap().state, RequestState::Pending);

    let ttl = env.as_contract(&cid, || {
        env.storage().temporary().get_ttl(&DataKey::Request(id))
    });
    assert!(ttl > 0);
}

// ---------------------------------------------------------------------------
// Issue #36 — verify_attestation scenarios
// ---------------------------------------------------------------------------

#[test]
fn test_verify_attestation_not_initialized() {
    let env = make_env();
    let cid    = register_oracle(&env);
    let client = OracleContractClient::new(&env, &cid);

    let err = client
        .try_verify_attestation(
            &hash32(&env, 0),
            &hash32(&env, 1),
            &Bytes::from_slice(&env, b"data"),
            &BytesN::from_array(&env, &[0u8; 64]),
        )
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::RegistryNotConfigured);
}

#[test]
fn test_verify_attestation_unauthorized_signer() {
    let env = make_env();
    env.mock_all_auths();
    let registry_id = env.register_contract(None, reject_registry::RejectRegistry);
    let oracle_id   = register_oracle(&env);
    let provenance  = Address::generate(&env);
    let admin       = Address::generate(&env);
    OracleContractClient::new(&env, &oracle_id)
        .init(&registry_id, &provenance, &admin);
    let client = OracleContractClient::new(&env, &oracle_id);

    let err = client
        .try_verify_attestation(
            &hash32(&env, 0),
            &hash32(&env, 1),
            &Bytes::from_slice(&env, b"data"),
            &BytesN::from_array(&env, &[0u8; 64]),
        )
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::UnauthorizedSigner);
}

#[test]
fn test_verify_attestation_invalid_signature() {
    let env = make_env();
    env.mock_all_auths();
    let (oracle_id, _) = setup_with_mock_registry(&env);
    let client = OracleContractClient::new(&env, &oracle_id);

    let sk       = ed25519_dalek::SigningKey::from_bytes(&[42u8; 32]);
    let provider = BytesN::from_array(&env, sk.verifying_key().as_bytes());
    let tee_hash = BytesN::from_array(&env, &[1u8; 32]);
    let payload  = Bytes::from_slice(&env, b"payload");
    let bad_sig  = BytesN::from_array(&env, &[0u8; 64]);

    let result = client.try_verify_attestation(&provider, &tee_hash, &payload, &bad_sig);
    assert!(result.is_err());
}

#[test]
fn test_verify_attestation_success() {
    use ed25519_dalek::Signer;

    let env = make_env();
    env.mock_all_auths();
    let (oracle_id, _) = setup_with_mock_registry(&env);
    let client = OracleContractClient::new(&env, &oracle_id);

    let sk       = ed25519_dalek::SigningKey::from_bytes(&[42u8; 32]);
    let provider = BytesN::from_array(&env, sk.verifying_key().as_bytes());
    let tee_hash = BytesN::from_array(&env, &[1u8; 32]);
    let raw      = b"attestation payload";
    let payload  = Bytes::from_slice(&env, raw);

    let sig: ed25519_dalek::Signature = sk.sign(raw);
    let signature = BytesN::from_array(&env, &sig.to_bytes());

    client.verify_attestation(&provider, &tee_hash, &payload, &signature);
}
