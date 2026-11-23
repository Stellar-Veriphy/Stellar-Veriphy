/**
 * Contract event fixtures — TypeScript exports with type safety.
 * 
 * These exports provide typed access to contract event shapes, ensuring
 * UI components and tests stay synchronized with smart contract events.
 */

import certificateEvents from './certificate-events.json';

export type CertificateEventTopic = 
  | 'CertificateMinted'
  | 'CertificateTransferred'
  | 'MetadataUpdated'
  | 'BatchMinted'
  | 'CertificateRevoked'
  | 'CertificateRenewed'
  | 'CertificateExpirationWarning'
  | 'VerificationLevelUpdated'
  | 'CertificatesLinked'
  | 'CertificateEndorsed'
  | 'EndorsementRemoved'
  | 'CertificateLockedEvent'
  | 'ContractError';

export type VerificationLevel = 'standard' | 'enhanced' | 'none';

export interface ContractEventSuccess<T = Record<string, unknown>> {
  topic: CertificateEventTopic;
  topics: Record<string, unknown>;
  data: T & { timestamp?: number };
}

export interface ContractEventFailure {
  topic: 'ContractError';
  topics: {
    error_code: number;
    error_message: string;
  };
  data: Record<string, unknown>;
}

export type ContractEventFixture<T = Record<string, unknown>> = {
  description: string;
  success: ContractEventSuccess<T>;
  failure: ContractEventFailure;
};

export interface CertificateMintedData {
  timestamp: number;
  verification_level: VerificationLevel;
}

export interface CertificateTransferredData {
  timestamp: number;
}

export interface CertificateRevokedData {
  reason: string;
  timestamp: number;
}

export interface MetadataUpdatedData {
  new_version: number;
  timestamp: number;
}

export interface BatchMintedData {
  certificate_ids: number[];
  count: number;
  timestamp: number;
}

export interface CertificateRenewedData {
  new_expires_at: number;
  previous_expires_at: number;
}

export interface CertificateEndorsedData {
  total_endorsements: number;
  timestamp: number;
}

export interface VerificationLevelUpdatedData {
  new_level: VerificationLevel;
  previous_level: VerificationLevel;
}

export interface CertificatesLinkedData {
  relation: 'parent' | 'child' | 'related';
}

/**
 * Exported event fixtures matching contract event structures.
 * Use these in UI tests to verify display consistency with contract behavior.
 */
export const events = certificateEvents as {
  minted: ContractEventFixture<CertificateMintedData>;
  transferred: ContractEventFixture<CertificateTransferredData>;
  revoked: ContractEventFixture<CertificateRevokedData>;
  metadata_updated: ContractEventFixture<MetadataUpdatedData>;
  batch_minted: ContractEventFixture<BatchMintedData>;
  renewed: ContractEventFixture<CertificateRenewedData>;
  endorsed: ContractEventFixture<CertificateEndorsedData>;
  locked: ContractEventFixture<Record<string, unknown>>;
  verification_level_updated: ContractEventFixture<VerificationLevelUpdatedData>;
  linked: ContractEventFixture<CertificatesLinkedData>;
};

/**
 * Helper to extract success event for a given operation
 */
export function getSuccessEvent<K extends keyof typeof events>(
  operation: K
): typeof events[K]['success'] {
  return events[operation].success;
}

/**
 * Helper to extract failure event for a given operation
 */
export function getFailureEvent<K extends keyof typeof events>(
  operation: K
): typeof events[K]['failure'] {
  return events[operation].failure;
}

/**
 * Get all event topics for debugging/mapping purposes
 */
export function getAllTopics(): CertificateEventTopic[] {
  return [
    'CertificateMinted',
    'CertificateTransferred',
    'MetadataUpdated',
    'BatchMinted',
    'CertificateRevoked',
    'CertificateRenewed',
    'CertificateExpirationWarning',
    'VerificationLevelUpdated',
    'CertificatesLinked',
    'CertificateEndorsed',
    'EndorsementRemoved',
    'CertificateLockedEvent',
  ];
}