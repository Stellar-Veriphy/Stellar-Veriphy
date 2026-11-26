/// # Oracle Contract — Event Payload Compatibility Tests
///
/// These tests pin the shape of every oracle contract event so that renaming
/// a symbol key or changing a payload field breaks CI immediately.
///
/// Oracle events use the older `env.events().publish(topics, data)` API, so
/// compatibility is verified by asserting that:
///   1. At least one event is emitted for a given action.
///   2. The captured events array is non-empty after the relevant call.
///   3. Known symbol names are spelled exactly as consumers expect.
///
/// ## Compatibility rules (see docs/contracts/event-compatibility.md)
///
/// - Symbol names (e.g. `"submitted"`, `"verified"`) are ABI surface:
///   never rename them without a versioned migration.
/// - Adding data fields is backward-compatible.
/// - Removing or renaming data fields, or renaming a topic symbol, is breaking.
#[cfg(test)]
mod oracle_event_compat_tests {
    use crate::{OracleContract, OracleContractClient, Priority};
    use soroban_sdk::{
        symbol_short,
        testutils::{Address as _, Events as _},
        Address, Bytes, Env,
    };

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    fn make_env() -> Env {
        Env::default()
    }

    fn bytes(env: &Env, s: &[u8]) -> Bytes {
        Bytes::from_slice(env, s)
    }

    mod mock_registry {
        use soroban_sdk::{contract, contractimpl, BytesN, Env};
        #[contract]
        pub struct MockRegistry;
        #[contractimpl]
        impl MockRegistry {
            pub fn is_tee_hash_approved(_env: Env, _hash: BytesN<32>) -> bool {
                true
            }
            pub fn is_provider(_env: Env, _key: BytesN<32>) -> bool {
                true
            }
        }
    }

    fn setup(env: &Env) -> (Address, Address) {
        env.mock_all_auths();
        let oracle_id = env.register_contract(None, OracleContract);
        let registry_id = env.register_contract(None, mock_registry::MockRegistry);
        let provenance_id = Address::generate(env);
        let admin = Address::generate(env);
        let client = OracleContractClient::new(env, &oracle_id);
        client.init(&registry_id, &provenance_id, &admin);
        (oracle_id, admin)
    }

    // -------------------------------------------------------------------------
    // "submitted" event
    // -------------------------------------------------------------------------

    /// The `submitted` event must be emitted with its exact symbol name every
    /// time a new verification request is accepted.
    #[test]
    fn test_event_compat_submitted_symbol() {
        let env = make_env();
        let (oracle_id, _) = setup(&env);
        let client = OracleContractClient::new(&env, &oracle_id);
        let requester = Address::generate(&env);

        client.submit_request(
            &bytes(&env, b"ipfs://Qmsubmit"),
            &bytes(&env, b"manifest_hash_hex"),
            &requester,
            &Priority::Normal,
        );

        let events = env.events().all();
        assert!(!events.is_empty(), "submit_request must emit at least one event");

        // Check that the symbol "submitted" appears in the emitted event topics.
        // Any rename breaks this assertion.
        let expected_sym = symbol_short!("submitted");
        let has_submitted = events.iter().any(|(_, topics, _)| {
            topics
                .iter()
                .any(|v| v == soroban_sdk::Val::from_val(&env, &expected_sym))
        });
        assert!(
            has_submitted,
            "expected an event with topic symbol 'submitted' — was it renamed?"
        );
    }

    // -------------------------------------------------------------------------
    // "cancelled" event
    // -------------------------------------------------------------------------

    /// The `cancelled` event must be emitted with its exact symbol name when a
    /// request is cancelled by its requester.
    #[test]
    fn test_event_compat_cancelled_symbol() {
        let env = make_env();
        let (oracle_id, _) = setup(&env);
        let client = OracleContractClient::new(&env, &oracle_id);
        let requester = Address::generate(&env);

        let id = client.submit_request(
            &bytes(&env, b"ipfs://Qmcancel"),
            &bytes(&env, b"manifest_cancel"),
            &requester,
            &Priority::Normal,
        );

        // Clear events from submit so only the cancel event remains.
        env.events().all(); // consume existing events buffer

        client.cancel_request(&id);

        let events = env.events().all();
        assert!(
            !events.is_empty(),
            "cancel_request must emit at least one event"
        );

        let expected_sym = symbol_short!("cancelled");
        let has_cancelled = events.iter().any(|(_, topics, _)| {
            topics
                .iter()
                .any(|v| v == soroban_sdk::Val::from_val(&env, &expected_sym))
        });
        assert!(
            has_cancelled,
            "expected an event with topic symbol 'cancelled' — was it renamed?"
        );
    }

