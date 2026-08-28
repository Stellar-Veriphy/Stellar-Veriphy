/**
 * organisms/index.ts
 *
 * Exports all organism components.
 *
 * Organisms are complex combinations of molecules and atoms.
 * They contain application logic, hooks, and coordinate multiple
 * molecules/atoms together to form complete UI sections.
 *
 * @example
 * ```tsx
 * import {
 *   CertificateSearchPanel,
 *   TransactionHistory,
 *   WalletConnector,
 * } from '@/components/organisms';
 * ```
 */

// Re-export page-level components as organisms
export { Header } from '../Header';
export { Navigation } from '../Navigation';
export { MobileNav } from '../MobileNav';
export { Footer } from '../Footer';
export { ErrorBoundary } from '../ErrorBoundary';
export { TransactionTracker } from '../TransactionTracker';
export { VerificationStatusTracker } from '../VerificationStatusTracker';
export { ManifestGeneratorModal } from '../ManifestGeneratorModal';
export { ManifestPreview } from '../ManifestPreview';
export { WalletModal } from '../WalletModal';
