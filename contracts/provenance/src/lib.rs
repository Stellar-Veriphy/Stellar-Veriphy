#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Symbol};

#[contracttype]
pub struct CertificateDetails {
    pub storage_id: String,
    pub manifest_hash: String,
    pub attestation_hash: String,
}

#[contracttype]
pub struct Certificate {
    pub storage_id: String,
    pub manifest_hash: String,
    pub attestation_hash: String,
    pub creator: Address,
    /// Ledger timestamp at mint time; set once and immutable (no update API).
    pub timestamp: u64,
}

#[contract]
pub struct ProvenanceContract;

#[contractimpl]
impl ProvenanceContract {
    pub fn mint(env: Env, to: Address, details: CertificateDetails) -> u64 {
        to.require_auth();
        let id: u64 = env.ledger().sequence() as u64;
        let cert = Certificate {
            storage_id: details.storage_id,
            manifest_hash: details.manifest_hash,
            attestation_hash: details.attestation_hash,
            creator: to,
            timestamp: env.ledger().timestamp(),
        };
        env.storage().persistent().set(&id, &cert);
        env.events().publish((Symbol::new(&env, "minted"),), id);
        id
    }

    pub fn get(env: Env, id: u64) -> Certificate {
        env.storage().persistent().get(&id).unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger as _},
        Env, String,
    };

    #[test]
    fn test_immutable_timestamp() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, ProvenanceContract);
        let client = ProvenanceContractClient::new(&env, &contract_id);

        env.ledger().with_mut(|l| {
            l.timestamp = 100;
        });

        let details = CertificateDetails {
            storage_id: String::from_str(&env, "sid"),
            manifest_hash: String::from_str(&env, "mhash"),
            attestation_hash: String::from_str(&env, "ahash"),
        };
        let to = Address::generate(&env);
        let id = client.mint(&to, &details);
        let original_ts = client.get(&id).timestamp;

        env.ledger().with_mut(|l| {
            l.timestamp = 999;
        });

        assert_eq!(client.get(&id).timestamp, original_ts);
    }
}
