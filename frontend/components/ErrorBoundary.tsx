"use client";

/**
 * ErrorBoundary — #438 React Error Boundaries
 *
 * A class-based React error boundary that catches unhandled errors thrown
 * by any child component tree and renders a fallback UI instead of crashing
 * the entire page.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <SomeFeature />
 *   </ErrorBoundary>
 *
 *   // Custom fallback:
 *   <ErrorBoundary fallback={<p>Something went wrong.</p>}>
 *     <SomeFeature />
 *   </ErrorBoundary>
 *
 *   // Named section for better error messages:
 *   <ErrorBoundary section="Wallet">
 *     <WalletSelector />
 *   </ErrorBoundary>
 */

import React, { Component, ErrorInfo } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ErrorBoundaryProps {
  /** Child component tree to protect. */
  children: React.ReactNode;
  /** Custom fallback to render when an error is caught. Receives the error. */
  fallback?: React.ReactNode | ((error: Error, reset: () => void) => React.ReactNode);
  /**
   * Human-readable label for the protected section, used in the default
   * fallback UI and in error logs.
   */
  section?: string;
  /**
   * Optional callback invoked after an error is caught. Use this to send
   * errors to an external logging or monitoring service (e.g. Sentry).
   */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// ---------------------------------------------------------------------------
// ErrorBoundary class
// ---------------------------------------------------------------------------

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const { section = "unknown", onError } = this.props;

    // Always log to console for local debugging.
    console.error(`[ErrorBoundary:${section}] Caught error:`, error, errorInfo);

    // Forward to the caller's error reporter (e.g. Sentry).
    onError?.(error, errorInfo);
  }

  reset(): void {
    this.setState({ hasError: false, error: null });
  }

  render(): React.ReactNode {
    const { hasError, error } = this.state;
    const { children, fallback, section = "this section" } = this.props;

    if (!hasError || !error) {
      return children;
    }

    // Caller provided a custom fallback.
    if (fallback !== undefined) {
      if (typeof fallback === "function") {
        return fallback(error, this.reset);
      }
      return fallback;
    }

    // Default fallback UI.
    return (
      <DefaultErrorFallback section={section} error={error} onReset={this.reset} />
    );
  }
}

// ---------------------------------------------------------------------------
// Default fallback UI
// ---------------------------------------------------------------------------

interface DefaultErrorFallbackProps {
  section: string;
  error: Error;
  onReset: () => void;
}

function DefaultErrorFallback({ section, error, onReset }: DefaultErrorFallbackProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex flex-col items-center justify-center gap-4 rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30 p-8 text-center"
    >
      {/* Icon */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-12 w-12 text-red-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
        />
      </svg>

      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-red-800 dark:text-red-300">
          Something went wrong
        </h2>
        <p className="text-sm text-red-700 dark:text-red-400">
          An unexpected error occurred in <strong>{section}</strong>.
        </p>
        {process.env.NODE_ENV === "development" && (
          <p className="mt-2 max-w-md text-xs text-red-600 dark:text-red-500 font-mono break-all">
            {error.message}
          </p>
        )}
      </div>

      {/* Recovery options */}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onReset}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
        >
          Reload page
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// withErrorBoundary HOC — convenience wrapper for function components
// ---------------------------------------------------------------------------

/**
 * Higher-order component that wraps `WrappedComponent` in an `ErrorBoundary`.
 *
 *   const SafeChart = withErrorBoundary(LineChart, { section: "Chart" });
 */
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  boundaryProps?: Omit<ErrorBoundaryProps, "children">,
): React.FC<P> {
  const displayName =
    WrappedComponent.displayName || WrappedComponent.name || "Component";

  const WithBoundary: React.FC<P> = (props) => (
    <ErrorBoundary {...boundaryProps}>
      <WrappedComponent {...props} />
    </ErrorBoundary>
  );

  WithBoundary.displayName = `withErrorBoundary(${displayName})`;
  return WithBoundary;
}
