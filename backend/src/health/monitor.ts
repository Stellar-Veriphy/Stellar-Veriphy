import type { Logger } from "../lib/logger.js";
import {
  capacityForecastWarnings,
  dependencyCheckDuration,
  dependencyCheckFailures,
  dependencyConsecutiveFailures,
  dependencyHealth,
  dependencyLastSuccess,
} from "../lib/metrics.js";
import { withRetry } from "../lib/retry.js";
import {
  HealthCheckError,
  failureReason,
  type DependencyCheck,
  type FailureReason,
  type HealthState,
  type ProbeResult,
} from "./checks.js";

export type DependencyState = HealthState | "unknown";

export interface DependencyStatus {
  name: string;
  critical: boolean;
  status: DependencyState;
  checkedAt?: string;
  latencyMs?: number;
  attempts?: number;
  lastSuccessAt?: string;
  downSince?: string;
  consecutiveFailures: number;
  message?: string;
  error?: { reason: FailureReason; message: string };
  details?: Record<string, unknown>;
  remediation: string;
}

export interface HealthReport {
  status: HealthState;
  checkedAt: string;
  dependencies: DependencyStatus[];
}

export interface HealthMonitorOptions {
  intervalMs: number;
  timeoutMs: number;
  /** In-check retries before a dependency is marked down (absorbs single dropped requests). */
  retries: number;
  /** Capacity forecasting configuration; omitted disables forecasting. */
  capacity?: CapacityForecastOptions;
}

export type CapacityResource = "storage" | "queue" | "api";

/** A single observed usage sample for a capacity resource. */
export interface CapacitySample {
  /** Epoch milliseconds when the sample was taken. */
  at: number;
  /** Observed usage in the resource's native unit (bytes, messages, requests/min, ...). */
  value: number;
  /** Release tag the sample was collected under, for cross-release comparison. */
  release?: string;
}

export interface CapacityThreshold {
  /** Usage level that is considered critical for this resource. */
  critical: number;
  /** Unit label shown alongside the forecast (e.g. "bytes", "messages", "req/min"). */
  unit: string;
}

export interface CapacityForecastOptions {
  /** How far back to look when fitting the trend. */
  windowMs: number;
  /** How far ahead to project usage when looking for threshold breaches. */
  horizonMs: number;
  /** Minimum number of samples required before a forecast is produced. */
  minSamples: number;
  /** Release tag of the running build, recorded in the forecast assumptions. */
  release: string;
  /** Per-resource critical thresholds. */
  thresholds: Partial<Record<CapacityResource, CapacityThreshold>>;
}

/** Visible assumptions behind a forecast so operators can judge its validity. */
export interface CapacityForecastAssumptions {
  windowMs: number;
  horizonMs: number;
  minSamples: number;
  growthModel: "linear";
  release: string;
  sampleCount: number;
  windowStart?: string;
  windowEnd?: string;
}

export interface CapacityForecast {
  resource: CapacityResource;
  unit: string;
  current: number;
  /** Projected usage at the end of the forecast horizon. */
  projected: number;
  /** Growth per hour derived from the linear fit (may be negative). */
  growthPerHour: number;
  critical: number;
  /** Epoch ms when the critical threshold is projected to be crossed, if within the horizon. */
  thresholdEtaMs?: number;
  warning: boolean;
  assumptions: CapacityForecastAssumptions;
  /** Per-release aggregates for comparing historical usage across releases. */
  byRelease: Record<string, { samples: number; latest: number; peak: number }>;
}

export interface CapacityForecastReport {
  generatedAt: string;
  forecasts: CapacityForecast[];
  warnings: CapacityResource[];
}

const STATE_VALUE: Record<HealthState, number> = { up: 2, degraded: 1, down: 0 };

/** While a dependency stays down, repeat the warning every N failed checks instead of every check. */
const STILL_DOWN_LOG_EVERY = 10;

/** Maximum number of samples retained per capacity resource. */
const CAPACITY_SAMPLE_LIMIT = 5_000;

function linearFit(samples: CapacitySample[]): { slopePerMs: number; intercept: number } {
  const n = samples.length;
  if (n < 2) return { slopePerMs: 0, intercept: n === 1 ? samples[0].value : 0 };
  const base = samples[0].at;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const s of samples) {
    const x = s.at - base;
    sumX += x;
    sumY += s.value;
    sumXY += x * s.value;
    sumXX += x * x;
  }
  const denom = n * sumXX - sumX * sumX;
  const slopePerMs = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slopePerMs * sumX) / n;
  return { slopePerMs, intercept };
}

function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause instanceof Error ? `: ${err.cause.message}` : "";
  return err.message + cause;
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new HealthCheckError(`Timed out after ${ms}ms`, "timeout"));
    }, ms);
  });
  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Periodically probes every external dependency, keeps the latest status in memory for the
 * /health endpoints, exports Prometheus metrics, and logs state transitions with remediation hints.
 */
