/**
 * Tests for graceful degradation of optional enrichment providers (Feature 4).
 *
 * Verifies:
 *  - Degraded mode is clearly represented in the state object.
 *  - Required attestations are not falsely marked complete when a provider is down.
 *  - Recovery behaviour is automatic (attestationAllowed flips back when provider is up).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OPTIONAL_PROVIDERS,
  DEGRADED_MODE_DESCRIPTIONS,
  ProviderUnavailableError,
  ProviderDegradationTracker,
} from "../src/lib/degraded.js";

// ---------------------------------------------------------------------------
// OPTIONAL_PROVIDERS constant
// ---------------------------------------------------------------------------

test("OPTIONAL_PROVIDERS covers ipfs, kms, tee_oracle", () => {
  const providers = [...OPTIONAL_PROVIDERS];
  assert.ok(providers.includes("ipfs"));
  assert.ok(providers.includes("kms"));
  assert.ok(providers.includes("tee_oracle"));
});

test("every optional provider has a degraded-mode description and action", () => {
  for (const provider of OPTIONAL_PROVIDERS) {
    const desc = DEGRADED_MODE_DESCRIPTIONS[provider];
    assert.ok(desc, `missing description for ${provider}`);
    assert.ok(desc.unavailable.length > 0, `${provider}.unavailable must be non-empty`);
    assert.ok(desc.action.length > 0, `${provider}.action must be non-empty`);
  }
});

// ---------------------------------------------------------------------------
// ProviderUnavailableError
// ---------------------------------------------------------------------------

test("ProviderUnavailableError carries provider, retryable=true, and code", () => {
  const err = new ProviderUnavailableError("tee_oracle", "oracle is down", "wait for recovery");
  assert.equal(err.provider, "tee_oracle");
  assert.equal(err.retryable, true);
  assert.equal(err.code, "PROVIDER_UNAVAILABLE");
  assert.equal(err.name, "ProviderUnavailableError");
  assert.ok(err instanceof Error);
});

// ---------------------------------------------------------------------------
// ProviderDegradationTracker — state computation
// ---------------------------------------------------------------------------

/** Minimal HealthMonitor stub — returns a snapshot from the provided dependencies. */
function makeHealth(deps: Array<{ name: string; status: "up" | "degraded" | "down" | "unknown" }>) {
  return {
    snapshot() {
      return {
        status: "up" as const,
        checkedAt: new Date().toISOString(),
        dependencies: deps.map((d) => ({
          name: d.name,
          critical: false,
          status: d.status,
          consecutiveFailures: 0,
          remediation: "",
        })),
      };
    },
  };
}

function makeLog() {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    child: () => makeLog(),
  };
}

test("degraded mode is 'normal' when all optional providers are up", () => {
  const health = makeHealth([
    { name: "ipfs", status: "up" },
    { name: "kms", status: "up" },
    { name: "tee_oracle", status: "up" },
  ]);
  const tracker = new ProviderDegradationTracker(health as never, makeLog() as never, 999_999);
  const state = tracker.current();

  assert.equal(state.degraded, false);
  assert.equal(state.mode, "normal");
  for (const p of state.providers) {
    assert.equal(p.available, true, `${p.provider} should be available`);
    assert.equal(p.attestationAllowed, true);
  }
});

test("degraded mode is 'partial_degradation' when one provider is down", () => {
  const health = makeHealth([
    { name: "ipfs", status: "down" },
    { name: "kms", status: "up" },
    { name: "tee_oracle", status: "up" },
  ]);
  const tracker = new ProviderDegradationTracker(health as never, makeLog() as never, 999_999);
  const state = tracker.current();

  assert.equal(state.degraded, true);
  assert.equal(state.mode, "partial_degradation");

  const ipfs = state.providers.find((p) => p.provider === "ipfs");
  assert.ok(ipfs, "ipfs must be in state.providers");
  assert.equal(ipfs!.available, false);
  assert.equal(ipfs!.attestationAllowed, false);
});

test("degraded mode is 'full_degradation' when all optional providers are down", () => {
  const health = makeHealth([
    { name: "ipfs", status: "down" },
    { name: "kms", status: "down" },
    { name: "tee_oracle", status: "down" },
  ]);
  const tracker = new ProviderDegradationTracker(health as never, makeLog() as never, 999_999);
  const state = tracker.current();

  assert.equal(state.mode, "full_degradation");
  assert.equal(state.degraded, true);
});

