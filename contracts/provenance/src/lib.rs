#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Bytes, Env, Symbol};

#[contracttype]
pub struct ProvenanceCert {
    pub storage_ref: Bytes,
    pub manifest_hash: Bytes,
    pub attestation_hash: Bytes,
    pub creator: soroban_sdk::Address,
    pub timestamp: u64,
}

#[contract]
pub struct ProvenanceContract;

#[contractimpl]
impl ProvenanceContract {
    /// Mint a provenance certificate after TEE attestation.
    pub fn mint(
        env: Env,
        storage_ref: Bytes,
        manifest_hash: Bytes,
        attestation_hash: Bytes,
        creator: soroban_sdk::Address,
    ) -> u64 {
        creator.require_auth();
        let id: u64 = env.ledger().sequence() as u64;
        let cert = ProvenanceCert {
            storage_ref,
            manifest_hash,
            attestation_hash,
            creator,
            timestamp: env.ledger().timestamp(),
        };
        env.storage().persistent().set(&id, &cert);
        env.events().publish((Symbol::new(&env, "minted"),), id);
        id
    }

    pub fn get(env: Env, id: u64) -> ProvenanceCert {
        env.storage().persistent().get(&id).unwrap()
    }
}
