/**
 * atoms/index.ts
 *
 * Exports all atomic (base) components.
 *
 * Atoms are the smallest building blocks - buttons, badges, inputs, etc.
 * They contain no business logic and are purely presentational.
 *
 * @example
 * ```tsx
 * import { Button, Badge, Spinner } from '@/components/atoms';
 * ```
 */

// Re-export existing UI components as atoms
export { Button, type ButtonProps } from '../ui/Button';
export { Badge, type BadgeProps } from '../ui/StatusBadge';
export { Avatar, type AvatarProps } from '../ui/Avatar';
export { Spinner } from '../ui/Spinner';
export { Tooltip, type TooltipProps } from '../ui/Tooltip';
export { FormInput, type FormInputProps } from '../ui/FormInput';
export { EmptyState, type EmptyStateProps } from '../ui/EmptyState';
export { Accordion, type AccordionProps } from '../ui/Accordion';
export { Tabs, type TabsProps } from '../ui/Tabs';
export { Skeleton } from '../ui/Skeleton';
export { HelpIcon } from '../ui/HelpIcon';
export { LiveRegion } from '../ui/LiveRegion';