test("'degraded' status sets attestationAllowed to false (not falsely complete)", () => {
  // A degraded provider is NOT safe for attestation submission.
  const health = makeHealth([
    { name: "ipfs", status: "up" },
    { name: "kms", status: "up" },
    { name: "tee_oracle", status: "degraded" },
  ]);
  const tracker = new ProviderDegradationTracker(health as never, makeLog() as never, 999_999);
  const state = tracker.current();

  assert.equal(state.degraded, true);
  const oracle = state.providers.find((p) => p.provider === "tee_oracle");
  assert.equal(oracle!.attestationAllowed, false,
    "attestation must not be allowed when provider is degraded, not just down");
});

test("isAvailable returns false for a down provider and true for an up provider", () => {
  const health = makeHealth([
    { name: "ipfs", status: "down" },
    { name: "kms", status: "up" },
    { name: "tee_oracle", status: "up" },
  ]);
  const tracker = new ProviderDegradationTracker(health as never, makeLog() as never, 999_999);

  assert.equal(tracker.isAvailable("ipfs"), false);
  assert.equal(tracker.isAvailable("kms"), true);
  assert.equal(tracker.isAvailable("tee_oracle"), true);
});

test("assertAvailable throws ProviderUnavailableError for a down provider", () => {
  const health = makeHealth([
    { name: "ipfs", status: "down" },
    { name: "kms", status: "up" },
    { name: "tee_oracle", status: "up" },
  ]);
  const tracker = new ProviderDegradationTracker(health as never, makeLog() as never, 999_999);

  assert.throws(
    () => tracker.assertAvailable("ipfs"),
    (err) => err instanceof ProviderUnavailableError && err.provider === "ipfs",
  );
});

test("assertAvailable does not throw for an up provider", () => {
  const health = makeHealth([
    { name: "ipfs", status: "up" },
    { name: "kms", status: "up" },
    { name: "tee_oracle", status: "up" },
  ]);
  const tracker = new ProviderDegradationTracker(health as never, makeLog() as never, 999_999);
  assert.doesNotThrow(() => tracker.assertAvailable("ipfs"));
});

test("recovery is automatic — attestationAllowed flips to true after provider returns up", () => {
  // Start with oracle down.
  const deps = [
    { name: "ipfs", status: "up" as const },
    { name: "kms", status: "up" as const },
    { name: "tee_oracle", status: "down" as const },
  ];
  const health = {
    snapshot() {
      return {
        status: "up" as const,
        checkedAt: new Date().toISOString(),
        dependencies: deps.map((d) => ({
          name: d.name, critical: false, status: d.status,
          consecutiveFailures: 0, remediation: "",
        })),
      };
    },
  };

  const tracker = new ProviderDegradationTracker(health as never, makeLog() as never, 999_999);
  assert.equal(tracker.isAvailable("tee_oracle"), false);

  // Simulate recovery by mutating the deps array (the health stub reads it live).
  deps[2]!.status = "up";

  // Trigger an internal evaluation tick directly.
  // @ts-expect-error — accessing private method for test purposes.
  tracker["tick"]();

  assert.equal(tracker.isAvailable("tee_oracle"), true,
    "attestationAllowed must flip back automatically when provider recovers");
});

test("state includes evaluatedAt ISO timestamp", () => {
  const health = makeHealth([
    { name: "ipfs", status: "up" },
    { name: "kms", status: "up" },
    { name: "tee_oracle", status: "up" },
  ]);
  const tracker = new ProviderDegradationTracker(health as never, makeLog() as never, 999_999);
  const state = tracker.current();

  assert.ok(typeof state.evaluatedAt === "string");
  assert.ok(!Number.isNaN(Date.parse(state.evaluatedAt)));
});

test("providers not in OPTIONAL_PROVIDERS do not appear in degradation state", () => {
  const health = makeHealth([
    { name: "mongodb", status: "up" },        // required, not optional
    { name: "stellar_horizon", status: "up" }, // required
    { name: "ipfs", status: "up" },
    { name: "kms", status: "up" },
    { name: "tee_oracle", status: "up" },
  ]);
  const tracker = new ProviderDegradationTracker(health as never, makeLog() as never, 999_999);
  const state = tracker.current();

  const names = state.providers.map((p) => p.provider);
  assert.ok(!names.includes("mongodb" as never), "required providers must not appear in degradation state");
  assert.ok(!names.includes("stellar_horizon" as never));
  assert.equal(names.length, OPTIONAL_PROVIDERS.length);
});
