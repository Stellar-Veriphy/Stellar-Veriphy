#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env, Symbol};

#[contracttype]
pub enum DataKey {
    Admin,
    Provenance,
}

#[contract]
pub struct RegistryContract;

#[contractimpl]
impl RegistryContract {
    pub fn init(env: Env, admin: Address, provenance: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Provenance, &provenance);
    }

    pub fn get_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Admin)
    }

    /// Register an approved TEE code hash (admin-gated).
    pub fn register_tee_hash(env: Env, admin: Address, tee_hash: BytesN<32>) {
        admin.require_auth();
        env.storage().persistent().set(&tee_hash, &true);
        env.events().publish((Symbol::new(&env, "tee_registered"),), tee_hash);
    }

    /// Check if a TEE code hash is approved.
    pub fn is_tee_hash_approved(env: Env, tee_hash: BytesN<32>) -> bool {
        env.storage().persistent().get(&tee_hash).unwrap_or(false)
    }

    /// Register a provider public key (admin-gated).
    pub fn register_provider(env: Env, admin: Address, provider: BytesN<32>) {
        admin.require_auth();
        env.storage().persistent().set(&provider, &true);
        env.events().publish((Symbol::new(&env, "provider_registered"),), provider);
    }

    /// Check if a provider public key is registered.
    pub fn is_provider(env: Env, provider: BytesN<32>) -> bool {
        env.storage().persistent().get(&provider).unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_initialize_sets_admin() {
        let env = Env::default();
        let contract_id = env.register_contract(None, RegistryContract);
        let client = RegistryContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let provenance = Address::generate(&env);
        client.init(&admin, &provenance);

        assert_eq!(client.get_admin(), Some(admin));
    }

    #[test]
    fn test_already_initialized_fails() {
        let env = Env::default();
        let contract_id = env.register_contract(None, RegistryContract);
        let client = RegistryContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let provenance = Address::generate(&env);
        client.init(&admin, &provenance);

        let result = client.try_init(&admin, &provenance);
        assert!(result.is_err());
    }

    #[test]
    fn test_get_admin_matches_init() {
        let env = Env::default();
        let contract_id = env.register_contract(None, RegistryContract);
        let client = RegistryContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let provenance = Address::generate(&env);
        client.init(&admin, &provenance);

        assert_eq!(client.get_admin(), Some(admin));
    }
}
