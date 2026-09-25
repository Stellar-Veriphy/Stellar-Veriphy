# Verifier Network Threat Model & Security Review

This document provides a formal security review and threat model for the StellarVeriphy verifier network and oracle ecosystem, following the STRIDE methodology. It establishes trust boundaries, identifies attack vectors across internal and external actors, evaluates residual risks, and maps mitigations to concrete engineering remediation tracks.

---

## 1. System Overview & Participant Roles

The StellarVeriphy verifier network enables decentralized authenticity verification of digital media manifests (e.g., C2PA, EXIF, perceptual hashes) and attests these proofs onto Soroban smart contracts on the Stellar network.

```
+-----------------------------------------------------------------------------------+
| USER DOMAIN                                                                       |
|  [ Content Creator / Uploader ]                  [ Relying Party / Consumer ]     |
|          |                                                    ^                   |
|          v (HTTPS/TLS)                                        | (Read / Query)    |
+----------|----------------------------------------------------|-------------------+
| BOUNDARY 1: External Gateway / Ingestion                     |                   |
|          v                                                    |                   |
|  [ API Gateway & Ingestion Service ]                          |                   |
|          |                                                    |                   |
+----------|----------------------------------------------------|-------------------+
| BOUNDARY 2: Verification Execution Environment                |                   |
|          v                                                    |                   |
|  +----------------------------------------------------+       |                   |
|  | Verifier Worker (TEE / Isolated Runtime)           |       |                   |
|  | - Manifest Signature Validator (X.509 / C2PA)      |       |                   |
|  | - Perceptual Hash Extractor                        |       |                   |
|  | - Ephemeral Signing Key / Attestation Engine       |       |                   |
|  +----------------------------------------------------+       |                   |
|          |                                                    |                   |
+----------|----------------------------------------------------|-------------------+
| BOUNDARY 3: On-Chain Consensus & Smart Contracts              |                   |
|          v                                                    |                   |
|  [ Soroban RPC Node ] ----> [ Stellar Core Consensus ]       |                   |
|                                       |                       |                   |
|        +------------------------------+                       |                   |
|        |                                                      |                   |
|        v                                                      |                   |
|  [ Registry Contract ] <---> [ Provenance Contract ] <--------+                   |
|  - Asset Hash Mappings       - Attestation History                                |
|  - Oracle Public Keys        - Revocation Registry                                |
+-----------------------------------------------------------------------------------+
```

### Participant Roles

1. **Content Creator / Uploader (External Untrusted)**: Submits media assets, signatures, and provenance claims.
2. **Consumer / Relying Party (External Untrusted)**: Queries certificates and provenance trails to verify authenticity.
3. **Ingestion & Gateway Service (Internal Semi-Trusted)**: Sanitizes payloads, enforces rate limits, orchestrates verification tasks.
4. **Verifier Node / Oracle (Internal Trusted / TEE)**: Validates digital signatures, certificates, and generates cryptographic attestations.
5. **Smart Contracts (`registry`, `provenance`, `oracle`) (On-Chain Enforcer)**: Enforces access control, records proofs, maintains non-repudiation ledger.
6. **Infrastructure Administrator / Operator (Privileged Internal)**: Manages secrets, deployment environments, node telemetry, and upgrades.

---

## 2. Trust Boundaries

| Boundary                       | Interfacing Components                  | Protocol / Mechanism          | Trust Level Transition                |
| ------------------------------ | --------------------------------------- | ----------------------------- | ------------------------------------- |
| **TB-1: Client-to-Gateway**    | Client (Browser/CLI) &rarr; API Gateway | HTTPS / TLS 1.3               | Untrusted &rarr; Semi-Trusted         |
| **TB-2: Gateway-to-Worker**    | Gateway &rarr; Verifier / TEE Worker    | mTLS / gRPC / IPC             | Semi-Trusted &rarr; Trusted Enclave   |
| **TB-3: Oracle-to-Chain**      | Verifier Node &rarr; Soroban RPC        | HTTPS / JSON-RPC / Stellar Tx | Trusted &rarr; Public Blockchain      |
| **TB-4: Contract Interaction** | Consumer / DApp &rarr; Soroban State    | Soroban RPC / Horizon         | Untrusted &rarr; Read-Only Verifiable |

---

## 3. STRIDE Threat Analysis

### 3.1. Spoofing Identity

- **T-S1: Spoofed C2PA Manifests / Fake Roots of Trust**:
  - _Vector_: Attacker injects a synthetic or self-signed certificate authority (CA) root claiming authenticity.
  - _Impact_: High. Bogus media is certified as authentic.
  - _Mitigation_: Hardcoded, pinned trust list of certified root anchors (C2PA Trust List); strict certificate revocation checking (OCSP / CRL).
- **T-S2: Oracle Key Impersonation**:
  - _Vector_: Compromise of oracle signing private key to emit arbitrary on-chain attestations.
  - _Impact_: Critical. Total loss of verifier network integrity.
  - _Mitigation_: Hardware Security Modules (HSM) or AWS KMS / TEE remote attestation; contract-level threshold signatures ($M$-of-$N$ multi-oracle).

### 3.2. Tampering with Data

- **T-T1: In-Flight Payload Alteration**:
  - _Vector_: Man-in-the-middle altering media chunks during ingestion prior to perceptual hashing.
  - _Impact_: High. Perceptual hash calculated against altered image.
  - _Mitigation_: End-to-end payload checksum verification (`SHA-256` digest validated before processing); TLS 1.3 with HSTS.
