#![no_std]
use soroban_sdk::{contract, contractimpl, Bytes, Env, Symbol};

#[contract]
pub struct RegistryContract;

#[contractimpl]
impl RegistryContract {
    /// Register an approved TEE code hash.
    pub fn register(env: Env, admin: soroban_sdk::Address, code_hash: Bytes) {
        admin.require_auth();
        env.storage().persistent().set(&code_hash, &true);
        env.events().publish((Symbol::new(&env, "registered"),), code_hash);
    }

    /// Check if a TEE code hash is approved.
    pub fn is_approved(env: Env, code_hash: Bytes) -> bool {
        env.storage().persistent().get(&code_hash).unwrap_or(false)
    }
}