export class HealthMonitor {
  private readonly statuses = new Map<string, DependencyStatus>();
  private readonly inFlight = new Map<string, Promise<DependencyStatus>>();
  private readonly capacitySamples = new Map<CapacityResource, CapacitySample[]>();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly checks: DependencyCheck[],
    private readonly opts: HealthMonitorOptions,
    private readonly log: Logger,
  ) {
    for (const check of checks) {
      this.statuses.set(check.name, {
        name: check.name,
        critical: check.critical,
        status: "unknown",
        consecutiveFailures: 0,
        remediation: check.remediation,
      });
    }
  }

  start(): void {
    this.log.info("health monitor started", {
      dependencies: this.checks.map((c) => ({ name: c.name, critical: c.critical })),
      intervalMs: this.opts.intervalMs,
    });
    void this.runAll();
    this.timer = setInterval(() => void this.runAll(), this.opts.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  async runAll(): Promise<void> {
    await Promise.all(this.checks.map((c) => this.run(c.name)));
  }

  /** Runs one check now (deduplicated with any in-flight run). Returns undefined for unknown names. */
  run(name: string): Promise<DependencyStatus> | undefined {
    const check = this.checks.find((c) => c.name === name);
    if (!check) return undefined;
    let pending = this.inFlight.get(name);
    if (!pending) {
      pending = this.execute(check).finally(() => this.inFlight.delete(name));
      this.inFlight.set(name, pending);
    }
    return pending;
  }

  snapshot(): HealthReport {
    const dependencies = [...this.statuses.values()];
    let status: HealthState = "up";
    for (const dep of dependencies) {
      const failing = dep.status === "down" || dep.status === "unknown";
      if (dep.critical && failing) {
        status = "down";
        break;
      }
      if (dep.status !== "up") status = "degraded";
    }
    return { status, checkedAt: new Date().toISOString(), dependencies };
  }

  /** Names of critical dependencies that are down or not yet checked. Empty means ready. */
  failingCritical(): string[] {
    return [...this.statuses.values()]
      .filter((d) => d.critical && (d.status === "down" || d.status === "unknown"))
      .map((d) => d.name);
  }

  /** Records an observed usage sample for a capacity resource. */
  recordCapacitySample(resource: CapacityResource, value: number, at: number = Date.now(), release?: string): void {
    const samples = this.capacitySamples.get(resource) ?? [];
    samples.push({ at, value, release: release ?? this.opts.capacity?.release });
    if (samples.length > CAPACITY_SAMPLE_LIMIT) samples.splice(0, samples.length - CAPACITY_SAMPLE_LIMIT);
    this.capacitySamples.set(resource, samples);
  }

  /**
   * Derives storage, queue, and API usage trends from recent samples, projects them forward over the
   * configured horizon, and emits advance warnings when a critical threshold is projected to be crossed.
   */
  forecastCapacity(now: number = Date.now()): CapacityForecastReport {
    const cfg = this.opts.capacity;
    const generatedAt = new Date(now).toISOString();
    if (!cfg) return { generatedAt, forecasts: [], warnings: [] };

    const windowStart = now - cfg.windowMs;
    const forecasts: CapacityForecast[] = [];
    const warnings: CapacityResource[] = [];

    for (const resource of ["storage", "queue", "api"] as CapacityResource[]) {
      const threshold = cfg.thresholds[resource];
      if (!threshold) continue;
      const all = this.capacitySamples.get(resource) ?? [];
      const windowed = all.filter((s) => s.at >= windowStart && s.at <= now).sort((a, b) => a.at - b.at);

      const byRelease: CapacityForecast["byRelease"] = {};
      for (const s of all) {
        if (!s.release) continue;
        const agg = (byRelease[s.release] ??= { samples: 0, latest: s.value, peak: s.value });
        agg.samples += 1;
        agg.latest = s.value;
        agg.peak = Math.max(agg.peak, s.value);
      }

      const assumptions: CapacityForecastAssumptions = {
        windowMs: cfg.windowMs,
        horizonMs: cfg.horizonMs,
        minSamples: cfg.minSamples,
        growthModel: "linear",
        release: cfg.release,
        sampleCount: windowed.length,
        windowStart: windowed.length ? new Date(windowed[0].at).toISOString() : undefined,
        windowEnd: windowed.length ? new Date(windowed[windowed.length - 1].at).toISOString() : undefined,
      };

      const current = windowed.length ? windowed[windowed.length - 1].value : 0;
      if (windowed.length < cfg.minSamples) {
        forecasts.push({
          resource,
          unit: threshold.unit,
          current,
          projected: current,
          growthPerHour: 0,
          critical: threshold.critical,
          warning: false,
          assumptions,
          byRelease,
        });
        continue;
      }

      const { slopePerMs, intercept } = linearFit(windowed);
      const base = windowed[0].at;
      const projected = Math.max(0, intercept + slopePerMs * (now + cfg.horizonMs - base));
      const growthPerHour = slopePerMs * 3_600_000;

      let thresholdEtaMs: number | undefined;
      if (slopePerMs > 0) {
        const eta = base + (threshold.critical - intercept) / slopePerMs;
        if (eta > now && eta <= now + cfg.horizonMs) thresholdEtaMs = eta;
      }
      const warning = thresholdEtaMs !== undefined || projected >= threshold.critical;

      if (warning) {
        warnings.push(resource);
        capacityForecastWarnings.inc({ resource });
        this.log.warn("capacity threshold projected within horizon", {
          resource,
          unit: threshold.unit,
          current,
          projected,
          critical: threshold.critical,
          growthPerHour,
          thresholdEta: thresholdEtaMs ? new Date(thresholdEtaMs).toISOString() : undefined,
          horizonMs: cfg.horizonMs,
          release: cfg.release,
        });
      }

      forecasts.push({
        resource,
        unit: threshold.unit,
        current,
        projected,
        growthPerHour,
        critical: threshold.critical,
        thresholdEtaMs,
        warning,
        assumptions,
        byRelease,
      });
    }

    return { generatedAt, forecasts, warnings };
  }

  private async execute(check: DependencyCheck): Promise<DependencyStatus> {
    const started = performance.now();
    let attempts = 0;
    try {
      const result = await withRetry(
        (attempt) => {
          attempts = attempt;
          return withTimeout((signal) => check.probe(signal), this.opts.timeoutMs);
        },
        {
          retries: this.opts.retries,
          baseDelayMs: 250,
          maxDelayMs: 2_000,
          onRetry: (err, attempt, delayMs) =>
            this.log.debug("dependency check attempt failed, retrying", {
              dependency: check.name,
              attempt,
              delayMs,
              reason: failureReason(err),
              error: errorMessage(err),
            }),
        },
      );
      return this.recordSuccess(check, result, performance.now() - started, attempts);
    } catch (err) {
      return this.recordFailure(check, err, performance.now() - started, attempts);
    }
  }

  private recordSuccess(check: DependencyCheck, result: ProbeResult, latencyMs: number, attempts: number): DependencyStatus {
    const prev = this.statuses.get(check.name)!;
    const now = new Date();
    const next: DependencyStatus = {
      ...prev,
      status: result.status,
      checkedAt: now.toISOString(),
      latencyMs: Math.round(latencyMs),
      attempts,
      lastSuccessAt: now.toISOString(),
      downSince: undefined,
      consecutiveFailures: 0,
      message: result.message,
      error: undefined,
      details: result.details,
    };
    this.statuses.set(check.name, next);

    dependencyHealth.set({ dependency: check.name, critical: String(check.critical) }, STATE_VALUE[result.status]);
    dependencyCheckDuration.observe({ dependency: check.name, outcome: result.status }, latencyMs / 1000);
    dependencyConsecutiveFailures.set({ dependency: check.name }, 0);
    dependencyLastSuccess.set({ dependency: check.name }, Math.floor(now.getTime() / 1000));

    const fields = { dependency: check.name, critical: check.critical, latencyMs: next.latencyMs, details: result.details };
    if (prev.status === "down") {
      const downtimeSeconds = prev.downSince ? Math.round((now.getTime() - Date.parse(prev.downSince)) / 1000) : undefined;
      this.log.info("dependency recovered", { ...fields, status: result.status, downtimeSeconds, failedChecks: prev.consecutiveFailures });
    } else if (result.status === "degraded" && prev.status !== "degraded") {
      this.log.warn("dependency degraded", { ...fields, message: result.message, remediation: check.remediation });
    } else if (result.status === "up" && prev.status === "degraded") {
      this.log.info("dependency no longer degraded", fields);
    } else if (prev.status === "unknown") {
      this.log.info("dependency check passed", { ...fields, status: result.status });
    }
    return next;
  }

  private recordFailure(check: DependencyCheck, err: unknown, latencyMs: number, attempts: number): DependencyStatus {
    const prev = this.statuses.get(check.name)!;
    const now = new Date();
    const reason = failureReason(err);
    const message = errorMessage(err);
    const next: DependencyStatus = {
      ...prev,
      status: "down",
      checkedAt: now.toISOString(),
      latencyMs: Math.round(latencyMs),
      attempts,
      downSince: prev.status === "down" ? prev.downSince : now.toISOString(),
      consecutiveFailures: prev.consecutiveFailures + 1,
      message: undefined,
      error: { reason, message },
      details: undefined,
    };
    this.statuses.set(check.name, next);

    dependencyHealth.set({ dependency: check.name, critical: String(check.critical) }, STATE_VALUE.down);
    dependencyCheckDuration.observe({ dependency: check.name, outcome: "down" }, latencyMs / 1000);
    dependencyCheckFailures.inc({ dependency: check.name, reason });
    dependencyConsecutiveFailures.set({ dependency: check.name }, next.consecutiveFailures);

    const fields = {
      dependency: check.name,
      critical: check.critical,
      reason,
      error: message,
      attempts,
      consecutiveFailures: next.consecutiveFailures,
      downSince: next.downSince,
      lastSuccessAt: next.lastSuccessAt,
      remediation: check.remediation,
    };
    if (prev.status !== "down") {
      this.log.error("dependency down", fields);
    } else if (next.consecutiveFailures % STILL_DOWN_LOG_EVERY === 0) {
      this.log.warn("dependency still down", fields);
    }
    return next;
  }
}
