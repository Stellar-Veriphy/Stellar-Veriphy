/**
 * UI display fixtures — TypeScript exports for component testing.
 * 
 * These fixtures define expected DOM structures and visual states for UI
 * components, synchronized with contract event data for consistency.
 */

import certificateDisplay from './certificate-display.json';

export type CertificateStatus = 'active' | 'expired' | 'revoked' | 'locked' | 'transfer_pending';
export type VerificationLevel = 'standard' | 'enhanced' | 'none' | 'pending';

export interface CertificateCardElements {
  id: string;
  manifest_hash: string;
  creator: string;
  creator_short: string;
  timestamp: string;
  verification_badge: {
    level: VerificationLevel;
    label: string;
    color: string;
  };
  status: CertificateStatus;
  expiration?: string | null;
  endorsements?: number;
  view_count?: number;
  revocation_reason?: string;
  revoked_at?: string;
  lock_reason?: string;
  owner?: string;
  owner_short?: string;
  pending_recipient?: string;
  renew_button_visible?: boolean;
}

export interface AccessibilityInfo {
  role: string;
  label: string;
}

export interface CertificateCardFixture {
  description: string;
  elements: CertificateCardElements;
  accessibility: AccessibilityInfo;
}

export interface VerificationBadgeFixture {
  label: string;
  icon: string;
  color: string;
  aria_label: string;
}

export interface ErrorStateFixture {
  message: string;
  code: string;
  suggestion: string;
}

export interface LoadingStateFixture {
  elements?: string[];
  message?: string;
  aria_label: string;
}

export interface EmptyStateFixture {
  message: string;
  suggestion: string;
  action_label: string;
}

/**
 * Exported UI fixtures matching component display requirements.
 * Use these in component tests to verify correct rendering.
 */
export const ui = certificateDisplay as {
  certificate_card: {
    success: CertificateCardFixture;
    expired: CertificateCardFixture;
    revoked: CertificateCardFixture;
    locked: CertificateCardFixture;
    transfer_pending: CertificateCardFixture;
  };
  verification_badge: Record<VerificationLevel, VerificationBadgeFixture>;
  error_states: Record<string, ErrorStateFixture>;
  loading_states: {
    skeleton: LoadingStateFixture;
    spinner: LoadingStateFixture;
  };
  empty_states: {
    no_certificates: EmptyStateFixture;
    no_search_results: EmptyStateFixture;
  };
};

/**
 * Get certificate card fixture by status
 */
export function getCertificateCardFixture(
  status: CertificateStatus
): CertificateCardFixture {
  const statusMap: Record<CertificateStatus, keyof typeof ui.certificate_card> = {
    active: 'success',
    expired: 'expired',
    revoked: 'revoked',
    locked: 'locked',
    transfer_pending: 'transfer_pending',
  };
  return ui.certificate_card[statusMap[status]];
}

/**
 * Get verification badge fixture by level
 */
export function getVerificationBadgeFixture(
  level: VerificationLevel
): VerificationBadgeFixture {
  return ui.verification_badge[level];
}

/**
 * Get error state fixture by error code
 */
export function getErrorStateFixture(
  code: string
): ErrorStateFixture {
  return ui.error_states[code] || ui.error_states.not_found;
}