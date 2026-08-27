"use client";

/**
 * StatusBadge.tsx
 *
 * Reusable status badge for communicating success/warning/error/info states.
 *
 * Usage Examples:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Basic badge:
 *    <StatusBadge variant="success" label="Verified" />
 *
 * 2. Square shape, no icon, small size:
 *    <StatusBadge variant="warning" label="Pending" shape="square" icon={false} size="sm" />
 *
 * 3. Custom icon:
 *    <StatusBadge variant="info" label="New" icon={<Sparkles className="w-3.5 h-3.5" />} />
 *
 * 4. Clickable (renders as a button):
 *    <StatusBadge variant="error" label="Failed — retry" onClick={handleRetry} />
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { AlertTriangle, CheckCircle2, Info, type LucideIcon, XCircle } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/utils/cn";

export type StatusBadgeVariant = "success" | "warning" | "error" | "info";
export type StatusBadgeSize = "sm" | "md" | "lg";
export type StatusBadgeShape = "pill" | "square";

export interface StatusBadgeProps {
  /** Text (or node) shown inside the badge. */
  label: ReactNode;
  /** Visual/semantic variant. Defaults to 'info'. */
  variant?: StatusBadgeVariant;
  /** Size preset. Defaults to 'md'. */
  size?: StatusBadgeSize;
  /** Pill (fully rounded) or square (rounded corners). Defaults to 'pill'. */
  shape?: StatusBadgeShape;
  /** Custom icon node. Pass `false` to hide the icon entirely. Defaults to a variant icon. */
  icon?: ReactNode | false;
  /** Renders the badge as a button and makes it interactive when provided. */
  onClick?: () => void;
  className?: string;
}

interface VariantStyle {
  bg: string;
  text: string;
  ring: string;
  Icon: LucideIcon;
}

const VARIANT_STYLES: Record<StatusBadgeVariant, VariantStyle> = {
  success: {
    bg: "bg-emerald-50 dark:bg-emerald-900/30",
    text: "text-emerald-700 dark:text-emerald-300",
    ring: "ring-emerald-600/20 dark:ring-emerald-400/20",
    Icon: CheckCircle2,
  },
  warning: {
    bg: "bg-amber-50 dark:bg-amber-900/30",
    text: "text-amber-700 dark:text-amber-300",
    ring: "ring-amber-600/20 dark:ring-amber-400/20",
    Icon: AlertTriangle,
  },
  error: {
    bg: "bg-red-50 dark:bg-red-900/30",
    text: "text-red-700 dark:text-red-300",
    ring: "ring-red-600/20 dark:ring-red-400/20",
    Icon: XCircle,
  },
  info: {
    bg: "bg-blue-50 dark:bg-blue-900/30",
    text: "text-blue-700 dark:text-blue-300",
    ring: "ring-blue-600/20 dark:ring-blue-400/20",
    Icon: Info,
  },
};

const SIZE_STYLES: Record<StatusBadgeSize, string> = {
  sm: "text-[10px] px-1.5 py-0.5 gap-1",
  md: "text-xs px-2.5 py-1 gap-1.5",
  lg: "text-sm px-3 py-1.5 gap-2",
};

const ICON_SIZE: Record<StatusBadgeSize, string> = {
  sm: "w-3 h-3",
  md: "w-3.5 h-3.5",
  lg: "w-4 h-4",
};

export function StatusBadge({
  label,
  variant = "info",
  size = "md",
  shape = "pill",
  icon,
  onClick,
  className,
}: StatusBadgeProps) {
  const style = VARIANT_STYLES[variant];
  const Icon = style.Icon;
  const showIcon = icon !== false;

  const badgeClassName = cn(
    "inline-flex items-center font-medium ring-1 ring-inset transition-colors",
    shape === "pill" ? "rounded-full" : "rounded-md",
    style.bg,
    style.text,
    style.ring,
    SIZE_STYLES[size],
    onClick &&
      "cursor-pointer hover:brightness-95 dark:hover:brightness-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-blue-500",
    className
  );

  const content = (
    <>
      {showIcon &&
        (icon || <Icon className={cn(ICON_SIZE[size], "shrink-0")} aria-hidden="true" />)}
      <span>{label}</span>
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={badgeClassName}>
        {content}
      </button>
    );
  }

  return (
    <span role="status" className={badgeClassName}>
      {content}
    </span>
  );
}

export default StatusBadge;
