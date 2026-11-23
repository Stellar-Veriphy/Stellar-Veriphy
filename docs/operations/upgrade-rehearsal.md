# Contract upgrade rehearsal

> Labels: contracts, scripts, operations

`scripts/rehearse-upgrade.sh` is a repeatable, automated rehearsal that
validates every upgrade step in a **disposable environment** before a contract
change reaches testnet or mainnet.

## What it checks

| Step | Description |
|---|---|
| Prerequisites | `stellar`, `cargo`, `jq` are present; wasm32 target installed |
| Build WASM | Compiles the contract to WASM (`--skip-build` reuses a previous build) |
| Pre-upgrade snapshot | Captures DataKey variants, struct fields, and entry points from source |
| Deploy v1 | Deploys the WASM to testnet (or skips gracefully if the network is unavailable) |
| Initialise v1 | Calls `init` / `initialize` with the correct arguments for the contract |
| Safety check | Runs `upgrade-safety-check.sh` to compare the WASM against the pre-upgrade baseline |
| Deploy v2 | Deploys again (simulating the upgraded version) |
| Post-upgrade state | Diffs v1 and v2 snapshots — reports any removed DataKey variants or entry points |
| Rollback procedure | Runs `ops/verify-rollback-checkpoints.sh` and prints rollback instructions |
| Contract tests | `cargo test --release` to confirm the contract is internally consistent |

## Usage

```bash
# Full rehearsal (builds WASM, deploys to testnet)
./scripts/rehearse-upgrade.sh oracle

# Skip the cargo build if the WASM is already built
./scripts/rehearse-upgrade.sh provenance --skip-build

# Show raw cargo / stellar output
./scripts/rehearse-upgrade.sh registry --verbose
```

## State checks

### Before upgrade

The script captures a baseline snapshot of:

- `DataKey` variant names (from `contracts/<contract>/src/lib.rs`)
- Persisted `pub` struct fields
- Public entry point names

These are stored in `$SANDBOX_DIR/snapshot-v1/` for the duration of the
rehearsal.

### After upgrade

A second snapshot is captured from the same source (in a real upgrade this
would be the new version). The script diffs the two:

- Removed DataKey variants are warned — stored data under them becomes
  unreachable.
- Removed entry points are warned — existing consumers calling them will fail.
- New optional fields are safe; new required fields flag a migration need.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | All steps passed — upgrade steps are valid |
| `1` | One or more steps failed — fix before promoting |
| `2` | Usage or prerequisite error |

## Rollback instructions

If the rehearsal fails, **no live contract was changed** — this ran in a
disposable environment. To roll back a live upgrade:

1. Locate the previously-deployed contract ID in
   `docs/operations/deployment-log.md`.
2. Repoint all consumers (frontend env vars, oracle worker config,
   `config/environments/*.json`) to the old contract ID.
3. Redeploy consumers with the old ID — the old contract and its on-chain
   state are immutable and unchanged.

The rehearsal writes `$SANDBOX_DIR/rollback-info.txt` with the v1 and v2
contract IDs from the run, so you have them in hand if needed.

## Integration with the upgrade workflow

Run this script **before** `upgrade-safety-check.sh` with real old/new WASMs:

```
rehearse-upgrade.sh <contract>          ← rehearsal in disposable env
upgrade-safety-check.sh <contract> \
  <old.wasm> <new.wasm> testnet         ← final check with real artifacts
stellar contract deploy …               ← actual deploy
```

The rehearsal and the safety check are complementary: the rehearsal validates
the _process_ (build → deploy → init → upgrade → verify → rollback), and the
safety check validates the _artifact_ (DataKey / struct / API compatibility
between old and new WASM).
