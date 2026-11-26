import type { Logger } from "./logger.js";
import type { HealthMonitor, DependencyStatus } from "../health/monitor.js";
import { providerDegradedMode, providerDegradedModeRecoveries } from "./metrics.js";

/**
 * Enrichment providers that are optional — their unavailability must not mark
 * required attestations as complete or block core verification flows.
 *
 * Required providers (mongodb, stellar_horizon, soroban_rpc) are NOT in this
 * list; their failure makes the service unavailable, not degraded.
 */
export const OPTIONAL_PROVIDERS = ["ipfs", "kms", "tee_oracle"] as const;
export type OptionalProvider = (typeof OPTIONAL_PROVIDERS)[number];

/**
 * Human-readable description of what is unavailable in degraded mode,
 * and what the caller should do about it.
 */
export const DEGRADED_MODE_DESCRIPTIONS: Record<OptionalProvider, { unavailable: string; action: string }> = {
  ipfs: {
    unavailable: "IPFS content storage is unavailable; media uploads and storage-layer reads are paused.",
    action: "New verifications requiring IPFS will be queued. Existing certified verifications are unaffected.",
  },
  kms: {
    unavailable: "The Key Management Service is unavailable; encrypted media cannot be processed.",
    action: "Verifications requiring encryption are paused. Unencrypted flows continue normally.",
  },
  tee_oracle: {
    unavailable: "The TEE oracle worker is unavailable; attestation-based verification is paused.",
    action: "Verification jobs are queued and will be processed automatically when the oracle recovers.",
  },
};

export interface ProviderAvailability {
  provider: OptionalProvider;
  available: boolean;
  status: "up" | "degraded" | "down" | "unknown";
  /**
   * When false, the caller must not mark any attestation that requires this
   * provider as complete — it has not run.
   */
  attestationAllowed: boolean;
  message?: string;
}

export interface DegradedModeState {
  /** True when at least one optional provider is unavailable. */
  degraded: boolean;
  /** Bounded, machine-readable label for the overall degraded state. */
  mode: "normal" | "partial_degradation" | "full_degradation";
  providers: ProviderAvailability[];
  /** ISO timestamp of the last evaluation. */
  evaluatedAt: string;
}

/**
 * Tracks availability of optional enrichment providers and prevents required
 * attestations from being falsely marked complete when a provider is down.
 *
 * Key invariants:
 * - `attestationAllowed` is false for any provider that is not `up`.
 * - Core verification flows (MongoDB, Horizon, Soroban RPC) are not managed here.
 * - Recovery is automatic: when a provider returns `up`, `attestationAllowed`
 *   flips back to true on the next evaluation (driven by HealthMonitor's interval).
 * - Degraded state is clearly represented in `GET /api/status/providers`.
 */
export class ProviderDegradationTracker {
  private lastState: DegradedModeState;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly health: HealthMonitor,
    private readonly log: Logger,
    private readonly evalIntervalMs: number = 5_000,
  ) {
    this.lastState = this.evaluate();
  }

  start(): void {
    this.timer = setInterval(() => void this.tick(), this.evalIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** Returns the last evaluated degradation state without re-querying health. */
  current(): DegradedModeState {
    return this.lastState;
  }

  /**
   * Returns true if the given provider is available for attestation.
   * Call this before submitting any enrichment or attestation operation to
   * prevent falsely completing a required attestation when the provider is down.
   */
  isAvailable(provider: OptionalProvider): boolean {
    return this.lastState.providers.find((p) => p.provider === provider)?.attestationAllowed ?? false;
  }

  /**
   * Asserts that a provider is available. Throws a `ProviderUnavailableError`
   * (non-retryable, so the job moves to dead and is retried on the next run)
   * if the provider is down or degraded.
   *
   * Use this at the start of any handler that calls an optional provider so the
   * job is queued rather than partially executed with a missing attestation.
   */
  assertAvailable(provider: OptionalProvider): void {
    if (!this.isAvailable(provider)) {
      const desc = DEGRADED_MODE_DESCRIPTIONS[provider];
      throw new ProviderUnavailableError(
        provider,
        desc.unavailable,
        desc.action,
      );
    }
  }

  private tick(): void {
    const prev = this.lastState;
    const next = this.evaluate();
    this.lastState = next;

    // Log and emit metrics on transitions only.
    for (const p of next.providers) {
      const prevP = prev.providers.find((x) => x.provider === p.provider);
      if (!prevP) continue;

      if (prevP.available && !p.available) {
        providerDegradedMode.set({ provider: p.provider }, 1);
        this.log.warn("optional provider entered degraded mode; attestation paused", {
          provider: p.provider,
          status: p.status,
          message: p.message,
          ...DEGRADED_MODE_DESCRIPTIONS[p.provider],
        });
      } else if (!prevP.available && p.available) {
        providerDegradedMode.set({ provider: p.provider }, 0);
        providerDegradedModeRecoveries.inc({ provider: p.provider });
        this.log.info("optional provider recovered; attestation resumed automatically", {
          provider: p.provider,
          status: p.status,
        });
      }
    }
  }

  private evaluate(): DegradedModeState {
    const snapshot = this.health.snapshot();
    const evaluatedAt = new Date().toISOString();

    const providers: ProviderAvailability[] = OPTIONAL_PROVIDERS.map((name) => {
      const dep: DependencyStatus | undefined = snapshot.dependencies.find((d) => d.name === name);
      const status = dep?.status ?? "unknown";
      // Attestation is only allowed when the provider is confirmed `up`.
      // `degraded` means partial functionality — not safe for attestation.
      const available = status === "up";
      return {
        provider: name,
        available,
        status,
        attestationAllowed: available,
        message: dep?.message ?? (available ? undefined : DEGRADED_MODE_DESCRIPTIONS[name].unavailable),
      };
    });

    const unavailableCount = providers.filter((p) => !p.available).length;
    const mode: DegradedModeState["mode"] =
      unavailableCount === 0
        ? "normal"
        : unavailableCount < OPTIONAL_PROVIDERS.length
        ? "partial_degradation"
        : "full_degradation";

    // Publish current metric values on every evaluation so the gauge stays fresh.
    for (const p of providers) {
      providerDegradedMode.set({ provider: p.provider }, p.available ? 0 : 1);
    }

    return {
      degraded: unavailableCount > 0,
      mode,
      providers,
      evaluatedAt,
    };
  }
}

/**
 * Thrown by `ProviderDegradationTracker.assertAvailable()` when a required
 * optional provider is unavailable. The `retryable: true` flag causes the job
 * queue to reschedule the job for the next attempt — no duplicate actions occur
 * because the handler exits before submitting anything.
 */
export class ProviderUnavailableError extends Error {
  readonly code = "PROVIDER_UNAVAILABLE";
  readonly retryable = true;

  constructor(
    readonly provider: OptionalProvider,
    message: string,
    readonly operatorAction: string,
  ) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}
