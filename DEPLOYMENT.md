# Provenance Contract Deployment Guide

This document provides step-by-step instructions for deploying the Provenance contract to a Stellar testnet.

## Prerequisites

1. [Stellar CLI](https://developers.stellar.org/docs/tools/stellar-cli/) installed
2. Access to a Stellar testnet account with sufficient XLM for deployment
3. Rust and Cargo installed for building the contract

## Environment Variables

The following environment variables must be set before deployment:

- `STELLAR_NETWORK`: The network to deploy to (e.g., `testnet` or `futurenet`)
- `STELLAR_ACCOUNT`: The address of the account that will deploy and initialize the contract

Optionally, you can set:

- `STELLAR_SECRET_KEY`: The secret key of the deployment account (if not using `stellar config`)

## Deployment Steps

### 1. Build the Contract

```bash
cd contracts/provenance
cargo build --target wasm32-unknown-unknown --release
```

The compiled WASM will be available at:
`target/wasm32-unknown-unknown/release/provenance_contract.wasm`

### 2. Deploy the Contract WASM

```bash
stellar contract upload \
  --wasm target/wasm32-unknown-unknown/release/provenance_contract.wasm \
  --network $STELLAR_NETWORK \
  --source $STELLAR_ACCOUNT
```

This command will output a contract address. Save this address for the next step.

### 3. Initialize the Contract

After deployment, initialize the contract with the Oracle contract address:

```bash
stellar contract invoke \
  --id <CONTRACT_ADDRESS_FROM_STEP_2> \
  --network $STELLAR_NETWORK \
  --source $STELLAR_ACCOUNT \
  -- \
  initialize \
  --oracle <ORACLE_CONTRACT_ADDRESS>
```

Replace:

- `<CONTRACT_ADDRESS_FROM_STEP_2>` with the address from step 2
- `<ORACLE_CONTRACT_ADDRESS>` with the address of the deployed Oracle contract

### 4. Verify Deployment

You can verify the initialization by reading the Oracle address:

```bash
stellar contract invoke \
  --id <CONTRACT_ADDRESS> \
  --network $STELLAR_NETWORK \
  --source $STELLAR_ACCOUNT \
  -- \
  --try-read \
  ORACLE
```

(Note: The Read RPC method is not directly available in the CLI; you may need to use a custom script or check via Horizon. Alternatively, you can call a view function if one is added.)

## Deployment Script

For automated deployment, use the provided `deploy.sh` script (see below). The script performs all steps above and requires the same environment variables.

> **Releases with data migrations:** If this release includes schema changes or indexed data migrations, complete the [Release data migration checklist](docs/operations/release-data-migration-checklist.md) before running the deployment script. See [Release data migration checklist](#release-data-migration-checklist) below.

## Release data migration checklist

Any release that includes schema changes or indexed data migrations **must** complete the [Release data migration checklist](docs/operations/release-data-migration-checklist.md) before deployment. The checklist is mandatory for these releases and covers:

- **Backups**: verified backups of affected data stores, with restore points recorded.
- **Validation**: pre- and post-migration validation queries and integrity checks.
- **Rollback**: explicit rollback steps, including data restore procedures and decision criteria.
- **Ownership**: named data owners responsible for each affected data set.
- **Approvals**: required sign-offs from data owners and release approvers.

Do not proceed with deployment until every item on the checklist is complete and recorded.

## Troubleshooting

- **Data migrations**: If the release includes schema or indexed data migrations, confirm the [Release data migration checklist](docs/operations/release-data-migration-checklist.md) is complete (backups, validation, rollback, ownership, approvals) before deploying.
- **Insufficient funds**: Ensure the source account has at least 1 XLM for deployment and transaction fees.
- **Contract size too large**: Optimize the contract code or enable `--release` profile.
- **Network errors**: Verify `STELLAR_NETWORK` is correct and you have horizon access.

## Example

```bash
export STELLAR_NETWORK=testnet
export STELLAR_ACCOUNT=GDG... (your public key)
export STELLAR_SECRET_KEY=SB... (your secret key, optional if configured in stellar config)

./deploy.sh
```

## Verification providers and cancellation

See [verification lifecycle operations](docs/operations/verification-lifecycle.md) for startup validation, provider configuration restart policy, MongoDB transaction requirements, cancellation authorization, the versioned error taxonomy, and Grafana traffic filters. Configure `VERIFICATION_BACKEND_URL` in the frontend server environment for the backend status proxy.

## Promotion gates

Before promoting a build from staging to production, both of the following gates must pass. They are enforced by the deployment workflow in `.github/workflows` and are documented in detail in [docs/deployment.md](docs/deployment.md).

### Staging smoke test sign-off

Critical staging checks must be recorded with a concise sign-off before promotion. Each sign-off records the test scope and the reviewer. Failed checks block promotion by default; emergency exceptions require an explicit, documented override. See [staging sign-off workflow](docs/deployment/staging-signoff.md) for the checklist, sign-off record format, and the emergency exception procedure.

### Rollback checkpoint verification

Before a rollback point is approved, verify that both the application and contract rollback points are healthy:

- Identify the rollback artifacts and their versions (application image/tag and contract WASM hash/address).
- Verify each checkpoint without modifying live data (read-only checks only).
- Unhealthy rollback points block promotion.

See [docs/deployment.md](docs/deployment.md) for the rollback checkpoint verification procedure and the scripts under `scripts/` that perform it.
