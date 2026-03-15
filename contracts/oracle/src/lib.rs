#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Bytes, Env, Symbol};

#[contracttype]
pub struct VerificationRequest {
    pub storage_ref: Bytes,
    pub manifest_hash: Bytes,
    pub requester: soroban_sdk::Address,
}

#[contract]
pub struct OracleContract;

#[contractimpl]
impl OracleContract {
    /// Submit a new verification request.
    pub fn submit(env: Env, storage_ref: Bytes, manifest_hash: Bytes, requester: soroban_sdk::Address) -> u64 {
        requester.require_auth();
        let id: u64 = env.ledger().sequence() as u64;
        let req = VerificationRequest { storage_ref, manifest_hash, requester };
        env.storage().persistent().set(&id, &req);
        env.events().publish((Symbol::new(&env, "submitted"),), id);
        id
    }

    /// Retrieve a verification request by ID.
    pub fn get(env: Env, id: u64) -> VerificationRequest {
        env.storage().persistent().get(&id).unwrap()
    }
}