- **T-T2: Smart Contract State Manipulation**:
  - _Vector_: Calling `set_oracle` or `record_proof` from unauthorized addresses.
  - _Impact_: Critical.
  - _Mitigation_: Soroban `require_auth()` checks on all state-mutating functions; administrative time-locks on oracle key updates.

### 3.3. Repudiation

- **T-R1: Creator Repudiation of Authenticity Claims**:
  - _Vector_: Creator claims they never signed or authorized an uploaded certificate.
  - _Impact_: Medium. Disputes regarding asset ownership and license.
  - _Mitigation_: On-chain non-repudiation binding creator wallet signatures to asset hashes and immutable provenance ledger entries.
- **T-R2: Oracle Denial of Issued Attestation**:
  - _Vector_: Verifier node denies issuing a fraudulent or erroneous certificate.
  - _Impact_: High.
  - _Mitigation_: Verifier signature and timestamp permanently logged in contract state and verifiable against public oracle key.

### 3.4. Information Disclosure

- **T-I1: EXIF / Metadata Privacy Leakage**:
  - _Vector_: Ingestion of raw photos containing private GPS coordinates, serial numbers, or biometric metadata leaked via public registry.
  - _Impact_: Medium. Violation of user privacy.
  - _Mitigation_: Explicit metadata stripping pipeline; zero-knowledge or selective-disclosure hash proofs where detailed provenance is redacted.
- **T-I2: Worker Memory Leakage via Core Dumps or Logs**:
  - _Vector_: Sensitive signing credentials or raw assets logged in debug telemetry.
  - _Impact_: High.
  - _Mitigation_: Redaction middleware; memory sanitization on job completion; disabled core dumps in production containers.

### 3.5. Denial of Service (DoS)

- **T-D1: Decompression Bombs & Algorithmic Complexity Attacks**:
  - _Vector_: Attacker uploads malformed image/video with nested layers designed to exhaust CPU/memory during decode.
  - _Impact_: High. Ingestion workers crash or experience CPU starvation.
  - _Mitigation_: Strict upload size limits (50MB default); streaming parsers; memory-isolated worker sandboxes with execution timeouts.
- **T-D2: Soroban Transaction Fee Griefing / RPC Flooding**:
  - _Vector_: Attacker spams transactions to force oracle into out-of-gas or out-of-balance states.
  - _Impact_: Medium. Oracle unable to submit valid attestations due to exhausted fee pool.
  - _Mitigation_: Dedicated relayer fund management; client payment/deposit requirement prior to on-chain submission; dynamic fee bidding limits.

### 3.6. Elevation of Privilege

- **T-E1: Worker Container Escape**:
  - _Vector_: Exploiting a vulnerability in image decoding libraries (e.g., libpng, FFmpeg) to escape container sandbox.
  - _Impact_: Critical. Access to host machine and signing credentials.
  - _Mitigation_: Non-root execution; unprivileged read-only filesystem; seccomp profiles; TEE boundary separation.
- **T-E2: Admin Key Compromise on Registry Contract**:
  - _Vector_: Attacker obtains single administrative private key.
  - _Impact_: Critical. Contract parameters and fees hijacked.
  - _Mitigation_: Multi-signature governance (e.g., 3-of-5 admin keys) for contract upgrades and parameter updates.

---

## 4. Threat Matrix & Remediation Tracking

| Threat ID | Category    | Severity | Current Mitigation       | Targeted Engineering Issue                                  |
| --------- | ----------- | -------- | ------------------------ | ----------------------------------------------------------- |
| **T-S1**  | Spoofing    | High     | C2PA trust list check    | #681 (Schema & root validation)                             |
| **T-S2**  | Spoofing    | Critical | KMS signing              | #676 (Decentralized verifier network) & #679 (Key rotation) |
| **T-T1**  | Tampering   | High     | SHA-256 pre-checks       | #675 (End-to-end observability)                             |
| **T-T2**  | Tampering   | Critical | Soroban `require_auth()` | Existing contracts                                          |
| **T-R1**  | Repudiation | Medium   | Wallet signature binding | #692 (Authorship non-repudiation)                           |
| **T-I1**  | Info Leak   | Medium   | Metadata filtering       | #697 (Privacy-preserving proofs) & #698 (ZK attestation)    |
| **T-D1**  | DoS         | High     | Size limits & timeouts   | #674 (Recovery path for failed jobs)                        |
| **T-D2**  | DoS         | Medium   | Fee reserves & buffers   | #690 (Failed transaction recovery)                          |
| **T-E1**  | Privilege   | Critical | Docker unprivileged      | #677 (TEE remote attestation)                               |
| **T-E2**  | Privilege   | Critical | Multisig admin           | #678 (Multi-tenant registry governance)                     |

---

## 5. Actor Risk Profile

### External Actors

- **Casual malicious users**: Submit invalid manifests or corrupted files. _Defense_: Strict schema and format validation; rate limits.
- **Financially motivated adversaries**: Attempt certificate forgery to sell plagiarized assets. _Defense_: Hardened cryptographic trust anchors, perceptual hash collision resistance.
- **DDoS botnets**: Target gateway endpoints. _Defense_: Cloudflare edge rate limiting, Cloud Armor, WAF.

### Internal Actors

- **Compromised worker node**: Tries to forge attestations. _Defense_: Multi-node quorum consensus ($M$-of-$N$) before contract acceptance.
- **Rogue system operator**: Attempts secret extraction. _Defense_: Separation of duties, KMS envelope encryption, immutable audit trails.

---

## 6. Review & Maintenance Cycle

This threat model must be formally reviewed:

1. Annually or prior to any major contract release / Soroban protocol upgrade.
2. Whenever a new external validator or oracle provider is integrated into the network.
3. In the event of any security incident or near-miss recorded in the incident log.
