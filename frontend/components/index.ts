/**
 * components/index.ts
 *
 * Main export file for all components organized by atomic design hierarchy.
 *
 * Structure:
 * - atoms: Basic building blocks (buttons, inputs, badges, etc.)
 * - molecules: Simple combinations of atoms (cards, search fields, etc.)
 * - organisms: Complex combinations (headers, panels, modals, etc.)
 * - templates: Page-level layouts
 * - features: Feature-specific component collections
 * - utils: Providers and utility components
 *
 * @example
 * ```tsx
 * // Import atoms
 * import { Button, Badge, Spinner } from '@/components/atoms';
 *
 * // Import molecules
 * import { Card, SearchField } from '@/components/molecules';
 *
 * // Import organisms
 * import { Header, Footer } from '@/components/organisms';
 *
 * // Import features
 * import { CertificateLookupForm } from '@/components/features/certificates';
 *
 * // Import utilities
 * import { ThemeProvider } from '@/components/utils';
 * ```
 */

// Atomic Design Hierarchy
export * from './atoms';
export * from './molecules';
export * from './organisms';
export * from './templates';
export * as features from './features';
export * as utils from './utils';

// Legacy landing page components (can be reorganized into atoms/molecules)
export { About } from './About';
export { CallToAction } from './CallToAction';
export { Ecosystem } from './Ecosystem';
export { HeroSection } from './HeroSection';
export { HowItWorks } from './HowItWorks';

// Legacy utilities (to be migrated into utils)
export { ContentHashCalculator } from './ContentHashCalculator';
export { APIKeyManagement } from './APIKeyManagement';
