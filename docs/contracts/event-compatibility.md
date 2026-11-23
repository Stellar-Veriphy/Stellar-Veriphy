# Contract Event Compatibility

Soroban contract events are part of the public ABI.  Frontend and backend
consumers decode them by name and field position, so a rename or structural
change is a **breaking change** even when the Rust code still compiles.

## Rules

| Change type | Compatible? | Notes |
|---|---|---|
| Adding a new non-topic data field | ✅ Yes | Old decoders ignore unknown fields |
| Adding a new event type | ✅ Yes | Old decoders skip unknown event types |
| Removing a topic field | ❌ No | Topic order is part of the filter key |
| Renaming a topic field | ❌ No | Same as removal for most SDK decoders |
| Changing a topic field's type | ❌ No | XDR decode will fail or produce wrong value |
| Renaming a data field | ❌ No | Named decoders (TypeScript, Python) will fail |
| Removing a data field | ❌ No | Decoders expecting the field will error |
| Renaming an event's symbol key (oracle) | ❌ No | Event listeners filter on the symbol string |

## Affected events

### provenance contract (`#[contractevent]` structs)

| Struct | Topics | Data fields |
|---|---|---|
| `CertificateMinted` | `owner`, `certificate_id`, `manifest_hash` | _(none)_ |
| `CertificateTransferred` | `certificate_id`, `from`, `to` | _(none)_ |
| `CertificateRevoked` | `certificate_id`, `owner` | `reason: String` |
| `BatchMinted` | `owner` | `certificate_ids: Vec<u64>`, `count: u32` |
| `CertificateLockedEvent` | `certificate_id`, `locked_by` | _(none)_ |
| `MetadataUpdated` | `certificate_id`, `updated_by` | `new_version: u32` |
| `CertificateRenewed` | `certificate_id`, `renewed_by` | `new_expires_at: u64` |
| `CertificateExpirationWarning` | `certificate_id`, `owner` | `expires_at: u64` |
| `VerificationLevelUpdated` | `certificate_id`, `updated_by` | `new_level: VerificationLevel` |
| `CertificatesLinked` | `certificate_id`, `related_id` | `relation: CertificateRelation` |
| `CertificateEndorsed` | `certificate_id`, `endorser` | `total_endorsements: u64` |
| `EndorsementRemoved` | `certificate_id`, `endorser` | `total_endorsements: u64` |

### oracle contract (symbol-based events)

| Symbol string | Payload |
|---|---|
| `"submitted"` | `request_id: u64` |
| `"cancelled"` | `(request_id: u64, requester: Address)` |
| `"verified"` | `(request_id: u64, provider: Address)` |
| `"rejected"` | `(request_id: u64, provider: Address)` |
| `"pause"` | `admin: Address` |
| `"unpause"` | `admin: Address` |
| `"provider_added"` | `provider: Address` |
| `"provider_removed"` | `provider: Address` |
| `"stake_deposited"` | `(provider: Address, amount: u128)` |
| `"withdrawal_initiated"` | `(provider: Address, amount: u128)` |
| `"stake_slashed"` | `(provider: Address, slashed: u128)` |
| `"policy_changed"` | `policy_version: u32` |

## How CI enforces compatibility

Each contract has a `src/event_compat_tests.rs` module.  CI runs:

```bash
cargo test --lib event_compat
```

for every contract in the `[oracle, provenance, registry]` matrix.

The tests:
1. Build all public event structs with every documented field (compile-time guard).
2. Invoke the contract, capture `env.events().all()`, and assert at least one
   event is emitted and that required symbols / fields are present.

A broken build or failed assertion blocks the PR.

## Making a breaking event change

1. Create a new event type with the new shape (e.g. `CertificateMintedV2`).
2. Keep the old event type emitting for one release cycle.
3. Update frontend and backend consumers to decode both shapes.
4. Remove the old event type in the following release.
5. Update this document and the compat tests.