    // -------------------------------------------------------------------------
    // "pause" and "unpause" events (circuit breaker)
    // -------------------------------------------------------------------------

    /// Circuit-breaker events must retain the exact symbol names `pause` and
    /// `unpause` so monitoring dashboards can filter on them.
    #[test]
    fn test_event_compat_pause_unpause_symbols() {
        let env = make_env();
        let (oracle_id, _) = setup(&env);
        let client = OracleContractClient::new(&env, &oracle_id);

        client.pause();
        let pause_events = env.events().all();

        let pause_sym = symbol_short!("pause");
        let has_pause = pause_events.iter().any(|(_, topics, _)| {
            topics
                .iter()
                .any(|v| v == soroban_sdk::Val::from_val(&env, &pause_sym))
        });
        assert!(
            has_pause,
            "expected an event with topic symbol 'pause' — was it renamed?"
        );

        client.unpause();
        let unpause_events = env.events().all();

        let unpause_sym = symbol_short!("unpause");
        let has_unpause = unpause_events.iter().any(|(_, topics, _)| {
            topics
                .iter()
                .any(|v| v == soroban_sdk::Val::from_val(&env, &unpause_sym))
        });
        assert!(
            has_unpause,
            "expected an event with topic symbol 'unpause' — was it renamed?"
        );
    }

    // -------------------------------------------------------------------------
    // "provider_added" and "provider_removed" events
    // -------------------------------------------------------------------------

    /// Provider lifecycle events must keep their exact symbol names so off-chain
    /// indexers can track the active provider set.
    #[test]
    fn test_event_compat_provider_lifecycle_symbols() {
        let env = make_env();
        let (oracle_id, _) = setup(&env);
        let client = OracleContractClient::new(&env, &oracle_id);
        let provider = Address::generate(&env);

        client.add_provider(&provider);
        let add_events = env.events().all();

        let added_sym = symbol_short!("prov_added");
        let has_added = add_events.iter().any(|(_, topics, _)| {
            topics
                .iter()
                .any(|v| v == soroban_sdk::Val::from_val(&env, &added_sym))
        });
        assert!(
            has_added,
            "expected event with symbol 'prov_added' — was the provider_added event renamed?"
        );

        client.remove_provider(&provider);
        let remove_events = env.events().all();

        let removed_sym = symbol_short!("prov_removed");
        let has_removed = remove_events.iter().any(|(_, topics, _)| {
            topics
                .iter()
                .any(|v| v == soroban_sdk::Val::from_val(&env, &removed_sym))
        });
        assert!(
            has_removed,
            "expected event with symbol 'prov_removed' — was the provider_removed event renamed?"
        );
    }

    // -------------------------------------------------------------------------
    // General: every action emits at least one event
    // -------------------------------------------------------------------------

    /// Regression guard: confirms each contract action still emits events (i.e.
    /// the publish call was not accidentally removed during a refactor).
    #[test]
    fn test_event_compat_actions_all_emit_events() {
        let env = make_env();
        let (oracle_id, _) = setup(&env);
        let client = OracleContractClient::new(&env, &oracle_id);
        let requester = Address::generate(&env);

        // submit_request
        let _id = client.submit_request(
            &bytes(&env, b"ipfs://Qmemit"),
            &bytes(&env, b"emit_manifest"),
            &requester,
            &Priority::Normal,
        );
        assert!(
            !env.events().all().is_empty(),
            "submit_request must emit events"
        );

        // pause / unpause
        client.pause();
        assert!(!env.events().all().is_empty(), "pause must emit events");
        client.unpause();
        assert!(!env.events().all().is_empty(), "unpause must emit events");
    }
}
